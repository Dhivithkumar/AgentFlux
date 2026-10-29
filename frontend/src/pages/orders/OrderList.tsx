import { useEffect, useState, useCallback, useMemo } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { formatCurrency } from '../../lib/currency';
import { useToast } from '../../components/ui/Toast';
import CreateOrderModal from '../../components/orders/CreateOrderModal';
import {
  Plus,
  Search,
  Filter,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  CreditCard,
  RefreshCw,
  Info,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronRight,
  TrendingDown,
  Building2
} from 'lucide-react';

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  amountPaid: number;
  outstandingAmount: number;
  paymentStatus: string;
  paymentTerms?: string;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  priorityScore: number;
  priorityReason?: string;
  priorityFactors?: string[];
  createdAt: string;
  expectedDeliveryDate?: string;
  currency: string;
  customer?: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    paymentScore?: number | null;
    paymentScoreCategory?: string;
    creditLimit?: number;
    totalOutstanding?: number;
    overdueBalance?: number;
  };
  vendor?: {
    id: string;
    name: string;
    verificationStatus: string;
  };
}

export default function OrderList() {
  const { business } = useOutletContext<any>();
  const { addToast } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'PAST'>('ACTIVE');

  // Filters
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('ALL');
  const [exposureFilter, setExposureFilter] = useState<'ALL' | 'OVERDUE_ONLY' | 'HIGH_EXPOSURE'>('ALL');

  // Modals & Drawers
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedPriorityReason, setSelectedPriorityReason] = useState<{
    orderNumber: string;
    priority: string;
    score: number;
    reason: string;
    factors: string[];
  } | null>(null);

  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const currency = business?.currency || 'INR';

  const loadOrders = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await apiCall(`/businesses/${business.id}/orders`);
      const list = Array.isArray(res) ? res : (res?.data || []);
      setOrders(list);
    } catch (error: any) {
      console.error('Failed to load orders:', error);
      addToast({
        type: 'error',
        title: 'Fetch Failed',
        message: error.message || 'Failed to load order intelligence'
      });
    } finally {
      setLoading(false);
    }
  }, [business?.id, addToast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleRecalculatePriority = async (orderId: string, orderNumber: string) => {
    setActionLoading(prev => ({ ...prev, [orderId]: true }));
    try {
      const res = await apiCall(`/businesses/${business.id}/orders/${orderId}/priority/recalculate`, {
        method: 'POST'
      });
      const data = res?.data || res;
      addToast({
        type: 'success',
        title: 'Priority Recalculated',
        message: `Order ${orderNumber} is now ${data.priority} (Score: ${data.priorityScore})`
      });
      await loadOrders();
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Recalculation Failed',
        message: err.message || 'Error updating order priority'
      });
    } finally {
      setActionLoading(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const handleAcceptOrder = async (orderId: string, orderNumber: string) => {
    setActionLoading(prev => ({ ...prev, [orderId]: true }));
    try {
      await apiCall(`/businesses/${business.id}/orders/${orderId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'CONFIRMED', reason: 'Owner accepted from Orders Centre' })
      });
      addToast({
        type: 'success',
        title: 'Order Confirmed',
        message: `Order ${orderNumber} confirmed. Ready for invoicing.`
      });
      await loadOrders();
    } catch (e: any) {
      addToast({
        type: 'error',
        title: 'Failed to Confirm',
        message: e.message || 'Failed to confirm order'
      });
    } finally {
      setActionLoading(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const handleGenerateInvoice = async (orderId: string, orderNumber: string) => {
    setActionLoading(prev => ({ ...prev, [orderId]: true }));
    try {
      await apiCall(`/businesses/${business.id}/orders/${orderId}/generate-invoice`, {
        method: 'POST'
      });
      addToast({
        type: 'success',
        title: 'Invoice Dispatched',
        message: `Invoice generated for Order ${orderNumber} and queued for dispatch.`
      });
      await loadOrders();
    } catch (e: any) {
      addToast({
        type: 'error',
        title: 'Invoicing Failed',
        message: e.message || 'Failed to generate invoice'
      });
    } finally {
      setActionLoading(prev => ({ ...prev, [orderId]: false }));
    }
  };

  // Filter orders
  const activeOrders = useMemo(() => {
    return orders.filter(o => !['COMPLETED', 'CANCELLED', 'DELIVERED', 'REFUNDED'].includes(o.status));
  }, [orders]);

  const pastOrders = useMemo(() => {
    return orders.filter(o => ['COMPLETED', 'CANCELLED', 'DELIVERED', 'REFUNDED'].includes(o.status));
  }, [orders]);

  const baseList = activeTab === 'ACTIVE' ? activeOrders : pastOrders;

  const filteredOrders = useMemo(() => {
    return baseList.filter(o => {
      const q = search.toLowerCase();
      const matchesSearch =
        o.orderNumber.toLowerCase().includes(q) ||
        (o.customer?.name && o.customer.name.toLowerCase().includes(q)) ||
        (o.customer?.phone && o.customer.phone.toLowerCase().includes(q));

      const matchesPriority = priorityFilter === 'ALL' || o.priority === priorityFilter;
      const matchesPayment = paymentStatusFilter === 'ALL' || o.paymentStatus === paymentStatusFilter;

      let matchesExposure = true;
      if (exposureFilter === 'OVERDUE_ONLY') {
        matchesExposure = (o.customer?.overdueBalance || 0) > 0 || o.paymentStatus === 'OVERDUE';
      } else if (exposureFilter === 'HIGH_EXPOSURE') {
        matchesExposure = (o.customer?.totalOutstanding || 0) > (o.customer?.creditLimit || 50000);
      }

      return matchesSearch && matchesPriority && matchesPayment && matchesExposure;
    });
  }, [baseList, search, priorityFilter, paymentStatusFilter, exposureFilter]);

  // Overall financial statistics
  const metrics = useMemo(() => {
    const totalActiveAmount = activeOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const totalOutstanding = activeOrders.reduce((s, o) => s + (o.outstandingAmount !== undefined ? o.outstandingAmount : (o.totalAmount || 0) - (o.amountPaid || 0)), 0);
    const criticalCount = activeOrders.filter(o => o.priority === 'CRITICAL').length;
    const highCount = activeOrders.filter(o => o.priority === 'HIGH').length;
    const overdueCount = activeOrders.filter(o => o.paymentStatus === 'OVERDUE' || (o.customer?.overdueBalance || 0) > 0).length;

    return { totalActiveAmount, totalOutstanding, criticalCount, highCount, overdueCount };
  }, [activeOrders]);

  const getPriorityBadge = (order: Order) => {
    const p = order.priority || 'NORMAL';
    let bg = 'bg-slate-100 text-slate-700 border-slate-200';
    let icon = null;

    if (p === 'CRITICAL') {
      bg = 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
      icon = <AlertTriangle size={13} className="text-rose-600" />;
    } else if (p === 'HIGH') {
      bg = 'bg-amber-100 text-amber-800 border-amber-300 font-semibold';
      icon = <AlertCircle size={13} className="text-amber-600" />;
    } else if (p === 'NORMAL') {
      bg = 'bg-blue-50 text-blue-700 border-blue-200';
    }

    return (
      <button
        onClick={() => {
          setSelectedPriorityReason({
            orderNumber: order.orderNumber,
            priority: p,
            score: order.priorityScore || 0,
            reason: order.priorityReason || 'Calculated automatically based on transaction history and financial exposure.',
            factors: order.priorityFactors || []
          });
        }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border hover:opacity-80 transition cursor-pointer ${bg}`}
        title="Click to view why this order received its priority label"
      >
        {icon}
        <span>{p}</span>
        <span className="text-[10px] opacity-75 font-mono">({order.priorityScore || 0})</span>
        <Info size={11} className="opacity-60" />
      </button>
    );
  };

  const getScoreBadge = (score?: number | null, category?: string) => {
    if (score === null || score === undefined || category === 'INSUFFICIENT_HISTORY') {
      return (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200"
          title="New customer with fewer than 2 verified invoices"
        >
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
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${color}`}
        title={`Payment Score: ${score}/100 based on verified payment timeliness, completion rate, and debt risk.`}
      >
        <span className="font-mono">{score}</span>
        <span className="text-[10px] font-normal uppercase">({label})</span>
      </span>
    );
  };

  const getPaymentStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 size={12} className="text-emerald-600" /> Paid
          </span>
        );
      case 'PARTIALLY_PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock size={12} className="text-amber-600" /> Partial
          </span>
        );
      case 'OVERDUE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
            <AlertCircle size={12} className="text-rose-600" /> Overdue
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
            Unpaid
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header with prominent Create Order CTA */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Orders & Bookings Centre</h1>
          <p className="text-sm text-slate-500 mt-1">
            Order intelligence with priority scoring, customer payment trust, and live credit exposure tracking.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => loadOrders()}
            disabled={loading}
            className="p-2.5 hover:bg-slate-100 active:bg-slate-200 rounded-xl transition border border-slate-200 text-slate-600"
            title="Refresh Orders"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            id="orders-create-order-btn"
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white rounded-xl shadow-md hover:shadow-lg transition font-semibold text-sm"
          >
            <Plus size={18} />
            <span>Create Order</span>
          </button>
        </div>
      </div>

      {/* Operational KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl border bg-white shadow-sm border-slate-200">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Pipeline</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1.5">{activeOrders.length}</p>
          <p className="text-xs text-slate-500 mt-1">{formatCurrency(metrics.totalActiveAmount, currency)} order value</p>
        </div>

        <div className="p-5 rounded-2xl border bg-rose-50/80 shadow-sm border-rose-200">
          <p className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-rose-600" />
            Critical Priority
          </p>
          <p className="text-2xl font-extrabold text-rose-700 mt-1.5">{metrics.criticalCount}</p>
          <p className="text-xs text-rose-600 mt-1">Requires urgent executive processing</p>
        </div>

        <div className="p-5 rounded-2xl border bg-amber-50/80 shadow-sm border-amber-200">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Total Outstanding</p>
          <p className="text-2xl font-extrabold text-amber-700 mt-1.5">
            {formatCurrency(metrics.totalOutstanding, currency)}
          </p>
          <p className="text-xs text-amber-600 mt-1">Uncollected order balances</p>
        </div>

        <div className="p-5 rounded-2xl border bg-purple-50/80 shadow-sm border-purple-200">
          <p className="text-xs font-bold text-purple-800 uppercase tracking-wider">Accounts with Overdue</p>
          <p className="text-2xl font-extrabold text-purple-700 mt-1.5">{metrics.overdueCount}</p>
          <p className="text-xs text-purple-600 mt-1">Clients with overdue exposure</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-4 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('ACTIVE')}
          className={`py-2 px-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'ACTIVE'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Active Orders
          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">
            {activeOrders.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('PAST')}
          className={`py-2 px-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'PAST'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Past & Completed
          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">
            {pastOrders.length}
          </span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row gap-3 items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative w-full lg:w-72">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search by order #, client, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <Filter size={15} className="text-slate-500" />

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="ALL">All Priorities</option>
            <option value="CRITICAL">Critical Priority</option>
            <option value="HIGH">High Priority</option>
            <option value="NORMAL">Normal Priority</option>
            <option value="LOW">Low Priority</option>
          </select>

          {/* Payment filter */}
          <select
            value={paymentStatusFilter}
            onChange={(e) => setPaymentStatusFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="ALL">All Payment Statuses</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIALLY_PAID">Partially Paid</option>
            <option value="PAID">Fully Paid</option>
            <option value="OVERDUE">Overdue</option>
          </select>

          {/* Exposure filter */}
          <select
            value={exposureFilter}
            onChange={(e: any) => setExposureFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="ALL">All Financial Exposure</option>
            <option value="OVERDUE_ONLY">Overdue Balances Only</option>
            <option value="HIGH_EXPOSURE">Exceeds Credit Limit</option>
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="animate-spin text-primary-600" size={28} />
            <p className="text-sm">Calculating priority scores and ledger balances...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="font-semibold text-slate-700">No orders matching your criteria</p>
            <p className="text-sm text-slate-500 mt-1">Try resetting filters or click &quot;Create Order&quot; to issue a new manual order.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-medium">
                <tr>
                  <th className="px-6 py-3.5">Priority & Order</th>
                  <th className="px-6 py-3.5">Customer & Payment Trust</th>
                  <th className="px-6 py-3.5">Order Financials</th>
                  <th className="px-6 py-3.5">Customer Exposure</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredOrders.map((order) => {
                  const borderClass =
                    order.priority === 'CRITICAL'
                      ? 'border-l-4 border-l-rose-500'
                      : order.priority === 'HIGH'
                      ? 'border-l-4 border-l-amber-500'
                      : order.priority === 'NORMAL'
                      ? 'border-l-4 border-l-blue-400'
                      : 'border-l-4 border-l-slate-300';

                  const orderOutstanding =
                    order.outstandingAmount !== undefined
                      ? order.outstandingAmount
                      : (order.totalAmount || 0) - (order.amountPaid || 0);

                  const custTotalOutstanding = order.customer?.totalOutstanding || 0;
                  const custOverdue = order.customer?.overdueBalance || 0;
                  const creditLimit = order.customer?.creditLimit || 0;
                  const isCreditBreached = creditLimit > 0 && custTotalOutstanding > creditLimit;

                  return (
                    <tr key={order.id} className={`hover:bg-slate-50/80 transition-colors ${borderClass}`}>
                      {/* Priority & Order Info */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 mb-1.5">
                          {getPriorityBadge(order)}
                        </div>
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          <Link to={`/dashboard/orders/${order.id}`} className="hover:text-primary-600 hover:underline">
                            {order.orderNumber}
                          </Link>
                          {order.vendor && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center gap-1 ${
                                order.vendor.verificationStatus === 'VERIFIED'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                              title={`Vendor: ${order.vendor.name} (${order.vendor.verificationStatus})`}
                            >
                              <Building2 size={10} />
                              {order.vendor.name}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <Calendar size={12} />
                          {new Date(order.createdAt).toLocaleDateString()}
                          {order.expectedDeliveryDate && (
                            <span className="text-slate-400">
                              • Due: {new Date(order.expectedDeliveryDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Customer & Score */}
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900">
                          {order.customer?.name || 'Walk-in / Direct'}
                        </div>
                        <div className="text-xs text-slate-500">
                          {order.customer?.phone || order.customer?.email || 'No contact on file'}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-500 font-medium">Payment Score:</span>
                          {getScoreBadge(order.customer?.paymentScore, order.customer?.paymentScoreCategory)}
                        </div>
                      </td>

                      {/* Order Financials */}
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">
                          {formatCurrency(order.totalAmount || 0, order.currency || currency)}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {getPaymentStatusBadge(order.paymentStatus || 'UNPAID')}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Paid: {formatCurrency(order.amountPaid || 0, order.currency || currency)} • Due:{' '}
                          <span className={orderOutstanding > 0 ? 'font-semibold text-rose-600' : 'text-slate-600'}>
                            {formatCurrency(orderOutstanding, order.currency || currency)}
                          </span>
                        </div>
                      </td>

                      {/* Customer Exposure (Distinct from Order Outstanding) */}
                      <td className="px-6 py-4">
                        <div className="text-xs">
                          <span className="text-slate-500">Total Across All Orders:</span>{' '}
                          <span className="font-bold text-slate-800">
                            {formatCurrency(custTotalOutstanding, currency)}
                          </span>
                        </div>

                        {custOverdue > 0 ? (
                          <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-100/90 px-2 py-0.5 rounded border border-rose-200">
                            <AlertCircle size={11} />
                            Overdue: {formatCurrency(custOverdue, currency)}
                          </div>
                        ) : (
                          <div className="text-[11px] text-emerald-700 mt-0.5">No overdue balances</div>
                        )}

                        {creditLimit > 0 && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Credit Limit: {formatCurrency(creditLimit, currency)}{' '}
                            {isCreditBreached && (
                              <span className="text-rose-600 font-semibold">(Limit Exceeded)</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                          {order.status}
                        </span>
                        {order.paymentTerms && (
                          <div className="text-[11px] text-slate-500 mt-1">
                            Terms: {order.paymentTerms.replace(/_/g, ' ')}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                        {order.status === 'PENDING_OWNER_CONFIRMATION' && (
                          <button
                            id={`btn-accept-${order.id}`}
                            onClick={() => handleAcceptOrder(order.id, order.orderNumber)}
                            disabled={actionLoading[order.id]}
                            className="text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg shadow-sm text-xs font-semibold transition disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            {actionLoading[order.id] && <RefreshCw size={12} className="animate-spin" />}
                            Accept Order
                          </button>
                        )}

                        {order.status === 'CONFIRMED' && (
                          <button
                            id={`btn-inv-${order.id}`}
                            onClick={() => handleGenerateInvoice(order.id, order.orderNumber)}
                            disabled={actionLoading[order.id]}
                            className="text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded-lg shadow-sm text-xs font-semibold transition disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            {actionLoading[order.id] && <RefreshCw size={12} className="animate-spin" />}
                            Generate Invoice
                          </button>
                        )}

                        <button
                          onClick={() => handleRecalculatePriority(order.id, order.orderNumber)}
                          disabled={actionLoading[order.id]}
                          className="text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-1.5 rounded-lg text-xs font-medium transition"
                          title="Recalculate Order Priority & Exposure"
                        >
                          <RefreshCw size={12} className={actionLoading[order.id] ? 'animate-spin' : ''} />
                        </button>

                        <Link
                          to={`/dashboard/orders/${order.id}`}
                          className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary-600 hover:text-primary-800"
                        >
                          View <ChevronRight size={13} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PRIORITY REASON EXPLANATION MODAL */}
      {selectedPriorityReason && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Info className="text-primary-600" size={18} />
                Priority Explanation — {selectedPriorityReason.orderNumber}
              </h2>
              <button
                onClick={() => setSelectedPriorityReason(null)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 mt-4 text-sm">
              <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-xs text-slate-500 font-medium block">Priority Classification</span>
                  <span className="font-bold text-slate-900 text-base">{selectedPriorityReason.priority}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500 font-medium block">Calculated Score</span>
                  <span className="font-mono font-extrabold text-primary-600 text-base">
                    {selectedPriorityReason.score} / 100
                  </span>
                </div>
              </div>

              <div>
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Reason for Priority
                </span>
                <p className="text-slate-700 leading-relaxed bg-amber-50/60 p-3 rounded-xl border border-amber-200 text-xs">
                  {selectedPriorityReason.reason}
                </p>
              </div>

              {selectedPriorityReason.factors?.length > 0 && (
                <div>
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    Contributing Algorithmic Factors
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedPriorityReason.factors.map((factor, i) => (
                      <span
                        key={i}
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        {factor.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 mt-5">
              <button
                onClick={() => setSelectedPriorityReason(null)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE ORDER MODAL */}
      <CreateOrderModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onOrderCreated={(newOrder) => {
          setIsCreateModalOpen(false);
          addToast({
            type: 'success',
            title: 'Order Created',
            message: `Order ${newOrder.orderNumber} successfully registered with priority ${newOrder.priority || 'NORMAL'}`
          });
          loadOrders();
        }}
        businessId={business.id}
        currency={currency}
      />
    </div>
  );
}
