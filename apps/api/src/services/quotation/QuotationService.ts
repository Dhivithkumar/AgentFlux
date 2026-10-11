import { prisma, QuotationStatus } from '@agent-flux/database';
import { GovernanceService } from '../governance/GovernanceService';
import { ApprovalService } from '../governance/ApprovalService';

export class QuotationService {
  
  async createQuotation(businessId: string, data: any) {
    // Deterministic Financial Calculation
    let subtotal = 0;
    const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
    
    const processedItems = lineItems.map((item: any) => {
      const q = Number(item.quantity) || 0;
      const p = Number(item.unitPrice) || 0;
      if (q < 0) throw new Error('Quantity cannot be negative');
      if (p < 0) throw new Error('Unit price cannot be negative');
      const d = Number(item.discount) || 0;
      if (d < 0) throw new Error('Discount cannot be negative');
      const t = Number(item.taxRate) || 0;
      if (t < 0) throw new Error('Tax rate cannot be negative');

      const lineSub = q * p;
      const afterDiscount = Math.max(0, lineSub - d);
      const taxAmt = afterDiscount * (t / 100);
      const lineTotal = afterDiscount + taxAmt;

      subtotal += lineSub;
      return { ...item, lineTotal };
    });

    const discountAmount = processedItems.reduce((acc: number, curr: any) => acc + (Number(curr.discount) || 0), 0);
    const taxAmount = processedItems.reduce((acc: number, curr: any) => acc + (curr.lineTotal - Math.max(0, (Number(curr.quantity)*Number(curr.unitPrice)) - (Number(curr.discount)||0))), 0);
    const totalAmount = subtotal - discountAmount + taxAmount;

    // Take snapshots
    const customer = await prisma.customer.findUnique({ where: { id: data.customerId, businessId } });
    const business = await prisma.business.findUnique({ where: { id: businessId } });

    const seq = await prisma.documentSequence.upsert({
      where: { businessId_type: { businessId, type: 'QUOTATION' } },
      update: { lastValue: { increment: 1 } },
      create: { businessId, type: 'QUOTATION', lastValue: 1 }
    });
    const quotationNumber = `QUO-${seq.lastValue.toString().padStart(6, '0')}`;

    const quotation = await prisma.quotation.create({
      data: {
        businessId,
        customerId: data.customerId,
        orderId: data.orderId,
        quotationNumber,
        status: 'DRAFT',
        subtotal,
        discountAmount,
        taxAmount,
        totalAmount,
        currency: business?.currency || 'INR',
        lineItems: processedItems,
        customerSnapshot: customer ? JSON.parse(JSON.stringify(customer)) : null,
        businessSnapshot: business ? JSON.parse(JSON.stringify(business)) : null,
        gmailThreadId: data.gmailThreadId,
      }
    });

    const { operationalSyncPoller } = require('../queue/operationalSyncPoller');
    operationalSyncPoller.enqueue(businessId, 'QUOTATION', quotation.id, 'CREATE').catch(console.error);

    return quotation;
  }

  async getQuotation(businessId: string, id: string) {
    return prisma.quotation.findUnique({
      where: { id, businessId },
      include: { customer: true, order: true }
    });
  }

  async updateStatus(businessId: string, id: string, status: QuotationStatus, requestedById?: string) {
    const quotation = await prisma.quotation.findUnique({ where: { id, businessId } });
    if (!quotation) throw new Error('Quotation not found');

    if (status === 'SENT' && requestedById) {
      const discountPercentage = quotation.totalAmount ? (quotation.discountAmount / (quotation.subtotal || 1)) * 100 : 0;
      
      const context = {
        quotation: {
          grandTotal: quotation.totalAmount,
          discountPercentage,
          currency: quotation.currency
        }
      };

      const gov = await GovernanceService.evaluateAction(businessId, 'QUOTATION_SEND', context);
      
      if (gov.requiresApproval) {
        // check if there's already an active approved request
        const existingApprovals = await prisma.approvalRequest.findMany({
          where: { businessId, resourceId: id, actionType: 'QUOTATION_SEND', status: 'APPROVED' }
        });
        if (existingApprovals.length === 0) {
          const activePending = await prisma.approvalRequest.findFirst({
            where: { businessId, resourceId: id, actionType: 'QUOTATION_SEND', status: 'PENDING' }
          });
          
          if (!activePending) {
             await ApprovalService.createApprovalRequest(
               businessId,
               requestedById,
               'QUOTATION_SEND',
               'Quotation',
               id,
               context,
               gov.rule,
               'System generated approval for QUOTATION_SEND'
             );
          }
          throw new Error('APPROVAL_REQUIRED');
        }
      }
    }

    const updated = await prisma.quotation.update({
      where: { id, businessId },
      data: { status }
    });

    const { operationalSyncPoller } = require('../queue/operationalSyncPoller');
    operationalSyncPoller.enqueue(businessId, 'QUOTATION', updated.id, 'STATUS_UPDATE').catch(console.error);

    return updated;
  }

  async sendQuotation(businessId: string, id: string, requestedById?: string) {
    const quotation = await prisma.quotation.findUnique({
      where: { id, businessId },
      include: { customer: true, business: true }
    });
    if (!quotation) throw new Error('Quotation not found');

    if (quotation.status === 'SENT') {
      return quotation; // Idempotent
    }

    // 1. Governance approval check
    if (requestedById) {
      const discountPercentage = quotation.totalAmount ? (quotation.discountAmount / (quotation.subtotal || 1)) * 100 : 0;
      const context = {
        quotation: {
          grandTotal: quotation.totalAmount,
          discountPercentage,
          currency: quotation.currency
        }
      };

      const gov = await GovernanceService.evaluateAction(businessId, 'QUOTATION_SEND', context);
      if (gov.requiresApproval) {
        const existingApprovals = await prisma.approvalRequest.findMany({
          where: { businessId, resourceId: id, actionType: 'QUOTATION_SEND', status: 'APPROVED' }
        });
        if (existingApprovals.length === 0) {
          throw new Error('APPROVAL_REQUIRED');
        }
      }
    }

    // 2. Ensure Document is generated
    let generatedDocId = quotation.generatedDocumentId;
    if (!generatedDocId) {
      const { documentGenerationService } = require('../documents/DocumentGenerationService');
      const doc = await documentGenerationService.generateDocument(businessId, 'QUOTATION', quotation.id);
      generatedDocId = doc.id || doc;
    }

    const doc = generatedDocId
      ? await prisma.knowledgeDocument.findUnique({
          where: { id: generatedDocId }
        })
      : null;

    const fs = require('fs');
    const path = require('path');
    let pdfBase64 = '';
    if (doc?.storagePath) {
      let pdfPath = doc.storagePath;
      if (pdfPath.startsWith('business/')) {
        pdfPath = path.join(process.cwd(), 'uploads', pdfPath.substring(9));
      }
      if (fs.existsSync(pdfPath)) {
        pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
      }
    }

    // 3. Gmail Dispatch
    const integration = await prisma.integration.findFirst({
      where: { businessId, provider: 'GMAIL', status: 'CONNECTED' }
    });
    if (!integration) {
      let deliveryMeta = { attemptCount: 1, deliveryStatus: 'FAILED', lastError: 'Gmail integration not connected' };
      await prisma.quotation.update({
        where: { id: quotation.id },
        data: { notes: JSON.stringify(deliveryMeta) }
      });
      throw new Error('GMAIL_SEND_FAILED: Gmail integration not connected');
    }

    const { decrypt, encrypt } = require('../encryption');
    const creds = await prisma.integrationCredential.findUnique({ where: { integrationId: integration.id } });
    if (!creds || !creds.accessTokenEncrypted) throw new Error('Gmail credentials not found');

    let accessToken = decrypt(creds.accessTokenEncrypted);
    const { gmailActions } = require('../../connectors/actions/gmail');
    const sendEmailAction = gmailActions.find((a: any) => a.id === 'send_email');
    if (!sendEmailAction) throw new Error('send_email action not found');

    const customerName = (quotation.customerSnapshot as any)?.name || quotation.customer?.name || 'Customer';
    const customerEmail = (quotation.customerSnapshot as any)?.email || quotation.customer?.email;
    const businessName = quotation.business?.name || 'Our Team';

    const subject = `Quotation ${quotation.quotationNumber} – ${businessName}`;
    const body = `
      <p>Dear ${customerName},</p>
      <p>Thank you for your enquiry. Please find attached our quotation <strong>${quotation.quotationNumber}</strong>.</p>
      <p>Total Amount: ${quotation.currency} ${quotation.totalAmount.toLocaleString()}</p>
      <p>Please review the attached PDF document and let us know if you wish to proceed.</p>
      <p>Best regards,<br/>${businessName}</p>
    `;

    try {
      const sendResult = await sendEmailAction.execute(
        { businessId, workflowId: '', executionId: '', accessToken },
        {
          to: customerEmail,
          subject,
          body,
          inReplyTo: quotation.gmailMessageId,
          threadId: quotation.gmailThreadId,
          attachments: pdfBase64 ? [
            {
              filename: `${quotation.quotationNumber}.pdf`,
              mimeType: 'application/pdf',
              content: pdfBase64
            }
          ] : []
        }
      );

      const deliveryMeta = {
        attemptCount: 1,
        deliveryStatus: 'DELIVERED',
        sentAt: new Date().toISOString(),
        lastError: null
      };

      const updated = await prisma.quotation.update({
        where: { id: quotation.id },
        data: {
          status: 'SENT',
          gmailMessageId: sendResult?.id || quotation.gmailMessageId,
          notes: JSON.stringify(deliveryMeta)
        }
      });

      const { operationalSyncPoller } = require('../queue/operationalSyncPoller');
      operationalSyncPoller.enqueue(businessId, 'QUOTATION', updated.id, 'STATUS_UPDATE').catch(console.error);

      return updated;
    } catch (err: any) {
      const deliveryMeta = {
        attemptCount: 1,
        deliveryStatus: 'FAILED',
        lastError: err.message
      };

      await prisma.quotation.update({
        where: { id: quotation.id },
        data: { notes: JSON.stringify(deliveryMeta) }
      });

      throw new Error(`GMAIL_SEND_FAILED: ${err.message}`);
    }
  }
}

export const quotationService = new QuotationService();
