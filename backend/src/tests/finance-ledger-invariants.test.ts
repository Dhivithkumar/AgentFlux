/**
 * PHASE 1 TEST SUITE: DOUBLE-ENTRY GENERAL LEDGER & SYSTEM ACCOUNT INVARIANTS
 *
 * Verifies against live PostgreSQL:
 * 1. Standard Chart of Accounts Seeding & Idempotency
 * 2. Invariant 1: Total Debits == Total Credits (Balanced entries pass, unbalanced entries rejected)
 * 3. Invariant 2: Non-negative amounts & single-direction line validation
 * 4. Invariant 3: Exact Decimal minor-unit precision without float drift
 * 5. Invariant 4: Accounting Period controls & lockdown enforcement
 * 6. Invariant 5: Idempotency keys & source document uniqueness
 * 7. Invariant 6: Immutability & Reversing Journal Entry mechanics
 * 8. Trial Balance Mathematical Equilibrium (Total Debits == Total Credits)
 */

import '../env';
import { prisma } from '@agent-flux/database';
import { accountService } from '../services/finance/AccountService';
import { ledgerService } from '../services/finance/LedgerService';
import { periodService } from '../services/finance/PeriodService';
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

async function runFinanceLedgerTests() {
  console.log('========================================================================');
  console.log('STARTING FINANCE CENTRE: DOUBLE-ENTRY LEDGER INVARIANTS TEST SUITE');
  console.log('========================================================================\n');

  const testBizId = `biz-fin-test-${Date.now()}`;
  const testUserId = `user-fin-test-${Date.now()}`;

  try {
    // 0. Setup isolated test business and user
    await prisma.user.create({
      data: {
        id: testUserId,
        name: 'Finance Controller',
        email: `controller-${Date.now()}@example.com`,
        passwordHash: 'hash'
      }
    });

    await prisma.business.create({
      data: {
        id: testBizId,
        name: 'Finance Invariants Test Business Ltd',
        industry: 'TECHNOLOGY',
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

    // TEST 1: Chart of Accounts Seeding & Idempotency
    try {
      const seed1 = await accountService.seedStandardAccounts(testBizId);
      assert.strictEqual(seed1.created, 13, 'Must create 13 standard accounts on initial seed');

      const accounts = await accountService.getAccounts(testBizId, true);
      assert.strictEqual(accounts.length, 13, 'Must retrieve 13 active accounts');

      const seed2 = await accountService.seedStandardAccounts(testBizId);
      assert.strictEqual(seed2.created, 0, 'Second seed must create 0 accounts (idempotent)');
      assert.strictEqual(seed2.existing, 13, 'Second seed must recognize all 13 existing accounts');

      record('TEST 1: Chart of Accounts Standard Seeding & Idempotency', true, '13 accounts created and idempotently verified');
    } catch (err: any) {
      record('TEST 1: Chart of Accounts Standard Seeding & Idempotency', false, undefined, err.message);
    }

    // Retrieve system accounts for subsequent tests
    const bankAcc = await accountService.getSystemAccount(testBizId, 'CASH_AND_BANK');
    const revenueAcc = await accountService.getSystemAccount(testBizId, 'OPERATING_REVENUE');
    const arAcc = await accountService.getSystemAccount(testBizId, 'ACCOUNTS_RECEIVABLE');
    const expenseAcc = await accountService.getSystemAccount(testBizId, 'OPERATING_EXPENSE');

    // TEST 2: Balanced Journal Entry Creation & Sequential Numbering
    let entry1Id = '';
    try {
      const entry = await ledgerService.createJournalEntry(
        testBizId,
        {
          memo: 'Customer subscription payment received',
          sourceType: 'CUSTOMER_PAYMENT',
          sourceId: 'pay-001',
          autoPost: true,
          lines: [
            { accountId: bankAcc.id, debit: 500.0, description: 'Debit Operating Bank' },
            { accountId: revenueAcc.id, credit: 500.0, description: 'Credit Sales Revenue' }
          ]
        },
        testUserId
      );

      assert.strictEqual(entry.status, 'POSTED', 'Entry must be POSTED');
      assert.ok(entry.entryNumber.startsWith('JE-'), 'Entry number must start with JE-');
      assert.strictEqual(Number(entry.totalDebit), 500.0, 'Total debit must be 500.00');
      assert.strictEqual(Number(entry.totalCredit), 500.0, 'Total credit must be 500.00');
      entry1Id = entry.id;

      record('TEST 2: Balanced Journal Entry & Sequential Numbering', true, `Created and posted ${entry.entryNumber}`);
    } catch (err: any) {
      record('TEST 2: Balanced Journal Entry & Sequential Numbering', false, undefined, err.message);
    }

    // TEST 3: Invariant 1 - Reject Unbalanced Journal Entry
    try {
      let threw = false;
      try {
        await ledgerService.createJournalEntry(
          testBizId,
          {
            memo: 'Unbalanced test entry',
            sourceType: 'MANUAL_JOURNAL',
            lines: [
              { accountId: bankAcc.id, debit: 500.0 },
              { accountId: revenueAcc.id, credit: 450.0 } // 50 discrepancy!
            ]
          },
          testUserId
        );
      } catch (err: any) {
        threw = true;
        assert.ok(err.message.includes('LEDGER_UNBALANCED'), `Expected LEDGER_UNBALANCED error, got: ${err.message}`);
      }
      assert.strictEqual(threw, true, 'Unbalanced entry must throw error');
      record('TEST 3: Invariant 1 - Unbalanced Entry Rejection', true, 'Correctly rejected with LEDGER_UNBALANCED');
    } catch (err: any) {
      record('TEST 3: Invariant 1 - Unbalanced Entry Rejection', false, undefined, err.message);
    }

    // TEST 4: Invariant 2 - Reject Negative Amounts & Ambiguous Lines
    try {
      let negativeThrew = false;
      try {
        await ledgerService.createJournalEntry(
          testBizId,
          {
            memo: 'Negative amount test',
            sourceType: 'MANUAL_JOURNAL',
            lines: [
              { accountId: bankAcc.id, debit: -100.0 },
              { accountId: revenueAcc.id, credit: -100.0 }
            ]
          },
          testUserId
        );
      } catch (err: any) {
        negativeThrew = true;
        assert.ok(err.message.includes('NEGATIVE_AMOUNT_REJECTED'), `Expected NEGATIVE_AMOUNT_REJECTED, got: ${err.message}`);
      }
      assert.strictEqual(negativeThrew, true, 'Negative line amounts must be rejected');

      let ambiguousThrew = false;
      try {
        await ledgerService.createJournalEntry(
          testBizId,
          {
            memo: 'Ambiguous line test',
            sourceType: 'MANUAL_JOURNAL',
            lines: [
              { accountId: bankAcc.id, debit: 100.0, credit: 50.0 },
              { accountId: revenueAcc.id, credit: 50.0 }
            ]
          },
          testUserId
        );
      } catch (err: any) {
        ambiguousThrew = true;
        assert.ok(err.message.includes('AMBIGUOUS_LINE_REJECTED'), `Expected AMBIGUOUS_LINE_REJECTED, got: ${err.message}`);
      }
      assert.strictEqual(ambiguousThrew, true, 'Both debit and credit on one line must be rejected');

      record('TEST 4: Invariant 2 - Non-negative & Single-Direction Line Validation', true, 'Negative and ambiguous lines rejected');
    } catch (err: any) {
      record('TEST 4: Invariant 2 - Non-negative & Single-Direction Line Validation', false, undefined, err.message);
    }

    // TEST 5: Invariant 3 - Exact Decimal Minor-Unit Arithmetic
    try {
      const decimalEntry = await ledgerService.createJournalEntry(
        testBizId,
        {
          memo: 'Exact decimal minor-unit test',
          sourceType: 'MANUAL_JOURNAL',
          autoPost: true,
          lines: [
            { accountId: bankAcc.id, debit: '123.4567' },
            { accountId: arAcc.id, credit: '123.4567' }
          ]
        },
        testUserId
      );

      assert.strictEqual(decimalEntry.totalDebit.toString(), '123.4567', 'Preserves 4-decimal precision');
      assert.strictEqual(decimalEntry.totalCredit.toString(), '123.4567', 'Preserves 4-decimal precision');
      record('TEST 5: Invariant 3 - Exact Decimal Minor-Unit Precision', true, '123.4567 debit and credit matched exactly');
    } catch (err: any) {
      record('TEST 5: Invariant 3 - Exact Decimal Minor-Unit Precision', false, undefined, err.message);
    }

    // TEST 6: Invariant 4 - Accounting Period Lockdown Enforcement
    try {
      const openPeriod = await periodService.getOrCreateOpenPeriodForDate(testBizId, new Date());
      assert.strictEqual(openPeriod.status, 'OPEN', 'Period must start as OPEN');

      // Lock the period
      await periodService.lockPeriod(testBizId, openPeriod.id, testUserId);

      let lockThrew = false;
      try {
        await ledgerService.createJournalEntry(
          testBizId,
          {
            memo: 'Should fail due to period lockdown',
            sourceType: 'MANUAL_JOURNAL',
            lines: [
              { accountId: bankAcc.id, debit: 50.0 },
              { accountId: revenueAcc.id, credit: 50.0 }
            ]
          },
          testUserId
        );
      } catch (err: any) {
        lockThrew = true;
        assert.ok(err.message.includes('PERIOD_LOCKED'), `Expected PERIOD_LOCKED, got: ${err.message}`);
      }
      assert.strictEqual(lockThrew, true, 'Posting to locked period must be prevented');

      // Reopen the period
      await periodService.reopenPeriod(testBizId, openPeriod.id, testUserId);

      // Verify posting succeeds once reopened
      const reopenedEntry = await ledgerService.createJournalEntry(
        testBizId,
        {
          memo: 'Posting after reopen',
          sourceType: 'MANUAL_JOURNAL',
          autoPost: true,
          lines: [
            { accountId: bankAcc.id, debit: 50.0 },
            { accountId: revenueAcc.id, credit: 50.0 }
          ]
        },
        testUserId
      );
      assert.strictEqual(reopenedEntry.status, 'POSTED');

      record('TEST 6: Invariant 4 - Period Lockdown & Reopen Enforcement', true, 'Period lockdown blocked entries, reopen restored posting');
    } catch (err: any) {
      record('TEST 6: Invariant 4 - Period Lockdown & Reopen Enforcement', false, undefined, err.message);
    }

    // TEST 7: Invariant 5 - Idempotency Guarantees
    try {
      const idempotencyKey = `idem-key-${Date.now()}`;
      const entryA = await ledgerService.createJournalEntry(
        testBizId,
        {
          idempotencyKey,
          memo: 'Idempotency test entry',
          sourceType: 'MANUAL_JOURNAL',
          autoPost: true,
          lines: [
            { accountId: bankAcc.id, debit: 200.0 },
            { accountId: revenueAcc.id, credit: 200.0 }
          ]
        },
        testUserId
      );

      // Repeat with same idempotency key
      const entryB = await ledgerService.createJournalEntry(
        testBizId,
        {
          idempotencyKey,
          memo: 'Duplicate attempt',
          sourceType: 'MANUAL_JOURNAL',
          autoPost: true,
          lines: [
            { accountId: bankAcc.id, debit: 200.0 },
            { accountId: revenueAcc.id, credit: 200.0 }
          ]
        },
        testUserId
      );

      assert.strictEqual(entryA.id, entryB.id, 'Must return the same journal entry ID');
      assert.strictEqual(entryA.entryNumber, entryB.entryNumber, 'Must have identical entry number');

      record('TEST 7: Invariant 5 - Idempotency Guarantees', true, 'Duplicate submission returned original entry without re-posting');
    } catch (err: any) {
      record('TEST 7: Invariant 5 - Idempotency Guarantees', false, undefined, err.message);
    }

    // TEST 8: Invariant 6 - Immutability & Reversal Journal Entry Mechanics
    try {
      const voidResult = await ledgerService.voidJournalEntry(
        testBizId,
        entry1Id,
        'Customer requested transaction cancellation',
        testUserId
      );

      assert.strictEqual(voidResult.status, 'REVERSED', 'Status must be REVERSED');
      assert.ok(voidResult.reversalEntry, 'Reversal entry must be created');
      assert.strictEqual(voidResult.reversalEntry.reversalOfEntryId, entry1Id, 'Reversal entry must link to original entry');
      assert.strictEqual(Number(voidResult.reversalEntry.totalDebit), 500.0, 'Reversal entry debit matches original');
      assert.strictEqual(Number(voidResult.reversalEntry.totalCredit), 500.0, 'Reversal entry credit matches original');

      // Verify that reversing lines are inverted
      const revLines = voidResult.reversalEntry.lines;
      const bankRevLine = revLines.find((l: any) => l.accountId === bankAcc.id);
      const revRevLine = revLines.find((l: any) => l.accountId === revenueAcc.id);

      assert.ok(bankRevLine, 'Bank reversal line must be present');
      assert.ok(revRevLine, 'Revenue reversal line must be present');
      assert.strictEqual(Number(bankRevLine!.credit), 500.0, 'Original bank debit inverted to credit');
      assert.strictEqual(Number(revRevLine!.debit), 500.0, 'Original revenue credit inverted to debit');

      record('TEST 8: Invariant 6 - Immutability & Reversal Journal Mechanics', true, `Posted entry reversed via ${voidResult.reversalEntry.entryNumber}`);
    } catch (err: any) {
      record('TEST 8: Invariant 6 - Immutability & Reversal Journal Mechanics', false, undefined, err.message);
    }

    // TEST 9: Trial Balance Mathematical Equilibrium
    try {
      const trialBalance = await ledgerService.getTrialBalance(testBizId);

      assert.strictEqual(trialBalance.isBalanced, true, 'Trial balance must be mathematically balanced');
      assert.strictEqual(trialBalance.difference, '0.00', 'Trial balance difference must be 0.00');
      assert.strictEqual(trialBalance.totalDebit, trialBalance.totalCredit, 'Grand total debit must equal grand total credit');

      record(
        'TEST 9: Trial Balance Mathematical Equilibrium',
        true,
        `Total Debits ($${trialBalance.totalDebit}) == Total Credits ($${trialBalance.totalCredit}), Difference: $${trialBalance.difference}`
      );
    } catch (err: any) {
      record('TEST 9: Trial Balance Mathematical Equilibrium', false, undefined, err.message);
    }

  } catch (globalErr: any) {
    console.error('Fatal test error:', globalErr);
  } finally {
    // Clean up test business and associated records respecting foreign keys
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
      await prisma.membership.deleteMany({ where: { businessId: testBizId } });
      await prisma.business.delete({ where: { id: testBizId } });
      await prisma.user.delete({ where: { id: testUserId } });
      console.log(`\n🧹 Cleaned up test business ${testBizId} and user ${testUserId}`);
    } catch (cleanupErr: any) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
  }

  console.log('\n========================================================================');
  console.log('FINANCE LEDGER TEST SUMMARY');
  console.log('========================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(`Results: ${passedCount}/${totalCount} tests passed.\n`);

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runFinanceLedgerTests().catch((err) => {
  console.error('Unhandled test execution failure:', err);
  process.exit(1);
});
