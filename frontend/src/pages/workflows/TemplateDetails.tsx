import { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { ArrowLeft, Play, Settings } from 'lucide-react';

export default function TemplateDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { business } = useOutletContext<{ business: any }>();
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    fetchTemplate();
  }, [id]);

  const fetchTemplate = async () => {
    try {
      const res = await apiCall(`/workflow-templates/${id}`);
      setTemplate(res.data);
      if (business) {
        checkIntegrations(res.data);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load template.');
      setLoading(false);
    }
  };

  const [integrationStatus, setIntegrationStatus] = useState<any>({ checked: false, passed: false, missing: [] });

  const checkIntegrations = async (temp: any) => {
    if (!temp.requiredIntegrations || temp.requiredIntegrations.length === 0) {
       setIntegrationStatus({ checked: true, passed: true, missing: [] });
       setLoading(false);
       return;
    }
    
    try {
      // Fetch business integrations
      const res = await apiCall('/integrations', { method: 'GET' }); // assuming we can get them here, or fetch business profile
      // Actually we can fetch the business profile to get integrations
      const busRes = await apiCall(`/businesses/${business.id}`);
      const activeIntegrations = busRes.data?.integrations?.filter((i: any) => i.status === 'CONNECTED').map((i: any) => i.provider) || [];
      
      const missing = temp.requiredIntegrations.filter((req: string) => !activeIntegrations.includes(req));
      
      setIntegrationStatus({
        checked: true,
        passed: missing.length === 0,
        missing
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUseWorkflow = async () => {
    if (!business) return;
    setCloning(true);
    try {
      const res = await apiCall(`/workflow-templates/${id}/use`, {
        method: 'POST',
        body: JSON.stringify({ businessId: business.id })
      });
      navigate(`/dashboard/workflows/${res.data.workflowId}`);
    } catch (e: any) {
      setError(e.message || 'Failed to use template.');
      setCloning(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading template...</div>;
  if (error || !template) return <div className="p-8 text-center text-red-500">{error || 'Template not found'}</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">
        <ArrowLeft size={16} className="mr-1" /> Back to templates
      </button>

      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-start">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs font-bold px-2 py-1 bg-primary-50 text-primary-600 rounded uppercase tracking-wider">{template.category}</span>
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded capitalize">{template.riskLevel.toLowerCase()} Risk</span>
        </div>
        
        <h1 className="text-3xl font-bold text-slate-900 mb-4">{template.name}</h1>
        <p className="text-lg text-slate-600 mb-8 max-w-2xl">{template.description}</p>

        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 border-t border-slate-100 pt-8">
          <div>
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2"><Play size={16} className="text-slate-400" /> Trigger</h3>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 text-sm font-medium text-slate-700">
              {template.triggerType}
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2"><Settings size={16} className="text-slate-400" /> Required Apps</h3>
            <div className="flex flex-wrap gap-2">
              {template.requiredIntegrations?.map((app: string) => (
                <span key={app} className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm font-medium text-slate-700 shadow-sm">
                  {app.replace(/^Google_/i, '').replace(/_/g, ' ')}
                </span>
              ))}
              {(!template.requiredIntegrations || template.requiredIntegrations.length === 0) && (
                <span className="text-sm text-slate-500">None</span>
              )}
            </div>
          </div>
        </div>

        <div className="w-full mb-8">
           <h3 className="font-semibold text-slate-900 mb-4">Workflow Steps</h3>
           <div className="space-y-3">
             {template.workflowDefinition?.nodes?.map((node: any, idx: number) => (
               <div key={idx} className="p-4 border border-slate-200 rounded-lg flex items-center gap-4 bg-white shadow-sm">
                 <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-500 shrink-0">
                   {idx + 1}
                 </div>
                 <div>
                   <h4 className="font-medium text-slate-900">{node.type}</h4>
                 </div>
               </div>
             ))}
             {(!template.workflowDefinition?.nodes || template.workflowDefinition.nodes.length === 0) && (
                <p className="text-sm text-slate-500">Steps will be configured in the builder.</p>
             )}
           </div>
        </div>

        <div className="w-full border-t border-slate-100 pt-8 flex flex-col items-end gap-4">
          {integrationStatus.checked && !integrationStatus.passed && (
             <div className="text-rose-600 text-sm font-medium bg-rose-50 px-4 py-2 rounded-md">
               Missing required integrations: {integrationStatus.missing.join(', ')}
             </div>
          )}
          <button 
            onClick={handleUseWorkflow}
            disabled={cloning || (!integrationStatus.passed && integrationStatus.checked)}
            className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-xl font-semibold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cloning ? 'Creating...' : 'Activate Workflow'}
          </button>
        </div>
      </div>
    </div>
  );
}
