import { useState, useEffect } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { CheckCircle2, Circle, TrendingUp, AlertCircle, RefreshCcw, DollarSign, Activity, FileText, Check, Settings, Mail, ShieldAlert, Cpu } from 'lucide-react';

export default function DashboardOverview() {
  const { business, user } = useOutletContext<{ business: any, user: any }>();
  const [data, setData] = useState<{
    overview: any,
    actionZone: any,
    funnel: any,
    revenue: any,
    activity: any[],
    connectors: any,
    configAlerts: any,
    insights: any
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!business) return;
    setLoading(true);
    setError(null);
    try {
      const getSafe = async (url: string) => {
        try {
          const res = await apiCall(url);
          return res.data;
        } catch (err: any) {
          console.error(`Error fetching ${url}:`, err);
          return null;
        }
      };

      const [overview, actionZone, funnel, revenue, activity, connectors, configAlerts, insights] = await Promise.all([
        getSafe(`/businesses/${business.id}/analytics/overview`),
        getSafe(`/businesses/${business.id}/analytics/action-zone`),
        getSafe(`/businesses/${business.id}/analytics/funnel`),
        getSafe(`/businesses/${business.id}/analytics/revenue`),
        getSafe(`/businesses/${business.id}/analytics/activity`),
        getSafe(`/businesses/${business.id}/analytics/connectors`),
        getSafe(`/businesses/${business.id}/analytics/configuration-alerts`),
        getSafe(`/businesses/${business.id}/analytics/insights`)
      ]);
      
      setData({ overview, actionZone, funnel, revenue, activity: activity || [], connectors, configAlerts, insights });
      setLastRefresh(new Date());
    } catch (e) {
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000); // 1 min
    return () => clearInterval(interval);
  }, [business]);

  if (loading && !data) {
    return <div className="flex h-[50vh] items-center justify-center text-slate-500">
      <RefreshCcw className="animate-spin mr-3 text-primary-500" /> Loading Command Centre...
    </div>;
  }
  
  if (error) {
    return <div className="p-8 text-center text-rose-500 bg-rose-50 rounded-2xl border border-rose-200">
      <AlertCircle size={32} className="mx-auto mb-2" />
      <p>{error}</p>
      <button onClick={loadData} className="mt-4 px-4 py-2 bg-rose-100 hover:bg-rose-200 rounded-lg text-sm font-medium transition">Retry</button>
    </div>;
  }

  const { overview, actionZone, funnel, revenue, activity, connectors, configAlerts, insights } = data!;
  
  return (
    <div className="max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500 pb-12 px-2">
      {/* A. Global Business Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white/70 backdrop-blur-xl px-6 py-4 rounded-2xl border border-white/50 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            Business Command Centre
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Welcome back, {user?.name || 'User'}. Viewing data for <span className="font-semibold text-slate-700">{business?.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-4 mt-4 md:mt-0">
          <div className="text-sm text-slate-500 text-right">
            <p>Last synced: {lastRefresh.toLocaleTimeString()}</p>
            <p className="flex items-center justify-end gap-1 mt-1 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              All systems operational
            </p>
          </div>
          <button onClick={loadData} className="p-2 hover:bg-slate-100 rounded-full transition" title="Refresh Dashboard">
            <RefreshCcw size={18} className={`text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* K. Configuration Alerts */}
      {configAlerts?.alerts?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
          <ShieldAlert className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-amber-900">Configuration Required</h3>
            <ul className="list-disc ml-5 mt-1 text-sm text-amber-800 space-y-1">
              {configAlerts.alerts.map((alert: string, i: number) => (
                <li key={i}>{alert}</li>
              ))}
            </ul>
            <Link to="/dashboard/settings" className="inline-block mt-3 text-xs font-semibold text-amber-700 hover:text-amber-900 underline">Go to Settings</Link>
          </div>
        </div>
      )}

      {/* B. Executive KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Revenue Collected', value: `$${(overview?.revenue || 0).toLocaleString()}`, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Confirmed Orders', value: overview?.orders || '0', color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'New Enquiries', value: overview?.enquiries || '0', color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Pending Actions', value: overview?.pendingActions || '0', color: overview?.pendingActions > 0 ? 'text-rose-600' : 'text-slate-600', bg: overview?.pendingActions > 0 ? 'bg-rose-50' : 'bg-slate-50' },
          { label: 'Outstanding Invoices', value: `$${(revenue?.outstanding || 0).toLocaleString()}`, color: revenue?.outstanding > 0 ? 'text-orange-600' : 'text-slate-600', bg: 'bg-orange-50' },
          { label: 'Overdue Invoices', value: `$${(actionZone?.overdueInvoices?.reduce((acc:any, i:any)=>acc+i.totalAmount, 0) || 0).toLocaleString()}`, color: actionZone?.overdueInvoices?.length > 0 ? 'text-rose-600' : 'text-slate-600', bg: 'bg-rose-50' },
          { label: 'Pending Quotations', value: overview?.pendingQuotations || '0', color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Automation Success', value: `${(overview?.automationSuccessRate || 100).toFixed(1)}%`, color: 'text-teal-600', bg: 'bg-teal-50' }
        ].map((kpi, i) => (
          <div key={i} className="bg-white/70 backdrop-blur-xl p-5 rounded-2xl border border-white/50 shadow-sm hover:shadow-md transition-all duration-300">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{kpi.label}</p>
            <p className={`text-2xl md:text-3xl font-bold ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* C. What Needs You Now (Takes up 2/3 width on large screens) */}
        <section className="xl:col-span-2 bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-rose-100 shadow-md flex flex-col transition-all relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-rose-500"></div>
          <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2 ml-4">
            <AlertCircle size={22} className="text-rose-500" /> What Needs You Now
          </h2>
          
          {(!actionZone?.pendingApprovals?.length && !actionZone?.pendingOrders?.length && !actionZone?.overdueInvoices?.length && !actionZone?.stuckEnquiries?.length && !actionZone?.failedWorkflows?.length) ? (
            <div className="ml-4 flex-1 flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <CheckCircle2 size={40} className="text-emerald-400 mb-3" />
              <h3 className="text-base font-semibold text-slate-700">You're all caught up!</h3>
              <p className="text-sm text-slate-500 mt-1">No pending actions require your immediate attention.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-4">
              {actionZone?.pendingApprovals?.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pending Approvals</h3>
                  {actionZone.pendingApprovals.map((ap: any) => (
                    <Link key={ap.id} to={`/dashboard/approvals`} className="block p-4 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 hover:shadow-sm transition-all group">
                      <div className="flex justify-between items-center">
                        <p className="text-sm font-semibold text-amber-900">Review Required</p>
                      </div>
                      <p className="text-xs text-amber-700 mt-1">Requested: {new Date(ap.createdAt).toLocaleDateString()}</p>
                    </Link>
                  ))}
                </div>
              )}
              {actionZone?.pendingOrders?.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Owner Confirmation</h3>
                  {actionZone.pendingOrders.map((order: any) => (
                    <div key={order.id} className="block p-4 rounded-xl bg-blue-50 border border-blue-200 hover:shadow-sm transition-all group">
                      <div className="flex justify-between items-start">
                        <Link to={`/dashboard/orders/${order.id}`} className="hover:underline">
                          <p className="text-sm font-semibold text-blue-900 truncate">{order.customer?.name || 'Customer'}</p>
                          <p className="text-xs text-blue-700 mt-1">Order {order.orderNumber || order.id.substring(0,8)} requires confirmation.</p>
                        </Link>
                        <button
                          onClick={async () => {
                            try {
                              const btn = document.getElementById(`dash-btn-accept-${order.id}`);
                              if (btn) btn.innerText = 'Accepting...';
                              await apiCall(`/businesses/${business.id}/orders/${order.id}/status`, {
                                method: 'POST',
                                body: JSON.stringify({ status: 'CONFIRMED', reason: 'Owner accepted the order from dashboard' })
                              });
                              alert('Order confirmed!');
                              loadData();
                            } catch (e: any) {
                              alert(e.message || 'Failed to confirm order');
                              const btn = document.getElementById(`dash-btn-accept-${order.id}`);
                              if (btn) btn.innerText = 'Accept Order';
                            }
                          }}
                          id={`dash-btn-accept-${order.id}`}
                          className="px-2 py-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow-sm transition"
                        >
                          Accept Order
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {actionZone?.overdueInvoices?.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Overdue Invoices</h3>
                  {actionZone.overdueInvoices.map((inv: any) => (
                    <Link key={inv.id} to={`/dashboard/orders`} className="block p-4 rounded-xl bg-rose-50 border border-rose-200 hover:bg-rose-100 hover:shadow-sm transition-all group">
                      <p className="text-sm font-semibold text-rose-900">Invoice {inv.invoiceNumber || inv.id.substring(0,8)}</p>
                      <p className="text-xs text-rose-700 mt-1 font-medium">${inv.totalAmount} • Due: {new Date(inv.dueDate).toLocaleDateString()}</p>
                    </Link>
                  ))}
                </div>
              )}
              {actionZone?.failedWorkflows?.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Failed Automations</h3>
                  {actionZone.failedWorkflows.map((wf: any) => (
                    <Link key={wf.id} to={`/dashboard/workflows`} className="block p-4 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 hover:shadow-sm transition-all group">
                      <p className="text-sm font-semibold text-red-900">Execution Failed</p>
                      <p className="text-xs text-red-700 mt-1">{new Date(wf.startedAt).toLocaleString()}</p>
                    </Link>
                  ))}
                </div>
              )}
              {actionZone?.stuckEnquiries?.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Stuck Enquiries (&gt;48h)</h3>
                  {actionZone.stuckEnquiries.map((enq: any) => (
                    <Link key={enq.id} to={`/dashboard/enquiries`} className="block p-4 rounded-xl bg-orange-50 border border-orange-200 hover:bg-orange-100 hover:shadow-sm transition-all group">
                      <p className="text-sm font-semibold text-orange-900 truncate">{enq.customer?.name || 'Customer'}</p>
                      <p className="text-xs text-orange-700 mt-1">Stuck in NEW state</p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* E. Financial Overview */}
        <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <DollarSign size={20} className="text-emerald-500" /> Financial Overview
          </h2>
          <div className="space-y-4 flex-1">
            <div className="flex justify-between items-end border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Total Invoiced</p>
                <p className="text-lg font-semibold text-slate-800">${(revenue?.totalInvoiced || 0).toLocaleString()}</p>
              </div>
            </div>
            <div className="flex justify-between items-end border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Collected Revenue</p>
                <p className="text-lg font-semibold text-emerald-600">${(revenue?.collected || 0).toLocaleString()}</p>
              </div>
            </div>
            <div className="flex justify-between items-end border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Outstanding Balance</p>
                <p className="text-lg font-semibold text-orange-600">${(revenue?.outstanding || 0).toLocaleString()}</p>
              </div>
            </div>
            <div className="flex justify-between items-end pb-3">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Refunds</p>
                <p className="text-lg font-semibold text-rose-600">${(revenue?.refunds || 0).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* D. Business Funnel */}
        <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <TrendingUp size={20} className="text-primary-500" /> Business Funnel
          </h2>
          <div className="flex-1 flex flex-col space-y-3">
            {funnel?.stages?.map((stage: any, index: number) => {
              const maxCount = Math.max(...(funnel?.stages?.map((s:any)=>s.count)||[]), 1);
              const percentage = (stage.count / maxCount) * 100;
              let conversionKey = '';
              if (index === 1) conversionKey = 'qualified';
              if (index === 2) conversionKey = 'quoted';
              if (index === 3) conversionKey = 'accepted';
              if (index === 4) conversionKey = 'ordersAwaiting';
              if (index === 5) conversionKey = 'confirmed';
              if (index === 6) conversionKey = 'invoiced';
              if (index === 7) conversionKey = 'paid';
              
              const conversion = index > 0 && funnel.conversionRates ? funnel.conversionRates[conversionKey] : null;

              return (
                <div key={index} className="relative">
                  <div className="flex justify-between text-sm mb-1 z-10 relative px-2">
                    <span className="font-medium text-slate-700">{stage.name}</span>
                    <div className="flex items-center gap-3">
                      {conversion !== null && (
                        <span className="text-xs text-slate-400 bg-slate-100 px-1.5 rounded">{conversion.toFixed(1)}% conversion</span>
                      )}
                      <span className="font-bold text-slate-900">{stage.count}</span>
                    </div>
                  </div>
                  <div className="h-8 w-full bg-slate-100 rounded-lg overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-primary-400 to-primary-600 rounded-lg transition-all duration-1000"
                      style={{ width: `${Math.max(percentage, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* F. Activity Timeline */}
        <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Activity size={20} className="text-blue-500" /> Recent Activity
          </h2>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar max-h-[400px]">
            {activity?.length === 0 ? (
              <p className="text-sm text-slate-500 text-center mt-10">No recent activity found.</p>
            ) : (
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                {activity?.map((act: any, i: number) => (
                  <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-5 h-5 rounded-full border border-white bg-slate-200 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <div className={`w-2 h-2 rounded-full ${act.status === 'FAILED' ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
                    </div>
                    <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-white p-3 rounded-lg border border-slate-100 shadow-sm text-sm">
                      <p className="font-semibold text-slate-800">{act.title}</p>
                      <time className="block text-xs font-medium text-slate-400 mt-1">
                        {new Date(act.timestamp).toLocaleString()}
                      </time>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* H. Integration Health */}
        <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Settings size={20} className="text-slate-500" /> Integration Health
          </h2>
          <div className="space-y-3">
            {connectors?.health?.length === 0 ? (
              <p className="text-sm text-slate-500 text-center mt-4">No integrations configured.</p>
            ) : (
              connectors?.health?.map((conn: any, i: number) => (
                <div key={i} className="flex justify-between items-center p-3 border border-slate-100 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Mail size={16} className="text-slate-400" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800 capitalize">{conn.provider.replace('_', ' ')}</p>
                      <p className="text-xs text-slate-500">Last synced: {conn.lastConnectedAt ? new Date(conn.lastConnectedAt).toLocaleDateString() : 'Never'}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${conn.status === 'CONNECTED' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    {conn.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* I. AI Intelligence */}
        <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Cpu size={20} className="text-purple-500" /> AI Intelligence
          </h2>
          <div className="space-y-3">
            {insights?.insights?.length === 0 ? (
              <p className="text-sm text-slate-500 text-center mt-4">Not enough evidence for insights yet.</p>
            ) : (
              insights?.insights?.map((ins: any, i: number) => (
                <div key={i} className="p-3 bg-purple-50 border border-purple-100 rounded-lg">
                  <p className="text-sm font-medium text-purple-900">{ins.text}</p>
                  <p className="text-xs text-purple-600 mt-1 opacity-80">Evidence: {ins.evidence}</p>
                </div>
              ))
            )}
          </div>
        </section>

        {/* J. Quick Actions */}
        <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Check size={20} className="text-blue-500" /> Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/dashboard/enquiries" className="p-3 text-center bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-sm font-medium text-slate-700 transition">View Enquiries</Link>
            <Link to="/dashboard/orders" className="p-3 text-center bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-sm font-medium text-slate-700 transition">Manage Orders</Link>
            <Link to="/dashboard/knowledge" className="p-3 text-center bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-sm font-medium text-slate-700 transition">Upload Knowledge</Link>
            <Link to="/dashboard/workflows" className="p-3 text-center bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-sm font-medium text-slate-700 transition">Workflow Centre</Link>
            <Link to="/dashboard/integrations" className="p-3 text-center col-span-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-sm font-medium text-slate-700 transition">Connect Integrations</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
