// @ts-nocheck
import { useState, useEffect } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { Activity, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCw, ChevronRight, Filter } from 'lucide-react';

export default function Executions() {
  const { business } = useOutletContext<{ business: any }>();
  const [executions, setExecutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');

  useEffect(() => {
    if (business) {
      loadExecutions();
    }
  }, [business]);

  const loadExecutions = async () => {
    setLoading(true);
    try {
      const res = await apiCall(`/executions?businessId=${business.id}`);
      setExecutions(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
      case 'SUCCESS':
        return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'FAILED':
        return <XCircle className="w-5 h-5 text-rose-500" />;
      case 'RUNNING':
      case 'PENDING':
        return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'WAITING_APPROVAL':
        return <Clock className="w-5 h-5 text-amber-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-slate-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const base = "px-2.5 py-1 text-xs font-semibold rounded-full flex items-center gap-1.5 w-fit";
    switch (status) {
      case 'COMPLETED':
      case 'SUCCESS':
        return <span className={`${base} bg-emerald-100 text-emerald-700`}>COMPLETED</span>;
      case 'FAILED':
        return <span className={`${base} bg-rose-100 text-rose-700`}>FAILED</span>;
      case 'RUNNING':
        return <span className={`${base} bg-blue-100 text-blue-700`}>RUNNING</span>;
      case 'WAITING_APPROVAL':
        return <span className={`${base} bg-amber-100 text-amber-700`}>WAITING</span>;
      default:
        return <span className={`${base} bg-slate-100 text-slate-700`}>{status}</span>;
    }
  };

  const filtered = statusFilter === 'ALL' ? executions : executions.filter(e => e.status === statusFilter);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Execution History</h1>
          <p className="text-slate-500 mt-2 text-lg">Monitor and trace your automated workflow runs.</p>
        </div>
        <button 
          onClick={loadExecutions}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-all"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex border-b border-slate-200 justify-between items-center pb-4">
        <div className="flex gap-2">
          {['ALL', 'COMPLETED', 'FAILED', 'WAITING_APPROVAL', 'RUNNING'].map(s => (
            <button 
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 text-sm font-semibold rounded-full transition-colors ${statusFilter === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
          <Filter size={16} /> Filter by trigger
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500">Loading executions...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="text-center py-24 bg-slate-50">
              <Activity className="mx-auto h-12 w-12 text-slate-400 mb-4" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">No executions found</h3>
              <p className="text-slate-500">Executions will appear here when your workflows run.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((exec) => (
                <div key={exec.id} className="p-5 flex items-center justify-between hover:bg-slate-50 transition-colors group">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="mt-1">{getStatusIcon(exec.status)}</div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-slate-900">{exec.workflow?.name || 'Unknown Workflow'}</span>
                        <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{exec.id.split('-')[0]}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1"><Clock size={14} /> {new Date(exec.startedAt).toLocaleString()}</span>
                        <span>{exec.triggerType || 'MANUAL'}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    {getStatusBadge(exec.status)}
                    <button className="text-slate-400 group-hover:text-primary-600 transition-colors p-2 hover:bg-primary-50 rounded-lg">
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
