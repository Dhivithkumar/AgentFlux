import { prisma } from '@agent-flux/database';
import { GoogleSheetsAdapter } from './GoogleSheetsAdapter';
import { OperationalWorksheetSchema, OperationalRow } from './types';

export class OperationalSyncService {
  
  async getBusinessSchema(businessId: string): Promise<OperationalWorksheetSchema[]> {
    const fieldDefs = await prisma.workflowFieldDefinition.findMany({
      where: { businessId, active: true },
      orderBy: { displayOrder: 'asc' }
    });

    const dynamicFields = fieldDefs.map(f => f.label);

    const enquiriesSchema: OperationalWorksheetSchema = {
      name: 'Enquiries',
      headers: [
        'Enquiry ID', 'Date', 'Customer Name', 'Phone', 'Email', 
        'Source', 'Enquiry Type', 'Status', 'Assigned To', 'Next Action', 
        'Summary', 'Notes', ...dynamicFields
      ]
    };

    const customersSchema: OperationalWorksheetSchema = {
      name: 'Customers',
      headers: [
        'Customer ID', 'Customer Name', 'Phone', 'Email', 
        'Location', 'Total Enquiries', 'Total Orders', 'Total Order Value', 
        'Last Contact', 'Customer Status', 'Notes'
      ]
    };

    const followupsSchema: OperationalWorksheetSchema = {
      name: 'Followups',
      headers: [
        'Follow-up ID', 'Enquiry ID', 'Customer Name', 'Phone', 
        'Follow-up Date', 'Reason', 'Assigned To', 'Status', 'Notes'
      ]
    };

    const ordersSchema: OperationalWorksheetSchema = {
      name: 'Orders',
      headers: [
        'Order ID', 'Order Number', 'Customer ID', 'Customer Name', 'Phone', 
        'Linked Enquiry', 'Status', 'Source', 'Subtotal', 'Discount', 'Tax', 
        'Total', 'Currency', 'Scheduled At', 'Due At', 'Assigned To', 
        'Created At', 'Updated At', ...dynamicFields
      ]
    };

    const invoicesSchema: OperationalWorksheetSchema = {
      name: 'Invoices',
      headers: [
        'Invoice ID', 'Invoice Number', 'Invoice Date', 'Due Date', 'Order ID', 
        'Quotation ID', 'Customer Name', 'Email', 'Phone', 'Subtotal', 
        'Discount', 'Tax', 'Total Amount', 'Paid Amount', 'Outstanding Amount', 
        'Status', 'Last Synced At'
      ]
    };

    return [enquiriesSchema, customersSchema, followupsSchema, ordersSchema, invoicesSchema];
  }

  async initializeConfig(businessId: string, integrationId: string): Promise<any> {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new Error('Business not found');

    const schemas = await this.getBusinessSchema(businessId);
    const adapter = new GoogleSheetsAdapter(integrationId);
    const spreadsheetName = `${business.name} Operations`;

    let config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
    
    // Create new sheet in Google if not already linked
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
      // Ensure headers are up to date
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

    // Trigger full backfill async
    this.syncAll(businessId).catch(console.error);

    return config;
  }

  async connectSpreadsheet(businessId: string, integrationId: string, spreadsheetId: string, spreadsheetName: string): Promise<any> {
    const existing = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
    if (existing) {
      return prisma.operationalSheetConfig.update({
        where: { businessId },
        data: {
          integrationId,
          spreadsheetId,
          spreadsheetName,
          status: 'SYNCED',
          errorMessage: null
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
        worksheetMappings: {}
      }
    });
  }

  async saveMapping(businessId: string, entityType: string, worksheetId: string, worksheetName: string, columnMapping: Record<string, string>): Promise<any> {
    const config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
    if (!config) throw new Error('Google Sheets not connected for this business');

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

  async syncEnquiry(businessId: string, enquiryId: string): Promise<void> {
    try {
      const config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
      if (!config || !config.spreadsheetId) return; // Silent skip if not configured

      const enquiry = await prisma.enquiry.findUnique({
        where: { id: enquiryId },
        include: { customer: true, assignee: true }
      });
      if (!enquiry) return;

      const dynamicFields: Record<string, any> = (enquiry.structuredData as any) || {};

      // Match dynamic field keys to their display labels correctly.
      const fieldDefs = await prisma.workflowFieldDefinition.findMany({
        where: { businessId, active: true }
      });
      const data: Record<string, any> = {
        'Enquiry ID': enquiry.id,
        'Date': enquiry.createdAt.toISOString(),
        'Customer Name': enquiry.customer.name || '',
        'Phone': enquiry.customer.phone || '',
        'Email': enquiry.customer.email || '',
        'Source': enquiry.source,
        'Enquiry Type': enquiry.subject || '',
        'Status': enquiry.status,
        'Assigned To': enquiry.assignee?.name || '',
        'Next Action': enquiry.nextAction || '',
        'Summary': enquiry.summary || '',
        'Notes': ''
      };

      for (const def of fieldDefs) {
        if (dynamicFields[def.fieldKey] !== undefined) {
          data[def.label] = dynamicFields[def.fieldKey];
        }
      }

      const row: OperationalRow = { id: enquiry.id, data };
      const adapter = new GoogleSheetsAdapter(config.integrationId);
      
      // Ensure headers before syncing
      const schemas = await this.getBusinessSchema(businessId);
      const enqSchema = schemas.find(s => s.name === 'Enquiries')!;
      await adapter.ensureWorksheetAndHeaders(config.spreadsheetId, enqSchema);

      await adapter.syncRecords(config.spreadsheetId, 'Enquiries', [row]);
      
      await prisma.operationalSheetConfig.update({
        where: { businessId },
        data: { status: 'SYNCED', lastSyncedAt: new Date(), errorMessage: null }
      });
    } catch (e: any) {
      await prisma.operationalSheetConfig.updateMany({
        where: { businessId },
        data: { status: 'FAILED', errorMessage: e.message }
      });
    }
  }

  async syncOrder(businessId: string, orderId: string): Promise<void> {
    try {
      const config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
      if (!config || !config.spreadsheetId) return;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true, assignee: true, enquiry: true }
      });
      if (!order) return;

      const dynamicFields: Record<string, any> = (order.structuredData as any) || {};
      const fieldDefs = await prisma.workflowFieldDefinition.findMany({
        where: { businessId, active: true }
      });

      const data: Record<string, any> = {
        'Order ID': order.id,
        'Order Number': order.orderNumber,
        'Customer ID': order.customerId,
        'Customer Name': order.customer.name || '',
        'Phone': order.customer.phone || '',
        'Linked Enquiry': order.enquiry?.id || '',
        'Status': order.status,
        'Source': order.source,
        'Subtotal': order.subtotal || '',
        'Discount': order.discount || '',
        'Tax': order.tax || '',
        'Total': order.totalAmount || '',
        'Currency': order.currency || '',
        'Scheduled At': order.scheduledAt ? order.scheduledAt.toISOString() : '',
        'Due At': order.dueAt ? order.dueAt.toISOString() : '',
        'Assigned To': order.assignee?.name || '',
        'Created At': order.createdAt.toISOString(),
        'Updated At': order.updatedAt.toISOString(),
      };

      for (const def of fieldDefs) {
        if (dynamicFields[def.fieldKey] !== undefined) {
          data[def.label] = dynamicFields[def.fieldKey];
        }
      }

      const row: OperationalRow = { id: order.id, data };
      const adapter = new GoogleSheetsAdapter(config.integrationId);
      
      const schemas = await this.getBusinessSchema(businessId);
      const ordersSchema = schemas.find(s => s.name === 'Orders')!;
      await adapter.ensureWorksheetAndHeaders(config.spreadsheetId, ordersSchema);

      await adapter.syncRecords(config.spreadsheetId, 'Orders', [row]);
      
      await prisma.operationalSheetConfig.update({
        where: { businessId },
        data: { status: 'SYNCED', lastSyncedAt: new Date(), errorMessage: null }
      });
    } catch (e: any) {
      await prisma.operationalSheetConfig.updateMany({
        where: { businessId },
        data: { status: 'FAILED', errorMessage: e.message }
      });
    }
  }

  async syncInvoice(businessId: string, invoiceId: string): Promise<void> {
    try {
      const config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
      if (!config || !config.spreadsheetId) return;

      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { customer: true }
      });
      if (!invoice) return;

      const data: Record<string, any> = {
        'Invoice ID': invoice.id,
        'Invoice Number': invoice.invoiceNumber,
        'Invoice Date': invoice.invoiceDate.toISOString().split('T')[0],
        'Due Date': invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : '',
        'Order ID': invoice.orderId || '',
        'Quotation ID': invoice.quotationId || '',
        'Customer Name': invoice.customer?.name || '',
        'Email': invoice.customer?.email || '',
        'Phone': invoice.customer?.phone || '',
        'Subtotal': invoice.subtotal.toString(),
        'Discount': invoice.discountAmount.toString(),
        'Tax': invoice.taxAmount.toString(),
        'Total Amount': invoice.totalAmount.toString(),
        'Paid Amount': invoice.paidAmount.toString(),
        'Outstanding Amount': invoice.outstandingAmount.toString(),
        'Status': invoice.status,
        'Last Synced At': new Date().toISOString()
      };

      const row: OperationalRow = { id: invoice.id, data };
      const adapter = new GoogleSheetsAdapter(config.integrationId);
      
      const schemas = await this.getBusinessSchema(businessId);
      const invoiceSchema = schemas.find(s => s.name === 'Invoices')!;
      await adapter.ensureWorksheetAndHeaders(config.spreadsheetId, invoiceSchema);

      await adapter.syncRecords(config.spreadsheetId, 'Invoices', [row]);
      
      await prisma.operationalSheetConfig.update({
        where: { businessId },
        data: { status: 'SYNCED', lastSyncedAt: new Date(), errorMessage: null }
      });
    } catch (e: any) {
      await prisma.operationalSheetConfig.updateMany({
        where: { businessId },
        data: { status: 'FAILED', errorMessage: e.message }
      });
    }
  }

  async syncCustomer(businessId: string, customerId: string): Promise<void> {
    try {
      const config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
      if (!config || !config.spreadsheetId) return;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: { enquiries: true, orders: true }
      });
      if (!customer) return;

      const data: Record<string, any> = {
        'Customer ID': customer.id,
        'Customer Name': customer.name || '',
        'Phone': customer.phone || '',
        'Email': customer.email || '',
        'Location': (customer.customData as any)?.location || '',
        'Total Enquiries': customer.enquiries.length,
        'Total Orders': customer.orders.length,
        'Total Order Value': customer.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
        'Last Contact': customer.updatedAt.toISOString(),
        'Customer Status': customer.status,
        'Notes': ''
      };

      const row: OperationalRow = { id: customer.id, data };
      const adapter = new GoogleSheetsAdapter(config.integrationId);
      
      const schemas = await this.getBusinessSchema(businessId);
      const custSchema = schemas.find(s => s.name === 'Customers')!;
      await adapter.ensureWorksheetAndHeaders(config.spreadsheetId, custSchema);

      await adapter.syncRecords(config.spreadsheetId, 'Customers', [row]);
      
      await prisma.operationalSheetConfig.update({
        where: { businessId },
        data: { status: 'SYNCED', lastSyncedAt: new Date(), errorMessage: null }
      });
    } catch (e: any) {
      await prisma.operationalSheetConfig.updateMany({
        where: { businessId },
        data: { status: 'FAILED', errorMessage: e.message }
      });
    }
  }

  async syncAll(businessId: string): Promise<void> {
    const config = await prisma.operationalSheetConfig.findUnique({ where: { businessId } });
    if (!config || !config.spreadsheetId) return;

    await prisma.operationalSheetConfig.update({ where: { businessId }, data: { status: 'SYNCING' } });

    try {
      const enquiries = await prisma.enquiry.findMany({ where: { businessId } });
      const customers = await prisma.customer.findMany({ where: { businessId } });

      const orders = await prisma.order.findMany({ where: { businessId } });
      const invoices = await prisma.invoice.findMany({ where: { businessId } });

      for (const enq of enquiries) {
        // Enqueue instead of blocking
        import('../queue/operationalSyncPoller').then(mod => {
          mod.operationalSyncPoller.enqueue(businessId, 'ENQUIRY', enq.id, 'SYNC_ALL').catch(console.error);
        });
      }
      for (const cust of customers) {
        import('../queue/operationalSyncPoller').then(mod => {
          mod.operationalSyncPoller.enqueue(businessId, 'CUSTOMER', cust.id, 'SYNC_ALL').catch(console.error);
        });
      }
      for (const ord of orders) {
        import('../queue/operationalSyncPoller').then(mod => {
          mod.operationalSyncPoller.enqueue(businessId, 'ORDER', ord.id, 'SYNC_ALL').catch(console.error);
        });
      }
      for (const inv of invoices) {
        import('../queue/operationalSyncPoller').then(mod => {
          mod.operationalSyncPoller.enqueue(businessId, 'INVOICE' as any, inv.id, 'SYNC_ALL').catch(console.error);
        });
      }
      
      await prisma.operationalSheetConfig.update({
        where: { businessId },
        data: { status: 'SYNCED', lastSyncedAt: new Date(), errorMessage: null }
      });
    } catch (e: any) {
      await prisma.operationalSheetConfig.update({
        where: { businessId },
        data: { status: 'FAILED', errorMessage: e.message }
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
