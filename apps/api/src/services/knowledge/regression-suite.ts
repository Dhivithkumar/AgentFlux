import { QueryUnderstandingService } from './QueryUnderstandingService';
import { HybridRetrievalEngine } from './HybridRetrievalEngine';
import { GroundedResponseService } from './GroundedResponseService';
import { AASHA_BUSINESS_ID, normalizeEntityText } from './aashaKnowledgeData';

async function runRegressionSuite() {
  const queries = [
    "Classic Teak 3-Seater Sofa",
    "Classic Teak 3 Seater Sofa",
    "classic teak sofa",
    "teak 3 seater sofa",
    "three seater teak sofa",
    "SOF-001",
    "Modern 3-Seater Sofa",
    "3 door wardrobe",
    "three door wardrobe",
    "King Size Teak Bed",
    "Queen Size Teak Bed",
    "6-Seater Dining Table",
    "Dining Chair",
    "3-Door Wardrobe",
    "Executive Office Table"
  ];

  for (const q of queries) {
    const raw = `I am interested in the ${q}. Please send me the price, material, production time and warranty.`;
    const normStr = normalizeEntityText(raw);
    const norm = QueryUnderstandingService.normalizeQuery(raw);
    
    const retrieval = await HybridRetrievalEngine.retrieve({ businessId: AASHA_BUSINESS_ID, query: raw });
    
    const response = await GroundedResponseService.generateResponse({
      customerName: 'Meena',
      message: raw,
      evidence: retrieval
    });

    console.log("==================================================");
    console.log("QUERY:", raw);
    console.log("NORMALIZED QUERY STR:", normStr);
    console.log("RESOLVED ENTITY:", retrieval.productName || "NONE");
    console.log("RETRIEVAL RESULT:", JSON.stringify({
      matched: retrieval.matched,
      entityType: "PRODUCT",
      entityId: retrieval.sku,
      productName: retrieval.productName,
      confidence: retrieval.confidence
    }, null, 2));
    console.log("REQUESTED FIELDS:", norm.requestedFields);
    console.log("FINAL RESPONSE:");
    console.log(response.response);
    console.log("PASS/FAIL:", response.validationPassed && retrieval.matched ? "PASS" : "FAIL");
  }
}

runRegressionSuite().catch(console.error);
