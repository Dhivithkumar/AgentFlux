import { useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { CheckCircle2, AlertCircle, Loader2, Sparkles, Box, Mail, FileSpreadsheet, HardDrive, FileText, Settings, Play } from 'lucide-react';

export default function WorkflowPacks() {
  const { business } = useOutletContext<{ business: any }>();
  const navigate = useNavigate();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<any>(null);

  const [activatingIndex, setActivatingIndex] = useState<number | null>(null);

  const handleActivateFurniture = async (index?: number) => {
    if (index !== undefined) {
      setActivatingIndex(index);
    } else {
      setActivating(true);
    }
    setError(null);
    setSuccessData(null);
    try {
      const res = await apiCall(`/businesses/${business.id}/workflow-packs/furniture/activate`, {
        method: 'POST',
        body: JSON.stringify(index !== undefined ? { workflowIndex: index } : {})
      });
      setSuccessData(res.data);
    } catch (e: any) {
      setError(e.message || 'Failed to activate the automation. Please ensure all requirements are met.');
    } finally {
      setActivating(false);
      setActivatingIndex(null);
    }
  };

  const workflowsList = [
    'Enquiry Management',
    'Quotation & Approval',
    'Order Management',
    'Invoice Generation',
    'Payment Collection',
    'Payment Reminders',
    'Customer Notifications'
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          <Box className="text-primary-600" />
          Business Automation Packs
        </h1>
        <p className="text-slate-500 mt-2 text-lg">One-click deployment of complete, end-to-end business lifecycles.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none">
            <Sparkles size={120} />
          </div>
          <h2 className="text-2xl font-bold mb-2 relative z-10">Furniture Business Automation</h2>
          <p className="text-slate-300 max-w-xl relative z-10">
            Automate your complete customer lifecycle. This pack installs 7 interconnected workflows designed specifically for furniture businesses, handling everything from enquiry intake to payment reminders.
          </p>
        </div>

        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Left Column - Features */}
          <div>
            <h3 className="font-bold text-slate-900 mb-4 uppercase text-sm tracking-wider">Included Workflows</h3>
            <ul className="space-y-3">
              {workflowsList.map((item, i) => (
                <li key={i} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-lg">
                  <div className="flex items-center gap-3 text-slate-700 font-medium">
                    <CheckCircle2 className="text-emerald-500 w-5 h-5 shrink-0" />
                    <span>{item}</span>
                  </div>
                  <button
                    onClick={() => handleActivateFurniture(i)}
                    disabled={activatingIndex === i || activating}
                    className="text-xs px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200 transition-colors font-medium flex items-center gap-1 disabled:opacity-50"
                  >
                    {activatingIndex === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    Activate
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Right Column - Requirements */}
          <div>
            <h3 className="font-bold text-slate-900 mb-4 uppercase text-sm tracking-wider">Prerequisites</h3>
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 space-y-3">
                <div className="flex items-center gap-3 text-sm text-slate-700">
                  <Mail className="w-4 h-4 text-slate-400" /> Gmail Connected
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-700">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> Google Sheets Connected
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-700">
                  <HardDrive className="w-4 h-4 text-blue-500" /> Google Drive Connected
                </div>
              </div>
              
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 space-y-3">
                <div className="flex items-center gap-3 text-sm text-slate-700">
                  <FileText className="w-4 h-4 text-amber-500" /> Knowledge Centre Indexed
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-700">
                  <Settings className="w-4 h-4 text-slate-400" /> Quotation Template Active
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-700">
                  <Settings className="w-4 h-4 text-slate-400" /> Invoice Template Active
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="bg-slate-50 border-t border-slate-200 p-8">
          {error && (
            <div className="mb-6 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold">Activation Failed</strong>
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          {successData ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-slate-900 mb-2">Furniture Automation Activated!</h3>
              <p className="text-slate-600 mb-6 max-w-md mx-auto">
                Successfully installed {successData.workflows} workflows. Your business operations are now automated and listening for triggers.
              </p>
              <div className="flex justify-center gap-4">
                <button 
                  onClick={() => navigate('/dashboard/workflows')}
                  className="px-6 py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors"
                >
                  View Workflows
                </button>
                <button 
                  className="px-6 py-2.5 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2"
                >
                  <Play className="w-4 h-4" /> Run Test
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                Clicking activate will provision the workflows. Ensure all prerequisites are met.
              </p>
              <button
                onClick={() => handleActivateFurniture()}
                disabled={activating || activatingIndex !== null}
                className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:hover:bg-primary-600 text-white px-8 py-3 rounded-xl font-bold shadow-sm transition-all flex items-center gap-2"
              >
                {activating ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Activating...</>
                ) : (
                  <><Sparkles className="w-5 h-5" /> ACTIVATE ALL</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
