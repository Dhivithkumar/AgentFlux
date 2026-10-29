/**
 * PHASE 4 TEST SUITE: REAL-TIME FINANCIAL STATEMENTS & REPORTING ENGINE
 *
 * Verifies against live PostgreSQL:
 * 1. Real-Time Balance Sheet: Assets = Liabilities + Equity (Mathematical equilibrium)
 * 2. Dynamic Retained Earnings & Net Income roll-forward into Balance Sheet Equity
 * 3. Profit & Loss Statement: Revenue - COGS = Gross Profit; Gross Profit - OpEx = Net Profit
 * 4. Exact Margin Percentages (Gross Margin %, Net Margin %)
 * 5. Direct Cash Flow Statement: Inflows, Outflows, and Closing Balance alignment with Balance Sheet
 * 6. General Ledger Account Activity drilldown with running balance verification
 */

import '../env';
import { prisma } from '@agent-flux/database';
import { accountService } from '../services/finance/AccountService';
import { ledgerService } from '../services/finance/LedgerService';
import { financialReportingService } from '../services/finance/FinancialReportingService';
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

async function runFinancialReportingTests() {
  console.log('========================================================================');
  console.log('STARTING PHASE 4 TEST SUITE: FINANCIAL STATEMENTS & REPORTING ENGINE');
  console.log('========================================================================\n');

  const testBizId = `biz-fin-rep-${Date.now()}`;
  const testUserId = `user-fin-rep-${Date.now()}`;

  try {
    // 0. Setup isolated tenant records
    await prisma.user.create({
      data: {
        id: testUserId,
        name: 'Chief Financial Officer',
        email: `cfo-${Date.now()}@example.com`,
        passwordHash: 'hash'
      }
    });

    await prisma.business.create({
      data: {
        id: testBizId,
        name: 'AeroDynamics Enterprise Corp',
        industry: 'Aerospace & Defense',
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

    // Seed standard chart of accounts
    await accountService.seedStandardAccounts(testBizId);
    const bankGl = await accountService.getSystemAccount(testBizId, 'CASH_AND_BANK');
    const arGl = await accountService.getSystemAccount(testBizId, 'ACCOUNTS_RECEIVABLE');
    const apGl = await accountService.getSystemAccount(testBizId, 'ACCOUNTS_PAYABLE');
    const taxGl = await accountService.getSystemAccount(testBizId, 'TAX_PAYABLE');
    const revGl = await accountService.getSystemAccount(testBizId, 'OPERATING_REVENUE');
    const cogsGl = await accountService.getSystemAccount(testBizId, 'COST_OF_GOODS_SOLD');
    const feeGl = await accountService.getSystemAccount(testBizId, 'OPERATING_EXPENSE');

    // Post test transactions spanning revenue, tax, payment, procurement, and settlement
    // Transaction 1: Customer Invoice ($1000 Revenue, $180 Tax Payable, $1180 AR)
    await ledgerService.createJournalEntry(
      testBizId,
      {
        postingDate: new Date('2026-10-01T10:00:00Z'),
        memo: 'Enterprise client invoice INV-001',
        sourceType: 'CUSTOMER_INVOICE',
        sourceId: 'inv-rep-1',
        autoPost: true,
        lines: [
          { accountId: arGl.id, debit: 1180.0, description: 'AR Invoice INV-001' },
          { accountId: revGl.id, credit: 1000.0, description: 'Software license revenue' },
          { accountId: taxGl.id, credit: 180.0, description: 'GST / Output tax payable' }
        ]
      },
      testUserId
    );

    // Transaction 2: Customer Payment Receipt ($1144.60 net bank, $35.40 gateway fee, $1180 AR cleared)
    await ledgerService.createJournalEntry(
      testBizId,
      {
        postingDate: new Date('2026-10-02T12:00:00Z'),
        memo: 'Customer payment collection PAY-001',
        sourceType: 'CUSTOMER_PAYMENT',
        sourceId: 'pay-rep-1',
        autoPost: true,
        lines: [
          { accountId: bankGl.id, debit: 1144.60, description: 'Net Stripe payout' },
          { accountId: feeGl.id, debit: 35.40, description: 'Stripe gateway fee' },
          { accountId: arGl.id, credit: 1180.0, description: 'AR settlement' }
        ]
      },
      testUserId
    );

    // Transaction 3: Direct Procurement / Vendor Bill ($300 COGS, $300 AP)
    await ledgerService.createJournalEntry(
      testBizId,
      {
        postingDate: new Date('2026-10-03T14:00:00Z'),
        memo: 'Procurement raw parts BILL-001',
        sourceType: 'VENDOR_BILL',
        sourceId: 'bill-rep-1',
        autoPost: true,
        lines: [
          { accountId: cogsGl.id, debit: 300.0, description: 'Direct parts procurement' },
          { accountId: apGl.id, credit: 300.0, description: 'Vendor payable' }
        ]
      },
      testUserId
    );

    // Transaction 4: Supplier AP Payment ($300 AP cleared, $300 Bank withdrawal)
    await ledgerService.createJournalEntry(
      testBizId,
      {
        postingDate: new Date('2026-10-04T16:00:00Z'),
        memo: 'Vendor bill settlement PAY-VEND-001',
        sourceType: 'VENDOR_PAYMENT',
        sourceId: 'vpay-rep-1',
        autoPost: true,
        lines: [
          { accountId: apGl.id, debit: 300.0, description: 'Vendor payable cleared' },
          { accountId: bankGl.id, credit: 300.0, description: 'Bank transfer to vendor' }
        ]
      },
      testUserId
    );

    // TEST 1: Profit and Loss Statement Accuracy
    try {
      const pnl = await financialReportingService.getProfitAndLoss(
        testBizId,
        new Date('2026-10-01'),
        new Date('2026-10-31')
      );

      assert.strictEqual(pnl.revenue.totalRevenue, '1000.00', 'Total revenue must be $1000.00');
      assert.strictEqual(pnl.costOfGoodsSold.totalCogs, '300.00', 'Total COGS must be $300.00');
      assert.strictEqual(pnl.grossProfit, '700.00', 'Gross Profit must be $700.00');
      assert.strictEqual(pnl.grossMarginPercentage, '70.00%', 'Gross Margin must be 70.00%');
      assert.strictEqual(pnl.operatingExpenses.totalOperatingExpenses, '35.40', 'Operating expenses must be $35.40');
      assert.strictEqual(pnl.netOperatingIncome, '664.60', 'Net Operating Income must be $664.60');
      assert.strictEqual(pnl.netIncome, '664.60', 'Net Income must be $664.60');
      assert.strictEqual(pnl.netMarginPercentage, '66.46%', 'Net Margin must be 66.46%');

      record(
        'TEST 1: Profit and Loss Statement Accuracy',
        true,
        `Revenue: $${pnl.revenue.totalRevenue}, COGS: $${pnl.costOfGoodsSold.totalCogs}, Gross: $${pnl.grossProfit} (${pnl.grossMarginPercentage}), Net: $${pnl.netIncome} (${pnl.netMarginPercentage})`
      );
    } catch (err: any) {
      record('TEST 1: Profit and Loss Statement Accuracy', false, undefined, err.message);
    }

    // TEST 2: Real-Time Balance Sheet & Accounting Equation (Assets = Liabilities + Equity)
    try {
      const bs = await financialReportingService.getBalanceSheet(testBizId, new Date('2026-10-31'));

      // Assets: Bank ($844.60) + AR ($0.00) = $844.60
      assert.strictEqual(bs.assets.totalAssets, '844.60', 'Total Assets must be $844.60');

      // Liabilities: Tax Payable ($180.00) + AP ($0.00) = $180.00
      assert.strictEqual(bs.liabilities.totalLiabilities, '180.00', 'Total Liabilities must be $180.00');

      // Equity: Current Period Net Income ($664.60)
      assert.strictEqual(bs.equity.currentPeriodNetIncome, '664.60', 'Current period net income must be $664.60');
      assert.strictEqual(bs.equity.totalEquity, '664.60', 'Total equity must be $664.60');

      // Total Liabilities + Equity = $180.00 + $664.60 = $844.60
      assert.strictEqual(bs.totalLiabilitiesAndEquity, '844.60', 'Total Liabilities and Equity must be $844.60');

      // Fundamental equation balance test
      assert.strictEqual(bs.isBalanced, true, 'Balance sheet must be balanced');
      assert.strictEqual(bs.variance, '0.00', 'Variance between Assets and Liabilities + Equity must be exactly 0.00');

      record(
        'TEST 2: Real-Time Balance Sheet Equilibrium (Assets = Liabilities + Equity)',
        true,
        `Assets: $${bs.assets.totalAssets} == Liabilities ($${bs.liabilities.totalLiabilities}) + Equity ($${bs.equity.totalEquity}), Variance: $${bs.variance}`
      );
    } catch (err: any) {
      record('TEST 2: Real-Time Balance Sheet Equilibrium (Assets = Liabilities + Equity)', false, undefined, err.message);
    }

    // TEST 3: Cash Flow Statement Reconciled to Balance Sheet
    try {
      const cf = await financialReportingService.getCashFlowStatement(
        testBizId,
        new Date('2026-10-01'),
        new Date('2026-10-31')
      );

      assert.strictEqual(cf.openingCashBalance, '0.00', 'Opening cash balance must be $0.00');
      assert.strictEqual(cf.operatingActivities.cashFromCustomers, '1144.60', 'Cash from customers must be $1144.60');
      assert.strictEqual(cf.operatingActivities.cashPaidForExpensesAndVendors, '300.00', 'Cash paid for vendors must be $300.00');
      assert.strictEqual(cf.operatingActivities.netOperatingCashFlow, '844.60', 'Net operating cash flow must be $844.60');
      assert.strictEqual(cf.closingCashBalance, '844.60', 'Closing cash balance must match Bank asset on Balance Sheet ($844.60)');
      assert.strictEqual(cf.reconciledWithBalanceSheet, true, 'Must report reconciled with Balance Sheet');

      record(
        'TEST 3: Direct Cash Flow Statement Verification',
        true,
        `Opening: $${cf.openingCashBalance}, Inflows: $${cf.operatingActivities.cashFromCustomers}, Outflows: $${cf.operatingActivities.cashPaidForExpensesAndVendors}, Closing: $${cf.closingCashBalance}`
      );
    } catch (err: any) {
      record('TEST 3: Direct Cash Flow Statement Verification', false, undefined, err.message);
    }

    // TEST 4: General Ledger Account Activity Drilldown & Running Balance
    try {
      const activity = await financialReportingService.getAccountActivity(
        testBizId,
        bankGl.id,
        new Date('2026-10-01'),
        new Date('2026-10-31')
      );

      assert.strictEqual(activity.openingBalance, '0.00', 'Opening balance must be $0.00');
      assert.strictEqual(activity.lines.length, 2, 'Bank account must have exactly 2 transactions');

      // Line 1: Deposit $1144.60 -> Running balance $1144.60
      assert.strictEqual(activity.lines[0].debit, '1144.60');
      assert.strictEqual(activity.lines[0].credit, '0.00');
      assert.strictEqual(activity.lines[0].runningBalance, '1144.60');

      // Line 2: Withdrawal $300.00 -> Running balance $844.60
      assert.strictEqual(activity.lines[1].debit, '0.00');
      assert.strictEqual(activity.lines[1].credit, '300.00');
      assert.strictEqual(activity.lines[1].runningBalance, '844.60');

      assert.strictEqual(activity.totalDebits, '1144.60');
      assert.strictEqual(activity.totalCredits, '300.00');
      assert.strictEqual(activity.netChange, '844.60');
      assert.strictEqual(activity.closingBalance, '844.60');

      record(
        'TEST 4: General Ledger Account Drilldown & Running Balance',
        true,
        `Opening: $${activity.openingBalance}, Line 1 (+1144.60 -> $1144.60), Line 2 (-300.00 -> $844.60), Closing: $${activity.closingBalance}`
      );
    } catch (err: any) {
      record('TEST 4: General Ledger Account Drilldown & Running Balance', false, undefined, err.message);
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
      await prisma.membership.deleteMany({ where: { businessId: testBizId } });
      await prisma.business.delete({ where: { id: testBizId } });
      await prisma.user.delete({ where: { id: testUserId } });
      console.log(`\n🧹 Cleaned up test business ${testBizId} and user ${testUserId}`);
    } catch (cleanupErr: any) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
  }

  console.log('\n========================================================================');
  console.log('FINANCIAL REPORTING TEST SUMMARY');
  console.log('========================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(`Results: ${passedCount}/${totalCount} tests passed.\n`);

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runFinancialReportingTests().catch((err) => {
  console.error('Unhandled test execution failure:', err);
  process.exit(1);
});
