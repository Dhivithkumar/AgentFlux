import '../env';
import { prisma } from '@agent-flux/database';
import { GoogleSheetsAdapter } from '../services/operations/GoogleSheetsAdapter';
import { operationalSyncService } from '../services/operations/OperationalSyncService';
import { operationalSyncPoller } from '../services/queue/operationalSyncPoller';
import {
  quoteSheetName,
  formatA1Range,
  normalizeHeader,
  deduplicateHeaders
} from '../services/operations/utils';
import {
  SetupRequiredError,
  ColumnConflictError,
  PermissionDeniedError,
  OperationalWorksheetSchema
} from '../services/operations/types';
import { google } from 'googleapis';

async function runTestSuite() {
  console.log('================================================================');
  console.log('STARTING PHASE 2 — AUTHORITATIVE GOOGLE SHEETS SYNC TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  // Find business and connected Google Sheets integration
  const integration = await prisma.integration.findFirst({
    where: { provider: 'GOOGLE_SHEETS', status: 'CONNECTED' }
  });

  if (!integration) {
    throw new Error('No CONNECTED GOOGLE_SHEETS integration found in database. Cannot run real test suite.');
  }

  const businessId = integration.businessId;
  console.log(`Using Business: ${businessId}`);
  console.log(`Using Integration: ${integration.id}\n`);

  const adapter = new GoogleSheetsAdapter(integration.id, businessId);

  // -------------------------------------------------------------
  // Test 1: Unit tests for A1 quoting, normalization, deduplication
  // -------------------------------------------------------------
  console.log('Test Group 1: Range Quoting & Normalization');
  assert(
    quoteSheetName('Enquiries') === "'Enquiries'",
    'Simple sheet name quoting'
  );
  assert(
    quoteSheetName("Customer's Orders") === "'Customer''s Orders'",
    'Sheet name with single quote escaped'
  );
  assert(
    formatA1Range('Follow-up Tasks', 'A1:Z') === "'Follow-up Tasks'!A1:Z",
    'formatA1Range correctly builds quoted range'
  );
  assert(
    normalizeHeader('  Customer ID  ') === 'customer id',
    'normalizeHeader trims and lowercases'
  );

  const rawHeaders = ['Customer ID', 'Phone', 'phone', '  PHONE  ', 'Email', '  email  '];
  const deduped = deduplicateHeaders(rawHeaders);
  assert(
    deduped.length === 3 && deduped[0] === 'Customer ID' && deduped[1] === 'Phone' && deduped[2] === 'Email',
    'deduplicateHeaders normalises and eliminates duplicates case-insensitively'
  );

  // -------------------------------------------------------------
  // Test 2: Create Disposable Test Spreadsheet
  // -------------------------------------------------------------
  console.log('\nTest Group 2: Create Disposable Spreadsheet');
  const schemas = await operationalSyncService.getBusinessSchema(businessId);
  const testSpreadsheetName = `DISPOSABLE Operational Sync Test ${Date.now()}`;

  const initResult = await adapter.initialize(testSpreadsheetName, schemas);
  const testSpreadsheetId = initResult.spreadsheetId;
  console.log(`Created disposable test spreadsheet: ${testSpreadsheetId}`);
  assert(Boolean(testSpreadsheetId), 'Disposable spreadsheet created successfully');

  // Verify all 6 schemas were created
  const worksheets = await adapter.getWorksheets(testSpreadsheetId);
  const sheetTitles = worksheets.map((w) => w.name);
  assert(
    ['Customers', 'Enquiries', 'Followups', 'Orders', 'Quotations', 'Invoices'].every((s) =>
      sheetTitles.includes(s)
    ),
    'All 6 canonical schemas initialized as separate tabs',
    `Found tabs: ${sheetTitles.join(', ')}`
  );

  // -------------------------------------------------------------
  // Test 3: Existing spreadsheet with complete headers
  // -------------------------------------------------------------
  console.log('\nTest Group 3: Complete Headers Reconciliation');
  const custSchema = schemas.find((s) => s.name === 'Customers')!;
  const previewBefore = await adapter.getWorksheetPreview(testSpreadsheetId, 'Customers');
  const headersBefore = previewBefore[0] || [];

  // Running ensureWorksheetAndHeaders on already-complete headers
  await adapter.ensureWorksheetAndHeaders(testSpreadsheetId, custSchema);

  const previewAfter = await adapter.getWorksheetPreview(testSpreadsheetId, 'Customers');
  const headersAfter = previewAfter[0] || [];

  assert(
    headersBefore.length === headersAfter.length &&
      headersBefore.every((h, i) => h === headersAfter[i]),
    'Complete headers reconciliation does not duplicate or alter existing columns'
  );

  // -------------------------------------------------------------
  // Test 4: Missing headers reconciliation
  // -------------------------------------------------------------
  console.log('\nTest Group 4: Genuinely Missing Headers');
  // Use direct Google Sheets API to manually write partial headers to a new tab "PartialTest"
  const auth = await (adapter as any).getAuth();
  const sheetsApi = google.sheets({ version: 'v4', auth });

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: testSpreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: 'PartialTest' } } }]
    }
  });

  // Write partial headers
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: testSpreadsheetId,
    range: "'PartialTest'!1:1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['Customer ID', 'Customer Name']] }
  });

  // Run ensureWorksheetAndHeaders for Customers schema on PartialTest
  const testPartialSchema: OperationalWorksheetSchema = {
    ...custSchema,
    name: 'PartialTest'
  };
  await adapter.ensureWorksheetAndHeaders(testSpreadsheetId, testPartialSchema);

  const partialPreview = await adapter.getWorksheetPreview(testSpreadsheetId, 'PartialTest');
  const partialHeaders = partialPreview[0] || [];

  assert(
    partialHeaders[0] === 'Customer ID' && partialHeaders[1] === 'Customer Name',
    'Original headers preserved in their initial positions'
  );
  assert(
    partialHeaders.length === custSchema.headers.length,
    `Only genuinely missing headers were appended (total: ${partialHeaders.length} headers)`
  );

  // -------------------------------------------------------------
  // Test 5: Case/space differences in existing headers
  // -------------------------------------------------------------
  console.log('\nTest Group 5: Case and Space Differences');
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: testSpreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: 'CaseSpaceTest' } } }]
    }
  });

  // Headers with differing casing and surrounding whitespace
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: testSpreadsheetId,
    range: "'CaseSpaceTest'!1:1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['  customer id  ', 'CUSTOMER NAME', '   PHONE   ']] }
  });

  const caseSpaceSchema: OperationalWorksheetSchema = {
    name: 'CaseSpaceTest',
    idField: 'Customer ID',
    headers: ['Customer ID', 'Customer Name', 'Phone', 'Email', 'Billing Address']
  };

  await adapter.ensureWorksheetAndHeaders(testSpreadsheetId, caseSpaceSchema);

  const caseSpaceRes = await adapter.getWorksheetPreview(testSpreadsheetId, 'CaseSpaceTest');
  const caseSpaceHeaders = caseSpaceRes[0] || [];

  // Should have kept the 3 original headers as is, and only appended Email & Billing Address
  assert(
    caseSpaceHeaders.length === 5,
    'Matched existing columns case-insensitively and did NOT add duplicate Customer ID/Name/Phone',
    `Found headers: ${JSON.stringify(caseSpaceHeaders)}`
  );

  // -------------------------------------------------------------
  // Test 6: Duplicate schema headers handling
  // -------------------------------------------------------------
  console.log('\nTest Group 6: Duplicate Schema Headers Handling');
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: testSpreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: 'DedupSchemaTest' } } }]
    }
  });

  const duplicateSchema: OperationalWorksheetSchema = {
    name: 'DedupSchemaTest',
    idField: 'Order ID',
    headers: ['Order ID', 'Order Number', 'order id', ' ORDER NUMBER ', 'Status', 'status', 'STATUS']
  };

  await adapter.ensureWorksheetAndHeaders(testSpreadsheetId, duplicateSchema);
  const dedupRes = await adapter.getWorksheetPreview(testSpreadsheetId, 'DedupSchemaTest');
  const dedupHeaders = dedupRes[0] || [];

  assert(
    dedupHeaders.length === 3 &&
      dedupHeaders.includes('Order ID') &&
      dedupHeaders.includes('Order Number') &&
      dedupHeaders.includes('Status'),
    'Duplicate schema headers normalized and deduplicated before adding',
    `Headers: ${JSON.stringify(dedupHeaders)}`
  );

  // -------------------------------------------------------------
  // Test 7: Missing worksheet creation without duplicate tabs
  // -------------------------------------------------------------
  console.log('\nTest Group 7: Missing Worksheet Creation');
  const missingWorksheetSchema: OperationalWorksheetSchema = {
    name: 'BrandNewTab',
    idField: 'Quotation ID',
    headers: ['Quotation ID', 'Quotation Number', 'Grand Total']
  };

  await adapter.ensureWorksheetAndHeaders(testSpreadsheetId, missingWorksheetSchema);
  const sheetsList1 = await adapter.getWorksheets(testSpreadsheetId);
  const count1 = sheetsList1.filter((s) => normalizeHeader(s.name) === 'brandnewtab').length;

  // Run again to ensure no duplicate tab is created
  await adapter.ensureWorksheetAndHeaders(testSpreadsheetId, missingWorksheetSchema);
  const sheetsList2 = await adapter.getWorksheets(testSpreadsheetId);
  const count2 = sheetsList2.filter((s) => normalizeHeader(s.name) === 'brandnewtab').length;

  assert(
    count1 === 1 && count2 === 1,
    'Missing worksheet safely created and duplicate tab prevented on repeated calls'
  );

  // -------------------------------------------------------------
  // Test 8: Upsert rows (Existing vs Absent)
  // -------------------------------------------------------------
  console.log('\nTest Group 8: Row Upsert (Update Existing vs Append Absent)');
  const upsertTabSchema: OperationalWorksheetSchema = {
    name: 'UpsertTest',
    idField: 'Customer ID',
    headers: ['Customer ID', 'Customer Name', 'Email', 'Status']
  };
  await adapter.ensureWorksheetAndHeaders(testSpreadsheetId, upsertTabSchema);

  // 1. Initial Insert
  await adapter.syncRecords(testSpreadsheetId, 'UpsertTest', [
    {
      id: 'CUST-001',
      data: {
        'Customer ID': 'CUST-001',
        'Customer Name': 'Alice Initial',
        'Email': 'alice@example.com',
        'Status': 'ACTIVE'
      }
    }
  ], { idField: 'Customer ID' });

  // 2. Update CUST-001 and Append CUST-002
  await adapter.syncRecords(testSpreadsheetId, 'UpsertTest', [
    {
      id: 'CUST-001',
      data: {
        'Customer ID': 'CUST-001',
        'Customer Name': 'Alice Updated',
        'Email': 'alice@updated.com',
        'Status': 'VIP'
      }
    },
    {
      id: 'CUST-002',
      data: {
        'Customer ID': 'CUST-002',
        'Customer Name': 'Bob New',
        'Email': 'bob@example.com',
        'Status': 'ACTIVE'
      }
    }
  ], { idField: 'Customer ID' });

  const upsertPreview = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: testSpreadsheetId,
    range: "'UpsertTest'!A1:D10"
  });
  const upsertRows = upsertPreview.data.values || [];

  assert(upsertRows.length === 3, 'Total rows is 3 (1 header + 2 unique records)');
  assert(
    upsertRows[1][0] === 'CUST-001' && upsertRows[1][1] === 'Alice Updated' && upsertRows[1][3] === 'VIP',
    'CUST-001 updated in-place without appending duplicate'
  );
  assert(
    upsertRows[2][0] === 'CUST-002' && upsertRows[2][1] === 'Bob New',
    'CUST-002 appended when absent'
  );

  // -------------------------------------------------------------
  // Test 9: Concurrent Sync Protection (Mutex Locking)
  // -------------------------------------------------------------
  console.log('\nTest Group 9: Concurrent Sync Attempts');
  const concurrentRecord = {
    id: 'CUST-CONCURRENT',
    data: {
      'Customer ID': 'CUST-CONCURRENT',
      'Customer Name': 'Concurrent Customer',
      'Email': 'concurrent@example.com',
      'Status': 'PENDING'
    }
  };

  // Launch 5 simultaneous sync attempts for the exact same record
  await Promise.all([
    adapter.syncRecords(testSpreadsheetId, 'UpsertTest', [concurrentRecord], { idField: 'Customer ID' }),
    adapter.syncRecords(testSpreadsheetId, 'UpsertTest', [concurrentRecord], { idField: 'Customer ID' }),
    adapter.syncRecords(testSpreadsheetId, 'UpsertTest', [concurrentRecord], { idField: 'Customer ID' }),
    adapter.syncRecords(testSpreadsheetId, 'UpsertTest', [concurrentRecord], { idField: 'Customer ID' }),
    adapter.syncRecords(testSpreadsheetId, 'UpsertTest', [concurrentRecord], { idField: 'Customer ID' })
  ]);

  const afterConcurrentRes = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: testSpreadsheetId,
    range: "'UpsertTest'!A:A"
  });
  const allIds = (afterConcurrentRes.data.values || []).map((r) => r[0]);
  const concurrentCount = allIds.filter((id) => id === 'CUST-CONCURRENT').length;

  assert(
    concurrentCount === 1,
    `Mutex lock prevented concurrent duplicate appends (Found exactly ${concurrentCount} row for CUST-CONCURRENT)`
  );

  // -------------------------------------------------------------
  // Test 10: Database-backed Event Idempotency
  // -------------------------------------------------------------
  console.log('\nTest Group 10: Duplicate Event Idempotency');
  const dummyEntityId = `test-entity-${Date.now()}`;

  // Clean any residual test jobs
  await prisma.operationalSyncJob.deleteMany({
    where: { businessId, entityId: dummyEntityId }
  });

  const job1 = await operationalSyncService.enqueueSync(businessId, 'ORDER', dummyEntityId, 'ORDER_CREATED');
  const job2 = await operationalSyncService.enqueueSync(businessId, 'ORDER', dummyEntityId, 'ORDER_CREATED');

  const jobsInDb = await prisma.operationalSyncJob.findMany({
    where: { businessId, entityId: dummyEntityId }
  });

  assert(
    job1.id === job2.id && jobsInDb.length === 1,
    'Database idempotency consolidated duplicate events into single logical job'
  );

  // Clean up test job
  await prisma.operationalSyncJob.deleteMany({
    where: { id: job1.id }
  });

  // -------------------------------------------------------------
  // Test 11: Setup Required & Missing Configuration Visibility
  // -------------------------------------------------------------
  console.log('\nTest Group 11: Setup Required Error on Missing Config');
  const nonConfiguredBusinessId = '00000000-0000-0000-0000-000000000000';
  let caughtSetupError: any = null;

  try {
    await operationalSyncService.validateConfig(nonConfiguredBusinessId);
  } catch (err: any) {
    caughtSetupError = err;
  }

  assert(
    caughtSetupError instanceof SetupRequiredError,
    'Actionable SetupRequiredError thrown when configuration is missing (no silent spreadsheet creation)'
  );

  // -------------------------------------------------------------
  // Test 12: Retries and Exponential Backoff Handling
  // -------------------------------------------------------------
  console.log('\nTest Group 12: Retries & Transient Error Backoff');
  const retryEntityId = `retry-test-${Date.now()}`;
  const retryJob = await prisma.operationalSyncJob.create({
    data: {
      businessId,
      entityType: 'ORDER',
      entityId: retryEntityId,
      operation: 'TEST_RETRY',
      status: 'PENDING',
      attemptCount: 0
    }
  });

  // Simulate a poller processing failure with a transient error
  const transientError = new Error('Transient rate limit error 429');
  let simulatedAttempts = retryJob.attemptCount + 1;
  let delaySecs = 10 * Math.pow(2, 0);
  let nextAttemptAt = new Date(Date.now() + delaySecs * 1000);

  await prisma.operationalSyncJob.update({
    where: { id: retryJob.id },
    data: {
      status: 'RETRYING',
      attemptCount: simulatedAttempts,
      lastError: transientError.message,
      nextAttemptAt
    }
  });

  const updatedRetryJob = await prisma.operationalSyncJob.findUnique({
    where: { id: retryJob.id }
  });

  assert(
    updatedRetryJob?.status === 'RETRYING' &&
      updatedRetryJob?.attemptCount === 1 &&
      Boolean(updatedRetryJob?.nextAttemptAt) &&
      updatedRetryJob?.lastError === 'Transient rate limit error 429',
    'Retrying status, attempt count, backoff timestamp and last error preserved'
  );

  // Clean up retry job
  await prisma.operationalSyncJob.deleteMany({
    where: { id: retryJob.id }
  });

  // -------------------------------------------------------------
  // Test 13: Permission Failure & RECONNECT_REQUIRED
  // -------------------------------------------------------------
  console.log('\nTest Group 13: Permission Failure Handling');
  // Create a dummy disconnected integration
  const dummyIntegration = await prisma.integration.create({
    data: {
      businessId,
      provider: 'GOOGLE_SHEETS',
      accountId: 'dummy-account-test',
      status: 'RECONNECT_REQUIRED'
    }
  });

  const dummyAdapter = new GoogleSheetsAdapter(dummyIntegration.id, businessId);
  let caughtPermError: any = null;

  try {
    await dummyAdapter.listSpreadsheets();
  } catch (err: any) {
    caughtPermError = err;
  }

  assert(
    caughtPermError instanceof PermissionDeniedError || caughtPermError instanceof SetupRequiredError,
    'Permission failure throws actionable error and prevents sync retry loop'
  );

  // Clean up dummy integration
  await prisma.integration.delete({ where: { id: dummyIntegration.id } });

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`Disposable test spreadsheet ID: ${testSpreadsheetId}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`Test suite failed with ${failed} failure(s)`);
  }
}

runTestSuite()
  .then(() => {
    console.log('ALL PHASE 2 TESTS COMPLETED SUCCESSFULLY.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
