import { prisma, InvoiceStatus } from '@agent-flux/database';
import { EventBus } from '../eventBus';
import { DocumentGenerationService } from '../documents/DocumentGenerationService';
import { getConnectorProvider } from '../../connectors/registry';
import { randomBytes } from 'crypto';

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
    if (!customer.name || !customer.email || !order.billingAddress) {
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
    let subtotal = 0;
    const taxRate = business?.defaultTaxRate || 0;
    
    // Validate that order snapshot totals are correct
    const items = order.items || [];
    for (const item of items) {
      const lineSub = (item.quantity * item.unitPrice) - (item.discount || 0);
      subtotal += lineSub;
    }
    
    const taxAmount = subtotal * (taxRate / 100);
    const grandTotal = subtotal + taxAmount;

    // Check against Order's accepted amounts (allowing 1 rupee/cent rounding difference)
    if (Math.abs((order.totalAmount || 0) - grandTotal) > 1) {
       throw new Error('FINANCIAL_VALIDATION_FAILED: Order total does not match calculated total from line items and current tax rate.');
    }

    // Generate Invoice Number
    const count = await prisma.invoice.count({ where: { businessId } });
    const invoicePrefix = business?.invoicePrefix || 'AF-INV-';
    const invoiceNumber = `${invoicePrefix}${(count + 1).toString().padStart(6, '0')}`;

    // Due Date Calculation
    const dueDays = business?.defaultInvoiceDueDays || 7;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    // Create Invoice Record
    const invoice = await prisma.invoice.create({
      data: {
        businessId,
        customerId: order.customerId,
        orderId: order.id,
        quotationId: order.quotationId,
        invoiceNumber,
        status: 'GENERATING',
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
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId, businessId },
      include: { customer: true }
    });
    if (!invoice) throw new Error('Invoice not found');

    const config = await prisma.operationalSheetConfig.findFirst({
      where: { businessId, status: 'SYNCED' }
    });

    if (!config) return; // No sheet connected

    try {
      const sheetsProvider = getConnectorProvider('GOOGLE_SHEETS');
      
      const rowData = [
        invoice.invoiceNumber,
        invoice.invoiceDate.toISOString().split('T')[0],
        invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : '',
        invoice.orderId || '',
        invoice.quotationId || '',
        invoice.customer?.name || '',
        invoice.customer?.email || '',
        invoice.customer?.phone || '',
        invoice.subtotal.toString(),
        invoice.discountAmount.toString(),
        invoice.taxAmount.toString(),
        invoice.totalAmount.toString(),
        invoice.paidAmount.toString(),
        invoice.outstandingAmount.toString(),
        invoice.status,
        new Date().toISOString()
      ];

      await (sheetsProvider as any).appendRow(businessId, config.spreadsheetId, 'Invoices!A:P', rowData);
    } catch (e) {
      console.error('Failed to sync invoice to sheets, keeping valid state', e);
      // Mark as SHEETS_SYNC_PENDING logic in audit/sync jobs
    }
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

    const gmailProvider = getConnectorProvider('GMAIL');
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
      await (gmailProvider as any).sendEmail(businessId, {
        to,
        subject,
        bodyHtml: body,
        attachments: [
          {
            filename: `${invoice.invoiceNumber}.pdf`,
            mimeType: 'application/pdf',
            dataBase64: pdfBase64
          }
        ]
      });

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
}

export const invoiceService = new InvoiceService();
