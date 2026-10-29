import '../env';
import { prisma } from '@agent-flux/database';
import { googleDriveStorageService } from '../services/documents/GoogleDriveStorageService';
import { documentGenerationService } from '../services/documents/DocumentGenerationService';
import { operationalSyncService } from '../services/operations/OperationalSyncService';
import { google } from 'googleapis';

const TEST_BUSINESS_ID = '1379ce47-39e9-4742-9034-dfe218b6c0fc';

interface TestResult {
  step: string;
  passed: boolean;
  details?: any;
  error?: string;
}

const results: TestResult[] = [];

function recordPass(step: string, details?: any) {
  console.log(`[PASS] ${step}`, details ? JSON.stringify(details) : '');
  results.push({ step, passed: true, details });
}

function recordFail(step: string, error: string) {
  console.error(`[FAIL] ${step}: ${error}`);
  results.push({ step, passed: false, error });
}

async function runTestSuite() {
  console.log('========================================================');
  console.log('PHASE 3 — GOOGLE DRIVE DOCUMENT STORAGE VERIFICATION');
  console.log('Business ID:', TEST_BUSINESS_ID);
  console.log('========================================================\n');

  let driveClient: any;
  let testQuotationId: string | null = null;
  let testInvoiceId: string | null = null;
  let quotationDriveFileId: string | null = null;
  let invoiceDriveFileId: string | null = null;

  try {
    // ---------------------------------------------------------
    // TEST 1: Authenticate Google Drive Client & Verify Scopes
    // ---------------------------------------------------------
    try {
      driveClient = await googleDriveStorageService.getDriveClient(TEST_BUSINESS_ID);
      const about = await driveClient.about.get({ fields: 'user, storageQuota' });
      recordPass('1. Google Drive Connector & OAuth Client Auth', {
        userEmail: about.data.user?.emailAddress,
        displayName: about.data.user?.displayName
      });
    } catch (e: any) {
      recordFail('1. Google Drive Connector & OAuth Client Auth', e.message);
      throw e;
    }

    // ---------------------------------------------------------
    // TEST 2: Predictable Folder Structure Creation & Idempotency
    // ---------------------------------------------------------
    let quotationsFolderId: string;
    let invoicesFolderId: string;
    try {
      const business = await prisma.business.findUnique({
        where: { id: TEST_BUSINESS_ID },
        select: { name: true }
      });
      const businessName = business?.name || 'Aasha Furniture';

      quotationsFolderId = await googleDriveStorageService.ensureDirectoryPath(
        driveClient,
        ['Agent Flux', businessName, 'Quotations']
      );

      invoicesFolderId = await googleDriveStorageService.ensureDirectoryPath(
        driveClient,
        ['Agent Flux', businessName, 'Invoices']
      );

      // Verify idempotency: calling again must return exact same folder IDs
      const reQuotationsFolderId = await googleDriveStorageService.ensureDirectoryPath(
        driveClient,
        ['Agent Flux', businessName, 'Quotations']
      );
      const reInvoicesFolderId = await googleDriveStorageService.ensureDirectoryPath(
        driveClient,
        ['Agent Flux', businessName, 'Invoices']
      );

      if (quotationsFolderId !== reQuotationsFolderId) {
        throw new Error('Quotations folder creation is not idempotent: new folder created on second call');
      }
      if (invoicesFolderId !== reInvoicesFolderId) {
        throw new Error('Invoices folder creation is not idempotent: new folder created on second call');
      }

      recordPass('2. Predictable Folder Hierarchy (Agent Flux / Business / Quotations & Invoices)', {
        quotationsFolderId,
        invoicesFolderId,
        idempotent: true
      });
    } catch (e: any) {
      recordFail('2. Predictable Folder Hierarchy', e.message);
      throw e;
    }

    // ---------------------------------------------------------
    // TEST 3: Generate Quotation PDF, Upload to Drive, Persist Metadata
    // ---------------------------------------------------------
    let initialQuotationFileId: string;
    let quotationNumber: string;
    try {
      // Find or create customer
      let customer = await prisma.customer.findFirst({
        where: { businessId: TEST_BUSINESS_ID }
      });
      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            businessId: TEST_BUSINESS_ID,
            name: 'Priya Sharma',
            email: 'priya.sharma@example.com',
            phone: '+91 98765 43210'
          }
        });
      }

      // Create test quotation with snapshot
      const seq = await prisma.documentSequence.upsert({
        where: { businessId_type: { businessId: TEST_BUSINESS_ID, type: 'QUOTATION' } },
        update: { lastValue: { increment: 1 } },
        create: { businessId: TEST_BUSINESS_ID, type: 'QUOTATION', lastValue: 100 }
      });
      quotationNumber = `QUO-TEST-${seq.lastValue.toString().padStart(6, '0')}`;

      const business = await prisma.business.findUnique({ where: { id: TEST_BUSINESS_ID } });

      const quotation = await prisma.quotation.create({
        data: {
          businessId: TEST_BUSINESS_ID,
          customerId: customer.id,
          quotationNumber,
          status: 'DRAFT',
          subtotal: 45000,
          discountAmount: 2000,
          taxAmount: 7740,
          totalAmount: 50740,
          currency: 'INR',
          lineItems: [
            {
              item_index: 1,
              sku: 'TEAK-DINING-6S',
              productName: 'Royal Teak Wood 6-Seater Dining Table',
              description: 'Solid teak wood with natural honey finish',
              quantity: 1,
              unitPrice: 45000,
              discount: 2000,
              lineTotal: 43000
            }
          ],
          customerSnapshot: JSON.parse(JSON.stringify(customer)),
          businessSnapshot: JSON.parse(JSON.stringify(business))
        }
      });
      testQuotationId = quotation.id;

      // Execute document generation
      const generatedDoc = await documentGenerationService.generateDocument(
        TEST_BUSINESS_ID,
        'QUOTATION',
        quotation.id
      );

      if (!generatedDoc || !generatedDoc.externalId || !generatedDoc.externalUrl) {
        throw new Error('Generated document does not contain Drive file ID or webViewLink');
      }

      initialQuotationFileId = generatedDoc.externalId;
      quotationDriveFileId = generatedDoc.externalId;

      // Verify remote file in Google Drive
      const remoteFile = await driveClient.files.get({
        fileId: generatedDoc.externalId,
        fields: 'id, name, mimeType, parents, webViewLink, size'
      });

      if (remoteFile.data.mimeType !== 'application/pdf') {
        throw new Error(`Expected mimeType application/pdf, got ${remoteFile.data.mimeType}`);
      }
      if (!remoteFile.data.parents?.includes(quotationsFolderId)) {
        throw new Error('Remote file is not in the Quotations Drive folder');
      }

      // Verify database record
      const updatedQuotation = await prisma.quotation.findUnique({
        where: { id: quotation.id }
      });
      if (updatedQuotation?.status !== 'GENERATED') {
        throw new Error(`Expected quotation status GENERATED, got ${updatedQuotation?.status}`);
      }
      if (updatedQuotation?.generatedDocumentId !== generatedDoc.id) {
        throw new Error('Quotation.generatedDocumentId does not match KnowledgeDocument.id');
      }

      recordPass('3. Quotation Document Generation, Drive Upload & Database Persistence', {
        quotationId: quotation.id,
        quotationNumber,
        driveFileId: generatedDoc.externalId,
        driveUrl: generatedDoc.externalUrl,
        remoteName: remoteFile.data.name,
        remoteSize: remoteFile.data.size,
        status: updatedQuotation?.status
      });
    } catch (e: any) {
      recordFail('3. Quotation Document Generation & Drive Upload', e.message);
      throw e;
    }

    // ---------------------------------------------------------
    // TEST 4: Least-Privilege Document Permissions Verification
    // ---------------------------------------------------------
    try {
      const sec = await googleDriveStorageService.verifyFileSecurity(
        TEST_BUSINESS_ID,
        quotationDriveFileId!
      );
      if (sec.isPublic) {
        throw new Error('SECURITY VIOLATION: Quotation PDF was made publicly accessible or shared with anyone!');
      }

      recordPass('4. Least-Privilege Permissions Preserved (File is NOT public)', {
        fileId: sec.fileId,
        isPublic: sec.isPublic,
        permissionsCount: sec.permissionsCount
      });
    } catch (e: any) {
      recordFail('4. Least-Privilege Permissions Preserved', e.message);
      throw e;
    }

    // ---------------------------------------------------------
    // TEST 5: Google Sheets Synchronisation with Drive Document URL
    // ---------------------------------------------------------
    try {
      // Sync quotation to Google Sheets
      await operationalSyncService.syncEntity(TEST_BUSINESS_ID, 'QUOTATION', testQuotationId!);

      // Fetch row preview from Google Sheets
      const { config, adapter } = await (operationalSyncService as any).validateConfig(TEST_BUSINESS_ID);
      const mappings = (config.worksheetMappings as Record<string, any>) || {};
      const quoSheetName = mappings['QUOTATION']?.worksheetName || mappings['Quotations']?.worksheetName || 'Quotations';
      const rows = await adapter.getWorksheetPreview(config.spreadsheetId, quoSheetName, 100);

      const headers = rows[0] || [];
      const dataRows = rows.slice(1);
      const driveUrlColIdx = headers.indexOf('Drive Document URL');
      const idColIdx = headers.indexOf('Quotation ID');

      if (driveUrlColIdx === -1) {
        throw new Error(`Worksheet '${quoSheetName}' is missing 'Drive Document URL' column header`);
      }

      // Find the row with testQuotationId
      const matchingRow = dataRows.find((r: any) => r[idColIdx] === testQuotationId);
      if (!matchingRow) {
        throw new Error(`Quotation row ${testQuotationId} not found in Google Sheets worksheet '${quoSheetName}'`);
      }

      const syncedDriveUrl = matchingRow[driveUrlColIdx];
      if (!syncedDriveUrl || !syncedDriveUrl.includes('drive.google.com')) {
        throw new Error(`Drive Document URL in Sheets row is invalid or empty: '${syncedDriveUrl}'`);
      }

      recordPass('5. Authoritative Google Sheets Sync (Drive Document URL Synced)', {
        quotationId: testQuotationId,
        worksheetName: quoSheetName,
        driveUrlHeaderIndex: driveUrlColIdx,
        syncedDriveUrl
      });
    } catch (e: any) {
      recordFail('5. Authoritative Google Sheets Sync', e.message);
      throw e;
    }

    // ---------------------------------------------------------
    // TEST 6: Deterministic Document Identity & Deduplication on Retry
    // ---------------------------------------------------------
    try {
      // Re-run document generation on the same quotation
      const secondDoc = await documentGenerationService.generateDocument(
        TEST_BUSINESS_ID,
        'QUOTATION',
        testQuotationId!
      );

      if (secondDoc.externalId !== initialQuotationFileId) {
        throw new Error(
          `Idempotency failed: File ID changed on repeated execution! Original: ${initialQuotationFileId}, New: ${secondDoc.externalId}`
        );
      }

      // Query Drive Quotations folder for files with this quotation name
      const searchRes = await driveClient.files.list({
        q: `name = '${quotationNumber}.pdf' and '${quotationsFolderId}' in parents and trashed = false`,
        fields: 'files(id, name)'
      });

      const files = searchRes.data.files || [];
      if (files.length !== 1) {
        throw new Error(
          `Duplicate files created in Drive! Expected 1 file, found ${files.length}: ${JSON.stringify(files)}`
        );
      }

      // Verify no duplicate KnowledgeDocument records
      const kbDocs = await prisma.knowledgeDocument.findMany({
        where: {
          businessId: TEST_BUSINESS_ID,
          filename: `${quotationNumber}.pdf`
        }
      });
      if (kbDocs.length !== 1) {
        throw new Error(
          `Duplicate KnowledgeDocument records created in database! Found ${kbDocs.length} records.`
        );
      }

      recordPass('6. Deterministic Document Identity & Deduplication on Re-execution', {
        sameDriveFileId: secondDoc.externalId === initialQuotationFileId,
        driveFilesCount: files.length,
        kbDocsCount: kbDocs.length
      });
    } catch (e: any) {
      recordFail('6. Deterministic Document Identity & Deduplication', e.message);
      throw e;
    }

    // ---------------------------------------------------------
    // TEST 7: Generate Invoice PDF, Upload to Drive, Sheets Sync
    // ---------------------------------------------------------
    let initialInvoiceFileId: string;
    let invoiceNumber: string;
    try {
      // Create test invoice
      const customer = await prisma.customer.findFirst({
        where: { businessId: TEST_BUSINESS_ID }
      });
      const business = await prisma.business.findUnique({ where: { id: TEST_BUSINESS_ID } });

      const seq = await prisma.documentSequence.upsert({
        where: { businessId_type: { businessId: TEST_BUSINESS_ID, type: 'INVOICE' } },
        update: { lastValue: { increment: 1 } },
        create: { businessId: TEST_BUSINESS_ID, type: 'INVOICE', lastValue: 100 }
      });
      invoiceNumber = `AF-INV-TEST-${seq.lastValue.toString().padStart(6, '0')}`;

      const invoice = await prisma.invoice.create({
        data: {
          businessId: TEST_BUSINESS_ID,
          customerId: customer!.id,
          invoiceNumber,
          status: 'DRAFT',
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 7 * 86400000),
          currency: 'INR',
          subtotal: 60000,
          discountAmount: 3000,
          taxAmount: 10260,
          totalAmount: 67260,
          outstandingAmount: 67260,
          paidAmount: 0,
          lineItems: [
            {
              item_index: 1,
              sku: 'SHEESHAM-BED-KING',
              productName: 'King Size Sheesham Wood Bed with Hydraulic Storage',
              quantity: 1,
              unitPrice: 60000,
              discount: 3000,
              lineTotal: 57000
            }
          ],
          customerSnapshot: JSON.parse(JSON.stringify(customer)),
          businessSnapshot: JSON.parse(JSON.stringify(business))
        }
      });
      testInvoiceId = invoice.id;

      // Execute document generation
      const generatedInvoiceDoc = await documentGenerationService.generateDocument(
        TEST_BUSINESS_ID,
        'INVOICE',
        invoice.id
      );

      if (!generatedInvoiceDoc || !generatedInvoiceDoc.externalId) {
        throw new Error('Generated invoice document does not contain Drive file ID');
      }

      initialInvoiceFileId = generatedInvoiceDoc.externalId;
      invoiceDriveFileId = generatedInvoiceDoc.externalId;

      // Verify remote file in Google Drive Invoices folder
      const remoteInvoiceFile = await driveClient.files.get({
        fileId: generatedInvoiceDoc.externalId,
        fields: 'id, name, mimeType, parents, webViewLink, size'
      });

      if (!remoteInvoiceFile.data.parents?.includes(invoicesFolderId)) {
        throw new Error('Remote invoice file is not in the Invoices Drive folder');
      }

      // Verify security
      const invoiceSec = await googleDriveStorageService.verifyFileSecurity(
        TEST_BUSINESS_ID,
        invoiceDriveFileId!
      );
      if (invoiceSec.isPublic) {
        throw new Error('SECURITY VIOLATION: Invoice PDF is public!');
      }

      // Sync Invoice to Google Sheets
      await operationalSyncService.syncEntity(TEST_BUSINESS_ID, 'INVOICE', invoice.id);

      const { config: invConfig, adapter: invAdapter } = await (operationalSyncService as any).validateConfig(TEST_BUSINESS_ID);
      const invMappings = (invConfig.worksheetMappings as Record<string, any>) || {};
      const invSheetName = invMappings['INVOICE']?.worksheetName || invMappings['Invoices']?.worksheetName || 'Invoices';
      const invRows = await invAdapter.getWorksheetPreview(invConfig.spreadsheetId, invSheetName, 100);

      const invHeaders = invRows[0] || [];
      const invDataRows = invRows.slice(1);
      const invDriveColIdx = invHeaders.indexOf('Drive Document URL');
      const invIdColIdx = invHeaders.indexOf('Invoice ID');

      const matchingInvRow = invDataRows.find((r: any) => r[invIdColIdx] === invoice.id);
      if (!matchingInvRow) {
        throw new Error(`Invoice row ${invoice.id} not found in Google Sheets worksheet '${invSheetName}'`);
      }

      const syncedInvoiceDriveUrl = matchingInvRow[invDriveColIdx];
      if (!syncedInvoiceDriveUrl || !syncedInvoiceDriveUrl.includes('drive.google.com')) {
        throw new Error(`Drive Document URL in Invoices sheet row is invalid: '${syncedInvoiceDriveUrl}'`);
      }

      // Re-run generation on Invoice to verify idempotency
      const secondInvDoc = await documentGenerationService.generateDocument(
        TEST_BUSINESS_ID,
        'INVOICE',
        invoice.id
      );
      if (secondInvDoc.externalId !== initialInvoiceFileId) {
        throw new Error('Invoice file ID changed on repeated generation');
      }

      recordPass('7. Invoice Document Generation, Drive Upload, Sheets Sync & Deduplication', {
        invoiceId: invoice.id,
        invoiceNumber,
        driveFileId: generatedInvoiceDoc.externalId,
        syncedInvoiceDriveUrl,
        securityVerified: !invoiceSec.isPublic,
        idempotent: true
      });
    } catch (e: any) {
      recordFail('7. Invoice Document Generation & Drive Upload', e.message);
      throw e;
    }

    // ---------------------------------------------------------
    // TEST 8: Error Handling & Partial Failure Resilience
    // ---------------------------------------------------------
    try {
      let threwExpectedError = false;
      try {
        await googleDriveStorageService.getDriveClient('non-existent-business-id');
      } catch (err: any) {
        threwExpectedError = true;
      }
      if (!threwExpectedError) {
        throw new Error('Expected DriveSetupRequiredError for disconnected business, but call succeeded');
      }

      recordPass('8. Error Handling & Partial Failure Resilience', {
        setupRequiredErrorThrown: true
      });
    } catch (e: any) {
      recordFail('8. Error Handling & Partial Failure Resilience', e.message);
      throw e;
    }

  } finally {
    // Clean up temporary test quotation and invoice records and remote files
    console.log('\nCleaning up test artifacts...');
    if (driveClient) {
      if (quotationDriveFileId) {
        await driveClient.files.delete({ fileId: quotationDriveFileId }).catch(() => {});
      }
      if (invoiceDriveFileId) {
        await driveClient.files.delete({ fileId: invoiceDriveFileId }).catch(() => {});
      }
    }
    if (testQuotationId) {
      await prisma.quotation.delete({ where: { id: testQuotationId } }).catch(() => {});
    }
    if (testInvoiceId) {
      await prisma.invoice.delete({ where: { id: testInvoiceId } }).catch(() => {});
    }

    await prisma.$disconnect();
  }

  // Summary Report
  console.log('\n========================================================');
  console.log('TEST SUMMARY');
  console.log('========================================================');
  const allPassed = results.every((r) => r.passed);
  results.forEach((r) => {
    console.log(`${r.passed ? '✓' : '✗'} ${r.step}`);
  });
  console.log('========================================================');
  console.log(`TOTAL: ${results.length} | PASSED: ${results.filter((r) => r.passed).length} | FAILED: ${results.filter((r) => !r.passed).length}`);
  console.log('========================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runTestSuite().catch((e) => {
  console.error('Test suite failed with unexpected error:', e);
  process.exit(1);
});
