import { prisma } from '@agent-flux/database';
import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';
import {
  OperationalWorksheetSchema,
  OperationalRow,
  OperationalEntityType,
  SetupRequiredError,
  PermissionDeniedError,
  ColumnConflictError
} from './types';
import { deduplicateHeaders } from './utils';

export class OperationalSyncService {
  /**
   * Returns explicit worksheet schemas for all 6 operational entities.
   */
  async getBusinessSchema(businessId: string): Promise<OperationalWorksheetSchema[]> {
    const fieldDefs = await prisma.workflowFieldDefinition.findMany({
      where: { businessId, active: true },
      orderBy: { displayOrder: 'asc' }
    });

    const dynamicFields = fieldDefs.map((f) => f.label);

    const customersSchema: OperationalWorksheetSchema = {
      name: 'Customers',
      idField: 'Customer ID',
      headers: deduplicateHeaders([
        'Customer ID',
        'Business ID',
        'Customer Name',
        'Phone',
        'Email',
        'Billing Address',
        'Delivery Address',
        'Status',
        'Total Enquiries',
        'Total Orders',
        'Total Order Value',
        'Last Contact',
        'Drive Document URL',
        'Notes',
        'Created At',
        'Updated At',
        'Last Synced At'
      ])
    };

    const enquiriesSchema: OperationalWorksheetSchema = {
      name: 'Enquiries',
      idField: 'Enquiry ID',
      headers: deduplicateHeaders([
        'Enquiry ID',
        'Business ID',
        'Date',
        'Customer ID',
        'Customer Name',
        'Phone',
        'Email',
        'Source',
        'Subject',
        'Status',
        'Assigned To',
        'Next Action',
        'Summary',
        'Raw Message',
        'Drive Document URL',
        'Notes',
        'Created At',
        'Updated At',
        'Last Synced At',
        ...dynamicFields
      ])
    };

    const followupsSchema: OperationalWorksheetSchema = {
      name: 'Followups',
      idField: 'Followup ID',
      headers: deduplicateHeaders([
        'Followup ID',
        'Business ID',
        'Enquiry ID',
        'Customer ID',
        'Customer Name',
        'Phone',
        'Followup Date',
        'Reason',
        'Assigned To',
        'Status',
        'Drive Document URL',
        'Notes',
        'Created At',
        'Updated At',
        'Last Synced At'
      ])
    };

    const ordersSchema: OperationalWorksheetSchema = {
      name: 'Orders',
      idField: 'Order ID',
      headers: deduplicateHeaders([
        'Order ID',
        'Order Number',
        'Business ID',
        'Customer ID',
        'Customer Name',
        'Phone',
        'Email',
        'Linked Enquiry ID',
        'Quotation ID',
        'Status',
        'Source',
        'Subtotal',
        'Discount',
        'Tax',
        'Total',
        'Currency',
        'Scheduled At',
        'Due At',
        'Completed At',
        'Assigned To',
        'Drive Document URL',
        'Notes',
        'Created At',
        'Updated At',
        'Last Synced At',
        ...dynamicFields
      ])
    };

    const quotationsSchema: OperationalWorksheetSchema = {
      name: 'Quotations',
      idField: 'Quotation ID',
      headers: deduplicateHeaders([
        'Quotation ID',
        'Quotation Number',
        'Business ID',
        'Customer ID',
        'Customer Name',
        'Phone',
        'Email',
        'Order ID',
        'Status',
        'Subtotal',
        'Discount Amount',
        'Tax Amount',
        'Grand Total',
        'Currency',
        'Valid Until',
        'Drive Document URL',
        'Notes',
        'Created At',
        'Updated At',
        'Last Synced At'
      ])
    };

    const invoicesSchema: OperationalWorksheetSchema = {
      name: 'Invoices',
      idField: 'Invoice ID',
      headers: deduplicateHeaders([
        'Invoice ID',
        'Invoice Number',
        'Business ID',
        'Invoice Date',
        'Due Date',
        'Order ID',
        'Quotation ID',
        'Customer ID',
        'Customer Name',
        'Email',
        'Phone',
        'Subtotal',
        'Discount Amount',
        'Tax Amount',
        'Total Amount',
        'Paid Amount',
        'Outstanding Amount',
        'Status',
        'Payment Status',
        'Drive Document URL',
        'Notes',
        'Created At',
        'Updated At',
        'Last Synced At'
      ])
    };

    return [
      customersSchema,
      enquiriesSchema,
      followupsSchema,
      ordersSchema,
      quotationsSchema,
      invoicesSchema
    ];
  }

  /**
   * Validates that Google Sheets operational sync is properly configured and owned by the business.
   * Throws an actionable SetupRequiredError if not configured.
   */
  async validateConfig(businessId: string): Promise<{
    config: any;
    integration: any;
    adapter: GoogleSheetsAdapter;
  }> {
    const config = await prisma.operationalSheetConfig.findUnique({
      where: { businessId }
    });

    if (!config || !config.spreadsheetId) {
      throw new SetupRequiredError(
        `SETUP_REQUIRED: Google Sheets operational sync is not configured for business ${businessId}. Run sheet setup first.`
      );
    }

    const integration = await prisma.integration.findFirst({
      where: {
        id: config.integrationId,
        businessId,
        provider: 'GOOGLE_SHEETS'
      }
    });

    if (!integration) {
      throw new SetupRequiredError(
        `SETUP_REQUIRED: Google Sheets integration ${config.integrationId} does not belong to business ${businessId}.`
      );
    }

    if (integration.status !== 'CONNECTED') {
      throw new PermissionDeniedError(
        `Google Sheets integration is ${integration.status}. Reconnection required.`
      );
    }

    const adapter = new GoogleSheetsAdapter(config.integrationId, businessId);
    return { config, integration, adapter };
  }

  /**
   * Explicit setup operation: creates a new spreadsheet and initializes all 6 schemas.
   */
  async initializeConfig(businessId: string, integrationId: string): Promise<any> {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new Error('Business not found');

    const integration = await prisma.integration.findFirst({
      where: { id: integrationId, businessId, provider: 'GOOGLE_SHEETS' }
    });
    if (!integration || integration.status !== 'CONNECTED') {
      throw new PermissionDeniedError(
        'Google Sheets integration must be connected before initializing operational sync.'
      );
    }

    const schemas = await this.getBusinessSchema(businessId);
    const adapter = new GoogleSheetsAdapter(integrationId, businessId);
    const spreadsheetName = `${business.name} Operations`;

    let config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });

    if (!config || !config.spreadsheetId) {
      const result = await adapter.initialize(spreadsheetName, schemas);

      if (config) {
        config = await prisma.operationalSheetConfig.update({
          where: { businessId },
          data: {
            integrationId,
            spreadsheetId: result.spreadsheetId,
            spreadsheetName,
            worksheetMappings: result.sheetMappings,
            status: 'SYNCED',
            lastSyncedAt: new Date(),
            errorMessage: null
          }
        });
      } else {
        config = await prisma.operationalSheetConfig.create({
          data: {
            businessId,
            integrationId,
            spreadsheetId: result.spreadsheetId,
            spreadsheetName,
            worksheetMappings: result.sheetMappings,
            status: 'SYNCED',
            lastSyncedAt: new Date()
          }
        });
      }
    } else {
      // Reconcile headers in existing configured sheet
      for (const schema of schemas) {
        await adapter.ensureWorksheetAndHeaders(config.spreadsheetId, schema);
      }
      config = await prisma.operationalSheetConfig.update({
        where: { businessId },
        data: {
          integrationId,
          status: 'SYNCED',
          errorMessage: null,
          lastSyncedAt: new Date()
        }
      });
    }

    // Trigger full backfill asynchronously
    this.syncAll(businessId).catch(console.error);

    return config;
  }

  /**
   * Explicit setup operation: connects an existing Google spreadsheet.
   */
  async connectSpreadsheet(
    businessId: string,
    integrationId: string,
    spreadsheetId: string,
    spreadsheetName: string
  ): Promise<any> {
    const integration = await prisma.integration.findFirst({
      where: { id: integrationId, businessId, provider: 'GOOGLE_SHEETS' }
    });
    if (!integration || integration.status !== 'CONNECTED') {
      throw new PermissionDeniedError(
        'Google Sheets integration must be connected to this business.'
      );
    }

    const adapter = new GoogleSheetsAdapter(integrationId, businessId);
    const hasAccess = await adapter.verifyAccess(spreadsheetId);
    if (!hasAccess) {
      throw new PermissionDeniedError(
        `Cannot access spreadsheet ${spreadsheetId}. Verify permissions.`
      );
    }

    // Ensure all 6 schemas and headers exist in the connected spreadsheet
    const schemas = await this.getBusinessSchema(businessId);
    const worksheetMappings: Record<string, any> = {};

    for (const schema of schemas) {
      const sheetId = await adapter.ensureWorksheetAndHeaders(spreadsheetId, schema);
      worksheetMappings[schema.name] = {
        worksheetId: sheetId,
        worksheetName: schema.name,
        columnMapping: {}
      };
    }

    const existing = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
    if (existing) {
      return prisma.operationalSheetConfig.update({
        where: { businessId },
        data: {
          integrationId,
          spreadsheetId,
          spreadsheetName,
          status: 'SYNCED',
          worksheetMappings,
          errorMessage: null,
          lastSyncedAt: new Date()
        }
      });
    }

    return prisma.operationalSheetConfig.create({
      data: {
        businessId,
        integrationId,
        spreadsheetId,
        spreadsheetName,
        status: 'SYNCED',
        worksheetMappings,
        lastSyncedAt: new Date()
      }
    });
  }

  async saveMapping(
    businessId: string,
    entityType: string,
    worksheetId: string,
    worksheetName: string,
    columnMapping: Record<string, string>
  ): Promise<any> {
    const config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
    if (!config) throw new SetupRequiredError('Google Sheets not connected for this business');

    const mappings = (config.worksheetMappings as Record<string, any>) || {};
    mappings[entityType] = {
      worksheetId,
      worksheetName,
      columnMapping
    };

    return prisma.operationalSheetConfig.update({
      where: { businessId },
      data: { worksheetMappings: mappings }
    });
  }

  async disconnect(businessId: string): Promise<void> {
    await prisma.operationalSheetConfig.delete({ where: { businessId } }).catch(() => {});
  }

  /**
   * Helper to resolve Drive document URL from KnowledgeDocument
   */
  private async resolveDriveUrl(generatedDocumentId?: string | null): Promise<string> {
    if (!generatedDocumentId) return '';
    try {
      const doc = await prisma.knowledgeDocument.findUnique({
        where: { id: generatedDocumentId }
      });
      if (!doc) return '';
      if (doc.externalUrl) return doc.externalUrl;
      if (doc.externalId) return `https://drive.google.com/file/d/${doc.externalId}/view`;
      return '';
    } catch {
      return '';
    }
  }

  // ==========================================
  // ROW DATA BUILDERS FOR ALL 6 ENTITIES
  // ==========================================

  async buildCustomerRow(businessId: string, customerId: string): Promise<OperationalRow | null> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId, businessId },
      include: { enquiries: true, orders: true }
    });
    if (!customer) return null;

    const customData = (customer.customData as any) || {};
    const totalOrderValue = customer.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    const data: Record<string, any> = {
      'Customer ID': customer.id,
      'Business ID': customer.businessId,
      'Customer Name': customer.name || '',
      'Phone': customer.phone || '',
      'Email': customer.email || '',
      'Billing Address': customData.billingAddress || customData.address || '',
      'Delivery Address': customData.deliveryAddress || customData.location || '',
      'Status': customer.status,
      'Total Enquiries': customer.enquiries.length,
      'Total Orders': customer.orders.length,
      'Total Order Value': totalOrderValue,
      'Last Contact': customer.updatedAt.toISOString(),
      'Drive Document URL': customData.driveDocumentUrl || customData.driveUrl || '',
      'Notes': customData.notes || '',
      'Created At': customer.createdAt.toISOString(),
      'Updated At': customer.updatedAt.toISOString(),
      'Last Synced At': new Date().toISOString()
    };

    return { id: customer.id, data };
  }

  async buildEnquiryRow(businessId: string, enquiryId: string): Promise<OperationalRow | null> {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId, businessId },
      include: { customer: true, assignee: true }
    });
    if (!enquiry) return null;

    const structured = (enquiry.structuredData as any) || {};
    const fieldDefs = await prisma.workflowFieldDefinition.findMany({
      where: { businessId, active: true }
    });

    const data: Record<string, any> = {
      'Enquiry ID': enquiry.id,
      'Business ID': enquiry.businessId,
      'Date': enquiry.createdAt.toISOString(),
      'Customer ID': enquiry.customerId,
      'Customer Name': enquiry.customer?.name || '',
      'Phone': enquiry.customer?.phone || '',
      'Email': enquiry.customer?.email || '',
      'Source': enquiry.source,
      'Subject': enquiry.subject || '',
      'Status': enquiry.status,
      'Assigned To': enquiry.assignee?.name || '',
      'Next Action': enquiry.nextAction || '',
      'Summary': enquiry.summary || '',
      'Raw Message': enquiry.rawMessage || '',
      'Drive Document URL': structured.driveDocumentUrl || structured.driveUrl || '',
      'Notes': structured.notes || '',
      'Created At': enquiry.createdAt.toISOString(),
      'Updated At': enquiry.updatedAt.toISOString(),
      'Last Synced At': new Date().toISOString()
    };

    for (const def of fieldDefs) {
      if (structured[def.fieldKey] !== undefined) {
        data[def.label] = structured[def.fieldKey];
      }
    }

    return { id: enquiry.id, data };
  }

  async buildFollowupRow(businessId: string, followupId: string): Promise<OperationalRow | null> {
    // Sourced either from enquiry ID or formatted followup ID
    const enquiryId = followupId.startsWith('followup-') ? followupId.replace('followup-', '') : followupId;
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId, businessId },
      include: { customer: true, assignee: true }
    });
    if (!enquiry) return null;

    const structured = (enquiry.structuredData as any) || {};

    const data: Record<string, any> = {
      'Followup ID': followupId,
      'Business ID': enquiry.businessId,
      'Enquiry ID': enquiry.id,
      'Customer ID': enquiry.customerId,
      'Customer Name': enquiry.customer?.name || '',
      'Phone': enquiry.customer?.phone || '',
      'Followup Date': structured.followupDate || enquiry.updatedAt.toISOString(),
      'Reason': enquiry.nextAction || structured.followupReason || 'General Followup',
      'Assigned To': enquiry.assignee?.name || '',
      'Status': structured.followupStatus || enquiry.status,
      'Drive Document URL': structured.driveDocumentUrl || structured.driveUrl || '',
      'Notes': structured.followupNotes || '',
      'Created At': enquiry.createdAt.toISOString(),
      'Updated At': enquiry.updatedAt.toISOString(),
      'Last Synced At': new Date().toISOString()
    };

    return { id: followupId, data };
  }

  async buildOrderRow(businessId: string, orderId: string): Promise<OperationalRow | null> {
    const order = await prisma.order.findUnique({
      where: { id: orderId, businessId },
      include: { customer: true, assignee: true, enquiry: true }
    });
    if (!order) return null;

    const structured = (order.structuredData as any) || {};
    const fieldDefs = await prisma.workflowFieldDefinition.findMany({
      where: { businessId, active: true }
    });

    const data: Record<string, any> = {
      'Order ID': order.id,
      'Order Number': order.orderNumber,
      'Business ID': order.businessId,
      'Customer ID': order.customerId,
      'Customer Name': order.customer?.name || '',
      'Phone': order.customer?.phone || '',
      'Email': order.customer?.email || '',
      'Linked Enquiry ID': order.enquiryId || '',
      'Quotation ID': order.quotationId || '',
      'Status': order.status,
      'Source': order.source,
      'Subtotal': order.subtotal ?? '',
      'Discount': order.discount ?? '',
      'Tax': order.tax ?? '',
      'Total': order.totalAmount ?? '',
      'Currency': order.currency || 'INR',
      'Scheduled At': order.scheduledAt ? order.scheduledAt.toISOString() : '',
      'Due At': order.dueAt ? order.dueAt.toISOString() : '',
      'Completed At': order.completedAt ? order.completedAt.toISOString() : '',
      'Assigned To': order.assignee?.name || '',
      'Drive Document URL': structured.driveDocumentUrl || structured.driveUrl || '',
      'Notes': order.notes || '',
      'Created At': order.createdAt.toISOString(),
      'Updated At': order.updatedAt.toISOString(),
      'Last Synced At': new Date().toISOString()
    };

    for (const def of fieldDefs) {
      if (structured[def.fieldKey] !== undefined) {
        data[def.label] = structured[def.fieldKey];
      }
    }

    return { id: order.id, data };
  }

  async buildQuotationRow(businessId: string, quotationId: string): Promise<OperationalRow | null> {
    const quotation = await prisma.quotation.findUnique({
      where: { id: quotationId, businessId },
      include: { customer: true }
    });
    if (!quotation) return null;

    const driveUrl = await this.resolveDriveUrl(quotation.generatedDocumentId);

    const data: Record<string, any> = {
      'Quotation ID': quotation.id,
      'Quotation Number': quotation.quotationNumber,
      'Business ID': quotation.businessId,
      'Customer ID': quotation.customerId,
      'Customer Name': quotation.customer?.name || '',
      'Phone': quotation.customer?.phone || '',
      'Email': quotation.customer?.email || '',
      'Order ID': quotation.orderId || '',
      'Status': quotation.status,
      'Subtotal': quotation.subtotal,
      'Discount Amount': quotation.discountAmount,
      'Tax Amount': quotation.taxAmount,
      'Grand Total': quotation.totalAmount,
      'Currency': quotation.currency || 'INR',
      'Valid Until': quotation.validUntil ? quotation.validUntil.toISOString() : '',
      'Drive Document URL': driveUrl,
      'Notes': quotation.notes || '',
      'Created At': quotation.createdAt.toISOString(),
      'Updated At': quotation.updatedAt.toISOString(),
      'Last Synced At': new Date().toISOString()
    };

    return { id: quotation.id, data };
  }

  async buildInvoiceRow(businessId: string, invoiceId: string): Promise<OperationalRow | null> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId, businessId },
      include: { customer: true, payments: true }
    });
    if (!invoice) return null;

    const driveUrl = await this.resolveDriveUrl(invoice.generatedDocumentId);
    let paymentStatus = 'UNPAID';
    if (invoice.payments && invoice.payments.length > 0) {
      paymentStatus = invoice.payments[0].status;
    } else if (invoice.outstandingAmount <= 0 && invoice.totalAmount > 0) {
      paymentStatus = 'PAID';
    } else if (invoice.paidAmount > 0) {
      paymentStatus = 'PARTIAL';
    }

    const data: Record<string, any> = {
      'Invoice ID': invoice.id,
      'Invoice Number': invoice.invoiceNumber,
      'Business ID': invoice.businessId,
      'Invoice Date': invoice.invoiceDate ? invoice.invoiceDate.toISOString().split('T')[0] : '',
      'Due Date': invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : '',
      'Order ID': invoice.orderId || '',
      'Quotation ID': invoice.quotationId || '',
      'Customer ID': invoice.customerId,
      'Customer Name': invoice.customer?.name || '',
      'Email': invoice.customer?.email || '',
      'Phone': invoice.customer?.phone || '',
      'Subtotal': invoice.subtotal.toString(),
      'Discount Amount': invoice.discountAmount.toString(),
      'Tax Amount': invoice.taxAmount.toString(),
      'Total Amount': invoice.totalAmount.toString(),
      'Paid Amount': invoice.paidAmount.toString(),
      'Outstanding Amount': invoice.outstandingAmount.toString(),
      'Status': invoice.status,
      'Payment Status': paymentStatus,
      'Drive Document URL': driveUrl,
      'Notes': invoice.notes || '',
      'Created At': invoice.createdAt.toISOString(),
      'Updated At': invoice.updatedAt.toISOString(),
      'Last Synced At': new Date().toISOString()
    };

    return { id: invoice.id, data };
  }

  // ==========================================
  // AUTHORITATIVE SINGLE SYNC PATH
  // ==========================================

  /**
   * Synchronises a single entity to Google Sheets.
   * Reuses configured spreadsheet ID and worksheet mappings.
   * Does NOT silently skip or create new spreadsheets when configuration is missing.
   */
  async syncEntity(
    businessId: string,
    entityType: OperationalEntityType,
    entityId: string
  ): Promise<void> {
    // 1. Validate configuration
    const { config, adapter } = await this.validateConfig(businessId);

    // 2. Build row
    let row: OperationalRow | null = null;
    let schemaName = '';

    switch (entityType) {
      case 'CUSTOMER':
        row = await this.buildCustomerRow(businessId, entityId);
        schemaName = 'Customers';
        break;
      case 'ENQUIRY':
        row = await this.buildEnquiryRow(businessId, entityId);
        schemaName = 'Enquiries';
        break;
      case 'FOLLOWUP':
        row = await this.buildFollowupRow(businessId, entityId);
        schemaName = 'Followups';
        break;
      case 'ORDER':
        row = await this.buildOrderRow(businessId, entityId);
        schemaName = 'Orders';
        break;
      case 'QUOTATION':
        row = await this.buildQuotationRow(businessId, entityId);
        schemaName = 'Quotations';
        break;
      case 'INVOICE':
        row = await this.buildInvoiceRow(businessId, entityId);
        schemaName = 'Invoices';
        break;
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }

    if (!row) {
      console.warn(`[OperationalSync] Entity ${entityType} ${entityId} not found in database. Skipping row sync.`);
      return;
    }

    // 3. Resolve worksheet mapping & schema
    const schemas = await this.getBusinessSchema(businessId);
    const schema = schemas.find((s) => s.name === schemaName);
    if (!schema) throw new Error(`Schema not found for ${schemaName}`);

    const mappings = (config.worksheetMappings as Record<string, any>) || {};
    const entityMapping = mappings[schemaName] || mappings[entityType] || {};
    const targetWorksheetName = entityMapping.worksheetName || schemaName;
    const columnMapping = entityMapping.columnMapping || {};

    // 4. Ensure worksheet tab and headers exist (normalises & deduplicates)
    await adapter.ensureWorksheetAndHeaders(config.spreadsheetId, schema, targetWorksheetName);

    // 5. Upsert record with mutex concurrency control
    await adapter.syncRecords(config.spreadsheetId, targetWorksheetName, [row], {
      idField: schema.idField,
      columnMapping
    });
  }

  // Convenience methods delegating to single authoritative syncEntity
  async syncCustomer(businessId: string, customerId: string) {
    return this.syncEntity(businessId, 'CUSTOMER', customerId);
  }
  async syncEnquiry(businessId: string, enquiryId: string) {
    return this.syncEntity(businessId, 'ENQUIRY', enquiryId);
  }
  async syncFollowup(businessId: string, followupId: string) {
    return this.syncEntity(businessId, 'FOLLOWUP', followupId);
  }
  async syncOrder(businessId: string, orderId: string) {
    return this.syncEntity(businessId, 'ORDER', orderId);
  }
  async syncQuotation(businessId: string, quotationId: string) {
    return this.syncEntity(businessId, 'QUOTATION', quotationId);
  }
  async syncInvoice(businessId: string, invoiceId: string) {
    return this.syncEntity(businessId, 'INVOICE', invoiceId);
  }

  // ==========================================
  // IDEMPOTENCY & QUEUE CONSOLIDATION
  // ==========================================

  /**
   * Enqueues an operational sync job with database-backed idempotency.
   * If a PENDING or RETRYING job already exists for (businessId, entityType, entityId),
   * returns the existing job without creating duplicates.
   */
  async enqueueSync(
    businessId: string,
    entityType: OperationalEntityType,
    entityId: string,
    operation: string
  ) {
    const existing = await prisma.operationalSyncJob.findFirst({
      where: {
        businessId,
        entityType,
        entityId,
        status: { in: ['PENDING', 'RETRYING'] }
      }
    });

    if (existing) {
      return existing;
    }

    const job = await prisma.operationalSyncJob.create({
      data: {
        businessId,
        entityType,
        entityId,
        operation,
        status: 'PENDING'
      }
    });

    return job;
  }

  /**
   * Initiates a full background backfill across all 6 tables.
   * Sets OperationalSheetConfig status to SYNCING.
   * Does NOT mark SYNCED until all relevant jobs have actually succeeded.
   */
  async syncAll(businessId: string): Promise<void> {
    const config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
    if (!config || !config.spreadsheetId) {
      throw new SetupRequiredError(
        `SETUP_REQUIRED: Cannot sync all. Sheet configuration missing for business ${businessId}.`
      );
    }

    await prisma.operationalSheetConfig.update({
      where: { businessId },
      data: { status: 'SYNCING', errorMessage: null }
    });

    const customers = await prisma.customer.findMany({ where: { businessId }, select: { id: true } });
    const enquiries = await prisma.enquiry.findMany({ where: { businessId }, select: { id: true, nextAction: true } });
    const orders = await prisma.order.findMany({ where: { businessId }, select: { id: true } });
    const quotations = await prisma.quotation.findMany({ where: { businessId }, select: { id: true } });
    const invoices = await prisma.invoice.findMany({ where: { businessId }, select: { id: true } });

    for (const c of customers) {
      await this.enqueueSync(businessId, 'CUSTOMER', c.id, 'SYNC_ALL');
    }
    for (const e of enquiries) {
      await this.enqueueSync(businessId, 'ENQUIRY', e.id, 'SYNC_ALL');
      if (e.nextAction) {
        await this.enqueueSync(businessId, 'FOLLOWUP', `followup-${e.id}`, 'SYNC_ALL');
      }
    }
    for (const o of orders) {
      await this.enqueueSync(businessId, 'ORDER', o.id, 'SYNC_ALL');
    }
    for (const q of quotations) {
      await this.enqueueSync(businessId, 'QUOTATION', q.id, 'SYNC_ALL');
    }
    for (const i of invoices) {
      await this.enqueueSync(businessId, 'INVOICE', i.id, 'SYNC_ALL');
    }
  }

  /**
   * Checks the progress of jobs for a business and updates OperationalSheetConfig accordingly.
   * Ensures status is not marked SYNCED until all jobs have actually succeeded.
   */
  async checkAndUpdateConfigStatus(businessId: string): Promise<void> {
    const activeCount = await prisma.operationalSyncJob.count({
      where: {
        businessId,
        status: { in: ['PENDING', 'PROCESSING', 'RETRYING'] }
      }
    });

    if (activeCount > 0) {
      const hasRetrying = await prisma.operationalSyncJob.count({
        where: { businessId, status: 'RETRYING' }
      });
      await prisma.operationalSheetConfig.updateMany({
        where: { businessId },
        data: { status: hasRetrying > 0 ? 'RETRYING' : 'SYNCING' }
      });
      return;
    }

    // All active jobs finished: check for terminal failures
    const failedJob = await prisma.operationalSyncJob.findFirst({
      where: { businessId, status: 'FAILED' },
      orderBy: { updatedAt: 'desc' }
    });

    if (failedJob) {
      await prisma.operationalSheetConfig.updateMany({
        where: { businessId },
        data: {
          status: 'FAILED',
          errorMessage: failedJob.lastError || 'One or more operational sync jobs failed.'
        }
      });
    } else {
      await prisma.operationalSheetConfig.updateMany({
        where: { businessId },
        data: {
          status: 'SYNCED',
          errorMessage: null,
          lastSyncedAt: new Date()
        }
      });
    }
  }

  async getStatus(businessId: string) {
    const config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
    if (!config) return null;

    return {
      status: config.status,
      spreadsheetId: config.spreadsheetId,
      spreadsheetName: config.spreadsheetName,
      worksheetMappings: config.worksheetMappings,
      lastSyncedAt: config.lastSyncedAt,
      errorMessage: config.errorMessage,
      url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`
    };
  }
}

export const operationalSyncService = new OperationalSyncService();
