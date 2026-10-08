import { prisma } from '@agent-flux/database';
import { getConnectorProvider } from '../../connectors/registry';
import { AASHA_PRODUCTS, AASHA_TAX_CONFIG } from '../knowledge/aashaKnowledgeData';
import { quotationService } from '../quotation/QuotationService';
import { invoiceService } from '../invoice/InvoiceService';
import { EventBus } from '../eventBus';
import { connection as redis } from '../queue/connection';
import { AIProviderFactory } from '../agent/providers/AIProvider';

export class ConversationOrchestrator {
  public static async processIncomingMessage(businessId: string, emailPayload: any, integrationId?: string) {
    const messageId = emailPayload.id;

    // STEP 1 - IDEMPOTENCY
    const isNew = await redis.setnx(`processed_email:${messageId}`, "1");
    if (!isNew) {
        console.log(`[ConversationOrchestrator] Idempotency hit: Email ${messageId} already processed. STOP.`);
        return;
    }
    await redis.expire(`processed_email:${messageId}`, 7 * 24 * 60 * 60);

    let currentState = 'RECEIVED';
    console.log(`[ConversationOrchestrator] State: ${currentState} for ${messageId}`);

    try {
        // STEP 2 - NORMALIZE EMAIL
        currentState = 'PROCESSING';
        const normalizedBody = this.normalizeEmailBody(emailPayload.body);
        const subject = emailPayload.subject || '';
        const fromStr = emailPayload.from || '';
        
        let fromEmail = fromStr;
        let fromName = '';
        const match = fromStr.match(/(?:(.*)\s+)?<([^>]+)>/);
        if (match) {
            fromName = (match[1] || '').trim().replace(/"/g, '');
            fromEmail = match[2].trim().toLowerCase();
        } else {
            fromEmail = fromStr.trim().toLowerCase();
        }

        const threadId = emailPayload.threadId || messageId;

        // STEP 3 - BUILD CONTEXT PACKET
        let customer = await prisma.customer.findFirst({
            where: { businessId, email: fromEmail }
        });

        // Identity resolution
        if (!customer) {
            customer = await prisma.customer.create({
                data: {
                    businessId,
                    name: fromName || 'Customer', 
                    email: fromEmail,
                    source: 'EMAIL'
                }
            });
            EventBus.publish(businessId, 'CUSTOMER_CREATED', { customerId: customer.id });
        }

        const recentEnquiries = await prisma.enquiry.findMany({
            where: { businessId, customerId: customer.id, source: 'EMAIL' },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        
        const previousEnquiry = recentEnquiries.find((enq: any) => 
            enq.structuredData && (enq.structuredData as any).threadId === threadId
        ) || null;

        const existingQuotation = await prisma.quotation.findFirst({
            where: { businessId, customerId: customer.id, gmailThreadId: threadId } as any,
            orderBy: { createdAt: 'desc' }
        });

        const activeOrder = existingQuotation ? await prisma.order.findFirst({
            where: { businessId, quotationId: existingQuotation.id } as any
        }) : null;

        const conversationContext = {
            businessContext: { currency: 'INR', taxRate: AASHA_TAX_CONFIG.taxRatePercentage },
            customerContext: { name: customer.name, email: customer.email },
            threadContext: { threadId, previousEnquiryData: previousEnquiry?.structuredData },
            activeObjects: {
                quotationStatus: existingQuotation ? existingQuotation.status : null,
                orderStatus: activeOrder ? activeOrder.status : null
            },
            knowledgeBase: AASHA_PRODUCTS.map(p => ({
                id: p.sku, name: p.productName, price: p.basePrice,
                productionDays: p.productionDays, warranty: p.warranty, aliases: p.aliases
            }))
        };

        // STEP 4 - AI UNDERSTANDING
        const aiProvider = AIProviderFactory.getProvider('gemini');
        const systemInstruction = `
You are the semantic understanding engine for Agent Flux V2 (Aasha Furniture).
Your goal is to understand the customer's email and output STRICT JSON.
DO NOT OUTPUT ANY CONVERSATIONAL TEXT. ONLY RAW JSON.

JSON SCHEMA:
{
  "intent": "GENERAL_ENQUIRY" | "PRODUCT_PRICE" | "PRODUCTION_TIME" | "DELIVERY_INFORMATION" | "QUOTATION_REQUESTED" | "QUOTATION_ACCEPTANCE" | "DISCOUNT_REQUEST" | "ORDER_STATUS" | "UNKNOWN",
  "secondaryIntents": ["same strings as above"],
  "entities": {
    "productName": "string or null",
    "quantity": number (default 1),
    "deliveryCity": "string or null"
  },
  "confidence": number (0.0 to 1.0)
}

Context:
${JSON.stringify(conversationContext, null, 2)}

Rules:
1. If the thread has an active quotation (status "SENT") and customer says "proceed", "yes", "confirm my order", "I'll take it", intent is QUOTATION_ACCEPTANCE.
2. If customer says "can you send me a quotation?", intent is QUOTATION_REQUESTED.
3. If they ask "how much" or "price", intent is PRODUCT_PRICE.
4. Normalize products using knowledge base. Resolve "wardrobe" to "3-Door Wardrobe", "bed" to "Queen Size Teak Bed" or "King Size Teak Bed" based on context.
5. If thread Context has a previous product, carry it over if the customer implies "it" or "the bed", BUT DO NOT carry it over if they explicitly ask for a DIFFERENT product (e.g. they say Queen Size Teak Bed, do not use King Size).
`;

        const userPrompt = `Email Subject: ${subject}\nBody:\n${normalizedBody}`;

        let aiResponse;
        try {
            aiResponse = await aiProvider.generateResponse(
                systemInstruction,
                [{ role: 'user', content: userPrompt }],
                [],
                { model: '', temperature: 0.1 }
            );
        } catch (error: any) {
            console.error("[ConversationOrchestrator] Gemini failed, falling back to Groq:", error.message);
            const groqProvider = AIProviderFactory.getProvider('groq');
            aiResponse = await groqProvider.generateResponse(
                systemInstruction,
                [{ role: 'user', content: userPrompt }],
                [],
                { model: '', temperature: 0.1 }
            );
        }

        let parsedAi;
        try {
            let cleanText = aiResponse.content.text || '{}';
            cleanText = cleanText.replace(/^```json/g, '').replace(/```$/g, '').trim();
            parsedAi = JSON.parse(cleanText);
        } catch (e) {
            console.error("[ConversationOrchestrator] AI JSON parsing failed, using fallback", aiResponse.content.text);
            parsedAi = { intent: 'GENERAL_ENQUIRY', entities: {} };
        }

        // Inheritance logic (State-Aware)
        let extracted = {
            intent: parsedAi.intent || 'GENERAL_ENQUIRY',
            productName: parsedAi.entities?.productName || null,
            quantity: parsedAi.entities?.quantity || 1,
            deliveryLocation: parsedAi.entities?.deliveryCity || null,
            threadId: threadId
        };

        if (previousEnquiry && previousEnquiry.structuredData) {
            const prevData: any = previousEnquiry.structuredData;
            if (!extracted.productName && prevData.productName) extracted.productName = prevData.productName;
            if (!extracted.deliveryLocation && prevData.deliveryLocation) extracted.deliveryLocation = prevData.deliveryLocation;
            if (extracted.quantity === 1 && prevData.quantity > 1) extracted.quantity = prevData.quantity;
        }

        // STEP 5 - ENTITY RESOLUTION & KNOWLEDGE RETRIEVAL
        let matchedProduct = null;
        if (extracted.productName) {
            const lowerName = extracted.productName.toLowerCase();
            matchedProduct = AASHA_PRODUCTS.find(p => 
                p.productName.toLowerCase() === lowerName ||
                p.productName.toLowerCase().includes(lowerName) || 
                p.aliases.some(a => lowerName.includes(a.toLowerCase()))
            );
            if (matchedProduct) extracted.productName = matchedProduct.productName;
        }

        // STEP 7 - STATE-AWARE DECISION & ACTION PLAN
        const actionPlan = this.determineActionPlan(extracted, existingQuotation, matchedProduct);
        console.log(`[ConversationOrchestrator] ActionPlan Selected: ${actionPlan.primaryAction}`);

        // STEP 9 - BUSINESS ACTIONS & DETERMINISTIC FINANCIAL ENGINE
        const { replyHtml, attachments } = await this.executeBusinessAction(
            actionPlan, businessId, customer, threadId, messageId, extracted, matchedProduct, normalizedBody, subject, existingQuotation
        );

        // STEP 12 - RESPONSE VALIDATION & SENDING
        if (replyHtml) {
            await this.sendResponseEmail(businessId, customer.email || '', subject, replyHtml, threadId, messageId, attachments);
            currentState = 'COMPLETED';
            console.log(`[ConversationOrchestrator] State: ${currentState} for ${messageId}`);
        }

    } catch (error: any) {
        currentState = 'FAILED';
        console.error(`[ConversationOrchestrator] State: ${currentState} for ${messageId} | Error:`, error.message);
        await redis.del(`processed_email:${messageId}`);
    }
  }

  private static normalizeEmailBody(body: string): string {
      if (!body) return '';
      let text = body.replace(/<[^>]*>?/gm, ' ');
      text = text.split(/On .* wrote:/)[0];
      return text.replace(/\s+/g, ' ').trim();
  }

  private static determineActionPlan(extracted: any, existingQuotation: any, matchedProduct: any) {
      if (extracted.intent === 'QUOTATION_ACCEPTANCE' && existingQuotation) {
          return { primaryAction: 'ACCEPT_QUOTATION' };
      }
      if (extracted.intent === 'QUOTATION_REQUESTED' && matchedProduct) {
          return { primaryAction: 'CREATE_QUOTATION' };
      }
      if (extracted.intent === 'PRODUCT_PRICE' && matchedProduct) {
          return { primaryAction: 'SEND_PRICE_INFO' };
      }
      return { primaryAction: 'MANUAL_REVIEW_FALLBACK' };
  }

  private static async executeBusinessAction(
      actionPlan: any, businessId: string, customer: any, threadId: string, messageId: string,
      extracted: any, product: any, body: string, subject: string, existingQuotation: any
  ) {
      // 1. Create Enquiry Record for Audit
      await prisma.enquiry.create({
          data: {
              businessId, customerId: customer.id, source: 'EMAIL',
              subject, rawMessage: body, structuredData: extracted as any
          }
      });

      let replyHtml = '';
      let attachments = undefined;

      if (actionPlan.primaryAction === 'ACCEPT_QUOTATION') {
          const { orderService } = require('../order/OrderService');
          const res = await orderService.processQuotationAcceptance(
              businessId, customer.id, body, threadId
          );
          
          if (res.status === 'FAILED') {
              return { replyHtml: `<p>${res.emailBody}</p>` };
          }
          
          replyHtml = res.emailBody.split('\n').map((line: string) => line ? `<p>${line}</p>` : '<br>').join('');
          return { replyHtml };
      }

      if (actionPlan.primaryAction === 'CREATE_QUOTATION') {
          if (!existingQuotation) {
              const lineItems = [{
                  sku: product.sku, description: product.productName,
                  quantity: extracted.quantity, unitPrice: product.basePrice,
                  discount: 0, taxRate: AASHA_TAX_CONFIG.taxRatePercentage
              }];
              existingQuotation = await quotationService.createQuotation(businessId, {
                  customerId: customer.id, lineItems, gmailThreadId: threadId
              });
          }

          try {
              const { documentGenerationService } = require('../documents/DocumentGenerationService');
              const generatedDoc = await documentGenerationService.generateDocument(businessId, 'QUOTATION', existingQuotation.id);
              await quotationService.updateStatus(businessId, existingQuotation.id, 'SENT', 'system');

              attachments = [{
                  filename: generatedDoc.filename, mimeType: generatedDoc.mimeType, filePath: generatedDoc.storagePath
              }];
          } catch(e) {
              await quotationService.updateStatus(businessId, existingQuotation.id, 'SENT', 'system');
          }

          const subtotal = product.basePrice * extracted.quantity;
          const tax = subtotal * (AASHA_TAX_CONFIG.taxRatePercentage / 100);
          const total = subtotal + tax;

          replyHtml = `
            <p>Dear ${customer.name || 'Customer'},</p>
            <p>Thank you for your interest.</p>
            <p>Please find attached the formal quotation for your ${product.productName}.</p>
            <p>Quantity: ${extracted.quantity}<br>
            Base Price: ₹${product.basePrice.toLocaleString('en-IN')}<br>
            GST: ₹${tax.toLocaleString('en-IN')}<br>
            Total: ₹${total.toLocaleString('en-IN')}</p>
            <p>Please review the attached quotation and let us know if you would like to proceed.</p>
            <br>
            <p>Warm regards,<br>Aasha Furniture Team</p>
          `;
          return { replyHtml, attachments };
      }

      if (actionPlan.primaryAction === 'SEND_PRICE_INFO') {
          const subtotal = product.basePrice * extracted.quantity;
          const tax = subtotal * (AASHA_TAX_CONFIG.taxRatePercentage / 100);
          const total = subtotal + tax;

          replyHtml = `
            <p>Dear ${customer.name || 'Customer'},</p>
            <p>Thank you for your interest in our ${product.productName}.</p>
            <p>Here are the details:</p>
            <ul>
              <li>Product: ${product.productName}</li>
              <li>Quantity: ${extracted.quantity}</li>
              <li>Base Price: ₹${product.basePrice.toLocaleString('en-IN')}</li>
              <li>GST (${AASHA_TAX_CONFIG.taxRatePercentage}%): ₹${tax.toLocaleString('en-IN')}</li>
              <li><strong>Total Price: ₹${total.toLocaleString('en-IN')}</strong></li>
            </ul>
            <p>Production Lead Time: ${product.productionDays} working days</p>
            <p>Warranty: ${product.warranty}</p>
            <p>If you would like to proceed, please confirm and we will prepare the formal quotation.</p>
            <br>
            <p>Warm regards,<br>Aasha Furniture Team</p>
          `;
          return { replyHtml };
      }

      if (actionPlan.primaryAction === 'MANUAL_REVIEW_FALLBACK') {
         // Ask a targeted clarification instead of generic fallback!
         if (extracted.intent === 'GENERAL_ENQUIRY' && !product) {
             replyHtml = `<p>Dear ${customer.name || 'Customer'},</p>
             <p>I'd be happy to help. Could you please confirm which exact product or furniture piece you are looking for?</p>
             <br><p>Warm regards,<br>Aasha Furniture Team</p>`;
         } else if (extracted.productName && !product) {
             replyHtml = `<p>Dear ${customer.name || 'Customer'},</p>
             <p>I'd be happy to help with the ${extracted.productName}. Could you please confirm if you meant the Queen Size Teak Bed or the King Size Teak Bed?</p>
             <br><p>Warm regards,<br>Aasha Furniture Team</p>`;
         } else {
             replyHtml = `<p>Dear ${customer.name || 'Customer'},</p>
             <p>Thank you for reaching out. We are reviewing your request and will provide the specific details shortly.</p>
             <br><p>Warm regards,<br>Aasha Furniture Team</p>`;
         }
         return { replyHtml };
      }

      return { replyHtml: '' };
  }

  private static async sendResponseEmail(businessId: string, email: string, subject: string, html: string, threadId: string, messageId: string, attachments: any) {
      try {
          const gmailAction = require('../../connectors/actions/gmail').gmailActions.find((a: any) => a.id === 'send_email');
          const creds = await prisma.integrationCredential.findFirst({ where: { integration: { businessId, provider: 'GMAIL', status: 'CONNECTED' } } });
          if (creds && gmailAction) {
              const { decrypt, encrypt } = require('../encryption');
              let accessToken = decrypt(creds.accessTokenEncrypted);
              if (creds.expiresAt && creds.expiresAt.getTime() < Date.now() + 60000 && creds.refreshTokenEncrypted) {
                   const { google } = require('googleapis');
                   const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
                   oauth2Client.setCredentials({ refresh_token: decrypt(creds.refreshTokenEncrypted) });
                   try {
                       const { credentials } = await oauth2Client.refreshAccessToken();
                       if (credentials.access_token) {
                           accessToken = credentials.access_token;
                           await prisma.integrationCredential.update({
                               where: { id: creds.id },
                               data: { accessTokenEncrypted: encrypt(accessToken), expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null }
                           });
                       }
                   } catch(e) { }
              }

              await gmailAction.execute({ accessToken }, {
                  to: email, subject: `Re: ${subject.replace(/^Re:\s*/i, '')}`,
                  body: html, threadId, inReplyTo: messageId, attachments
              });
          }
      } catch(e) {
          console.error("[ConversationOrchestrator] Error sending email:", e);
      }
  }
}
