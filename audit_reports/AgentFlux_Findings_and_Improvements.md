# AGENT FLUX V2 — FINDINGS, GAPS & TECHNICAL DEBT REGISTER
**Prioritized Architectural Findings, Security Vulnerabilities, Code Gaps & Remediation Roadmap**  
*Document Ref: AFV2-AUDIT-FINDINGS-2026-10-28*  
*Repository: [https://github.com/Dhivithkumar/AgentFlux](https://github.com/Dhivithkumar/AgentFlux)*  

---

## 1. Executive Summary of Audit Findings

A comprehensive static analysis and live test execution of the Agent Flux V2 codebase was performed across all 28 API route controllers, 45 database models, workflow orchestrators, RAG retrieval engines, financial ledger services, and frontend pages. 

The audit identified **14 prioritized findings**, classified into:
- **Critical Severity (2 findings):** Vector dimension configuration divergence and transactional outbox omission.
- **High Severity (4 findings):** Mock AI workflow generator route, route-level tenant parameter trust, in-memory email poller scaling bottleneck, and period closure lock boundaries.
- **Medium Severity (5 findings):** Static fallback in PDF rendering, BullMQ scheduler persistence, duplicate payment webhook handling, missing HNSW index migration, and unindexed foreign keys.
- **Low Severity (3 findings):** Schema backup file clutter, unused script leftovers, and legacy environment sample variables.

---

## 2. Prioritized Findings Register

### Finding 1: Vector Dimension Mismatch Between Prisma Schema & Gemini Configuration
- **Severity:** CRITICAL
- **Category:** RAG & Vector Database Integrity
- **Affected Files:** `prisma/schema.prisma` (Line 527) and `apps/api/src/config/ai.ts` (Line 6).
- **Code Evidence:**
  - In `schema.prisma`:
    ```prisma
    model KnowledgeChunk {
      ...
      embedding Unsupported("vector(768)")?
    ```
  - In `apps/api/src/config/ai.ts`:
    ```typescript
    embeddingDimensions: parseInt(process.env.GEMINI_EMBEDDING_DIMENSIONS || '3072', 10),
    ```
- **Why It Matters:** PostgreSQL `pgvector` enforces strict fixed dimensionality on vector columns. If `GEMINI_EMBEDDING_DIMENSIONS` is set to the default Gemini 3072 dimensions, inserting a 3072-dimensional vector into a `vector(768)` column throws a fatal PostgreSQL error: `ERROR: different vector dimensions 3072 and 768`.
- **Validation / Reproduction:** Attempting to run `$executeRawUnsafe` with a 3072-element float array into `vector(768)`.
- **Recommended Remediation:**
  1. Standardize on 768 dimensions across both configuration and schema by setting `GEMINI_EMBEDDING_DIMENSIONS=768` in `.env.example`, or execute an ALTER TABLE migration:
     ```sql
     ALTER TABLE "KnowledgeChunk" ALTER COLUMN "embedding" TYPE vector(3072);
     ```
  2. Execute `scripts/reindex_embeddings.ts` to re-embed all documents with the standardized dimension.
- **Verification Test:** Re-run `npx tsx src/tests/aasha-grounding-suite.ts` and inspect vector insertion.

---

### Finding 2: Transactional Outbox Omission (Dual-Write Consistency Risk)
- **Severity:** CRITICAL
- **Category:** Distributed Systems & Queue Consistency
- **Affected File:** `apps/api/src/services/workflow/engine.ts` (Lines 60–85).
- **Code Evidence:**
  ```typescript
  // 1. Database Write (PostgreSQL)
  const execution = await prisma.workflowExecution.create({
    data: { ... status: ExecutionStatus.QUEUED ... }
  });

  // 2. Queue Insertion (Redis BullMQ)
  await workflowQueue.add('executeWorkflow', { executionId: execution.id }, { ... });
  ```
- **Why It Matters:** The database write and queue insertion are decoupled. If the Node.js process crashes or the network to Redis drops between step 1 and step 2, the `WorkflowExecution` remains in PostgreSQL with status `QUEUED` indefinitely, and is never picked up by any worker.
- **Recommended Remediation:**
  Implement a Transactional Outbox pattern or a recovery sweeper. `operationalSyncPoller.ts` already implements a periodic recovery poller for sync jobs; extend this pattern to sweep for orphaned `WorkflowExecution` records where `status = 'QUEUED'` and `startedAt < NOW() - 5 minutes`.
- **Verification Test:** Simulate a killed process after `prisma.workflowExecution.create` and verify the sweeper enqueues the orphaned record.

---

### Finding 3: Mock Implementation in `/api/workflows/generate`
- **Severity:** HIGH
- **Category:** Incomplete Feature / Technical Debt
- **Affected File:** `apps/api/src/routes/workflows.ts` (Lines 26–34).
- **Code Evidence:**
  ```typescript
  // Mock AI generated response
  const definition = {
    nodes: [
      { id: 'trigger_1', type: 'TRIGGER', config: { event: 'EMAIL_RECEIVED', connector: 'GMAIL' }, next: { DEFAULT: 'ai_agent_1' } },
      { id: 'ai_agent_1', type: 'AI_AGENT', config: { task: 'Analyze intent of request' }, next: { HIGH_PRIORITY: 'action_1', DEFAULT: 'action_2' } },
      { id: 'action_1', type: 'ACTION', config: { action: 'Send Slack Alert', connector: 'SLACK' }, next: { DEFAULT: 'action_2' } },
      { id: 'action_2', type: 'ACTION', config: { action: 'Log to Sheets', connector: 'GOOGLE_SHEETS' } }
    ]
  };
  ```
- **Why It Matters:** When a user requests automated AI workflow generation from natural language via the frontend, the route returns a hardcoded 4-step mock DAG rather than prompting Gemini.
- **Recommended Remediation:**
  Connect the route to `aiManager.generateStructured()` using a strict JSON schema defining `nodes` and `transitions`, converting user prompts into validated DAGs.
- **Verification Test:** Send POST `/api/workflows/generate` with prompt *"Notify me when an order is cancelled"* and assert that the returned nodes match the prompt.

---

### Finding 4: In-Memory Poller Scalability & Single Point of Failure
- **Severity:** HIGH
- **Category:** Architecture & Clustering
- **Affected File:** `apps/api/src/services/queue/emailPoller.ts` (Lines 7–18).
- **Code Evidence:**
  ```typescript
  export class EmailPoller {
    start(intervalMs = 60000) {
      this.intervalId = setInterval(() => this.poll(), intervalMs);
    }
  ```
- **Why It Matters:** If the Express backend is scaled horizontally across multiple instances (e.g. behind an AWS ALB or Kubernetes deployment), each instance will run an independent `setInterval()` loop. While Redis `SETNX` prevents duplicate email processing, multiple instances make redundant Google API calls, rapidly exhausting Google OAuth rate limits.
- **Recommended Remediation:**
  Convert `EmailPoller` from an in-process `setInterval()` into a scheduled BullMQ repeatable job or use a distributed leader election lock (e.g., `redlock`).
- **Verification Test:** Spin up two API instances and verify that only the leader executes polling.

---

### Finding 5: Inconsistent Tenant Context Resolution in Route Handlers
- **Severity:** HIGH
- **Category:** Security & Tenant Isolation
- **Affected File:** `apps/api/src/middleware/auth.ts` (Lines 46–56).
- **Code Evidence:**
  ```typescript
  let businessId = req.params.businessId || req.query.businessId || req.body.businessId || req.headers['x-business-id'];
  ```
- **Why It Matters:** Resolving `businessId` from `req.body` or `req.query` when `req.params.businessId` is already specified in the URL route pattern allows parameter pollution if a malicious client sends different business IDs across params and body.
- **Recommended Remediation:**
  Strictly prioritize path parameters (`req.params.businessId`), and verify that if `req.body.businessId` is also supplied, it strictly equals `req.params.businessId`.
- **Verification Test:** Send a request with `params.businessId = 'biz-A'` and `body.businessId = 'biz-B'` and assert HTTP 400 Bad Request.

---

### Finding 6: Missing HNSW / IVFFlat Index on pgvector Column
- **Severity:** MEDIUM
- **Category:** Performance & Scalability
- **Affected File:** `prisma/schema.prisma` (Lines 520–539).
- **Code Evidence:**
  `schema.prisma` defines:
  ```prisma
  @@index([documentId])
  @@index([knowledgeBaseId])
  @@index([businessId])
  ```
  No vector index (`hnsw` or `ivfflat`) is declared.
- **Why It Matters:** PostgreSQL falls back to exact sequential scan. For thousands of chunks this is acceptable (<10ms), but for millions of chunks it increases search latency to several seconds.
- **Recommended Remediation:**
  Create a migration adding an HNSW index:
  ```sql
  CREATE INDEX "KnowledgeChunk_embedding_hnsw_idx" ON "KnowledgeChunk" 
  USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
  ```
- **Verification Test:** Run `EXPLAIN ANALYZE` on `searchKnowledgeBase()` and verify `Index Scan using KnowledgeChunk_embedding_hnsw_idx`.

---

### Finding 7: Missing Database Foreign Key Indexes
- **Severity:** MEDIUM
- **Category:** Database Query Performance
- **Affected File:** `prisma/schema.prisma`.
- **Code Evidence:**
  In `JournalLine`, lines have `@@index([accountId])`, but no compound index on `[journalEntryId, accountId]`. In `WorkflowExecution`, no index on `status` alone.
- **Why It Matters:** Queries like `prisma.workflowExecution.findMany({ where: { status: 'WAITING' } })` perform a full table scan over all execution records.
- **Recommended Remediation:**
  Add `@@index([businessId, status])` to `WorkflowExecution` and `@@index([journalEntryId])` to `JournalLine`.

---

### Finding 8: Pure Node Fallback Formatting in Document Generation
- **Severity:** MEDIUM
- **Category:** Document Fidelity
- **Affected File:** `apps/api/src/services/documents/docxToPdf.ts` (Lines 28–53).
- **Code Evidence:**
  The pure Node.js fallback uses `mammoth.extractRawText` and renders raw text lines via `pdfkit`. Complex Word table grids, corporate logos, and styled multi-column invoice footers are rendered as plain text.
- **Recommended Remediation:**
  Use `docx-templates` with `puppeteer` rendering HTML/CSS to PDF for the secondary fallback, ensuring high graphical fidelity even in environments without Microsoft Word COM or LibreOffice.
- **Verification Test:** Generate an invoice on a system without Word/LibreOffice and assert that table borders and logos render.

---

### Finding 9: Lack of Rate Limiting Middleware on Public Auth Endpoints
- **Severity:** MEDIUM
- **Category:** Security & Brute-Force Prevention
- **Affected File:** `apps/api/src/routes/auth.ts`.
- **Code Evidence:**
  `POST /api/auth/login` and `POST /api/auth/register` have no rate limiting middleware (such as `express-rate-limit`).
- **Why It Matters:** Attackers can launch credential-stuffing or password-guessing dictionary attacks against user accounts without throttling.
- **Recommended Remediation:**
  Apply `express-rate-limit` allowing at most 5 failed login attempts per IP address per 15-minute window.
- **Verification Test:** Send 10 rapid failed login requests and assert that the 6th returns HTTP 429 Too Many Requests.

---

### Finding 10: Unchecked Duplicate Payments via Race Conditions
- **Severity:** MEDIUM
- **Category:** Financial Integrity
- **Affected File:** `apps/api/src/services/payment/PaymentService.ts`.
- **Code Evidence:**
  When confirming a payment via `confirmPayment()`, the payment is updated to `SUCCEEDED`. If two webhook notifications fire concurrently within milliseconds, both could potentially read status `PENDING` and trigger duplicate General Ledger journal entries.
- **Recommended Remediation:**
  Use an atomic conditional update or an explicit database lock:
  ```typescript
  const updated = await tx.payment.updateMany({
    where: { id: paymentId, status: { not: 'SUCCEEDED' } },
    data: { status: 'SUCCEEDED' }
  });
  if (updated.count === 0) return; // Already processed
  ```
- **Verification Test:** Send concurrent identical payment confirmation requests and verify only one journal entry is posted.

---

### Finding 11: Unused File Artifacts in Repository Root
- **Severity:** LOW
- **Category:** Maintainability & Cleanliness
- **Affected Files:** `prisma/schema.prisma.bak`, `apps/api/temp.xml`, `apps/api/test-enq.ts`, `apps/api/scratch/`.
- **Why It Matters:** Storing backup schemas (`schema.prisma.bak`) and temporary debug files in version control creates confusion about the active schema.
- **Recommended Remediation:**
  Add `*.bak`, `temp.*`, and `scratch/` to root `.gitignore`.

---

## 3. Prioritized Remediation Roadmap

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      REMEDIATION ROADMAP & ACTION PLAN                      │
└─────────────────────────────────────────────────────────────────────────────┘

  PHASE 1: IMMEDIATE CRITICAL FIXES (Week 1)
  ├── 1. Standardize vector dimensions (align schema & config to 768 or 3072)
  ├── 2. Implement Transactional Outbox recovery poller for QUEUED executions
  └── 3. Apply express-rate-limit to /api/auth/login and public intake forms

  PHASE 2: RELIABILITY & CONCURRENCY HARDENING (Week 2)
  ├── 4. Replace mock in /api/workflows/generate with real Gemini structured output
  ├── 5. Migrate EmailPoller into BullMQ repeatable job to eliminate multi-pod races
  └── 6. Enforce atomic updateMany locking on Payment confirmation

  PHASE 3: PERFORMANCE & DATABASE OPTIMIZATION (Week 3)
  ├── 7. Create HNSW cosine vector index in PostgreSQL
  ├── 8. Add compound indexes on WorkflowExecution(businessId, status) and JournalLine
  └── 9. Upgrade pure Node docx-to-pdf converter to HTML/Puppeteer pipeline
```
