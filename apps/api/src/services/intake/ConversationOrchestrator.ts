import { prisma } from '@agent-flux/database';
import { getConnectorProvider } from '../../connectors/registry';
import { HybridRetrievalEngine } from '../knowledge/HybridRetrievalEngine';
import { quotationService } from '../quotation/QuotationService';
import { invoiceService } from '../invoice/InvoiceService';
import { EventBus } from '../eventBus';
import { connection as redis } from '../queue/connection';
import { aiManager } from '../ai';

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

        const { knowledgeService } = require('../knowledge');
        const productDocs = await knowledgeService.searchKnowledgeBase({
             businessId, query: 'product catalogue list', topK: 5
        });
        const taxDocs = await knowledgeService.searchKnowledgeBase({
             businessId, query: 'tax rate gst', topK: 1
        });

        const conversationContext = {
            businessContext: { 
                taxInfo: taxDocs.length > 0 ? taxDocs[0].content : '18% GST default',
                currency: 'INR'
            },
            customerContext: { name: customer.name, email: customer.email },
            threadContext: { threadId, previousEnquiryData: previousEnquiry?.structuredData },
            activeObjects: {
                quotationStatus: existingQuotation ? existingQuotation.status : null,
                orderStatus: activeOrder ? activeOrder.status : null
            },
            knowledgeBase: productDocs.map((d: any) => d.content)
        };

        // STEP 4 - AI UNDERSTANDING
        const systemInstruction = `
You are the semantic understanding engine for Agent Flux V2 (Aasha Furniture).
Your goal is to accurately classify the customer's email based on what they are saying and output STRICT JSON.
DO NOT OUTPUT ANY CONVERSATIONAL TEXT. ONLY RAW JSON.

JSON SCHEMA:
{
  "intent": "MEETING_REQUEST" | "QUOTATION_REQUESTED" | "QUOTATION_ACCEPTANCE" | "PRODUCT_PRICE" | "PRODUCTION_TIME" | "DELIVERY_INFORMATION" | "ORDER_STATUS" | "DISCOUNT_REQUEST" | "GENERAL_ENQUIRY" | "UNKNOWN",
  "secondaryIntents": ["string"],
  "entities": {
    "productName": "string or null",
    "quantity": number (default 1),
    "deliveryCity": "string or null",
    "meetingDetails": {
      "requestedTimeframe": "string or null",
      "meetingType": "VIRTUAL" | "IN_PERSON" | "PHONE" | "UNSPECIFIED",
      "topic": "string or null"
    }
  },
  "confidence": number (0.0 to 1.0),
  "summary": "1-sentence summary of customer request"
}

Context:
${JSON.stringify(conversationContext, null, 2)}

Rules:
1. CLASSIFICATION MUST BE BASED STRICTLY ON THE INCOMING MESSAGE:
   - If the customer asks when you are free, or asks for a meeting, call, discussion, consultation, appointment, or showroom visit (e.g., "can you tell me when you are free on next week?", "can we schedule a call?", "when can we meet?"), intent is MEETING_REQUEST.
   - If customer asks for quotation or price estimate (e.g. "send me a quote", "give quotation for..."), intent is QUOTATION_REQUESTED.
   - If thread has an active quotation and customer says "proceed", "yes", "confirm my order", "I'll take it", intent is QUOTATION_ACCEPTANCE.
   - If customer asks "how much" or "price" for a product, intent is PRODUCT_PRICE.
   - If customer asks about manufacturing or lead time, intent is PRODUCTION_TIME.
   - If customer asks about shipping, transit, or delivery city, intent is DELIVERY_INFORMATION.
   - If customer asks where their order is or order status, intent is ORDER_STATUS.
   - If customer asks general company questions (materials, showroom hours, capabilities), intent is GENERAL_ENQUIRY.
2. DO NOT assume or guess a productName if the customer is merely asking for a meeting, availability, or general consultation without naming a product. Set productName to null unless an actual product was mentioned.
3. If thread Context has a previous product, only carry it over if the customer implies "it" or "the bed" in reference to that product. DO NOT carry it over for new meeting requests or unrelated questions.
`;

        const userPrompt = `Email Subject: ${subject}\nBody:\n${normalizedBody}`;

        let aiResponse;
        try {
            aiResponse = await aiManager.generateResponse({
                systemInstructions: systemInstruction,
                history: [{ role: 'user', content: userPrompt }],
                tools: [],
                config: { temperature: 0.1 }
            });
        } catch (error: any) {
            console.error("[ConversationOrchestrator] AI generation failed:", error.message);
            aiResponse = { content: { text: '{}' } };
        }

        let parsedAi: any;
        try {
            let cleanText = aiResponse.content.text || '{}';
            cleanText = cleanText.replace(/^```json/g, '').replace(/```$/g, '').trim();
            parsedAi = JSON.parse(cleanText);
        } catch (e) {
            console.error("[ConversationOrchestrator] AI JSON parsing failed, using fallback", aiResponse.content.text);
            parsedAi = { intent: 'GENERAL_ENQUIRY', entities: {} };
        }

        // Heuristic safeguards to guarantee message-based classification accuracy
        const meetingKeywordsRegex = /\b(free\s+(on|next|this|tomorrow)|when\s+are\s+you\s+free|available|availability|meet|meeting|schedule\s+a\s+(call|meeting|discussion|appointment)|appointment|book\s+a\s+slot|call\s+(you|me|next|this)|discuss\s+over\s+a\s+call|zoom|google\s+meet)\b/i;
        const isMeetingQuery = meetingKeywordsRegex.test(normalizedBody) || meetingKeywordsRegex.test(subject);

        const orderStatusRegex = /\b(where\s+is\s+my\s+order|order\s+status|tracking|track\s+my\s+order|delivery\s+status)\b/i;
        const isOrderStatusQuery = orderStatusRegex.test(normalizedBody) || orderStatusRegex.test(subject);

        let finalIntent = parsedAi.intent || 'GENERAL_ENQUIRY';
        if (isMeetingQuery && finalIntent !== 'QUOTATION_ACCEPTANCE') {
            finalIntent = 'MEETING_REQUEST';
        } else if (isOrderStatusQuery && finalIntent !== 'QUOTATION_ACCEPTANCE') {
            finalIntent = 'ORDER_STATUS';
        }

        // Inheritance logic (Strictly Message-Aware)
        let extracted = {
            intent: finalIntent,
            productName: parsedAi.entities?.productName || null,
            quantity: parsedAi.entities?.quantity || 1,
            deliveryLocation: parsedAi.entities?.deliveryCity || null,
            meetingDetails: parsedAi.entities?.meetingDetails || {
                requestedTimeframe: null,
                meetingType: 'UNSPECIFIED',
                topic: null
            },
            threadId: threadId
        };

        // Only inherit previous product if current message refers to it and isn't a standalone meeting or order query
        const referencesPreviousProduct = /\b(it|that|this|the\s+bed|the\s+wardrobe|the\s+item|the\s+furniture|the\s+quote|the\s+quotation|proceed|confirm)\b/i.test(normalizedBody);
        if (previousEnquiry && previousEnquiry.structuredData && extracted.intent !== 'MEETING_REQUEST' && extracted.intent !== 'ORDER_STATUS') {
            const prevData: any = previousEnquiry.structuredData;
            if (!extracted.productName && prevData.productName && referencesPreviousProduct) {
                extracted.productName = prevData.productName;
            }
            if (!extracted.deliveryLocation && prevData.deliveryLocation) {
                extracted.deliveryLocation = prevData.deliveryLocation;
            }
            if (extracted.quantity === 1 && prevData.quantity > 1 && referencesPreviousProduct) {
                extracted.quantity = prevData.quantity;
            }
        }

        // STEP 5 - ENTITY RESOLUTION & KNOWLEDGE RETRIEVAL
        let matchedProduct = null;
        if (extracted.productName && extracted.intent !== 'MEETING_REQUEST') {
            const retrieval = await HybridRetrievalEngine.retrieve({ 
                businessId, query: extracted.productName, topK: 1
            });
            if (retrieval.matched && retrieval.sku) {
                matchedProduct = {
                    sku: retrieval.sku,
                    productName: retrieval.productName || extracted.productName,
                    basePrice: retrieval.answerableFacts['price']?.value || 0,
                    productionDays: retrieval.answerableFacts['productionDays']?.value || 7,
                    warranty: retrieval.answerableFacts['warranty']?.value || 'Standard'
                };
                extracted.productName = matchedProduct.productName;
            }
        }

        // STEP 7 - STATE-AWARE DECISION & ACTION PLAN
        const actionPlan = this.determineActionPlan(extracted, existingQuotation, matchedProduct);
        console.log(`[ConversationOrchestrator] ActionPlan Selected: ${actionPlan.primaryAction} (Intent: ${extracted.intent})`);

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
        throw error;
    }
  }

  private static normalizeEmailBody(body: string): string {
      if (!body) return '';
      let text = body.replace(/<[^>]*>?/gm, ' ');
      text = text.split(/On .* wrote:/)[0];
      return text.replace(/\s+/g, ' ').trim();
  }

  private static determineActionPlan(extracted: any, existingQuotation: any, matchedProduct: any) {
      if (extracted.intent === 'MEETING_REQUEST') {
          return { primaryAction: 'SCHEDULE_MEETING' };
      }
      if (extracted.intent === 'QUOTATION_ACCEPTANCE' && existingQuotation) {
          return { primaryAction: 'ACCEPT_QUOTATION' };
      }
      if (extracted.intent === 'QUOTATION_REQUESTED' && matchedProduct) {
          return { primaryAction: 'CREATE_QUOTATION' };
      }
      if (extracted.intent === 'PRODUCT_PRICE' && matchedProduct) {
          return { primaryAction: 'SEND_PRICE_INFO' };
      }
      if (extracted.intent === 'ORDER_STATUS') {
          return { primaryAction: 'CHECK_ORDER_STATUS' };
      }
      if (extracted.intent === 'PRODUCTION_TIME' && matchedProduct) {
          return { primaryAction: 'SEND_PRODUCTION_TIME' };
      }
      if (extracted.intent === 'DELIVERY_INFORMATION') {
          return { primaryAction: 'SEND_DELIVERY_INFO' };
      }
      return { primaryAction: 'HANDLE_GENERAL_ENQUIRY' };
  }

  private static async getAvailableMeetingSlots(businessId: string, timeframeHint?: string): Promise<{ slotLabel: string; startIso: string; endIso: string }[]> {
      try {
          const { google } = require('googleapis');
          const creds = await prisma.integrationCredential.findFirst({
              where: { integration: { businessId, provider: 'GOOGLE_CALENDAR', status: 'CONNECTED' } }
          });

          let calendarClient: any = null;
          if (creds) {
              const { decrypt, encrypt } = require('../encryption');
              let accessToken = decrypt(creds.accessTokenEncrypted);
              const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);

              if (creds.refreshTokenEncrypted) {
                  oauth2Client.setCredentials({
                      access_token: accessToken,
                      refresh_token: decrypt(creds.refreshTokenEncrypted)
                  });
                  if (creds.expiresAt && creds.expiresAt.getTime() < Date.now() + 60000) {
                      try {
                          const { credentials } = await oauth2Client.refreshAccessToken();
                          if (credentials.access_token) {
                              accessToken = credentials.access_token;
                              oauth2Client.setCredentials(credentials);
                              await prisma.integrationCredential.update({
                                  where: { id: creds.id },
                                  data: {
                                      accessTokenEncrypted: encrypt(accessToken),
                                      expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null
                                  }
                              });
                          }
                      } catch (e: any) {
                          console.warn('[ConversationOrchestrator] Calendar refresh token error:', e.message);
                      }
                  }
              } else {
                  oauth2Client.setCredentials({ access_token: accessToken });
              }
              calendarClient = google.calendar({ version: 'v3', auth: oauth2Client });
          }

          const now = new Date();
          const isNextWeek = (timeframeHint || '').toLowerCase().includes('next week');

          let startDay = new Date(now);
          if (isNextWeek) {
              const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday
              const daysUntilNextMonday = ((8 - dayOfWeek) % 7) || 7;
              startDay.setDate(now.getDate() + daysUntilNextMonday);
          } else {
              startDay.setDate(now.getDate() + 1);
          }
          startDay.setHours(10, 0, 0, 0);

          let existingEvents: any[] = [];
          if (calendarClient) {
              const windowEnd = new Date(startDay);
              windowEnd.setDate(windowEnd.getDate() + 7);
              try {
                  const res = await calendarClient.events.list({
                      calendarId: 'primary',
                      timeMin: startDay.toISOString(),
                      timeMax: windowEnd.toISOString(),
                      singleEvents: true,
                      orderBy: 'startTime'
                  });
                  existingEvents = res.data.items || [];
              } catch (calErr: any) {
                  console.warn('[ConversationOrchestrator] Failed to query calendar events:', calErr.message);
              }
          }

          const proposedSlots: { slotLabel: string; startIso: string; endIso: string }[] = [];
          const candidateHours = [
              { hour: 11, minute: 0, label: '11:00 AM' },
              { hour: 14, minute: 30, label: '2:30 PM' },
              { hour: 16, minute: 30, label: '4:30 PM' }
          ];

          const pad = (n: number) => String(n).padStart(2, '0');

          let cursorDate = new Date(startDay);
          for (let dayOffset = 0; dayOffset < 7 && proposedSlots.length < 3; dayOffset++) {
              const checkDate = new Date(cursorDate);
              checkDate.setDate(cursorDate.getDate() + dayOffset);

              // Skip Sundays
              if (checkDate.getDay() === 0) continue;

              const dayName = checkDate.toLocaleDateString('en-US', { weekday: 'long' });
              const monthName = checkDate.toLocaleDateString('en-US', { month: 'short' });
              const dayNum = checkDate.getDate();
              const year = checkDate.getFullYear();
              const month = pad(checkDate.getMonth() + 1);
              const dayStr = pad(dayNum);

              for (const slot of candidateHours) {
                  if (proposedSlots.length >= 3) break;

                  const startIso = `${year}-${month}-${dayStr}T${pad(slot.hour)}:${pad(slot.minute)}:00+05:30`;
                  const endHour = slot.hour + Math.floor((slot.minute + 45) / 60);
                  const endMinute = (slot.minute + 45) % 60;
                  const endIso = `${year}-${month}-${dayStr}T${pad(endHour)}:${pad(endMinute)}:00+05:30`;

                  const slotStartUtc = new Date(startIso);
                  const slotEndUtc = new Date(endIso);

                  const hasConflict = existingEvents.some(ev => {
                      const evStart = new Date(ev.start?.dateTime || ev.start?.date || '');
                      const evEnd = new Date(ev.end?.dateTime || ev.end?.date || '');
                      return slotStartUtc < evEnd && slotEndUtc > evStart;
                  });

                  if (!hasConflict) {
                      proposedSlots.push({
                          slotLabel: `${dayName}, ${monthName} ${dayNum} at ${slot.label} IST`,
                          startIso,
                          endIso
                      });
                  }
              }
          }

          if (proposedSlots.length > 0) {
              return proposedSlots;
          }

          // Fallback if no free slot found
          return [
              {
                  slotLabel: 'Next Monday at 11:00 AM IST',
                  startIso: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                  endIso: new Date(Date.now() + 24 * 3600 * 1000 + 45 * 60 * 1000).toISOString()
              }
          ];
      } catch (err: any) {
          console.error('[ConversationOrchestrator] Error getting meeting slots:', err.message);
          return [
              {
                  slotLabel: 'Next Monday at 11:00 AM IST',
                  startIso: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                  endIso: new Date(Date.now() + 24 * 3600 * 1000 + 45 * 60 * 1000).toISOString()
              }
          ];
      }
  }

  private static async bookGoogleCalendarMeeting(
      businessId: string,
      customer: any,
      slot: { slotLabel: string; startIso: string; endIso: string },
      topic?: string
  ): Promise<{ success: boolean; eventId?: string; meetLink?: string; calendarLink?: string }> {
      try {
          const { google } = require('googleapis');
          const creds = await prisma.integrationCredential.findFirst({
              where: { integration: { businessId, provider: 'GOOGLE_CALENDAR', status: 'CONNECTED' } }
          });
          if (!creds) {
              console.warn('[ConversationOrchestrator] No Google Calendar credential found to book event.');
              return { success: false };
          }

          const { decrypt, encrypt } = require('../encryption');
          let accessToken = decrypt(creds.accessTokenEncrypted);
          const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);

          if (creds.refreshTokenEncrypted) {
              oauth2Client.setCredentials({
                  access_token: accessToken,
                  refresh_token: decrypt(creds.refreshTokenEncrypted)
              });
              if (creds.expiresAt && creds.expiresAt.getTime() < Date.now() + 60000) {
                  try {
                      const { credentials } = await oauth2Client.refreshAccessToken();
                      if (credentials.access_token) {
                          accessToken = credentials.access_token;
                          oauth2Client.setCredentials(credentials);
                          await prisma.integrationCredential.update({
                              where: { id: creds.id },
                              data: {
                                  accessTokenEncrypted: encrypt(accessToken),
                                  expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null
                              }
                          });
                      }
                  } catch (e: any) {
                      console.warn('[ConversationOrchestrator] Calendar refresh error:', e.message);
                  }
              }
          } else {
              oauth2Client.setCredentials({ access_token: accessToken });
          }

          const calendarClient = google.calendar({ version: 'v3', auth: oauth2Client });

          const event = {
              summary: `Aasha Furniture Discussion with ${customer.name || 'Customer'}`,
              description: `Discussion regarding custom furniture and requirements.${topic ? ` Topic: ${topic}` : ''}`,
              start: {
                  dateTime: slot.startIso,
                  timeZone: 'Asia/Kolkata'
              },
              end: {
                  dateTime: slot.endIso,
                  timeZone: 'Asia/Kolkata'
              },
              attendees: customer.email ? [{ email: customer.email, displayName: customer.name || 'Customer' }] : [],
              conferenceData: {
                  createRequest: {
                      requestId: `meet-${Date.now()}`,
                      conferenceSolutionKey: { type: 'hangoutsMeet' }
                  }
              }
          };

          const res = await calendarClient.events.insert({
              calendarId: 'primary',
              requestBody: event,
              conferenceDataVersion: 1,
              sendUpdates: 'all'
          });

          console.log(`[ConversationOrchestrator] Google Calendar event booked successfully: ${res.data.id}`);
          return {
              success: true,
              eventId: res.data.id,
              meetLink: res.data.hangoutLink,
              calendarLink: res.data.htmlLink
          };
      } catch (err: any) {
          console.error('[ConversationOrchestrator] Error booking calendar meeting:', err.message);
          return { success: false };
      }
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

      if (actionPlan.primaryAction === 'SCHEDULE_MEETING') {
          const slots = await this.getAvailableMeetingSlots(
              businessId,
              extracted.meetingDetails?.requestedTimeframe || body
          );

          // Select the single best available slot ("any one available date is enough")
          const chosenSlot = slots[0];

          // Mark/book the event directly in Google Calendar and invite the customer
          const bookingResult = await this.bookGoogleCalendarMeeting(
              businessId,
              customer,
              chosenSlot,
              extracted.meetingDetails?.topic
          );

          const meetLinkLine = bookingResult.meetLink 
              ? `<p><strong>Google Meet Link:</strong> <a href="${bookingResult.meetLink}">${bookingResult.meetLink}</a></p>`
              : '';

          replyHtml = `
            <p>Dear ${customer.name || 'Customer'},</p>
            <p>Thank you for reaching out! We would be delighted to connect for a discussion.</p>
            <p>I have scheduled our meeting and marked it in Google Calendar for:</p>
            <p style="font-size: 16px; margin: 12px 0;"><strong>📅 ${chosenSlot.slotLabel}</strong></p>
            ${meetLinkLine}
            <p>A Google Calendar invitation has been sent directly to your email address (<strong>${customer.email}</strong>).</p>
            <p>We can connect either:</p>
            <ol>
              <li><strong>Virtually</strong> via Google Meet (using the link above / in your invite), or</li>
              <li><strong>In-person</strong> at our workshop & showroom (Open Mon–Sat, 10:00 AM – 6:00 PM IST).</li>
            </ol>
            <p>If this date or time doesn't work for your schedule, simply reply to this email with your preferred timing and we will gladly reschedule.</p>
            <br>
            <p>Warm regards,<br>Aasha Furniture Team</p>
          `;
          return { replyHtml };
      }

      if (actionPlan.primaryAction === 'CHECK_ORDER_STATUS') {
          const orders = await prisma.order.findMany({
              where: { businessId, customerId: customer.id },
              orderBy: { createdAt: 'desc' },
              take: 3
          });

          if (orders.length > 0) {
              const orderList = orders.map(o => `<li>Order #${o.id.slice(-6).toUpperCase()}: Status: <strong>${o.status}</strong></li>`).join('');
              replyHtml = `
                <p>Dear ${customer.name || 'Customer'},</p>
                <p>Thank you for checking in on your order. Here is the latest status:</p>
                <ul>${orderList}</ul>
                <p>If you need any specific delivery timing or expedited dispatch, please let us know.</p>
                <br>
                <p>Warm regards,<br>Aasha Furniture Team</p>
              `;
          } else {
              replyHtml = `
                <p>Dear ${customer.name || 'Customer'},</p>
                <p>Thank you for reaching out regarding your order status.</p>
                <p>We could not locate an active order linked directly to this email address (${customer.email}). Could you please share your Order Number or Quotation Reference so our dispatch team can check right away?</p>
                <br>
                <p>Warm regards,<br>Aasha Furniture Team</p>
              `;
          }
          return { replyHtml };
      }

      if (actionPlan.primaryAction === 'SEND_PRODUCTION_TIME' && product) {
          replyHtml = `
            <p>Dear ${customer.name || 'Customer'},</p>
            <p>Thank you for your interest in our ${product.productName}.</p>
            <p>Our standard production lead time is <strong>${product.productionDays} working days</strong>. Every piece is handcrafted by our master carpenters using premium seasoned timber to ensure enduring strength and quality.</p>
            <p>Please let us know if you would like us to reserve a production slot or prepare a formal quotation for you.</p>
            <br>
            <p>Warm regards,<br>Aasha Furniture Team</p>
          `;
          return { replyHtml };
      }

      if (actionPlan.primaryAction === 'SEND_DELIVERY_INFO') {
          replyHtml = `
            <p>Dear ${customer.name || 'Customer'},</p>
            <p>Thank you for inquiring about our delivery options.</p>
            <p>We provide insured delivery across all major cities in India${extracted.deliveryLocation ? ` including ${extracted.deliveryLocation}` : ''}. Each piece is securely crated and delivered with professional handling to guarantee it arrives in pristine condition.</p>
            <p>Please share your exact delivery address or pin code if you would like an exact transit timeline and delivery quotation.</p>
            <br>
            <p>Warm regards,<br>Aasha Furniture Team</p>
          `;
          return { replyHtml };
      }

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
              const taxMatch = (await require('../knowledge').knowledgeService.searchKnowledgeBase({businessId, query:'tax rate', topK:1}))[0]?.content || '18';
              const taxRate = parseFloat(taxMatch.match(/(\d+)/)?.[0] || '18');
              
              const lineItems = [{
                  sku: product.sku, description: product.productName,
                  quantity: extracted.quantity, unitPrice: product.basePrice,
                  discount: 0, taxRate
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

          const taxRateMatch = (await require('../knowledge').knowledgeService.searchKnowledgeBase({businessId, query:'tax rate', topK:1}))[0]?.content || '18';
          const taxRate = parseFloat(taxRateMatch.match(/(\d+)/)?.[0] || '18');
          
          const subtotal = product.basePrice * extracted.quantity;
          const tax = subtotal * (taxRate / 100);
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
          const taxRateMatch = (await require('../knowledge').knowledgeService.searchKnowledgeBase({businessId, query:'tax rate', topK:1}))[0]?.content || '18';
          const taxRate = parseFloat(taxRateMatch.match(/(\d+)/)?.[0] || '18');

          const subtotal = product.basePrice * extracted.quantity;
          const tax = subtotal * (taxRate / 100);
          const total = subtotal + tax;

          replyHtml = `
            <p>Dear ${customer.name || 'Customer'},</p>
            <p>Thank you for your interest in our ${product.productName}.</p>
            <p>Here are the details:</p>
            <ul>
              <li>Product: ${product.productName}</li>
              <li>Quantity: ${extracted.quantity}</li>
              <li>Base Price: ₹${product.basePrice.toLocaleString('en-IN')}</li>
              <li>GST (${taxRate}%): ₹${tax.toLocaleString('en-IN')}</li>
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

      if (actionPlan.primaryAction === 'HANDLE_GENERAL_ENQUIRY') {
          let generatedReply = '';
          try {
              const enquiryAi = await aiManager.generateResponse({
                  systemInstructions: `You are the customer service representative for Aasha Furniture (premium custom furniture manufacturer in India).
Draft a concise, warm, and professional email response addressing the customer's specific message.
Rules:
1. Address the customer as "Dear ${customer.name || 'Customer'},".
2. Directly answer their question based on the content of their email.
3. If they asked about visiting the showroom or store hours, mention Monday to Saturday, 10:00 AM to 6:00 PM IST.
4. If they asked about custom designs, confirm that we craft custom furniture to custom dimensions and specifications.
5. Do NOT ask them for an arbitrary furniture piece unless they explicitly mentioned looking for something unspecified.
6. Format the reply cleanly using HTML tags (<p>, <ul>, <li>). Do not use markdown backticks.
7. End with:
<br>
<p>Warm regards,<br>Aasha Furniture Team</p>`,
                  history: [{
                      role: 'user',
                      content: `Customer Email Subject: ${subject}\nCustomer Email Body:\n${body}`
                  }],
                  tools: [],
                  config: { temperature: 0.2 }
              });

              let raw = enquiryAi.content?.text || '';
              raw = raw.replace(/^```html/gi, '').replace(/```$/g, '').trim();
              if (raw && raw.length > 20) {
                  generatedReply = raw;
              }
          } catch (e: any) {
              console.warn('[ConversationOrchestrator] Dynamic AI reply generation failed, using fallback:', e.message);
          }

          if (!generatedReply) {
              generatedReply = `
                <p>Dear ${customer.name || 'Customer'},</p>
                <p>Thank you for getting in touch with Aasha Furniture regarding "${subject || 'your enquiry'}".</p>
                <p>We have received your message and our team is reviewing your requirements to provide the best assistance.</p>
                <p>If you have any specific requirements, dimensions, or design references, feel free to reply directly to this email.</p>
                <br>
                <p>Warm regards,<br>Aasha Furniture Team</p>
              `;
          }

          return { replyHtml: generatedReply };
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
