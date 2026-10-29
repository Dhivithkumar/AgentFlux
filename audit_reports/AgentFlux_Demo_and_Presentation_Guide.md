# AGENT FLUX V2 — DEMO & PRESENTATION GUIDE
**Live Demonstration Runbooks, Timed Presentation Scripts & Examiner Defense Manual**  
*Document Ref: AFV2-AUDIT-DEMO-2026-10-28*  
*Repository: [https://github.com/Dhivithkumar/AgentFlux](https://github.com/Dhivithkumar/AgentFlux)*  

---

## 1. Timed Presentation Scripts

### 1.1 The Two-Minute Executive Pitch (Elevator Summary)
> "Good morning, respected examiners. Today I am presenting **Agent Flux V2**, an autonomous business operations and workflow automation platform designed to solve operational fragmentation and commercial risk for bespoke manufacturing and trade enterprises.
>
> In traditional small-to-medium businesses, customer communication across emails and calendars is completely disconnected from operational workflows, document generation, and accounting ledgers. When businesses try to automate customer interactions with generic AI chatbots or LLMs, they face severe commercial risks: models hallucinate non-existent discounts, promise unrealistic delivery dates, or make up pricing.
>
> Agent Flux V2 solves this through a **dual-engine architecture**. We use frontier LLMs like Google Gemini strictly for natural language comprehension and entity extraction. However, all commercial math—such as 18% GST taxes, bespoke customization charges, 50% advance splits, and discount delegations—is computed by a deterministic, zero-hallucination domain engine. 
>
> Our system natively orchestrates Directed Acyclic Graph (DAG) workflows, archives generated PDF quotations directly to Google Drive, synchronizes orders to Google Sheets in real-time, and posts balanced journal entries into a strict double-entry General Ledger. In short, Agent Flux V2 converts unstructured customer emails into verified, audited, and legally grounded business transactions."

---

### 1.2 The Five-Minute Technical Walkthrough
> "Respected committee, I would like to delve into the technical architecture of Agent Flux V2. The platform is engineered as a monorepo containing a React 18 single-page application, an Express TypeScript API server, and a shared database library backed by PostgreSQL and Prisma ORM.
>
> The core technical innovation lies in our **5-tier Hybrid Grounding Engine**. When an inbound email arrives via Gmail, our background poller claims the message using an atomic Redis `SETNX` lock to guarantee single-delivery semantics. Next, our `QueryUnderstandingService` parses the customer's intent and identifies product references across multi-turn email history. 
>
> Instead of immediately prompting an LLM to generate an answer, the query passes through five discrete retrieval layers:
> First, exact catalog matching against approved SKUs.
> Second, relational cross-document linking to customization guides.
> Third, deterministic financial computation where subtotal, GST, and advance deposit terms are calculated using precise arithmetic.
> Fourth, an approval governance matrix that checks delegated authority tiers—for instance, flagging discounts above 5% for manager approval.
> Fifth, pgvector semantic search using cosine distance to retrieve supplementary unstructured context.
>
> Before any email response is sent, our `GroundedResponseService` runs code-level assertion tests. It programmatically scans the draft to confirm that no unverified stock claims, immediate delivery promises, or unresolved placeholders exist. If a requested product is not in the catalog, the system safely abstains with zero hallucination.
>
> Furthermore, on the backend, the platform runs an asynchronous DAG workflow engine built on BullMQ and Redis. It supports 9 distinct step types, including human-in-the-loop approvals and long-running event suspensions. Crucially, when an order is finalized, our `LedgerService` enforces all six classical accounting invariants, ensuring total debits equal total credits and voided transactions are reversed with full audit provenance. All 41 grounding regression tests and 9 financial ledger tests pass with 100% precision."

---

### 1.3 The Ten-Minute Deep Architectural Presentation Script
*(Use this comprehensive script for your formal viva presentation, following your slide deck.)*

- **Slide 1: Title & Problem Statement (0:00 - 1:30)**  
  "Examiners, the problem we address in Agent Flux V2 is the commercial vulnerability of modern trade operations. When an enterprise receives dozens of complex bespoke enquiries daily, sales teams become a bottleneck, while ungrounded AI solutions present high financial and legal liability. Our objective was to build an enterprise platform that automates the end-to-end operational lifecycle from enquiry to ledger balance with mathematical rigor."

- **Slide 2: Monorepo Architecture & Multi-Tenancy (1:30 - 3:00)**  
  "Our repository is structured as a pnpm workspace monorepo. The backend enforces strict multi-tenancy at the gateway layer through `requireBusinessMembership` middleware. User passwords are encrypted with bcrypt; all external OAuth tokens for Google services are encrypted with authenticated AES-256-GCM using unique 96-bit random initialization vectors. Database models in PostgreSQL are strictly scoped by `businessId`."

- **Slide 3: Autonomous Intake & Redis Idempotency (3:00 - 4:30)**  
  "When an inbound email is detected by `emailPoller.ts`, `ConversationOrchestrator` coordinates intake. Distributed concurrency control is enforced via Redis `SETNX`, expiring after 7 days. Customer identity is resolved from the sender's email address. The orchestrator reconstructs conversation history across threads, allowing customers to reference previous quotes implicitly."

- **Slide 4: Zero-Hallucination Hybrid RAG Pipeline (4:30 - 6:30)**  
  "Our RAG pipeline completely re-thinks traditional vector search. We chunk documents using document-aware boundaries that preserve table rows and SKU metadata. We store vectors using PostgreSQL's `pgvector` extension. But crucially, vector retrieval is merely a fallback layer. Our primary retrieval is deterministic: exact catalog lookup, rule-based customization linking, and code-based financial calculation. We enforce seven explicit factual states, ensuring that when facts are missing, the system abstains or asks for clarification."

- **Slide 5: DAG Workflow Engine & Human Approvals (6:30 - 8:00)**  
  "Our workflow engine parses graph definitions by calculating incoming dependency edges. Root steps are executed, and branching transitions are evaluated via `ConditionEngine`. When an execution requires human sign-off—such as a 12% price discount—the step cleanly suspends its state to the database, freeing worker threads. The business owner reviews the request in the approvals dashboard, and upon sign-off, BullMQ resumes the execution seamlessly."

- **Slide 6: Double-Entry General Ledger & Document Pipeline (8:00 - 9:15)**  
  "Our financial core is not a simple dashboard counter; it is a true double-entry General Ledger. Every invoice, payment, and refund creates balanced journal entries across standard Chart of Accounts. We enforce non-negative lines, period lockdown enforcement, and immutable audit trails via reversing entries. In parallel, our document generation engine uses a dual-engine architecture: attempting high-fidelity platform Word/LibreOffice conversion first, with automatic failover to pure Node.js mammoth and pdfkit."

- **Slide 7: Verification & Conclusion (9:15 - 10:00)**  
  "To prove the system works, we developed 22 automated test suites. Our 41-case grounding suite validates that zero hallucinations occur across pricing, discounts, delivery times, and cross-tenant boundaries. Our ledger invariant suite verifies mathematical equilibrium in trial balance calculations. Agent Flux V2 proves that AI business automation can be made deterministic, audited, and enterprise-ready. Thank you, and I look forward to your questions."

---

## 2. Step-by-Step Live Demonstration Runbook

Follow these exact steps during your practical viva demonstration:

### Step 1: System Boot & Health Verification
1. Ensure PostgreSQL and Redis are running.
2. In terminal 1:
   ```bash
   cd apps/api
   npm run dev
   ```
   *Expected Output:*
   ```
   Environment loaded successfully.
   AI Provider Configuration: Gemini generation model: gemini-3.7-flash
   Starting Email Poller (interval: 10000ms)
   API running on port 3001
   ```
3. In terminal 2:
   ```bash
   cd apps/web
   npm run dev
   ```
   *Expected Output:*
   ```
   VITE v5.2.0 ready in 340 ms
   ➜ Local: http://localhost:3000/
   ```
4. Verify `/api/health`: In browser, open `http://localhost:3001/api/health`. Expected: `{"status":"ok"}`.

---

### Step 2: Multi-Tenant Workspace & Dashboard
1. Open browser to `http://localhost:3000/login`.
2. Login with credentials (`owner@example.com` / `password123`) or register a new user.
3. Observe `DashboardLayout`:
   - Top navigation shows active business: **Aasha Furniture**.
   - Show examiner the business switcher dropdown allowing instant context switching.
   - Show navigation sidebar: *Dashboard, Calendar, Knowledge Centre, Enquiry Inbox, Orders & Bookings, Finance Centre, Vendor Centre, Workflow Center, Settings*.

---

### Step 3: Demonstrating RAG & Grounded Retrieval
1. Navigate to `/dashboard/knowledge`.
2. Show the active documents: `02_Product_Catalogue.pdf`, `03_Product_Customization_Guide.pdf`, `10_Payment_Policy.pdf`.
3. Open terminal or API client to demonstrate `/api/knowledge/debug`:
   ```bash
   curl -X POST http://localhost:3001/api/knowledge/debug \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <TOKEN>" \
     -d '{"businessId":"<BIZ_ID>","query":"What is the price of a 3-door wardrobe with an extra drawer?"}'
   ```
4. Point out the debug response in the terminal:
   - `detectedIntent`: `QUOTATION_REQUEST`
   - `exactMatches`: `["WAR-001"]` (Base Price: ₹28,000)
   - `customizations`: `["Additional interior drawer"]` (Charge: ₹1,800)
   - `totalAmount`: `₹35,164` (including 18% GST)
   - `groundingDecision`: `allowAutomaticAnswer: true`

---

### Step 4: Demonstrating Zero-Hallucination Safe Abstention
1. In the same debug endpoint, query a non-existent product:
   ```json
   { "query": "How much for a titanium dining table?" }
   ```
2. Show examiner that the system returns:
   - `state`: `"NOT_FOUND"`
   - `confidence`: `0`
   - `response`: *"We couldn't find that product or item in the current Aasha Furniture catalogue..."*
3. **Key Viva Defense Point:** Show the examiner that the system *did not guess a price or invent a specification*.

---

### Step 5: Demonstrating Human-in-the-Loop Approval Workflow
1. Submit an enquiry requesting an unapproved discount:
   ```json
   { "query": "Can you give me a 15% discount on the wardrobe?" }
   ```
2. Show examiner the response:
   - `status`: `"APPROVAL_REQUIRED"`
   - `requiresApproval`: `true`
   - `requiredApprover`: `"Owner"`
   - Response message: *"Regarding your request for a 15% discount, discounts above 5% require Owner approval..."*
3. Navigate to `/dashboard/workflows/approvals` in the web UI.
4. Show the pending approval card for the 15% discount.
5. Click **Approve** and show the database state change to `APPROVED`.

---

### Step 6: Demonstrating General Ledger Invariants
1. Run the live ledger test suite in front of the examiner:
   ```bash
   npx tsx src/tests/finance-ledger-invariants.test.ts
   ```
2. Walk the examiner through the 9 live test results:
   - **Test 1:** Chart of Accounts seeded idempotently (13 accounts).
   - **Test 3:** Unbalanced entry rejected with `LEDGER_UNBALANCED`.
   - **Test 4:** Negative line amount rejected with `NEGATIVE_AMOUNT_REJECTED`.
   - **Test 6:** Closed period entry rejected with `PERIOD_LOCKED`.
   - **Test 8:** Reversing journal entry inverted lines correctly.
   - **Test 9:** Trial balance equilibrium: Difference = $0.00.

---

## 3. Glossary of Technical Terms for Viva Defense

| Term | Technical Definition in Agent Flux V2 |
| :--- | :--- |
| **AST (Abstract Syntax Tree)** | Tree representation of condition expressions evaluated recursively in `ConditionEngine.ts`. |
| **Cosine Distance (`<=>`)** | Metric space distance operator used in pgvector to measure angular variance between embedding vectors. |
| **DAG (Directed Acyclic Graph)** | Non-circular directed graph representing workflow steps, execution branches, and error handlers. |
| **Deterministic Grounding** | Validating AI outputs against verified database records using code assertions rather than LLM prompts. |
| **Double-Entry Equilibrium** | Accounting invariant stating that every debit must have an equal and offsetting credit: $\sum \text{Debits} = \sum \text{Credits}$. |
| **Idempotency** | The property where an operation can be applied multiple times without changing the result beyond the initial application. |
| **IV (Initialization Vector)** | 96-bit random nonce used in AES-256-GCM encryption to guarantee that identical plaintexts produce different ciphertexts. |
| **Jitter** | Adding a randomized delay ($\mathcal{U}(0, 200\text{ms})$) to exponential backoff to prevent thundering-herd API collisions. |
| **pgvector** | Open-source PostgreSQL extension providing high-dimensional vector storage and approximate nearest neighbor search. |
| **Prisma Interactive Transaction** | Atomic database transaction where multiple operations execute within a single PostgreSQL transaction block. |
| **Reversing Journal Entry** | A journal entry created to void a posted transaction by inverting debits and credits, preserving ledger audit history. |
| **Safe Abstention** | The capability of an AI system to state that knowledge is unavailable rather than generating a probabilistic guess. |
| **Subledger** | Operational financial ledger (such as individual customer invoice balances) that rolls up into the General Ledger. |
| **Topological Traversal** | Graph traversal ordering that respects incoming dependencies, executing prerequisites before downstream steps. |
