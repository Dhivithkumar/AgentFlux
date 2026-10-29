import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { formatCurrency } from '../lib/currency';
import { useToast } from '../components/ui/Toast';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  RefreshCcw,
  DollarSign,
  Activity,
  FileText,
  Settings,
  Mail,
  ShieldAlert,
  Cpu,
  Layers,
  ExternalLink,
  FileSpreadsheet,
  HardDrive,
  Clock,
  ArrowRight,
  ChevronRight,
  Radio,
  Plus,
  ShieldCheck,
  Info,
  CreditCard
} from 'lucide-react';
import CreateOrderModal from '../components/orders/CreateOrderModal';

interface OverviewData {
  overview: any;
  actionZone: any;
  connectors: any;
  configAlerts: any;
  jobs: any;
  funnel: any;
  revenue: any;
  activity: any[];
  insights: any;
  priorityOrders?: any;
  customerHealth?: any;
  vendorSummary?: any;
}

export default function DashboardOverview() {
  const { business, user } = useOutletContext<{ business: any; user: any }>();
  const { addToast } = useToast();

  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [liveTransport, setLiveTransport] = useState<'sse' | 'polling' | 'disconnected'>('disconnected');
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  const [selectedPriorityReason, setSelectedPriorityReason] = useState<any | null>(null);

  // Concurrency & lifecycle refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const backoffDelayRef = useRef(15000); // Base 15s
  const sseRef = useRef<EventSource | null>(null);

  const currency = business?.currency || 'INR';

  /**
   * Safe fetcher that unwraps payloads and supports cancellation
   */
  const fetchData = useCallback(
    async (isManualRefresh = false) => {
      if (!business?.id) return;

      if (isManualRefresh) {
        setRefreshing(true);
      }

      // Cancel any ongoing request before initiating a new one
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const signal = controller.signal;

      const safeGet = async (endpoint: string) => {
        try {
          const res = await apiCall(endpoint, { signal });
          return res && res.data !== undefined ? res.data : res;
        } catch (err: any) {
          if (err.name === 'AbortError' || signal.aborted) throw err;
          console.warn(`[Dashboard] Failed to fetch ${endpoint}:`, err.message);
          return null;
        }
      };

      try {
        const [
          overview,
          actionZone,
          connectors,
          configAlerts,
          jobs,
          funnel,
          revenue,
          activity,
          insights,
          priorityOrders,
          customerHealth,
          vendorSummary
        ] = await Promise.all([
          safeGet(`/businesses/${business.id}/analytics/overview`),
          safeGet(`/businesses/${business.id}/analytics/action-zone`),
          safeGet(`/businesses/${business.id}/analytics/connectors`),
          safeGet(`/businesses/${business.id}/analytics/configuration-alerts`),
          safeGet(`/businesses/${business.id}/analytics/jobs`),
          safeGet(`/businesses/${business.id}/analytics/funnel`),
          safeGet(`/businesses/${business.id}/analytics/revenue`),
          safeGet(`/businesses/${business.id}/analytics/activity`),
          safeGet(`/businesses/${business.id}/analytics/insights`),
          safeGet(`/businesses/${business.id}/analytics/priority-orders`),
          safeGet(`/businesses/${business.id}/analytics/customer-health`),
          safeGet(`/businesses/${business.id}/analytics/vendor-summary`)
        ]);

        if (signal.aborted) return;

        // If core overview failed completely, trigger error condition
        if (!overview && !actionZone) {
          throw new Error('Unable to retrieve business analytics.');
        }

        setData((prev) => ({
          overview: overview || prev?.overview || {},
          actionZone: actionZone || prev?.actionZone || {},
          connectors: connectors || prev?.connectors || {},
          configAlerts: configAlerts || prev?.configAlerts || { alerts: [] },
          jobs: jobs || prev?.jobs || { summary: {}, recentSyncJobs: [] },
          funnel: funnel || prev?.funnel || { stages: [] },
          revenue: revenue || prev?.revenue || {},
          activity: activity || prev?.activity || [],
          insights: insights || prev?.insights || { insights: [] },
          priorityOrders: priorityOrders || prev?.priorityOrders || { orders: [], summary: {} },
          customerHealth: customerHealth || prev?.customerHealth || { customers: [], summary: {}, riskAccounts: [] },
          vendorSummary: vendorSummary || prev?.vendorSummary || { totalVendors: 0, statusCounts: {} }
        }));

        setLastRefreshedAt(new Date());
        setIsStale(false);
        setStaleError(null);
        backoffDelayRef.current = 15000; // Reset exponential backoff on success
      } catch (err: any) {
        if (err.name === 'AbortError' || signal.aborted) return;

        // If we already have cached data, retain it and display a stale banner
        setIsStale(true);
        setStaleError(err.message || 'Network refresh failed. Displaying cached operational data.');

        // Exponential backoff up to 60s
        backoffDelayRef.current = Math.min(backoffDelayRef.current * 1.5, 60000);
      } finally {
        if (!signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [business?.id]
  );

  /**
   * Visibility-aware polling scheduler with exponential backoff
   */
  const scheduleNextPoll = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);

    pollTimerRef.current = setTimeout(() => {
      // Only poll if tab is active/visible
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        // Postpone until tab becomes visible
        return;
      }
      fetchData(false).then(() => {
        scheduleNextPoll();
      });
    }, backoffDelayRef.current);
  }, [fetchData]);

  // Set up SSE Push stream with fallback to visibility-aware polling
  useEffect(() => {
    if (!business?.id) return;

    fetchData(false);

    // 1. Establish SSE push connection
    const token = localStorage.getItem('token');
    const apiUrl = ((import.meta as any).env?.NEXT_PUBLIC_API_URL || '/api');
    const sseUrl = `${apiUrl}/businesses/${business.id}/analytics/live?token=${encodeURIComponent(token || '')}`;

    try {
      const sse = new EventSource(sseUrl);
      sseRef.current = sse;

      sse.onopen = () => {
        setLiveTransport('sse');
      };

      sse.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'CONNECTED') {
            setLiveTransport('sse');
          } else {
            // Live operational event received (order updated, invoice generated, sync completed)
            fetchData(false);
          }
        } catch {
          // Heartbeat ping or raw data
        }
      };

      sse.onerror = () => {
        setLiveTransport('polling');
        sse.close();
      };
    } catch {
      setLiveTransport('polling');
    }

    // 2. Start visibility-aware polling scheduler
    scheduleNextPoll();

    // 3. Listen for window focus/visibility changes to resume polling immediately
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchData(false);
        scheduleNextPoll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (sseRef.current) sseRef.current.close();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [business?.id, fetchData, scheduleNextPoll]);

  /**
   * Action handler: Accept owner confirmation order
   */
  const handleAcceptOrder = async (orderId: string, orderNumber: string) => {
    setActionLoading((prev) => ({ ...prev, [orderId]: true }));
    try {
      await apiCall(`/businesses/${business.id}/orders/${orderId}/status`, {
        method: 'POST',
        body: JSON.stringify({
          status: 'CONFIRMED',
          reason: 'Owner confirmed order from main operational dashboard'
        })
      });
      addToast({
        type: 'success',
        title: 'Order Confirmed',
        message: `Order ${orderNumber} confirmed. Invoice creation workflow triggered.`
      });
      await fetchData(false);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Confirmation Failed',
        message: err.message || 'Failed to confirm order.'
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  /**
   * Action handler: Retry a failed sync job directly
   */
  const handleRetrySyncJob = async (jobId: string, entityType: string) => {
    setActionLoading((prev) => ({ ...prev, [jobId]: true }));
    try {
      await apiCall(`/businesses/${business.id}/analytics/jobs/${jobId}/retry`, {
        method: 'POST'
      });
      addToast({
        type: 'success',
        title: 'Job Queued for Retry',
        message: `${entityType} sync operation scheduled for immediate processing.`
      });
      await fetchData(false);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Retry Failed',
        message: err.message || 'Could not schedule job retry.'
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [jobId]: false }));
    }
  };

  // Initial loading state (only when no cached data exists)
  if (loading && !data) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-slate-500 gap-3">
        <RefreshCcw className="animate-spin text-primary-600" size={32} />
        <p className="text-sm font-medium">Loading Business Command Centre...</p>
      </div>
    );
  }

  // Fatal initial error state (no data available at all)
  if (!data) {
    return (
      <div className="p-8 text-center bg-rose-50 rounded-2xl border border-rose-200 max-w-xl mx-auto my-12">
        <AlertCircle size={36} className="mx-auto mb-3 text-rose-500" />
        <h3 className="text-base font-bold text-rose-900">Dashboard Unavailable</h3>
        <p className="text-sm text-rose-700 mt-1">{staleError || 'Failed to load business data.'}</p>
        <button
          onClick={() => {
            setLoading(true);
            fetchData(true);
          }}
          className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-medium transition shadow-sm"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const { overview, actionZone, connectors, configAlerts, jobs, funnel, revenue, activity, insights, priorityOrders, customerHealth, vendorSummary } = data;

  const syncJobsSummary = jobs?.summary || overview?.syncJobs || {
    queued: 0,
    processing: 0,
    retrying: 0,
    succeeded: 0,
    failed: 0
  };

  const sheetsStatus = connectors?.googleSheets?.status || 'NOT_CONFIGURED';
  const driveStatus = connectors?.googleDrive?.status || 'NOT_CONFIGURED';

  const getScoreBadge = (score?: number | null, category?: string) => {
    if (score === null || score === undefined || category === 'INSUFFICIENT_HISTORY') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
          Insufficient History
        </span>
      );
    }
    let color = 'bg-slate-100 text-slate-700 border-slate-200';
    let label = category || 'SCORE';
    if (score >= 80) {
      color = 'bg-emerald-100 text-emerald-800 border-emerald-300';
      label = 'Strong';
    } else if (score >= 60) {
      color = 'bg-blue-100 text-blue-800 border-blue-300';
      label = 'Good';
    } else if (score >= 40) {
      color = 'bg-amber-100 text-amber-800 border-amber-300';
      label = 'Caution';
    } else {
      color = 'bg-rose-100 text-rose-800 border-rose-300';
      label = 'High Risk';
    }
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${color}`}>
        <span className="font-mono">{score}</span>
        <span className="text-[10px] font-normal uppercase">({label})</span>
      </span>
    );
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 pb-16 px-2 animate-in fade-in duration-300">
      {/* Stale Data Notification Banner */}
      {isStale && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-amber-500 shrink-0" size={20} />
            <div>
              <p className="text-sm font-semibold text-amber-900">Cached Operational Data</p>
              <p className="text-xs text-amber-700 mt-0.5">
                {staleError || 'Refresh interrupted. Showing data from previous sync.'}
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-semibold transition disabled:opacity-50"
          >
            <RefreshCcw size={14} className={refreshing ? 'animate-spin' : ''} />
            Retry Now
          </button>
        </div>
      )}

      {/* A. Global Business Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white/80 backdrop-blur-xl px-6 py-4 rounded-2xl border border-slate-200/80 shadow-sm gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Business Command Centre</h1>
          <p className="text-sm text-slate-500 mt-1">
            Signed in as {user?.name || user?.email || 'Administrator'}. Scoped to{' '}
            <span className="font-semibold text-slate-800">{business?.name}</span>{' '}
            <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-mono ml-1">
              {currency}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right text-xs text-slate-500">
            <p>
              Last synced:{' '}
              <span className="font-medium text-slate-700">
                {lastRefreshedAt ? lastRefreshedAt.toLocaleTimeString() : 'Just now'}
              </span>
            </p>
            <p className="flex items-center justify-end gap-1.5 mt-1 font-medium">
              {liveTransport === 'sse' ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-emerald-700">Live Stream Active</span>
                </>
              ) : (
                <>
                  <Radio size={12} className="text-blue-500" />
                  <span className="text-blue-700">Auto-Polling (15s)</span>
                </>
              )}
            </p>
          </div>

          <button
            id="dashboard-create-order-btn"
            onClick={() => setIsCreateOrderOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white rounded-xl shadow-md hover:shadow-lg transition font-semibold text-sm shrink-0"
          >
            <Plus size={16} />
            <span>Create Order</span>
          </button>

          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="p-2.5 hover:bg-slate-100 active:bg-slate-200 rounded-xl transition border border-slate-200 disabled:opacity-50"
            title="Refresh Dashboard Data"
            aria-label="Refresh Dashboard Data"
          >
            <RefreshCcw size={16} className={`text-slate-600 ${refreshing ? 'animate-spin text-primary-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* K. Configuration Alerts & Unresolved Setup */}
      {configAlerts?.alerts?.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="text-amber-600 shrink-0 mt-0.5" size={22} />
            <div className="flex-1">
              <h2 className="text-sm font-bold text-amber-950">Action Required: Business Configuration</h2>
              <p className="text-xs text-amber-800 mt-0.5">
                Complete the following configuration items to ensure uninterrupted operations and compliant document generation.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                {configAlerts.alerts.map((alert: any) => (
                  <div
                    key={alert.id}
                    className="p-3 bg-white/80 rounded-xl border border-amber-200/70 flex flex-col justify-between"
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-800">{alert.title}</p>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{alert.description}</p>
                    </div>
                    <Link
                      to={alert.remediationUrl}
                      className="mt-3 text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1 group"
                    >
                      {alert.actionLabel || 'Remediate'}
                      <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* B. Executive KPI Cards (Currency Aware & Fully Scoped) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Revenue Collected',
            value: formatCurrency(overview?.revenue || revenue?.collected || 0, currency),
            subtext: `${formatCurrency(overview?.totalInvoiced || 0, currency)} invoiced`,
            color: 'text-emerald-700',
            bg: 'bg-emerald-50/80 border-emerald-100'
          },
          {
            label: 'Confirmed Orders',
            value: (overview?.orders || 0).toString(),
            subtext: `${overview?.pendingOrders || 0} awaiting confirmation`,
            color: 'text-blue-700',
            bg: 'bg-blue-50/80 border-blue-100'
          },
          {
            label: 'New Enquiries',
            value: (overview?.enquiries || 0).toString(),
            subtext: 'Intake ready for qualification',
            color: 'text-purple-700',
            bg: 'bg-purple-50/80 border-purple-100'
          },
          {
            label: 'Action Required',
            value: (overview?.pendingActions || actionZone?.totalActionCount || 0).toString(),
            subtext: `${actionZone?.unresolvedFailuresCount || 0} unresolved errors`,
            color: overview?.pendingActions > 0 ? 'text-rose-700' : 'text-slate-700',
            bg: overview?.pendingActions > 0 ? 'bg-rose-50/80 border-rose-100' : 'bg-slate-50/80 border-slate-200'
          },
          {
            label: 'Outstanding Balance',
            value: formatCurrency(overview?.outstanding || revenue?.outstanding || 0, currency),
            subtext: 'Pending payment settlements',
            color: (overview?.outstanding || 0) > 0 ? 'text-amber-700' : 'text-slate-700',
            bg: 'bg-amber-50/80 border-amber-100'
          },
          {
            label: 'Overdue Invoices',
            value: formatCurrency(overview?.overdueAmount || 0, currency),
            subtext: `${overview?.overdueCount || actionZone?.overdueInvoices?.length || 0} overdue invoices`,
            color: (overview?.overdueAmount || 0) > 0 ? 'text-rose-700' : 'text-slate-700',
            bg: 'bg-rose-50/80 border-rose-100'
          },
          {
            label: 'Quotations Sent',
            value: (overview?.pendingQuotations || 0).toString(),
            subtext: `${overview?.acceptedQuotations || 0} accepted`,
            color: 'text-indigo-700',
            bg: 'bg-indigo-50/80 border-indigo-100'
          },
          {
            label: 'Automation Success',
            value: `${(overview?.automationSuccessRate || 100).toFixed(1)}%`,
            subtext: `${syncJobsSummary.succeeded} jobs completed`,
            color: 'text-teal-700',
            bg: 'bg-teal-50/80 border-teal-100'
          }
        ].map((kpi, i) => (
          <div
            key={i}
            className={`p-5 rounded-2xl border backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 ${kpi.bg}`}
          >
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{kpi.label}</p>
            <p className={`text-2xl lg:text-3xl font-extrabold mt-1.5 ${kpi.color}`}>{kpi.value}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">{kpi.subtext}</p>
          </div>
        ))}
      </div>

      {/* High-Priority Order Intelligence Section */}
      <section className="bg-white/95 backdrop-blur-xl rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-rose-100 text-rose-700">
                <AlertTriangle size={18} />
              </span>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                High-Priority Order Intelligence
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Scored via real-time financial exposure, overdue risk, and verified customer payment history.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              {priorityOrders?.summary?.criticalCount || 0} Critical
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
              {priorityOrders?.summary?.highCount || 0} High
            </span>
            <Link
              to="/dashboard/orders"
              className="text-xs font-semibold text-primary-600 hover:text-primary-700 hover:underline ml-2"
            >
              View All Orders &rarr;
            </Link>
          </div>
        </div>

        {!priorityOrders?.orders || priorityOrders.orders.length === 0 ? (
          <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-800">No Critical or High Risk Orders</p>
            <p className="text-xs text-slate-500 mt-1">All outstanding client orders fall within routine processing tolerances.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
            {priorityOrders.orders.slice(0, 6).map((order: any) => {
              const isCrit = order.priority === 'CRITICAL';
              const border = isCrit ? 'border-l-4 border-l-rose-500' : 'border-l-4 border-l-amber-500';
              const pBadge = isCrit
                ? 'bg-rose-100 text-rose-800 border-rose-200'
                : 'bg-amber-100 text-amber-800 border-amber-200';

              return (
                <div
                  key={order.id}
                  className={`p-4 rounded-xl bg-slate-50/80 hover:bg-white border border-slate-200 hover:shadow-md transition-all flex flex-col justify-between ${border}`}
                >
                  <div>
                    <div className="flex justify-between items-start gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${pBadge}`}>
                        {order.priority} • {order.priorityScore || 0}
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-900">
                        {formatCurrency(order.totalAmount || 0, currency)}
                      </span>
                    </div>

                    <div className="mt-2.5">
                      <Link
                        to={`/dashboard/orders/${order.id}`}
                        className="text-sm font-bold text-slate-900 hover:text-primary-600 hover:underline block truncate"
                      >
                        {order.orderNumber}
                      </Link>
                      <p className="text-xs text-slate-600 font-medium truncate mt-0.5">
                        {order.customer?.name || 'Customer'}
                      </p>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-slate-500 text-[11px]">Payment Trust:</span>
                      {getScoreBadge(order.customer?.paymentScore, order.customer?.paymentScoreCategory)}
                    </div>

                    {order.priorityReason && (
                      <p className="text-[11px] text-slate-600 mt-2 bg-white/90 p-2 rounded border border-slate-200/80 line-clamp-2 leading-relaxed">
                        <strong className="text-slate-800 font-semibold">Priority Driver:</strong> {order.priorityReason}
                      </p>
                    )}
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-200/70 flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-mono text-[10px]">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </span>
                    <Link
                      to={`/dashboard/orders/${order.id}`}
                      className="text-primary-600 hover:text-primary-800 font-semibold flex items-center gap-0.5"
                    >
                      Process &rarr;
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* C. What Needs You Now (Action Zone) */}
        <section className="xl:col-span-2 bg-white/90 backdrop-blur-xl p-6 rounded-2xl border border-rose-200/80 shadow-sm flex flex-col relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-rose-500"></div>
          <div className="flex items-center justify-between mb-6 ml-3">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <AlertCircle size={20} className="text-rose-500" /> What Needs You Now
            </h2>
            <span className="text-xs font-semibold px-2.5 py-1 bg-rose-100 text-rose-700 rounded-full">
              {actionZone?.totalActionCount || 0} Pending
            </span>
          </div>

          {!actionZone?.pendingApprovals?.length &&
          !actionZone?.pendingOrders?.length &&
          !actionZone?.overdueInvoices?.length &&
          !actionZone?.failedSyncJobs?.length &&
          !actionZone?.failedWorkflows?.length &&
          !actionZone?.stuckEnquiries?.length ? (
            <div className="ml-3 flex-1 flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <CheckCircle2 size={44} className="text-emerald-500 mb-3" />
              <h3 className="text-base font-bold text-slate-800">All Operations Clear</h3>
              <p className="text-sm text-slate-500 mt-1 text-center max-w-sm">
                No orders requiring confirmation, overdue invoices, approval requests, or failed sync jobs.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-3">
              {/* 1. Pending Approvals */}
              {actionZone?.pendingApprovals?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock size={14} className="text-amber-500" /> Pending Approvals
                  </h3>
                  {actionZone.pendingApprovals.map((ap: any) => (
                    <Link
                      key={ap.id}
                      to="/dashboard/workflows/approvals"
                      className="block p-4 rounded-xl bg-amber-50/80 border border-amber-200 hover:bg-amber-100/80 transition-all group shadow-sm"
                    >
                      <div className="flex justify-between items-center">
                        <p className="text-sm font-bold text-amber-950">Approval Requested</p>
                        <span className="text-xs text-amber-700 font-medium font-mono">{ap.actionType || 'WORKFLOW'}</span>
                      </div>
                      <p className="text-xs text-amber-800 mt-1">
                        Requested: {new Date(ap.createdAt).toLocaleDateString()}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              {/* 2. Pending Owner Confirmation Orders */}
              {actionZone?.pendingOrders?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText size={14} className="text-blue-500" /> Owner Confirmation Required
                  </h3>
                  {actionZone.pendingOrders.map((order: any) => (
                    <div
                      key={order.id}
                      className="p-4 rounded-xl bg-blue-50/80 border border-blue-200 hover:shadow-sm transition-all"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <Link to={`/dashboard/orders/${order.id}`} className="hover:underline flex-1 min-w-0">
                          <p className="text-sm font-bold text-blue-950 truncate">
                            {order.customer?.name || 'Customer'}
                          </p>
                          <p className="text-xs text-blue-800 mt-0.5">
                            Order {order.orderNumber} • {formatCurrency(order.totalAmount || 0, currency)}
                          </p>
                        </Link>
                        <button
                          onClick={() => handleAcceptOrder(order.id, order.orderNumber)}
                          disabled={actionLoading[order.id]}
                          className="px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm transition disabled:opacity-50 flex items-center gap-1 shrink-0"
                        >
                          {actionLoading[order.id] && <RefreshCcw size={12} className="animate-spin" />}
                          Accept Order
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 3. Failed Operational Sync Jobs */}
              {actionZone?.failedSyncJobs?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-rose-500" /> Failed Sync Jobs
                  </h3>
                  {actionZone.failedSyncJobs.map((job: any) => (
                    <div
                      key={job.id}
                      className="p-4 rounded-xl bg-rose-50/80 border border-rose-200 hover:shadow-sm transition-all"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-rose-950 truncate">
                            {job.entityType} Sync Failed
                          </p>
                          <p className="text-xs text-rose-800 mt-0.5 truncate" title={job.lastError || ''}>
                            {job.lastError || 'Google Sheets sync failed'}
                          </p>
                          <p className="text-xs text-rose-600 mt-1 font-mono">
                            Attempts: {job.attemptCount} • Status: {job.status}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRetrySyncJob(job.id, job.entityType)}
                          disabled={actionLoading[job.id]}
                          className="px-2.5 py-1 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-sm transition disabled:opacity-50 flex items-center gap-1 shrink-0"
                        >
                          {actionLoading[job.id] && <RefreshCcw size={12} className="animate-spin" />}
                          Retry
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 4. Overdue Invoices */}
              {actionZone?.overdueInvoices?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <DollarSign size={14} className="text-rose-500" /> Overdue Invoices
                  </h3>
                  {actionZone.overdueInvoices.map((inv: any) => (
                    <Link
                      key={inv.id}
                      to="/dashboard/orders"
                      className="block p-4 rounded-xl bg-rose-50/80 border border-rose-200 hover:bg-rose-100/80 transition-all shadow-sm"
                    >
                      <div className="flex justify-between items-center">
                        <p className="text-sm font-bold text-rose-950">Invoice {inv.invoiceNumber}</p>
                        <p className="text-sm font-extrabold text-rose-800">
                          {formatCurrency(inv.totalAmount, currency)}
                        </p>
                      </div>
                      <p className="text-xs text-rose-700 mt-1">
                        Customer: {inv.customer?.name || 'Customer'} • Due:{' '}
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : 'Immediate'}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              {/* 5. Failed Workflow Automations */}
              {actionZone?.failedWorkflows?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Activity size={14} className="text-rose-500" /> Automation Failures
                  </h3>
                  {actionZone.failedWorkflows.map((wf: any) => (
                    <Link
                      key={wf.id}
                      to="/dashboard/workflows"
                      className="block p-4 rounded-xl bg-red-50/80 border border-red-200 hover:bg-red-100/80 transition-all shadow-sm"
                    >
                      <p className="text-sm font-bold text-red-950">
                        {wf.workflow?.name || 'Workflow Execution'}
                      </p>
                      <p className="text-xs text-red-700 mt-1">
                        Failed at: {new Date(wf.startedAt).toLocaleString()}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              {/* 6. Stuck Enquiries (>48h) */}
              {actionZone?.stuckEnquiries?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock size={14} className="text-orange-500" /> Stuck Enquiries (&gt;48h)
                  </h3>
                  {actionZone.stuckEnquiries.map((enq: any) => (
                    <Link
                      key={enq.id}
                      to="/dashboard/enquiries"
                      className="block p-4 rounded-xl bg-orange-50/80 border border-orange-200 hover:bg-orange-100/80 transition-all shadow-sm"
                    >
                      <p className="text-sm font-bold text-orange-950 truncate">
                        {enq.customer?.name || 'Unassigned Lead'}
                      </p>
                      <p className="text-xs text-orange-700 mt-1">
                        Waiting in NEW status since {new Date(enq.createdAt).toLocaleDateString()}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* E. Financial Overview */}
        <section className="bg-white/90 backdrop-blur-xl p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
              <DollarSign size={20} className="text-emerald-600" /> Financial Snapshot
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-end border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Total Invoiced</p>
                  <p className="text-xl font-bold text-slate-900 mt-0.5">
                    {formatCurrency(revenue?.totalInvoiced || overview?.totalInvoiced || 0, currency)}
                  </p>
                </div>
              </div>
              <div className="flex justify-between items-end border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Collected Settlements</p>
                  <p className="text-xl font-bold text-emerald-700 mt-0.5">
                    {formatCurrency(revenue?.collected || overview?.revenue || 0, currency)}
                  </p>
                </div>
              </div>
              <div className="flex justify-between items-end border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Outstanding Receivables</p>
                  <p className="text-xl font-bold text-amber-700 mt-0.5">
                    {formatCurrency(revenue?.outstanding || overview?.outstanding || 0, currency)}
                  </p>
                </div>
              </div>
              <div className="flex justify-between items-end pb-3">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Refunded Amount</p>
                  <p className="text-xl font-bold text-slate-700 mt-0.5">
                    {formatCurrency(revenue?.refunds || 0, currency)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Operating Currency: <strong className="text-slate-700">{currency}</strong></span>
            <Link to="/dashboard/orders" className="text-primary-600 hover:underline font-semibold">
              Manage Orders &rarr;
            </Link>
          </div>
        </section>
      </div>

      {/* Customer Payment Intelligence & Vendor Verification Hub */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer Payment Health & Debt Exposure (2 cols) */}
        <section className="lg:col-span-2 bg-white/95 backdrop-blur-xl p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <CreditCard className="text-primary-600" size={20} />
                  Customer Payment Score &amp; Credit Exposure
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Transparent 0–100 scoring based on on-time settlements, payment completion, timeliness, and debt risk.
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500 font-medium">Total Customer Debt:</span>
                <span className="font-extrabold text-slate-900 ml-1.5 text-sm">
                  {formatCurrency(customerHealth?.summary?.totalOutstandingAll || 0, currency)}
                </span>
                {customerHealth?.summary?.totalOverdueAll > 0 && (
                  <span className="block text-[11px] font-bold text-rose-600">
                    Overdue: {formatCurrency(customerHealth.summary.totalOverdueAll, currency)}
                  </span>
                )}
              </div>
            </div>

            {/* Score Distribution Pills */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 mb-5">
              <div className="text-center p-2 rounded-lg bg-emerald-50 border border-emerald-100">
                <span className="text-[10px] uppercase font-bold text-emerald-800 block">Strong (80-100)</span>
                <span className="text-lg font-extrabold text-emerald-700">{customerHealth?.summary?.strongCount || 0}</span>
              </div>
              <div className="text-center p-2 rounded-lg bg-blue-50 border border-blue-100">
                <span className="text-[10px] uppercase font-bold text-blue-800 block">Good (60-79)</span>
                <span className="text-lg font-extrabold text-blue-700">{customerHealth?.summary?.goodCount || 0}</span>
              </div>
              <div className="text-center p-2 rounded-lg bg-amber-50 border border-amber-100">
                <span className="text-[10px] uppercase font-bold text-amber-800 block">Caution (40-59)</span>
                <span className="text-lg font-extrabold text-amber-700">{customerHealth?.summary?.cautionCount || 0}</span>
              </div>
              <div className="text-center p-2 rounded-lg bg-rose-50 border border-rose-100">
                <span className="text-[10px] uppercase font-bold text-rose-800 block">High Risk (&lt;40)</span>
                <span className="text-lg font-extrabold text-rose-700">{customerHealth?.summary?.highRiskCount || 0}</span>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-100 border border-slate-200 col-span-2 sm:col-span-1">
                <span className="text-[10px] uppercase font-bold text-slate-600 block">Insufficient History</span>
                <span className="text-lg font-extrabold text-slate-700">{customerHealth?.summary?.insufficientHistoryCount || 0}</span>
              </div>
            </div>

            {/* Top Accounts at Risk */}
            <div>
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">
                Accounts Requiring Payment Attention
              </h3>
              {!customerHealth?.riskAccounts || customerHealth.riskAccounts.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                  All accounts have zero overdue debt and healthy payment ratings.
                </div>
              ) : (
                <div className="space-y-2">
                  {customerHealth.riskAccounts.map((acc: any) => (
                    <div
                      key={acc.id}
                      className="p-3 bg-slate-50 hover:bg-slate-100/70 rounded-xl border border-slate-200/80 flex items-center justify-between text-xs transition"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 truncate">{acc.name}</span>
                          {getScoreBadge(acc.paymentScore, acc.category)}
                        </div>
                        <span className="text-slate-500 text-[11px] mt-0.5 block truncate">
                          {acc.email || acc.phone || 'No direct contact'}
                        </span>
                      </div>

                      <div className="text-right shrink-0 ml-3">
                        <span className="font-bold text-slate-800 block">
                          Total: {formatCurrency(acc.outstandingBalance || 0, currency)}
                        </span>
                        {acc.overdueBalance > 0 && (
                          <span className="text-rose-600 font-bold text-[11px]">
                            Overdue: {formatCurrency(acc.overdueBalance, currency)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Verified ledger source: Subledger AR 1200</span>
            <Link to="/dashboard/orders" className="text-primary-600 hover:underline font-semibold">
              Filter Overdue in Orders &rarr;
            </Link>
          </div>
        </section>

        {/* Vendor Verification Summary (1 col) */}
        <section className="bg-white/95 backdrop-blur-xl p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="text-emerald-600" size={20} />
                Vendor Verification
              </h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {vendorSummary?.totalVendors || 0} Registered
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Automated statutory GSTIN/EIN validation, SSRF-guarded domain checks, and compliance status.
            </p>

            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-xs">
                <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  Verified Partners
                </span>
                <span className="font-extrabold text-emerald-800 text-sm">
                  {vendorSummary?.statusCounts?.VERIFIED || 0}
                </span>
              </div>

              <div className="flex justify-between items-center p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs">
                <span className="font-semibold text-amber-900 flex items-center gap-1.5">
                  <Clock size={14} className="text-amber-600" />
                  Partial / In Pipeline
                </span>
                <span className="font-extrabold text-amber-800 text-sm">
                  {(vendorSummary?.statusCounts?.PARTIALLY_VERIFIED || 0) + (vendorSummary?.statusCounts?.PENDING_VERIFICATION || 0)}
                </span>
              </div>

              <div className="flex justify-between items-center p-3 rounded-xl bg-rose-50 border border-rose-100 text-xs">
                <span className="font-semibold text-rose-900 flex items-center gap-1.5">
                  <AlertCircle size={14} className="text-rose-600" />
                  Failed / Review Required
                </span>
                <span className="font-extrabold text-rose-800 text-sm">
                  {(vendorSummary?.statusCounts?.VERIFICATION_FAILED || 0) + (vendorSummary?.statusCounts?.MANUAL_REVIEW_REQUIRED || 0)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100">
            <Link
              to="/dashboard/vendors"
              className="w-full py-2.5 px-4 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm"
            >
              <ShieldCheck size={14} />
              Open Vendor Centre &rarr;
            </Link>
          </div>
        </section>
      </div>

      {/* Background Jobs Queue & Operational Synchronization Card */}
      <section className="bg-white/90 backdrop-blur-xl p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Layers size={20} className="text-indigo-600" /> Background Jobs &amp; Sync Pipeline
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Authoritative OperationalSyncJob states and Google Sheets synchronization worker queue.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold">
              Queued: {syncJobsSummary.queued}
            </span>
            <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold">
              Processing: {syncJobsSummary.processing}
            </span>
            <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-lg text-xs font-semibold">
              Retrying: {syncJobsSummary.retrying}
            </span>
            <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold">
              Succeeded: {syncJobsSummary.succeeded}
            </span>
            <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${syncJobsSummary.failed > 0 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
              Failed: {syncJobsSummary.failed}
            </span>
          </div>
        </div>

        {jobs?.recentSyncJobs?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-y border-slate-100 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Entity Type</th>
                  <th className="py-2.5 px-3">Operation</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Attempts</th>
                  <th className="py-2.5 px-3">Last Updated</th>
                  <th className="py-2.5 px-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {jobs.recentSyncJobs.slice(0, 6).map((j: any) => {
                  let badge = 'bg-slate-100 text-slate-700';
                  if (j.status === 'SUCCEEDED') badge = 'bg-emerald-100 text-emerald-800';
                  else if (j.status === 'PROCESSING') badge = 'bg-blue-100 text-blue-800 animate-pulse';
                  else if (j.status === 'RETRYING') badge = 'bg-amber-100 text-amber-800';
                  else if (j.status === 'FAILED') badge = 'bg-rose-100 text-rose-800';

                  return (
                    <tr key={j.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{j.entityType}</td>
                      <td className="py-2.5 px-3 font-mono">{j.operation}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${badge}`}>
                          {j.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">{j.attemptCount}</td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {new Date(j.updatedAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-3">
                        {j.status === 'FAILED' ? (
                          <button
                            onClick={() => handleRetrySyncJob(j.id, j.entityType)}
                            disabled={actionLoading[j.id]}
                            className="text-xs font-bold text-primary-600 hover:text-primary-800 disabled:opacity-50"
                          >
                            {actionLoading[j.id] ? 'Retrying...' : 'Retry'}
                          </button>
                        ) : (
                          <span className="text-slate-400">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500 text-center py-6 bg-slate-50 rounded-xl border border-slate-100">
            No synchronization jobs registered yet. Synchronizations will queue automatically on document creation.
          </p>
        )}
      </section>

      {/* Connectors & System Integrations */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Google Sheets Connector */}
        <section className="bg-white/90 backdrop-blur-xl p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="text-emerald-600" size={20} />
                <h3 className="text-sm font-bold text-slate-900">Google Sheets</h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                  sheetsStatus === 'SYNCED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : sheetsStatus === 'SYNCING'
                    ? 'bg-blue-100 text-blue-800 animate-pulse'
                    : sheetsStatus === 'FAILED'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {sheetsStatus}
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-slate-600">
              <p>
                Spreadsheet:{' '}
                <strong className="text-slate-800">
                  {connectors?.googleSheets?.spreadsheetName || 'Not linked'}
                </strong>
              </p>
              <p>
                Last synced:{' '}
                {connectors?.googleSheets?.lastSyncedAt
                  ? new Date(connectors.googleSheets.lastSyncedAt).toLocaleString()
                  : 'Never synced'}
              </p>
              {connectors?.googleSheets?.errorMessage && (
                <p className="text-rose-600 font-medium">Error: {connectors.googleSheets.errorMessage}</p>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            {connectors?.googleSheets?.url ? (
              <a
                href={connectors.googleSheets.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary-600 hover:underline font-semibold flex items-center gap-1"
              >
                Open Spreadsheet <ExternalLink size={12} />
              </a>
            ) : (
              <span className="text-slate-400">No URL</span>
            )}
            <Link to="/dashboard/integrations" className="text-slate-500 hover:text-slate-800 font-semibold">
              Settings
            </Link>
          </div>
        </section>

        {/* Google Drive Storage */}
        <section className="bg-white/90 backdrop-blur-xl p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="text-blue-600" size={20} />
                <h3 className="text-sm font-bold text-slate-900">Google Drive</h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                  driveStatus === 'CONNECTED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {driveStatus}
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-slate-600">
              <p>
                Account:{' '}
                <strong className="text-slate-800 truncate block">
                  {connectors?.googleDrive?.accountEmail || 'Not connected'}
                </strong>
              </p>
              <p>
                Stored Documents:{' '}
                <strong className="text-slate-800">
                  {connectors?.googleDrive?.storedDocumentsCount || 0} files
                </strong>
              </p>
              <p>
                Last verified:{' '}
                {connectors?.googleDrive?.lastVerifiedAt
                  ? new Date(connectors.googleDrive.lastVerifiedAt).toLocaleDateString()
                  : 'N/A'}
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Quotations &amp; Invoices</span>
            <Link to="/dashboard/integrations" className="text-slate-500 hover:text-slate-800 font-semibold">
              Configure
            </Link>
          </div>
        </section>

        {/* Gmail Intake */}
        <section className="bg-white/90 backdrop-blur-xl p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Mail className="text-rose-600" size={20} />
                <h3 className="text-sm font-bold text-slate-900">Gmail Connector</h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                  connectors?.gmail?.status === 'CONNECTED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {connectors?.gmail?.status || 'NOT_CONFIGURED'}
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-slate-600">
              <p>
                Connected Inbox:{' '}
                <strong className="text-slate-800 truncate block">
                  {connectors?.gmail?.accountEmail || 'No inbox linked'}
                </strong>
              </p>
              <p>
                Last checked:{' '}
                {connectors?.gmail?.lastConnectedAt
                  ? new Date(connectors.gmail.lastConnectedAt).toLocaleString()
                  : 'N/A'}
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Enquiry Intake</span>
            <Link to="/dashboard/integrations" className="text-slate-500 hover:text-slate-800 font-semibold">
              Manage
            </Link>
          </div>
        </section>
      </div>

      {/* Business Funnel & Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* D. Conversion Funnel */}
        <section className="bg-white/90 backdrop-blur-xl p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp size={20} className="text-primary-600" /> Operational Conversion Funnel
            </h2>
            <span className="text-xs text-slate-500">Live Stage Velocity</span>
          </div>

          <div className="flex-1 flex flex-col space-y-3">
            {funnel?.stages?.map((stage: any, index: number) => {
              const maxCount = Math.max(...(funnel?.stages?.map((s: any) => s.count) || []), 1);
              const percentage = (stage.count / maxCount) * 100;

              return (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-700">{stage.name}</span>
                    <span className="font-bold text-slate-900">{stage.count}</span>
                  </div>
                  <div className="h-6 w-full bg-slate-100 rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-lg transition-all duration-700"
                      style={{ width: `${Math.max(percentage, stage.count > 0 ? 5 : 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* F. Activity Timeline */}
        <section className="bg-white/90 backdrop-blur-xl p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Activity size={20} className="text-blue-600" /> Recent Operational Audit Trail
          </h2>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar max-h-[360px]">
            {activity?.length === 0 ? (
              <p className="text-xs text-slate-500 text-center mt-12">No recent audit log entries recorded.</p>
            ) : (
              <div className="space-y-3">
                {activity?.map((act: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-xl bg-slate-50/80 border border-slate-100 text-xs"
                  >
                    <div
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        act.status === 'FAILED' ? 'bg-rose-500' : 'bg-emerald-500'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-800 truncate">{act.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {new Date(act.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* AI Intelligence & Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* AI Insights */}
        <section className="bg-white/90 backdrop-blur-xl p-6 rounded-2xl border border-purple-100 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Cpu size={20} className="text-purple-600" /> Operational Intelligence
            </h2>
            <div className="space-y-3">
              {insights?.insights?.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">No automated recommendations at this time.</p>
              ) : (
                insights?.insights?.map((ins: any, i: number) => (
                  <div key={i} className="p-3.5 bg-purple-50/80 border border-purple-200/80 rounded-xl">
                    <p className="text-xs font-semibold text-purple-950">{ins.text}</p>
                    <p className="text-[11px] text-purple-700 mt-1">Evidence: {ins.evidence}</p>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-purple-50 text-xs text-purple-700">
            Rule-driven insight generation enabled
          </div>
        </section>

        {/* Quick Operations Actions */}
        <section className="bg-white/90 backdrop-blur-xl p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Settings size={20} className="text-slate-600" /> Operational Navigation
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Link
                to="/dashboard/enquiries"
                className="p-3 text-center bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 transition"
              >
                Enquiry Inbox
              </Link>
              <Link
                to="/dashboard/orders"
                className="p-3 text-center bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 transition"
              >
                Orders &amp; Invoices
              </Link>
              <Link
                to="/dashboard/workflows"
                className="p-3 text-center bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 transition"
              >
                Workflows Centre
              </Link>
              <Link
                to="/dashboard/integrations"
                className="p-3 text-center bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 transition"
              >
                Connect Integrations
              </Link>
              <Link
                to="/dashboard/settings"
                className="p-3 text-center col-span-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 transition"
              >
                Business Profile &amp; Tax Settings
              </Link>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4 text-center">
            Agent Flux v2.0 Operational Runtime
          </p>
        </section>
      </div>

      {/* Create Order Modal */}
      <CreateOrderModal
        isOpen={isCreateOrderOpen}
        onClose={() => setIsCreateOrderOpen(false)}
        onOrderCreated={(newOrder) => {
          setIsCreateOrderOpen(false);
          addToast({
            type: 'success',
            title: 'Order Created',
            message: `Order ${newOrder.orderNumber} successfully registered with priority ${newOrder.priority || 'NORMAL'}`
          });
          fetchData(true);
        }}
        businessId={business.id}
        currency={currency}
      />
    </div>
  );
}
