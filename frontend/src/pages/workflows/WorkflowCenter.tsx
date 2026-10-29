import { useState, useEffect } from 'react';
import { apiCall } from '../../lib/api';
import { Play, Settings, Plus, Search, FileText, Trash2, AlertTriangle, Sparkles, X, Loader2, ArrowLeft } from 'lucide-react';
import { Link, useOutletContext, useNavigate } from 'react-router-dom';

const CATEGORIES = [
  'All',
  'CUSTOMER SUPPORT',
  'SALES',
  'OPERATIONS',
  'FINANCE',
  'MANAGEMENT',
  'COMMUNICATION',
  'RENEWALS'
];

export default function WorkflowCenter() {
  const { business } = useOutletContext<{ business: any }>();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('your_automations');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMode, setCreateMode] = useState<'SELECT' | 'AI'>('SELECT');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  // Deletion state
  const [workflowToDelete, setWorkflowToDelete] = useState<any>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (business) {
      loadData();
    }
  }, [business]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [workflowsRes, templatesRes] = await Promise.all([
        apiCall(`/workflows?businessId=${business.id}`),
        apiCall('/workflow-templates')
      ]);
      setWorkflows(workflowsRes.data.filter((w: any) => w.status !== 'DRAFT'));
      setTemplates(templatesRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateWorkflow = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const res = await apiCall('/workflows/generate', {
        method: 'POST',
        body: JSON.stringify({ businessId: business.id, prompt })
      });
      if (res.data?.workflowId) {
        setShowCreateModal(false);
        navigate(`/dashboard/workflows/${res.data.workflowId}`);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to generate workflow');
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteWorkflow = async () => {
    if (!workflowToDelete || deleteConfirmText !== workflowToDelete.name) return;
    
    setIsDeleting(true);
    try {
      await apiCall(`/workflows/${workflowToDelete.id}?businessId=${business.id}`, { method: 'DELETE' });
      setWorkflows(workflows.filter(w => w.id !== workflowToDelete.id));
      setWorkflowToDelete(null);
      setDeleteConfirmText('');
    } catch (e) {
      console.error("Failed to delete workflow", e);
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          t.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = activeCategory === 'All' || t.category === activeCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12 animate-in fade-in duration-500 relative">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Automations</h1>
          <p className="text-slate-500 mt-2 text-lg">Streamline your business with AI-powered workflows.</p>
        </div>
        <button 
          onClick={() => setShowCreateModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-all"
        >
          <Plus size={18} /> Create Workflow
        </button>
      </div>

      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('your_automations')}
          className={`px-6 py-4 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'your_automations' ? 'border-primary-500 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'}`}
        >
          Your Automations
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-6 py-4 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'templates' ? 'border-primary-500 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'}`}
        >
          Workflow Templates
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500 flex justify-center"><Loader2 className="animate-spin w-8 h-8 text-primary-500" /></div>
      ) : activeTab === 'your_automations' ? (
        <div className="space-y-6">
          {workflows.length === 0 ? (
            <div className="text-center py-24 bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
              <FileText className="mx-auto h-12 w-12 text-slate-400 mb-4" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">Your business doesn't have any automations yet.</h3>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">Start by exploring our template catalog and create your first AI-powered workflow to save time.</p>
              <div className="flex items-center justify-center gap-4">
                <button onClick={() => setShowCreateModal(true)} className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-lg font-medium shadow-sm transition-all">Create Workflow</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {workflows.map((w: any) => (
                <div key={w.id} className="relative group">
                  <Link to={`/dashboard/workflows/${w.id}`} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col cursor-pointer block h-full">
                    <div className="flex justify-between items-start mb-4">
                      <span className="text-xs font-bold px-2 py-1 bg-slate-100 text-slate-600 rounded uppercase tracking-wider">{w.category || 'WORKFLOW'}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 ${w.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : w.status === 'PAUSED' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                          {w.status === 'ACTIVE' ? <Play size={12} fill="currentColor" /> : <Settings size={12} />}
                          {w.status}
                        </span>
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-primary-600 transition-colors pr-8">{w.name}</h3>
                    <p className="text-sm text-slate-500 mb-6 flex-1 line-clamp-2">{w.description}</p>
                  </Link>
                  <button 
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setWorkflowToDelete(w);
                      setDeleteConfirmText('');
                    }}
                    className="absolute top-16 right-4 p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete workflow"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
              {CATEGORIES.map(category => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    activeCategory === category
                      ? 'bg-primary-50 text-primary-700 border border-primary-200'
                      : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            
            <div className="relative shrink-0 w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTemplates.map((template) => (
              <div key={template.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow group flex flex-col">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <span className="text-xs font-bold px-2 py-1 bg-primary-50 text-primary-700 rounded uppercase tracking-wider">{template.category}</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">{template.name}</h3>
                  <p className="text-sm text-slate-500 flex-1 line-clamp-3">{template.description}</p>
                </div>
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 mt-auto">
                  <Link to={`/dashboard/templates/${template.id}`} className="w-full flex items-center justify-center gap-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white py-2.5 px-4 rounded-lg transition-colors">
                    Use Template <Plus className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col">
              <div className="flex justify-between items-center p-6 border-b border-slate-100">
                 <h2 className="text-xl font-bold text-slate-900">Create Workflow</h2>
                 <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={24} />
                 </button>
              </div>

              {createMode === 'SELECT' ? (
                <div className="p-8 flex gap-6">
                   <div 
                     onClick={() => {
                       setShowCreateModal(false);
                       setActiveTab('templates');
                     }}
                     className="flex-1 border-2 border-slate-200 hover:border-primary-500 hover:bg-primary-50 p-6 rounded-2xl cursor-pointer transition-all text-center group"
                   >
                     <div className="w-16 h-16 bg-slate-100 group-hover:bg-primary-100 rounded-xl flex items-center justify-center mx-auto mb-4 transition-colors">
                        <FileText className="text-slate-600 group-hover:text-primary-600 w-8 h-8" />
                     </div>
                     <h3 className="text-lg font-bold text-slate-900 mb-2">Start from Template</h3>
                     <p className="text-sm text-slate-500">Choose from pre-built blueprints and customize them for your business.</p>
                   </div>
                   
                   <div 
                     onClick={() => setCreateMode('AI')}
                     className="flex-1 border-2 border-indigo-200 hover:border-indigo-500 bg-indigo-50/30 hover:bg-indigo-50 p-6 rounded-2xl cursor-pointer transition-all text-center group"
                   >
                     <div className="w-16 h-16 bg-indigo-100 group-hover:bg-indigo-200 rounded-xl flex items-center justify-center mx-auto mb-4 transition-colors">
                        <Sparkles className="text-indigo-600 w-8 h-8" />
                     </div>
                     <h3 className="text-lg font-bold text-slate-900 mb-2">Generate with AI</h3>
                     <p className="text-sm text-slate-500">Describe what you want to automate in plain English and let AI build the flow.</p>
                   </div>
                </div>
              ) : (
                <div className="p-8">
                  <button onClick={() => setCreateMode('SELECT')} className="text-sm font-medium text-slate-500 hover:text-slate-800 flex items-center gap-2 mb-4">
                    <ArrowLeft size={16} /> Back
                  </button>
                  <label className="block font-bold text-slate-900 mb-2">What would you like to automate?</label>
                  <p className="text-sm text-slate-500 mb-4">Example: "When an email arrives from a VIP client, summarize it and send me a slack message."</p>
                  <textarea 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full h-32 border border-slate-300 rounded-xl p-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                    placeholder="Describe your workflow..."
                  />
                  <div className="mt-6 flex justify-end gap-3">
                     <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                     <button 
                       onClick={handleGenerateWorkflow}
                       disabled={generating || !prompt.trim()}
                       className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium shadow-sm disabled:opacity-50 flex items-center gap-2"
                     >
                       {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                       {generating ? 'Generating...' : 'Generate Workflow'}
                     </button>
                  </div>
                </div>
              )}
           </div>
        </div>
      )}

      {/* DELETE MODAL */}
      {workflowToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="bg-rose-100 p-2 rounded-full">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-xl font-bold">Delete Workflow?</h3>
            </div>
            
            <p className="text-slate-600 mb-4">
              You are about to permanently delete <strong className="text-slate-900">{workflowToDelete.name}</strong>. 
              This action cannot be undone and will stop any active executions.
            </p>
            
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Type <span className="font-mono font-bold select-all bg-slate-100 px-1 py-0.5 rounded text-rose-600">{workflowToDelete.name}</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 font-mono text-sm"
                placeholder={workflowToDelete.name}
              />
            </div>
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setWorkflowToDelete(null);
                  setDeleteConfirmText('');
                }}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteWorkflow}
                disabled={deleteConfirmText !== workflowToDelete.name || isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Delete Workflow'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
