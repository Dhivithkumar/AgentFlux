# AGENT FLUX V2 — RAG & AI RETRIEVAL DEEP DIVE
**Mathematical Grounding, pgvector Storage, Multi-Tier Retrieval & Zero-Hallucination Architecture**  
*Document Ref: AFV2-AUDIT-RAG-AI-2026-10-28*  
*Repository: [https://github.com/Dhivithkumar/AgentFlux](https://github.com/Dhivithkumar/AgentFlux)*  

---

## 1. Executive Technical Summary of the AI Pipeline

Agent Flux V2 implements a **hybrid retrieval and grounded generation architecture** designed specifically to eliminate LLM hallucinations in commercial, manufacturing, and financial customer communications. 

Traditional RAG architectures simply query vector databases using approximate nearest-neighbor search, pass the top-$k$ text chunks to an LLM, and trust the LLM to synthesize prices, delivery timelines, and policy rules. In commercial business workflows, this naive pattern is catastrophic:
- LLMs routinely invent unapproved discounts (e.g. agreeing to 15% off when sales reps only have 5% authority).
- LLMs guess stock availability (promising "in stock" for made-to-order bespoke furniture).
- LLMs promise unverified delivery dates (e.g. promising delivery tomorrow when production requires 14 days).
- Vector similarity search alone fails on exact numeric SKU queries (e.g. confusing `WAR-001` with `WAR-002` due to semantic proximity in embedding space).

To solve this, Agent Flux V2 separates semantic understanding from factual computation through a **5-tier retrieval pipeline**:
1. **Deterministic Intent & Entity Normalization** (`QueryUnderstandingService.ts`)
2. **Authoritative Structured Entity Matching** (Exact SKU & Product resolution)
3. **Cross-Document Customization & Policy Linking** (`03_Product_Customization_Guide.pdf`, `05_Discount_Policy.pdf`)
4. **Deterministic Financial & Tax Engine** (`DeterministicFinancialEngine.ts`)
5. **pgvector Cosine Similarity Semantic Search** (`KnowledgeChunk` pgvector column)
6. **Code-Level Response Grounding Assertion Engine** (`GroundedResponseService.ts`)

---

## 2. Document Ingestion & Extraction Engine

**File:** `apps/api/src/services/knowledge.ts` (Class: `KnowledgeProcessingService`)  
**Route:** `POST /api/knowledge/documents/upload`  
**Worker:** `apps/api/src/services/queue/knowledgeQueue.ts`  

### 2.1 File Ingestion Workflow
When a file is uploaded, it is routed to `storageService.uploadDocument`, which calculates a SHA-256 hash, assigns a UUID, and stores the buffer in `uploads/` (or Google Drive if configured). The document record is initialized with `status: DocumentStatus.UPLOADED`.

### 2.2 Text Extraction Implementations
Extraction branches based on the document's MIME type:
```typescript
// Code excerpt: apps/api/src/services/knowledge.ts (Lines 52-66)
if (doc.mimeType === 'application/pdf') {
  const parser = new PDFParse({ data: fileBuffer });
  const data = await parser.getText();
  extractedText = data.text;
} else if (doc.mimeType === 'text/plain' || doc.mimeType === 'text/csv') {
  extractedText = fileBuffer.toString('utf-8');
} else if (doc.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer: fileBuffer });
  extractedText = result.value;
} else {
  throw new Error('Unsupported mime type for extraction');
}
```

### 2.3 Document-Aware Chunking Strategy
Rather than arbitrary token splitting (e.g. recursive character text splitting at 500 characters), which severs table rows and dissociates prices from SKUs, `KnowledgeProcessingService.createDocumentAwareChunks` executes:
1. **Catalog Table Preservation:** If the filename contains `"Catalogue"`, each product is indexed as a dedicated structured chunk containing its full record:
   ```typescript
   // apps/api/src/services/knowledge.ts (Lines 296-314)
   const rowContent = `SKU: ${prod.sku} | Product: ${prod.productName} | Category: ${prod.category} | Material: ${prod.material} | Base Price: ₹${prod.basePrice} INR | Production Days: ${prod.productionDays} | Warranty: ${prod.warranty}\nDescription: ${prod.description}`;
   chunks.push({
     content: rowContent,
     metadata: {
       businessId: doc.businessId,
       entityType: 'product',
       sku: prod.sku,
       productName: prod.productName,
       basePrice: prod.basePrice,
       currency: 'INR',
       authorityLevel: 'AUTHORITATIVE'
     }
   });
   ```
2. **Section & Paragraph Splitting:** Unstructured prose is split along double newline boundaries (`text.split(/\n\s*\n/)`), filtering out chunks under 30 characters to remove header/footer noise.

---

## 3. Embedding Generation & Vector Storage

### 3.1 Embedding Model Configuration
**File:** `apps/api/src/config/ai.ts` and `apps/api/src/services/ai/geminiProvider.ts`
- **Embedding Provider:** Google Gemini API (`@google/generative-ai`)
- **Configured Model:** `gemini-embedding-001` (default in `AIConfiguration.gemini.embeddingModel`) or `text-embedding-004`
- **Output Dimensionality:** Configurable via `GEMINI_EMBEDDING_DIMENSIONS` (default 3072 or 768).
- **Batch Processing:** Concurrent asynchronous requests via `embeddingProvider.generateEmbeddings(texts)`.

### 3.2 pgvector Database Representation
In `prisma/schema.prisma` (Line 527):
```prisma
model KnowledgeChunk {
  id              String                      @id @default(uuid())
  documentId      String
  knowledgeBaseId String
  businessId      String
  chunkIndex      Int
  content         String
  embedding       Unsupported("vector(768)")?
  tokenCount      Int?
  metadata        Json?
  createdAt       DateTime                    @default(now())
  
  @@index([documentId])
  @@index([knowledgeBaseId])
  @@index([businessId])
}
```

### 3.3 Vector Insertion Mechanism
Because Prisma ORM does not natively support vector literals directly in type-safe create calls, raw SQL parameterized queries are executed:
```typescript
// apps/api/src/services/knowledge.ts (Lines 94-98)
const chunkId = randomUUID();
const embeddingString = `[${embeddings[i].join(',')}]`;
const metadata = JSON.stringify(chunkObjects[i].metadata);

await prisma.$executeRawUnsafe(
  `INSERT INTO "KnowledgeChunk" ("id", "documentId", "knowledgeBaseId", "businessId", "chunkIndex", "content", "embedding", "metadata", "createdAt") 
   VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8::jsonb, NOW())`,
  chunkId, doc.id, doc.knowledgeBaseId, doc.businessId, i, chunkObjects[i].content, embeddingString, metadata
);
```

---

## 4. Multi-Tier Hybrid Retrieval Engine

**File:** `apps/api/src/services/knowledge/HybridRetrievalEngine.ts`

When a search or customer enquiry is processed, `HybridRetrievalEngine.retrieve` executes across five distinct layers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HYBRID RETRIEVAL RESOLUTION HIERARCHY                     │
└─────────────────────────────────────────────────────────────────────────────┘
  Customer Input: "Can I get a quote for a 3-Door Wardrobe with an extra drawer?"
                                     │
                                     ▼
      [QueryUnderstandingService.normalizeQuery]
      - Clean text & remove noise
      - Detect Intent: QUOTATION_REQUEST
      - Matched Product: WAR-001 ("3-Door Wardrobe", ₹28,000)
      - Matched Customization: "Additional interior drawer" (+₹1,800)
                                     │
          ┌──────────────────────────┴──────────────────────────┐
          ▼                                                     ▼
 [LEVEL 1: Structured Entity]                          [LEVEL 2: Cross-Doc Link]
 Matched SKU: WAR-001                                  Guide: 03_Customization.pdf
 Base Price: ₹28,000                                   Extra Drawer: ₹1,800
 Lead Time: 14 days                                    Lead Time Impact: +2 days
 Warranty: 2 years                                     Approval: Sales Executive
          │                                                     │
          └──────────────────────────┬──────────────────────────┘
                                     ▼
                 [LEVEL 3: Deterministic Financial Engine]
                 - Subtotal: ₹28,000 + ₹1,800 = ₹29,800
                 - 18% Test GST: ₹5,364
                 - Total Quoted Amount: ₹35,164
                 - 50% Advance Required: ₹17,582
                 - 50% Balance Due: ₹17,582
                                     │
                                     ▼
                 [LEVEL 4: Approval Governance Matrix]
                 - Evaluates if discount > 5% (None requested)
                 - Evaluates custom dimensions (None requested)
                 - Result: No executive escalation required
                                     │
                                     ▼
                 [LEVEL 5: pgvector Semantic Search]
                 SELECT c."id", c."content", 1 - (c."embedding" <=> $1::vector)
                 WHERE c."businessId" = $2 AND similarity > 0.40
                                     │
                                     ▼
                    [Output: RetrievalEvidencePackage]
                    state: EXACT_MATCH, confidence: HIGH
```

### 4.1 SQL Retrieval Query
For Level 5 vector search, pgvector's cosine distance operator `<=>` is used to calculate cosine similarity (`1 - (embedding <=> queryVector)`):
```sql
SELECT c."id", c."content", c."metadata", 1 - (c."embedding" <=> $1::vector) as similarity, 
       c."documentId", d."knowledgeType", d."filename"
FROM "KnowledgeChunk" c
JOIN "KnowledgeDocument" d ON c."documentId" = d."id"
WHERE c."businessId" = $2
  AND c."embedding" IS NOT NULL
  AND 1 - (c."embedding" <=> $1::vector) > $3
ORDER BY similarity DESC LIMIT $4;
```

---

## 5. Grounded Response & Zero-Hallucination Assertion Engine

**File:** `apps/api/src/services/knowledge/GroundedResponseService.ts`

### 5.1 Factual State Management
The service categorizes every response into one of seven strict states:
1. `ANSWERED`: All requested facts are present in authoritative evidence; response generated and verified.
2. `NEEDS_INFORMATION`: Incomplete enquiry requirements; prompts customer for exact dimensions or options.
3. `APPROVAL_REQUIRED`: Requested terms exceed delegated authority (e.g., >5% discount, credit terms, custom sizes).
4. `MANUAL_REVIEW`: Conflicting facts detected across documents.
5. `NOT_FOUND`: Entity does not exist in catalog; abstains safely without guessing.
6. `AMBIGUOUS`: Multiple matching entities exist; asks clarifying question.
7. `CONFLICTING_KNOWLEDGE`: Inconsistent data across active documents.

### 5.2 Deterministic Grounding Validators
Before any customer-facing HTML is released, `validateResponseClaims()` scans the generated text for policy violations:
1. **Stock Hallucination Check:**
   ```typescript
   if (/in stock|currently in stock|inventory ready|available in warehouse/i.test(lower)) {
     unsupported.push('UNSUPPORTED_STOCK_CLAIM: Made stock claims without stock evidence.');
   }
   ```
2. **Unverified Immediate Delivery Check:**
   ```typescript
   if (/deliver tomorrow|delivery tomorrow|arrive tomorrow|deliver today/i.test(lower)) {
     unsupported.push('UNSUPPORTED_DELIVERY_CLAIM: Unverified immediate delivery promised.');
   }
   ```
3. **False Pricing Negation Check:**
   ```typescript
   if (evidence.answerableFacts['price'] && /pricing unavailable|pricing is not available/i.test(lower)) {
     unsupported.push('CONTRADICTION: Base price is present in evidence but response claims pricing is unavailable.');
   }
   ```
4. **Placeholder Leak Check:**
   ```typescript
   if (/\[your name\]|\[company name\]|\{\{name\}\}|\{\{email\}\}/i.test(lower)) {
     unsupported.push('PLACEHOLDER_LEAK: Response contains unresolved template placeholders.');
   }
   ```
5. **Internal SKU Exposure Check:** Flags internal database codes (e.g. `WAR-001`) from leaking into customer emails unless explicitly requested by the customer.

---

## 6. End-to-End RAG Execution Walkthrough (Code Trace)

### Scenario: Customer Asks for Custom Wardrobe Price & Delivery
1. **Inbound Email Arrival:** `emailPoller.ts` catches unread message: *"Can you tell me the price and delivery time for a 3-door wardrobe with an extra drawer?"*
2. **Idempotency Gate:** `ConversationOrchestrator.ts` executes `redis.setnx("processed_email:msg_123", "1")`.
3. **Query Understanding:** `QueryUnderstandingService.normalizeQuery` identifies:
   - Primary Entity: `WAR-001` ("3-Door Wardrobe", Base Price: ₹28,000, 14 days lead time)
   - Customization: "Additional interior drawer" (Charge: ₹1,800, +2 days lead time)
   - Requested Fields: `['basePrice', 'productionDays']`
4. **Deterministic Calculation:** `DeterministicFinancialEngine.calculateQuotation`:
   - Subtotal = ₹28,000 + ₹1,800 = ₹29,800
   - 18% GST = ₹5,364
   - Total Amount = ₹35,164
   - 50% Advance = ₹17,582, Balance Due = ₹17,582
5. **Evidence Compilation:** `HybridRetrievalEngine.retrieve` aggregates facts from `02_Product_Catalogue.pdf`, `03_Product_Customization_Guide.pdf`, and `11_Invoice_Tax_Policy.pdf`.
6. **Response Generation:** `GroundedResponseService.generateResponse` builds structured HTML response:
   - Sets Base Price to ₹28,000.
   - Sets Additional Drawer to ₹1,800.
   - Sets Total Production Time to 16 days (14 + 2).
7. **Grounding Assertion:** `validateResponseClaims` validates 0 unsupported claims.
8. **Outbound Dispatch:** Response is dispatched via Gmail API with the customer's email thread preserved.

---

## 7. Verification Evidence: 41/41 Grounding Regression Suite

The RAG and Grounding engine was validated live against PostgreSQL using `apps/api/src/tests/aasha-grounding-suite.ts`. All 41 test scenarios passed:

```
================================================================
AASHA FURNITURE PRODUCTION-GRADE GROUNDING TEST SUITE RESULTS
================================================================
✅ [PASS] Golden Test 1: 3-Door Wardrobe Pricing & Facts
✅ [PASS] Golden Test 2: WAR-001 with Additional Drawer
✅ [PASS] Golden Test 3: DIN-001 + 2100x1000 + Premium Polish Deterministic Financial Engine
✅ [PASS] Test 1: Standard product enquiry matches WAR-001
✅ [PASS] Test 2: Product price matches exactly ₹28,000
✅ [PASS] Test 3: Product SKU resolved to WAR-001
✅ [PASS] Test 4: Product warranty is exactly 2 years
✅ [PASS] Test 5: Material is Engineered wood
✅ [PASS] Test 6: Unknown product abstains safely without inventing a price
✅ [PASS] Test 7: Ambiguous product query asks for customer clarification
✅ [PASS] Test 8: Customization drawer retrieved at ₹1,800, Sales approval
✅ [PASS] Test 9: Multiple customizations both correctly identified
✅ [PASS] Test 10: 5% discount handled by Sales Executive without escalation
✅ [PASS] Test 11: 7% discount requires Sales Manager approval
✅ [PASS] Test 12: 12% discount requires Owner approval
✅ [PASS] Test 13: 18% discount flagged as Owner exception
✅ [PASS] Test 14: Order value approval tiers: <=1L Sales, 1L-3L Manager, >3L Owner
✅ [PASS] Test 15: Credit sale strictly requires Finance approval
✅ [PASS] Test 16: Quotation calculated deterministically with 15-day validity contract
✅ [PASS] Test 17: Expired quotation (>15 days) requires revalidation before order conversion
✅ [PASS] Test 18: Quotation revision preserves audit history
✅ [PASS] Test 19: Order creation enforces mandatory fields
✅ [PASS] Test 20: Production release blocked without advance payment
✅ [PASS] Test 21: Advance payment is strictly 50% for made-to-order
✅ [PASS] Test 22: Customer payment message remains unverified pending reconciliation
✅ [PASS] Test 23: Payment idempotency prevents duplicate records
✅ [PASS] Test 24: Deterministic invoice numbering AF-INV-2026-0001
✅ [PASS] Test 25: Configured 12% test GST: 44,500 * 12% = 5,340
✅ [PASS] Test 26: Payment reminder schedule conforms to Collections Policy
✅ [PASS] Test 27: Payment reminders suppressed when balance is zero
✅ [PASS] Test 28: 7+ days overdue escalates to Finance Manager / Owner
✅ [PASS] Test 29: Cancellation before production eligible for refund
✅ [PASS] Test 30: Refund after production requires Management approval
✅ [PASS] Test 31: Refund thresholds: <=10k Finance, >10k Owner
✅ [PASS] Test 32: Segregation of duties blocks self-approval of financial exceptions
✅ [PASS] Test 33: Unknown information triggers safe abstention with zero hallucination
✅ [PASS] Test 34: Cross-document retrieval combines catalogue, customization, rate card and tax policies
✅ [PASS] Test 35: Cross-business isolation: No Aasha Furniture facts leaked to other tenant
✅ [PASS] Test 36: Grounding Validator rejects unsupported stock claims
✅ [PASS] Test 37: Grounding Validator rejects unverified immediate delivery promises
✅ [PASS] Test 38: Grounding Validator rejects false pricing negation when price is known
================================================================
TOTAL TESTS: 41 | PASSED: 41 | FAILED: 0 | ACCURACY: 100.0%
================================================================
```
