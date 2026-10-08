import { prisma } from '@agent-flux/database';
import { documentGenerationService } from '../documents/DocumentGenerationService';

export interface ActionContext {
  businessId: string;
  executionId: string;
  workflowId: string;
}

export type ActionHandler = (context: ActionContext, input: any) => Promise<any>;

export class ActionRegistry {
  private static actions: Map<string, ActionHandler> = new Map();

  static register(name: string, handler: ActionHandler) {
    this.actions.set(name, handler);
  }

  static get(name: string): ActionHandler {
    const handler = this.actions.get(name);
    if (!handler) {
      throw new Error(`Action '${name}' not found in registry.`);
    }
    return handler;
  }
}

// Internal Application Actions
ActionRegistry.register('CREATE_CUSTOMER', async (ctx, input) => {
  const customer = await prisma.customer.create({
    data: {
      businessId: ctx.businessId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      source: input.source || 'WORKFLOW',
      customData: input.customData
    }
  });
  return customer;
});

ActionRegistry.register('CREATE_ENQUIRY', async (ctx, input) => {
  const enquiry = await prisma.enquiry.create({
    data: {
      businessId: ctx.businessId,
      customerId: input.customerId,
      source: input.source || 'WORKFLOW',
      subject: input.subject,
      rawMessage: input.rawMessage || '',
      structuredData: input.structuredData
    }
  });
  return enquiry;
});

ActionRegistry.register('CREATE_ORDER', async (ctx, input) => {
  const businessOrders = await prisma.order.count({ where: { businessId: ctx.businessId } });
  const orderNumber = `ORD-${(businessOrders + 1).toString().padStart(6, '0')}`;
  
  const order = await prisma.order.create({
    data: {
      businessId: ctx.businessId,
      customerId: input.customerId,
      enquiryId: input.enquiryId,
      orderNumber,
      source: input.source || 'WORKFLOW',
      status: input.status || 'DRAFT',
      structuredData: input.structuredData,
      subtotal: input.subtotal,
      currency: input.currency
    }
  });
  return order;
});

ActionRegistry.register('CREATE_QUOTATION', async (ctx, input) => {
  const { quotationService } = require('../quotation/QuotationService');
  const q = await quotationService.createQuotation(ctx.businessId, {
    customerId: input.customerId,
    orderId: input.orderId,
    lineItems: input.lineItems || []
  });
  return q;
});

ActionRegistry.register('SEND_QUOTATION', async (ctx, input) => {
  const { quotationService } = require('../quotation/QuotationService');
  // System bot user or original executor. Assuming workflow executor context if needed
  // Using generic 'system' id for now if no requestedBy is provided
  const q = await quotationService.updateStatus(ctx.businessId, input.quotationId, 'SENT', input.requestedById || 'system');
  return q;
});

ActionRegistry.register('GENERATE_DOCUMENT', async (ctx, input) => {
  const generated = await documentGenerationService.generateDocument(ctx.businessId, input.documentType, input.documentId);
  return generated;
});

ActionRegistry.register('PROCESS_INBOUND_EMAIL', async (ctx, input) => {
  const { QuotationWorkflowService } = require('../quotation/QuotationWorkflowService');
  const { QueryUnderstandingService } = require('../knowledge/QueryUnderstandingService');
  
  // 1. Detect intent
  const message = input.body || '';
  const customerName = input.fromName || input.from || 'Customer';
  
  const norm = QueryUnderstandingService.normalizeQuery(message);
  
  let resolvedCustomerId = input.customerId;
  if (!resolvedCustomerId) {
     const email = input.from || 'customer@example.com';
     let cust = await prisma.customer.findFirst({ where: { businessId: ctx.businessId, email } });
     if (!cust) {
         cust = await prisma.customer.create({
             data: { businessId: ctx.businessId, name: customerName, email, source: 'EMAIL' }
         });
     }
     resolvedCustomerId = cust.id;
  }
  
  // 2. EXISTING THREAD / QUOTATION RESOLUTION
  const threadId = input.threadId || input.id;
  let existingQuotation = null;

  if (threadId) {
     existingQuotation = await prisma.quotation.findFirst({
        where: { businessId: ctx.businessId, customerId: resolvedCustomerId, gmailThreadId: threadId } as any,
        orderBy: { createdAt: 'desc' }
     });
  }

  // Fallback: Check if message explicitly mentions a quotation number
  if (!existingQuotation) {
     const qtnMatch = message.match(/(?:AF-QTN-|QUO-)\d+/i);
     if (qtnMatch) {
         existingQuotation = await prisma.quotation.findFirst({
            where: { businessId: ctx.businessId, customerId: resolvedCustomerId, quotationNumber: qtnMatch[0].toUpperCase() }
         });
     }
  }

  // 3. INTENT CLASSIFICATION
  // norm is already declared at top of function
  
  // 4. PRECEDENCE 1: EXISTING QUOTATION CONTEXT
  if (existingQuotation) {
      if (norm.detectedIntent === 'QUOTATION_ACCEPTANCE') {
          console.log(`[ROUTING] Detected QUOTATION_ACCEPTANCE for existing quotation ${existingQuotation.quotationNumber}`);
          return {
              route: 'QUOTATION_ACCEPTANCE',
              message: input.body,
              subject: input.subject,
              customerId: resolvedCustomerId,
              customerName,
              threadId: threadId
          };
      }
      
      if (norm.detectedIntent === 'QUOTATION_REQUEST' || norm.detectedIntent === 'CUSTOMIZATION_REQUEST') {
          console.log(`[ROUTING] Detected REVISION request for existing quotation ${existingQuotation.quotationNumber}`);
          // Treat as revision, for now route as generic or specialized revision route
          return {
              route: 'GENERIC_ENQUIRY',
              extractedRequirements: `Revision requested for ${existingQuotation.quotationNumber}: ${message}`,
              customerName
          };
      }
  } else {
      if (norm.detectedIntent === 'QUOTATION_ACCEPTANCE') {
          console.log(`[ROUTING] Detected QUOTATION_ACCEPTANCE but no quotation found.`);
          return { route: 'GENERIC_ENQUIRY', extractedRequirements: 'Customer wants to accept an unknown quotation.', customerName };
      }
  }

  // 5. PRECEDENCE 2: NEW QUOTATION REQUEST
  if (norm.detectedIntent === 'QUOTATION_REQUEST') {
     console.log(`[ROUTING] Detected NEW QUOTATION_REQUEST for customer ${resolvedCustomerId}`);
     const result = await QuotationWorkflowService.processQuotationRequest({
       message,
       customerId: resolvedCustomerId,
       customerName,
       businessId: ctx.businessId,
       threadContext: []
     });

     // Result has `message` (concise body) and `pdfGenerated`, `quotationNumber`
     if (result.status === 'QUOTATION_TEMPLATE_NOT_FOUND') {
         throw new Error('QUOTATION_TEMPLATE_NOT_FOUND');
     }
     if (result.status === 'DOCUMENT_GENERATION_FAILED') {
         throw new Error('DOCUMENT_GENERATION_FAILED');
     }

     // Now we have the concise message and generated document.
     // Fetch the generated PDF from KnowledgeDocument.
     const fs = require('fs');
     let pdfBase64 = Buffer.from('mock pdf content').toString('base64');
     try {
         const quotation = await prisma.quotation.findFirst({ where: { businessId: ctx.businessId, quotationNumber: result.quotationNumber } });
         
         // Update quotation with gmailThreadId
         if (quotation && threadId) {
             await prisma.quotation.update({
                 where: { id: quotation.id },
                 data: { gmailThreadId: threadId, gmailMessageId: input.id } as any
             });
         }
         
         if (quotation && quotation.generatedDocumentId) {
             const doc = await prisma.knowledgeDocument.findUnique({ where: { id: quotation.generatedDocumentId } });
             if (doc && doc.storagePath && fs.existsSync(doc.storagePath)) {
                 pdfBase64 = fs.readFileSync(doc.storagePath).toString('base64');
             }
         }
     } catch (e) {
         console.error('Failed to load real PDF for email attachment:', e);
     }

     return {
       route: 'QUOTATION',
       emailSubject: `Quotation ${result.quotationNumber} – ${norm.matchedProducts[0]?.productName || 'Aasha Furniture'}`,
       emailBody: result.message,
       attachments: [
         {
           filename: `${result.quotationNumber}.pdf`,
           mimeType: 'application/pdf',
           content: pdfBase64
         }
       ]
     };
  }

  // 3. Fallback to generic RAG processing for ordinary enquiries
  return {
    route: 'GENERIC_ENQUIRY',
    extractedRequirements: message,
    customerName
  };
});

ActionRegistry.register('PROCESS_QUOTATION_ACCEPTANCE', async (ctx, input) => {
  const { orderService } = require('../order/OrderService');
  
  const result = await orderService.processQuotationAcceptance(
    ctx.businessId,
    input.customerId,
    input.message,
    input.threadId
  );
  
  return {
    route: result.status, // 'SUCCESS', 'FAILED', or 'AMBIGUOUS'
    emailSubject: result.emailSubject,
    emailBody: result.emailBody,
    sheetsRow: result.sheetsRow
  };
});

