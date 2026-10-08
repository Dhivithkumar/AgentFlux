import { normalizeEntityText, AASHA_PRODUCTS } from './aashaKnowledgeData';
import { QueryUnderstandingService } from './QueryUnderstandingService';
import { HybridRetrievalEngine } from './HybridRetrievalEngine';
import { AASHA_BUSINESS_ID } from './aashaKnowledgeData';

async function run() {
  const email = `Hi,

I am interested in the Classic Teak 3-Seater Sofa.

Please send me the price, material, production time and warranty.

Regards,
Meena`;

  const normQueryStr = normalizeEntityText(email);
  console.log("Normalized:", normQueryStr);
  const normOutput = QueryUnderstandingService.normalizeQuery(email);
  console.log("QueryUnderstanding:", JSON.stringify(normOutput, null, 2));
  
  const retrieval = await HybridRetrievalEngine.retrieve({ businessId: AASHA_BUSINESS_ID, query: email });
  console.log("Retrieval:", JSON.stringify({
    matched: retrieval.matched,
    entityType: "PRODUCT",
    entityId: retrieval.sku,
    productName: retrieval.productName,
    confidence: retrieval.confidence
  }, null, 2));
}
run();
