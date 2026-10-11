/**
 * PHASE 2 TEST SUITE: OPERATIONAL SUBLEDGER SYNCHRONISATION & EVENT SOURCING
 *
 * Verifies against live PostgreSQL:
 * 1. Customer Invoice Issuance -> Auto-generates balanced double-entry journal (DR AR, CR Revenue, CR Tax)
 * 2. Invoice Sync Idempotency -> Re-sync produces no duplicate entries
 * 3. Customer Payment Received -> Auto-generates balanced double-entry journal (DR Bank, DR Gateway Fee, CR AR)
 * 4. AR Zero Settlement -> Proves AR clears to $0.00 upon complete payment
 * 5. Payment Sync Idempotency -> Re-sync produces no duplicate entries
 * 6. Invoice Cancellation -> Auto-posts reversing journal entry restoring balances
 * 7. Batch Synchronisation -> Accurately syncs unposted historical operational records
 * 8. Trial Balance Mathematical Equilibrium -> Total Debits == Total Credits across all GL accounts
 */

import '../env';
import { prisma } from '@agent-flux/database';
import { accountService } from '../services/finance/AccountService';
import { ledgerService } from '../services/finance/LedgerService';
import { ledgerSyncService } from '../services/finance/LedgerSyncService';
import assert from 'assert';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details?: string, error?: string) {
  results.push({ name, passed, details, error });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (details) console.log(`   Details: ${details}`);
  if (error) console.error(`   Error: ${error}`);
}

async function runOperationalSubledgerTests() {
  console.log('========================================================================');
  console.log('STARTING PHASE 2 TEST SUITE: OPERATIONAL SUBLEDGER SYNCHRONISATION');
  console.log('========================================================================\n');

  const testBizId = `biz-subledger-test-${Date.now()}`;
  const testUserId = `user-subledger-test-${Date.now()}`;
  const testCustId = `cust-subledger-test-${Date.now()}`;

  try {
    // 0. Setup isolated tenant records
    await prisma.user.create({
      data: {
        id: testUserId,
        name: 'Finance Operator',
        email: `operator-${Date.now()}@example.com`,
        passwordHash: 'hash'
      }
    });

    await prisma.business.create({
      data: {
        id: testBizId,
        name: 'OmniTrade Retail Ltd',
        industry: 'Retail & E-commerce',
        currency: 'INR'
      }
    });

    await prisma.membership.create({
      data: {
        businessId: testBizId,
        userId: testUserId,
        role: 'OWNER'
      }
    });

    await prisma.customer.create({
      data: {
        id: testCustId,
        businessId: testBizId,
        name: 'Acme International Corp',
        email: 'billing@acme-corp.com'
      }
    });

    // Seed standard chart of accounts
    const seedResult = await accountService.seedStandardAccounts(testBizId);
    assert.strictEqual(seedResult.created, 13, 'Must seed standard accounts');

    const arAcc = await accountService.getSystemAccount(testBizId, 'ACCOUNTS_RECEIVABLE');
    const revenueAcc = await accountService.getSystemAccount(testBizId, 'OPERATING_REVENUE');
    const taxAcc = await accountService.getSystemAccount(testBizId, 'TAX_PAYABLE');
    const bankAcc = await accountService.getSystemAccount(testBizId, 'CASH_AND_BANK');
    const feeAcc = await accountService.getSystemAccount(testBizId, 'OPERATING_EXPENSE');

    // TEST 1: Customer Invoice Issuance -> Double-Entry GL Posting
    const invoice1Id = `inv-test-1-${Date.now()}`;
    try {
      const invoice1 = await prisma.invoice.create({
        data: {
          id: invoice1Id,
          businessId: testBizId,
          customerId: testCustId,
          invoiceNumber: 'INV-2026-001',
          status: 'ISSUED',
          currency: 'INR',
          subtotal: 1000.0,
          discountAmount: 0.0,
          taxAmount: 180.0,
          totalAmount: 1180.0,
          outstandingAmount: 1180.0,
          lineItems: [
            { description: 'Enterprise License', quantity: 1, unitPrice: 1000.0, total: 1000.0 }
          ]
        }
      });

      const syncResult = await ledgerSyncService.syncInvoiceToLedger(testBizId, invoice1.id, testUserId);
      assert.strictEqual(syncResult.success, true, 'Sync must report success');
      assert.ok(syncResult.journalEntryId, 'Must generate journal entry ID');

      const entry = await ledgerService.getJournalEntryById(testBizId, syncResult.journalEntryId!);
      assert.ok(entry, 'Journal entry must exist');
      assert.strictEqual(entry!.status, 'POSTED', 'Entry must be POSTED');
      assert.strictEqual(entry!.sourceType, 'CUSTOMER_INVOICE');
      assert.strictEqual(entry!.sourceId, invoice1.id);
      assert.strictEqual(Number(entry!.totalDebit), 1180.0, 'Total debit must be 1180.00');
      assert.strictEqual(Number(entry!.totalCredit), 1180.0, 'Total credit must be 1180.00');

      // Check lines
      const arLine = entry!.lines.find((l) => l.accountId === arAcc.id);
      const revLine = entry!.lines.find((l) => l.accountId === revenueAcc.id);
      const taxLine = entry!.lines.find((l) => l.accountId === taxAcc.id);

      assert.ok(arLine, 'AR line must exist');
      assert.strictEqual(Number(arLine!.debit), 1180.0, 'DR AR must be 1180.00');

      assert.ok(revLine, 'Revenue line must exist');
      assert.strictEqual(Number(revLine!.credit), 1000.0, 'CR Revenue must be 1000.00');

      assert.ok(taxLine, 'Tax line must exist');
      assert.strictEqual(Number(taxLine!.credit), 180.0, 'CR Tax must be 180.00');

      record('TEST 1: Customer Invoice Issuance -> Double-Entry GL Posting', true, `DR AR $1180.00, CR Revenue $1000.00, CR Tax $180.00 (${entry!.entryNumber})`);
    } catch (err: any) {
      record('TEST 1: Customer Invoice Issuance -> Double-Entry GL Posting', false, undefined, err.message);
    }

    // TEST 2: Invoice Sync Idempotency
    try {
      const res2 = await ledgerSyncService.syncInvoiceToLedger(testBizId, invoice1Id, testUserId);
      assert.strictEqual(res2.success, true, 'Must report success');
      assert.strictEqual(res2.alreadySynced, true, 'Must indicate already synced');

      // Verify no duplicate journal entries were created
      const count = await prisma.journalEntry.count({
        where: { businessId: testBizId, sourceType: 'CUSTOMER_INVOICE', sourceId: invoice1Id }
      });
      assert.strictEqual(count, 1, 'Exactly 1 journal entry must exist for invoice');

      record('TEST 2: Invoice Sync Idempotency', true, 'Idempotently recognized existing journal entry without duplication');
    } catch (err: any) {
      record('TEST 2: Invoice Sync Idempotency', false, undefined, err.message);
    }

    // TEST 3: Customer Payment Received -> Double-Entry GL Posting & AR Settlement
    const payment1Id = `pay-test-1-${Date.now()}`;
    try {
      const payment1 = await prisma.payment.create({
        data: {
          id: payment1Id,
          businessId: testBizId,
          invoiceId: invoice1Id,
          customerId: testCustId,
          provider: 'STRIPE',
          amount: 1180.0,
          currency: 'INR',
          status: 'SUCCEEDED',
          metadata: { fee: 35.40 }, // $35.40 gateway processing fee
          paidAt: new Date()
        }
      });

      const syncPayResult = await ledgerSyncService.syncPaymentToLedger(testBizId, payment1.id, testUserId);
      assert.strictEqual(syncPayResult.success, true, 'Payment sync must succeed');
      assert.ok(syncPayResult.journalEntryId, 'Must generate payment journal entry ID');

      const payEntry = await ledgerService.getJournalEntryById(testBizId, syncPayResult.journalEntryId!);
      assert.ok(payEntry, 'Payment entry must exist');
      assert.strictEqual(payEntry!.status, 'POSTED');
      assert.strictEqual(Number(payEntry!.totalDebit), 1180.0);
      assert.strictEqual(Number(payEntry!.totalCredit), 1180.0);

      // Verify lines: DR Bank ($1144.60), DR Gateway Fee ($35.40), CR AR ($1180.00)
      const bankLine = payEntry!.lines.find((l) => l.accountId === bankAcc.id);
      const feeLine = payEntry!.lines.find((l) => l.accountId === feeAcc.id);
      const payArLine = payEntry!.lines.find((l) => l.accountId === arAcc.id);

      assert.ok(bankLine, 'Bank line must exist');
      assert.strictEqual(Number(bankLine!.debit), 1144.60, 'DR Bank must be 1144.60 (net deposit)');

      assert.ok(feeLine, 'Fee line must exist');
      assert.strictEqual(Number(feeLine!.debit), 35.40, 'DR Gateway Fee must be 35.40');

      assert.ok(payArLine, 'AR line must exist');
      assert.strictEqual(Number(payArLine!.credit), 1180.00, 'CR AR must be 1180.00');

      record('TEST 3: Customer Payment Received -> Double-Entry GL Posting', true, `DR Bank $1144.60, DR Gateway Fee $35.40, CR AR $1180.00 (${payEntry!.entryNumber})`);
    } catch (err: any) {
      record('TEST 3: Customer Payment Received -> Double-Entry GL Posting', false, undefined, err.message);
    }

    // TEST 4: Accounts Receivable Zero Balance Verification
    try {
      const accounts = await accountService.getAccounts(testBizId, true);
      const arAccountWithBalance = accounts.find((a: any) => a.id === arAcc.id);

      assert.ok(arAccountWithBalance, 'AR account must exist in Chart of Accounts');
      assert.strictEqual(
        (arAccountWithBalance as any).currentBalance,
        0,
        `AR current balance must be exactly 0 after full payment. Actual: ${(arAccountWithBalance as any).currentBalance}`
      );

      const bankAccountWithBalance = accounts.find((a: any) => a.id === bankAcc.id);
      assert.strictEqual(
        (bankAccountWithBalance as any).currentBalance,
        1144.60,
        `Bank account must reflect net deposit of $1144.60. Actual: ${(bankAccountWithBalance as any).currentBalance}`
      );

      record('TEST 4: Accounts Receivable Zero Settlement Verification', true, 'AR balance exactly $0.00, Bank deposit exactly $1144.60');
    } catch (err: any) {
      record('TEST 4: Accounts Receivable Zero Settlement Verification', false, undefined, err.message);
    }

    // TEST 5: Payment Sync Idempotency
    try {
      const payRes2 = await ledgerSyncService.syncPaymentToLedger(testBizId, payment1Id, testUserId);
      assert.strictEqual(payRes2.success, true);
      assert.strictEqual(payRes2.alreadySynced, true);

      const payCount = await prisma.journalEntry.count({
        where: { businessId: testBizId, sourceType: 'CUSTOMER_PAYMENT', sourceId: payment1Id }
      });
      assert.strictEqual(payCount, 1, 'Exactly 1 journal entry must exist for payment');

      record('TEST 5: Payment Sync Idempotency', true, 'Payment sync is idempotent without duplicate postings');
    } catch (err: any) {
      record('TEST 5: Payment Sync Idempotency', false, undefined, err.message);
    }

    // TEST 6: Invoice Cancellation -> Reversal Journal Generation
    const invoice2Id = `inv-test-2-${Date.now()}`;
    try {
      const invoice2 = await prisma.invoice.create({
        data: {
          id: invoice2Id,
          businessId: testBizId,
          customerId: testCustId,
          invoiceNumber: 'INV-2026-002',
          status: 'ISSUED',
          currency: 'INR',
          subtotal: 500.0,
          discountAmount: 0.0,
          taxAmount: 0.0,
          totalAmount: 500.0,
          outstandingAmount: 500.0,
          lineItems: [{ description: 'Advisory Consultation', quantity: 1, unitPrice: 500.0, total: 500.0 }]
        }
      });

      // Sync invoice 2
      await ledgerSyncService.syncInvoiceToLedger(testBizId, invoice2.id, testUserId);

      // Now cancel invoice 2
      await prisma.invoice.update({
        where: { id: invoice2.id },
        data: { status: 'CANCELLED' }
      });

      const cancelResult = await ledgerSyncService.syncInvoiceCancellationToLedger(
        testBizId,
        invoice2.id,
        'Client cancelled consulting engagement',
        testUserId
      );

      assert.strictEqual(cancelResult.success, true, 'Cancellation sync must succeed');

      // Verify reversal entry
      const revEntry = await ledgerService.getJournalEntryById(testBizId, cancelResult.journalEntryId!);
      assert.ok(revEntry, 'Reversal entry must exist');
      assert.ok(revEntry!.reversalOfEntryId, 'Reversal entry must link to original entry');
      assert.strictEqual(Number(revEntry!.totalDebit), 500.0);
      assert.strictEqual(Number(revEntry!.totalCredit), 500.0);

      // Verify AR balance returned to 0.00
      const accountsAfterCancel = await accountService.getAccounts(testBizId, true);
      const arAfterCancel = accountsAfterCancel.find((a: any) => a.id === arAcc.id);
      assert.strictEqual((arAfterCancel as any).currentBalance, 0, 'AR balance must return to 0.00 after cancellation reversal');

      record('TEST 6: Invoice Cancellation & Automatic Reversal Posting', true, `Generated reversal journal ${revEntry!.entryNumber}; AR balance restored to $0.00`);
    } catch (err: any) {
      record('TEST 6: Invoice Cancellation & Automatic Reversal Posting', false, undefined, err.message);
    }

    // TEST 7: Batch Operational Synchronization
    try {
      // Create an unposted invoice and unposted payment
      const invoice3Id = `inv-test-3-${Date.now()}`;
      await prisma.invoice.create({
        data: {
          id: invoice3Id,
          businessId: testBizId,
          customerId: testCustId,
          invoiceNumber: 'INV-2026-003',
          status: 'ISSUED',
          currency: 'INR',
          subtotal: 250.0,
          taxAmount: 0.0,
          totalAmount: 250.0,
          outstandingAmount: 250.0,
          lineItems: [{ description: 'Software plugin', quantity: 1, unitPrice: 250.0, total: 250.0 }]
        }
      });

      const batchResult = await ledgerSyncService.batchSyncOperationalRecords(testBizId);
      assert.ok(batchResult.invoicesSynced >= 1, 'Must have synced at least 1 invoice');
      assert.strictEqual(batchResult.errors.length, 0, 'Must have 0 sync errors');

      record('TEST 7: Batch Operational Synchronisation Engine', true, `Successfully batch synced ${batchResult.invoicesSynced} invoices with 0 errors`);
    } catch (err: any) {
      record('TEST 7: Batch Operational Synchronisation Engine', false, undefined, err.message);
    }

    // TEST 8: Trial Balance Mathematical Equilibrium Across Entire Subledger
    try {
      const trialBalance = await ledgerService.getTrialBalance(testBizId);
      assert.strictEqual(trialBalance.isBalanced, true, 'Trial balance must be mathematically balanced');
      assert.strictEqual(trialBalance.difference, '0.00', 'Trial balance difference must be 0.00');
      assert.strictEqual(trialBalance.totalDebit, trialBalance.totalCredit, 'Grand total debits must equal grand total credits');

      record(
        'TEST 8: Subledger Trial Balance Mathematical Equilibrium',
        true,
        `Total Debits ($${trialBalance.totalDebit}) == Total Credits ($${trialBalance.totalCredit}), Discrepancy: $${trialBalance.difference}`
      );
    } catch (err: any) {
      record('TEST 8: Subledger Trial Balance Mathematical Equilibrium', false, undefined, err.message);
    }

  } catch (globalErr: any) {
    console.error('Fatal test error:', globalErr);
  } finally {
    // Teardown test business and associated records
    try {
      await prisma.financeAuditLog.deleteMany({ where: { businessId: testBizId } });
      await prisma.journalLine.deleteMany({
        where: { journalEntry: { businessId: testBizId } }
      });
      await prisma.journalEntry.deleteMany({ where: { businessId: testBizId } });
      await prisma.accountBalance.deleteMany({
        where: { period: { businessId: testBizId } }
      });
      await prisma.accountingPeriod.deleteMany({ where: { businessId: testBizId } });
      await prisma.account.deleteMany({ where: { businessId: testBizId } });
      await prisma.payment.deleteMany({ where: { businessId: testBizId } });
      await prisma.invoice.deleteMany({ where: { businessId: testBizId } });
      await prisma.customer.deleteMany({ where: { businessId: testBizId } });
      await prisma.membership.deleteMany({ where: { businessId: testBizId } });
      await prisma.business.delete({ where: { id: testBizId } });
      await prisma.user.delete({ where: { id: testUserId } });
      console.log(`\n🧹 Cleaned up test business ${testBizId} and user ${testUserId}`);
    } catch (cleanupErr: any) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
  }

  console.log('\n========================================================================');
  console.log('OPERATIONAL SUBLEDGER TEST SUMMARY');
  console.log('========================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(`Results: ${passedCount}/${totalCount} tests passed.\n`);

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runOperationalSubledgerTests().catch((err) => {
  console.error('Unhandled test execution failure:', err);
  process.exit(1);
});
