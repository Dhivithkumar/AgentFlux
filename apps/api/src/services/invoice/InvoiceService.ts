import { prisma, InvoiceStatus } from '@agent-flux/database';
import { EventBus } from '../eventBus';
import { DocumentGenerationService } from '../documents/DocumentGenerationService';
import { getConnectorProvider } from '../../connectors/registry';
import { randomBytes } from 'crypto';
import { gmailActions } from '../../connectors/actions/gmail';
import { google } from 'googleapis';
import { decrypt, encrypt } from '../encryption';

export class InvoiceService {
  private docGenService: DocumentGenerationService;

  constructor() {
    this.docGenService = new DocumentGenerationService();
  }

  async checkReadiness(businessId: string, orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, businessId },
      include: { customer: true }
    });

    if (!order) throw new Error('Order not found');

    const business = await prisma.business.findUnique({
      where: { id: businessId }
    });

    if (!business) throw new Error('Business Profile not found');

    // Business Profile checks
    if (!business.name || !business.addressLine1 || !business.gstin) {
      return { status: 'BUSINESS_PROFILE_INCOMPLETE', message: 'Business Profile is missing required fields (name, address, GSTIN)' };
    }

    if (business.defaultTaxRate === null || business.defaultTaxRate === undefined) {
      return { status: 'TAX_CONFIGURATION_REQUIRED', message: 'Default tax rate is missing in Business Profile' };
    }

    // Customer checks
    const customer = order.customer;
    const customerData = customer.customData as any || {};
    const billingAddress = (order as any).billingAddress || customerData.billingAddress;
    
    if (!customer.name || !customer.email || !billingAddress) {
      return { status: 'CUSTOMER_INFORMATION_REQUIRED', message: 'Customer name, email, or billing address is missing', missingFields: ['billingAddress'] };
    }

    // Template check
    const templateDoc = await prisma.knowledgeDocument.findFirst({
      where: { 
        businessId, 
        filename: { contains: 'Invoice_Template', mode: 'insensitive' }, 
        mimeType: { contains: 'wordprocessingml.document' } 
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!templateDoc) {
      return { status: 'INVOICE_TEMPLATE_NOT_FOUND', message: 'Invoice template not found in Knowledge Centre' };
    }

    return { status: 'INVOICE_READINESS_PASSED' };
  }

  async generateInvoice(businessId: string, orderId: string) {
    const readiness = await this.checkReadiness(businessId, orderId);
    if (readiness.status !== 'INVOICE_READINESS_PASSED') {
      throw new Error(readiness.status);
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId, businessId },
      include: { customer: true, items: true }
    });

    if (!order) throw new Error('Order not found');
    const business = await prisma.business.findUnique({ where: { id: businessId } });

    // Financial Validation Engine (Deterministic)
    let calculatedSubtotal = 0;
    
    // Validate that order snapshot totals are correct
    const items = order.items || [];
    for (const item of items) {
      const lineSub = (item.quantity * item.unitPrice) - (item.discount || 0);
      calculatedSubtotal += lineSub;
    }
    
    if (Math.abs((order.subtotal || 0) - calculatedSubtotal) > 1) {
       throw new Error(`FINANCIAL_VALIDATION_FAILED: Order subtotal (${order.subtotal}) does not match calculated line items subtotal (${calculatedSubtotal}).`);
    }

    const grandTotal = (order.subtotal || 0) - (order.discount || 0) + (order.tax || 0);

    // Check against Order's accepted amounts (allowing 1 rupee/cent rounding difference)
    if (Math.abs((order.totalAmount || 0) - grandTotal) > 1) {
       throw new Error(`FINANCIAL_VALIDATION_FAILED: Order total (${order.totalAmount}) does not match calculated grand total (${grandTotal}).`);
    }

    const subtotal = order.subtotal || 0;
    const taxAmount = order.tax || 0;

    // Generate Invoice Number
    const count = await prisma.invoice.count({ where: { businessId } });
    const invoicePrefix = business?.invoicePrefix || 'AF-INV-';
    const invoiceNumber = `${invoicePrefix}${(count + 1).toString().padStart(6, '0')}`;

    // Due Date Calculation
    const dueDays = business?.defaultInvoiceDueDays || 7;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    // Idempotency: Check if an invoice already exists for this order
    let invoice = await prisma.invoice.findFirst({
      where: { businessId, orderId }
    });

    if (invoice) {
      if (invoice.status === 'GENERATED' || invoice.status === 'SENT' || invoice.status === 'PAYMENT_PENDING' || invoice.status === 'PAID') {
        console.log(`[InvoiceService] Idempotent trigger: Invoice ${invoice.id} already exists and is valid for order ${orderId}`);
        return invoice.id;
      }
      // If it exists but failed PDF generation (e.g., DRAFT), we will update it.
      invoice = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'DRAFT',
          currency: order.currency || 'INR',
          subtotal: subtotal,
          discountAmount: order.discount || 0,
          taxAmount: taxAmount,
          totalAmount: grandTotal,
          outstandingAmount: grandTotal,
          lineItems: JSON.parse(JSON.stringify(order.items)),
          customerSnapshot: JSON.parse(JSON.stringify(order.customer)),
          businessSnapshot: JSON.parse(JSON.stringify(business))
        }
      });
    } else {
      // Create Invoice Record
      invoice = await prisma.invoice.create({
        data: {
          businessId,
          customerId: order.customerId,
          orderId: order.id,
          quotationId: order.quotationId,
          invoiceNumber,
          status: 'DRAFT',
          invoiceDate: new Date(),
          dueDate,
          currency: order.currency || 'INR',
          subtotal: subtotal,
          discountAmount: order.discount || 0,
          taxAmount: taxAmount,
          totalAmount: grandTotal,
          outstandingAmount: grandTotal,
          lineItems: JSON.parse(JSON.stringify(order.items)), // Snapshot
          customerSnapshot: JSON.parse(JSON.stringify(order.customer)), // Snapshot
          businessSnapshot: JSON.parse(JSON.stringify(business)) // Snapshot
        }
      });
    }

    // Generate PDF Document
    try {
      const generatedDoc = await this.docGenService.generateDocument(businessId, 'INVOICE', invoice.id);
      const generatedDocId = (generatedDoc as any).id || generatedDoc;
      
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { 
          status: 'GENERATED',
          generatedDocumentId: generatedDocId
        }
      });
      
      EventBus.publish(businessId, 'INVOICE_GENERATED', { invoiceId: invoice.id });
      
      return invoice.id;
    } catch (e: any) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'DRAFT', notes: 'PDF generation failed: ' + e.message }
      });
      throw e;
    }
  }

  async syncToSheets(businessId: string, invoiceId: string) {
    const { operationalSyncPoller } = require('../queue/operationalSyncPoller');
    operationalSyncPoller.enqueue(businessId, 'INVOICE', invoiceId, 'SYNC').catch(console.error);
  }

  async sendInvoice(businessId: string, invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId, businessId },
      include: { customer: true, business: true }
    });

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'SENT' || invoice.status === 'PARTIALLY_PAID' || invoice.status === 'PAID') {
      return; // Idempotency
    }

    if (!invoice.generatedDocumentId) throw new Error('PDF not generated yet');

    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: invoice.generatedDocumentId, businessId }
    });

    if (!doc || !doc.storagePath) throw new Error('PDF file missing');

    const fs = require('fs');
    const path = require('path');
    
    let pdfPath = doc.storagePath;
    if (pdfPath.startsWith('business/')) {
        pdfPath = path.join(process.cwd(), 'uploads', pdfPath.substring(9));
    }

    if (!fs.existsSync(pdfPath)) throw new Error('PDF file not found on disk');

    const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');

    const integration = await prisma.integration.findFirst({
        where: { businessId, provider: 'GMAIL', status: 'CONNECTED' }
    });
    if (!integration) throw new Error('Gmail integration not connected');

    const creds = await prisma.integrationCredential.findUnique({ where: { integrationId: integration.id } });
    if (!creds || !creds.accessTokenEncrypted) throw new Error('Gmail credentials not found');

    let accessToken = decrypt(creds.accessTokenEncrypted);

    if (creds.expiresAt && creds.expiresAt.getTime() < Date.now() + 60000 && creds.refreshTokenEncrypted) {
         const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
         );
         oauth2Client.setCredentials({ refresh_token: decrypt(creds.refreshTokenEncrypted) });
         try {
             const { credentials } = await oauth2Client.refreshAccessToken();
             if (credentials.access_token) {
                 accessToken = credentials.access_token;
                 await prisma.integrationCredential.update({
                     where: { id: creds.id },
                     data: {
                         accessTokenEncrypted: encrypt(accessToken),
                         expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null
                     }
                 });
             }
         } catch(refErr: any) {
             console.error("[InvoiceService] Token refresh failed:", refErr.message);
         }
    }

    const sendEmailAction = gmailActions.find(a => a.id === 'send_email');
    if (!sendEmailAction) throw new Error('send_email action not found');

    const to = invoice.customerSnapshot ? (invoice.customerSnapshot as any).email : invoice.customer?.email;
    const customerName = invoice.customerSnapshot ? (invoice.customerSnapshot as any).name : invoice.customer?.name;
    const businessName = invoice.business?.displayName || invoice.business?.name;
    
    const subject = `Invoice ${invoice.invoiceNumber} – ${businessName}`;
    const body = `
      <p>Dear ${customerName},</p>
      <p>Thank you for confirming your order with ${businessName}.</p>
      <p>Please find attached your invoice.</p>
      <ul>
        <li>Invoice Number: ${invoice.invoiceNumber}</li>
        <li>Amount Due: ${invoice.totalAmount}</li>
        <li>Due Date: ${invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : ''}</li>
      </ul>
      <p>Please refer to the attached PDF for the complete invoice details.</p>
      <p>Best regards,<br/>${businessName} Team</p>
    `;

    try {
      await sendEmailAction.execute(
        { businessId, workflowId: '', executionId: '', accessToken },
        {
          to,
          subject,
          body,
          attachments: [
            {
              filename: `${invoice.invoiceNumber}.pdf`,
              mimeType: 'application/pdf',
              content: pdfBase64
            }
          ]
        }
      );

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'SENT' }
      });

      if (invoice.orderId) {
        await prisma.order.update({
          where: { id: invoice.orderId },
          data: { status: 'INVOICE_SENT' } // or PAYMENT_PENDING based on your state machine
        });
      }

      EventBus.publish(businessId, 'INVOICE_SENT', { invoiceId: invoice.id });
      
      // Async Sync to Sheets
      this.syncToSheets(businessId, invoiceId).catch(console.error);

    } catch (e: any) {
      throw new Error(`GMAIL_SEND_FAILED: ${e.message}`);
    }
  }

  async getInvoice(businessId: string, id: string) {
    return prisma.invoice.findUnique({
      where: { id, businessId },
      include: { customer: true, order: true }
    });
  }

  async updateStatus(businessId: string, id: string, status: InvoiceStatus) {
    return prisma.invoice.update({
      where: { id, businessId },
      data: { status }
    });
  }

  async createInvoice(businessId: string, data: any) {
    return this.generateInvoice(businessId, data.orderId);
  }

  async convertFromQuotation(businessId: string, quotationId: string) {
     const order = await prisma.order.findFirst({
        where: { businessId, quotationId }
     });
     if (!order) throw new Error("Order not found for this quotation. Cannot generate invoice without an order.");
     return this.generateInvoice(businessId, order.id);
  }
}

export const invoiceService = new InvoiceService();
