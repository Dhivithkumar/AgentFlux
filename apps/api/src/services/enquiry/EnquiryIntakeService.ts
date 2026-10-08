import { prisma, EnquiryStatus, EnquiryConfidence } from '@agent-flux/database';
import { customerResolutionService, CustomerResolutionParams } from './CustomerResolutionService';
import { contextBuilder } from '../knowledge/ContextBuilder';
import { aiManager } from '../ai';
import { EventBus } from '../eventBus';
import { GroundedResponseService } from '../knowledge/GroundedResponseService';
import { HybridRetrievalEngine } from '../knowledge/HybridRetrievalEngine';

export interface SubmitEnquiryParams {
  businessId: string;
  source: string;
  customer: Omit<CustomerResolutionParams, 'businessId' | 'source'>;
  message: string;
  externalId?: string; // Used for idempotency mapping
}

export interface AIExtractionResult {
  summary: string;
  fields: Record<string, any>;
  missingRequiredFields: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  nextAction: string;
}

export class EnquiryIntakeService {
  constructor() {
  }

  async submitEnquiry(params: SubmitEnquiryParams) {
    const { businessId, source, customer, message, externalId } = params;

    // 1. Idempotency Check (optional external deduplication)
    if (externalId) {
      const existingEnquiry = await prisma.enquiry.findFirst({
        where: { businessId, source, subject: externalId }
      });
      if (existingEnquiry) {
        return existingEnquiry; // Idempotent return
      }
    }

    // 2. Resolve Customer (Business-Scoped)
    const resolvedCustomer = await customerResolutionService.resolveCustomer({
      businessId,
      source,
      ...customer
    });

    // 3. Build Agent Context (includes Business Profile, Fields, Knowledge, Workflow Config)
    const context = await contextBuilder.buildAgentContext({
      businessId,
      workflowType: 'ENQUIRY_INTAKE',
      task: message,
      customerId: resolvedCustomer.id
    });

    // 4. Grounded Response & Evidence Resolution (Zero Hallucination)
    const evidence = context.evidencePackage || (await HybridRetrievalEngine.retrieve({ businessId, query: message }));
    const groundedResult = await GroundedResponseService.generateResponse({
      customerName: resolvedCustomer.name || 'Valued Customer',
      message,
      evidence
    });

    // 5. Construct AI Schema Dynamically & Extract fields
    const aiSchema = this.buildAISchemaFromFields(context.fields);
    const extractionResult = await this.extractWithAI(message, context, aiSchema);

    // 6. Validate Output (Strict field typing and requirement validation)
    const validation = this.validateExtractedFields(extractionResult, context.fields);

    // 7. Determine Final Confidence & Status based on Grounded Evidence
    let finalConfidence: EnquiryConfidence = 'HIGH';
    let finalStatus: EnquiryStatus = 'READY';
    let nextAction = 'RESPOND_TO_CUSTOMER';

    if (groundedResult.status === 'NOT_FOUND') {
      finalStatus = 'NEEDS_INFORMATION';
      nextAction = 'UNKNOWN_PRODUCT_MANUAL_REVIEW';
      finalConfidence = 'LOW';
    } else if (groundedResult.status === 'AMBIGUOUS' || validation.missingRequiredFields.length > 0) {
      finalStatus = 'NEEDS_INFORMATION';
      nextAction = 'REQUEST_MISSING_INFORMATION';
      finalConfidence = 'LOW';
    } else if (groundedResult.status === 'APPROVAL_REQUIRED') {
      finalStatus = 'PROCESSING';
      nextAction = 'APPROVAL_PENDING';
      finalConfidence = 'HIGH';
    } else if (groundedResult.status === 'ANSWERED') {
      finalStatus = 'READY';
      nextAction = 'RESPOND_TO_CUSTOMER';
      finalConfidence = 'HIGH';
    } else {
      finalStatus = 'PROCESSING';
      nextAction = 'MANUAL_REVIEW';
      finalConfidence = 'MEDIUM';
    }

    // Store grounded response and facts in structuredData
    const sanitizedFields = {
      ...validation.sanitizedFields,
      groundedResponse: groundedResult.response,
      groundedFacts: groundedResult.groundedFacts,
      groundedStatus: groundedResult.status,
      requiresApproval: groundedResult.requiresApproval,
      evidenceSourceDocuments: evidence.sourceDocuments,
      validationPassed: groundedResult.validationPassed
    };

    // 8. Persist Enquiry
    const enquiry = await prisma.enquiry.create({
      data: {
        businessId,
        customerId: resolvedCustomer.id,
        workflowId: context.workflow?.category ? undefined : undefined,
        source,
        subject: externalId || null,
        rawMessage: message,
        summary: groundedResult.response.slice(0, 500),
        structuredData: sanitizedFields,
        confidence: finalConfidence,
        status: finalStatus,
        nextAction
      }
    });

    // 9. Fire durable async operational sync
    import('../queue/operationalSyncPoller').then(mod => {
      mod.operationalSyncPoller.enqueue(businessId, 'ENQUIRY', enquiry.id, 'CREATE').catch(console.error);
      mod.operationalSyncPoller.enqueue(businessId, 'CUSTOMER', resolvedCustomer.id, 'UPDATE').catch(console.error);
    });

    // 10. Dispatch Application Event for Workflow Engine
    await EventBus.publish(businessId, 'ENQUIRY_CREATED', { enquiry, customer: resolvedCustomer });

    return enquiry;
  }


  private buildAISchemaFromFields(fields: any[]) {
    const properties: any = {
      summary: {
        type: 'string',
        description: 'A very short summary of the user\'s core request.'
      },
      confidence: {
        type: 'string',
        description: 'How confident are you in the extraction? Use HIGH, MEDIUM, or LOW.'
      },
      nextAction: {
        type: 'string',
        description: 'Suggested next action based on the request (e.g., BOOK_APPOINTMENT, PROVIDE_QUOTE).'
      },
      fields: {
        type: 'object',
        properties: {},
        required: []
      }
    };

    for (const field of fields) {
      let fieldType = 'string';
      if (field.type === 'NUMBER') fieldType = 'number';
      if (field.type === 'BOOLEAN') fieldType = 'boolean';
      if (field.type === 'SELECT' || field.type === 'MULTI_SELECT') fieldType = 'string'; // Can use enum or let validation handle it

      properties.fields.properties[field.fieldKey] = {
        type: fieldType,
        description: `Field label: ${field.label}`
      };
      // We do not enforce AI to strictly provide required fields because they might be missing in the text
    }

    return {
      type: 'object',
      properties,
      required: ['summary', 'confidence', 'fields']
    };
  }

  private async extractWithAI(message: string, context: any, aiSchema: any): Promise<AIExtractionResult> {
    const prompt = `You are a universal business assistant handling an incoming enquiry.
Your job is to extract structured information from the raw user message based on the active business fields.

### Business Context:
Name: ${context.business.name}
Industry: ${context.business.industry}

### Knowledge Context (Use this to understand context, but DO NOT invent data):
${JSON.stringify(context.knowledge, null, 2)}

### Available Fields to Extract:
${JSON.stringify(context.fields, null, 2)}

### User Message:
"${message}"

Extract the data from the user message. Only populate a field if the user provided it or if it is heavily implied.
Do not invent information. Do not use fields that are not in the "Available Fields to Extract" list.`;

    const rawOutput = await aiManager.generateStructured<any>({ prompt, schema: aiSchema });

    return {
      summary: rawOutput.summary || 'Enquiry received',
      fields: rawOutput.fields || {},
      missingRequiredFields: [], // Will be computed in validation
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(rawOutput.confidence) ? rawOutput.confidence : 'MEDIUM',
      nextAction: rawOutput.nextAction || 'REVIEW'
    };
  }

  private validateExtractedFields(extraction: AIExtractionResult, fieldDefs: any[]) {
    const sanitizedFields: Record<string, any> = {};
    const missingRequiredFields: string[] = [];

    for (const def of fieldDefs) {
      const extractedValue = extraction.fields[def.fieldKey];

      if (extractedValue !== undefined && extractedValue !== null && extractedValue !== '') {
        // Basic type validation
        if (def.type === 'NUMBER' && isNaN(Number(extractedValue))) {
          // Ignore invalid numbers
        } else {
          sanitizedFields[def.fieldKey] = extractedValue;
        }
      } else if (def.required) {
        missingRequiredFields.push(def.fieldKey);
      }
    }

    // Re-evaluate confidence
    let confidence = extraction.confidence;
    if (missingRequiredFields.length > 0) {
      confidence = 'LOW';
    }

    return {
      sanitizedFields,
      missingRequiredFields,
      confidence
    };
  }
}

export const enquiryIntakeService = new EnquiryIntakeService();
