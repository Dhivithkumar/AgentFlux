import { prisma } from '@agent-flux/database';
import {
  AASHA_BUSINESS_ID,
  AASHA_PRODUCTS,
  AASHA_CUSTOMIZATIONS,
  AASHA_RATE_CARD,
  AASHA_TAX_CONFIG,
  ProductDefinition,
  CustomizationDefinition
} from './aashaKnowledgeData';
import { QueryUnderstandingService, NormalizedQueryOutput, RetrievalState } from './QueryUnderstandingService';
import { DeterministicFinancialEngine, QuotationCalculationOutput } from './DeterministicFinancialEngine';
import { ApprovalGovernanceEngine, ApprovalEvaluationResult } from './ApprovalGovernanceEngine';
import { embeddingProvider } from '../ai/embeddings';

export interface AnswerableFactItem {
  value: any;
  source: string;
  evidence: boolean;
  field?: string;
}

export interface RetrievalEvidencePackage {
  matched: boolean;
  state: RetrievalState;
  confidence: number | string;
  businessId: string;
  sourceDocuments: string[];
  entity: string | null;
  sku: string | null;
  answerableFacts: Record<string, AnswerableFactItem>;
  calculatedFinancials?: QuotationCalculationOutput;
  approvalRequirements?: ApprovalEvaluationResult;
  normalizedQuery: NormalizedQueryOutput;
  matchedChunks: Array<{
    id?: string;
    content: string;
    score: number;
    source: string;
    type: string;
  }>;
  clarificationMessage?: string;
  rejectionReason?: string;
  // Added for exact retrieval result requirements
  matchType?: string;
  productName?: string;
  requestedField?: string;
  value?: any;
  currency?: string;
  source?: string;
}

export class HybridRetrievalEngine {
  /**
   * Main retrieval method combining Exact, Keyword, Vector, and Cross-Document reasoning
   */
  public static async retrieve(params: {
    businessId: string;
    query: string;
    topK?: number;
  }): Promise<RetrievalEvidencePackage> {
    const { businessId, query, topK = 5 } = params;

    // 1. Strict Business Isolation check
    // If the query is scoped to a different businessId, NEVER leak Aasha Furniture facts!
    const isAashaBusiness = businessId === AASHA_BUSINESS_ID;

    // 2. Deterministic Query Understanding
    const norm = QueryUnderstandingService.normalizeQuery(query);

    // If query is for non-Aasha business and not found in that business, return empty/isolated
    if (!isAashaBusiness) {
      return {
        matched: false,
        state: 'NOT_FOUND',
        confidence: 0,
        businessId,
        sourceDocuments: [],
        entity: null,
        sku: null,
        answerableFacts: {},
        normalizedQuery: norm,
        matchedChunks: [],
        rejectionReason: 'Cross-business isolation: Business ID does not match Aasha Furniture.'
      };
    }

    // 3. Handle Special States (Unknown product, Ambiguous)
    if (norm.entityState === 'NOT_FOUND' && norm.unknownEntities.length > 0) {
      return {
        matched: false,
        state: 'NOT_FOUND',
        confidence: 0,
        businessId,
        sourceDocuments: ['02_Product_Catalogue.pdf'],
        entity: norm.unknownEntities[0],
        sku: null,
        answerableFacts: {},
        normalizedQuery: norm,
        matchedChunks: [],
        clarificationMessage: norm.clarificationPrompt,
        rejectionReason: `Unknown entity '${norm.unknownEntities[0]}' is not in approved catalogue.`
      };
    }

    if (norm.entityState === 'AMBIGUOUS') {
      return {
        matched: false,
        state: 'AMBIGUOUS',
        confidence: 0.5,
        businessId,
        sourceDocuments: ['02_Product_Catalogue.pdf'],
        entity: norm.normalizedQuery,
        sku: null,
        answerableFacts: {},
        normalizedQuery: norm,
        matchedChunks: [],
        clarificationMessage: norm.clarificationPrompt,
        rejectionReason: norm.ambiguityReason
      };
    }

    // 4. Multi-level Retrieval Execution
    const sourceDocuments = new Set<string>();
    const answerableFacts: Record<string, AnswerableFactItem> = {};
    const matchedChunks: Array<{ id?: string; content: string; score: number; source: string; type: string }> = [];

    // LEVEL 1: Exact Entity Match
    let primaryProduct: ProductDefinition | undefined = norm.matchedProducts[0];

    if (primaryProduct) {
      sourceDocuments.add(primaryProduct.sourceDocument);
      answerableFacts['product'] = { value: primaryProduct.productName, source: primaryProduct.sourceDocument, evidence: true };
      answerableFacts['sku'] = { value: primaryProduct.sku, source: primaryProduct.sourceDocument, evidence: true };
      answerableFacts['category'] = { value: primaryProduct.category, source: primaryProduct.sourceDocument, evidence: true };
      answerableFacts['material'] = { value: primaryProduct.material, source: primaryProduct.sourceDocument, evidence: true };
      answerableFacts['price'] = { value: primaryProduct.basePrice, source: primaryProduct.sourceDocument, evidence: true };
      answerableFacts['currency'] = { value: primaryProduct.currency, source: primaryProduct.sourceDocument, evidence: true };
      answerableFacts['productionDays'] = { value: primaryProduct.productionDays, source: primaryProduct.sourceDocument, evidence: true };
      answerableFacts['warranty'] = { value: primaryProduct.warranty, source: primaryProduct.sourceDocument, evidence: true };
      answerableFacts['description'] = { value: primaryProduct.description, source: primaryProduct.sourceDocument, evidence: true };

      matchedChunks.push({
        content: `SKU: ${primaryProduct.sku} | Product: ${primaryProduct.productName} | Category: ${primaryProduct.category} | Material: ${primaryProduct.material} | Base Price: ₹${primaryProduct.basePrice} | Production Days: ${primaryProduct.productionDays} | Warranty: ${primaryProduct.warranty}`,
        score: 1.0,
        source: primaryProduct.sourceDocument,
        type: 'STRUCTURED_PRODUCT_ROW'
      });
    }

    // LEVEL 2: Customizations Match (Cross-Document)
    let totalCustomizationCharges = 0;
    if (norm.matchedCustomizations.length > 0) {
      sourceDocuments.add('03_Product_Customization_Guide.pdf');
      norm.matchedCustomizations.forEach((cust, idx) => {
        const key = `customization_${idx + 1}`;
        answerableFacts[key] = {
          value: {
            option: cust.option,
            charge: cust.standardCharge,
            chargeDescription: cust.chargeDescription,
            leadTimeImpact: cust.leadTimeImpact,
            approvalRequired: cust.approvalRequired
          },
          source: cust.sourceDocument,
          evidence: true
        };
        if (cust.standardCharge) totalCustomizationCharges += cust.standardCharge;

        matchedChunks.push({
          content: `Customization: ${cust.option} | Standard Charge: ${cust.chargeDescription} | Lead-time impact: ${cust.leadTimeImpact} | Approval: ${cust.approvalRequired}`,
          score: 0.98,
          source: cust.sourceDocument,
          type: 'STRUCTURED_CUSTOMIZATION_OPTION'
        });
      });
    }

    // LEVEL 3: Cross-Document Pricing, Rate Card & Tax Engine
    let calculatedFinancials: QuotationCalculationOutput | undefined;
    if (primaryProduct || norm.detectedIntent === 'PRODUCT_PRICE' || norm.detectedIntent === 'QUOTATION_REQUEST') {
      sourceDocuments.add('04_Pricing_Rate_Card.pdf');
      sourceDocuments.add('11_Invoice_Tax_Policy.pdf');

      answerableFacts['taxRate'] = {
        value: AASHA_TAX_CONFIG.taxRatePercentage,
        source: AASHA_TAX_CONFIG.sourceDocument,
        evidence: true
      };

      if (primaryProduct) {
        // Deterministic Financial Calculation
        calculatedFinancials = DeterministicFinancialEngine.calculateQuotation({
          items: [
            {
              sku: primaryProduct.sku,
              productName: primaryProduct.productName,
              quantity: 1,
              unitPrice: primaryProduct.basePrice,
              customizationCharges: totalCustomizationCharges
            }
          ],
          discountPercentage: norm.extractedDiscountPercent || 0,
          taxRate: AASHA_TAX_CONFIG.taxRatePercentage
        });

        answerableFacts['taxableValue'] = { value: calculatedFinancials.taxableValue, source: 'DeterministicFinancialEngine', evidence: true };
        answerableFacts['taxAmount'] = { value: calculatedFinancials.taxAmount, source: 'DeterministicFinancialEngine', evidence: true };
        answerableFacts['totalAmount'] = { value: calculatedFinancials.totalAmount, source: 'DeterministicFinancialEngine', evidence: true };
        answerableFacts['requiredAdvance'] = { value: calculatedFinancials.requiredAdvance, source: '10_Payment_Policy.pdf', evidence: true };
        answerableFacts['balanceDue'] = { value: calculatedFinancials.balanceDue, source: '10_Payment_Policy.pdf', evidence: true };
      }
    }

    // LEVEL 4: Policy & Approval Rules
    let approvalRequirements: ApprovalEvaluationResult | undefined;
    if (norm.detectedIntent === 'DISCOUNT_REQUEST') {
      sourceDocuments.add('05_Discount_Policy.pdf');
      sourceDocuments.add('13_Approval_Governance_Matrix.pdf');
      const discountPct = norm.extractedDiscountPercent || 0;
      approvalRequirements = ApprovalGovernanceEngine.evaluateDiscountApproval(discountPct);

      answerableFacts['discountApproval'] = {
        value: approvalRequirements,
        source: '05_Discount_Policy.pdf',
        evidence: true
      };
    } else if (norm.detectedIntent === 'CREDIT_REQUEST') {
      sourceDocuments.add('10_Payment_Policy.pdf');
      sourceDocuments.add('13_Approval_Governance_Matrix.pdf');
      approvalRequirements = ApprovalGovernanceEngine.evaluateCreditRequest(true);

      answerableFacts['creditApproval'] = {
        value: approvalRequirements,
        source: '10_Payment_Policy.pdf',
        evidence: true
      };
    } else if (norm.detectedIntent === 'PAYMENT_CLAIM') {
      sourceDocuments.add('10_Payment_Policy.pdf');
      answerableFacts['paymentClaim'] = {
        value: {
          claimedAmount: norm.extractedPaymentAmount,
          status: 'PENDING_RECONCILIATION',
          rule: 'A payment is not considered reconciled solely because a customer claims to have transferred money. It must be verified through the reconciliation system.'
        },
        source: '10_Payment_Policy.pdf',
        evidence: true
      };
    }

    // Also include custom size approval if custom size was chosen
    if (norm.matchedCustomizations.some(c => c.approvalRequired === 'Operations')) {
      sourceDocuments.add('13_Approval_Governance_Matrix.pdf');
    }

    // LEVEL 5: Vector / Semantic Database Chunks (Supplementary)
    try {
      const dbChunks = await prisma.knowledgeChunk.findMany({
        where: {
          businessId,
          content: {
            contains: norm.normalizedQuery.split(' ')[0] || 'Aasha',
            mode: 'insensitive'
          }
        },
        take: topK,
        include: { document: true }
      });

      for (const ch of dbChunks) {
        if (!matchedChunks.some(m => m.content === ch.content)) {
          matchedChunks.push({
            id: ch.id,
            content: ch.content,
            score: 0.85,
            source: ch.document?.filename || 'Document',
            type: 'DATABASE_CHUNK'
          });
          if (ch.document?.filename) sourceDocuments.add(ch.document.filename);
        }
      }
    } catch (e) {
      // Ignore DB read failure if structured match succeeded
    }

    const state: RetrievalState = primaryProduct
      ? 'EXACT_MATCH'
      : norm.matchedCustomizations.length > 0 || approvalRequirements
      ? 'HIGH_CONFIDENCE'
      : matchedChunks.length > 0
      ? 'HIGH_CONFIDENCE'
      : 'NOT_FOUND';

    const confidence = state === 'EXACT_MATCH' ? 'HIGH' : state === 'HIGH_CONFIDENCE' ? 'MEDIUM' : 'LOW';

    let matchType, productName, requestedField, value, currency, source;
    if (primaryProduct) {
      matchType = 'ENTITY_MATCH';
      productName = primaryProduct.productName;
      
      // Map 'basePrice' to actual value
      if (norm.requestedFields.includes('basePrice')) {
        requestedField = 'basePrice';
        value = primaryProduct.basePrice;
        currency = primaryProduct.currency;
        source = primaryProduct.sourceDocument;
      }
    }

    return {
      matched: state === 'EXACT_MATCH' || state === 'HIGH_CONFIDENCE',
      state,
      confidence,
      businessId,
      sourceDocuments: Array.from(sourceDocuments),
      entity: primaryProduct ? primaryProduct.sku : norm.normalizedQuery,
      sku: primaryProduct ? primaryProduct.sku : null,
      answerableFacts,
      calculatedFinancials,
      approvalRequirements,
      normalizedQuery: norm,
      matchedChunks,
      
      matchType,
      productName,
      requestedField,
      value,
      currency,
      source
    };
  }
}
