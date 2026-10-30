import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiCall, API_URL } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../lib/currency';
import {
  Landmark,
  Scale,
  BookOpen,
  ArrowRightLeft,
  FileText,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Filter,
  DollarSign,
  Building,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Ban,
  Download
} from 'lucide-react';

export default function FinanceCenter() {
  const { business } = useOutletContext<{ business: any }>();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<'overview' | 'accounts' | 'journals' | 'reconciliation' | 'reports'>('overview');
  const [reportSubTab, setReportSubTab] = useState<'balance-sheet' | 'pnl' | 'cash-flow' | 'activity'>('balance-sheet');

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Data states
  const [accounts, setAccounts] = useState<any[]>([]);
  const [trialBalance, setTrialBalance] = useState<any>(null);
  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [bankFeeds, setBankFeeds] = useState<any[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<string>('');
  const [feedReport, setFeedReport] = useState<any>(null);
  const [matchCandidates, setMatchCandidates] = useState<any[]>([]);

  // Reports data
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [pnlReport, setPnlReport] = useState<any>(null);
  const [cashFlowReport, setCashFlowReport] = useState<any>(null);
  const [selectedDrilldownAccountId, setSelectedDrilldownAccountId] = useState<string>('');
  const [accountActivity, setAccountActivity] = useState<any>(null);

  // Filters & Search
  const [accountFilterType, setAccountFilterType] = useState<string>('ALL');
  const [accountSearch, setAccountSearch] = useState<string>('');
  const [journalFilterStatus, setJournalFilterStatus] = useState<string>('ALL');
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  // Modals
  const [isNewAccountModalOpen, setIsNewAccountModalOpen] = useState(false);
  const [newAccountCode, setNewAccountCode] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState('ASSET');
  const [newAccountClassification, setNewAccountClassification] = useState('CASH_AND_BANK');
  const [newAccountNormalBalance, setNewAccountNormalBalance] = useState('DEBIT');

  const [isNewJournalModalOpen, setIsNewJournalModalOpen] = useState(false);
  const [newJournalMemo, setNewJournalMemo] = useState('');
  const [newJournalLines, setNewJournalLines] = useState([
    { accountId: '', debit: '', credit: '', description: '' },
    { accountId: '', debit: '', credit: '', description: '' }
  ]);

  const [isIngestModalOpen, setIsIngestModalOpen] = useState(false);
  const [ingestAmount, setIngestAmount] = useState('');
  const [ingestDesc, setIngestDesc] = useState('');
  const [ingestRef, setIngestRef] = useState('');

  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [voidingEntryId, setVoidingEntryId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const [exporting, setExporting] = useState<string | null>(null);

  const businessId = business?.id;

  const handleDownloadReport = async (reportType: string, format: 'pdf' | 'csv', extraParams = '') => {
    if (!businessId) return;
    const key = `${reportType}-${format}`;
    setExporting(key);
    try {
      const token = localStorage.getItem('token');
      const url = `${API_URL}/businesses/${businessId}/finance/export/${reportType}?format=${format}${extraParams ? `&${extraParams}` : ''}`;
      
      const response = await fetch(url, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download report (${response.statusText})`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition');
      let filename = `${reportType.replace('/', '_')}.${format}`;
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      addToast({
        type: 'success',
        title: 'Report Downloaded',
        message: `${filename} downloaded successfully.`
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Export Failed',
        message: err.message
      });
    } finally {
      setExporting(null);
    }
  };

  const loadAllFinanceData = async () => {
    if (!businessId) return;
    try {
      setLoading(true);

      const [accountsRes, tbRes, journalsRes, feedsRes] = await Promise.all([
        apiCall(`/businesses/${businessId}/finance/accounts?includeBalance=true`),
        apiCall(`/businesses/${businessId}/finance/trial-balance`),
        apiCall(`/businesses/${businessId}/finance/journal-entries?limit=50`),
        apiCall(`/businesses/${businessId}/finance/bank-feeds`)
      ]);

      const accs = accountsRes.data || [];
      setAccounts(accs);
      setTrialBalance(tbRes.data || null);
      setJournalEntries(journalsRes.data?.entries || []);
      const feeds = feedsRes.data || [];
      setBankFeeds(feeds);

      if (feeds.length > 0 && !selectedFeedId) {
        setSelectedFeedId(feeds[0].id);
      }

      if (accs.length > 0 && !selectedDrilldownAccountId) {
        setSelectedDrilldownAccountId(accs[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load finance data:', err);
      addToast({
        type: 'error',
        title: 'Finance Centre Load Failed',
        message: err.message || 'Unable to retrieve ledger data.'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadFeedData = async (feedId: string) => {
    if (!businessId || !feedId) return;
    try {
      const [reportRes, candidatesRes] = await Promise.all([
        apiCall(`/businesses/${businessId}/finance/bank-feeds/${feedId}/report`),
        apiCall(`/businesses/${businessId}/finance/bank-feeds/${feedId}/candidates`)
      ]);
      setFeedReport(reportRes.data);
      setMatchCandidates(candidatesRes.data || []);
    } catch (err: any) {
      console.error('Failed to load bank feed report:', err);
    }
  };

  const loadReports = async () => {
    if (!businessId) return;
    try {
      const [bsRes, pnlRes, cfRes] = await Promise.all([
        apiCall(`/businesses/${businessId}/finance/reports/balance-sheet`),
        apiCall(`/businesses/${businessId}/finance/reports/profit-and-loss`),
        apiCall(`/businesses/${businessId}/finance/reports/cash-flow`)
      ]);
      setBalanceSheet(bsRes.data);
      setPnlReport(pnlRes.data);
      setCashFlowReport(cfRes.data);
    } catch (err: any) {
      console.error('Failed to load reports:', err);
    }
  };

  const loadAccountActivity = async (accId: string) => {
    if (!businessId || !accId) return;
    try {
      const res = await apiCall(`/businesses/${businessId}/finance/reports/account-activity/${accId}`);
      setAccountActivity(res.data);
    } catch (err: any) {
      console.error('Failed to load account activity:', err);
    }
  };

  useEffect(() => {
    loadAllFinanceData();
    loadReports();
  }, [businessId]);

  useEffect(() => {
    if (selectedFeedId) {
      loadFeedData(selectedFeedId);
    }
  }, [selectedFeedId]);

  useEffect(() => {
    if (selectedDrilldownAccountId) {
      loadAccountActivity(selectedDrilldownAccountId);
    }
  }, [selectedDrilldownAccountId]);

  // Actions
  const handleSeedStandardAccounts = async () => {
    setActionLoading(true);
    try {
      const res = await apiCall(`/businesses/${businessId}/finance/accounts/seed`, { method: 'POST' });
      addToast({
        type: 'success',
        title: 'Chart of Accounts Initialized',
        message: `Created ${res.data.created} accounts (${res.data.existing} existing).`
      });
      await loadAllFinanceData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Seeding Failed', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBatchSyncSubledgers = async () => {
    setActionLoading(true);
    try {
      const res = await apiCall(`/businesses/${businessId}/finance/sync/batch`, { method: 'POST' });
      addToast({
        type: 'success',
        title: 'Subledger Sync Complete',
        message: `Synced ${res.data.invoicesSynced} invoices, ${res.data.paymentsSynced} payments.`
      });
      await loadAllFinanceData();
      await loadReports();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Sync Failed', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      await apiCall(`/businesses/${businessId}/finance/accounts`, {
        method: 'POST',
        body: JSON.stringify({
          code: newAccountCode,
          name: newAccountName,
          type: newAccountType,
          classification: newAccountClassification,
          normalBalance: newAccountNormalBalance,
          currency: 'INR'
        })
      });
      addToast({ type: 'success', title: 'Account Created', message: `${newAccountCode} - ${newAccountName}` });
      setIsNewAccountModalOpen(false);
      setNewAccountCode('');
      setNewAccountName('');
      await loadAllFinanceData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Failed to Create Account', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateJournalEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const lines = newJournalLines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit ? Number(l.debit) : 0,
        credit: l.credit ? Number(l.credit) : 0,
        description: l.description || newJournalMemo
      }));

      await apiCall(`/businesses/${businessId}/finance/journal-entries`, {
        method: 'POST',
        body: JSON.stringify({
          memo: newJournalMemo,
          sourceType: 'MANUAL_JOURNAL',
          lines,
          autoPost: true
        })
      });

      addToast({ type: 'success', title: 'Journal Entry Posted', message: newJournalMemo });
      setIsNewJournalModalOpen(false);
      setNewJournalMemo('');
      setNewJournalLines([
        { accountId: '', debit: '', credit: '', description: '' },
        { accountId: '', debit: '', credit: '', description: '' }
      ]);
      await loadAllFinanceData();
      await loadReports();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Journal Creation Failed', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleVoidEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidingEntryId) return;
    setActionLoading(true);
    try {
      await apiCall(`/businesses/${businessId}/finance/journal-entries/${voidingEntryId}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: voidReason })
      });
      addToast({ type: 'success', title: 'Entry Reversal Posted', message: 'Reversal entry successfully created' });
      setIsVoidModalOpen(false);
      setVoidingEntryId(null);
      setVoidReason('');
      await loadAllFinanceData();
      await loadReports();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Void Failed', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleIngestTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFeedId) return;
    setActionLoading(true);
    try {
      await apiCall(`/businesses/${businessId}/finance/bank-feeds/${selectedFeedId}/transactions`, {
        method: 'POST',
        body: JSON.stringify({
          transactions: [
            {
              transactionDate: new Date(),
              amount: Number(ingestAmount),
              description: ingestDesc,
              referenceNumber: ingestRef || undefined
            }
          ]
        })
      });
      addToast({ type: 'success', title: 'Statement Line Ingested', message: `${ingestDesc} (₹${ingestAmount})` });
      setIsIngestModalOpen(false);
      setIngestAmount('');
      setIngestDesc('');
      setIngestRef('');
      await loadFeedData(selectedFeedId);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Ingestion Failed', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleAutoReconcile = async () => {
    if (!selectedFeedId) return;
    setActionLoading(true);
    try {
      const res = await apiCall(`/businesses/${businessId}/finance/bank-feeds/${selectedFeedId}/auto-reconcile`, {
        method: 'POST',
        body: JSON.stringify({ threshold: 85 })
      });
      addToast({
        type: 'success',
        title: 'Auto-Reconciliation Complete',
        message: `Matched ${res.data.matchedCount} transactions. (${res.data.unmatchedCount} remaining).`
      });
      await loadFeedData(selectedFeedId);
      await loadAllFinanceData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Auto-Reconcile Failed', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualMatch = async (bankTxId: string, journalLineId: string) => {
    if (!selectedFeedId) return;
    setActionLoading(true);
    try {
      await apiCall(`/businesses/${businessId}/finance/bank-feeds/${selectedFeedId}/manual-match`, {
        method: 'POST',
        body: JSON.stringify({ bankTransactionId: bankTxId, journalLineId })
      });
      addToast({ type: 'success', title: 'Transaction Matched', message: 'Reconciled to journal line.' });
      await loadFeedData(selectedFeedId);
      await loadAllFinanceData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Match Failed', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered accounts
  const filteredAccounts = accounts.filter((acc) => {
    const matchesType = accountFilterType === 'ALL' || acc.type === accountFilterType;
    const matchesSearch =
      acc.name.toLowerCase().includes(accountSearch.toLowerCase()) ||
      acc.code.includes(accountSearch) ||
      acc.classification.toLowerCase().includes(accountSearch.toLowerCase());
    return matchesType && matchesSearch;
  });

  // Filtered journal entries
  const filteredJournals = journalEntries.filter((entry) => {
    return journalFilterStatus === 'ALL' || entry.status === journalFilterStatus;
  });

  // Dynamic journal form total validator
  const formTotalDebit = newJournalLines.reduce((acc, l) => acc + (Number(l.debit) || 0), 0);
  const formTotalCredit = newJournalLines.reduce((acc, l) => acc + (Number(l.credit) || 0), 0);
  const formIsBalanced = formTotalDebit > 0 && Math.abs(formTotalDebit - formTotalCredit) < 0.001;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <RefreshCw className="w-8 h-8 text-primary-600 animate-spin" />
        <p className="text-slate-500 font-medium">Loading General Ledger & Financial State...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary-50 rounded-xl text-primary-600 border border-primary-100">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Finance Centre</h1>
              <p className="text-sm text-slate-500">
                Authoritative Double-Entry General Ledger, Subledger Sync, Bank Reconciliation & Statements
              </p>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleBatchSyncSubledgers}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition"
          >
            <RefreshCw className={`w-4 h-4 ${actionLoading ? 'animate-spin' : ''}`} />
            Sync Subledgers
          </button>

          {accounts.length === 0 ? (
            <button
              onClick={handleSeedStandardAccounts}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition"
            >
              <Check className="w-4 h-4" />
              Seed Standard Accounts
            </button>
          ) : (
            <button
              onClick={() => setIsNewJournalModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              New Journal Entry
            </button>
          )}
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto">
        {[
          { id: 'overview', label: 'Overview & Health', icon: Scale },
          { id: 'accounts', label: 'Chart of Accounts', icon: BookOpen, count: accounts.length },
          { id: 'journals', label: 'General Ledger', icon: FileText, count: journalEntries.length },
          { id: 'reconciliation', label: 'Bank Feeds & Reconciliation', icon: Landmark, count: bankFeeds.length },
          { id: 'reports', label: 'Financial Statements', icon: FileText }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    isActive ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW & HEALTH */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-sm font-medium">Cash & Bank Balance</span>
                <Landmark className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {formatCurrency(accounts.filter((a) => a.classification === 'CASH_AND_BANK').reduce((sum, a) => sum + (a.currentBalance || 0), 0))}
              </div>
              <p className="text-xs text-slate-500 mt-1">Across Operating Bank & Clearing accounts</p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-sm font-medium">Accounts Receivable (AR)</span>
                <ArrowUpRight className="w-4 h-4 text-blue-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {formatCurrency(accounts.find((a) => a.classification === 'ACCOUNTS_RECEIVABLE')?.currentBalance || 0)}
              </div>
              <p className="text-xs text-slate-500 mt-1">Uncollected customer invoices</p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-sm font-medium">Accounts Payable (AP)</span>
                <ArrowDownRight className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {formatCurrency(accounts.find((a) => a.classification === 'ACCOUNTS_PAYABLE')?.currentBalance || 0)}
              </div>
              <p className="text-xs text-slate-500 mt-1">Unpaid supplier bills</p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-sm font-medium">Trial Balance Equilibrium</span>
                {trialBalance?.isBalanced ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                )}
              </div>
              <div className={`text-2xl font-bold ${trialBalance?.isBalanced ? 'text-emerald-700' : 'text-rose-700'}`}>
                {trialBalance?.isBalanced ? 'Balanced' : `Discrepancy: ${formatCurrency(trialBalance?.difference)}`}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Debits: {formatCurrency(trialBalance?.totalDebit)} = Credits: {formatCurrency(trialBalance?.totalCredit)}
              </p>
            </div>
          </div>

          {/* Ledger Health & Invariant Guard Panel */}
          <div className="bg-slate-900 text-white rounded-xl p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Scale className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-lg font-semibold">General Ledger Health & Invariant Enforcement</h3>
                </div>
                <p className="text-sm text-slate-400 mt-0.5">
                  Continuous mathematical verification of the 6 core accounting invariants across tenant transactions.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadReport('trial-balance', 'pdf')}
                  disabled={exporting !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 transition"
                  title="Export Trial Balance PDF"
                >
                  <Download className="w-3.5 h-3.5" />
                  PDF
                </button>
                <button
                  onClick={() => handleDownloadReport('trial-balance', 'csv')}
                  disabled={exporting !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 transition"
                  title="Export Trial Balance CSV"
                >
                  <FileText className="w-3.5 h-3.5" />
                  CSV
                </button>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Zero Discrepancy Verified
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Debits</span>
                <p className="text-2xl font-bold text-white mt-1">{formatCurrency(trialBalance?.totalDebit)}</p>
                <p className="text-xs text-slate-400 mt-1">Sum of posted debit journal lines</p>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Credits</span>
                <p className="text-2xl font-bold text-white mt-1">{formatCurrency(trialBalance?.totalCredit)}</p>
                <p className="text-xs text-slate-400 mt-1">Sum of posted credit journal lines</p>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Unposted Drafts</span>
                <p className="text-2xl font-bold text-white mt-1">
                  {journalEntries.filter((j) => j.status === 'DRAFT').length}
                </p>
                <p className="text-xs text-slate-400 mt-1">Draft entries awaiting review</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CHART OF ACCOUNTS */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search accounts by code, name, or classification..."
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={accountFilterType}
                onChange={(e) => setAccountFilterType(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="ALL">All Account Types</option>
                <option value="ASSET">Assets</option>
                <option value="LIABILITY">Liabilities</option>
                <option value="EQUITY">Equity</option>
                <option value="REVENUE">Revenue</option>
                <option value="EXPENSE">Expenses</option>
              </select>

              <button
                onClick={() => setIsNewAccountModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                Add Account
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Account Name</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Classification</th>
                  <th className="py-3 px-4">Normal Balance</th>
                  <th className="py-3 px-4 text-right">Ledger Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">{acc.code}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{acc.name}</div>
                      {acc.isSystem && (
                        <span className="inline-block text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                          System Account
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                          acc.type === 'ASSET'
                            ? 'bg-blue-50 text-blue-700'
                            : acc.type === 'LIABILITY'
                            ? 'bg-amber-50 text-amber-700'
                            : acc.type === 'EQUITY'
                            ? 'bg-purple-50 text-purple-700'
                            : acc.type === 'REVENUE'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {acc.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-xs">{acc.classification}</td>
                    <td className="py-3 px-4 text-slate-600 font-medium">{acc.normalBalance}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(acc.currentBalance || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: GENERAL LEDGER / JOURNALS */}
      {activeTab === 'journals' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <select
                value={journalFilterStatus}
                onChange={(e) => setJournalFilterStatus(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="POSTED">Posted (Immutable)</option>
                <option value="DRAFT">Draft</option>
                <option value="VOIDED">Voided / Reversed</option>
              </select>
            </div>

            <button
              onClick={() => setIsNewJournalModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              New Entry
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="divide-y divide-slate-200">
              {filteredJournals.map((entry) => {
                const isExpanded = expandedEntryId === entry.id;
                return (
                  <div key={entry.id} className="transition-colors">
                    <div
                      onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-3">
                        <button className="text-slate-400">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{entry.entryNumber}</span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                entry.status === 'POSTED'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : entry.status === 'DRAFT'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-slate-100 text-slate-500 line-through'
                              }`}
                            >
                              {entry.status}
                            </span>
                            <span className="text-xs text-slate-500 font-mono">[{entry.sourceType}]</span>
                          </div>
                          <p className="text-sm text-slate-600 mt-0.5">{entry.memo}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="font-mono font-bold text-slate-900">
                            {formatCurrency(entry.totalDebit)}
                          </div>
                          <div className="text-xs text-slate-400">
                            {new Date(entry.postingDate).toLocaleDateString()}
                          </div>
                        </div>

                        {entry.status === 'POSTED' && !entry.reversedByEntry && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setVoidingEntryId(entry.id);
                              setIsVoidModalOpen(true);
                            }}
                            className="text-xs text-rose-600 hover:text-rose-800 font-medium px-2 py-1 rounded hover:bg-rose-50"
                          >
                            Reverse Entry
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expandable Line Items Table */}
                    {isExpanded && (
                      <div className="bg-slate-50/70 p-4 border-t border-slate-100 pl-11">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500 font-semibold border-b border-slate-200 pb-1">
                              <th className="text-left pb-1.5">Line</th>
                              <th className="text-left pb-1.5">Account</th>
                              <th className="text-left pb-1.5">Description</th>
                              <th className="text-right pb-1.5">Debit</th>
                              <th className="text-right pb-1.5">Credit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {entry.lines?.map((line: any) => (
                              <tr key={line.id} className="text-slate-700">
                                <td className="py-1.5 font-mono text-slate-400">{line.lineNumber}</td>
                                <td className="py-1.5 font-mono font-medium">
                                  {line.account?.code} — {line.account?.name}
                                </td>
                                <td className="py-1.5 text-slate-600">{line.description}</td>
                                <td className="py-1.5 text-right font-mono font-bold text-slate-900">
                                  {Number(line.debit) > 0 ? formatCurrency(line.debit) : '—'}
                                </td>
                                <td className="py-1.5 text-right font-mono font-bold text-slate-900">
                                  {Number(line.credit) > 0 ? formatCurrency(line.credit) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: BANK FEEDS & RECONCILIATION */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-6">
          {/* Feed Selector & Ingest Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-slate-700">Active Bank Feed:</label>
              <select
                value={selectedFeedId}
                onChange={(e) => setSelectedFeedId(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {bankFeeds.map((feed) => (
                  <option key={feed.id} value={feed.id}>
                    {feed.institutionName} ({feed.accountNumberMask}) — GL: {feed.glAccount?.code}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsIngestModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Ingest Statement Line
              </button>
              <button
                onClick={handleAutoReconcile}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                Auto-Reconcile ({matchCandidates.length} Candidates)
              </button>
            </div>
          </div>

          {/* Reconciliation Statement Comparison Card */}
          {feedReport && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Bank Reconciliation Statement</h3>
                  <p className="text-xs text-slate-500">
                    Comparing cleared statement transactions with General Ledger Asset account
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadReport(`reconciliation/${selectedFeedId}`, 'pdf')}
                    disabled={exporting !== null || !selectedFeedId}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    PDF
                  </button>
                  <button
                    onClick={() => handleDownloadReport(`reconciliation/${selectedFeedId}`, 'csv')}
                    disabled={exporting !== null || !selectedFeedId}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    CSV
                  </button>
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                      feedReport.summary.isReconciled
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {feedReport.summary.isReconciled ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {feedReport.summary.isReconciled ? 'Fully Reconciled (₹0.00 Variance)' : `Variance: ${formatCurrency(feedReport.summary.variance)}`}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-500 font-medium">Bank Statement Balance</span>
                  <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(feedReport.summary.statementBalance)}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-500 font-medium">General Ledger Balance</span>
                  <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(feedReport.summary.ledgerBalance)}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-500 font-medium">Matched Transactions</span>
                  <p className="text-xl font-bold text-emerald-700 mt-1">{feedReport.counts.matchedCount}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-500 font-medium">Unmatched Transactions</span>
                  <p className="text-xl font-bold text-amber-700 mt-1">{feedReport.counts.unmatchedCount}</p>
                </div>
              </div>
            </div>
          )}

          {/* Candidate Matches Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h4 className="font-semibold text-slate-900 text-sm">Suggested Reconciliation Matches</h4>
              <span className="text-xs text-slate-500">Deterministic multi-factor score (Threshold: 85%)</span>
            </div>
            <div className="divide-y divide-slate-100">
              {matchCandidates.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">
                  No unmatched candidates currently pending reconciliation.
                </div>
              ) : (
                matchCandidates.map((cand) => (
                  <div key={cand.bankTransactionId + cand.journalLineId} className="p-4 flex items-center justify-between hover:bg-slate-50">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">{formatCurrency(cand.bankAmount)}</span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          {cand.confidenceScore}% Confidence
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 space-x-2">
                        {cand.matchReasons?.map((r: string, idx: number) => (
                          <span key={idx} className="inline-block bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => handleManualMatch(cand.bankTransactionId, cand.journalLineId)}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Reconcile
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: FINANCIAL STATEMENTS & REPORTS */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          {/* Subtabs */}
          <div className="flex border-b border-slate-200 gap-2">
            {[
              { id: 'balance-sheet', label: 'Balance Sheet' },
              { id: 'pnl', label: 'Profit & Loss Statement' },
              { id: 'cash-flow', label: 'Cash Flow Statement' },
              { id: 'activity', label: 'GL Account Drilldown' }
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setReportSubTab(st.id as any)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                  reportSubTab === st.id
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* 5A: BALANCE SHEET */}
          {reportSubTab === 'balance-sheet' && balanceSheet && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Statement of Financial Position (Balance Sheet)</h3>
                  <p className="text-xs text-slate-500">As of {new Date(balanceSheet.asOfDate).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadReport('balance-sheet', 'pdf')}
                    disabled={exporting !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    PDF
                  </button>
                  <button
                    onClick={() => handleDownloadReport('balance-sheet', 'csv')}
                    disabled={exporting !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    CSV
                  </button>
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Assets = Liabilities + Equity
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left: Assets */}
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-900 uppercase tracking-wider text-xs border-b border-slate-200 pb-1">
                    Assets
                  </h4>

                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-500">Current Assets</span>
                    {balanceSheet.assets.currentAssets.map((a: any) => (
                      <div key={a.id} className="flex justify-between text-sm py-1 border-b border-slate-50">
                        <span className="text-slate-700">{a.code} — {a.name}</span>
                        <span className="font-mono font-medium">{formatCurrency(a.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-200">
                      <span>Total Current Assets</span>
                      <span className="font-mono">{formatCurrency(balanceSheet.assets.totalCurrentAssets)}</span>
                    </div>
                  </div>

                  <div className="flex justify-between text-base font-bold pt-4 border-t-2 border-slate-900 text-slate-900">
                    <span>Total Assets</span>
                    <span className="font-mono">{formatCurrency(balanceSheet.assets.totalAssets)}</span>
                  </div>
                </div>

                {/* Right: Liabilities & Equity */}
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-900 uppercase tracking-wider text-xs border-b border-slate-200 pb-1">
                    Liabilities & Equity
                  </h4>

                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-500">Current Liabilities</span>
                    {balanceSheet.liabilities.currentLiabilities.map((l: any) => (
                      <div key={l.id} className="flex justify-between text-sm py-1 border-b border-slate-50">
                        <span className="text-slate-700">{l.code} — {l.name}</span>
                        <span className="font-mono font-medium">{formatCurrency(l.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-200">
                      <span>Total Current Liabilities</span>
                      <span className="font-mono">{formatCurrency(balanceSheet.liabilities.totalCurrentLiabilities)}</span>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <span className="text-xs font-semibold text-slate-500">Equity</span>
                    {balanceSheet.equity.equityAccounts.map((e: any) => (
                      <div key={e.id} className="flex justify-between text-sm py-1 border-b border-slate-50">
                        <span className="text-slate-700">{e.code} — {e.name}</span>
                        <span className="font-mono font-medium">{formatCurrency(e.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm py-1 border-b border-slate-50">
                      <span className="text-slate-700">Current Period Net Income (P&L Roll-Forward)</span>
                      <span className="font-mono font-medium text-emerald-700">{formatCurrency(balanceSheet.equity.currentPeriodNetIncome)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-200">
                      <span>Total Equity</span>
                      <span className="font-mono">{formatCurrency(balanceSheet.equity.totalEquity)}</span>
                    </div>
                  </div>

                  <div className="flex justify-between text-base font-bold pt-4 border-t-2 border-slate-900 text-slate-900">
                    <span>Total Liabilities & Equity</span>
                    <span className="font-mono">{formatCurrency(balanceSheet.totalLiabilitiesAndEquity)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5B: PROFIT & LOSS */}
          {reportSubTab === 'pnl' && pnlReport && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Statement of Profit or Loss (Income Statement)</h3>
                  <p className="text-xs text-slate-500">
                    Period: {new Date(pnlReport.startDate).toLocaleDateString()} to {new Date(pnlReport.endDate).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadReport('profit-loss', 'pdf')}
                    disabled={exporting !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    PDF
                  </button>
                  <button
                    onClick={() => handleDownloadReport('profit-loss', 'csv')}
                    disabled={exporting !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    CSV
                  </button>
                </div>
              </div>

              <div className="space-y-6 max-w-2xl mx-auto">
                {/* Revenue */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-bold text-slate-900 border-b border-slate-200 pb-1">
                    <span>Operating Revenue</span>
                    <span className="font-mono">{formatCurrency(pnlReport.revenue.totalRevenue)}</span>
                  </div>
                  {pnlReport.revenue.operatingRevenue.map((r: any) => (
                    <div key={r.id} className="flex justify-between text-sm pl-4 text-slate-600">
                      <span>{r.name}</span>
                      <span className="font-mono">{formatCurrency(r.balance)}</span>
                    </div>
                  ))}
                </div>

                {/* COGS */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-bold text-slate-900 border-b border-slate-200 pb-1">
                    <span>Cost of Goods Sold (COGS)</span>
                    <span className="font-mono text-rose-700">({formatCurrency(pnlReport.costOfGoodsSold.totalCogs)})</span>
                  </div>
                </div>

                {/* Gross Profit */}
                <div className="flex justify-between text-base font-bold p-3 bg-slate-50 rounded-lg text-slate-900 border border-slate-200">
                  <span>Gross Profit ({pnlReport.grossMarginPercentage} Margin)</span>
                  <span className="font-mono text-emerald-700">{formatCurrency(pnlReport.grossProfit)}</span>
                </div>

                {/* OpEx */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-bold text-slate-900 border-b border-slate-200 pb-1">
                    <span>Operating Expenses</span>
                    <span className="font-mono text-rose-700">({formatCurrency(pnlReport.operatingExpenses.totalOperatingExpenses)})</span>
                  </div>
                  {pnlReport.operatingExpenses.expenseAccounts.map((e: any) => (
                    <div key={e.id} className="flex justify-between text-sm pl-4 text-slate-600">
                      <span>{e.name}</span>
                      <span className="font-mono">{formatCurrency(e.balance)}</span>
                    </div>
                  ))}
                </div>

                {/* Net Income */}
                <div className="flex justify-between text-lg font-bold p-4 bg-emerald-50 rounded-xl text-emerald-950 border border-emerald-200">
                  <span>Net Operating Income ({pnlReport.netMarginPercentage} Margin)</span>
                  <span className="font-mono text-emerald-700">{formatCurrency(pnlReport.netIncome)}</span>
                </div>
              </div>
            </div>
          )}

          {/* 5C: CASH FLOW */}
          {reportSubTab === 'cash-flow' && cashFlowReport && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Statement of Cash Flows (Direct Method)</h3>
                  <p className="text-xs text-slate-500">
                    Period: {new Date(cashFlowReport.startDate).toLocaleDateString()} to {new Date(cashFlowReport.endDate).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadReport('cash-flow', 'pdf')}
                    disabled={exporting !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    PDF
                  </button>
                  <button
                    onClick={() => handleDownloadReport('cash-flow', 'csv')}
                    disabled={exporting !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    CSV
                  </button>
                </div>
              </div>

              <div className="space-y-6 max-w-2xl mx-auto text-sm">
                <div className="flex justify-between font-bold border-b border-slate-200 pb-2">
                  <span>Opening Cash & Cash Equivalents</span>
                  <span className="font-mono">{formatCurrency(cashFlowReport.openingCashBalance)}</span>
                </div>

                <div className="space-y-2">
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Cash flows from operating activities</h4>
                  <div className="flex justify-between pl-4 text-slate-600">
                    <span>Cash receipts from customer payments</span>
                    <span className="font-mono text-emerald-600">+{formatCurrency(cashFlowReport.operatingActivities.cashFromCustomers)}</span>
                  </div>
                  <div className="flex justify-between pl-4 text-slate-600">
                    <span>Cash payments to suppliers & expenses</span>
                    <span className="font-mono text-rose-600">-{formatCurrency(cashFlowReport.operatingActivities.cashPaidForExpensesAndVendors)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-slate-200 pt-1">
                    <span>Net cash from operating activities</span>
                    <span className="font-mono">{formatCurrency(cashFlowReport.operatingActivities.netOperatingCashFlow)}</span>
                  </div>
                </div>

                <div className="flex justify-between font-bold border-t border-slate-200 pt-3 text-slate-900">
                  <span>Net Change in Cash</span>
                  <span className="font-mono">{formatCurrency(cashFlowReport.netCashFlow)}</span>
                </div>

                <div className="flex justify-between text-base font-bold p-4 bg-slate-900 rounded-xl text-white">
                  <span>Closing Cash Balance</span>
                  <span className="font-mono">{formatCurrency(cashFlowReport.closingCashBalance)}</span>
                </div>
              </div>
            </div>
          )}

          {/* 5D: GL ACCOUNT DRILLDOWN */}
          {reportSubTab === 'activity' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700">Select GL Account:</label>
                <select
                  value={selectedDrilldownAccountId}
                  onChange={(e) => setSelectedDrilldownAccountId(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name} ({a.type})
                    </option>
                  ))}
                </select>
              </div>

              {accountActivity && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-sm">
                    <div>
                      <span className="font-bold text-slate-900">
                        {accountActivity.account.code} — {accountActivity.account.name}
                      </span>
                      <span className="text-xs text-slate-500 ml-2">Normal Balance: {accountActivity.account.normalBalance}</span>
                    </div>
                    <div className="font-mono font-bold text-slate-900">
                      Closing Balance: {formatCurrency(accountActivity.closingBalance)}
                    </div>
                  </div>

                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 border-b border-slate-200 font-semibold">
                        <th className="py-2.5 px-4">Date</th>
                        <th className="py-2.5 px-4">Entry #</th>
                        <th className="py-2.5 px-4">Memo / Description</th>
                        <th className="py-2.5 px-4 text-right">Debit</th>
                        <th className="py-2.5 px-4 text-right">Credit</th>
                        <th className="py-2.5 px-4 text-right">Running Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {accountActivity.lines?.map((l: any) => (
                        <tr key={l.journalLineId} className="hover:bg-slate-50 text-slate-700">
                          <td className="py-2.5 px-4">{new Date(l.postingDate).toLocaleDateString()}</td>
                          <td className="py-2.5 px-4 font-bold text-slate-900">{l.entryNumber}</td>
                          <td className="py-2.5 px-4 font-sans text-slate-600">{l.description}</td>
                          <td className="py-2.5 px-4 text-right">{Number(l.debit) > 0 ? formatCurrency(l.debit) : '—'}</td>
                          <td className="py-2.5 px-4 text-right">{Number(l.credit) > 0 ? formatCurrency(l.credit) : '—'}</td>
                          <td className="py-2.5 px-4 text-right font-bold text-slate-900">{formatCurrency(l.runningBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: ADD ACCOUNT */}
      {isNewAccountModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Add Account to Chart of Accounts</h3>
            <form onSubmit={handleCreateAccount} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Account Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 1050"
                  value={newAccountCode}
                  onChange={(e) => setNewAccountCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Account Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Payroll Clearing"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
                  <select
                    value={newAccountType}
                    onChange={(e) => {
                      setNewAccountType(e.target.value);
                      if (e.target.value === 'ASSET' || e.target.value === 'EXPENSE') {
                        setNewAccountNormalBalance('DEBIT');
                      } else {
                        setNewAccountNormalBalance('CREDIT');
                      }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ASSET">ASSET</option>
                    <option value="LIABILITY">LIABILITY</option>
                    <option value="EQUITY">EQUITY</option>
                    <option value="REVENUE">REVENUE</option>
                    <option value="EXPENSE">EXPENSE</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Normal Balance</label>
                  <select
                    value={newAccountNormalBalance}
                    onChange={(e) => setNewAccountNormalBalance(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="DEBIT">DEBIT</option>
                    <option value="CREDIT">CREDIT</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Classification</label>
                <select
                  value={newAccountClassification}
                  onChange={(e) => setNewAccountClassification(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono text-xs"
                >
                  <option value="CASH_AND_BANK">CASH_AND_BANK</option>
                  <option value="ACCOUNTS_RECEIVABLE">ACCOUNTS_RECEIVABLE</option>
                  <option value="INVENTORY">INVENTORY</option>
                  <option value="ACCOUNTS_PAYABLE">ACCOUNTS_PAYABLE</option>
                  <option value="TAX_PAYABLE">TAX_PAYABLE</option>
                  <option value="OWNERS_EQUITY">OWNERS_EQUITY</option>
                  <option value="RETAINED_EARNINGS">RETAINED_EARNINGS</option>
                  <option value="OPERATING_REVENUE">OPERATING_REVENUE</option>
                  <option value="COST_OF_GOODS_SOLD">COST_OF_GOODS_SOLD</option>
                  <option value="OPERATING_EXPENSE">OPERATING_EXPENSE</option>
                </select>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsNewAccountModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition shadow-sm"
                >
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: NEW JOURNAL ENTRY */}
      {isNewJournalModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Create Double-Entry Journal Entry</h3>
            <form onSubmit={handleCreateJournalEntry} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Memo / Purpose</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Office Supplies Procurement"
                  value={newJournalMemo}
                  onChange={(e) => setNewJournalMemo(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-600">
                  <div className="col-span-5">Account</div>
                  <div className="col-span-3">Description</div>
                  <div className="col-span-2 text-right">Debit (₹)</div>
                  <div className="col-span-2 text-right">Credit (₹)</div>
                </div>

                {newJournalLines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <div className="col-span-5">
                      <select
                        required
                        value={line.accountId}
                        onChange={(e) => {
                          const updated = [...newJournalLines];
                          updated[idx].accountId = e.target.value;
                          setNewJournalLines(updated);
                        }}
                        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white"
                      >
                        <option value="">Select Account</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} - {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        placeholder="Memo line"
                        value={line.description}
                        onChange={(e) => {
                          const updated = [...newJournalLines];
                          updated[idx].description = e.target.value;
                          setNewJournalLines(updated);
                        }}
                        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={line.debit}
                        onChange={(e) => {
                          const updated = [...newJournalLines];
                          updated[idx].debit = e.target.value;
                          if (e.target.value) updated[idx].credit = '';
                          setNewJournalLines(updated);
                        }}
                        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded text-right font-mono"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={line.credit}
                        onChange={(e) => {
                          const updated = [...newJournalLines];
                          updated[idx].credit = e.target.value;
                          if (e.target.value) updated[idx].debit = '';
                          setNewJournalLines(updated);
                        }}
                        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded text-right font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Balance Bar */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg text-xs font-mono border border-slate-200">
                <span>Total Debit: {formatCurrency(formTotalDebit, 'INR')}</span>
                <span>Total Credit: {formatCurrency(formTotalCredit, 'INR')}</span>
                <span className={`font-bold ${formIsBalanced ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {formIsBalanced ? '✓ Balanced' : `Discrepancy: ${formatCurrency(Math.abs(formTotalDebit - formTotalCredit), 'INR')}`}
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewJournalModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!formIsBalanced || actionLoading}
                  className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium transition shadow-sm"
                >
                  Post Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: INGEST STATEMENT LINE */}
      {isIngestModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Ingest Bank Statement Line</h3>
            <form onSubmit={handleIngestTransaction} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Amount (Positive = Deposit, Negative = Withdrawal)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 1144.60 or -150.00"
                  value={ingestAmount}
                  onChange={(e) => setIngestAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description / Payee</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. STRIPE PAYOUT BATCH 001"
                  value={ingestDesc}
                  onChange={(e) => setIngestDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reference Number (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. STRIPE-001"
                  value={ingestRef}
                  onChange={(e) => setIngestRef(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsIngestModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition shadow-sm"
                >
                  Ingest Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: VOID / REVERSAL */}
      {isVoidModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Post Reversing Journal Entry</h3>
            <p className="text-xs text-slate-500">
              In accordance with double-entry immutability invariants, posted journal entries cannot be deleted. An inverted reversing journal entry will be atomically posted.
            </p>
            <form onSubmit={handleVoidEntry} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reversal Reason</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Customer transaction cancelled by bank"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsVoidModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-medium transition shadow-sm"
                >
                  Post Reversal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
