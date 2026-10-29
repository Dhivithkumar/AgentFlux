# AGENT FLUX V2 — TECHNICAL VIVA PREPARATION
**88 Grounded Viva Voce Examination Questions, Answers & Examiner Defenses**  
*Document Ref: AFV2-AUDIT-VIVA-2026-10-28*  
*Repository: [https://github.com/Dhivithkumar/AgentFlux](https://github.com/Dhivithkumar/AgentFlux)*  

---

## CATEGORY 1: OVERALL SYSTEM ARCHITECTURE

### Q1: What is Agent Flux V2, and what primary architectural problem does it solve?
**Answer:** Agent Flux V2 is a multi-tenant autonomous business operations platform. It bridges unstructured communication channels (Gmail, Calendar) with structured transactional back-office systems (enquiries, quotations, orders, double-entry General Ledger, and cloud archiving). It solves the problem of operational fragmentation and LLM hallucination by separating semantic natural language understanding from deterministic business computation, ensuring zero hallucinations in financial and commercial workflows.

### Q2: Why did you design a dual-engine architecture combining deterministic rules with LLMs?
**Answer:** In commercial enterprise workflows, letting an LLM calculate tax, generate quotes, or approve discounts introduces critical business risk due to probabilistic drift and hallucinations. In Agent Flux V2, the LLM is restricted solely to unstructured text extraction and semantic intent classification. All calculations (subtotals, 18% GST, advance payment requirements, discount thresholds) are computed deterministically by TypeScript domain engines (`DeterministicFinancialEngine.ts`, `ApprovalGovernanceEngine.ts`).

### Q3: What are the main functional centres in the application?
**Answer:** 
1. **Intake & Enquiries:** Email intake, thread parsing, meeting booking.
2. **Orders & Bookings:** Lifecycle state machine, priority scoring.
3. **Finance Centre:** Double-entry General Ledger, Chart of Accounts, Bank Reconciliation, AR Subledger, Financial Reporting, Audit Packs.
4. **Vendor Centre:** Vendor tracking and asynchronous background verification.
5. **Workflow Centre:** Visual DAG builder, execution audits, and human approvals.
6. **Knowledge Centre:** Multi-source document ingestion, chunking, and pgvector retrieval.
7. **Integrations:** OAuth2 connectors for Gmail, Calendar, Sheets, and Drive.

### Q4: How is tenant isolation enforced across the application?
**Answer:** Multi-tenancy is enforced at three distinct levels:
1. **API Gateway:** `requireBusinessMembership` middleware checks that the authenticated `req.user.id` has a valid `Membership` record for `businessId`.
2. **Database Queries:** All Prisma queries enforce an explicit `where: { businessId }` filter.
3. **Retrieval Engine:** `HybridRetrievalEngine` explicitly asserts `if (businessId !== AASHA_BUSINESS_ID)` to prevent leaking proprietary furniture data to other tenants.

### Q5: How do frontend user actions communicate with backend services?
**Answer:** The React SPA routes requests through `lib/api.ts`, which injects the `Bearer <jwt_token>` header and `x-business-id` header. Requests hit the Express API server at port 3001, pass through `cors()`, `express.json()`, `authenticate`, and `requireBusinessMembership`, and execute within transactional service modules.

### Q6: What happens if an external service like Gmail or Google Drive goes down?
**Answer:** All connector actions are wrapped in try-catch blocks and executed within BullMQ worker retries with exponential backoff. In document generation, if Google Drive upload fails, the local file is persisted in `uploads/` and returned so document creation is never blocked.

### Q7: What is the single source of truth in the application?
**Answer:** PostgreSQL is the authoritative relational source of truth. Google Sheets, Redis caches, and Google Drive files represent synchronized operational projections or archival copies.

### Q8: What design pattern prevents duplicate processing of incoming emails?
**Answer:** Idempotency via Redis distributed locking: when an email arrives, `ConversationOrchestrator.ts` executes `redis.setnx("processed_email:" + messageId, "1")`. If the key already exists, execution immediately terminates.

---

## CATEGORY 2: FRONTEND ARCHITECTURE & STATE MANAGEMENT

### Q9: What frontend stack is used, and why was it chosen?
**Answer:** React 18 with Vite, TypeScript, Tailwind CSS, and `@xyflow/react` (React Flow). Vite provides rapid HMR and lightweight bundle sizes; TypeScript provides strict interface contracts with the backend; and React Flow powers the interactive workflow canvas.

### Q10: How does `DashboardLayout.tsx` handle tenant workspace switching?
**Answer:** `DashboardLayout.tsx` fetches the user's authorized businesses via `/api/businesses`, stores the selected `activeBusinessId` in `localStorage`, and provides a business dropdown switcher. It forces a clean re-mount of child views by passing a dynamic React key: `<Outlet key={currentBusiness.id} context={{ business: currentBusiness, user }} />`.

### Q11: How is the visual workflow builder implemented?
**Answer:** `apps/web/src/pages/workflows/WorkflowBuilder.tsx` uses `@xyflow/react` (React Flow). Workflow steps are rendered as customizable React Flow nodes with interactive connection handles representing `next` execution branches.

### Q12: How are asynchronous API calls handled in React components?
**Answer:** Components use standard React hooks (`useEffect`, `useState`, `useCallback`) calling the centralized `apiCall()` utility in `apps/web/src/lib/api.ts`. Loading, empty, and error states are conditionally rendered.

### Q13: How does the UI prevent displaying broken image or template links?
**Answer:** Document templates and previews verify file presence through backend status endpoints before rendering download buttons.

### Q14: How does the frontend handle permission-based UI controls?
**Answer:** `DashboardLayout` receives user roles (`OWNER` vs `MEMBER`) from `/api/auth/me` and `/api/businesses/:id/members`. Administrative features like Chart of Accounts seeding or Period Lockdowns display confirmation modals restricted to `OWNER`.

---

## CATEGORY 3: BACKEND ENGINE & EXPRESS ARCHITECTURE

### Q15: How does the Express backend bootstrap?
**Answer:** In `apps/api/src/index.ts`:
1. Loads environment variables with override (`env.ts`).
2. Validates mandatory secrets (`DATABASE_URL`, `JWT_SECRET`, `CONNECTOR_ENCRYPTION_KEY`, Google credentials).
3. Validates AI model configuration (`config/ai.ts`).
4. Mounts middleware (`cors`, `express.json`).
5. Mounts route routers across domain prefixes (`/api/auth`, `/api/businesses`, `/api/workflows`, etc.).
6. Initializes BullMQ queue consumers and background pollers (`emailPoller.start()`, `operationalSyncPoller.start()`).
7. Binds Express to `0.0.0.0:3001`.

### Q16: In what exact order is Express middleware executed?
**Answer:** 
1. Global middleware: `cors()`, `express.json()`.
2. Router-level authentication: `authenticate` (validates JWT, loads User).
3. Tenant isolation: `requireBusinessMembership` (resolves businessId, checks `Membership`).
4. Route handler execution with `asyncHandler`.
5. Global error handling.

### Q17: How is input validation handled in backend routes?
**Answer:** Routes perform structural validation checks on required fields (e.g. `if (!businessId || !name) return res.status(400)`), and models enforce schema constraints via Prisma validation and custom domain checks (e.g. `validateOrderTransition`).

### Q18: What is the purpose of `asyncHandler` in Express routes?
**Answer:** Located in `apps/api/src/utils/asyncHandler.ts`, it wraps asynchronous route handlers in a standard `Promise.resolve().catch(next)` block, preventing unhandled promise rejections from crashing the Node.js event loop.

### Q19: How are sensitive credentials scrubbed from application logs?
**Answer:** `WorkflowEngine.sanitize()` recursively traverses JSON objects and scrubs keys matching `['password', 'token', 'secret', 'authorization']` by replacing their values with `"[REDACTED]"`.

### Q20: How are long-running jobs offloaded from Express HTTP threads?
**Answer:** Express routes immediately create a database record with `status: QUEUED`, enqueue a lightweight job into BullMQ (`workflowQueue.add()`), and return HTTP 200/201 with the job/execution ID. Background processing runs on separate BullMQ worker threads.

---

## CATEGORY 4: PRISMA ORM & POSTGRESQL

### Q21: What is Prisma ORM, and how is it configured in Agent Flux V2?
**Answer:** Prisma is a next-generation TypeScript ORM. In Agent Flux V2, `prisma/schema.prisma` defines 45 models using PostgreSQL. The schema activates `previewFeatures = ["postgresqlExtensions"]` and `extensions = [vector]` for pgvector support. The shared client is generated into `@agent-flux/database`.

### Q22: How does Prisma Client manage database connection pooling?
**Answer:** In `packages/database/index.ts`, PrismaClient is instantiated as a singleton attached to `global.prisma` in development to prevent exhausting PostgreSQL connection pools during hot-reloads. In production, connection pooling is handled via PgBouncer using `directUrl` in `schema.prisma`.

### Q23: Why does `schema.prisma` declare `Unsupported("vector(768)")?` for embeddings?
**Answer:** Prisma does not have native schema primitive types for PostgreSQL extension vectors. The `Unsupported("vector(768)")` annotation tells Prisma to manage the column without attempting to serialize it as a standard scalar, allowing raw SQL queries (`$queryRawUnsafe` / `$executeRawUnsafe`) to perform vector operations.

### Q24: How does the application execute database transactions?
**Answer:** Critical financial and state machine transitions execute inside Prisma interactive transactions (`await prisma.$transaction(async (tx) => { ... })`). This guarantees ACID properties: if posting a journal line fails, the entire journal entry and audit log are rolled back atomically.

### Q25: How do compound unique constraints protect data integrity?
**Answer:** Examples in `schema.prisma`:
- `@@unique([businessId, orderNumber])`: Guarantees order numbers are sequential and unique within a business.
- `@@unique([businessId, workflowId, idempotencyKey])`: Prevents duplicate executions.
- `@@unique([businessId, sourceType, sourceId])`: Guarantees an invoice or payment cannot be recorded twice in the General Ledger.

### Q26: Does Prisma automatically protect against SQL injection?
**Answer:** Standard Prisma queries (e.g., `findMany`, `create`) use parameterized SQL under the hood. For vector queries using `$queryRawUnsafe`, parameters are bound using `$1`, `$2`, `$3` positional placeholders, preventing SQL injection vulnerabilities.

---

## CATEGORY 5: REDIS & BULLMQ QUEUES

### Q27: What is the difference between Redis, BullMQ, and the Workflow Engine?
**Answer:** 
- **Redis:** An in-memory distributed data store used as the backing storage broker for message queues and atomic distributed locks.
- **BullMQ:** A Node.js message queue library that manages job state machines (delayed, active, completed, failed), concurrency, retries, and rate limiting on top of Redis.
- **Workflow Engine:** The business domain service that interprets graph DAGs, executes step logic, evaluates condition branches, and invokes connectors.

### Q28: What queues exist in the application?
**Answer:**
1. `workflow-execution` (`workflowQueue.ts`): Processes workflow DAG runs.
2. `knowledge-processing` (`knowledgeQueue.ts`): Handles document text extraction and embedding generation.
3. `vendor-verification` (`vendorQueue.ts`): Handles automated third-party vendor verification.
4. `analytics-daily` (`analyticsQueue.ts`): Aggregates daily business performance metrics.

### Q29: What happens if Redis goes down while the API is running?
**Answer:** The application implements graceful fallback mechanisms. In `vendorQueue.ts`, if Redis is unreachable, `enqueueVendorVerification` catches the connection error and falls back to an in-process asynchronous task using `setImmediate()`. In `engine.ts`, direct synchronous execution can be invoked via `{ sync: true }`.

### Q30: What is the transaction-versus-queue consistency problem?
**Answer:** If PostgreSQL commits an `Order` or `WorkflowExecution` to disk, but the network drops before `workflowQueue.add()` successfully persists the job to Redis, the database record remains stuck in `QUEUED` status. In Agent Flux V2, `operationalSyncPoller.ts` sweeps periodically for stuck `PENDING` sync jobs, providing eventual consistency.

### Q31: How does BullMQ handle job retries and backoff?
**Answer:** Jobs are added with:
```typescript
{
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 }
}
```
If a worker throws an unhandled error, BullMQ schedules retry 1 at 5s, retry 2 at 10s, and retry 3 at 20s before marking the job as permanently failed.

### Q32: What is a BullMQ Job Scheduler, and where is it used?
**Answer:** It replaces deprecated Bull repeat options by registering deterministic cron schedules directly in Redis. `scheduleWorkflow()` in `workflowQueue.ts` uses `workflowQueue.upsertJobScheduler("cron-" + workflowId, { pattern: cron })` to trigger recurring workflow executions.

---

## CATEGORY 6: WORKFLOW ENGINE & AUTOMATION

### Q33: How does the workflow engine know which step to execute next?
**Answer:** Each `WorkflowStep` defines a `next` field. If `next` is an array of step IDs (`["step_2", "step_3"]`), the engine launches both concurrently. If `next` is a routing object (`{ "HIGH": "step_2", "DEFAULT": "step_3" }`), the engine reads the output route returned by the previous step (e.g. from `ConditionEngine`) and routes accordingly. If `next` is null, it falls back to the step with `stepOrder = currentStepOrder + 1`.

### Q34: What is immutable workflow version pinning?
**Answer:** When an execution starts, `WorkflowEngine.triggerWorkflow()` records `workflowVersionId: version.id`. During traversal, the engine loads steps strictly from that version snapshot. If an administrator edits the workflow canvas and saves version 2, active executions continue executing against version 1 without disruption.

### Q35: How does the engine detect and prevent execution cycles?
**Answer:** In `apps/api/src/services/workflow/engine.ts`, the runtime maintains an `executedInSession: Set<string>`. Before invoking `runNode(stepId)`, it checks `if (executedInSession.has(stepId)) return;`. This terminates potential infinite loops in cyclic definitions.

### Q36: How does human-in-the-loop approval pause and resume an execution?
**Answer:** 
1. **Pausing:** When a step of type `APPROVAL` executes, it calls `ApprovalService.createApprovalRequest()` and returns `{ _suspend: true, status: 'WAITING_APPROVAL' }`. The engine halts the branch and updates `WorkflowExecution` to `WAITING_APPROVAL`.
2. **Resuming:** When an authorized user approves the request via `POST /api/approvals/:id/decide`, the approval route updates the execution status to `QUEUED` and re-adds the execution to `workflowQueue`. The worker resumes execution using the saved context.

### Q37: How does `WAIT_FOR_EVENT` work?
**Answer:** When a workflow hits a `WAIT_FOR_EVENT` step, it records the event type and correlation parameters (e.g., `invoiceId`) into `context.metadata.waitingForEvent` and suspends. When `EventDispatcher.dispatch()` publishes an event, it queries for waiting executions with matching correlation keys, restores their state, and re-enqueues them to BullMQ.

### Q38: What happens if a step fails and `continueOnError` is set to true?
**Answer:** The engine records the step execution as `FAILED` in the database, stores the error in `context.steps[stepId].error`, logs a warning, and continues traversing downstream steps (or diverts to `next.ON_FAILURE` if defined).

### Q39: How does the engine resolve `{{variables}}`?
**Answer:** `variableParser.ts` uses regex `/\{\{([^}]+)\}\}/g` and splits the path by `.` (handling array indexing like `items[0]`). If the string matches `^{{var}}$` exactly, it returns the raw object/array; otherwise, it performs string interpolation.

### Q40: What happens if an approval request is rejected?
**Answer:** The approval record is marked `REJECTED`, the execution status transitions to `CANCELLED` or `FAILED`, and the engine logs the rejection reason without executing downstream commercial actions.

---

## CATEGORY 7: AI APIS & MODEL INTEGRATIONS

### Q41: Why use an API (Google Gemini / Groq) instead of training or fine-tuning an LLM from scratch?
**Answer:** 
1. **Cost & Infrastructure:** Pre-training an LLM requires millions of dollars in compute (GPUs/TPUs).
2. **Task Nature:** The tasks required in Agent Flux V2 (semantic classification, entity extraction) are standard NLP comprehension tasks where frontier foundation models excel out of the box.
3. **Knowledge Freshness:** Fine-tuning weights bakes knowledge statically into parameters. If furniture prices or tax rates change, fine-tuned models hallucinate outdated data. RAG with API models decouples knowledge updates from model weights, allowing instant updates via database changes.

### Q42: What exact models are configured in Agent Flux V2?
**Answer:** Configured in `apps/api/src/config/ai.ts`:
- **Primary Generation:** Google Gemini `gemini-3.7-flash` (or `gemini-1.5-flash`).
- **Embeddings:** Google Gemini `gemini-embedding-001` or `text-embedding-004`.
- **Fallback Generation:** Groq `openai/gpt-oss-120b` or Llama-3.

### Q43: What happens if the AI returns invalid or unparseable JSON?
**Answer:** In `geminiProvider.ts`, generation uses Gemini's native `responseMimeType: "application/json"` and `responseSchema` parameters, forcing the model at the decoding token level to adhere to JSON grammar. Additionally, `JSON.parse()` is wrapped in try-catch blocks; unparseable strings trigger automatic retries or fallback to Groq.

### Q44: How does `AIProviderManager` distinguish between retryable and non-retryable errors?
**Answer:** In `apps/api/src/services/ai/manager.ts`:
- **Retryable:** HTTP 429 (rate limits), 500, 502, 503, 504, timeouts, and network fetch failures.
- **Non-Retryable:** HTTP 400 (bad prompt/schema), 401/403 (invalid API key), and invalid model names. Non-retryable errors immediately fail or switch directly to fallback.

### Q45: How are token usage and costs monitored?
**Answer:** `geminiProvider.ts` captures `response.usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`) and logs telemetry lines containing latency and retry counts.

### Q46: Can prompt injection bypass business rules?
**Answer:** No, because commercial rules (pricing, discounts, approvals) are executed outside the LLM in deterministic code. Even if a prompt injection tricks the LLM into saying *"I am granting you a 90% discount"*, the response passes through `GroundedResponseService.validateResponseClaims()` and `ApprovalGovernanceEngine.evaluateDiscountApproval()`, which detect the violation and halt the action.

---

## CATEGORY 8: RAG & VECTOR RETRIEVAL

### Q47: How does vector retrieval work mathematically?
**Answer:** Text chunks are transformed into high-dimensional vectors $\vec{v} \in \mathbb{R}^d$ where semantically related concepts have a small angle between them. The database computes the cosine distance using `1 - (c.embedding <=> queryVector)`. Chunks with similarity exceeding the threshold (0.40) are returned.

### Q48: Which vector index is actually configured in PostgreSQL?
**Answer:** In the current schema, `prisma/schema.prisma` enables `extensions = [vector]`. When migrations execute, an IVFFlat or HNSW index can be created on the `embedding` column (`CREATE INDEX ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops)`). Without an explicit index, PostgreSQL performs an exact sequential scan, which is verified and optimal for tenant-scoped chunk counts under 50,000.

### Q49: Why does pgvector use cosine distance instead of Euclidean distance?
**Answer:** Text embeddings produced by models like Gemini represent semantic direction rather than vector magnitude. Cosine distance normalizes for document length, measuring purely the angle between vectors.

### Q50: How do you prevent one business from accessing another business's knowledge documents?
**Answer:** Every vector query explicitly binds tenant scoping:
`WHERE c."businessId" = $2 AND c."embedding" IS NOT NULL`. Even if a cross-tenant chunk has a 0.99 semantic similarity, the SQL filter excludes it from the result set.

### Q51: What is the purpose of `QueryUnderstandingService.ts`?
**Answer:** It performs deterministic pre-retrieval normalization. It strips conversational filler, detects customer intent, extracts requested product SKUs, and cross-references multi-turn conversation threads.

### Q52: What is the "false pricing negation" check in GroundedResponseService?
**Answer:** It is an automated validation assertion. If `HybridRetrievalEngine` successfully found a product price in the catalog, but the generated response text contains phrases like *"pricing is unavailable"*, `validateResponseClaims()` rejects the response as a contradiction.

### Q53: What happens when a customer asks for a product not in the catalog?
**Answer:** `QueryUnderstandingService` categorizes the query as `NOT_FOUND`. `GroundedResponseService` generates a polite abstention stating that the product is not in the active catalog, rather than allowing the model to hallucinate a fictional product.

### Q54: How does thread product inheritance work in ConversationOrchestrator?
**Answer:** If an email reply says *"send me quotation"* without naming a product, `ConversationOrchestrator` inspects previous enquiries and quotations in the thread. If a previous product (e.g. *"3-Door Wardrobe"*) was discussed, it inherits that product into the current quotation request.

---

## CATEGORY 9: ALGORITHMS & COMPLEXITY

### Q55: What is the time complexity of the DAG traversal algorithm?
**Answer:** $\mathcal{O}(|V| + |E|)$ where $|V|$ is the number of steps and $|E|$ is the number of next transitions. Because workflows typically have $|V| \le 50$, execution latency is dominated by external API calls (Gemini, Gmail) rather than graph traversal.

### Q56: What is the algorithmic complexity of the bank reconciliation matching algorithm?
**Answer:** Pairwise matching between $N_B$ unmatched bank transactions and $N_L$ unreconciled journal lines runs in $\mathcal{O}(N_B \cdot N_L)$. Candidate sorting runs in $\mathcal{O}(K \log K)$ where $K$ is the number of valid match candidates.

### Q57: How does the Customer Payment Score algorithm calculate timeliness?
**Answer:** It computes average days late:
$\bar{d}_{\text{late}} = \frac{1}{N} \sum \max(0, \text{paidDate} - \text{dueDate})$.
Timeliness score is computed as $\max(0, 100 - (\bar{d}_{\text{late}} \times 5))$, applying a 5-point deduction for every day of average delay.

### Q58: What is the time complexity of resolving a dot-notation variable?
**Answer:** $\mathcal{O}(P)$ where $P$ is the number of path segments (typically $2 - 5$). Array access is performed in $\mathcal{O}(1)$ via regular expression index extraction.

### Q59: Why is arbitrary precision Decimal arithmetic required in the General Ledger?
**Answer:** Standard IEEE 754 floating-point arithmetic introduces rounding drift (e.g., $0.1 + 0.2 = 0.30000000000000004$). In double-entry accounting, this drift breaks the debit-credit balance invariant. Agent Flux V2 uses PostgreSQL `Decimal(18, 4)` and Prisma's Decimal type to guarantee exact minor-unit arithmetic.

### Q60: How does the condition engine evaluate regex patterns safely?
**Answer:** `ConditionEngine` wraps `new RegExp(expected, 'i').test(actual)` in a try-catch block, safely falling back to boolean false if an invalid or malicious regex string is provided.

---

## CATEGORY 10: SECURITY, AUTHENTICATION & MULTI-TENANCY

### Q61: What encryption algorithm protects OAuth tokens, and why?
**Answer:** AES-256-GCM (Galois/Counter Mode). Unlike unauthenticated CBC mode, GCM provides authenticated encryption with an authentication tag, preventing ciphertext tampering. Each encryption uses a unique 96-bit random IV.

### Q62: What happens if an attacker tampers with the ciphertext of an OAuth token?
**Answer:** During decryption in `services/encryption.ts`, `decipher.setAuthTag(authTag)` verifies message integrity. Tampered ciphertext causes `decipher.final()` to throw an authentication error, rejecting the token.

### Q63: How are JWT tokens verified?
**Answer:** In `apps/api/src/middleware/auth.ts`, `jwt.verify(token, JWT_SECRET)` validates the token signature and expiration date. The `userId` payload is verified against the database to confirm the user account is active.

### Q64: How do you prevent IDOR (Insecure Direct Object Reference) vulnerabilities?
**Answer:** Routes never trust IDs supplied in the request body without validation. `requireBusinessMembership` verifies that `req.user.id` belongs to `businessId`. All database operations scope their queries by `where: { id, businessId }`.

### Q65: What security controls protect customer billing address intake forms?
**Answer:** Forms are accessed via signed, order-scoped JWT tokens generated by `CustomerFormService.generateFormToken()`. Tokens expire in 48 hours and restrict updates exclusively to the billing address of that specific order.

### Q66: How does the system handle webhook signature verification?
**Answer:** In `payment-webhooks.ts`, incoming Razorpay webhooks require computing HMAC-SHA256 of the raw body using `RAZORPAY_WEBHOOK_SECRET` and asserting equality against the `x-razorpay-signature` header before processing payments.

---

## CATEGORY 11: EXTERNAL INTEGRATIONS

### Q67: How does Google OAuth2 token refreshing work?
**Answer:** Before invoking a Google API, the service checks if `expiresAt < Date.now() + 5 minutes`. If expiring, it uses the decrypted refresh token with `oauth2Client.refreshAccessToken()`, encrypts the new access token, and updates `IntegrationCredential` in PostgreSQL.

### Q68: What happens if Google revokes user access?
**Answer:** When `refreshAccessToken` throws an `invalid_grant` error, the integration record status is updated to `RECONNECT_REQUIRED`, poller loops skip the account, and the UI displays an alert to reconnect.

### Q69: How does the Google Calendar integration find available meeting slots?
**Answer:** `googleCalendar.ts` invokes `calendar.events.list` across working hours (9:00 AM - 5:00 PM). It scans a 3-day window for 30-minute intervals that have zero overlap with existing events, formatting the first 3 free slots as alternatives.

### Q70: How is automated meeting booking confirmed?
**Answer:** When a single slot is confirmed, `calendar.events.insert` creates a Google Calendar event with `conferenceDataVersion: 1`, automatically generating a Google Meet video conference link and inviting the customer.

### Q71: How does operational sync to Google Sheets avoid duplicating rows?
**Answer:** `OperationalSyncService` records sync status in `OperationalSyncJob`. It checks whether an entity row already exists in the spreadsheet before appending or updating.

### Q72: How are document attachments prepared for Gmail dispatch?
**Answer:** In `DocumentGenerationService.ts` and `ActionRegistry.ts`, generated PDFs are read from disk, converted to Base64 buffers, and structured into MIME multipart format using `nodemailer` or Gmail REST API payloads.

---

## CATEGORY 12: FINANCE & DOUBLE-ENTRY ACCOUNTING

### Q73: What are the 6 accounting invariants enforced by LedgerService?
**Answer:**
1. **Balance:** Total Debits must exactly equal Total Credits.
2. **Non-negativity:** No debit or credit amount may be negative.
3. **Exclusivity:** A single line cannot have both a debit and a credit.
4. **Cardinality:** Every entry must contain at least two lines.
5. **Period Lockdown:** Entries cannot be posted to a closed or locked accounting period.
6. **Immutability:** Posted entries cannot be edited or deleted; corrections require reversing journal entries.

### Q74: What is a reversing journal entry, and when is it generated?
**Answer:** When an operator voids a posted journal entry, `LedgerService.voidJournalEntry()` creates a new entry with inverted debits and credits linked via `reversalOfEntryId`. This preserves the historical audit trail without destroying ledger provenance.

### Q75: How does the system prevent duplicate invoice numbering?
**Answer:** Invoices use sequential numbering (`AF-INV-YYYY-XXXXX`) enforced by `@@unique([businessId, invoiceNumber])` in PostgreSQL and atomic document sequence locks in `DocumentSequence`.

### Q76: What is the Trial Balance, and how is it verified?
**Answer:** The Trial Balance aggregates net debit and credit balances across all active Chart of Accounts. Mathematical equilibrium is verified when:
$$\sum \text{Account Debits} - \sum \text{Account Credits} = 0.00$$
Verified passing in `finance-ledger-invariants.test.ts`.

### Q77: How are Accounts Receivable reconciled between the subledger and General Ledger?
**Answer:** `CustomerBalanceService.ts` sums outstanding invoice balances (the operational subledger) and compares the sum against the net debit balance of the `ACCOUNTS_RECEIVABLE` GL account (`1020`). If a discrepancy exists, it raises a `WARNING_DISCREPANCY` alert.

### Q78: What accounts are created when `seedStandardAccounts` executes?
**Answer:** 13 standard accounts: Cash and Bank (`1010`), Accounts Receivable (`1020`), Inventory (`1030`), Fixed Assets (`1510`), Accounts Payable (`2010`), Output GST / Tax Payable (`2020`), Owner's Equity (`3010`), Retained Earnings (`3020`), Operating Revenue (`4010`), Other Income (`4020`), Cost of Goods Sold (`5010`), Operating Expense (`5020`), and Tax Expense (`5030`).

---

## CATEGORY 13: TESTING, LIMITATIONS & FUTURE ROADMAP

### Q79: How many automated tests exist, and what do they verify?
**Answer:** Over 22 dedicated test suites in `apps/api/src/tests`, including:
- `aasha-grounding-suite.ts`: 41/41 passing tests verifying RAG grounding, zero hallucination, and policy matrices.
- `finance-ledger-invariants.test.ts`: 9/9 passing tests verifying all 6 accounting invariants and trial balance equilibrium against live PostgreSQL.
- `oauth-security.test.ts`: Validates OAuth token encryption and refresh security.

### Q80: What is the most significant technical limitation of the current implementation?
**Answer:** The primary technical limitation is vector index tuning in production: while pgvector is enabled, high-throughput multi-million chunk search requires provisioning HNSW index parameters (`m`, `ef_construction`) tuned to memory limits, and embedding dimensions must be kept strictly synchronized between environment variables and schema column definitions.

### Q81: What happens if an email contains conflicting requests?
**Answer:** `GroundedResponseService` classifies the response state as `CONFLICTING_KNOWLEDGE` or `AMBIGUOUS` and asks the customer for clarification rather than making assumptions.

### Q82: How does the system handle bank reconciliation when transaction descriptions are misspelled?
**Answer:** The fuzzy matching algorithm combines exact amount matching with date window tolerances (within 1 to 7 days) and tokenized description overlap scoring, allowing successful candidate matching even with partial descriptions.

### Q83: Why is segregation of duties enforced in the approval matrix?
**Answer:** In `ApprovalGovernanceEngine.ts`, operators cannot self-approve their own financial discount or refund requests. The system validates that the approving `userId` differs from the creating user.

### Q84: How would you scale the system to handle 10,000 businesses?
**Answer:** 
1. Database sharding or tenant database isolation via PostgreSQL schemas.
2. Clustered Redis instances with separate BullMQ queue prefixes per tenant tier.
3. Dedicated background worker containers running independently of Express HTTP nodes.
4. CDN edge caching for static frontend assets and generated documents.

### Q85: How do you prove an automated action really succeeded?
**Answer:** Every action execution produces a `WorkflowStepExecution` record containing the external provider's response payload (e.g. Gmail message ID, Google Drive file ID, Razorpay order ID).

### Q86: What is the difference between `WAITING` and `WAITING_APPROVAL` status?
**Answer:** `WAITING` indicates the workflow is suspended waiting for a system timer (`DELAY`) or an external webhook event (`WAIT_FOR_EVENT`). `WAITING_APPROVAL` specifically indicates that execution is blocked pending a human reviewer decision.

### Q87: If a student examiner asks: "Did you just build an AI wrapper?", how do you defend the project?
**Answer:** "No. Less than 10% of this codebase touches an LLM. Agent Flux V2 is a full-stack distributed automation platform with an immutable DAG workflow engine, a classical double-entry General Ledger enforcing all 6 accounting invariants, a custom AES-256-GCM credential vault, an asynchronous BullMQ queue architecture, and a 5-tier hybrid grounding engine that rejects hallucinations using deterministic code assertions. The LLM is merely an intake comprehension tool; the core engineering is deterministic systems programming."

### Q88: What future enhancement would provide the highest immediate business value?
**Answer:** Implementing an integrated WhatsApp Business API connector alongside Gmail, allowing bidirectional automated quotation generation, payment link dispatch, and appointment scheduling over mobile messaging.
