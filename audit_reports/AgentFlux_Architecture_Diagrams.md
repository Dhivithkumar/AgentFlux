# AGENT FLUX V2 — SYSTEM ARCHITECTURE & DIAGRAMS
**Complete Architectural Specification, Component Interactions & Mermaid Models**  
*Document Ref: AFV2-AUDIT-ARCH-2026-10-28*  
*Repository: [https://github.com/Dhivithkumar/AgentFlux](https://github.com/Dhivithkumar/AgentFlux)*  

---

## CHAPTER Overview

This document presents 12 architectural and procedural Mermaid diagrams documenting the Agent Flux V2 platform. Each diagram directly reflects the inspected codebase, distinguishing verified synchronous HTTP/RPC calls from asynchronous BullMQ queue jobs and background poller routines.

---

## 1. High-Level System Architecture

### Architectural Description
The architecture separates client presentation (React 18 SPA), gateway routing and middleware (Express, JWT verification, tenant isolation), core business services (intake, knowledge, workflow, quotation, order, finance, vendor verification), asynchronous queues (BullMQ, Redis, event dispatchers), and persisted databases (PostgreSQL with pgvector, Prisma ORM, encrypted credential vault, and Google Workspace cloud services).

### Mermaid Diagram
```mermaid
graph TB
    subgraph Client Layer
        Web["React 18 Single Page App<br/>(Vite, Tailwind, React Flow)<br/>:3000"]
        ExtClient["External Customer Email / Webhook"]
    end

    subgraph API Gateway & Security Layer
        ExpressApp["Express API Server (:3001)<br/>(apps/api/src/index.ts)"]
        AuthMid["authenticate<br/>(JWT Token Extraction)"]
        TenantMid["requireBusinessMembership<br/>(Prisma Membership Check)"]
        AESVault["AES-256-GCM Vault<br/>(services/encryption.ts)"]
    end

    subgraph Autonomous Intake & Grounding
        Poller["EmailPoller / OperationalPoller<br/>(services/queue/emailPoller.ts)"]
        Orchestrator["ConversationOrchestrator<br/>(services/intake/ConversationOrchestrator.ts)"]
        QueryNorm["QueryUnderstandingService<br/>(Intent & Entity Normalizer)"]
        HybridRAG["HybridRetrievalEngine<br/>(Exact + Customization + Vector)"]
        GroundedResp["GroundedResponseService<br/>(Zero-Hallucination Enforcer)"]
        FinEngine["DeterministicFinancialEngine<br/>(Pricing, GST, Payment Terms)"]
    end

    subgraph Workflow & Background Processing
        WFEngine["WorkflowEngine<br/>(services/workflow/engine.ts)"]
        ActionReg["ActionRegistry & ActionExecutor<br/>(services/workflow/actionRegistry.ts)"]
        CondEngine["ConditionEngine<br/>(services/workflow/conditionEngine.ts)"]
        RedisServer["Redis Queue Broker (:6379)<br/>(services/queue/connection.ts)"]
        BullQueues["BullMQ Queues<br/>(workflow, knowledge, vendor, analytics)"]
        Workers["BullMQ Background Workers"]
    end

    subgraph Data & Persistence Layer
        PrismaORM["Prisma ORM Client 5.22.0<br/>(packages/database/index.ts)"]
        PostgresDB[("PostgreSQL 15+ & pgvector<br/>(Relational Tables + vector embeddings)")]
        LocalFS["Local File Storage<br/>(uploads/ / temp/)"]
    end

    subgraph External Provider Services
        GeminiAPI["Google Gemini 3.7 Flash<br/>(@google/generative-ai)"]
        GroqAPI["Groq Llama-3 Fallback<br/>(groq-sdk)"]
        GoogleDrive["Google Drive API<br/>(Authoritative Archiving)"]
        GoogleSheets["Google Sheets API<br/>(Operational Spreadsheet Sync)"]
        GoogleCal["Google Calendar API<br/>(Meeting Availability & Meet)"]
        GmailAPI["Gmail API<br/>(Inbound Read & Outbound Send)"]
    end

    Web -->|HTTP REST / JSON| ExpressApp
    ExtClient -->|Inbound Email| GmailAPI
    ExpressApp --> AuthMid --> TenantMid
    TenantMid --> Orchestrator
    TenantMid --> WFEngine
    Poller -->|Poll Unread (10s)| GmailAPI
    Poller --> Orchestrator
    Orchestrator --> QueryNorm --> HybridRAG
    HybridRAG --> FinEngine
    HybridRAG --> GroundedResp
    HybridRAG --> GeminiAPI
    HybridRAG --> PrismaORM
    GroundedResp --> GeminiAPI
    WFEngine --> ActionReg
    WFEngine --> CondEngine
    WFEngine --> BullQueues
    BullQueues --> RedisServer
    RedisServer --> Workers --> WFEngine
    ActionReg --> GmailAPI
    ActionReg --> GoogleSheets
    ActionReg --> GoogleDrive
    ActionReg --> GoogleCal
    PrismaORM --> PostgresDB
    AESVault -.->|Decrypt Tokens| ActionReg
    AESVault -.->|Decrypt Tokens| Poller
```

---

## 2. Frontend-to-Backend Architecture

### Architectural Description
The frontend is structured as a modular React 18 single-page application built with Vite. It features a persistent dashboard layout (`DashboardLayout.tsx`) managing business switching via localStorage and global state, wrapping specialized business centres (Dashboard Overview, Enquiry Inbox, Orders, Finance Centre, Vendor Centre, Workflow Centre, Knowledge Base, and Settings). All API requests route through `lib/api.ts`, which injects the `Bearer` token and `x-business-id` header.

```mermaid
sequenceDiagram
    autonumber
    actor User as Business Operator
    participant UI as React SPA (DashboardLayout)
    participant Client as API Client (lib/api.ts)
    participant Server as Express Server (index.ts)
    participant Auth as Auth Middleware (auth.ts)
    participant Route as Business Route (e.g. finance.ts)
    participant Service as Business Service (e.g. LedgerService)
    participant DB as PostgreSQL (Prisma)

    User->>UI: Selects "Finance Centre" or Switches Business
    UI->>UI: Updates activeBusinessId in localStorage & React state
    UI->>Client: apiCall('/businesses/:id/finance/summary')
    Client->>Client: Injects Authorization: Bearer <token>
    Client->>Server: GET /api/businesses/:id/finance/summary
    Server->>Auth: authenticate(req, res, next)
    Auth->>Auth: Verify JWT signature & load User
    Server->>Auth: requireBusinessMembership(req, res, next)
    Auth->>DB: prisma.membership.findUnique(userId, businessId)
    DB-->>Auth: Membership record verified (Role: OWNER/MEMBER)
    Auth-->>Server: next()
    Server->>Route: Handled by financeRouter
    Route->>Service: ledgerService.getFinancialSummary(businessId)
    Service->>DB: Aggregates AccountBalances, JournalLines, Invoices
    DB-->>Service: Structured SQL Records
    Service-->>Route: Formatted Financial Model
    Route-->>Server: HTTP 200 { success: true, data: {...} }
    Server-->>Client: JSON Response
    Client-->>UI: Updates React State & Re-renders View
```

---

## 3. Database Entity-Relationship Architecture (Prisma Schema)

### Architectural Description
The data layer utilizes PostgreSQL with the `pgvector` extension. Multi-tenancy is enforced via a top-level `Business` model referencing `User` via `Membership`. The schema is partitioned into:
1. Multi-tenant Identity & OAuth Credentials (`User`, `Business`, `Membership`, `Integration`, `IntegrationCredential`, `OAuthState`, `AuditLog`)
2. Workflow Execution DAG (`Workflow`, `WorkflowVersion`, `WorkflowStep`, `WorkflowExecution`, `WorkflowStepExecution`, `WorkflowApproval`, `WorkflowConnectorBinding`)
3. Knowledge & RAG (`KnowledgeBase`, `KnowledgeSource`, `KnowledgeDocument`, `KnowledgeChunk` with vector embeddings)
4. Commercial Intake & Order Lifecycle (`Customer`, `Enquiry`, `Order`, `OrderStatusHistory`, `Quotation`, `Invoice`, `DocumentTemplate`, `Payment`)
5. Operational Sync (`OperationalSheetConfig`, `OperationalSyncJob`)
6. Double-Entry General Ledger (`Account`, `JournalEntry`, `JournalLine`, `AccountingPeriod`, `AccountBalance`, `BankFeedAccount`, `BankTransaction`, `BankTransactionMatch`, `FinanceAuditLog`)
7. Vendor Verification (`Vendor`, `VendorVerificationLog`)

```mermaid
erDiagram
    User ||--o{ Membership : "belongs to"
    Business ||--o{ Membership : "has members"
    Business ||--o{ Integration : "owns"
    Integration ||--o| IntegrationCredential : "has encrypted"
    Business ||--o{ Workflow : "owns"
    Workflow ||--o{ WorkflowVersion : "has versions"
    WorkflowVersion ||--o{ WorkflowStep : "contains steps"
    Workflow ||--o{ WorkflowExecution : "executes"
    WorkflowVersion ||--o{ WorkflowExecution : "pins"
    WorkflowExecution ||--o{ WorkflowStepExecution : "records"
    WorkflowExecution ||--o{ WorkflowApproval : "requests"
    
    Business ||--o{ KnowledgeBase : "owns"
    KnowledgeBase ||--o{ KnowledgeDocument : "contains"
    KnowledgeDocument ||--o{ KnowledgeChunk : "split into"
    
    Business ||--o{ Customer : "serves"
    Customer ||--o{ Enquiry : "submits"
    Customer ||--o{ Order : "places"
    Customer ||--o{ Quotation : "receives"
    Customer ||--o{ Invoice : "billed by"
    Order ||--o{ OrderStatusHistory : "tracked by"
    Order ||--o{ Quotation : "derived from"
    Order ||--o{ Invoice : "generates"
    Invoice ||--o{ Payment : "settled by"
    
    Business ||--o{ Account : "Chart of Accounts"
    Account ||--o{ Account : "Parent-Child Hierarchy"
    Business ||--o{ JournalEntry : "General Ledger"
    JournalEntry ||--o{ JournalLine : "Debits & Credits"
    Account ||--o{ JournalLine : "debited/credited"
    Business ||--o{ AccountingPeriod : "Fiscal Periods"
    AccountingPeriod ||--o{ JournalEntry : "enforces lockdown"
    Account ||--o{ AccountBalance : "period balances"
    BankFeedAccount ||--o{ BankTransaction : "imports"
    BankTransaction ||--o| BankTransactionMatch : "matched to"
    JournalLine ||--o| BankTransactionMatch : "reconciles"

    Business ||--o{ Vendor : "procures from"
    Vendor ||--o{ VendorVerificationLog : "audits verification"
    Vendor ||--o{ Order : "assigned to"
```

---

## 4. RAG Document Ingestion Pipeline

### Architectural Description
Document ingestion (`apps/api/src/services/knowledge.ts`) processes PDF, plain text, CSV, and DOCX files.
1. The file is uploaded and marked `UPLOADED`.
2. Text extraction utilizes `pdf-parse` for PDFs, `mammoth` for DOCX, or buffer decoding for CSV/text (`status: EXTRACTING`).
3. Document-Aware Chunking splits text along section, paragraph, and table row boundaries (`status: CHUNKING`).
4. `GeminiEmbeddingProvider` invokes Google Gemini `gemini-embedding-001` or `text-embedding-004` to generate vectors (`status: EMBEDDING`).
5. Vectors are inserted into PostgreSQL `KnowledgeChunk` using raw SQL with the `::vector` type cast.
6. The document is updated to `INDEXED` with `processedAt` timestamp.

```mermaid
flowchart TD
    A[Client Uploads Document<br/>POST /api/knowledge/documents] --> B[Storage Service Saves File<br/>storageService.uploadDocument]
    B --> C[Create KnowledgeDocument Record<br/>status: UPLOADED]
    C --> D{Asynchronous Processing?<br/>Redis Available?}
    D -- Yes --> E[Enqueue BullMQ Job<br/>knowledgeQueue.add 'process']
    D -- No --> F[Direct Call<br/>knowledgeService.processDocument]
    E --> G[Worker Picks Job]
    G --> H[Update Status: EXTRACTING]
    F --> H
    H --> I{Inspect MIME Type}
    I -- application/pdf --> J[PDFParse Extraction]
    I -- docx --> K[Mammoth Raw Text Extraction]
    I -- text/csv/plain --> L[UTF-8 Buffer String Conversion]
    J --> M[Clean & Normalize Text Whitespace]
    K --> M
    L --> M
    M --> N[Update Status: CHUNKING]
    N --> O[createDocumentAwareChunks<br/>- Preserves Table Structure<br/>- Injects SKU & Entity Metadata]
    O --> P[Update Status: EMBEDDING]
    P --> Q[embeddingProvider.generateEmbeddings<br/>Calls Gemini embedContent API]
    Q --> R[Store Chunks & Embeddings in PostgreSQL<br/>INSERT INTO KnowledgeChunk ... embedding::vector]
    R --> S[Update Status: INDEXED<br/>processedAt = NOW]
```

---

## 5. RAG Retrieval & Grounding Pipeline

### Architectural Description
Retrieval (`HybridRetrievalEngine.ts` and `GroundedResponseService.ts`) runs a 5-tier multi-strategy pipeline:
1. **Query Normalization:** `QueryUnderstandingService` parses product names, SKUs, customizations, discounts, or credit requests.
2. **Tenant Scoping:** Confirms query belongs strictly to the authenticated tenant.
3. **Structured Entity Matching:** Matches against authoritative catalog definitions with 1.0 confidence score.
4. **Deterministic Calculation:** Calculates pricing, 18% GST, 50% advance, and balance due.
5. **Governance Evaluation:** Evaluates discount policies (0-5% Sales, 5-10% Manager, >10% Owner).
6. **Vector Search:** Queries pgvector using `1 - (c."embedding" <=> $1::vector)` as fallback or supplementary evidence.
7. **Grounding Validation:** Enforces zero-hallucination assertions before returning response.

```mermaid
flowchart TD
    Q[Customer Query / Inbound Email] --> N[QueryUnderstandingService.normalizeQuery]
    N --> T1[Tenant Isolation Check<br/>businessId === AASHA_BUSINESS_ID]
    T1 -- No --> T1_Reject[Return Empty / Scoped Response<br/>rejectionReason: Cross-business isolation]
    T1 -- Yes --> L1[Level 1: Exact Entity Match<br/>Matches SKU / Name in Authoritative Catalog]
    L1 --> L2[Level 2: Customization Cross-Document Match<br/>03_Product_Customization_Guide.pdf]
    L2 --> L3[Level 3: Deterministic Financial Engine<br/>Base Price + Customizations + 18% GST]
    L3 --> L4[Level 4: Approval Governance Matrix<br/>Evaluates Discount %, Credit Request, Custom Size]
    L4 --> L5[Level 5: pgvector Semantic Search<br/>1 - embedding <=> query_vector]
    L5 --> EvPkg[Assemble RetrievalEvidencePackage<br/>state: EXACT_MATCH / HIGH_CONFIDENCE / NOT_FOUND / AMBIGUOUS]
    EvPkg --> GV{GroundedResponseService<br/>Zero-Hallucination Validation}
    GV -- Unsupported Claims Found? --> Reg1[Flag UNSUPPORTED_CLAIM or CONTRADICTION]
    GV -- State == NOT_FOUND --> Abstain[Safe Abstention<br/>State information unavailable]
    GV -- State == AMBIGUOUS --> Clarify[Ask Customer for Clarification]
    GV -- Validated Passed --> Resp[Deterministic Customer Email Response<br/>Formatted HTML with Verified Facts]
```

---

## 6. Workflow DAG Execution Architecture

### Architectural Description
The workflow execution engine (`apps/api/src/services/workflow/engine.ts`) executes Directed Acyclic Graphs (DAGs) pinned immutably to a `WorkflowVersion`. 
- **Graph Traversal:** Calculates incoming edge counts (`incomingEdges`). Nodes with 0 incoming dependencies execute as root nodes.
- **Node Execution:** Dispatches based on step type (`TRIGGER`, `ACTION`, `TOOL_ACTION`, `CONDITION`, `APPROVAL`, `DELAY`, `WAIT_FOR_EVENT`, `AI_AGENT`, `RAG_SEARCH`).
- **Parallel Branching:** Concurrent branches execute via `Promise.all()`.
- **Suspension:** Waiting steps (`APPROVAL`, `DELAY`, `WAIT_FOR_EVENT`) set `_suspend: true` and persist context.

```mermaid
flowchart TD
    Start([Workflow Triggered]) --> Init[Create WorkflowExecution<br/>status: QUEUED<br/>pinned to workflowVersionId]
    Init --> Queue[Enqueue BullMQ Job<br/>workflowQueue.add 'executeWorkflow']
    Queue --> Worker[Worker Picks Up Job]
    Worker --> Running[Set Execution status: RUNNING]
    Running --> BuildDAG[Calculate incomingEdges per step]
    BuildDAG --> Roots[Identify Root Steps<br/>incomingEdges == 0]
    Roots --> ExecNode[executeNode<br/>Variable Resolution with resolveVariables]
    
    ExecNode --> StepType{Step Type}
    StepType -- ACTION --> ExecAction[ActionRegistry.get / ActionExecutor.execute]
    StepType -- CONDITION --> CondEval[ConditionEngine.evaluateBranch<br/>Returns Route 'YES' / 'NO' / branch name]
    StepType -- APPROVAL --> SuspendApp[Create ApprovalRequest<br/>status: WAITING_APPROVAL, _suspend: true]
    StepType -- DELAY --> SuspendDelay[Add delayed BullMQ Job<br/>status: WAITING, _suspend: true]
    StepType -- WAIT_FOR_EVENT --> SuspendEvent[Record waitingForEvent<br/>status: WAITING, _suspend: true]
    StepType -- AI_AGENT --> AICall[aiManager.generateStructured]
    StepType -- RAG_SEARCH --> RAGCall[knowledgeService.searchKnowledgeBase]
    
    ExecAction --> StepDone[Record WorkflowStepExecution SUCCESS]
    CondEval --> StepDone
    AICall --> StepDone
    RAGCall --> StepDone
    
    SuspendApp --> HaltBranch([Halt Execution Branch])
    SuspendDelay --> HaltBranch
    SuspendEvent --> HaltBranch
    
    StepDone --> NextNodes{Next Steps in DAG?}
    NextNodes -- Branching Array --> Parallel[Promise.all<br/>Concurrent Branch Traversal]
    Parallel --> ExecNode
    NextNodes -- None --> CompleteCheck{All Branches Finished?}
    CompleteCheck -- Yes --> Complete[Set Execution status: SUCCESS<br/>completedAt = NOW]
```

---

## 7. Event-to-Worker Asynchronous Processing Sequence

### Architectural Description
Demonstrates how an asynchronous operational event (e.g., `ORDER_CONFIRMED`) propagates across the event dispatcher, dynamic tenant workflows, BullMQ queues, background workers, and downstream system hooks.

```mermaid
sequenceDiagram
    autonumber
    participant App as Application Service (OrderService)
    participant Bus as EventDispatcher (eventDispatcher.ts)
    participant DB as PostgreSQL (Prisma)
    participant Redis as Redis Server (:6379)
    participant Queue as BullMQ (workflowQueue)
    participant Worker as BullMQ Worker (workflowWorker)
    participant Engine as WorkflowEngine (engine.ts)
    participant Hook as OperationalSyncService

    App->>Bus: EventDispatcher.dispatch(businessId, 'ORDER_CONFIRMED', { orderId })
    Bus->>DB: Query active Workflows matching eventType and filters
    DB-->>Bus: Returns matched Workflow(s)
    
    opt Dynamic Workflow Exists
        Bus->>Engine: triggerWorkflow(businessId, wf.id, 'EVENT', payload)
        Engine->>DB: Create WorkflowExecution (status: QUEUED)
        Engine->>Queue: workflowQueue.add('executeWorkflow', { executionId })
        Queue->>Redis: Persist job metadata in Redis sorted set
    end

    opt Resuming Waiting Workflows
        Bus->>DB: Query WorkflowExecution (status: WAITING, waitingForEvent matches)
        DB-->>Bus: Returns Correlated Execution
        Bus->>DB: Update status = QUEUED, context.eventReceived = payload
        Bus->>Queue: workflowQueue.add('executeWorkflow', { executionId: resumedId })
    end

    opt System Fallback Sync
        Bus->>Hook: operationalSyncService.enqueueSync(businessId, 'ORDER', orderId, 'ORDER_CONFIRMED')
        Hook->>DB: Upsert OperationalSyncJob (status: PENDING)
    end

    Redis-->>Worker: Dequeue available job
    Worker->>Engine: WorkflowEngine.executeWorkflow(executionId)
    Engine->>DB: Update status: RUNNING
    Engine->>Engine: Traverse DAG and execute actions
    Engine->>DB: Update status: SUCCESS
    Worker-->>Redis: Mark Job COMPLETED
```

---

## 8. Human-in-the-Loop Approval & Resumption Architecture

### Architectural Description
When a workflow step requires human approval (e.g., a 12% discount or credit request), the step execution halts, saves execution state, and creates an `ApprovalRequest` record. The business owner reviews the approval in the UI (`/dashboard/workflows/approvals`). Upon decision, the approval service resumes the execution via BullMQ.

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Inbound Customer
    actor Owner as Business Owner
    participant Engine as WorkflowEngine
    participant Gov as ApprovalGovernanceEngine
    participant DB as PostgreSQL (Prisma)
    participant UI as React UI (Approvals.tsx)
    participant AppRoute as Approval Route (approvals.ts)
    participant Queue as BullMQ (workflowQueue)

    Customer->>Engine: Submits 12% Discount Request
    Engine->>Gov: evaluateDiscountApproval(12)
    Gov-->>Engine: { requiresApproval: true, requiredApprover: 'Owner' }
    Engine->>DB: Create WorkflowApproval (status: PENDING)
    Engine->>DB: Update WorkflowExecution (status: WAITING_APPROVAL, context saved)
    Engine-->>Customer: Acknowledge: "Discounts above 5% require Owner approval."

    Note over Engine,UI: Workflow is safely paused. Zero side-effects triggered.

    Owner->>UI: Navigates to /dashboard/workflows/approvals
    UI->>AppRoute: GET /api/approvals?businessId=...
    AppRoute->>DB: Query pending WorkflowApproval records
    DB-->>UI: Displays pending 12% discount request
    Owner->>UI: Clicks "Approve Request" (inputs reason)
    UI->>AppRoute: POST /api/approvals/:id/decide { decision: 'APPROVED' }
    AppRoute->>DB: Update WorkflowApproval (status: APPROVED, decidedAt: NOW)
    AppRoute->>DB: Update WorkflowExecution (status: QUEUED, additionalContext: { approved: true })
    AppRoute->>Queue: workflowQueue.add('executeWorkflow', { executionId })
    Queue->>Engine: Worker resumes WorkflowEngine.executeWorkflow
    Engine->>DB: Loads saved context and resumes at next step
    Engine->>DB: Generates quotation with approved 12% discount
```

---

## 9. Order-to-Invoice Lifecycle & Financial Invariant Flow

### Architectural Description
This sequence traces the transition from customer quotation acceptance to order confirmation, customer billing address intake, PDF invoice rendering, Google Drive archiving, email dispatch, and General Ledger posting.

```mermaid
sequenceDiagram
    autonumber
    actor Cust as Customer
    participant Orch as ConversationOrchestrator
    participant OrdService as OrderService
    participant StateMachine as LifecycleStateMachine
    participant FormService as CustomerFormService
    participant InvService as InvoiceService
    participant DocService as DocumentGenerationService
    participant Drive as GoogleDriveStorageService
    participant Ledger as LedgerService
    participant DB as PostgreSQL (Prisma)

    Cust->>Orch: Email: "Quotation accepted, please proceed."
    Orch->>OrdService: processQuotationAcceptance(businessId, customerId, message)
    OrdService->>StateMachine: validateQuotationTransition('SENT', 'ACCEPTED')
    StateMachine-->>OrdService: Allowed
    OrdService->>DB: Update Quotation status = ACCEPTED
    OrdService->>DB: Create Order (status: CONFIRMED, orderNumber: ORD-000001)
    OrdService->>DB: Create OrderStatusHistory (from: DRAFT, to: CONFIRMED)
    
    OrdService->>InvService: checkReadiness(businessId, orderId)
    InvService-->>OrdService: CUSTOMER_INFORMATION_REQUIRED (Billing address missing)
    OrdService->>FormService: generateFormToken(businessId, orderId, customerId, 48h)
    FormService-->>OrdService: Form URL with expiring JWT
    OrdService->>Cust: Sends email with secure Billing Details Form link

    Cust->>FormService: Submits verified billing address via Web Form
    FormService->>DB: Updates Customer billing address
    FormService->>DB: Updates Order status = READY_FOR_INVOICE

    InvService->>InvService: generateInvoice(businessId, orderId)
    InvService->>DB: Create Invoice (status: DRAFT, invoiceNumber: AF-INV-2026-0001)
    InvService->>DocService: generateDocument(businessId, 'INVOICE', invoiceId)
    DocService->>DocService: Render DOCX template + convert to PDF
    DocService->>Drive: Upload PDF to Google Drive (Authoritative Vault)
    Drive-->>DocService: Returns driveFileId & driveUrl
    DocService->>DB: Creates KnowledgeDocument record
    DocService-->>InvService: Document generated successfully

    InvService->>Ledger: createJournalEntry(businessId, autoPost=true)
    Note over Ledger: Validates Accounting Invariants:<br/>Debit Accounts Receivable = Credit Revenue + Credit Tax Payable
    Ledger->>DB: Inserts JournalEntry & JournalLines (status: POSTED)
    InvService->>DB: Update Invoice status = ISSUED
    InvService->>Cust: Sends finalized Tax Invoice PDF via Gmail API
    InvService->>DB: Update Invoice status = SENT
```

---

## 10. Error Handling, Retries & Worker Recovery Architecture

### Architectural Description
The error-handling architecture prevents duplicate side-effects while guaranteeing recovery from transient failures.
1. **Step-Level Retries:** Evaluates `retryPolicy` on individual steps (up to `maxAttempts` with configurable `delayMs`).
2. **Failure Policies:** Evaluates `failurePolicy` (`FAIL_FAST` stops execution; `CONTINUE_ON_FAILURE` logs error and advances via `ON_FAILURE` branch).
3. **Queue-Level Retries:** BullMQ enforces exponential backoff (e.g. 5000ms delay, 3 attempts).
4. **Permanent Failure Handling:** Marks `WorkflowExecution` as `FAILED` and records exact error message.

```mermaid
flowchart TD
    StepStart[Execute Step Node] --> Attempt[Execute Attempt #N]
    Attempt --> Result{Execution Result}
    Result -- Success --> PersistSuccess[Update StepExecution: SUCCESS<br/>Record Output in Context]
    PersistSuccess --> Advance[Advance to Next Node in DAG]
    
    Result -- Error Caught --> CheckRetry{attempt < maxAttempts?}
    CheckRetry -- Yes --> Delay[Wait backoff delay ms<br/>Exponential / Linear]
    Delay --> Attempt
    
    CheckRetry -- No (Exhausted) --> CheckPolicy{Step Failure Policy}
    CheckPolicy -- CONTINUE_ON_FAILURE --> LogWarn[Record StepExecution: FAILED<br/>Log warning in Context]
    LogWarn --> ErrorRoute{Explicit Error Route Defined?<br/>next.ON_FAILURE}
    ErrorRoute -- Yes --> TakeErrorRoute[Route to Error Handler Step]
    ErrorRoute -- No --> Advance
    
    CheckPolicy -- FAIL_FAST --> FailExec[Mark StepExecution: FAILED<br/>Throw StepError to Engine]
    FailExec --> EngineCatch[Engine Catches Error]
    EngineCatch --> UpdateDB[Update WorkflowExecution status: FAILED<br/>Set completedAt = NOW<br/>Record exact error string]
    UpdateDB --> QueueFail[Worker Throws Error to BullMQ]
    QueueFail --> BullRetry{BullMQ Attempts Remaining?}
    BullRetry -- Yes --> BullDelay[BullMQ Delayed Exponential Retry<br/>delay = 5000ms * 2^attempt]
    BullDelay --> WorkerPickup[Worker Re-attempts Execution]
    BullRetry -- No --> Permanent[Mark Job Permanently FAILED<br/>Leave in Redis for Operator Inspection]
```

---

## 11. AI Provider Request & Response Sequence

### Architectural Description
`AIProviderManager` coordinates primary generation via Gemini 3.7 Flash and fallback generation via Groq. It classifies errors as retryable (429 rate limit, 500, 502, 503, 504, timeout, network failure) versus non-retryable (400 bad request, 401 unauthorized, invalid API key, obsolete model). Retryable errors trigger exponential backoff with jitter; unrecoverable primary failures switch to the fallback provider.

```mermaid
sequenceDiagram
    autonumber
    participant Caller as Calling Service (Intake / Workflow)
    participant Mgr as AIProviderManager (services/ai/manager.ts)
    participant Gem as GeminiProvider (geminiProvider.ts)
    participant Groq as GroqProvider (groqProvider.ts)
    participant Telemetry as Console / Telemetry Logger

    Caller->>Mgr: generateStructured<T>({ prompt, schema })
    Mgr->>Gem: generateStructured(request)
    
    alt Primary Provider Succeeds
        Gem-->>Mgr: Returns Parsed Schema JSON
        Mgr->>Telemetry: AI Telemetry | provider=GEMINI | status=SUCCESS | latency=420ms | fallbackUsed=false
        Mgr-->>Caller: Returns Typed Data
    else Retryable Error (429 Rate Limit / 503 Overloaded)
        Gem-->>Mgr: Throws HTTP 429
        Mgr->>Mgr: isRetryableError() == true
        Mgr->>Telemetry: Warning: Retryable error, retrying in 1150ms (attempt 2)...
        Mgr->>Gem: Re-attempts generateStructured(request)
        Gem-->>Mgr: Returns Parsed Schema JSON
        Mgr-->>Caller: Returns Typed Data
    else Fatal Failure on Primary (e.g. Model Unavailable / Timeout Exhausted)
        Gem-->>Mgr: Throws Fatal Exception
        Mgr->>Telemetry: AI Telemetry | provider=GEMINI | status=FAILED | errorCode=RETRY_EXHAUSTED
        opt Groq Fallback Configured
            Mgr->>Telemetry: Warning: Falling back to Groq API...
            Mgr->>Groq: generateStructured(request)
            Groq-->>Mgr: Returns Valid JSON Completion
            Mgr->>Telemetry: AI Telemetry | provider=GROQ | status=SUCCESS | fallbackUsed=true
            Mgr-->>Caller: Returns Typed Data
        end
    end
```

---

## 12. Authentication & Tenant-Isolation Architecture

### Architectural Description
Multi-tenant security requires that every request identifies the authenticated user and asserts business tenancy. The middleware extracts the JWT from headers, verifies the signature, and matches the requested `businessId` against the user's `Membership` records in the database. Cross-tenant data access is rejected with HTTP 403 Forbidden.

```mermaid
flowchart TD
    Req[Incoming HTTP Request<br/>Headers: Authorization Bearer token, x-business-id] --> AuthCheck{authenticate Middleware}
    
    AuthCheck -- Missing Token --> Err401A[401 Unauthorized<br/>Missing token]
    AuthCheck -- Token Present --> VerifyJWT[jwt.verify token, JWT_SECRET]
    VerifyJWT -- Invalid Signature / Expired --> Err401B[401 Unauthorized<br/>Invalid token]
    VerifyJWT -- Valid --> FindUser[prisma.user.findUnique by userId]
    FindUser -- User Not Found --> Err401C[401 Unauthorized<br/>User does not exist]
    FindUser -- User Found --> AttachUser[req.user = user.id, email]
    
    AttachUser --> TenantCheck{requireBusinessMembership Middleware}
    TenantCheck --> ExtractBiz[Resolve businessId from:<br/>params.businessId / req.baseUrl / req.body / headers]
    ExtractBiz -- Missing businessId --> Err400[400 Bad Request<br/>businessId is required]
    ExtractBiz -- businessId Resolved --> QueryMem[prisma.membership.findUnique<br/>userId_businessId compound key]
    
    QueryMem -- Record Not Found --> Err403[403 Forbidden<br/>You do not have access to this business]
    QueryMem -- Record Found --> AttachBiz[req.businessId = businessId<br/>Attach Role: OWNER / MEMBER]
    
    AttachBiz --> RouteHandler[Execute Business Route Handler]
    RouteHandler --> ScopedQuery[Prisma Query with mandatory WHERE:<br/>prisma.entity.findMany where: businessId]
    ScopedQuery --> DB[(PostgreSQL Database)]
```
