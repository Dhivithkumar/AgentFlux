import { QueryUnderstandingService } from './QueryUnderstandingService';
import { HybridRetrievalEngine } from './HybridRetrievalEngine';
import { GroundedResponseService } from './GroundedResponseService';
import { AASHA_BUSINESS_ID } from './aashaKnowledgeData';

async function runResponseTests() {
  const tests = [
    {
      name: "TEST 1: Price only",
      query: "What is the price of the Modern 3-Seater Sofa?",
      expectedContains: ["₹38,000"],
      expectedOmits: ["SOF-002", "GST"]
    },
    {
      name: "TEST 2: Details of Modern 3-Seater Sofa",
      query: "Give me details of the Modern 3-Seater Sofa.",
      expectedContains: ["₹38,000", "engineered wood and upholstery", "7 days", "2-year"],
      expectedOmits: ["SOF-002", "**"]
    },
    {
      name: "TEST 3: SKU of Modern 3-Seater Sofa",
      query: "What is the SKU of the Modern 3-Seater Sofa?",
      expectedContains: ["SOF-002"],
      expectedOmits: []
    },
    {
      name: "TEST 4: Price including GST",
      query: "What is the price of the Modern 3-Seater Sofa including GST?",
      expectedContains: ["₹42,560", "12% GST"],
      expectedOmits: ["SOF-002"]
    }
  ];

  for (const t of tests) {
    console.log(`\n==================================================`);
    console.log(`Running: ${t.name}`);
    console.log(`QUERY: "${t.query}"`);
    
    const evidence = await HybridRetrievalEngine.retrieve({ businessId: AASHA_BUSINESS_ID, query: t.query });
    const response = await GroundedResponseService.generateResponse({
      customerName: 'Karthik',
      message: t.query,
      evidence
    });
    
    console.log(`\nSTRUCTURED JSON OUTPUT:`);
    console.log(JSON.stringify(response.structuredResponse, null, 2));

    console.log(`\nFINAL HTML RESPONSE:`);
    console.log(response.response);
    
    let pass = true;
    for (const c of t.expectedContains) {
      if (!response.response.includes(c)) {
        console.error(`❌ FAILED: Missing expected string "${c}"`);
        pass = false;
      }
    }
    for (const o of t.expectedOmits) {
      if (response.response.includes(o)) {
        console.error(`❌ FAILED: Included forbidden string "${o}"`);
        pass = false;
      }
    }
    if (pass) {
      console.log(`✅ PASS`);
    }
  }
}

runResponseTests().catch(console.error);
