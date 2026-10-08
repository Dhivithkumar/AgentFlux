// @ts-nocheck
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { ShieldCheck, Clock, Check, X, Edit3, MessageSquare } from 'lucide-react';

export default function Approvals() {
  const { business } = useOutletContext<{ business: any }>();
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (business) {
      loadApprovals();
    }
  }, [business]);

  const loadApprovals = async () => {
    setLoading(true);
    try {
      const res = await apiCall(`/approvals?businessId=${business.id}`);
      setApprovals(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id: string, action: 'approve' | 'reject', reason?: string) => {
    setProcessingId(id);
    try {
      await apiCall(`/approvals/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ businessId: business.id, reason })
      });
      // Refresh list
      await loadApprovals();
    } catch (e) {
      console.error(e);
      alert('Failed to process approval.');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Approvals</h1>
          <p className="text-slate-500 mt-2 text-lg">Review and authorize paused workflows before they proceed.</p>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500">Loading approvals...</div>
      ) : (
        <div className="space-y-6">
          {approvals.length === 0 ? (
            <div className="text-center py-24 bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
              <ShieldCheck className="mx-auto h-12 w-12 text-slate-400 mb-4" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">No pending approvals</h3>
              <p className="text-slate-500">You're all caught up! Workflows requiring approval will appear here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {approvals.map((approval) => (
                <div key={approval.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                        <ShieldCheck size={20} />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">{approval.execution?.workflow?.name || 'Unknown Workflow'}</h3>
                        <div className="text-sm text-slate-500 flex items-center gap-1">
                          <Clock size={14} /> Requested {new Date(approval.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wider ${
                        approval.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                        approval.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-rose-100 text-rose-700'
                      }`}>
                        {approval.status}
                      </span>
                    </div>
                  </div>
                  
                  <div className="p-6 bg-slate-50 border-b border-slate-100">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                      <MessageSquare size={16} /> Requested Action details
                    </h4>
                    <div className="bg-white p-4 rounded-lg border border-slate-200 font-mono text-sm text-slate-600 max-h-48 overflow-y-auto">
                      {/* Typically you would show the approval context here */}
                      <p>Execution ID: {approval.executionId}</p>
                      <p>Waiting for human authorization to proceed with workflow execution.</p>
                    </div>
                  </div>

                  {approval.status === 'PENDING' && (
                    <div className="p-4 bg-white flex gap-3 justify-end">
                      <button 
                        onClick={() => handleAction(approval.id, 'reject', 'Manually rejected by user')}
                        disabled={processingId === approval.id}
                        className="px-4 py-2 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2"
                      >
                        <X size={18} /> Reject
                      </button>
                      <button 
                        onClick={() => handleAction(approval.id, 'approve')}
                        disabled={processingId === approval.id}
                        className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
                      >
                        <Check size={18} /> Approve
                      </button>
                    </div>
                  )}

                  {approval.status !== 'PENDING' && (
                    <div className="p-4 bg-slate-50 text-right text-sm text-slate-500 font-medium">
                      Resolved on {new Date(approval.decidedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
