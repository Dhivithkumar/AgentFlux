import { Router } from 'express';
import { authenticate, requireBusinessMembership, AuthRequest } from '../middleware/auth';
import { accountService } from '../services/finance/AccountService';
import { ledgerService } from '../services/finance/LedgerService';
import { periodService } from '../services/finance/PeriodService';
import { ledgerSyncService } from '../services/finance/LedgerSyncService';
import { bankReconciliationService } from '../services/finance/BankReconciliationService';
import { financialReportingService } from '../services/finance/FinancialReportingService';
import { financialExportService } from '../services/finance/FinancialExportService';
import { PeriodStatus, JournalEntryStatus, SourceDocumentType } from '@agent-flux/database';

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use(requireBusinessMembership);

// -------------------------------------------------------------
// Chart of Accounts Endpoints
// -------------------------------------------------------------

router.get('/accounts', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const includeBalance = req.query.includeBalance === 'true';
    const accounts = await accountService.getAccounts(businessId, includeBalance);
    res.json({ success: true, data: accounts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/accounts/seed', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const result = await accountService.seedStandardAccounts(businessId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/accounts', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const account = await accountService.createAccount(businessId, req.body);
    res.status(201).json({ success: true, data: account });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// Accounting Periods Endpoints
// -------------------------------------------------------------

router.get('/periods', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const status = req.query.status as PeriodStatus | undefined;
    const periods = await periodService.getPeriods(businessId, status);
    res.json({ success: true, data: periods });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/periods/:id', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const period = await periodService.getPeriodById(businessId, id);
    if (!period) {
      return res.status(404).json({ success: false, error: 'Period not found' });
    }
    res.json({ success: true, data: period });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/periods/:id/lock', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const updated = await periodService.lockPeriod(businessId, id, req.user?.id);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/periods/:id/close', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const closed = await periodService.closePeriod(businessId, id, req.user?.id);
    res.json({ success: true, data: closed });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/periods/:id/reopen', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const reopened = await periodService.reopenPeriod(businessId, id, req.user?.id);
    res.json({ success: true, data: reopened });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// Journal Entries Endpoints
// -------------------------------------------------------------

router.get('/journal-entries', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const {
      status,
      sourceType,
      sourceId,
      accountId,
      periodId,
      startDate,
      endDate,
      limit,
      offset
    } = req.query;

    const result = await ledgerService.getJournalEntries(businessId, {
      status: status as JournalEntryStatus,
      sourceType: sourceType as SourceDocumentType,
      sourceId: sourceId as string,
      accountId: accountId as string,
      periodId: periodId as string,
      startDate: startDate as string,
      endDate: endDate as string,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/journal-entries', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const entry = await ledgerService.createJournalEntry(businessId, req.body, req.user?.id);
    res.status(201).json({ success: true, data: entry });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/journal-entries/:id', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const entry = await ledgerService.getJournalEntryById(businessId, id);
    if (!entry) {
      return res.status(404).json({ success: false, error: 'Journal entry not found' });
    }
    res.json({ success: true, data: entry });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/journal-entries/:id/post', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const posted = await ledgerService.postJournalEntry(businessId, id, req.user?.id);
    res.json({ success: true, data: posted });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/journal-entries/:id/void', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, error: 'Void reason is required' });
    }
    const result = await ledgerService.voidJournalEntry(businessId, id, reason, req.user?.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// Trial Balance & Audit Reports
// -------------------------------------------------------------

router.get('/trial-balance', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : undefined;
    const trialBalance = await ledgerService.getTrialBalance(businessId, asOfDate);
    res.json({ success: true, data: trialBalance });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// Operational Subledger Synchronisation Endpoints
// -------------------------------------------------------------

router.post('/sync/invoices/:id', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const result = await ledgerSyncService.syncInvoiceToLedger(businessId, id, req.user?.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/sync/payments/:id', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const result = await ledgerSyncService.syncPaymentToLedger(businessId, id, req.user?.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/sync/batch', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const result = await ledgerSyncService.batchSyncOperationalRecords(businessId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// Bank Feeds & Automated Reconciliation Endpoints
// -------------------------------------------------------------

router.get('/bank-feeds', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const feeds = await bankReconciliationService.getBankFeedAccounts(businessId);
    res.json({ success: true, data: feeds });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/bank-feeds', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const feed = await bankReconciliationService.createBankFeedAccount(businessId, req.body);
    res.status(201).json({ success: true, data: feed });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/bank-feeds/:id/transactions', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const { transactions } = req.body;
    if (!Array.isArray(transactions)) {
      return res.status(400).json({ success: false, error: 'Transactions must be an array' });
    }
    const result = await bankReconciliationService.ingestTransactions(businessId, id, transactions);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/bank-feeds/:id/candidates', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const maxDays = req.query.maxDays ? parseInt(req.query.maxDays as string, 10) : 7;
    const candidates = await bankReconciliationService.findMatchCandidates(businessId, id, maxDays);
    res.json({ success: true, data: candidates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/bank-feeds/:id/auto-reconcile', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const threshold = req.body.threshold ? Number(req.body.threshold) : 90;
    const result = await bankReconciliationService.autoReconcile(businessId, id, threshold, req.user?.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/bank-feeds/:id/manual-match', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const { bankTransactionId, journalLineId } = req.body;
    if (!bankTransactionId || !journalLineId) {
      return res.status(400).json({ success: false, error: 'bankTransactionId and journalLineId are required' });
    }
    const match = await bankReconciliationService.manualMatch(
      businessId,
      bankTransactionId,
      journalLineId,
      req.user?.id
    );
    res.json({ success: true, data: match });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/bank-feeds/:id/unmatch', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const { bankTransactionId } = req.body;
    if (!bankTransactionId) {
      return res.status(400).json({ success: false, error: 'bankTransactionId is required' });
    }
    const result = await bankReconciliationService.unmatch(businessId, bankTransactionId, req.user?.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/bank-feeds/:id/exclude', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const { bankTransactionId, reason } = req.body;
    if (!bankTransactionId) {
      return res.status(400).json({ success: false, error: 'bankTransactionId is required' });
    }
    const result = await bankReconciliationService.excludeTransaction(
      businessId,
      bankTransactionId,
      reason || 'Excluded by operator',
      req.user?.id
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/bank-feeds/:id/report', async (req: AuthRequest, res) => {
  try {
    const { businessId, id } = req.params;
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : undefined;
    const report = await bankReconciliationService.getReconciliationReport(businessId, id, asOfDate);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// Real-Time Financial Statements & Reporting Endpoints
// -------------------------------------------------------------

router.get('/reports/balance-sheet', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : undefined;
    const report = await financialReportingService.getBalanceSheet(businessId, asOfDate);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/reports/profit-and-loss', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const report = await financialReportingService.getProfitAndLoss(businessId, startDate, endDate);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/reports/cash-flow', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const report = await financialReportingService.getCashFlowStatement(businessId, startDate, endDate);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/reports/account-activity/:accountId', async (req: AuthRequest, res) => {
  try {
    const { businessId, accountId } = req.params;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const report = await financialReportingService.getAccountActivity(businessId, accountId, startDate, endDate);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// Financial Document & Audit Pack Exports (PDF & CSV)
// -------------------------------------------------------------

router.get('/export/balance-sheet', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const format = ((req.query.format as string) || 'pdf').toLowerCase();
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : new Date();
    const dateStr = asOfDate.toISOString().split('T')[0];

    if (format === 'csv') {
      const csv = await financialExportService.exportBalanceSheetCsv(businessId, asOfDate);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Balance_Sheet_${dateStr}.csv"`);
      return res.send(csv);
    } else {
      const pdfBuffer = await financialExportService.exportBalanceSheetPdf(businessId, asOfDate);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Balance_Sheet_${dateStr}.pdf"`);
      return res.send(pdfBuffer);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/export/profit-loss', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const format = ((req.query.format as string) || 'pdf').toLowerCase();
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const dateStr = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      const csv = await financialExportService.exportProfitAndLossCsv(businessId, { startDate, endDate });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Profit_and_Loss_${dateStr}.csv"`);
      return res.send(csv);
    } else {
      const pdfBuffer = await financialExportService.exportProfitAndLossPdf(businessId, { startDate, endDate });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Profit_and_Loss_${dateStr}.pdf"`);
      return res.send(pdfBuffer);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/export/trial-balance', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const format = ((req.query.format as string) || 'pdf').toLowerCase();
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : new Date();
    const dateStr = asOfDate.toISOString().split('T')[0];

    if (format === 'csv') {
      const csv = await financialExportService.exportTrialBalanceCsv(businessId, asOfDate);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Trial_Balance_${dateStr}.csv"`);
      return res.send(csv);
    } else {
      const pdfBuffer = await financialExportService.exportTrialBalancePdf(businessId, asOfDate);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Trial_Balance_${dateStr}.pdf"`);
      return res.send(pdfBuffer);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/export/cash-flow', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const format = ((req.query.format as string) || 'pdf').toLowerCase();
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const dateStr = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      const csv = await financialExportService.exportCashFlowCsv(businessId, { startDate, endDate });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Cash_Flow_${dateStr}.csv"`);
      return res.send(csv);
    } else {
      const pdfBuffer = await financialExportService.exportCashFlowPdf(businessId, { startDate, endDate });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Cash_Flow_${dateStr}.pdf"`);
      return res.send(pdfBuffer);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/export/reconciliation/:bankAccountId', async (req: AuthRequest, res) => {
  try {
    const { businessId, bankAccountId } = req.params;
    const format = ((req.query.format as string) || 'pdf').toLowerCase();
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : new Date();
    const dateStr = asOfDate.toISOString().split('T')[0];

    if (format === 'csv') {
      const csv = await financialExportService.exportReconciliationCsv(businessId, bankAccountId, asOfDate);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Bank_Reconciliation_${dateStr}.csv"`);
      return res.send(csv);
    } else {
      const pdfBuffer = await financialExportService.exportReconciliationPdf(businessId, bankAccountId, asOfDate);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Bank_Reconciliation_${dateStr}.pdf"`);
      return res.send(pdfBuffer);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
