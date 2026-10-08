import { useState, useEffect } from 'react';
import { useOutletContext, useParams, useNavigate } from 'react-router-dom';
import { Play, CheckCircle, AlertTriangle, XCircle, ArrowLeft, Loader2, Layout, Settings, ShieldCheck, Activity } from 'lucide-react';
import { WorkflowCanvas } from './WorkflowCanvas';

interface ReadinessCheck {
  name: string;
  type?: string;
  status: 'CONNECTED' | 'MISSING' | 'RECONNECT_REQUIRED' | 'VALID' | 'NOT_RUN' | 'UNKNOWN_PROVIDER';
  connectUrl?: string;
}

export function WorkflowBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { business } = useOutletContext<{ business: any }>();
  const [workflow, setWorkflow] = useState<any>(null);
  const [readiness, setReadiness] = useState<{ ready: boolean; checks: ReadinessCheck[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [executions, setExecutions] = useState<any[]>([]);
  const [config, setConfig] = useState<any>({});
  const [calendars, setCalendars] = useState<any[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [registry, setRegistry] = useState<any[]>([]);
  const [bindingCapability, setBindingCapability] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'CONFIG' | 'READINESS' | 'HISTORY'>('CONFIG');
  const [selectedNode, setSelectedNode] = useState<any>(null);

  const businessId = business?.id;
  useEffect(() => {
    if (workflow) {
      const initialConfig = { ...(workflow.config || {}) };
      if (workflow.template?.configurationSchema) {
        const schema = workflow.template.configurationSchema;
        Object.keys(schema).forEach(k => {
          if (initialConfig[k] === undefined && schema[k].default !== undefined) {
            initialConfig[k] = schema[k].default;
          }
        });
      }
      setConfig(initialConfig);
    }
    if (workflow?.template?.configurationSchema && Object.keys(workflow.template.configurationSchema).some(k => workflow.template.configurationSchema[k].label?.toLowerCase().includes('calendar'))) {
      fetch('/api/integrations/google-calendar/calendars?businessId=' + businessId, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null).then(res => {
        if (res.success) setCalendars(res.data);
      });
    }
  }, [workflow]);

  const handleConfigChange = (key: string, value: any) => {
    setConfig({ ...config, [key]: value });
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/workflows/${id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ businessId, config })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);
      if (res.success) {
        setWorkflow({ ...workflow, config });
        fetchData(); // Refresh readiness
      }
    } finally {
      setSavingConfig(false);
    }
  };


  useEffect(() => {
    if (!id || !businessId) return;
    fetchData();
  }, [id, businessId]);

  const fetchData = async () => {
    try {
      const [wfRes, readyRes, execRes, intRes, regRes] = await Promise.all([
        fetch(`/api/workflows/${id}?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null),
        fetch(`/api/workflows/${id}/readiness?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null),
        fetch(`/api/workflows/${id}/executions?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null),
        fetch(`/api/integrations?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null),
        fetch(`/api/integrations/registry`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null)
      ]);

      if (wfRes.success) setWorkflow(wfRes.data);
      if (readyRes.success) setReadiness(readyRes.data);
      if (execRes.success) setExecutions(execRes.data);
      if (intRes.success) setIntegrations(intRes.data);
      if (regRes.success) setRegistry(regRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    try {
      const res = await fetch(`/api/workflows/${id}/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ businessId })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);
      if (res.success) {
        setWorkflow({ ...workflow, status: 'ACTIVE' });
      } else {
        alert(res.error || 'Failed to activate');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleManualTrigger = async () => {
    setTriggering(true);
    try {
      // Prompt user for a fake payload to inject for testing
      const payloadStr = prompt('Enter JSON payload for trigger (e.g. {"email": {"subject": "Test"}})', '{}');
      let payload = {};
      try { payload = JSON.parse(payloadStr || '{}'); } catch(e) {}

      const res = await fetch(`/api/workflows/${id}/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ businessId, payload, triggerType: 'MANUAL' })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);

      if (res.success) {
        alert('Execution queued: ' + res.data.executionId);
        fetchData(); // refresh executions
      } else {
        alert('Trigger failed: ' + res.error);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTriggering(false);
    }
  };

  const handleBindCapability = async (capability: string, integrationId: string) => {
    setBindingCapability(capability);
    try {
      const res = await fetch(`/api/workflows/${id}/bindings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ businessId, capability, integrationId })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);
      if (res.success) {
        fetchData(); // refresh readiness
      } else {
        alert('Failed to bind capability: ' + res.error);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBindingCapability(null);
    }
  };

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>;
  }

  if (!workflow) {
    return <div className="p-8 text-center text-gray-500">Workflow not found</div>;
  }

  const activeVersion = workflow.versions?.find((v: any) => v.id === workflow.activeVersionId) || workflow.versions?.[0];
  const nodes = activeVersion?.definition?.nodes || workflow.template?.workflowDefinition?.nodes || [];

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden animate-in fade-in duration-500 pb-6 px-6">
      {/* Top Header */}
      <div className="flex items-center gap-4 mb-6 shrink-0 pt-4">
        <button onClick={() => navigate('/dashboard/workflows')} className="p-2 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 bg-white">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{workflow.name}</h1>
          <p className="text-slate-500 text-sm">{workflow.description}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase ${
            workflow.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'
          }`}>
            {workflow.status}
          </span>
          {workflow.status !== 'ACTIVE' && (
            <button 
              onClick={handleActivate}
              disabled={!readiness?.ready}
              className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              Activate
            </button>
          )}
          {workflow.status === 'ACTIVE' && (
            <button 
              onClick={handleManualTrigger}
              disabled={triggering}
              className="px-6 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 flex items-center gap-2 transition-colors shadow-sm"
            >
              {triggering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Test Run
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 gap-6 min-h-0">
        {/* Canvas Area */}
        <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative">
           <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2 absolute top-6 left-6 z-10 bg-white/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-200">
             <Layout size={18} /> Builder
           </h2>
           <WorkflowCanvas nodes={nodes} onNodeSelect={setSelectedNode} />
        </div>

        {/* Sidebar */}
        <div className="w-[400px] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden shrink-0">
          <div className="flex border-b border-slate-200 p-2 gap-1 bg-slate-50">
            <button 
              onClick={() => setActiveTab('CONFIG')}
              className={`flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 ${activeTab === 'CONFIG' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'}`}
            >
              <Settings size={16} /> Config
            </button>
            <button 
              onClick={() => setActiveTab('READINESS')}
              className={`flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 ${activeTab === 'READINESS' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'}`}
            >
              <ShieldCheck size={16} /> Valid
            </button>
            <button 
              onClick={() => setActiveTab('HISTORY')}
              className={`flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 ${activeTab === 'HISTORY' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'}`}
            >
              <Activity size={16} /> History
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'CONFIG' && (
              <div className="space-y-6">
                {!selectedNode ? (
                  <div className="space-y-6">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <h3 className="text-sm font-bold text-slate-900 mb-2">Global Workflow Settings</h3>
                      {workflow.template?.configurationSchema ? (
                        <div className="space-y-4">
                          {Object.entries(workflow.template.configurationSchema).map(([key, schema]: [string, any]) => (
                            <div key={key}>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">{schema.label}</label>
                              <p className="text-[10px] text-slate-500 mb-2">{schema.description}</p>
                              
                              {schema.label.toLowerCase().includes('calendar') ? (
                                <select
                                  className="w-full border-slate-300 rounded-lg text-sm p-2 border"
                                  value={config[key] || ''}
                                  onChange={(e) => handleConfigChange(key, e.target.value)}
                                >
                                  <option value="">Select calendar...</option>
                                  {calendars.map(c => (
                                    <option key={c.id} value={c.id}>{c.summary}</option>
                                  ))}
                                </select>
                              ) : (
                                <input 
                                  type={schema.type === 'number' ? 'number' : 'text'}
                                  className="w-full border-slate-300 rounded-lg text-sm p-2 border"
                                  value={config[key] || ''}
                                  onChange={(e) => handleConfigChange(key, e.target.value)}
                                  placeholder={`Enter ${schema.label.toLowerCase()}`}
                                />
                              )}
                            </div>
                          ))}

                          <button
                            onClick={handleSaveConfig}
                            disabled={savingConfig}
                            className="w-full py-2 bg-slate-900 text-white rounded-lg font-medium text-sm mt-4 hover:bg-slate-800 flex items-center justify-center gap-2"
                          >
                            {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            Save Global Config
                          </button>
                        </div>
                      ) : (
                        <p className="text-slate-500 text-xs">No global configuration required.</p>
                      )}
                    </div>

                    <div className="text-center py-10 text-slate-500">
                      <Settings className="w-10 h-10 mx-auto text-slate-300 mb-4" />
                      <p className="text-sm">Click a node in the canvas to view and edit its specific configuration.</p>
                    </div>
                  </div>
                ) : (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="mb-6 pb-4 border-b border-slate-100 flex justify-between items-start">
                      <div>
                        <div className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded inline-block mb-2 uppercase tracking-wider">{selectedNode.type}</div>
                        <h3 className="text-lg font-bold text-slate-900 leading-tight">{selectedNode.id}</h3>
                      </div>
                      <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-slate-600"><XCircle size={20} /></button>
                    </div>
                    
                    <div className="space-y-4">
                      {/* Node Config Editor Stub */}
                      <div>
                         <label className="block text-sm font-semibold text-slate-700 mb-2">Configuration Data</label>
                         <textarea 
                           className="w-full bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs text-slate-600 font-mono h-48 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 focus:outline-none"
                           defaultValue={JSON.stringify(selectedNode.config, null, 2)}
                         />
                      </div>
                      
                      <button className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium shadow-sm hover:bg-slate-800 transition-colors mt-4 text-sm">
                        Update Node Config
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'READINESS' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-900">Health Checks</h3>
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${readiness?.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {readiness?.ready ? 'Passing' : 'Attention Needed'}
                  </span>
                </div>
                
                {readiness?.checks?.map((check, i) => (
                  <div key={i} className={`p-4 rounded-xl border flex flex-col gap-2 ${
                    check.status === 'VALID' || check.status === 'CONNECTED' ? 'bg-emerald-50/50 border-emerald-100' :
                    check.status === 'NOT_RUN' ? 'bg-slate-50 border-slate-200' :
                    'bg-rose-50/50 border-rose-100'
                  }`}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-start gap-2">
                         {check.status === 'VALID' || check.status === 'CONNECTED' ? (
                            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          ) : check.status === 'NOT_RUN' ? (
                            <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                          )}
                        <span className="font-semibold text-sm text-slate-800 leading-tight">{check.name}</span>
                      </div>
                    </div>

                    {check.type && <span className="text-[10px] font-mono text-slate-500 bg-white px-1.5 py-0.5 rounded self-start border border-slate-200 mt-1">{check.type}</span>}

                    {/* Fix Missing Capabilities */}
                    {(check.status === 'MISSING' || check.status === 'RECONNECT_REQUIRED') && check.type && (
                      <div className="mt-3 pt-3 border-t border-rose-200">
                        <p className="text-xs text-rose-600 mb-2 font-medium">Requires capability fulfillment:</p>
                        
                        {/* Check if any active integration can fulfill this capability */}
                        {integrations.some(i => registry.find(r => r.id === i.provider)?.supportedCapabilities?.includes(check.type)) ? (
                          <select 
                            className="w-full text-sm border border-rose-200 rounded-lg p-2 focus:ring-rose-500 focus:border-rose-500"
                            onChange={(e) => handleBindCapability(check.type!, e.target.value)}
                            value=""
                            disabled={bindingCapability === check.type}
                          >
                            <option value="" disabled>Select connected account...</option>
                            {integrations
                              .filter(i => registry.find(r => r.id === i.provider)?.supportedCapabilities?.includes(check.type))
                              .map(i => (
                                <option key={i.id} value={i.id}>{i.displayName || i.provider}</option>
                              ))
                            }
                          </select>
                        ) : (
                          <button 
                            onClick={() => navigate(`/dashboard/integrations/discovery?requires=${check.type}`)}
                            className="w-full text-sm bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 rounded-lg font-medium transition-colors"
                          >
                            Connect Provider
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'HISTORY' && (
              <div className="space-y-4">
                <h3 className="font-bold text-slate-900 mb-4">Recent Executions</h3>
                {executions.length === 0 ? (
                  <div className="text-center py-16 bg-slate-50 rounded-xl border border-slate-100">
                    <Activity className="w-8 h-8 mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-medium text-slate-900">No executions recorded</p>
                    <p className="text-xs text-slate-500 max-w-[200px] mx-auto mt-1">This workflow hasn't run yet. Activate it or trigger a test run.</p>
                  </div>
                ) : (
                  executions.map((exec) => (
                    <div key={exec.id} className="p-3 border border-slate-200 rounded-xl hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer bg-white group flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-semibold text-slate-900">{new Date(exec.startedAt).toLocaleTimeString()}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                          exec.status === 'SUCCESS' || exec.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                          exec.status === 'FAILED' ? 'bg-rose-100 text-rose-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {exec.status}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-slate-500 font-mono">
                        <span>{exec.id.split('-')[0]}</span>
                        <span>{exec.triggerType || 'MANUAL'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
