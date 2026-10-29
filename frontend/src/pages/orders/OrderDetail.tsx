import { useEffect, useState } from 'react';
import { useOutletContext, useParams, Link } from 'react-router-dom';
import { apiCall } from '../../lib/api';

export default function OrderDetail() {
  const { business } = useOutletContext<any>();
  const { id } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  
  const statusOptions = ['DRAFT', 'PENDING_OWNER_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

  useEffect(() => {
    loadOrder();
  }, [business.id, id]);

  const loadOrder = async () => {
    setLoading(true);
    try {
      const res = await apiCall(`/businesses/${business.id}/orders/${id}`);
      setOrder(res);
      setNewStatus(res.status);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  const handleUpdateStatus = async () => {
    setUpdating(true);
    try {
      const res = await apiCall(`/businesses/${business.id}/orders/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus, reason: 'Manual status update' })
      });
      setOrder(res);
      await loadOrder(); // reload to get history
    } catch (error) {
      console.error(error);
    }
    setUpdating(false);
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (!order) return <div className="p-8 text-center text-slate-500">Order not found</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{order.orderNumber}</h1>
            <span className="px-3 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded-full">
              {order.status}
            </span>
          </div>
          <p className="text-slate-500 mt-1">Created on {new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2">
          {order.status === 'CONFIRMED' && (
            <button
              onClick={async () => {
                setUpdating(true);
                try {
                  const btn = document.getElementById(`btn-inv-detail`);
                  if (btn) btn.innerText = 'Generating...';
                  await apiCall(`/businesses/${business.id}/orders/${id}/generate-invoice`, { method: 'POST' });
                  alert('Invoice generated and sent to customer!');
                  await loadOrder();
                } catch (e: any) {
                  alert(e.message || 'Failed to generate invoice');
                  const btn = document.getElementById(`btn-inv-detail`);
                  if (btn) btn.innerText = '📄 Generate Invoice';
                }
                setUpdating(false);
              }}
              disabled={updating}
              id="btn-inv-detail"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 shadow-sm mr-2"
            >
              📄 Generate Invoice
            </button>
          )}
          {order.status === 'PENDING_OWNER_CONFIRMATION' && (
            <button
              onClick={async () => {
                setUpdating(true);
                try {
                  const res = await apiCall(`/businesses/${business.id}/orders/${id}/status`, {
                    method: 'POST',
                    body: JSON.stringify({ status: 'CONFIRMED', reason: 'Owner accepted the order' })
                  });
                  setOrder(res);
                  setNewStatus(res.status);
                  await loadOrder();
                } catch (error) {
                  console.error(error);
                }
                setUpdating(false);
              }}
              disabled={updating}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 shadow-sm mr-2"
            >
              ✓ Accept Order
            </button>
          )}
          <select 
            value={newStatus} 
            onChange={e => setNewStatus(e.target.value)}
            className="border-slate-300 rounded-md text-sm bg-white shadow-sm"
          >
            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button 
            onClick={handleUpdateStatus} 
            disabled={updating || newStatus === order.status}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 disabled:opacity-50 shadow-sm"
          >
            {updating ? 'Updating...' : 'Update Status'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4">Order Information</h3>
            <div className="grid grid-cols-2 gap-y-4">
              {order.structuredData && Object.entries(order.structuredData).map(([key, value]) => (
                <div key={key}>
                  <p className="text-xs text-slate-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                  <p className="font-medium text-slate-900">{String(value)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4">Commercial Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-medium">{order.currency} {order.subtotal || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Discount</span>
                <span className="font-medium text-emerald-600">-{order.currency} {order.discount || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Tax</span>
                <span className="font-medium">{order.currency} {order.tax || 0}</span>
              </div>
              <div className="pt-3 border-t border-slate-100 flex justify-between">
                <span className="font-bold text-slate-900">Total</span>
                <span className="font-bold text-slate-900">{order.currency} {order.totalAmount || 0}</span>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4">Timeline</h3>
            <div className="space-y-4">
              {order.statusHistory?.map((history: any, i: number) => (
                <div key={history.id} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary-500 mt-1.5" />
                    {i !== order.statusHistory.length - 1 && <div className="w-px h-full bg-slate-200 my-1" />}
                  </div>
                  <div className="pb-4">
                    <p className="text-sm font-medium text-slate-900">Changed to {history.toStatus}</p>
                    {history.reason && <p className="text-sm text-slate-500">{history.reason}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">{new Date(history.createdAt).toLocaleString()} by {history.changedBy?.name || 'System'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">Customer Details</h3>
              <button
                onClick={async () => {
                  const currentAddress = (order.customer?.customData as any)?.billingAddress || '';
                  const newAddress = window.prompt('Enter Billing Address:', currentAddress);
                  if (newAddress !== null && newAddress !== currentAddress) {
                    try {
                      await apiCall(`/businesses/${business.id}/orders/${id}/customer`, {
                        method: 'PATCH',
                        body: JSON.stringify({ billingAddress: newAddress })
                      });
                      loadOrder();
                    } catch (e: any) {
                      alert(e.message || 'Failed to update customer');
                    }
                  }
                }}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                Edit
              </button>
            </div>
            <div className="space-y-3">
              <p className="font-medium text-slate-900">{order.customer?.name}</p>
              <p className="text-sm text-slate-600 flex items-center gap-2">📞 {order.customer?.phone || 'Not provided'}</p>
              <p className="text-sm text-slate-600 flex items-center gap-2">✉️ {order.customer?.email}</p>
              {(order.customer?.customData as any)?.billingAddress && (
                <p className="text-sm text-slate-600 flex items-start gap-2">
                  <span>🏢</span> 
                  <span className="whitespace-pre-wrap">{(order.customer?.customData as any)?.billingAddress}</span>
                </p>
              )}
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-2">Linked Enquiry</h3>
            {order.enquiry ? (
              <Link to={`/dashboard/enquiries/${order.enquiry.id}`} className="text-sm text-primary-600 hover:underline">
                View Original Enquiry ↗
              </Link>
            ) : (
              <p className="text-sm text-slate-500">None</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
