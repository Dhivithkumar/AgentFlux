import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { Loader2, Table, Plug, ExternalLink, CheckCircle2, AlertTriangle, RefreshCw, ChevronRight, FileSpreadsheet, Search } from 'lucide-react';

export default function BusinessData() {
  const { business } = useOutletContext<{ business: any }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [googleIntegration, setGoogleIntegration] = useState<any>(null);
  const [sheetStatus, setSheetStatus] = useState<any>(null);
  
  // URL Input State
  const [sheetUrlInput, setSheetUrlInput] = useState('');
  const [validatingUrl, setValidatingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');

  // Mapping state
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<any>(null);
  const [worksheets, setWorksheets] = useState<any[]>([]);
  const [mappingStep, setMappingStep] = useState<'IDLE' | 'SELECT_SPREADSHEET' | 'SELECT_WORKSHEET' | 'MAP_COLUMNS'>('IDLE');
  
  // Mapping config
  const [currentMappingEntity, setCurrentMappingEntity] = useState<string | null>(null);
  const [selectedWorksheet, setSelectedWorksheet] = useState<any>(null);

  const ENTITIES = [
    { id: 'CUSTOMER', name: 'Customers' },
    { id: 'ENQUIRY', name: 'Enquiries' },
    { id: 'ORDER', name: 'Orders' },
    { id: 'QUOTATION', name: 'Quotations' },
    { id: 'INVOICE', name: 'Invoices' },
    { id: 'PAYMENT', name: 'Payments' }
  ];

  useEffect(() => {
    if (business) {
      loadData();
    }
  }, [business]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [intRes, statRes] = await Promise.all([
        apiCall(`/integrations?businessId=${business.id}`),
        apiCall(`/operations/sheets/status?businessId=${business.id}`)
      ]);
      
      const gIntegration = intRes.data?.find((i: any) => i.provider === 'GOOGLE_SHEETS') || intRes.find((i: any) => i.provider === 'GOOGLE_SHEETS');
      setGoogleIntegration(gIntegration);
      setSheetStatus(statRes.status || null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      const res = await apiCall(`/integrations/GOOGLE_SHEETS/connect?businessId=${business.id}`);
      if (res.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleBrowseSpreadsheets = async () => {
    if (!googleIntegration) return;
    setMappingStep('SELECT_SPREADSHEET');
    setSheetUrlInput('');
    setUrlError('');
  };

  const handleVerifyAndConnectUrl = async () => {
    setUrlError('');
    if (!sheetUrlInput) {
      setUrlError('Please paste a valid Google Sheets URL.');
      return;
    }

    // Extract ID from URL
    // Format: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0
    const match = sheetUrlInput.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = match ? match[1] : sheetUrlInput; // fallback if they just paste the ID

    if (!spreadsheetId || spreadsheetId.length < 20) {
      setUrlError('Could not extract a valid Spreadsheet ID from the URL.');
      return;
    }

    setValidatingUrl(true);
    try {
      // Fetch metadata to verify access
      const res = await apiCall(`/operations/sheets/spreadsheet-info?businessId=${business.id}&integrationId=${googleIntegration.id}&spreadsheetId=${spreadsheetId}`);
      if (!res.info) {
        throw new Error('Spreadsheet not found or access denied.');
      }

      await handleSelectSpreadsheet(res.info);
    } catch (e: any) {
      console.error(e);
      setUrlError(e.message || 'Failed to verify spreadsheet. Ensure the Google account you linked has access to it.');
    } finally {
      setValidatingUrl(false);
    }
  };

  const handleSelectSpreadsheet = async (sheet: any) => {
    try {
      await apiCall('/operations/sheets/connect', {
        method: 'POST',
        body: JSON.stringify({
          businessId: business.id,
          integrationId: googleIntegration.id,
          spreadsheetId: sheet.id,
          spreadsheetName: sheet.name
        })
      });
      await loadData();
      setMappingStep('IDLE');
    } catch (e) {
      console.error(e);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnecting will stop future synchronization. Existing data will not be deleted.')) return;
    try {
      await apiCall('/operations/sheets/disconnect', {
        method: 'POST',
        body: JSON.stringify({ businessId: business.id })
      });
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const startEntityMapping = async (entityId: string) => {
    setCurrentMappingEntity(entityId);
    setMappingStep('SELECT_WORKSHEET');
    if (worksheets.length === 0 && sheetStatus?.spreadsheetId) {
      try {
        const res = await apiCall(`/operations/sheets/worksheets?businessId=${business.id}&integrationId=${googleIntegration.id}&spreadsheetId=${sheetStatus.spreadsheetId}`);
        setWorksheets(res.worksheets || []);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleConfirmMapping = async (worksheet: any) => {
    try {
      await apiCall('/operations/sheets/map', {
        method: 'POST',
        body: JSON.stringify({
          businessId: business.id,
          entityType: currentMappingEntity,
          worksheetId: worksheet.id,
          worksheetName: worksheet.name,
          columnMapping: {}
        })
      });
      await loadData();
      setMappingStep('IDLE');
      setCurrentMappingEntity(null);
    } catch (e) {
      console.error(e);
    }
  };

  const triggerSync = async () => {
    try {
      await apiCall('/operations/sheets/sync', {
        method: 'POST',
        body: JSON.stringify({ businessId: business.id })
      });
      alert('Sync started successfully. Background tasks will update the sheets.');
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;
  }

  // View: Mapping - Select Spreadsheet
  if (mappingStep === 'SELECT_SPREADSHEET') {
    return (
      <div className="max-w-3xl mx-auto py-8">
        <button onClick={() => setMappingStep('IDLE')} className="text-sm font-medium text-slate-500 hover:text-slate-900 mb-6 flex items-center">
          &larr; Back to Dashboard
        </button>
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
          <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100 mb-6">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Connect a Spreadsheet</h1>
          <p className="text-slate-600 mb-6">Paste the URL of the Google Spreadsheet you want to use for Business Data.</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Google Sheets URL</label>
              <div className="flex gap-3">
                <input 
                  type="text" 
                  placeholder="https://docs.google.com/spreadsheets/d/..." 
                  value={sheetUrlInput}
                  onChange={(e) => setSheetUrlInput(e.target.value)}
                  disabled={validatingUrl}
                  className="flex-1 px-4 py-2.5 bg-white border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button 
                  onClick={handleVerifyAndConnectUrl} 
                  disabled={validatingUrl || !sheetUrlInput}
                  className="px-6 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm flex items-center gap-2 transition-colors"
                >
                  {validatingUrl ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                  Connect Sheet
                </button>
              </div>
              {urlError && <p className="text-sm text-rose-500 font-medium mt-2 flex items-center gap-1"><AlertTriangle size={14} /> {urlError}</p>}
            </div>
            
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-6">
              <h4 className="text-sm font-bold text-slate-800 mb-1">Permissions Note</h4>
              <p className="text-sm text-slate-600">The Google Account you connected must have <strong className="text-slate-800">Editor</strong> access to the spreadsheet you paste above. If it's a private sheet, ensure you share it with your connected account first.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // View: Mapping - Select Worksheet
  if (mappingStep === 'SELECT_WORKSHEET') {
    return (
      <div className="max-w-3xl mx-auto py-8">
        <button onClick={() => setMappingStep('IDLE')} className="text-sm font-medium text-slate-500 hover:text-slate-900 mb-6 flex items-center">
          &larr; Back to Dashboard
        </button>
        <h1 className="text-2xl font-bold mb-2">Map Worksheet for {ENTITIES.find(e => e.id === currentMappingEntity)?.name}</h1>
        <p className="text-slate-600 mb-6">Select which tab in your spreadsheet should hold this data.</p>
        
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          {worksheets.map(ws => (
            <div key={ws.id} className="p-4 border-b border-slate-100 flex items-center justify-between hover:bg-slate-50">
              <div className="font-medium text-slate-900">{ws.name}</div>
              <button onClick={() => handleConfirmMapping(ws)} className="px-4 py-1.5 text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg transition-colors">
                Map Tab
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Main Dashboard View
  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 animate-in fade-in">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Business Data</h1>
          <p className="text-slate-500 mt-2 text-lg">Connect and manage your operational business data.</p>
        </div>
      </div>

      {!googleIntegration || !sheetStatus?.spreadsheetId ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col items-center justify-center text-center min-h-[400px]">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-6 border border-blue-100 shadow-inner">
            <Table className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Google Sheets</h2>
          <p className="text-slate-600 max-w-md mx-auto mb-8 text-lg">
            Connect your Google account to securely access your business spreadsheets and synchronize operational data.
          </p>
          {!googleIntegration ? (
            <button onClick={handleConnectGoogle} className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-2">
              <Plug className="w-5 h-5" /> Connect Google Sheets
            </button>
          ) : (
            <button onClick={handleBrowseSpreadsheets} className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 shadow-sm transition-colors flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" /> Connect a Spreadsheet
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Connection Header */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100">
                <Table className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-bold text-slate-900">Google Sheets Connected</h2>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider">
                    <CheckCircle2 size={12} /> Active
                  </span>
                </div>
                <div className="text-sm text-slate-500 flex items-center gap-2">
                  <span>Spreadsheet: <strong className="text-slate-700">{sheetStatus.spreadsheetName}</strong></span>
                  &middot;
                  <a href={sheetStatus.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                    Open in Sheets <ExternalLink size={14} />
                  </a>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <button onClick={triggerSync} className="flex-1 md:flex-none px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-2">
                <RefreshCw size={16} /> Sync Now
              </button>
              <button onClick={handleDisconnect} className="flex-1 md:flex-none px-4 py-2 bg-white text-rose-600 border border-slate-200 text-sm font-semibold rounded-lg hover:bg-rose-50 transition-colors">
                Disconnect
              </button>
            </div>
          </div>

          {/* Mappings Grid */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Data Connections</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {ENTITIES.map(entity => {
                // @ts-ignore
                const mapping = sheetStatus.worksheetMappings?.[entity.id];
                const isMapped = !!mapping;
                
                return (
                  <div key={entity.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-bold text-slate-900 text-lg">{entity.name}</h4>
                        {isMapped ? (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 border border-emerald-100 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={12} /> SYNCED
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border border-slate-200">
                            UNMAPPED
                          </span>
                        )}
                      </div>
                      {isMapped ? (
                        <p className="text-sm text-slate-500">
                          Syncing to worksheet: <strong className="text-slate-700">{mapping.worksheetName || mapping}</strong>
                        </p>
                      ) : (
                        <p className="text-sm text-slate-500">Not connected to a worksheet.</p>
                      )}
                    </div>
                    
                    <div>
                      {isMapped ? (
                        <button onClick={() => startEntityMapping(entity.id)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors">
                          Remap Worksheet
                        </button>
                      ) : (
                        <button onClick={() => startEntityMapping(entity.id)} className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-100 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-2">
                          Connect Worksheet <ChevronRight size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
