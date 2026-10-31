import { useState, useEffect } from 'react';
import { useOutletContext, useParams, useNavigate } from 'react-router-dom';
import { 
  Play, CheckCircle, AlertTriangle, XCircle, ArrowLeft, Loader2, 
  Layout, Settings, ShieldCheck, Activity, RotateCcw, History, 
  Plus, GitBranch, Save, RefreshCw, X, Check, Clock, AlertCircle
} from 'lucide-react';
import { WorkflowCanvas } from './WorkflowCanvas';
import { API_URL } from '../../lib/api';

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
  const [publishing, setPublishing] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  
  const [executions, setExecutions] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [showVersionsModal, setShowVersionsModal] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<any>(null);
  const [loadingExecutionDetails, setLoadingExecutionDetails] = useState(false);
  
  const [config, setConfig] = useState<any>({});
  const [triggerConfig, setTriggerConfig] = useState<any>({ type: 'MANUAL' });
  const [nodes, setNodes] = useState<any[]>([]);
  const [calendars, setCalendars] = useState<any[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [registry, setRegistry] = useState<any[]>([]);
  const [bindingCapability, setBindingCapability] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'CONFIG' | 'TRIGGER' | 'READINESS' | 'HISTORY'>('CONFIG');
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

      const activeVer = workflow.versions?.find((v: any) => v.id === workflow.activeVersionId) || workflow.versions?.[0];
      if (activeVer) {
        setTriggerConfig(activeVer.trigger || { type: 'MANUAL' });
        const initialNodes = activeVer.definition?.nodes || workflow.template?.workflowDefinition?.nodes || [];
        setNodes(initialNodes);
      }
    }
  }, [workflow]);

  useEffect(() => {
    if (!id || !businessId) return;
    fetchData();
  }, [id, businessId]);

  const fetchData = async () => {
    try {
      const [wfRes, readyRes, execRes, versRes, intRes, regRes] = await Promise.all([
        fetch(`${API_URL}/workflows/${id}?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null),
        fetch(`${API_URL}/workflows/${id}/readiness?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null),
        fetch(`${API_URL}/workflows/${id}/executions?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null),
        fetch(`${API_URL}/workflows/${id}/versions?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null),
        fetch(`${API_URL}/integrations?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null),
        fetch(`${API_URL}/integrations/registry`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.text()).then(t => t ? JSON.parse(t) : null)
      ]);

      if (wfRes?.success) setWorkflow(wfRes.data);
      if (readyRes?.success) setReadiness(readyRes.data);
      if (execRes?.success) setExecutions(execRes.data);
      if (versRes?.success) setVersions(versRes.data);
      if (intRes?.success) setIntegrations(intRes.data);
      if (regRes?.success) setRegistry(regRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const res = await fetch(`${API_URL}/workflows/${id}/definition`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({
          businessId,
          definition: { nodes },
          trigger: triggerConfig,
          config
        })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);

      if (res?.success) {
        alert('Draft saved successfully');
        fetchData();
      } else {
        alert('Failed to save draft: ' + (res?.error || 'Unknown error'));
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const handlePublish = async () => {
    if (!confirm('Publishing will compile this DAG into a new immutable version and activate it. Proceed?')) return;
    setPublishing(true);
    try {
      const res = await fetch(`${API_URL}/workflows/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({
          businessId,
          definition: { nodes },
          trigger: triggerConfig
        })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);

      if (res?.success) {
        alert('Published successfully as new active version!');
        fetchData();
      } else {
        alert('Failed to publish: ' + (res?.error || 'Unknown error'));
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleRollback = async (versionId: string) => {
    if (!confirm(`Are you sure you want to rollback active execution to version ID ${versionId}?`)) return;
    try {
      const res = await fetch(`${API_URL}/workflows/${id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ businessId, versionId })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);

      if (res?.success) {
        alert('Workflow rolled back successfully');
        setShowVersionsModal(false);
        fetchData();
      } else {
        alert('Rollback failed: ' + (res?.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const handleManualTrigger = async () => {
    setTriggering(true);
    try {
      const payloadStr = prompt('Enter JSON payload for trigger (e.g. {"amount": 50000, "customer": "Acme Corp"})', '{}');
      let payload = {};
      try { payload = JSON.parse(payloadStr || '{}'); } catch(e) {}

      const res = await fetch(`${API_URL}/workflows/${id}/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ businessId, payload, triggerType: 'MANUAL', sync: true })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);

      if (res?.success) {
        alert('Execution finished: ' + res.data.executionId);
        fetchData();
      } else {
        alert('Trigger failed: ' + res?.error);
      }
    } catch (e: any) {
      alert('Error triggering execution: ' + e.message);
    } finally {
      setTriggering(false);
    }
  };

  const handleCancelExecution = async (execId: string) => {
    const reason = prompt('Reason for cancellation:', 'Operator requested cancel');
    if (reason === null) return;

    try {
      const res = await fetch(`${API_URL}/workflows/executions/${execId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ reason })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);

      if (res?.success) {
        alert('Execution cancelled');
        fetchData();
        if (selectedExecution?.id === execId) viewExecutionDetails(execId);
      } else {
        alert('Cancellation failed: ' + res?.error);
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const handleRetryExecution = async (execId: string, fromStepId?: string) => {
    try {
      const res = await fetch(`${API_URL}/workflows/executions/${execId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ fromStepId, sync: true })
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);

      if (res?.success) {
        alert('Execution retried successfully');
        fetchData();
        if (selectedExecution?.id === execId) viewExecutionDetails(execId);
      } else {
        alert('Retry failed: ' + res?.error);
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const viewExecutionDetails = async (execId: string) => {
    setLoadingExecutionDetails(true);
    try {
      const res = await fetch(`${API_URL}/workflows/executions/${execId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      }).then(r => r.text()).then(t => t ? JSON.parse(t) : null);

      if (res?.success) {
        setSelectedExecution(res.data);
      }
    } finally {
      setLoadingExecutionDetails(false);
    }
  };

  const handleAddNode = (type: string) => {
    const stepId = `${type.toLowerCase()}_${Date.now().toString().slice(-4)}`;
    const newNode = {
      id: stepId,
      type,
      name: `New ${type}`,
      config: type === 'CONDITION' ? {
        field: 'trigger.amount',
        operator: 'GREATER_THAN',
        value: 1000
      } : { actionId: 'system.log' },
      next: type === 'CONDITION' ? { YES: '', NO: '' } : null,
      failurePolicy: 'FAIL_FAST'
    };

    setNodes([...nodes, newNode]);
    setSelectedNode(newNode);
  };

  const handleUpdateNode = (updatedNode: any) => {
    setNodes(nodes.map(n => n.id === updatedNode.id ? updatedNode : n));
    setSelectedNode(updatedNode);
  };

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>;
  }

  if (!workflow) {
    return <div className="p-8 text-center text-gray-500">Workflow not found</div>;
  }

  const activeVersion = workflow.versions?.find((v: any) => v.id === workflow.activeVersionId) || workflow.versions?.[0];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden animate-in fade-in duration-500 pb-2 px-2 sm:px-4">
      {/* Top Header */}
      <div className="flex items-center gap-4 mb-4 shrink-0 pt-3">
        <button onClick={() => navigate('/dashboard/workflows')} className="p-2 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 bg-white">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{workflow.name}</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              v{activeVersion?.versionNumber || 1} ({activeVersion?.status || 'ACTIVE'})
            </span>
          </div>
          <p className="text-slate-500 text-xs">{workflow.description || 'Configurable business automation workflow'}</p>
        </div>
        
        <div className="ml-auto flex items-center gap-2.5">
          <button
            onClick={() => setShowVersionsModal(true)}
            className="px-3.5 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs rounded-lg flex items-center gap-1.5 shadow-sm"
          >
            <History size={14} /> Version History
          </button>

          <button
            onClick={handleSaveDraft}
            disabled={savingDraft}
            className="px-3.5 py-2 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium text-xs rounded-lg flex items-center gap-1.5 shadow-sm"
          >
            {savingDraft ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Draft
          </button>

          <button
            onClick={handlePublish}
            disabled={publishing}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-lg flex items-center gap-1.5 shadow-sm"
          >
            {publishing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Publish Version
          </button>

          <button 
            onClick={handleManualTrigger}
            disabled={triggering}
            className="px-4 py-2 bg-emerald-600 text-white font-medium text-xs rounded-lg hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm"
          >
            {triggering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Test Run
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-6 min-h-0">
        {/* Canvas Area */}
        <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative">
          <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-white/90 backdrop-blur px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
            <Layout size={16} className="text-indigo-600" />
            <span className="text-xs font-bold text-slate-800">Visual DAG Canvas</span>
            <div className="h-4 w-[1px] bg-slate-200 mx-1" />
            
            <button
              onClick={() => handleAddNode('ACTION')}
              className="text-[11px] font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
            >
              <Plus size={12} /> Action
            </button>
            <button
              onClick={() => handleAddNode('CONDITION')}
              className="text-[11px] font-semibold text-slate-600 hover:text-amber-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
            >
              <GitBranch size={12} /> Condition
            </button>
            <button
              onClick={() => handleAddNode('APPROVAL')}
              className="text-[11px] font-semibold text-slate-600 hover:text-purple-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
            >
              <ShieldCheck size={12} /> Approval
            </button>
          </div>

          <WorkflowCanvas nodes={nodes} onNodeSelect={setSelectedNode} />
        </div>

        {/* Sidebar */}
        <div className="w-[430px] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden shrink-0">
          <div className="flex border-b border-slate-200 p-2 gap-1 bg-slate-50">
            <button 
              onClick={() => setActiveTab('CONFIG')}
              className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${activeTab === 'CONFIG' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Settings size={14} /> Nodes
            </button>
            <button 
              onClick={() => setActiveTab('TRIGGER')}
              className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${activeTab === 'TRIGGER' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Play size={14} /> Trigger
            </button>
            <button 
              onClick={() => setActiveTab('READINESS')}
              className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${activeTab === 'READINESS' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <ShieldCheck size={14} /> Readiness
            </button>
            <button 
              onClick={() => setActiveTab('HISTORY')}
              className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${activeTab === 'HISTORY' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Activity size={14} /> History ({executions.length})
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {/* TAB 1: NODES CONFIG */}
            {activeTab === 'CONFIG' && (
              <div className="space-y-4">
                {!selectedNode ? (
                  <div className="text-center py-12 text-slate-400">
                    <Settings className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-xs font-medium text-slate-600">No node selected</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-[220px] mx-auto">
                      Click any step in the canvas above or add a new node to configure properties.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase">
                          {selectedNode.type}
                        </span>
                        <h3 className="font-bold text-slate-900 text-sm mt-1">{selectedNode.id}</h3>
                      </div>
                      <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-slate-600">
                        <X size={16} />
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Step Name</label>
                      <input
                        type="text"
                        className="w-full text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        value={selectedNode.name || ''}
                        onChange={(e) => handleUpdateNode({ ...selectedNode, name: e.target.value })}
                      />
                    </div>

                    {/* CONDITION SPECIFIC CONFIG */}
                    {selectedNode.type === 'CONDITION' && (
                      <div className="space-y-3 p-3 bg-amber-50/60 rounded-xl border border-amber-200/60">
                        <h4 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                          <GitBranch size={14} /> Branch Rules (IF / THEN)
                        </h4>
                        
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">Evaluation Field</label>
                          <input
                            type="text"
                            placeholder="e.g. trigger.amount or steps.verify.output.passed"
                            className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-white"
                            value={selectedNode.config?.field || ''}
                            onChange={(e) => handleUpdateNode({
                              ...selectedNode,
                              config: { ...(selectedNode.config || {}), field: e.target.value }
                            })}
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">Comparison Operator</label>
                          <select
                            className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-white"
                            value={selectedNode.config?.operator || 'EQUALS'}
                            onChange={(e) => handleUpdateNode({
                              ...selectedNode,
                              config: { ...(selectedNode.config || {}), operator: e.target.value }
                            })}
                          >
                            <option value="EQUALS">EQUALS</option>
                            <option value="NOT_EQUALS">NOT EQUALS</option>
                            <option value="GREATER_THAN">GREATER THAN</option>
                            <option value="GREATER_THAN_OR_EQUAL">GREATER THAN OR EQUAL</option>
                            <option value="LESS_THAN">LESS THAN</option>
                            <option value="LESS_THAN_OR_EQUAL">LESS THAN OR EQUAL</option>
                            <option value="CONTAINS">CONTAINS</option>
                            <option value="IN">IN LIST</option>
                            <option value="EXISTS">EXISTS</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">Expected Value</label>
                          <input
                            type="text"
                            placeholder="e.g. 50000 or true"
                            className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-white"
                            value={selectedNode.config?.value !== undefined ? String(selectedNode.config.value) : ''}
                            onChange={(e) => handleUpdateNode({
                              ...selectedNode,
                              config: { ...(selectedNode.config || {}), value: e.target.value }
                            })}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-amber-200">
                          <div>
                            <label className="block text-[10px] font-bold text-emerald-700 mb-1">YES Target Node</label>
                            <input
                              type="text"
                              placeholder="target_step_id"
                              className="w-full text-xs p-1.5 rounded border border-emerald-300 bg-white"
                              value={selectedNode.next?.YES || ''}
                              onChange={(e) => handleUpdateNode({
                                ...selectedNode,
                                next: { ...(selectedNode.next || {}), YES: e.target.value }
                              })}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-rose-700 mb-1">NO Target Node</label>
                            <input
                              type="text"
                              placeholder="target_step_id"
                              className="w-full text-xs p-1.5 rounded border border-rose-300 bg-white"
                              value={selectedNode.next?.NO || ''}
                              onChange={(e) => handleUpdateNode({
                                ...selectedNode,
                                next: { ...(selectedNode.next || {}), NO: e.target.value }
                              })}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ACTION SPECIFIC CONFIG */}
                    {selectedNode.type === 'ACTION' && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Action Identifier</label>
                          <input
                            type="text"
                            placeholder="e.g. customer.create, order.confirm, gmail.send"
                            className="w-full text-xs p-2 rounded-lg border border-slate-200"
                            value={selectedNode.config?.actionId || selectedNode.config?.action || ''}
                            onChange={(e) => handleUpdateNode({
                              ...selectedNode,
                              config: { ...(selectedNode.config || {}), actionId: e.target.value }
                            })}
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Failure Policy</label>
                          <select
                            className="w-full text-xs p-2 rounded-lg border border-slate-200"
                            value={selectedNode.failurePolicy || 'FAIL_FAST'}
                            onChange={(e) => handleUpdateNode({ ...selectedNode, failurePolicy: e.target.value })}
                          >
                            <option value="FAIL_FAST">Fail Fast (Stop Workflow Immediately)</option>
                            <option value="CONTINUE_ON_FAILURE">Continue On Failure (Log & Proceed)</option>
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Max Retries</label>
                            <input
                              type="number"
                              min="1"
                              max="10"
                              className="w-full text-xs p-2 rounded-lg border border-slate-200"
                              value={selectedNode.retryPolicy?.maxAttempts || 1}
                              onChange={(e) => handleUpdateNode({
                                ...selectedNode,
                                retryPolicy: { ...(selectedNode.retryPolicy || {}), maxAttempts: parseInt(e.target.value) || 1 }
                              })}
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Backoff Delay (ms)</label>
                            <input
                              type="number"
                              min="100"
                              step="500"
                              className="w-full text-xs p-2 rounded-lg border border-slate-200"
                              value={selectedNode.retryPolicy?.delayMs || 500}
                              onChange={(e) => handleUpdateNode({
                                ...selectedNode,
                                retryPolicy: { ...(selectedNode.retryPolicy || {}), delayMs: parseInt(e.target.value) || 500 }
                              })}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Raw Node Config (JSON)</label>
                      <textarea
                        className="w-full text-[11px] font-mono p-2.5 rounded-lg border border-slate-200 bg-slate-50 h-32"
                        value={JSON.stringify(selectedNode.config || {}, null, 2)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            handleUpdateNode({ ...selectedNode, config: parsed });
                          } catch {}
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: TRIGGER CONFIG */}
            {activeTab === 'TRIGGER' && (
              <div className="space-y-4">
                <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                  <h4 className="text-xs font-bold text-indigo-900 mb-1">Execution Trigger</h4>
                  <p className="text-[11px] text-slate-600">
                    Defines how this workflow starts: on application events, scheduled intervals, or manual user requests.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Trigger Type</label>
                  <select
                    className="w-full text-xs p-2 rounded-lg border border-slate-200"
                    value={triggerConfig.type || 'MANUAL'}
                    onChange={(e) => setTriggerConfig({ ...triggerConfig, type: e.target.value })}
                  >
                    <option value="MANUAL">Manual (On-Demand / API)</option>
                    <option value="EVENT">Event Driven (Application Event)</option>
                    <option value="SCHEDULE">Scheduled (CRON Expression)</option>
                  </select>
                </div>

                {triggerConfig.type === 'EVENT' && (
                  <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Event Type</label>
                      <input
                        type="text"
                        placeholder="e.g. ORDER_CONFIRMED, CUSTOMER_CREATED, PAYMENT_RECEIVED"
                        className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-white"
                        value={triggerConfig.eventType || ''}
                        onChange={(e) => setTriggerConfig({ ...triggerConfig, eventType: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Event Filter (Optional Condition JSON)</label>
                      <textarea
                        placeholder='{"all": [{"field": "totalAmount", "operator": "GREATER_THAN", "value": 5000}]}'
                        className="w-full text-[11px] font-mono p-2 rounded-lg border border-slate-200 bg-white h-24"
                        value={triggerConfig.filters ? JSON.stringify(triggerConfig.filters, null, 2) : ''}
                        onChange={(e) => {
                          try {
                            setTriggerConfig({ ...triggerConfig, filters: JSON.parse(e.target.value) });
                          } catch {}
                        }}
                      />
                    </div>
                  </div>
                )}

                {triggerConfig.type === 'SCHEDULE' && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">CRON Pattern</label>
                    <input
                      type="text"
                      placeholder="e.g. 0 9 * * 1-5 (Every weekday at 9:00 AM)"
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-white"
                      value={triggerConfig.cron || ''}
                      onChange={(e) => setTriggerConfig({ ...triggerConfig, cron: e.target.value })}
                    />
                    <p className="text-[10px] text-slate-500">Uses standard 5-part cron syntax (minute, hour, day, month, day-of-week).</p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: READINESS */}
            {activeTab === 'READINESS' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h4 className="text-xs font-bold text-slate-900">Pre-Flight Readiness</h4>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    readiness?.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {readiness?.ready ? 'Ready to Run' : 'Needs Config'}
                  </span>
                </div>

                {readiness?.checks?.map((check, i) => (
                  <div key={i} className="p-3 rounded-xl border border-slate-100 bg-slate-50/60 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {check.status === 'VALID' || check.status === 'CONNECTED' ? (
                        <CheckCircle size={16} className="text-emerald-500" />
                      ) : (
                        <AlertCircle size={16} className="text-amber-500" />
                      )}
                      <div>
                        <div className="text-xs font-semibold text-slate-800">{check.name}</div>
                        <div className="text-[10px] text-slate-500">{check.type || 'System Check'}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                      {check.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* TAB 4: HISTORY */}
            {activeTab === 'HISTORY' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h4 className="text-xs font-bold text-slate-900">Executions</h4>
                  <button onClick={fetchData} className="text-slate-500 hover:text-slate-800 p-1">
                    <RefreshCw size={12} />
                  </button>
                </div>

                {executions.length === 0 ? (
                  <div className="text-center py-10 text-slate-400">
                    <Activity className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-xs">No executions yet</p>
                  </div>
                ) : (
                  executions.map((exec) => (
                    <div
                      key={exec.id}
                      onClick={() => viewExecutionDetails(exec.id)}
                      className="p-3 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm cursor-pointer transition-all space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          exec.status === 'SUCCESS' || exec.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                          exec.status === 'FAILED' ? 'bg-rose-100 text-rose-700' :
                          exec.status === 'CANCELLED' ? 'bg-slate-200 text-slate-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {exec.status}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(exec.startedAt).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="text-xs font-mono text-slate-600 truncate">
                        ID: {exec.id}
                      </div>

                      {exec.error && (
                        <div className="text-[11px] text-rose-600 bg-rose-50 p-1.5 rounded border border-rose-100 truncate">
                          {exec.error}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        {['QUEUED', 'RUNNING', 'WAITING'].includes(exec.status) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancelExecution(exec.id); }}
                            className="text-[10px] text-rose-600 hover:text-rose-800 font-semibold"
                          >
                            Cancel
                          </button>
                        )}
                        {exec.status === 'FAILED' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRetryExecution(exec.id); }}
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                          >
                            <RotateCcw size={10} /> Retry
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* VERSION HISTORY MODAL */}
      {showVersionsModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Immutable Version History</h3>
                <p className="text-xs text-slate-500">Every published version is pinned and cannot be retroactively altered.</p>
              </div>
              <button onClick={() => setShowVersionsModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 max-h-[400px] overflow-y-auto space-y-3">
              {versions.map((ver) => {
                const isActive = ver.id === workflow.activeVersionId;
                return (
                  <div key={ver.id} className={`p-3.5 rounded-xl border flex items-center justify-between ${
                    isActive ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white'
                  }`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">Version {ver.versionNumber}</span>
                        {isActive && (
                          <span className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-0.5 rounded">Active</span>
                        )}
                        <span className="text-[10px] text-slate-500 uppercase">{ver.status}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {ver.steps?.length || 0} steps • {ver._count?.executions || 0} executions • Created {new Date(ver.createdAt).toLocaleDateString()}
                      </div>
                    </div>

                    {!isActive && (
                      <button
                        onClick={() => handleRollback(ver.id)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg shadow-sm"
                      >
                        Rollback to v{ver.versionNumber}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* EXECUTION DETAILS DRAWER / MODAL */}
      {selectedExecution && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-900">Execution Details</h3>
                <p className="text-xs font-mono text-slate-500">{selectedExecution.id}</p>
              </div>
              <button onClick={() => setSelectedExecution(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 max-h-[500px] overflow-y-auto space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Status</div>
                  <div className="font-bold text-sm text-slate-900">{selectedExecution.status}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Trigger</div>
                  <div className="font-bold text-sm text-slate-900">{selectedExecution.triggerType}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Started</div>
                  <div className="font-bold text-sm text-slate-900">{new Date(selectedExecution.startedAt).toLocaleTimeString()}</div>
                </div>
              </div>

              {selectedExecution.error && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  <strong>Error:</strong> {selectedExecution.error}
                </div>
              )}

              <div>
                <h4 className="text-xs font-bold text-slate-900 mb-2">Step Executions</h4>
                <div className="space-y-2">
                  {selectedExecution.stepExecutions?.map((stepEx: any) => (
                    <div key={stepEx.id} className="p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800">{stepEx.step?.name || stepEx.stepId}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          stepEx.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' :
                          stepEx.status === 'FAILED' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {stepEx.status}
                        </span>
                      </div>
                      {stepEx.outputData && (
                        <pre className="text-[10px] bg-slate-50 p-2 rounded border border-slate-100 max-h-24 overflow-y-auto">
                          {JSON.stringify(stepEx.outputData, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
