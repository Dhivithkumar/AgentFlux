# AGENT FLUX V2 — ALGORITHMS & DESIGN PATTERNS REFERENCE
**Algorithmic Formulations, Complexity Bounds, Implementation Locations & Trade-offs**  
*Document Ref: AFV2-AUDIT-ALGO-2026-10-28*  
*Repository: [https://github.com/Dhivithkumar/AgentFlux](https://github.com/Dhivithkumar/AgentFlux)*  

---

## 1. Overview of Evaluated Algorithms

This document catalogues the mathematical algorithms, graph traversal techniques, heuristic scoring models, and enterprise design patterns implemented in Agent Flux V2. Every algorithm is documented with its exact implementation location, mathematical formulation, time/space complexity, and practical limitations.

---

## 2. Inventory of Implemented Algorithms

### 2.1 Graph Dependency Resolution & Topological Root Identification
- **Category:** Directed Acyclic Graph (DAG) Traversal.
- **Implementation File:** `apps/api/src/services/workflow/engine.ts` (Lines 273–288, 474–492).
- **Function/Method:** `WorkflowEngine.executeWorkflow()`.
- **Purpose:** Identifies root execution steps and resolves branching dependencies across workflow steps without assuming fixed array ordering.
- **Mathematical / Algorithmic Formulation:**
  Let $G = (V, E)$ be a directed graph where $V$ is the set of workflow steps and $E$ is the set of directed transitions defined in each step's `next` field.
  1. Initialize in-degree map: $\forall v \in V, \text{inDegree}[v] \leftarrow 0$.
  2. For each node $u \in V$:
     $$\forall v \in \text{targets}(u.\text{next}), \quad \text{inDegree}[v] \leftarrow \text{inDegree}[v] + 1$$
  3. Identify root set: $R = \{ v \in V \mid \text{inDegree}[v] = 0 \}$.
  4. Launch concurrent traversal: $\forall r \in R, \text{Promise.all}(\text{runNode}(r))$.
- **Complexity:**
  - Time Complexity: $\mathcal{O}(|V| + |E|)$ where $|V|$ is the number of steps and $|E|$ is the number of branch connections.
  - Space Complexity: $\mathcal{O}(|V|)$ auxiliary space for in-degree tracking and execution call sets.
- **Limitations & Verification:**
  - *Status:* VERIFIED IMPLEMENTED.
  - *Limitation:* The current implementation detects cycles dynamically at runtime via `executedInSession` sets, rather than running a compile-time Tarjan's strongly connected components check upon workflow draft saving.

---

### 2.2 Recursive Condition Evaluation Engine
- **Category:** Boolean Abstract Syntax Tree (AST) Evaluator.
- **Implementation File:** `apps/api/src/services/workflow/conditionEngine.ts` (Lines 18–167).
- **Class / Method:** `ConditionEngine.evaluate()`, `ConditionEngine.evaluateBranch()`.
- **Purpose:** Dynamically evaluates logical branching conditions across multi-nested context parameters.
- **Algorithmic Formulation:**
  Evaluates boolean expressions defined recursively:
  $$\text{eval}(C) = \begin{cases}
  \bigwedge_{c \in C.\text{all}} \text{eval}(c), & \text{if } C.\text{all} \text{ present} \\
  \bigvee_{c \in C.\text{any}} \text{eval}(c), & \text{if } C.\text{any} \text{ present} \\
  \text{applyOp}(C.\text{op}, \text{resolve}(C.\text{field}), C.\text{value}), & \text{if leaf node}
  \end{cases}$$
  Supports 18 operators: `EQUALS`, `NOT_EQUALS`, `GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL`, `IN`, `NOT_IN`, `EXISTS`, `NOT_EXISTS`, `IS_EMPTY`, `NOT_EMPTY`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `IS_TRUE`, `IS_FALSE`, `MATCHES`/`REGEX`.
- **Complexity:**
  - Time Complexity: $\mathcal{O}(D \cdot K)$ where $D$ is the condition tree depth and $K$ is the maximum dot-notation path length in field resolution.
  - Space Complexity: $\mathcal{O}(D)$ recursion stack frames.
- **Verification:** VERIFIED IMPLEMENTED. Tested with complex nested discount and credit rules.

---

### 2.3 Vector Similarity Search & Cosine Distance Metric
- **Category:** Vector Embeddings & Metric Space Search.
- **Implementation File:** `apps/api/src/services/knowledge.ts` (Lines 173–207).
- **Method:** `KnowledgeProcessingService.searchKnowledgeBase()`.
- **Mathematical Formulation:**
  Given a query text $q$, Gemini generates a normalized vector $\vec{u} \in \mathbb{R}^d$ ($d = 768$ or $3072$).
  pgvector evaluates cosine distance using the `<=>` operator:
  $$\mathcal{D}_{\text{cosine}}(\vec{u}, \vec{v}) = 1 - \frac{\vec{u} \cdot \vec{v}}{\|\vec{u}\|_2 \|\vec{v}\|_2}$$
  The similarity score returned to the application is:
  $$\mathcal{S}(\vec{u}, \vec{v}) = 1 - \mathcal{D}_{\text{cosine}}(\vec{u}, \vec{v}) = \frac{\vec{u} \cdot \vec{v}}{\|\vec{u}\|_2 \|\vec{v}\|_2}$$
  Filtered by similarity threshold: $\mathcal{S}(\vec{u}, \vec{v}) > 0.40$, ordered by $\mathcal{S}$ descending.
- **Complexity:**
  - Exact Sequential Scan: $\mathcal{O}(N \cdot d)$ where $N$ is chunk count and $d$ is vector dimensions.
  - HNSW Index Scan (when configured): $\mathcal{O}(d \cdot \log N)$ approximate nearest neighbor query.
- **Verification:** VERIFIED IMPLEMENTED. In `schema.prisma`, `extensions = [vector]`.

---

### 2.4 Multi-Tier Hybrid Reranking & Retrieval
- **Category:** Information Retrieval & Grounding Fusion.
- **Implementation File:** `apps/api/src/services/knowledge/HybridRetrievalEngine.ts` (Lines 53–331).
- **Method:** `HybridRetrievalEngine.retrieve()`.
- **Algorithmic Strategy:**
  Executes an authoritative cascade rather than reciprocal rank fusion (RRF):
  1. *Tier 1 (Exact Match):* Deterministic regex and SKU catalog lookup ($\text{Score} = 1.0$).
  2. *Tier 2 (Customization Linking):* Cross-document relation lookup ($\text{Score} = 0.98$).
  3. *Tier 3 (Financial Linking):* Deterministic calculation of GST, discounts, and payment splits.
  4. *Tier 4 (Policy Evaluation):* Governance delegation check.
  5. *Tier 5 (Vector Fallback):* Semantic chunk retrieval ($\text{Score} \in [0.40, 0.95]$).
- **Verification:** VERIFIED IMPLEMENTED. Validated via `aasha-grounding-suite.ts` (41/41 passing).

---

### 2.5 Classical Double-Entry Balance Invariant & Equilibrium
- **Category:** Accounting & Financial Mathematics.
- **Implementation File:** `apps/api/src/services/finance/LedgerService.ts` (Lines 141–193).
- **Method:** `LedgerService.createJournalEntry()`.
- **Invariants Enforced:**
  1. **Equation of Equilibrium:** Every entry must balance exactly to 4 decimal places:
     $$\sum_{i=1}^{n} \text{Debit}_i - \sum_{i=1}^{n} \text{Credit}_i = 0 \quad (\pm 0.0000)$$
  2. **Non-Negativity Constraint:** $\forall i, \text{Debit}_i \ge 0 \land \text{Credit}_i \ge 0$.
  3. **Exclusivity Constraint:** $\forall i, (\text{Debit}_i > 0 \land \text{Credit}_i = 0) \lor (\text{Debit}_i = 0 \land \text{Credit}_i > 0)$.
  4. **Minimum Cardinality:** $n \ge 2$.
  5. **Audit Immutability:** Posted entries cannot be modified or deleted. Reversals invert lines:
     $$\text{Debit}_{\text{reversal}, i} \leftarrow \text{Credit}_{\text{original}, i}, \quad \text{Credit}_{\text{reversal}, i} \leftarrow \text{Debit}_{\text{original}, i}$$
- **Complexity:** $\mathcal{O}(n)$ arithmetic operations using arbitrary-precision `Prisma.Decimal`.
- **Verification:** VERIFIED IMPLEMENTED. Validated in `finance-ledger-invariants.test.ts` (9/9 passing).

---

### 2.6 Bank Reconciliation Fuzzy Matching Algorithm
- **Category:** Heuristic Financial Record Linkage.
- **Implementation File:** `apps/api/src/services/finance/BankReconciliationService.ts` (Lines 181–285).
- **Method:** `BankReconciliationService.findMatchCandidates()`.
- **Algorithmic Scoring Formulation:**
  For each unmatched bank transaction $B$ and unreconciled journal line $L$:
  $$\text{Match Score} = S_{\text{amount}} + S_{\text{date}} + S_{\text{ref}} + S_{\text{desc}}$$
  Where:
  - **Amount Constraint:** $|B.\text{amount}| == L.\text{amount}$. If unequal, $\text{Score} = 0$ (Pruned). Base score = $70$.
  - **Date Variance Scoring ($S_{\text{date}}$):**
    Let $\Delta t = |B.\text{date} - L.\text{date}|$ in days.
    $$S_{\text{date}} = \begin{cases}
    +15, & \Delta t \le 1 \\
    +10, & 1 < \Delta t \le 3 \\
    0, & 3 < \Delta t \le 7 \\
    \text{Prune}, & \Delta t > 7
    \end{cases}$$
  - **Reference Matching ($S_{\text{ref}}$):** $+15$ if $B.\text{reference}$ is a substring in $L.\text{memo}$ or $L.\text{entryNumber}$.
  - **Token Overlap Matching ($S_{\text{desc}}$):**
    $$\min\left(10, \; 5 \times |\{\text{words} \ge 4 \text{ chars in } B.\text{desc}\} \cap L.\text{desc}|\right)$$
  - **Total Confidence:** $\min(100, \text{Match Score})$.
  - Transactions with $\text{Score} \ge 90$ qualify for `autoReconcile()`.
- **Complexity:** $\mathcal{O}(N_B \cdot N_L)$ pairwise comparisons, sorted in $\mathcal{O}(K \log K)$.
- **Verification:** VERIFIED IMPLEMENTED. Tested in `finance-bank-reconciliation.test.ts`.

---

### 2.7 Order Priority Scoring Algorithm
- **Category:** Multi-Factor Decision Analysis & Triage.
- **Implementation File:** `apps/api/src/services/order/OrderPriorityService.ts` (Lines 33–140).
- **Method:** `OrderPriorityService.evaluateOrderPriority()`.
- **Mathematical Model:**
  Orders are assigned a base score of 50.
  - **Critical Financial Escalation Rule:** If $\text{hasOverdueBalance} \lor \text{hasCreditBreach} \lor \text{isPastDueDeadline} \lor \text{hasFailedPayment}$:
    $$\text{Priority} \leftarrow \text{CRITICAL}, \quad \text{Score} \leftarrow 95$$
  - **Dynamic Multi-Factor Scoring:** Otherwise, score is calculated as:
    $$\text{Score} = 50 + \Delta_{\text{deadline}} + \Delta_{\text{value}} + \Delta_{\text{trust}} + \Delta_{\text{risk}}$$
    Where:
    - $\Delta_{\text{deadline}} = +25$ if hours until due $\le 48$.
    - $\Delta_{\text{value}} = +15$ if order total $\ge ₹50,000$.
    - $\Delta_{\text{trust}} = -10$ (de-prioritize administrative risk) if customer is trusted repeat buyer.
    - $\Delta_{\text{risk}} = +15$ if customer payment score $< 40$.
  - **Threshold Binning:**
    $$\text{Level} = \begin{cases}
    \text{CRITICAL}, & \text{Score} \ge 90 \\
    \text{HIGH}, & 70 \le \text{Score} < 90 \\
    \text{NORMAL}, & 40 \le \text{Score} < 70 \\
    \text{LOW}, & \text{Score} < 40
    \end{cases}$$
- **Verification:** VERIFIED IMPLEMENTED.

---

### 2.8 Customer Payment Score Scoring Model
- **Category:** Credit Risk & Predictive Financial Timeliness.
- **Implementation File:** `apps/api/src/services/customer/CustomerPaymentScoreService.ts` (Lines 48–170).
- **Method:** `CustomerPaymentScoreService.calculateCustomerScore()`.
- **Mathematical Formulation:**
  Weighted composite index:
  $$\text{Score} = 0.40 \cdot S_{\text{onTime}} + 0.25 \cdot S_{\text{completion}} + 0.20 \cdot S_{\text{timeliness}} + 0.15 \cdot S_{\text{debtRisk}}$$
  Where:
  1. **On-Time Rate ($S_{\text{onTime}}$):** Percentage of invoices paid on or before due date ($0 - 100$).
  2. **Completion Rate ($S_{\text{completion}}$):**
     $$S_{\text{completion}} = \min\left(100, \frac{\text{Total Paid}}{\text{Total Invoiced}} \times 100\right)$$
  3. **Timeliness Score ($S_{\text{timeliness}}$):** Penalizes average days late:
     $$S_{\text{timeliness}} = \max(0, 100 - (\bar{d}_{\text{late}} \times 5))$$
  4. **Debt & Overdue Risk ($S_{\text{debtRisk}}$):**
     $$S_{\text{debtRisk}} = \max(0, 100 - \text{Penalties})$$
     - Minus $50$ points if credit limit is breached.
     - Minus $30$ points if overdue balance exceeds $₹10,000$.
- **Verification:** VERIFIED IMPLEMENTED.

---

### 2.9 Idempotent Asynchronous Processing & Distributed Locking
- **Category:** Distributed Systems & Concurrency Control.
- **Implementation Files:** `apps/api/src/services/intake/ConversationOrchestrator.ts` (Line 15), `apps/api/src/services/workflow/engine.ts` (Line 42), `prisma/schema.prisma`.
- **Mechanisms:**
  1. **Redis Atomic Key Claim:**
     ```typescript
     const isNew = await redis.setnx(`processed_email:${messageId}`, "1");
     if (!isNew) return; // Duplicate detected, abort
     await redis.expire(`processed_email:${messageId}`, 7 * 24 * 60 * 60);
     ```
  2. **Compound Unique Database Constraints:**
     - `@@unique([businessId, workflowId, idempotencyKey])` in `WorkflowExecution`
     - `@@unique([businessId, orderNumber])` in `Order`
     - `@@unique([businessId, invoiceNumber])` in `Invoice`
     - `@@unique([businessId, quotationNumber])` in `Quotation`
     - `@@unique([businessId, sourceType, sourceId])` in `JournalEntry`
- **Verification:** VERIFIED IMPLEMENTED.

---

### 2.10 Exponential Backoff with Jitter
- **Category:** Transient Fault Handling & Network Resilience.
- **Implementation File:** `apps/api/src/services/ai/manager.ts` (Lines 69–75).
- **Method:** `AIProviderManager.executeWithRetryAndFallback()`.
- **Mathematical Model:**
  For retry attempt $i \in \{1, 2, \dots, \text{maxRetries}\}$:
  $$\text{Delay}(i) = \text{BaseDelay}(i) + \mathcal{U}(0, 200) \text{ ms}$$
  Where $\text{BaseDelay}(1) = 500\text{ms}$, $\text{BaseDelay}(2) = 1000\text{ms}$, $\text{BaseDelay}(3) = 2000\text{ms}$, and $\mathcal{U}(0, 200)$ is a uniform random jitter preventing thundering-herd API collisions.
- **Verification:** VERIFIED IMPLEMENTED.

---

### 2.11 Authenticated Symmetric Encryption (AES-256-GCM)
- **Category:** Cryptography & Secret Protection.
- **Implementation File:** `apps/api/src/services/encryption.ts` (Lines 7–59).
- **Methods:** `encrypt()`, `decrypt()`.
- **Specification:**
  - Algorithm: `aes-256-gcm` (Galois/Counter Mode).
  - Key: 256 bits (32 bytes) decoded from `CONNECTOR_ENCRYPTION_KEY`.
  - Initialization Vector (IV): 96 bits (12 random bytes) generated uniquely per encryption.
  - Authentication Tag: 128 bits (16 bytes) providing authenticated message integrity.
  - Serialization: Base64-delimited tuple: `iv:authTag:ciphertext`.
- **Verification:** VERIFIED IMPLEMENTED. Validated in `oauth-security.test.ts`.

---

### 2.12 Dual-Strategy Cross-Platform Document Conversion
- **Category:** Graceful Degradation & System Fallback.
- **Implementation File:** `apps/api/src/services/documents/docxToPdf.ts`.
- **Methods:** `convertDocxToPdf()`, `convertWithPureNodeFallback()`.
- **Mechanism:**
  1. *Primary Strategy:* High-fidelity platform engine:
     - On Windows (`win32`): Generates dynamic PowerShell script automating Word COM (`New-Object -ComObject Word.Application`).
     - On Linux/Mac: Invokes headless LibreOffice (`soffice --headless --convert-to pdf`).
  2. *Secondary Fallback Strategy:* Pure Node.js in-process pipeline:
     - Uses `mammoth` to extract raw AST text and table paragraphs.
     - Uses `pdfkit` to stream formatted A4 PDF directly to disk.
- **Verification:** VERIFIED IMPLEMENTED.
