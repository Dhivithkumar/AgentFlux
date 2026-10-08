import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { ArrowLeft, CheckCircle2, XCircle, Play, ShieldAlert, Cpu } from 'lucide-react';

export default function WorkflowDetails() {
  const { id } = useParams();
  const [workflow, setWorkflow] = useState<any>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      const [tplRes, intRes] = await Promise.all([
        apiCall('/workflows/templates'),
        apiCall('/integrations')
      ]);
      
      const tpl = tplRes.data.find((t: any) => t.id === id);
      setWorkflow(tpl);
      setConnections(intRes.data);
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const isConnected = (provider: string) => {
    return connections.some(c => c.provider.toUpperCase() === provider.toUpperCase() && c.status === 'CONNECTED');
  };

  const handleConnect = async (provider: string) => {
    try {
      const res = await apiCall("/integrations/" + provider + "/connect", { method: 'POST' });
      if (res.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (e) {
      console.error('Failed to initiate connection', e);
    }
  };

  if (loading) return <div>Loading workflow details...</div>;
  if (!workflow) return <div>Workflow not found</div>;

  const allRequiredConnected = workflow.requiredConnectors.every(isConnected);

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <Link to="/dashboard/workflows" className="text-slate-500 hover:text-slate-800 flex items-center gap-2 text-sm mb-6 font-medium">
        <ArrowLeft size={16} /> Back to Workflows
      </Link>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8">
        <div className="bg-slate-900 p-8 text-white">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs font-bold px-2 py-1 bg-slate-800 text-slate-300 rounded uppercase tracking-wider">{workflow.category}</span>
            <span className="text-xs font-bold px-2 py-1 bg-emerald-900/50 text-emerald-400 rounded flex items-center gap-1">
              <ShieldAlert size={12} /> {workflow.riskLevel} RISK
            </span>
          </div>
          <h1 className="text-3xl font-bold mb-3">{workflow.name}</h1>
          <p className="text-slate-300 max-w-2xl text-lg leading-relaxed">{workflow.description}</p>
        </div>

        <div className="p-8">
          <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Cpu size={20} className="text-primary-500" /> Workflow Steps
          </h2>
          <div className="space-y-4 mb-10">
            <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0">1</div>
              <div>
                <h4 className="font-semibold text-slate-900">Trigger: {workflow.trigger.type.replace(/_/g, ' ')}</h4>
                <p className="text-sm text-slate-500">Listens for incoming events to start the workflow.</p>
              </div>
            </div>
            {workflow.steps.map((step: any, idx: number) => (
              <div key={step.id} className="flex items-center gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200 ml-4 relative before:absolute before:left-[-1rem] before:top-[-1rem] before:h-full before:w-0.5 before:bg-slate-200">
                <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-sm shrink-0 z-10">{idx + 2}</div>
                <div>
                  <h4 className="font-semibold text-slate-900">{step.type.replace(/_/g, ' ')}</h4>
                  <p className="text-sm text-slate-500">Action: {step.id}</p>
                </div>
              </div>
            ))}
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-6">Required Apps</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {workflow.requiredConnectors.map((connector: string) => {
              const connected = isConnected(connector);
              return (
                <div key={connector} className={"p-4 rounded-lg border " + (connected ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50")}>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-slate-900 capitalize">{connector.replace(/_/g, ' ')}</h3>
                    {connected ? <CheckCircle2 className="text-emerald-500" size={20} /> : <XCircle className="text-rose-500" size={20} />}
                  </div>
                  <p className="text-sm mb-4 text-slate-600">
                    {connected ? '? Connected securely' : '? Not connected. Required to run this workflow.'}
                  </p>
                  {!connected && (
                    <button 
                      onClick={() => handleConnect(connector) }
                      className="bg-slate-900 hover:bg-slate-800 text-white text-sm px-4 py-2 rounded-md font-medium transition-colors w-full"
                    >
                      Connect {connector.replace(/_/g, ' ')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {allRequiredConnected ? (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center">
              <CheckCircle2 className="text-emerald-500 w-12 h-12 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">All Required Apps Connected</h3>
              <p className="text-slate-500 mb-6">You can now configure and activate this workflow.</p>
              <div className="flex justify-center gap-4">
                <button className="bg-white border border-slate-300 text-slate-700 px-6 py-2 rounded-md font-medium hover:bg-slate-50">
                  Configure Settings
                </button>
                <button className="bg-primary-600 text-white px-6 py-2 rounded-md font-medium hover:bg-primary-700 flex items-center gap-2">
                  <Play size={18} fill="currentColor" /> Activate Workflow
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center text-slate-500">
              Please connect all required apps above before configuring this workflow.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
