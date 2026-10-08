import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import { Loader2, RefreshCw, CheckCircle, AlertTriangle, ExternalLink } from 'lucide-react';

export default function OperationsSettings({ businessId }: { businessId: string }) {
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [selectedIntegration, setSelectedIntegration] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [businessId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Get connected google integrations
      const intRes = await apiCall(`/integrations/connected?businessId=${businessId}`);
      if (intRes.data?.integrations) {
        const googleIntegrations = intRes.data.integrations.filter((i: any) => i.provider === 'GOOGLE_SHEETS' || i.provider === 'GOOGLE_DRIVE' || i.provider === 'GMAIL' || i.provider === 'GOOGLE_CALENDAR');
        setIntegrations(googleIntegrations);
        if (googleIntegrations.length > 0) {
          setSelectedIntegration(googleIntegrations[0].id);
        }
      }

      // Get ops status
      const statRes = await apiCall(`/operations/sheets/status?businessId=${businessId}`);
      if (statRes.data?.status) {
        setStatus(statRes.data.status);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleInitialize = async () => {
    if (!selectedIntegration) return;
    setActionLoading(true);
    try {
      const res = await apiCall(`/operations/sheets/initialize`, {
        method: 'POST',
        body: JSON.stringify({ businessId, integrationId: selectedIntegration })
      });
      if (res.data?.config) {
        setStatus({
          status: res.data.config.status,
          spreadsheetId: res.data.config.spreadsheetId,
          spreadsheetName: res.data.config.spreadsheetName,
          lastSyncedAt: res.data.config.lastSyncedAt,
          url: `https://docs.google.com/spreadsheets/d/${res.data.config.spreadsheetId}/edit`
        });
      }
    } catch (e) {
      console.error(e);
      alert('Failed to initialize operations sheet');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSync = async () => {
    setActionLoading(true);
    try {
      await apiCall(`/operations/sheets/sync`, {
        method: 'POST',
        body: JSON.stringify({ businessId })
      });
      alert('Sync started');
      loadData();
    } catch (e) {
      console.error(e);
      alert('Failed to sync');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 text-primary-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="border-b border-slate-200 pb-4 mb-6">
        <h2 className="text-xl font-bold text-slate-900">Google Sheets Operations</h2>
        <p className="text-slate-500 mt-1">Automatically sync your business data (Enquiries, Customers) to Google Sheets.</p>
      </div>

      {!status && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
          <h3 className="text-lg font-medium text-slate-900 mb-2">Connect Operations Sheet</h3>
          <p className="text-slate-600 mb-4 text-sm">
            You need a connected Google Integration to create an operations spreadsheet. 
            If you haven't connected Google yet, go to the Integrations page first.
          </p>

          {integrations.length > 0 ? (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Select Google Connection</label>
                <select 
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  value={selectedIntegration}
                  onChange={(e) => setSelectedIntegration(e.target.value)}
                >
                  {integrations.map(int => (
                    <option key={int.id} value={int.id}>{int.displayName || int.accountEmail || int.provider}</option>
                  ))}
                </select>
              </div>
              <button 
                onClick={handleInitialize}
                disabled={actionLoading}
                className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Create Operations Spreadsheet
              </button>
            </div>
          ) : (
            <div className="text-amber-600 font-medium text-sm p-4 bg-amber-50 rounded-lg border border-amber-200">
              No Google integrations found. Please connect Google Workspace in the Integrations page first.
            </div>
          )}
        </div>
      )}

      {status && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">Spreadsheet Configured</h3>
                <a href={status.url} target="_blank" rel="noreferrer" className="text-primary-600 hover:text-primary-800 font-medium flex items-center gap-1 text-sm">
                  {status.spreadsheetName || 'Operations Spreadsheet'} <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
                {status.status === 'SYNCED' ? (
                  <><CheckCircle className="w-4 h-4 text-emerald-500" /><span className="text-sm font-medium text-slate-700">Synced</span></>
                ) : status.status === 'FAILED' ? (
                  <><AlertTriangle className="w-4 h-4 text-red-500" /><span className="text-sm font-medium text-slate-700">Failed</span></>
                ) : (
                  <><RefreshCw className="w-4 h-4 text-blue-500 animate-spin" /><span className="text-sm font-medium text-slate-700">{status.status}</span></>
                )}
              </div>
            </div>
            
            <div className="p-6 bg-slate-50">
              <div className="grid grid-cols-2 gap-4 max-w-lg mb-6">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Worksheets</p>
                  <ul className="text-sm text-slate-700 space-y-1 font-medium">
                    <li>✓ Enquiries</li>
                    <li>✓ Customers</li>
                    <li>✓ Followups</li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Last Synced</p>
                  <p className="text-sm text-slate-700 font-medium">
                    {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Never'}
                  </p>
                  {status.errorMessage && (
                    <p className="text-xs text-red-500 mt-1 max-w-xs truncate" title={status.errorMessage}>{status.errorMessage}</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={handleSync}
                  disabled={actionLoading}
                  className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg font-medium flex items-center gap-2 text-sm shadow-sm transition-colors"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Sync Now
                </button>
                <button 
                  onClick={handleInitialize}
                  disabled={actionLoading}
                  className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg font-medium flex items-center gap-2 text-sm shadow-sm transition-colors"
                >
                  Reconnect Headers
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
