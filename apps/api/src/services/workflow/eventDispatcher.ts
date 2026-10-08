import { prisma } from '@agent-flux/database';
import { workflowQueue } from '../queue/workflowQueue';
import { ConditionEngine } from './conditionEngine';

import { invoiceService } from '../invoice/InvoiceService';

export class EventDispatcher {
  /**
   * Dispatch an application event.
   * Finds matching workflow triggers and starts new executions.
   * Finds waiting workflows and resumes them.
   */
  static async dispatch(businessId: string, eventType: string, payload: any) {
    // ---- System Hardcoded Workflow Hooks ----
    try {
      // 0. Synchronize to Sheets
      const syncEvents = ['CUSTOMER_CREATED', 'ENQUIRY_CREATED', 'QUOTATION_CREATED', 'ORDER_CREATED', 'INVOICE_GENERATED'];
      if (syncEvents.includes(eventType)) {
          const { SheetSyncService } = require('../intake/SheetSyncService');
          const entityMap: Record<string, string> = {
              'CUSTOMER_CREATED': 'CUSTOMER',
              'ENQUIRY_CREATED': 'ENQUIRY',
              'QUOTATION_CREATED': 'QUOTATION',
              'ORDER_CREATED': 'ORDER',
              'INVOICE_GENERATED': 'INVOICE'
          };
          const entityId = payload.customerId || payload.enquiryId || payload.quotationId || payload.orderId || payload.invoiceId;
          if (entityId) {
             // Non-blocking background sync
             SheetSyncService.syncEntity(businessId, entityMap[eventType], entityId).catch((err: any) => console.error("Sheet sync failed", err));
          }
      }
      if (eventType === 'ORDER_CREATED' || eventType === 'ORDER_CONFIRMED') {
        const orderId = payload.orderId;
        
        // 1. Check readiness
        const readiness = await invoiceService.checkReadiness(businessId, orderId);
        
        if (readiness.status === 'INVOICE_READINESS_PASSED') {
          const { EventBus } = require('../eventBus');
          EventBus.publish(businessId, 'INVOICE_READINESS_PASSED', { orderId });
          
          EventBus.publish(businessId, 'INVOICE_GENERATION_STARTED', { orderId });
          const invoiceId = await invoiceService.generateInvoice(businessId, orderId);
          // Invoice generated event is published inside generateInvoice
        } else if (readiness.status === 'CUSTOMER_INFORMATION_REQUIRED') {
          // Send request for missing info
          const { prisma } = require('@agent-flux/database');
          const { getConnectorProvider } = require('../../connectors/registry');
          
          const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true, business: true } });
          
          const body = `
            <p>Dear ${order?.customer?.name || 'Customer'},</p>
            <p>Thank you for confirming your order.</p>
            <p>Before we generate your invoice, we need your billing address.</p>
            <p>Please provide your complete billing address including:</p>
            <ul>
              <li>Address:</li>
              <li>City:</li>
              <li>State:</li>
              <li>PIN/ZIP:</li>
            </ul>
            <p>If your billing address is the same as the delivery address, please let us know.</p>
            <p>Best regards,<br/>${order?.business?.displayName || 'Team'}</p>
          `;
          
          try {
              const gmailAction = require('../../connectors/actions/gmail').gmailActions.find((a: any) => a.id === 'send_email');
              const creds = await prisma.integrationCredential.findFirst({ where: { integration: { businessId, provider: 'GMAIL', status: 'CONNECTED' } } });
              if (creds && gmailAction) {
                  let accessToken = creds.accessTokenEncrypted;
                  if (creds.expiresAt && creds.expiresAt.getTime() < Date.now() + 60000 && creds.refreshTokenEncrypted) {
                       const { google } = require('googleapis');
                       const oauth2Client = new google.auth.OAuth2(
                          process.env.GOOGLE_CLIENT_ID,
                          process.env.GOOGLE_CLIENT_SECRET
                       );
                       oauth2Client.setCredentials({ refresh_token: creds.refreshTokenEncrypted });
                       try {
                           const { credentials } = await oauth2Client.refreshAccessToken();
                           if (credentials.access_token) {
                               accessToken = credentials.access_token;
                               await prisma.integrationCredential.update({
                                   where: { id: creds.id },
                                   data: { accessTokenEncrypted: accessToken, expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null }
                               });
                           }
                       } catch(refErr) { /* ignore */ }
                  }

                  await gmailAction.execute({ accessToken }, {
                      to: order?.customer?.email,
                      subject: `Action Required: Billing Address for Order ${order?.orderNumber}`,
                      body: body
                  });
              } else {
                  console.log(`[EventDispatcher] Could not send email. Gmail not connected. Body: ${body}`);
              }
          } catch(e) {
              console.error("[EventDispatcher] Error sending email:", e);
          }
          
          await prisma.order.update({
            where: { id: orderId },
            data: { status: 'CUSTOMER_INFORMATION_REQUIRED' }
          });
        }
      }

      if (eventType === 'INVOICE_GENERATED') {
        // Automatically send the invoice and mark payment pending
        await invoiceService.sendInvoice(businessId, payload.invoiceId);
      }
    } catch (err) {
      console.error(`[System Workflow Handler] Error handling ${eventType}:`, err);
    }
    // ---- End System Hooks ----
    // 1. Find active workflows with matching EVENT trigger
    const workflows = await prisma.workflow.findMany({
      where: { businessId, status: 'ACTIVE' },
      include: { versions: true }
    });

    for (const wf of workflows) {
      if (!wf.activeVersionId) continue;
      const activeVersion = wf.versions.find(v => v.id === wf.activeVersionId);
      if (!activeVersion) continue;

      const triggerConfig = activeVersion.trigger as any;
      if (triggerConfig?.type === 'EVENT' && triggerConfig?.eventType === eventType) {
        
        // Match conditions if any
        if (triggerConfig.filters) {
           const isMatch = ConditionEngine.evaluate(triggerConfig.filters, { event: payload });
           if (!isMatch) continue;
        }

        const { WorkflowEngine } = require('./engine');
        await WorkflowEngine.triggerWorkflow(
          businessId,
          wf.id,
          'EVENT',
          payload
        );
      }
    }

    // 2. Find waiting executions that wait for this event
    const waitingExecutions = await prisma.workflowExecution.findMany({
      where: { businessId, status: 'WAITING' }
    });

    for (const exec of waitingExecutions) {
       const context = exec.context as any;
       if (context?.waitingForEvent?.type === eventType) {
         
         // Correlation check (e.g. invoiceId === payload.invoice.id)
         const correlation = context.waitingForEvent.correlation;
         let isCorrelated = true;
         
         if (correlation) {
            for (const [key, valuePath] of Object.entries(correlation)) {
               const valInEvent = ConditionEngine['getNestedValue'](payload, String(valuePath));
               if (context.variables[key] !== valInEvent) {
                  isCorrelated = false;
                  break;
               }
            }
         }

         if (isCorrelated) {
           // Resume execution
           context.eventReceived = payload;
           delete context.waitingForEvent;

           await prisma.workflowExecution.update({
             where: { id: exec.id },
             data: { status: 'QUEUED', context }
           });

           await workflowQueue.add('executeWorkflow', { executionId: exec.id }, {
             jobId: exec.id,
             removeOnComplete: true,
             removeOnFail: false
           });
         }
       }
    }
  }
}
