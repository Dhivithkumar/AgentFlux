import { useState, useEffect } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { CheckCircle2, Circle, TrendingUp, AlertCircle, Check, X, Settings } from 'lucide-react';

export default function DashboardOverview() {
  const { business } = useOutletContext<{ business: any }>();
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [funnel, setFunnel] = useState<any>(null);
  const [revenue, setRevenue] = useState<any>(null);
  const [improvements, setImprovements] = useState<any[]>([]);
  const [actionZone, setActionZone] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    if (!business) return;
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

      const [intRes, overRes, funnelRes, revRes, impRes, actionRes] = await Promise.all([
        getSafe(`/integrations?businessId=${business.id}`),
        getSafe(`/businesses/${business.id}/analytics/overview`),
        getSafe(`/businesses/${business.id}/analytics/funnel`),
        getSafe(`/businesses/${business.id}/analytics/revenue`),
        getSafe(`/businesses/${business.id}/analytics/improvements`),
        getSafe(`/businesses/${business.id}/analytics/action-zone`)
      ]);
      
      setIntegrations(intRes || []);
      setOverview(overRes || { revenue: 0, orders: 0, enquiries: 0, pendingActions: 0 });
      setFunnel(funnelRes || { stages: [], conversionRates: {} });
      setRevenue(revRes || { netRevenue: 0, outstandingAmount: 0, refunds: 0 });
      setImprovements(impRes || []);
      setActionZone(actionRes || { pendingApprovals: [], pendingOrders: [], overdueInvoices: [], stuckEnquiries: [] });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [business]);

  const handleReview = async (id: string, status: string) => {
    try {
      await apiCall(`/businesses/${business.id}/analytics/improvements/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ status })
      });
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading || !overview) {
    return <div className="p-8 text-center text-slate-500">Loading Analytics...</div>;
  }

  const kpis = [
    { label: 'Revenue', value: `$${(overview.revenue || 0).toLocaleString()}`, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Orders', value: overview.orders.toString(), color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Enquiries', value: overview.enquiries.toString(), color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Pending Actions', value: overview.pendingActions.toString(), color: overview.pendingActions > 0 ? 'text-rose-600' : 'text-slate-600', bg: overview.pendingActions > 0 ? 'bg-rose-50' : 'bg-slate-50' }
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
      {/* Top Bar Status */}
      <div className="flex items-center justify-between bg-white/70 backdrop-blur-xl px-6 py-4 rounded-2xl border border-white/50 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          Business Command Centre
        </h1>
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          Live Data
        </div>
      </div>

      {/* Band 1: Primary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {kpis.map((kpi, i) => (
          <div key={i} className="group relative overflow-hidden bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-1">
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-bl-full opacity-20 transition-transform duration-500 group-hover:scale-110 ${kpi.bg}`} />
            <p className="text-sm font-medium text-slate-500 mb-2 relative z-10">{kpi.label}</p>
            <p className={`text-4xl font-bold relative z-10 transition-colors duration-300 ${kpi.color}`}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Band 2: What Needs You (Action Zone) */}
      {/* Band 2: What Needs You (Action Zone) */}
      <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-rose-100 shadow-md flex flex-col transition-all duration-300 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-2 h-full bg-rose-500"></div>
        <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2 ml-4">
          <AlertCircle size={24} className="text-rose-500" /> What Needs You
        </h2>
        
        {(!actionZone?.pendingApprovals?.length && !actionZone?.pendingOrders?.length && !actionZone?.overdueInvoices?.length && !actionZone?.stuckEnquiries?.length) ? (
          <div className="ml-4 p-8 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-3" />
            <h3 className="text-sm font-semibold text-slate-700">You're all caught up!</h3>
            <p className="text-xs text-slate-500 mt-1">There are no pending approvals, overdue invoices, or stuck orders needing your attention right now.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 ml-4">
            {/* Approvals */}
            {actionZone?.pendingApprovals?.length > 0 && (
              <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider sticky top-0 bg-white/90 backdrop-blur pb-2 pt-1 z-10">Pending Approvals ({actionZone.pendingApprovals.length})</h3>
                {actionZone.pendingApprovals.map((ap: any) => (
                  <Link key={ap.id} to={`/dashboard/approvals`} className="block p-4 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 hover:shadow-sm transition-all group shrink-0">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-semibold text-amber-900 group-hover:text-amber-700 transition-colors">Review Required</p>
                      <AlertCircle size={16} className="text-amber-500" />
                    </div>
                    <p className="text-xs text-amber-700 mt-1">Requested: {new Date(ap.createdAt).toLocaleDateString()}</p>
                  </Link>
                ))}
              </div>
            )}
            
            {/* Pending Orders (Owner Confirmation) */}
            {actionZone?.pendingOrders?.length > 0 && (
              <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider sticky top-0 bg-white/90 backdrop-blur pb-2 pt-1 z-10">Owner Confirmation ({actionZone.pendingOrders.length})</h3>
                {actionZone.pendingOrders.map((order: any) => (
                  <Link key={order.id} to={`/dashboard/orders/${order.id}`} className="block p-4 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 hover:shadow-sm transition-all group shrink-0">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-semibold text-blue-900 group-hover:text-blue-700 transition-colors truncate pr-2">{order.customer?.name || 'Customer'}</p>
                      <AlertCircle size={16} className="text-blue-500" />
                    </div>
                    <p className="text-xs text-blue-700 mt-1">Order {order.id.substring(0,8)} requires your confirmation.</p>
                  </Link>
                ))}
              </div>
            )}
            
            {/* Overdue */}
            {actionZone?.overdueInvoices?.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Overdue Payments ({actionZone.overdueInvoices.length})</h3>
                {actionZone.overdueInvoices.map((inv: any) => (
                  <Link key={inv.id} to={`/dashboard/orders`} className="block p-4 rounded-xl bg-rose-50 border border-rose-200 hover:bg-rose-100 hover:shadow-sm transition-all group">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-semibold text-rose-900 group-hover:text-rose-700 transition-colors">Invoice {inv.id.substring(0,8)}</p>
                      <AlertCircle size={16} className="text-rose-500" />
                    </div>
                    <p className="text-xs text-rose-700 mt-1 font-medium">${inv.order?.totalAmount || '0'} • Due: {new Date(inv.dueDate).toLocaleDateString()}</p>
                  </Link>
                ))}
              </div>
            )}

            {/* Stuck */}
            {actionZone?.stuckEnquiries?.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Stuck Enquiries ({actionZone.stuckEnquiries.length})</h3>
                {actionZone.stuckEnquiries.map((enq: any) => (
                  <Link key={enq.id} to={`/dashboard/enquiries`} className="block p-4 rounded-xl bg-orange-50 border border-orange-200 hover:bg-orange-100 hover:shadow-sm transition-all group">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-semibold text-orange-900 group-hover:text-orange-700 transition-colors truncate pr-2">{enq.customer?.name || 'Customer'}</p>
                      <Circle size={12} className="text-orange-500 fill-orange-500" />
                    </div>
                    <p className="text-xs text-orange-700 mt-1">Stuck in {enq.status} • {Math.floor((Date.now() - new Date(enq.createdAt).getTime()) / (1000 * 60 * 60 * 24))} days</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Band 3: The Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Business Funnel */}
        <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col transition-all duration-300 hover:shadow-md">
          <h2 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
            <TrendingUp size={20} className="text-primary-500" /> Business Funnel
          </h2>
          <div className="flex-1 flex flex-col justify-center space-y-4">
            {funnel?.stages?.map((stage: any, index: number) => {
              const max = Math.max(...funnel.stages.map((s: any) => s.count)) || 1;
              const width = Math.max(10, (stage.count / max) * 100);
              return (
                <div key={index} className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm font-medium text-slate-700">
                    <span>{stage.name}</span>
                    <span>{stage.count}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-primary-400 to-primary-600 h-full rounded-full transition-all duration-1000"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500">Enquiry to Order</p>
              <p className="text-lg font-semibold text-slate-800">
                {(funnel?.conversionRates?.overall || 0).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Invoice to Payment</p>
              <p className="text-lg font-semibold text-slate-800">
                {(funnel?.conversionRates?.invoiceToPayment || 0).toFixed(1)}%
              </p>
            </div>
          </div>
        </section>

        {/* Revenue Analytics */}
        <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col transition-all duration-300 hover:shadow-md">
          <h2 className="text-lg font-semibold text-slate-900 mb-6">Financial Overview</h2>
          <div className="grid grid-cols-2 gap-4 flex-1">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-center items-center text-center">
              <p className="text-sm font-medium text-slate-500">Net Revenue</p>
              <p className="text-3xl font-bold text-emerald-600 mt-2">${(revenue?.netRevenue || 0).toLocaleString()}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-center items-center text-center">
              <p className="text-sm font-medium text-slate-500">Outstanding</p>
              <p className="text-3xl font-bold text-amber-500 mt-2">${(revenue?.outstandingAmount || 0).toLocaleString()}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-center items-center text-center col-span-2">
              <p className="text-sm font-medium text-slate-500">Refunds</p>
              <p className="text-xl font-bold text-rose-500 mt-2">${(revenue?.refunds || 0).toLocaleString()}</p>
            </div>
          </div>
        </section>

        {/* AI-Generated Evidence-Based Insights (Recommendations) */}
        <section className="lg:col-span-2 bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col transition-all duration-300 hover:shadow-md">
          <h2 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
            <span className="text-xl">✨</span> Continuous Improvement & AI Insights
          </h2>
          
          <div className="space-y-4">
            {improvements.filter((imp: any) => imp.status === 'NEW').length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No new recommendations generated yet.
              </div>
            ) : (
              improvements.filter((imp: any) => imp.status === 'NEW').map((imp: any) => (
                <div key={imp.id} className="bg-indigo-50 border border-indigo-100 rounded-xl p-5 flex flex-col md:flex-row gap-4 justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-indigo-200 text-indigo-800">
                        {imp.category}
                      </span>
                      <h3 className="font-semibold text-slate-900">{imp.title}</h3>
                    </div>
                    <p className="text-slate-600 text-sm mb-3">{imp.description}</p>
                    <div className="bg-white/60 p-3 rounded-lg text-xs font-mono text-slate-500 border border-indigo-50">
                      <strong>Evidence:</strong> {JSON.stringify(imp.evidence)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 md:flex-col justify-center">
                    <button 
                      onClick={() => handleReview(imp.id, 'APPROVED')}
                      className="flex items-center gap-1 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition"
                    >
                      <Check size={16} /> Approve
                    </button>
                    <button 
                      onClick={() => handleReview(imp.id, 'DISMISSED')}
                      className="flex items-center gap-1 bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-300 transition"
                    >
                      <X size={16} /> Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* System Health */}
        <section className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm flex flex-col transition-all duration-300 hover:shadow-md">
          <h2 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
            <Settings size={20} className="text-slate-600" /> System Health
          </h2>
          <div className="flex-1 flex flex-col gap-4">
             {integrations.length === 0 ? (
                <p className="text-slate-500 text-center">No connectors configured.</p>
             ) : (
                integrations.map(int => (
                  <div key={int.id} className="flex justify-between items-center p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="font-medium text-slate-700 capitalize">{int.provider}</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${int.status === 'CONNECTED' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {int.status}
                    </span>
                  </div>
                ))
             )}
          </div>
        </section>
      </div>
    </div>
  );
}
