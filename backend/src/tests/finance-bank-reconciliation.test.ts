/**
 * PHASE 3 TEST SUITE: BANK FEED INGESTION & AUTOMATED RECONCILIATION ENGINE
 *
 * Verifies against live PostgreSQL:
 * 1. Bank Feed Account creation mapped to GL Asset Account (1010 Operating Bank)
 * 2. Bank statement transactions idempotent ingestion & duplicate deduplication
 * 3. Deterministic candidate matching engine with multi-factor confidence scoring
 * 4. Automated 1-to-1 reconciliation linking BankTransaction to JournalLine
 * 5. Manual match, unmatch, and exclusion workflows
 * 6. Bank Reconciliation Statement & Zero Variance Mathematical Verification
 */

import '../env';
import { prisma } from '@agent-flux/database';
import { accountService } from '../services/finance/AccountService';
import { ledgerService } from '../services/finance/LedgerService';
import { bankReconciliationService } from '../services/finance/BankReconciliationService';
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

async function runBankReconciliationTests() {
  console.log('========================================================================');
  console.log('STARTING PHASE 3 TEST SUITE: BANK FEED INGESTION & RECONCILIATION');
  console.log('========================================================================\n');

  const testBizId = `biz-bank-rec-${Date.now()}`;
  const testUserId = `user-bank-rec-${Date.now()}`;

  try {
    // 0. Setup isolated tenant records
    await prisma.user.create({
      data: {
        id: testUserId,
        name: 'Treasury Manager',
        email: `treasury-${Date.now()}@example.com`,
        passwordHash: 'hash'
      }
    });

    await prisma.business.create({
      data: {
        id: testBizId,
        name: 'NovaPay Global Technologies Inc',
        industry: 'Fintech & Payments',
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

    // Seed standard Chart of Accounts
    await accountService.seedStandardAccounts(testBizId);
    const bankGlAcc = await accountService.getSystemAccount(testBizId, 'CASH_AND_BANK');
    const arGlAcc = await accountService.getSystemAccount(testBizId, 'ACCOUNTS_RECEIVABLE');
    const feeGlAcc = await accountService.getSystemAccount(testBizId, 'OPERATING_EXPENSE');

    // TEST 1: Bank Feed Account Setup
    let feedAccountId = '';
    try {
      const feedAccount = await bankReconciliationService.createBankFeedAccount(testBizId, {
        accountId: bankGlAcc.id,
        institutionName: 'HDFC Bank',
        accountNumberMask: '•••• 4829',
        currency: 'INR'
      });

      assert.ok(feedAccount.id, 'Must generate feed account ID');
      assert.strictEqual(feedAccount.accountId, bankGlAcc.id, 'Must map to Operating Bank GL account');
      assert.strictEqual(feedAccount.institutionName, 'HDFC Bank');
      feedAccountId = feedAccount.id;

      record('TEST 1: Bank Feed Account Setup', true, `Linked ${feedAccount.institutionName} to GL Account ${bankGlAcc.code}`);
    } catch (err: any) {
      record('TEST 1: Bank Feed Account Setup', false, undefined, err.message);
    }

    // TEST 2: Bank Statement Ingestion & Deduplication
    let tx1Id = '';
    let tx2Id = '';
    let tx3Id = '';
    try {
      const rawTransactions = [
        {
          transactionDate: new Date('2026-10-05T10:00:00Z'),
          amount: '1144.60', // Deposit
          description: 'STRIPE PAYOUT BATCH 001',
          referenceNumber: 'STRIPE-001'
        },
        {
          transactionDate: new Date('2026-10-06T14:30:00Z'),
          amount: '-150.00', // Withdrawal
          description: 'AMAZON WEB SERVICES CLOUD HOSTING',
          referenceNumber: 'AWS-99'
        },
        {
          transactionDate: new Date('2026-10-07T09:15:00Z'),
          amount: '200.00', // Deposit without match in GL
          description: 'FOUNDER DIRECT CASH INJECTION',
          referenceNumber: 'DIR-CASH-1'
        }
      ];

      const ingest1 = await bankReconciliationService.ingestTransactions(testBizId, feedAccountId, rawTransactions);
      assert.strictEqual(ingest1.inserted, 3, 'Must insert 3 statement lines');

      // Idempotency check: re-ingest same batch
      const ingest2 = await bankReconciliationService.ingestTransactions(testBizId, feedAccountId, rawTransactions);
      assert.strictEqual(ingest2.inserted, 3, 'Upsert handles deduplication');

      const txs = await prisma.bankTransaction.findMany({
        where: { bankFeedAccountId: feedAccountId },
        orderBy: { transactionDate: 'asc' }
      });
      assert.strictEqual(txs.length, 3, 'Must have exactly 3 bank transactions');
      tx1Id = txs[0].id;
      tx2Id = txs[1].id;
      tx3Id = txs[2].id;

      record('TEST 2: Bank Statement Ingestion & Deduplication', true, `Ingested 3 statement transactions (2 deposits, 1 withdrawal)`);
    } catch (err: any) {
      record('TEST 2: Bank Statement Ingestion & Deduplication', false, undefined, err.message);
    }

    // TEST 3: Post Corresponding General Ledger Entries
    let glLine1Id = '';
    let glLine2Id = '';
    try {
      // Entry 1: Stripe settlement (DR Bank $1144.60, DR Gateway Fee $35.40, CR AR $1180.00)
      const je1 = await ledgerService.createJournalEntry(
        testBizId,
        {
          postingDate: new Date('2026-10-05T11:00:00Z'),
          memo: 'Stripe payout settlement STRIPE-001',
          sourceType: 'CUSTOMER_PAYMENT',
          sourceId: 'pay-rec-1',
          autoPost: true,
          lines: [
            { accountId: bankGlAcc.id, debit: 1144.60, description: 'Bank deposit STRIPE-001' },
            { accountId: feeGlAcc.id, debit: 35.40, description: 'Gateway processing fee' },
            { accountId: arGlAcc.id, credit: 1180.00, description: 'AR settlement' }
          ]
        },
        testUserId
      );

      const bankLine1 = je1.lines.find((l: any) => l.accountId === bankGlAcc.id);
      assert.ok(bankLine1, 'Bank line 1 must exist');
      glLine1Id = bankLine1!.id;

      // Entry 2: AWS Cloud hosting payment (DR Operating Expense $150.00, CR Bank $150.00)
      const je2 = await ledgerService.createJournalEntry(
        testBizId,
        {
          postingDate: new Date('2026-10-06T15:00:00Z'),
          memo: 'Monthly cloud hosting AWS-99',
          sourceType: 'MANUAL_JOURNAL',
          sourceId: 'exp-aws-99',
          autoPost: true,
          lines: [
            { accountId: feeGlAcc.id, debit: 150.00, description: 'AWS Hosting expense' },
            { accountId: bankGlAcc.id, credit: 150.00, description: 'Bank withdrawal AWS-99' }
          ]
        },
        testUserId
      );

      const bankLine2 = je2.lines.find((l: any) => l.accountId === bankGlAcc.id);
      assert.ok(bankLine2, 'Bank line 2 must exist');
      glLine2Id = bankLine2!.id;

      record('TEST 3: Post Corresponding General Ledger Entries', true, `Posted GL entries: ${je1.entryNumber} and ${je2.entryNumber}`);
    } catch (err: any) {
      record('TEST 3: Post Corresponding General Ledger Entries', false, undefined, err.message);
    }

    // TEST 4: Candidate Matching Heuristics & Confidence Scoring
    try {
      const candidates = await bankReconciliationService.findMatchCandidates(testBizId, feedAccountId);
      assert.ok(candidates.length >= 2, 'Must detect at least 2 match candidates');

      const match1 = candidates.find((c) => c.bankTransactionId === tx1Id && c.journalLineId === glLine1Id);
      assert.ok(match1, 'Must find candidate match for Stripe deposit');
      assert.ok(match1!.confidenceScore >= 90, `Stripe deposit confidence must be >= 90, got: ${match1!.confidenceScore}`);

      const match2 = candidates.find((c) => c.bankTransactionId === tx2Id && c.journalLineId === glLine2Id);
      assert.ok(match2, 'Must find candidate match for AWS withdrawal');
      assert.ok(match2!.confidenceScore >= 90, `AWS withdrawal confidence must be >= 90, got: ${match2!.confidenceScore}`);

      // Transaction 3 (founder cash injection) must NOT match either GL entry
      const match3 = candidates.find((c) => c.bankTransactionId === tx3Id);
      assert.strictEqual(match3, undefined, 'Unmatched transaction 3 must have no GL candidates');

      record('TEST 4: Candidate Matching Heuristics & Scoring', true, `High-confidence matches detected: ${match1!.confidenceScore}% (Deposit), ${match2!.confidenceScore}% (Withdrawal)`);
    } catch (err: any) {
      record('TEST 4: Candidate Matching Heuristics & Scoring', false, undefined, err.message);
    }

    // TEST 5: Automated Reconciliation Execution
    try {
      const autoResult = await bankReconciliationService.autoReconcile(testBizId, feedAccountId, 90, testUserId);
      assert.strictEqual(autoResult.matchedCount, 2, 'Must auto-reconcile exactly 2 matched pairs');
      assert.strictEqual(autoResult.unmatchedCount, 1, 'Must have 1 remaining unmatched transaction (tx3)');

      // Verify records in DB
      const dbTx1 = await prisma.bankTransaction.findUnique({ where: { id: tx1Id }, include: { match: true } });
      const dbTx2 = await prisma.bankTransaction.findUnique({ where: { id: tx2Id }, include: { match: true } });
      assert.strictEqual(dbTx1!.status, 'MATCHED');
      assert.strictEqual(dbTx2!.status, 'MATCHED');
      assert.strictEqual(dbTx1!.match?.journalLineId, glLine1Id);
      assert.strictEqual(dbTx2!.match?.journalLineId, glLine2Id);

      record('TEST 5: Automated Reconciliation Execution', true, '2 transactions reconciled atomically with BankTransactionMatch records');
    } catch (err: any) {
      record('TEST 5: Automated Reconciliation Execution', false, undefined, err.message);
    }

    // TEST 6: Manual Match & Unmatch Workflows
    try {
      // Unmatch tx1
      const unmatchResult = await bankReconciliationService.unmatch(testBizId, tx1Id, testUserId);
      assert.strictEqual(unmatchResult.status, 'UNMATCHED_SUCCESS');

      const dbTx1AfterUnmatch = await prisma.bankTransaction.findUnique({ where: { id: tx1Id }, include: { match: true } });
      assert.strictEqual(dbTx1AfterUnmatch!.status, 'UNMATCHED');
      assert.strictEqual(dbTx1AfterUnmatch!.match, null);

      // Manually re-match tx1
      const manualMatchResult = await bankReconciliationService.manualMatch(testBizId, tx1Id, glLine1Id, testUserId);
      assert.ok(manualMatchResult.id, 'Manual match must generate match ID');

      const dbTx1AfterRematch = await prisma.bankTransaction.findUnique({ where: { id: tx1Id }, include: { match: true } });
      assert.strictEqual(dbTx1AfterRematch!.status, 'MATCHED');

      record('TEST 6: Manual Match & Unmatch Workflows', true, 'Successfully verified unmatch and manual re-match controls');
    } catch (err: any) {
      record('TEST 6: Manual Match & Unmatch Workflows', false, undefined, err.message);
    }

    // TEST 7: Transaction Exclusion Controls
    try {
      const excludeResult = await bankReconciliationService.excludeTransaction(
        testBizId,
        tx3Id,
        'Non-operational founder cash injection excluded from revenue reconciliation',
        testUserId
      );
      assert.strictEqual(excludeResult.status, 'EXCLUDED');

      record('TEST 7: Transaction Exclusion Controls', true, 'Excluded non-operational transaction with audit reason');
    } catch (err: any) {
      record('TEST 7: Transaction Exclusion Controls', false, undefined, err.message);
    }

    // TEST 8: Bank Reconciliation Statement & Zero Variance Verification
    try {
      const report = await bankReconciliationService.getReconciliationReport(testBizId, feedAccountId);

      // Statement balance: Deposit $1144.60 - Withdrawal $150.00 = $994.60
      assert.strictEqual(report.summary.statementBalance, '994.60');
      // GL balance: Debit $1144.60 - Credit $150.00 = $994.60
      assert.strictEqual(report.summary.ledgerBalance, '994.60');
      // Variance must be exactly 0.00
      assert.strictEqual(report.summary.variance, '0.00');
      assert.strictEqual(report.summary.isReconciled, true, 'Report must assert isReconciled = true');
      assert.strictEqual(report.counts.matchedCount, 2);
      assert.strictEqual(report.counts.excludedCount, 1);
      assert.strictEqual(report.counts.unmatchedCount, 0);

      record(
        'TEST 8: Bank Reconciliation Statement & Zero Variance Verification',
        true,
        `Statement Balance ($${report.summary.statementBalance}) == GL Balance ($${report.summary.ledgerBalance}), Variance: $${report.summary.variance}`
      );
    } catch (err: any) {
      record('TEST 8: Bank Reconciliation Statement & Zero Variance Verification', false, undefined, err.message);
    }

  } catch (globalErr: any) {
    console.error('Fatal test error:', globalErr);
  } finally {
    // Teardown test business and associated records
    try {
      await prisma.bankTransactionMatch.deleteMany({
        where: { bankTransaction: { bankFeedAccount: { businessId: testBizId } } }
      });
      await prisma.bankTransaction.deleteMany({
        where: { bankFeedAccount: { businessId: testBizId } }
      });
      await prisma.bankFeedAccount.deleteMany({ where: { businessId: testBizId } });
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
      await prisma.membership.deleteMany({ where: { businessId: testBizId } });
      await prisma.business.delete({ where: { id: testBizId } });
      await prisma.user.delete({ where: { id: testUserId } });
      console.log(`\n🧹 Cleaned up test business ${testBizId} and user ${testUserId}`);
    } catch (cleanupErr: any) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
  }

  console.log('\n========================================================================');
  console.log('BANK RECONCILIATION TEST SUMMARY');
  console.log('========================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(`Results: ${passedCount}/${totalCount} tests passed.\n`);

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runBankReconciliationTests().catch((err) => {
  console.error('Unhandled test execution failure:', err);
  process.exit(1);
});
