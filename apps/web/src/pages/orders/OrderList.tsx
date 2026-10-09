import { useEffect, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiCall } from '../../lib/api';

export default function OrderList() {
  const { business } = useOutletContext<any>();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'PAST'>('ACTIVE');

  const activeOrders = orders.filter(o => !['COMPLETED', 'CANCELLED', 'DELIVERED', 'REFUNDED'].includes(o.status));
  const pastOrders = orders.filter(o => ['COMPLETED', 'CANCELLED', 'DELIVERED', 'REFUNDED'].includes(o.status));
  const displayOrders = activeTab === 'ACTIVE' ? activeOrders : pastOrders;

  useEffect(() => {
    loadOrders();
  }, [business.id]);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const res = await apiCall(`/businesses/${business.id}/orders`);
      setOrders(res);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Orders & Bookings</h1>
          <p className="text-slate-500 mt-1">Manage active and past orders</p>
        </div>
      </div>

      <div className="flex space-x-4 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('ACTIVE')}
          className={`py-2 px-4 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'ACTIVE' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Active Orders ({activeOrders.length})
        </button>
        <button
          onClick={() => setActiveTab('PAST')}
          className={`py-2 px-4 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'PAST' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Past Orders ({pastOrders.length})
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading...</div>
        ) : displayOrders.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            {activeTab === 'ACTIVE' ? 'No active orders found.' : 'No past orders found.'}
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Order</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {displayOrders.map((order: any) => (
                <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="font-medium text-slate-900">{order.orderNumber}</div>
                    <div className="text-sm text-slate-500">{new Date(order.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-900">{order.customer?.name}</div>
                    <div className="text-sm text-slate-500">{order.customer?.phone}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full">
                      {order.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                    {order.currency} {order.totalAmount || '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                    {order.status === 'PENDING_OWNER_CONFIRMATION' && (
                      <button
                        onClick={async () => {
                          try {
                            const btn = document.getElementById(`btn-accept-${order.id}`);
                            if (btn) btn.innerText = 'Accepting...';
                            await apiCall(`/businesses/${business.id}/orders/${order.id}/status`, {
                              method: 'POST',
                              body: JSON.stringify({ status: 'CONFIRMED', reason: 'Owner accepted the order' })
                            });
                            alert('Order confirmed!');
                            loadOrders();
                          } catch (e: any) {
                            alert(e.message || 'Failed to confirm order');
                            const btn = document.getElementById(`btn-accept-${order.id}`);
                            if (btn) btn.innerText = 'Accept Order';
                          }
                        }}
                        id={`btn-accept-${order.id}`}
                        className="text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1 rounded shadow-sm text-xs transition-colors"
                      >
                        Accept Order
                      </button>
                    )}
                    {order.status === 'CONFIRMED' && (
                      <button
                        onClick={async () => {
                          try {
                            const btn = document.getElementById(`btn-inv-${order.id}`);
                            if (btn) btn.innerText = 'Generating...';
                            await apiCall(`/businesses/${business.id}/orders/${order.id}/generate-invoice`, { method: 'POST' });
                            alert('Invoice generated and sent to customer!');
                            loadOrders();
                          } catch (e: any) {
                            alert(e.message || 'Failed to generate invoice');
                            const btn = document.getElementById(`btn-inv-${order.id}`);
                            if (btn) btn.innerText = 'Generate Invoice';
                          }
                        }}
                        id={`btn-inv-${order.id}`}
                        className="text-white bg-primary-600 hover:bg-primary-700 px-3 py-1 rounded shadow-sm text-xs transition-colors"
                      >
                        Generate Invoice
                      </button>
                    )}
                    <Link to={`/dashboard/orders/${order.id}`} className="text-primary-600 hover:text-primary-900">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
