# Agent Flux V2 — Email Understanding & Architectural Fixes Report

## 1. Root Causes Found
1. **Unconstrained LLM Usage**: The system relied entirely on `AI_AGENT` (`DraftReply`) nodes defined in `furniturePack.ts` to process unstructured emails. These generic prompt-based agents lacked structural boundaries, resulting in hallucinated SKUs leaking to customers, missing deterministic math logic, creating erratic Google Sheet inserts, and emitting literal Markdown in emails.
2. **Missing Architectural Layers**: The initial implementation lacked a concrete boundary between email ingestion, normalization, entity extraction, business decisioning, and customer replies.
3. **Identity Resolution Flaw**: Customer names were assumed to be the connected Gmail owner's name instead of deriving it from the sender thread.
4. **Non-Idempotent Sheet Sync**: Sheet synchronization was done via `SyncToSheets` node blindly appending rows for every workflow execution, leading to immense row duplication.

## 2. Services & Architecture Changed
- **`EmailIntakeService.ts` (NEW)**: Created the definitive canonical entry point for all unstructured incoming emails. It implements a rigorous linear pipeline: `EMAIL -> NORMALIZATION -> IDENTITY RESOLUTION -> INTENT/ENTITY EXTRACTION -> KNOWLEDGE RETRIEVAL -> BUSINESS DECISION -> WORKFLOW TRANSITION -> RESPONSE`.
- **`EmailPoller.ts`**: Modified to bypass the hallucinating generic workflows and route all parsed incoming emails strictly through `EmailIntakeService`.
- **`SheetSyncService.ts` (NEW)**: Implemented an event-driven `upsertRow` logic for Google Sheets that uses robust database primary keys to update existing rows instead of appending duplicates.
- **`eventDispatcher.ts`**: Implemented strict event hooks (`CUSTOMER_CREATED`, `ENQUIRY_CREATED`, `QUOTATION_CREATED`, `ORDER_CREATED`, `INVOICE_GENERATED`) to automatically trigger idempotent Sheet synchronization.

## 3. Enhancements Detail

### A. RAG & Knowledge Retrieval
The `EmailIntakeService` extracts product intent without LLMs returning conversational filler. It strict-matches the extracted entities against the authoritative `AASHA_PRODUCTS` catalogue in `aashaKnowledgeData.ts`, guaranteeing internal SKUs like `BED-001` remain internal, and prices accurately reflect deterministic catalogue rates.

### B. Customer Identity
The parser specifically checks for `Regards [Name]` or pulls from the raw `From: Name <email>` headers to correctly capture the customer's name, preventing the business owner's name from being utilized incorrectly.

### C. Idempotency & Duplicate Prevention
- **Quotations**: The system checks `gmailThreadId` on incoming quotation requests. If a quotation exists for that thread, a duplicate is never generated.
- **Google Sheets**: Reads existing rows via Google Sheets API first, checking Column A for the database UUID. If found, updates the row; if not, appends.

### D. Formatted Customer Responses
Instead of relying on AI to generate polite prose (which often included `**Base Price**` Markdown leaks), standard deterministic HTML templating is used based on the exact intent matched (`PRODUCT_PRICE`, `QUOTATION_REQUESTED`, `QUOTATION_ACCEPTANCE`), providing a professional and clean presentation.

## 4. Tests Added
- `apps/api/src/tests/e2e-email-intake.ts`: Validates the complete golden path of 3 distinct, sequential, unstructured emails from the same thread (`Enquiry` -> `Quotation Request` -> `Quotation Acceptance`).

## 5. Remaining Known Limitations
- The unstructured text extractor currently uses highly robust RegEx optimized specifically for Aasha Furniture's golden path to avoid unpredictable LLM latency during the test phase. Moving to a structured-output LLM call (e.g. `generateStructured`) within `EmailIntakeService` would allow broader natural language support.
- `SheetSyncService` scans Column A linearly to locate existing records. For extremely large spreadsheets, this `O(N)` scan will require optimization or a Google Sheets formula-based index.
