import { prisma } from '@agent-flux/database';
import { workflowQueue } from '../queue/workflowQueue';
import { ConditionEngine } from './conditionEngine';
import { encrypt, decrypt } from '../encryption';
import { invoiceService } from '../invoice/InvoiceService';

export class EventDispatcher {
  /**
   * Dispatch an application event across active tenant workflows and system handlers.
   * 1. Evaluates dynamic tenant workflows matching the event type and filters.
   * 2. Resumes any waiting workflow executions correlated to this event.
   * 3. Executes fallback system integrations (e.g. operational sync and Aasha furniture pack).
   */
  static async dispatch(businessId: string, eventType: string, payload: any) {
    let handledByDynamicWorkflow = false;

    // 1. Match and trigger dynamic active workflows for this tenant
    try {
      const activeWorkflows = await prisma.workflow.findMany({
        where: { businessId, status: 'ACTIVE' },
        include: { versions: true }
      });

      for (const wf of activeWorkflows) {
        if (!wf.activeVersionId) continue;
        const activeVersion = wf.versions.find(v => v.id === wf.activeVersionId);
        if (!activeVersion) continue;

        const triggerConfig = activeVersion.trigger as any;
        const matchesEvent = triggerConfig?.type === 'EVENT' && 
          (triggerConfig?.eventType === eventType || triggerConfig?.event === eventType);

        if (matchesEvent) {
          // Evaluate event filters if defined
          if (triggerConfig.filters) {
            const isMatch = ConditionEngine.evaluate(triggerConfig.filters, {
              event: payload,
              trigger: payload,
              ...payload
            });
            if (!isMatch) continue;
          }

          const { WorkflowEngine } = require('./engine');
          await WorkflowEngine.triggerWorkflow(
            businessId,
            wf.id,
            'EVENT',
            payload
          );
          handledByDynamicWorkflow = true;
        }
      }
    } catch (wfErr: any) {
      console.error(`[EventDispatcher] Error evaluating dynamic workflows for ${eventType}:`, wfErr.message);
    }

    // 2. Find and resume waiting executions correlated to this event
    try {
      const waitingExecutions = await prisma.workflowExecution.findMany({
        where: { businessId, status: 'WAITING' }
      });

      for (const exec of waitingExecutions) {
        const context = exec.context as any;
        const waitingFor = context?.metadata?.waitingForEvent || context?.waitingForEvent;

        if (waitingFor?.type === eventType || waitingFor?.eventType === eventType) {
          // Correlation check (e.g. invoiceId === payload.invoiceId)
          const correlation = waitingFor.correlation;
          let isCorrelated = true;

          if (correlation) {
            for (const [key, valuePath] of Object.entries(correlation)) {
              const valInEvent = ConditionEngine.resolveFieldValue(payload, String(valuePath));
              if (context.variables?.[key] !== valInEvent) {
                isCorrelated = false;
                break;
              }
            }
          }

          if (isCorrelated) {
            context.metadata = context.metadata || {};
            context.metadata.eventReceived = payload;
            delete context.waitingForEvent;
            delete context.metadata.waitingForEvent;

            await prisma.workflowExecution.update({
              where: { id: exec.id },
              data: { status: 'QUEUED', context }
            });

            await workflowQueue.add('executeWorkflow', { executionId: exec.id }, {
              jobId: `resume_${exec.id}_${Date.now()}`,
              removeOnComplete: true,
              removeOnFail: false
            });
          }
        }
      }
    } catch (resumeErr: any) {
      console.error(`[EventDispatcher] Error resuming waiting executions for ${eventType}:`, resumeErr.message);
    }

    // 3. Fallback / System Hooks (Sheet sync & Furniture baseline)
    try {
      // 3.1 Consolidated Operational Sheets Synchronisation with database idempotency
      const syncEvents = ['CUSTOMER_CREATED', 'ENQUIRY_CREATED', 'QUOTATION_CREATED', 'ORDER_CREATED', 'INVOICE_GENERATED'];
      if (syncEvents.includes(eventType)) {
        const { operationalSyncService } = require('../operations/OperationalSyncService');
        const entityMap: Record<string, any> = {
          'CUSTOMER_CREATED': 'CUSTOMER',
          'ENQUIRY_CREATED': 'ENQUIRY',
          'QUOTATION_CREATED': 'QUOTATION',
          'ORDER_CREATED': 'ORDER',
          'INVOICE_GENERATED': 'INVOICE'
        };
        const entityId = payload.customerId || payload.enquiryId || payload.quotationId || payload.orderId || payload.invoiceId;
        if (entityId) {
          operationalSyncService.enqueueSync(businessId, entityMap[eventType], entityId, eventType)
            .catch((err: any) => console.error("[EventDispatcher] Operational sync enqueue failed:", err.message));
        }
      }

      // 3.2 Furniture Order Confirmation to Invoice Pipeline
      // Only runs if not overridden by a custom tenant workflow handling this event
      if (!handledByDynamicWorkflow && (eventType === 'ORDER_CONFIRMED' || eventType === 'order.confirmed')) {
        const orderId = payload.orderId;
        
        // Check readiness
        const readiness = await invoiceService.checkReadiness(businessId, orderId);
        
        if (readiness.status === 'INVOICE_READINESS_PASSED') {
          const { EventBus } = require('../eventBus');
          EventBus.publish(businessId, 'INVOICE_READINESS_PASSED', { orderId });
          EventBus.publish(businessId, 'INVOICE_GENERATION_STARTED', { orderId });
          await invoiceService.generateInvoice(businessId, orderId);
        } else if (readiness.status === 'CUSTOMER_INFORMATION_REQUIRED') {
          // Send request with secure, expiring, order-scoped customer details form link
          const { CustomerFormService } = require('../order/CustomerFormService');
          
          const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true, business: true } });
          if (!order) return;

          const formToken = CustomerFormService.generateFormToken(businessId, orderId, order.customerId, 48);
          const formUrl = CustomerFormService.getFormUrl(formToken);
          const businessName = order.business?.name || 'our team';

          const body = `
            <p>Dear ${order.customer?.name || 'Customer'},</p>
            <p>Thank you for confirming your order with ${businessName}.</p>
            <p>Before we can generate and issue your invoice, we require your verified billing address.</p>
            <p>Please click the secure link below to complete your billing details (this business-scoped link expires in 48 hours):</p>
            <p><a href="${formUrl}" style="background-color: #2563eb; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px; display: inline-block;">Complete Your Billing Details</a></p>
            <p>If the button does not work, copy and paste this link in your browser:<br/><a href="${formUrl}">${formUrl}</a></p>
            <p>Best regards,<br/>${businessName}</p>
          `;
          
          try {
            const gmailAction = require('../../connectors/actions/gmail').gmailActions.find((a: any) => a.id === 'send_email');
            const creds = await prisma.integrationCredential.findFirst({ where: { integration: { businessId, provider: 'GMAIL', status: 'CONNECTED' } } });
            if (creds && gmailAction) {
              let accessToken = decrypt(creds.accessTokenEncrypted);
              if (creds.expiresAt && creds.expiresAt.getTime() < Date.now() + 60000 && creds.refreshTokenEncrypted) {
                const { google } = require('googleapis');
                const oauth2Client = new google.auth.OAuth2(
                  process.env.GOOGLE_CLIENT_ID,
                  process.env.GOOGLE_CLIENT_SECRET
                );
                oauth2Client.setCredentials({ refresh_token: decrypt(creds.refreshTokenEncrypted) });
                try {
                  const { credentials } = await oauth2Client.refreshAccessToken();
                  if (credentials.access_token) {
                    accessToken = credentials.access_token;
                    const updateData: any = { 
                      accessTokenEncrypted: encrypt(accessToken), 
                      expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null 
                    };
                    if (credentials.refresh_token) {
                      updateData.refreshTokenEncrypted = encrypt(credentials.refresh_token);
                    }
                    await prisma.integrationCredential.update({
                      where: { id: creds.id },
                      data: updateData
                    });
                  }
                } catch(refErr: any) { 
                  console.error("[EventDispatcher] Error refreshing token:", refErr.message || 'Unknown error');
                  const isAuthError =
                    refErr.response?.status === 400 ||
                    refErr.response?.status === 401 ||
                    refErr.message?.includes('invalid_grant');
                  if (isAuthError && creds.integrationId) {
                    await prisma.integration.update({
                      where: { id: creds.integrationId },
                      data: { status: 'RECONNECT_REQUIRED' }
                    }).catch(() => {});
                  }
                }
              }

              await gmailAction.execute({ accessToken }, {
                to: order?.customer?.email,
                subject: `Action Required: Billing Details for Order ${order?.orderNumber}`,
                body: body
              });
            } else {
              console.log(`[EventDispatcher] Could not send email. Gmail not connected. Form URL: ${formUrl}`);
            }
          } catch(e) {
            console.error("[EventDispatcher] Error sending customer form email:", e);
          }
          
          const existingStructured = (order.structuredData as any) || {};
          await prisma.order.update({
            where: { id: orderId },
            data: { 
              status: 'CUSTOMER_INFORMATION_REQUIRED',
              structuredData: {
                ...existingStructured,
                formToken,
                formUrl,
                formRequestedAt: new Date().toISOString()
              }
            }
          });

          await prisma.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: order.status,
              toStatus: 'CUSTOMER_INFORMATION_REQUIRED',
              reason: 'Sent expiring secure customer billing details form link via email'
            }
          });
        }
      }

      // 3.3 Auto-send invoice on generation (baseline)
      if (!handledByDynamicWorkflow && eventType === 'INVOICE_GENERATED') {
        await invoiceService.sendInvoice(businessId, payload.invoiceId);
      }
    } catch (err) {
      console.error(`[EventDispatcher] Error handling fallback for ${eventType}:`, err);
    }
  }
}
