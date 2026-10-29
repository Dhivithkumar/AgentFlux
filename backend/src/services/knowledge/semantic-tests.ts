import { HybridRetrievalEngine } from './HybridRetrievalEngine';
import { AASHA_BUSINESS_ID } from './aashaKnowledgeData';

async function runTests() {
  const queries = [
    "3-Door Wardrobe",
    "3 door wardrobe",
    "three door wardrobe",
    "three-door wardrobe",
    "3door wardrobe",
    "wardrobe with three doors",
    "three door almirah",
    "3 door almirah",
    "wardrobe 3 door",
    "WAR-001",
    "what is the price of the wardrobe with three doors?",
    "how much does the three door wardrobe cost?",
    "price for a three door wardrobe",
    "I need a three-door wardrobe"
  ];

  let passCount = 0;
  for (const q of queries) {
    const res = await HybridRetrievalEngine.retrieve({ businessId: AASHA_BUSINESS_ID, query: q });
    if (res.entity === 'WAR-001') {
      passCount++;
      console.log(`✅ [PASS] "${q}" -> WAR-001`);
    } else {
      console.log(`❌ [FAIL] "${q}" -> ${res.entity}`);
    }
  }

  console.log(`\nPassed ${passCount}/${queries.length} Entity Resolution tests.`);

  // Negative test
  const neg = await HybridRetrievalEngine.retrieve({ businessId: AASHA_BUSINESS_ID, query: "5-door wardrobe" });
  if (neg.state === 'NOT_FOUND') {
    console.log(`✅ [PASS] "5-door wardrobe" -> NOT_FOUND`);
  } else {
    console.log(`❌ [FAIL] "5-door wardrobe" -> ${neg.state}`);
  }

  // Ambiguity test
  const amb = await HybridRetrievalEngine.retrieve({ businessId: AASHA_BUSINESS_ID, query: "3-seater sofa" });
  if (amb.state === 'AMBIGUOUS') {
    console.log(`✅ [PASS] "3-seater sofa" -> AMBIGUOUS`);
  } else {
    console.log(`❌ [FAIL] "3-seater sofa" -> ${amb.state}`);
  }

  // Check specific response for the email
  const email = `Hello,
I am looking for a three door wardrobe for my bedroom.
How much does it cost?
Thanks,
Arun`;

  const emailRes = await HybridRetrievalEngine.retrieve({ businessId: AASHA_BUSINESS_ID, query: email });
  console.log("\nEmail Retrieval Result:", JSON.stringify({
    matched: emailRes.matched,
    matchType: emailRes.matchType,
    confidence: emailRes.confidence,
    sku: emailRes.sku,
    productName: emailRes.productName,
    requestedField: emailRes.requestedField,
    value: emailRes.value,
    currency: emailRes.currency,
    source: emailRes.source
  }, null, 2));
}

runTests();
