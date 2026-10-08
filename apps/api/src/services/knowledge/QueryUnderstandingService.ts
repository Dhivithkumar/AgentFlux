import {
  AASHA_PRODUCTS,
  AASHA_CUSTOMIZATIONS,
  AASHA_RATE_CARD,
  ProductDefinition,
  CustomizationDefinition,
  normalizeEntityText
} from './aashaKnowledgeData';

export type RetrievalState =
  | 'EXACT_MATCH'
  | 'HIGH_CONFIDENCE'
  | 'LOW_CONFIDENCE'
  | 'AMBIGUOUS'
  | 'NOT_FOUND'
  | 'CONFLICTING_INFORMATION';

export interface NormalizedQueryOutput {
  originalQuery: string;
  normalizedQuery: string;
  detectedIntent:
    | 'PRODUCT_INFORMATION'
    | 'PRODUCT_PRICE'
    | 'CUSTOMIZATION_REQUEST'
    | 'QUOTATION_REQUEST'
    | 'QUOTATION_ACCEPTANCE'
    | 'DISCOUNT_REQUEST'
    | 'ORDER_STATUS'
    | 'ORDER_REQUEST'
    | 'PAYMENT_CLAIM'
    | 'CREDIT_REQUEST'
    | 'CANCELLATION_REQUEST'
    | 'REFUND_REQUEST'
    | 'POLICY_QUERY'
    | 'GENERAL_ENQUIRY';
  entityState: RetrievalState;
  matchedProducts: ProductDefinition[];
  matchedCustomizations: CustomizationDefinition[];
  unknownEntities: string[];
  ambiguityReason?: string;
  clarificationPrompt?: string;
  requestedFields: string[];
  extractedDiscountPercent?: number;
  extractedPaymentAmount?: number;
  extractedQuantity?: number;
  extractedDeliveryLocation?: string;
  extractedInstallation?: boolean;
}

export class QueryUnderstandingService {
  /**
   * Deterministic query normalization and entity resolution.
   * LLM is not allowed to invent arbitrary business entities or values here.
   */
  public static normalizeQuery(query: string): NormalizedQueryOutput {
    const raw = (query || '').trim();
    const lower = raw.toLowerCase();

    // 1. Detect requested fields
    const requestedFields: string[] = [];
    if (/price|cost|how much|rate|charge/i.test(lower)) requestedFields.push('basePrice');
    if (/warranty|guarantee/i.test(lower)) requestedFields.push('warranty');
    if (/material|wood|fabric/i.test(lower)) requestedFields.push('material');
    if (/days|time|duration|lead time|delivery/i.test(lower)) requestedFields.push('productionDays');
    if (/sku|code/i.test(lower)) requestedFields.push('sku');

    // 2. Detect high-level intents
    let intent: NormalizedQueryOutput['detectedIntent'] = 'GENERAL_ENQUIRY';
    if (/discount|rebate|percent off|% off/i.test(lower)) {
      intent = 'DISCOUNT_REQUEST';
    } else if (/credit|pay later|credit sale|on credit/i.test(lower)) {
      intent = 'CREDIT_REQUEST';
    } else if (/transferred|paid|payment sent|receipt|upi transfer|bank transfer/i.test(lower)) {
      intent = 'PAYMENT_CLAIM';
    } else if (/cancel|cancellation/i.test(lower)) {
      intent = 'CANCELLATION_REQUEST';
    } else if (/refund|money back/i.test(lower)) {
      intent = 'REFUND_REQUEST';
    } else if (/quote|quotation|estimate/i.test(lower) && !/accept|confirm|proceed/i.test(lower)) {
      intent = 'QUOTATION_REQUEST';
    } else if (/proceed|accept|confirm|go ahead/i.test(lower) || /place the order/i.test(lower) || /purchase the quoted/i.test(lower)) {
      // Check for ambiguous or revision modifiers
      if (/instead of|but|change|reduce|discount|more information|think about it|maybe|get back/i.test(lower)) {
        intent = 'QUOTATION_REQUEST'; // Routing back to revision
      } else {
        intent = 'QUOTATION_ACCEPTANCE';
      }
    } else if (requestedFields.includes('basePrice')) {
      intent = 'PRODUCT_PRICE';
    } else if (/custom|customize|customization|polish|fabric|drawer/i.test(lower)) {
      intent = 'CUSTOMIZATION_REQUEST';
    } else if (/product|catalogue|wardrobe|bed|sofa|table|chair/i.test(lower)) {
      intent = 'PRODUCT_INFORMATION';
    }

    // 3. Extract numbers for discount / payment if applicable
    let extractedDiscountPercent: number | undefined;
    const discountMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/);
    if (discountMatch) {
      extractedDiscountPercent = parseFloat(discountMatch[1]);
    }

    let extractedPaymentAmount: number | undefined;
    const paymentMatch = lower.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)|([\d,]+)\s*(?:rupees|inr)/i);
    if (paymentMatch) {
      const numStr = (paymentMatch[1] || paymentMatch[2]).replace(/,/g, '');
      extractedPaymentAmount = parseFloat(numStr);
    }

    let extractedQuantity: number | undefined;
    const qtyMatch = lower.match(/\b(\d+)\s+(?:x\s+)?(?:[a-z0-9\-]+\s+)*(?:sofa|bed|table|chair|wardrobe|item|piece)s?\b/i);
    if (qtyMatch) {
      extractedQuantity = parseInt(qtyMatch[1], 10);
    }

    let extractedDeliveryLocation: string | undefined;
    if (/delivery location is ([a-z]+)/i.test(lower)) {
      const locMatch = lower.match(/delivery location is ([a-z]+)/i);
      if (locMatch) extractedDeliveryLocation = locMatch[1];
    } else if (/delivery(?: to| in) ([a-z]+)/i.test(lower)) {
      const locMatch = lower.match(/delivery(?: to| in) ([a-z]+)/i);
      if (locMatch) extractedDeliveryLocation = locMatch[1];
    }

    const extractedInstallation = /include installation|with installation/i.test(lower);

    // 4. Resolve Customizations FIRST
    const matchedCustomizations: CustomizationDefinition[] = [];
    for (const cust of AASHA_CUSTOMIZATIONS) {
      for (const alias of cust.aliases) {
        if (lower.includes(alias)) {
          if (!matchedCustomizations.some(c => c.id === cust.id)) {
            matchedCustomizations.push(cust);
          }
          break;
        }
      }
    }

    // 5. Resolve Products
    // A. Check for explicit unsupported/unknown products first
    const unknownEntities: string[] = [];
    if (/5\s*[- ]?door\s*wardrobe|five\s*[- ]?door\s*wardrobe/i.test(lower)) {
      unknownEntities.push('5-Door Wardrobe');
      return {
        originalQuery: raw,
        normalizedQuery: '5-door wardrobe',
        detectedIntent: 'PRODUCT_INFORMATION',
        entityState: 'NOT_FOUND',
        matchedProducts: [],
        matchedCustomizations: [],
        unknownEntities: ['5-Door Wardrobe'],
        requestedFields,
        clarificationPrompt:
          "We couldn't find a 5-door wardrobe in the current Aasha Furniture catalogue. If you'd like, please share any additional specification or let us know if you would like us to check whether a custom configuration can be considered."
      };
    }

    if (/plastic|lawn chair|lawn\b|bean bag|metal bed|steel cupboard/i.test(lower)) {
      return {
        originalQuery: raw,
        normalizedQuery: raw,
        detectedIntent: 'PRODUCT_INFORMATION',
        entityState: 'NOT_FOUND',
        matchedProducts: [],
        matchedCustomizations: [],
        unknownEntities: [raw],
        requestedFields,
        clarificationPrompt:
          "We couldn't find that item in the current Aasha Furniture catalogue. Aasha Furniture specializes in solid teak and premium engineered wood residential furniture. Please let us know if you would like to explore custom wooden configurations."
      };
    }

    // B. Entity Resolution Pipeline
    const matchedProducts: ProductDefinition[] = [];
    const normalizedQueryStr = normalizeEntityText(raw);
    const queryTokens = new Set(normalizedQueryStr.split(' ').filter(x => x.length > 0));

    for (const prod of AASHA_PRODUCTS) {
      let isMatch = false;

      // 1. Exact SKU Match
      if (new RegExp(`\\b${prod.sku}\\b`, 'i').test(raw)) {
        isMatch = true;
      }
      
      // 2. Exact Normalized Product Name Lookup
      else if (prod.normalizedProductName && normalizedQueryStr.includes(prod.normalizedProductName)) {
        isMatch = true;
      }

      // 3. Alias Match
      else if (prod.normalizedAliases && prod.normalizedAliases.some(a => normalizedQueryStr.includes(a))) {
        isMatch = true;
      }
      
      // 4. Fuzzy / Keyword Retrieval
      else {
        // If query has all keywords of the product name, consider it a match
        const prodKeywords = prod.normalizedProductName?.split(' ').filter(x => x.length > 0) || [];
        if (prodKeywords.length > 0 && prodKeywords.every(kw => queryTokens.has(kw))) {
          isMatch = true;
        }
      }

      // 5. Partial Substring match (for ambiguity detection)
      if (!isMatch && prod.normalizedProductName && prod.normalizedProductName.includes(normalizedQueryStr) && normalizedQueryStr.length >= 6) {
        isMatch = true;
      }

      if (isMatch && !matchedProducts.some(p => p.sku === prod.sku)) {
        matchedProducts.push(prod);
      }
    }

    // Special case: If dining table is combined with custom table size (e.g. 2100x1000)
    if (lower.includes('dining table') && (lower.includes('2100') || lower.includes('custom size') || lower.includes('table size'))) {
      const din001 = AASHA_PRODUCTS.find(p => p.sku === 'DIN-001')!;
      if (!matchedProducts.some(p => p.sku === din001.sku)) {
        matchedProducts.push(din001);
      }
    }

    // Special case: If wardrobe customization is requested (e.g. drawer, soft-close)
    if (matchedCustomizations.some(c => c.category === 'WARDROBE') && matchedProducts.length === 0) {
      const war001 = AASHA_PRODUCTS.find(p => p.sku === 'WAR-001')!;
      matchedProducts.push(war001);
    }

    // D. Check for Ambiguous queries
    // Ambiguity test 1: "dining table" without 6-seater/size
    const isBareDiningTable = /\bdining\s+table\b/i.test(lower) && !/6\s*[- ]?seater|six\s*[- ]?seater|2100|1800|din-001/i.test(lower);
    if (isBareDiningTable) {
      return {
        originalQuery: raw,
        normalizedQuery: 'dining table',
        detectedIntent: intent,
        entityState: 'AMBIGUOUS',
        matchedProducts: [
          AASHA_PRODUCTS.find(p => p.sku === 'DIN-001')!,
          AASHA_PRODUCTS.find(p => p.sku === 'DIN-002')!
        ],
        matchedCustomizations,
        unknownEntities: [],
        ambiguityReason: 'Customer requested a dining table without specifying 6-seater model or custom dimensions.',
        clarificationPrompt:
          'Could you confirm which dining table you are interested in, or share the preferred size/style? We offer our standard 6-Seater Dining Table (DIN-001) as well as matching Dining Chairs (DIN-002).',
        requestedFields
      };
    }

    // Ambiguity test 2: "wardrobe" alone without 3-door or WAR-001 AND no customization
    const isBareWardrobe = /\bwardrobe\b/i.test(lower) && !/3\s*[- ]?door|three\s*[- ]?door|war-001/i.test(lower) && matchedCustomizations.length === 0;
    if (isBareWardrobe && matchedProducts.length === 0) {
      return {
        originalQuery: raw,
        normalizedQuery: 'wardrobe',
        detectedIntent: intent,
        entityState: 'AMBIGUOUS',
        matchedProducts: [AASHA_PRODUCTS.find(p => p.sku === 'WAR-001')!],
        matchedCustomizations: [],
        unknownEntities: [],
        ambiguityReason: 'Customer requested a wardrobe without specifying door count or model.',
        clarificationPrompt:
          'We have our 3-Door Wardrobe (SKU: WAR-001) available in our catalogue. Could you confirm if this is the model you are looking for, or share your preferred dimensions?',
        requestedFields
      };
    }

    // Ambiguity test 3: "3-seater sofa" without modern/classic
    const isBareSofa = /\b3\s*[- ]?seater\s*sofa\b/i.test(lower) && !/modern|classic|sof-001|sof-002/i.test(lower);
    if (isBareSofa) {
      return {
        originalQuery: raw,
        normalizedQuery: '3-seater sofa',
        detectedIntent: intent,
        entityState: 'AMBIGUOUS',
        matchedProducts: [
          AASHA_PRODUCTS.find(p => p.sku === 'SOF-001')!,
          AASHA_PRODUCTS.find(p => p.sku === 'SOF-002')!
        ],
        matchedCustomizations,
        unknownEntities: [],
        ambiguityReason: 'Customer requested a 3-seater sofa without specifying Classic Teak or Modern.',
        clarificationPrompt:
          'Could you confirm which 3-seater sofa you are interested in? We have the Classic Teak 3-Seater Sofa (SOF-001) and the Modern 3-Seater Sofa (SOF-002).',
        requestedFields,
        extractedDiscountPercent,
        extractedPaymentAmount,
        extractedQuantity,
        extractedDeliveryLocation,
        extractedInstallation
      };
    }
    // 6. Determine Entity State

    let entityState: RetrievalState = 'NOT_FOUND';
    if (matchedProducts.length === 1) {
      entityState = 'EXACT_MATCH';
    } else if (matchedProducts.length > 1) {
      entityState = 'AMBIGUOUS';
    } else if (matchedCustomizations.length > 0) {
      entityState = 'HIGH_CONFIDENCE';
    } else if (intent === 'DISCOUNT_REQUEST' || intent === 'CREDIT_REQUEST' || intent === 'PAYMENT_CLAIM' || intent === 'CANCELLATION_REQUEST' || intent === 'REFUND_REQUEST') {
      entityState = 'HIGH_CONFIDENCE';
    }

    return {
      originalQuery: raw,
      normalizedQuery: matchedProducts.length > 0 ? matchedProducts[0].productName : raw,
      detectedIntent: intent,
      entityState,
      matchedProducts,
      matchedCustomizations,
      unknownEntities,
      requestedFields,
      extractedDiscountPercent,
      extractedPaymentAmount,
      extractedQuantity,
      extractedDeliveryLocation,
      extractedInstallation
    };
  }
}
