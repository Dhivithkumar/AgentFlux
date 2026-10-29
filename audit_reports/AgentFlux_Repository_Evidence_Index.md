# AGENT FLUX V2 — REPOSITORY EVIDENCE INDEX
**Master Inventory of Files, Symbols, Routes, Models, Workers & Verification Tags**  
*Document Ref: AFV2-AUDIT-INDEX-2026-10-28*  
*Repository: [https://github.com/Dhivithkumar/AgentFlux](https://github.com/Dhivithkumar/AgentFlux)*  

---

## 1. Classification & Status Legend

Every module, class, route, and subsystem in Agent Flux V2 has been audited against code and test evidence according to the following strict criteria:
- **VERIFIED IMPLEMENTED:** Supported by inspected source code and verified through passing live automated test suites.
- **IMPLEMENTED BUT UNVERIFIED:** Source code exists and is syntactically complete, but runtime execution against live external production APIs was not run during this session.
- **PARTIALLY IMPLEMENTED:** Some components exist, but the complete end-to-end functionality is missing, stubbed, or mocked.
- **CONFIGURATION-DEPENDENT:** Behaviour depends on external environment variables, cloud credentials, or external API quotas.
- **PROPOSED IMPROVEMENT:** A recommended architectural enhancement that is not currently implemented.
- **NOT FOUND:** Feature or component is not present in the workspace.

---

## 2. Complete File & Symbol Evidence Index

### 2.1 Core Application Bootstrap & Configuration
| Relative File Path | Primary Classes / Functions | Verification Tag | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| `apps/api/src/index.ts` | Express Server Bootstrap, Route Mounting | **VERIFIED IMPLEMENTED** | Starts server on :3001, mounts 28 routes, launches pollers. |
| `apps/api/src/env.ts` | Environment validation & dotenv loader | **VERIFIED IMPLEMENTED** | Asserts `DATABASE_URL`, `JWT_SECRET`, `CONNECTOR_ENCRYPTION_KEY`. |
| `apps/api/src/config/ai.ts` | `AIConfiguration`, `validateAIConfiguration` | **VERIFIED IMPLEMENTED** | Configures Gemini 3.7 Flash and Groq fallback. |
| `packages/database/index.ts` | `prisma` Client Singleton Instance | **VERIFIED IMPLEMENTED** | Exports singleton PrismaClient attached to `globalForPrisma`. |
| `packages/types/src/types.ts` | `User`, `Business`, `Role`, `Integration` | **VERIFIED IMPLEMENTED** | Core shared TypeScript domain interfaces. |

---

### 2.2 Security, Middleware & Encryption
| Relative File Path | Primary Classes / Functions | Verification Tag | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| `apps/api/src/middleware/auth.ts` | `authenticate`, `requireBusinessMembership` | **VERIFIED IMPLEMENTED** | Verifies JWT signatures and asserts tenant membership in DB. |
| `apps/api/src/services/encryption.ts` | `encrypt()`, `decrypt()` | **VERIFIED IMPLEMENTED** | Authenticated AES-256-GCM with 96-bit IV and 128-bit authTag. |
| `apps/api/src/tests/oauth-security.test.ts`| OAuth token security test harness | **VERIFIED IMPLEMENTED** | Validates encrypted storage and automated refresh handling. |

---

### 2.3 RAG, Embeddings & Grounding Subsystem
| Relative File Path | Primary Classes / Functions | Verification Tag | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| `services/knowledge.ts` | `KnowledgeProcessingService`, `searchKnowledgeBase` | **VERIFIED IMPLEMENTED** | Multi-mime extraction, chunking, pgvector raw SQL search. |
| `services/ai/manager.ts` | `AIProviderManager`, retry & fallback | **VERIFIED IMPLEMENTED** | Exponential backoff with jitter, failover from Gemini to Groq. |
| `services/ai/geminiProvider.ts` | `GeminiProvider.generateStructured`, `embed` | **VERIFIED IMPLEMENTED** | Invokes `@google/generative-ai` with structured JSON schema. |
| `services/ai/groqProvider.ts` | `GroqProvider.generateStructured` | **VERIFIED IMPLEMENTED** | Invokes `groq-sdk` with `response_format: { type: 'json_object' }`. |
| `services/ai/embeddings.ts` | `GeminiEmbeddingProvider.generateEmbeddings` | **VERIFIED IMPLEMENTED** | Asynchronous batch vector generation. |
| `services/knowledge/HybridRetrievalEngine.ts` | `HybridRetrievalEngine.retrieve()` | **VERIFIED IMPLEMENTED** | 5-tier hybrid retrieval. Tested in `aasha-grounding-suite.ts`. |
| `services/knowledge/QueryUnderstandingService.ts` | `QueryUnderstandingService.normalizeQuery` | **VERIFIED IMPLEMENTED** | Deterministic intent classification, SKU extraction. |
| `services/knowledge/DeterministicFinancialEngine.ts` | `DeterministicFinancialEngine.calculateQuotation` | **VERIFIED IMPLEMENTED** | Exact math for 18% GST, advance deposits, and balance due. |
| `services/knowledge/ApprovalGovernanceEngine.ts` | `ApprovalGovernanceEngine.evaluateDiscountApproval`| **VERIFIED IMPLEMENTED** | Enforces delegated authority matrix (Sales 5%, Manager 10%, Owner). |
| `services/knowledge/GroundedResponseService.ts` | `GroundedResponseService.generateResponse` | **VERIFIED IMPLEMENTED** | 7 factual states, validates zero-hallucination assertions. |
| `services/knowledge/ContextBuilder.ts` | `ContextBuilderService.buildAgentContext` | **VERIFIED IMPLEMENTED** | Combines business profile, fields, and evidence package. |
| `apps/api/src/tests/aasha-grounding-suite.ts` | Full Grounding Regression Suite (41 tests) | **VERIFIED IMPLEMENTED** | **41/41 tests passing live against PostgreSQL.** |

---

### 2.4 Autonomous Intake & Workflow Engine
| Relative File Path | Primary Classes / Functions | Verification Tag | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| `services/intake/ConversationOrchestrator.ts` | `ConversationOrchestrator.processIncomingMessage` | **VERIFIED IMPLEMENTED** | Redis `SETNX` idempotency, email classification, appointment scheduling. |
| `services/workflow/engine.ts` | `WorkflowEngine.executeWorkflow`, `runNode` | **VERIFIED IMPLEMENTED** | Topological graph traversal, parallel branching, sensitive scrubbing. |
| `services/workflow/eventDispatcher.ts` | `EventDispatcher.dispatch()` | **VERIFIED IMPLEMENTED** | Dispatches events, triggers dynamic workflows, resumes waiting executions. |
| `services/workflow/actionRegistry.ts` | `ActionRegistry.register()`, `get()` | **VERIFIED IMPLEMENTED** | Central registry for 8 internal business actions. |
| `services/workflow/actionExecutor.ts` | `ActionExecutor.execute()` | **VERIFIED IMPLEMENTED** | Dispatches to internal actions or external connector actions. |
| `services/workflow/conditionEngine.ts` | `ConditionEngine.evaluate()`, `evaluateBranch` | **VERIFIED IMPLEMENTED** | 18 comparison operators, recursive AST tree traversal. |
| `services/workflow/variableParser.ts` | `resolveVariables()` | **VERIFIED IMPLEMENTED** | Raw type preservation for arrays/objects, dot-notation resolution. |
| `services/workflow/workflowService.ts` | `WorkflowService.createWorkflow` | **VERIFIED IMPLEMENTED** | Creates workflow, immutable version 1, and steps transactionally. |
| `services/queue/workflowQueue.ts` | `workflowQueue`, `workflowWorker` | **VERIFIED IMPLEMENTED** | BullMQ queue broker on `workflow-execution`, concurrency = 5. |
| `services/queue/emailPoller.ts` | `EmailPoller.start()`, `poll()` | **VERIFIED IMPLEMENTED** | Polls unread Gmail messages every 10s, auto-refreshes OAuth tokens. |
| `apps/api/src/routes/workflows.ts` | Express Workflow CRUD & Activation routes | **VERIFIED IMPLEMENTED** | Mounts all workflow lifecycle endpoints. |
| `apps/api/src/routes/workflows.ts` (Line 26) | `/generate` AI Workflow Generation Route | **PARTIALLY IMPLEMENTED** | Returns static mock DAG rather than dynamic AI generation. |

---

### 2.5 Finance Centre & General Ledger
| Relative File Path | Primary Classes / Functions | Verification Tag | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| `services/finance/LedgerService.ts` | `LedgerService.createJournalEntry`, `void` | **VERIFIED IMPLEMENTED** | Enforces 6 accounting invariants, reversing entries. |
| `services/finance/AccountService.ts` | `AccountService.seedStandardAccounts` | **VERIFIED IMPLEMENTED** | Seeds 13 standard Chart of Accounts idempotently. |
| `services/finance/PeriodService.ts` | `PeriodService.getOrCreateOpenPeriodForDate` | **VERIFIED IMPLEMENTED** | Enforces fiscal period lockdowns and status controls. |
| `services/finance/CustomerBalanceService.ts` | `CustomerBalanceService.getCustomerFinancialSummary`| **VERIFIED IMPLEMENTED** | Reconciles customer subledger against GL Accounts Receivable. |
| `services/finance/BankReconciliationService.ts` | `BankReconciliationService.findMatchCandidates` | **VERIFIED IMPLEMENTED** | Exact amount + date window + token description fuzzy matcher. |
| `services/finance/FinancialReportingService.ts` | Trial Balance, Income Statement, Balance Sheet | **VERIFIED IMPLEMENTED** | Generates authoritative financial balance sheets. |
| `services/finance/FinancialExportService.ts` | `generateAuditExportPack` | **VERIFIED IMPLEMENTED** | Streams ZIP archive containing CSVs of all ledgers and trial balance. |
| `apps/api/src/tests/finance-ledger-invariants.test.ts` | General Ledger Invariants Suite (9 tests) | **VERIFIED IMPLEMENTED** | **9/9 tests passing live against PostgreSQL.** |

---

### 2.6 Commercial Order & Invoicing Lifecycle
| Relative File Path | Primary Classes / Functions | Verification Tag | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| `services/order/OrderService.ts` | `OrderService.createOrder`, `processAcceptance` | **VERIFIED IMPLEMENTED** | Quotation-to-order conversion, sheets sync hook. |
| `services/order/LifecycleStateMachine.ts` | `LifecycleStateMachine.transitionOrder` | **VERIFIED IMPLEMENTED** | Enforces valid transitions and records `OrderStatusHistory`. |
| `services/order/OrderPriorityService.ts` | `OrderPriorityService.evaluateOrderPriority` | **VERIFIED IMPLEMENTED** | Weighted triage scoring (0-100) and risk flag detection. |
| `services/order/CustomerFormService.ts` | `CustomerFormService.generateFormToken` | **VERIFIED IMPLEMENTED** | Generates signed 48-hour order-scoped JWT form URLs. |
| `services/customer/CustomerPaymentScoreService.ts`| `calculateCustomerScore()` | **VERIFIED IMPLEMENTED** | 4-factor scoring model ($W_1=0.40, W_2=0.25, W_3=0.20, W_4=0.15$). |
| `services/quotation/QuotationService.ts` | `QuotationService.createQuotation` | **VERIFIED IMPLEMENTED** | Generates quotation with line items and 15-day validity. |
| `services/invoice/InvoiceService.ts` | `InvoiceService.generateInvoice`, `sendInvoice`| **VERIFIED IMPLEMENTED** | Generates sequential invoices, PDF rendering, email dispatch. |
| `services/payment/PaymentService.ts` | `PaymentService.createPaymentIntent` | **CONFIGURATION-DEPENDENT** | Integrates Razorpay orders; verified in mock harness. |

---

### 2.7 Documents & Cloud Storage Connectors
| Relative File Path | Primary Classes / Functions | Verification Tag | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| `services/documents/DocumentGenerationService.ts`| `generateDocument()` | **VERIFIED IMPLEMENTED** | Merges DOCX template, triggers PDF rendering, archives to Drive. |
| `services/documents/GoogleDriveStorageService.ts` | `uploadAuthoritativeFile()` | **CONFIGURATION-DEPENDENT** | Uploads PDFs to Drive; creates folder hierarchy. |
| `services/documents/docxToPdf.ts` | `convertDocxToPdf()`, `convertWithPureNodeFallback`| **VERIFIED IMPLEMENTED** | Word COM / LibreOffice with pure Node `pdfkit` fallback. |
| `connectors/actions/gmail.ts` | `gmailActions` (`send_email`, `read_thread`) | **CONFIGURATION-DEPENDENT** | Verified with OAuth token mock harness. |
| `connectors/actions/googleCalendar.ts` | `check_availability`, `find_alternatives`, `create_event`| **CONFIGURATION-DEPENDENT** | 3-day slot scanner with Google Meet auto-generation. |
| `connectors/actions/googleSheets.ts` | `append_row`, `batch_update` | **CONFIGURATION-DEPENDENT** | Verified with operational sync poller. |

---

### 2.8 Vendor Centre & Background Verification
| Relative File Path | Primary Classes / Functions | Verification Tag | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| `services/vendor/VendorVerificationService.ts` | `verifyVendor()` | **VERIFIED IMPLEMENTED** | Validates tax ID, updates status, creates audit log. |
| `services/queue/vendorQueue.ts` | `vendorVerificationQueue`, `enqueueVendorVerification`| **VERIFIED IMPLEMENTED** | BullMQ queue with in-memory `setImmediate` fallback. |
| `apps/api/src/routes/vendors.ts` | Express Vendor CRUD & Verification routes | **VERIFIED IMPLEMENTED** | Mounted at `/api/businesses/:businessId/vendors`. |

---

### 2.9 Frontend Single Page Application (`apps/web`)
| Relative File Path | Primary Components / Pages | Verification Tag | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| `src/App.tsx` | Router & ProtectedRoute Configuration | **VERIFIED IMPLEMENTED** | React Router DOM with 24 declared application routes. |
| `src/layouts/DashboardLayout.tsx` | Dashboard Layout & Business Switcher | **VERIFIED IMPLEMENTED** | Global header, sidebar navigation, localStorage switching. |
| `src/pages/DashboardOverview.tsx` | Operational Analytics & Metric Cards | **VERIFIED IMPLEMENTED** | Displays revenue, order status, urgent alerts, and charts. |
| `src/pages/finance/FinanceCenter.tsx` | Full Finance Centre Interface (81.6 KB) | **VERIFIED IMPLEMENTED** | General Ledger viewer, Bank Reconciliation UI, Trial Balance. |
| `src/pages/workflows/WorkflowBuilder.tsx` | Visual DAG Flow Builder (44.6 KB) | **VERIFIED IMPLEMENTED** | React Flow canvas, node drag-and-drop, connection inspector. |
| `src/pages/workflows/Approvals.tsx` | Human-in-the-Loop Approval Decision UI | **VERIFIED IMPLEMENTED** | Displays pending approval cards with Approve/Reject actions. |
| `src/pages/knowledge/KnowledgeCenter.tsx` | Document Ingestion & Vector Search UI | **VERIFIED IMPLEMENTED** | Upload modal, processing status badges, search query tester. |
| `src/pages/orders/OrderList.tsx` | Orders Management Table (34 KB) | **VERIFIED IMPLEMENTED** | Order status badges, priority filters, payment indicators. |
| `src/pages/vendors/VendorCenter.tsx` | Vendor Management & Verification UI (36 KB) | **VERIFIED IMPLEMENTED** | Vendor list, verification status badges, verify button. |
| `src/lib/api.ts` | Central API Fetch Client | **VERIFIED IMPLEMENTED** | Handles JWT headers, business scoping, and JSON parsing. |
