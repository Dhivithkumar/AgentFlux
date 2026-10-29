# AGENT FLUX V2 — API & DATABASE REFERENCE
**Complete Endpoint Specifications, Prisma Data Models, Cardinalities & Query Traces**  
*Document Ref: AFV2-AUDIT-API-DB-2026-10-28*  
*Repository: [https://github.com/Dhivithkumar/AgentFlux](https://github.com/Dhivithkumar/AgentFlux)*  

---

## SECTION 1: COMPLETE REST API ROUTE INVENTORY

Every route is extracted directly from the Express route definitions in `apps/api/src/routes`.

### 1. Authentication Routes (`routes/auth.ts`)
Mounted at `/api/auth` in `index.ts`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/register` | Public | `{ name, email, password }` | `bcrypt.hash`, `prisma.user.create`, generates JWT | `201 { token, user: { id, name, email } }` | 400 (Validation / User exists), 500 | VERIFIED IMPLEMENTED |
| `POST` | `/login` | Public | `{ email, password }` | `prisma.user.findUnique`, `bcrypt.compare`, generates JWT | `200 { token, user: { id, name, email } }` | 401 (Invalid credentials), 500 | VERIFIED IMPLEMENTED |
| `GET` | `/me` | `authenticate` | None (reads `req.user.id`) | `prisma.user.findUnique` | `200 { user: { id, name, email, createdAt } }`| 401 (Unauthorized) | VERIFIED IMPLEMENTED |
| `POST` | `/logout` | Public | None | Client clears token | `200 { success: true }` | None | VERIFIED IMPLEMENTED |

---

### 2. Business & Membership Routes (`routes/businesses.ts`)
Mounted at `/api/businesses`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | `authenticate` | None | `prisma.business.findMany` where user is member | `200 { success: true, data: Business[] }` | 500 | VERIFIED IMPLEMENTED |
| `POST` | `/` | `authenticate` | `{ name, industry, website, description }` | `prisma.business.create`, `prisma.membership.create(role: OWNER)` in `$transaction` | `201 { success: true, data: Business }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/:id` | `authenticate` | Param: `id` | `prisma.business.findFirst` where user has membership | `200 { success: true, data: Business }` | 403, 404 | VERIFIED IMPLEMENTED |
| `PUT` | `/:id` | `authenticate` | Param: `id`, Body: business fields | `prisma.business.update` | `200 { success: true, data: Business }` | 403, 404 | VERIFIED IMPLEMENTED |
| `GET` | `/:id/members`| `authenticate` | Param: `id` | `prisma.membership.findMany` with `user` relation | `200 { success: true, data: Membership[] }` | 403, 500 | VERIFIED IMPLEMENTED |
| `POST` | `/:id/members`| `authenticate` | Param: `id`, Body: `{ email, role }` | Finds user by email, creates `Membership` | `201 { success: true, data: Membership }` | 400, 404, 403 | VERIFIED IMPLEMENTED |

---

### 3. Workflow Management Routes (`routes/workflows.ts`)
Mounted at `/api/workflows`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | `authenticate` | Query: `businessId` | `prisma.workflow.findMany` with versions & template | `200 { success: true, data: Workflow[] }` | 400, 403 | VERIFIED IMPLEMENTED |
| `POST` | `/` | `authenticate` | Body: `{ businessId, name, description, category, trigger, definition, config }` | `WorkflowService.createWorkflow` (creates Workflow + Version 1 + Steps) | `200 { success: true, data: Workflow }` | 400, 403, 500 | VERIFIED IMPLEMENTED |
| `POST` | `/generate` | `authenticate` | Body: `{ businessId, prompt }` | Generates draft workflow structure | `200 { success: true, data: { workflowId } }` | 400, 403 | PARTIALLY IMPLEMENTED (Returns standard draft DAG) |
| `GET` | `/:id` | `authenticate` | Param: `id`, Query: `businessId` | `prisma.workflow.findUnique` with versions and steps | `200 { success: true, data: Workflow }` | 403, 404 | VERIFIED IMPLEMENTED |
| `PUT` | `/:id` | `authenticate` | Param: `id`, Body: Workflow updates | `WorkflowService.updateWorkflow` | `200 { success: true, data: Workflow }` | 400, 403 | VERIFIED IMPLEMENTED |
| `POST` | `/:id/trigger`| `authenticate` | Param: `id`, Body: `{ triggerType, triggerPayload, idempotencyKey }` | `WorkflowEngine.triggerWorkflow` (adds job to BullMQ `workflow-execution`) | `200 { success: true, data: { executionId } }` | 400, 404, 500 | VERIFIED IMPLEMENTED |
| `POST` | `/:id/activate`| `authenticate`| Param: `id` | Updates workflow status to `ACTIVE` | `200 { success: true }` | 400, 403 | VERIFIED IMPLEMENTED |
| `POST` | `/:id/pause` | `authenticate` | Param: `id` | Updates workflow status to `PAUSED` | `200 { success: true }` | 400, 403 | VERIFIED IMPLEMENTED |
| `POST` | `/:id/simulate`| `authenticate`| Param: `id`, Body: `{ mockPayload }` | Runs execution dry-run | `200 { success: true, data: SimulationReport }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/:id/versions`| `authenticate`| Param: `id` | `prisma.workflowVersion.findMany` | `200 { success: true, data: Version[] }` | 403, 404 | VERIFIED IMPLEMENTED |
| `POST` | `/:id/versions`| `authenticate`| Param: `id`, Body: `{ definition, trigger }` | Creates immutable next version | `201 { success: true, data: WorkflowVersion }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/:id/connectors`| `authenticate`| Param: `id` | Lists required connector capabilities | `200 { success: true, data: Connector[] }` | 403, 404 | VERIFIED IMPLEMENTED |
| `POST` | `/:id/connectors/bind`| `authenticate`| Param: `id`, Body: `{ capability, integrationId }` | `prisma.workflowConnectorBinding.upsert` | `200 { success: true }` | 400, 500 | VERIFIED IMPLEMENTED |

---

### 4. Workflow Executions & Approvals (`routes/executions.ts`, `routes/approvals.ts`)
Mounted at `/api/executions` and `/api/approvals`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/executions` | `authenticate` | Query: `workflowId`, `businessId` | `prisma.workflowExecution.findMany` with steps | `200 { success: true, data: Executions[] }` | 400, 403 | VERIFIED IMPLEMENTED |
| `GET` | `/api/executions/:id` | `authenticate` | Param: `id` | `prisma.workflowExecution.findUnique` with step logs | `200 { success: true, data: WorkflowExecution }` | 404 | VERIFIED IMPLEMENTED |
| `POST`| `/api/executions/:id/retry` | `authenticate` | Param: `id`, Body: `{ fromStepId }` | `WorkflowEngine.retryExecution` | `200 { success: true }` | 404, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/api/executions/:id/cancel` | `authenticate` | Param: `id`, Body: `{ reason }` | `WorkflowEngine.cancelWorkflow` | `200 { success: true }` | 400, 404 | VERIFIED IMPLEMENTED |
| `GET` | `/api/approvals` | `authenticate` | Query: `businessId`, `status` | `prisma.workflowApproval.findMany` with execution | `200 { success: true, data: Approvals[] }` | 400, 403 | VERIFIED IMPLEMENTED |
| `POST`| `/api/approvals/:id/decide` | `authenticate` | Param: `id`, Body: `{ decision: 'APPROVED' \| 'REJECTED', reason }` | Updates approval, resumes workflow via `workflowQueue` | `200 { success: true }` | 400, 404 | VERIFIED IMPLEMENTED |

---

### 5. Knowledge & RAG Routes (`routes/knowledge.ts`)
Mounted at `/api/knowledge`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/bases` | `authenticate`, `requireBusinessMembership` | Query: `businessId` | `prisma.knowledgeBase.findMany` | `200 { success: true, data: KnowledgeBase[] }` | 403, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/bases` | `authenticate`, `requireBusinessMembership` | Body: `{ businessId, name, description }` | `prisma.knowledgeBase.create` | `201 { success: true, data: KnowledgeBase }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/documents` | `authenticate`, `requireBusinessMembership` | Query: `knowledgeBaseId`, `businessId` | `prisma.knowledgeDocument.findMany` | `200 { success: true, data: KnowledgeDocument[] }`| 403, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/documents/upload` | `authenticate`, `requireBusinessMembership` | `multipart/form-data`: `file`, `knowledgeBaseId`, `businessId` | Saves file, creates record, enqueues `knowledgeQueue` | `201 { success: true, data: KnowledgeDocument }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/documents/:id/process` | `authenticate`, `requireBusinessMembership` | Param: `id` | Calls `knowledgeService.processDocument` | `200 { success: true }` | 404, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/search` | `authenticate`, `requireBusinessMembership` | Body: `{ businessId, query, topK, similarityThreshold }` | Calls `knowledgeService.searchKnowledgeBase` (exact + vector) | `200 { success: true, data: SearchResult[] }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/debug` | `authenticate`, `requireBusinessMembership` | Body: `{ businessId, query }` | Calls `knowledgeService.debugRetrieval` | `200 { success: true, data: DebugReport }` | 400, 500 | VERIFIED IMPLEMENTED |

---

### 6. Enquiry & Intake Routes (`routes/enquiry.ts`, `routes/forms.ts`)
Mounted at `/api/enquiries` and `/api/forms`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/enquiries` | `authenticate`, `requireBusinessMembership` | Body: `{ customerId, subject, rawMessage, source, businessId }` | `CustomerResolutionService`, `EnquiryIntakeService.intakeEnquiry`, triggers `EventDispatcher.dispatch` | `201 { success: true, data: Enquiry }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/api/enquiries` | `authenticate`, `requireBusinessMembership` | Query: `businessId`, `status` | `prisma.enquiry.findMany` with customer and assignee | `200 { success: true, data: Enquiry[] }` | 403, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/api/enquiries/:id` | `authenticate` | Param: `id` | `prisma.enquiry.findUnique` | `200 { success: true, data: Enquiry }` | 404 | VERIFIED IMPLEMENTED |
| `GET` | `/api/forms/customer-details/:token` | Public (Signed JWT Token) | Param: `token` | `CustomerFormService.verifyFormToken` | `200 { success: true, data: { order, customer } }` | 400 (Expired / Invalid token) | VERIFIED IMPLEMENTED |
| `POST`| `/api/forms/customer-details/:token` | Public (Signed JWT Token) | Param: `token`, Body: Customer Address Fields | Updates Customer, updates Order to `READY_FOR_INVOICE`, dispatches events | `200 { success: true, message: 'Details updated' }` | 400, 500 | VERIFIED IMPLEMENTED |

---

### 7. Orders & Quotations Routes (`routes/orders.ts`, `routes/quotations.ts`)
Mounted at `/api/businesses/:businessId/orders` and `/api/businesses/:businessId/quotations`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/orders` | `authenticate`, `requireBusinessMembership` | Query: `status`, `paymentStatus`, `priority`, `page`, `limit` | `orderService.listOrders` with calculated metrics & vendor status | `200 { success: true, data: { orders, total, page } }` | 403, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/orders` | `authenticate`, `requireBusinessMembership` | Body: Order Payload | `orderService.createOrder`, calculates priority score | `201 { success: true, data: Order }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/orders/:id` | `authenticate`, `requireBusinessMembership` | Param: `id` | `orderService.getOrderById` with invoices, history, vendor | `200 { success: true, data: Order }` | 404 | VERIFIED IMPLEMENTED |
| `POST`| `/orders/:id/status` | `authenticate`, `requireBusinessMembership` | Param: `id`, Body: `{ status, reason }` | `LifecycleStateMachine.transitionOrder`, records status history | `200 { success: true, data: Order }` | 400 (Invalid transition), 404 | VERIFIED IMPLEMENTED |
| `GET` | `/quotations` | `authenticate`, `requireBusinessMembership` | Query: `customerId`, `orderId` | `quotationService.listQuotations` | `200 { success: true, data: Quotation[] }` | 403, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/quotations` | `authenticate`, `requireBusinessMembership` | Body: Quotation creation data | `quotationService.createQuotation` (uses deterministic financial engine) | `201 { success: true, data: Quotation }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/quotations/:id` | `authenticate`, `requireBusinessMembership` | Param: `id` | `quotationService.getQuotation` | `200 { success: true, data: Quotation }` | 404 | VERIFIED IMPLEMENTED |
| `POST`| `/quotations/:id/generate-pdf` | `authenticate`, `requireBusinessMembership` | Param: `id` | `documentGenerationService.generateDocument('QUOTATION', id)` | `200 { success: true, data: { documentId, url } }` | 400, 500 | VERIFIED IMPLEMENTED |

---

### 8. Invoices & Payments Routes (`routes/invoices.ts`, `routes/payments.ts`, `routes/payment-webhooks.ts`)
Mounted at `/api/businesses/:businessId/invoices`, `/api/businesses/:businessId`, and `/api/webhooks/payments`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/invoices` | `authenticate`, `requireBusinessMembership` | Query: `status`, `customerId` | `prisma.invoice.findMany` with payments | `200 { success: true, data: Invoice[] }` | 403, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/invoices` | `authenticate`, `requireBusinessMembership` | Body: Invoice Payload | `invoiceService.createInvoice` | `201 { success: true, data: Invoice }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/invoices/:id` | `authenticate`, `requireBusinessMembership` | Param: `id` | `prisma.invoice.findUnique` | `200 { success: true, data: Invoice }` | 404 | VERIFIED IMPLEMENTED |
| `POST`| `/invoices/:id/send` | `authenticate`, `requireBusinessMembership` | Param: `id` | `invoiceService.sendInvoice` (via Gmail API with PDF) | `200 { success: true }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/invoices/:invoiceId/payments` | `authenticate`, `requireBusinessMembership` | Param: `invoiceId`, Body: `{ amount, provider }` | `paymentService.createPaymentIntent` (Razorpay order) | `200 { success: true, data: Payment }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/payments/:paymentId/confirm` | `authenticate`, `requireBusinessMembership` | Param: `paymentId`, Body: `{ providerPaymentId }` | Confirms payment, marks invoice paid, posts General Ledger entry | `200 { success: true, data: Payment }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/api/webhooks/payments/:provider` | Public (Provider Signature) | Header: `x-razorpay-signature`, Body: Webhook payload | Verifies HMAC-SHA256 signature, records `PaymentWebhookEvent`, confirms payment | `200 { received: true }` | 400 (Invalid signature) | VERIFIED IMPLEMENTED |

---

### 9. Finance Centre & General Ledger Routes (`routes/finance.ts`)
Mounted at `/api/businesses/:businessId/finance`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/summary` | `authenticate`, `requireBusinessMembership` | None | `FinancialReportingService.getFinancialSummary` | `200 { success: true, data: FinancialSummary }` | 403, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/accounts` | `authenticate`, `requireBusinessMembership` | Query: `activeOnly` | `accountService.getAccounts` (Chart of Accounts) | `200 { success: true, data: Account[] }` | 403, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/accounts` | `authenticate`, `requireBusinessMembership` | Body: Account creation payload | `accountService.createAccount` | `201 { success: true, data: Account }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/accounts/seed` | `authenticate`, `requireBusinessMembership` | None | `accountService.seedStandardAccounts` (13 core accounts) | `200 { success: true, data: { created, existing } }` | 403, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/journal-entries`| `authenticate`, `requireBusinessMembership` | Query: `status`, `startDate`, `endDate`, `accountId` | `ledgerService.getJournalEntries` | `200 { success: true, data: JournalEntry[] }` | 403, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/journal-entries`| `authenticate`, `requireBusinessMembership` | Body: `CreateJournalEntryInput` | `ledgerService.createJournalEntry` (enforces 6 invariants) | `201 { success: true, data: JournalEntry }` | 400 (Unbalanced / Negative), 500 | VERIFIED IMPLEMENTED |
| `POST`| `/journal-entries/:id/post` | `authenticate`, `requireBusinessMembership` | Param: `id` | `ledgerService.postJournalEntry` (checks open period) | `200 { success: true, data: JournalEntry }` | 400, 404 | VERIFIED IMPLEMENTED |
| `POST`| `/journal-entries/:id/void` | `authenticate`, `requireBusinessMembership` | Param: `id`, Body: `{ reason }` | `ledgerService.voidJournalEntry` (creates reversing entry) | `200 { success: true, data: { status, entry } }` | 400, 404 | VERIFIED IMPLEMENTED |
| `GET` | `/reports/trial-balance` | `authenticate`, `requireBusinessMembership` | Query: `asOfDate`, `periodId` | `financialReportingService.generateTrialBalance` | `200 { success: true, data: TrialBalanceReport }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/reports/income-statement`| `authenticate`, `requireBusinessMembership` | Query: `startDate`, `endDate` | `financialReportingService.generateIncomeStatement` | `200 { success: true, data: IncomeStatementReport }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/reports/balance-sheet` | `authenticate`, `requireBusinessMembership` | Query: `asOfDate` | `financialReportingService.generateBalanceSheet` | `200 { success: true, data: BalanceSheetReport }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/reports/ar-aging` | `authenticate`, `requireBusinessMembership` | Query: `asOfDate` | `financialReportingService.generateArAgingReport` | `200 { success: true, data: ArAgingReport }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/reconciliation/bank` | `authenticate`, `requireBusinessMembership` | Query: `bankFeedAccountId` | `bankReconciliationService.getReconciliationStatus` | `200 { success: true, data: BankReconStatus }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/reconciliation/bank/match`| `authenticate`, `requireBusinessMembership`| Body: `{ bankTxId, journalLineId }` | `bankReconciliationService.matchTransaction` | `200 { success: true, data: Match }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/export/pack` | `authenticate`, `requireBusinessMembership` | Query: `periodId`, `format` (CSV/ZIP) | `financialExportService.generateAuditExportPack` | `200 application/zip (File stream)` | 400, 500 | VERIFIED IMPLEMENTED |

---

### 10. Vendor Centre Routes (`routes/vendors.ts`)
Mounted at `/api/businesses/:businessId/vendors`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | `authenticate`, `requireBusinessMembership` | Query: `status`, `verificationStatus` | `prisma.vendor.findMany` with verification logs | `200 { success: true, data: Vendor[] }` | 403, 500 | VERIFIED IMPLEMENTED |
| `POST` | `/` | `authenticate`, `requireBusinessMembership` | Body: Vendor creation fields | `prisma.vendor.create`, creates initial verification log | `201 { success: true, data: Vendor }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/:id` | `authenticate`, `requireBusinessMembership` | Param: `id` | `prisma.vendor.findUnique` | `200 { success: true, data: Vendor }` | 404 | VERIFIED IMPLEMENTED |
| `POST` | `/:id/verify` | `authenticate`, `requireBusinessMembership` | Param: `id` | Enqueues verification to `vendorVerificationQueue` with sync fallback | `200 { success: true, data: { status, queued } }`| 404, 500 | VERIFIED IMPLEMENTED |

---

### 11. Google Integrations & Operational Sync Routes (`routes/integrations.ts`, `routes/operations.ts`)
Mounted at `/api/integrations` and `/api/operations`.

| Method | Path | Auth Required | Parameters / Body | Service / DB Operations | Success Response | Error Codes | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/integrations` | `authenticate` | Query: `businessId` | `prisma.integration.findMany` with credentials masked | `200 { success: true, data: Integration[] }` | 400, 403 | VERIFIED IMPLEMENTED |
| `GET` | `/api/integrations/google/auth-url` | `authenticate` | Query: `businessId`, `services` | Generates OAuth2 consent URL with state hash | `200 { success: true, authUrl: string }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/api/integrations/google/callback` | `authenticate` | Body: `{ code, state }` | Exchanges auth code, encrypts tokens via AES-256-GCM | `200 { success: true, data: Integration }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/api/integrations/calendar/availability` | `authenticate` | Query: `businessId`, `date`, `time` | Checks calendar slot availability via `googleCalendarActions` | `200 { success: true, isAvailable: boolean }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/api/integrations/calendar/book` | `authenticate` | Body: `{ businessId, title, date, time, attendees }` | Inserts Google Calendar Event with Google Meet link | `200 { success: true, event: CalendarEvent }` | 400, 500 | VERIFIED IMPLEMENTED |
| `GET` | `/api/operations/sheets/status` | `authenticate`, `requireBusinessMembership` | Query: `businessId` | Checks Google Sheets sync status and worksheet mappings | `200 { success: true, data: SyncConfig }` | 400, 500 | VERIFIED IMPLEMENTED |
| `POST`| `/api/operations/sheets/sync` | `authenticate`, `requireBusinessMembership` | Body: `{ businessId }` | `operationalSyncService.processSyncQueue` | `200 { success: true, synced: number }` | 400, 500 | VERIFIED IMPLEMENTED |

---

## SECTION 2: COMPLETE PRISMA DATABASE MODEL REFERENCE

Source: `prisma/schema.prisma` (1,422 lines, 42,640 bytes).

### Model 1: User
- **Description:** Represents application users, operators, sales representatives, managers, and system administrators.
- **Fields:**
  - `id` (String, `@id @default(uuid())`): Primary key.
  - `name` (String): Full name.
  - `email` (String, `@unique`): User email address.
  - `passwordHash` (String): Bcrypt salted hash.
  - `createdAt`, `updatedAt` (DateTime).
- **Relations:**
  - `memberships`: `Membership[]` (1-to-many).
  - `auditLogs`: `AuditLog[]` (1-to-many).
  - `assignedEnquiries`: `Enquiry[]` (1-to-many).
  - `assignedOrders`: `Order[]` (1-to-many).
  - `postedJournalEntries`: `JournalEntry[]` (1-to-many relation `"JournalPostedBy"`).

### Model 2: Business
- **Description:** Central multi-tenant isolation unit. Every commercial, financial, and automated record is bound to a `businessId`.
- **Fields:**
  - `id` (String, `@id @default(uuid())`): Primary key.
  - `name`, `industry`, `businessType`, `country`, `timezone` (String).
  - `currency` (String, default `"INR"`): Authoritative currency token.
  - `contactInfo`, `operatingHours`, `preferences` (Json).
  - `createdAt`, `updatedAt` (DateTime).
- **Key Relations:**
  - `memberships`: `Membership[]` (Cascade delete).
  - `integrations`: `Integration[]` (Cascade delete).
  - `workflows`: `Workflow[]` (Cascade delete).
  - `KnowledgeBase`: `KnowledgeBase[]` (Cascade delete).
  - `customers`: `Customer[]` (Cascade delete).
  - `orders`: `Order[]` (Cascade delete).
  - `quotations`: `Quotation[]` (Cascade delete).
  - `invoices`: `Invoice[]` (Cascade delete).
  - `accounts`: `Account[]` (Chart of Accounts, Cascade delete).
  - `journalEntries`: `JournalEntry[]` (General Ledger, Cascade delete).
  - `vendors`: `Vendor[]` (Cascade delete).

### Model 3: Integration & IntegrationCredential
- **Description:** External SaaS connections (Gmail, Google Calendar, Sheets, Drive) with securely isolated encrypted credential storage.
- **Fields (Integration):**
  - `id` (String, `@id`): Primary key.
  - `businessId` (String): Tenant reference.
  - `provider` (String): e.g., `"GMAIL"`, `"GOOGLE_CALENDAR"`, `"GOOGLE_SHEETS"`, `"GOOGLE_DRIVE"`.
  - `accountId` (String): External Google account ID.
  - `status` (`CONNECTED`, `DISCONNECTED`, `RECONNECT_REQUIRED`, `ERROR`).
  - `scopes` (String[]): OAuth scopes granted.
  - `unique([businessId, provider, accountId])`.
- **Fields (IntegrationCredential):**
  - `id` (String, `@id`).
  - `integrationId` (String, `@unique`): 1-to-1 relation with `Integration`.
  - `accessTokenEncrypted` (String): AES-256-GCM ciphertext (`iv:authTag:ciphertext`).
  - `refreshTokenEncrypted` (String?): AES-256-GCM encrypted refresh token.
  - `expiresAt` (DateTime?): Expiration timestamp.

### Model 4: Workflow, WorkflowVersion, WorkflowStep & WorkflowExecution
- **Description:** Represents dynamic automation DAGs, immutable versioning snapshots, individual nodes, and execution runtime contexts.
- **Fields (Workflow):**
  - `id`, `businessId`, `name`, `status` (`DRAFT`, `READY`, `ACTIVE`, `PAUSED`, `ARCHIVED`).
  - `activeVersionId` (String?): Points strictly to the active version.
  - `riskLevel` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
- **Fields (WorkflowVersion):**
  - `id`, `workflowId`, `versionNumber` (Int).
  - `definition` (Json?): Graph DAG representation.
  - `trigger` (Json): Trigger configuration.
  - `unique([workflowId, versionNumber])`.
- **Fields (WorkflowStep):**
  - `id`, `workflowVersionId`, `stepOrder` (Int), `stepId` (String), `type` (String), `config` (Json), `next` (Json).
- **Fields (WorkflowExecution):**
  - `id`, `workflowId`, `workflowVersionId`, `businessId`, `triggerType`, `status` (`QUEUED`, `RUNNING`, `WAITING_APPROVAL`, `WAITING`, `SUCCESS`, `FAILED`, `CANCELLED`).
  - `idempotencyKey` (String?).
  - `context` (Json): Persisted execution state (`trigger`, `steps`, `variables`, `metadata`).
  - `unique([businessId, workflowId, idempotencyKey])`.

### Model 5: KnowledgeBase, KnowledgeDocument & KnowledgeChunk
- **Description:** Vector retrieval storage.
- **Fields (KnowledgeDocument):**
  - `id`, `knowledgeBaseId`, `businessId`, `filename`, `mimeType`, `fileSize`, `storagePath`, `status` (`UPLOADED`, `EXTRACTING`, `CHUNKING`, `EMBEDDING`, `INDEXED`, `FAILED`).
  - `knowledgeType` (`BUSINESS`, `PRODUCT`, `PRICING`, `POLICY`, `DOCUMENT_TEMPLATE`, `OTHER`).
- **Fields (KnowledgeChunk):**
  - `id`, `documentId`, `businessId`, `chunkIndex` (Int), `content` (String).
  - `embedding` (`Unsupported("vector(768)")?`): pgvector column.
  - `metadata` (Json): SKU, entity type, pricing, authority level.

### Model 6: Customer, Enquiry & Order
- **Description:** Customer relationship and commercial transaction tracking.
- **Fields (Customer):**
  - `id`, `businessId`, `name`, `email`, `phone`, `status` (`ACTIVE`, `INACTIVE`, `BLOCKED`).
  - `creditLimit` (Float, default 0), `totalOutstanding` (Float, default 0), `overdueBalance` (Float, default 0).
  - `paymentScore` (Float?), `paymentScoreCategory` (String?).
- **Fields (Order):**
  - `id`, `businessId`, `customerId`, `orderNumber` (String).
  - `status` (String, default `"DRAFT"`): Managed by `LifecycleStateMachine`.
  - `subtotal`, `tax`, `totalAmount`, `amountPaid`, `outstandingAmount` (Float).
  - `priority` (`LOW`, `NORMAL`, `HIGH`, `URGENT`), `priorityScore` (Float).
  - `vendorId` (String?): Foreign key to assigned `Vendor`.
  - `unique([businessId, orderNumber])`, `unique([businessId, idempotencyKey])`.

### Model 7: Quotation & Invoice
- **Fields (Quotation):**
  - `id`, `businessId`, `customerId`, `orderId`, `quotationNumber` (String).
  - `status` (`DRAFT`, `GENERATED`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CANCELLED`).
  - `subtotal`, `taxAmount`, `totalAmount` (Float), `currency` (default `"INR"`).
  - `lineItems` (Json), `gmailThreadId` (String?), `generatedDocumentId` (String?).
  - `unique([businessId, quotationNumber])`.
- **Fields (Invoice):**
  - `id`, `businessId`, `customerId`, `orderId`, `quotationId`, `invoiceNumber` (String).
  - `status` (`DRAFT`, `ISSUED`, `SENT`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`).
  - `subtotal`, `discountAmount`, `taxAmount`, `totalAmount`, `paidAmount`, `outstandingAmount` (Float).
  - `unique([businessId, invoiceNumber])`.

### Model 8: General Ledger (`Account`, `JournalEntry`, `JournalLine`, `AccountingPeriod`)
- **Fields (Account):**
  - `id`, `businessId`, `code` (String), `name` (String).
  - `type` (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`).
  - `classification` (`CASH_AND_BANK`, `ACCOUNTS_RECEIVABLE`, `ACCOUNTS_PAYABLE`, `OPERATING_REVENUE`, etc.).
  - `normalBalance` (`DEBIT`, `CREDIT`), `currency` (default `"INR"`).
  - `parentAccountId` (String?): Self-referential hierarchy.
  - `unique([businessId, code])`.
- **Fields (JournalEntry):**
  - `id`, `businessId`, `entryNumber` (String, e.g. `JE-2026-00001`).
  - `postingDate` (DateTime), `accountingPeriodId` (String), `status` (`DRAFT`, `POSTED`, `VOIDED`).
  - `totalDebit` (Decimal 18,4), `totalCredit` (Decimal 18,4).
  - `reversalOfEntryId` (String?, `@unique`): Points to reversed entry.
  - `sourceType` (`CUSTOMER_INVOICE`, `CUSTOMER_PAYMENT`, `VENDOR_BILL`, `MANUAL_JOURNAL`, etc.).
  - `unique([businessId, entryNumber])`, `unique([businessId, sourceType, sourceId])`, `unique([businessId, idempotencyKey])`.
- **Fields (JournalLine):**
  - `id`, `journalEntryId`, `accountId`, `lineNumber` (Int).
  - `debit` (Decimal 18,4, default 0), `credit` (Decimal 18,4, default 0).
  - `exchangeRate` (Decimal 18,6, default 1.0).
  - `unique([journalEntryId, lineNumber])`.

### Model 9: Vendor & VendorVerificationLog
- **Fields (Vendor):**
  - `id`, `businessId`, `name`, `legalName`, `taxId`, `verificationStatus` (`PENDING_VERIFICATION`, `IN_PROGRESS`, `VERIFIED`, `PARTIALLY_VERIFIED`, `VERIFICATION_FAILED`, `MANUAL_REVIEW_REQUIRED`).
  - `verifiedAt`, `verificationExpiresAt` (DateTime?).
  - `unique([businessId, name])`.
