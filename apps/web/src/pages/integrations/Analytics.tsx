// @ts-nocheck
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { BarChart3, Activity, AlertTriangle, CheckCircle2, TrendingUp, Filter } from 'lucide-react';

export default function Analytics() {
  const { business } = useOutletContext<{ business: any }>();
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('7d');

  useEffect(() => {
    if (business) {
      loadAnalytics();
    }
  }, [business, timeRange]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const res = await apiCall(`/integrations/analytics?businessId=${business.id}&range=${timeRange}`);
      setMetrics(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ title, value, icon, trend }: any) => (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{title}</h3>
        <div className="p-2 bg-slate-50 rounded-lg text-slate-400">
          {icon}
        </div>
      </div>
      <div>
        <div className="text-3xl font-bold text-slate-900">{value}</div>
        {trend && (
          <div className={`text-sm font-medium mt-2 flex items-center gap-1 ${trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
            <TrendingUp size={14} className={trend < 0 ? 'rotate-180' : ''} />
            {Math.abs(trend)}% vs last period
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Integration Analytics</h1>
          <p className="text-slate-500 mt-2 text-lg">Monitor connector health, usage, and error rates.</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
          {['24h', '7d', '30d'].map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${
                timeRange === range ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500 flex justify-center items-center h-64">
          <Activity className="animate-spin text-slate-300 w-8 h-8" />
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard 
              title="Total Integrations" 
              value={metrics?.totalIntegrations || 0} 
              icon={<Plug className="w-5 h-5" />} 
            />
            <StatCard 
              title="Active Connections" 
              value={metrics?.activeIntegrations || 0} 
              icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />} 
            />
            <StatCard 
              title="Execution Success" 
              value={`${Math.round(metrics?.successRate || 0)}%`} 
              icon={<Activity className="w-5 h-5 text-blue-500" />} 
            />
            <StatCard 
              title="Failed Connections" 
              value={metrics?.failedIntegrations || 0} 
              icon={<AlertTriangle className="w-5 h-5 text-rose-500" />} 
            />
          </div>

          {/* Placeholder for actual charts (Recharts or similar would go here) */}
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center h-80 flex flex-col items-center justify-center">
            <BarChart3 className="w-12 h-12 text-slate-200 mb-4" />
            <h3 className="text-lg font-bold text-slate-900">Telemetry Charts</h3>
            <p className="text-slate-500 max-w-sm mt-2">Historical execution and latency charts will populate here as workflows trigger your connectors.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Just a quick local stub since we forgot to import Plug at the top
import { Plug } from 'lucide-react';
