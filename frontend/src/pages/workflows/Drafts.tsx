import { useState, useEffect } from 'react';
import { apiCall } from '../../lib/api';
import { Settings, Plus, Search, FileText, Trash2, AlertTriangle, Clock } from 'lucide-react';
import { Link, useOutletContext, useNavigate } from 'react-router-dom';

export default function Drafts() {
  const { business } = useOutletContext<{ business: any }>();
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Deletion state
  const [workflowToDelete, setWorkflowToDelete] = useState<any>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (business) {
      loadDrafts();
    }
  }, [business]);

  const loadDrafts = async () => {
    setLoading(true);
    try {
      // Assuming the backend GET /workflows can take a status filter.
      // If not, we fetch all and filter in frontend for now.
      const res = await apiCall(`/workflows?businessId=${business.id}`);
      setDrafts(res.data.filter((w: any) => w.status === 'DRAFT'));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWorkflow = async () => {
    if (!workflowToDelete || deleteConfirmText !== workflowToDelete.name) return;
    
    setIsDeleting(true);
    try {
      await apiCall(`/workflows/${workflowToDelete.id}?businessId=${business.id}`, { method: 'DELETE' });
      setDrafts(drafts.filter(w => w.id !== workflowToDelete.id));
      setWorkflowToDelete(null);
      setDeleteConfirmText('');
    } catch (e) {
      console.error("Failed to delete draft", e);
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredDrafts = drafts.filter(d => 
    d.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (d.description && d.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Draft Workflows</h1>
          <p className="text-slate-500 mt-2 text-lg">Workflows that are currently being configured.</p>
        </div>
        <button 
          onClick={() => navigate('/dashboard/workflows')}
          className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-all"
        >
          <Plus size={18} /> New Workflow
        </button>
      </div>

      <div className="flex border-b border-slate-200 justify-between items-center pb-4">
        <div className="flex gap-4">
          <button className="px-4 py-2 text-sm font-semibold rounded-full bg-slate-900 text-white">All Drafts</button>
        </div>
        <div className="relative w-full md:w-72 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input 
            type="text"
            placeholder="Search drafts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500">Loading drafts...</div>
      ) : (
        <div className="space-y-6">
          {filteredDrafts.length === 0 ? (
            <div className="text-center py-24 bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
              <FileText className="mx-auto h-12 w-12 text-slate-400 mb-4" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">No drafts found.</h3>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">You don't have any incomplete workflows in this business.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredDrafts.map((w: any) => (
                <div key={w.id} className="relative group">
                  <Link to={`/dashboard/workflows/${w.id}`} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col cursor-pointer block h-full">
                    <div className="flex justify-between items-start mb-4">
                      <span className="text-xs font-bold px-2 py-1 bg-slate-100 text-slate-600 rounded uppercase tracking-wider">{w.category || 'WORKFLOW'}</span>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 bg-slate-100 text-slate-700">
                        <Settings size={12} />
                        DRAFT
                      </span>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-primary-600 transition-colors pr-8">{w.name}</h3>
                    <p className="text-sm text-slate-500 mb-6 flex-1 line-clamp-2">{w.description}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-auto pt-4 border-t border-slate-100">
                      <Clock size={12} />
                      <span>Last updated {new Date(w.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </Link>
                  <button 
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setWorkflowToDelete(w);
                      setDeleteConfirmText('');
                    }}
                    className="absolute top-16 right-4 p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete draft"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* GitHub Style Deletion Modal */}
      {workflowToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-rose-100 bg-rose-50/50">
              <div className="flex items-center gap-3 text-rose-600 mb-2">
                <AlertTriangle size={24} />
                <h3 className="text-xl font-bold">Delete Draft</h3>
              </div>
              <p className="text-sm text-rose-800">
                This action <strong className="font-bold">cannot</strong> be undone. This will permanently delete the draft 
                <strong className="font-bold"> {workflowToDelete.name} </strong>.
              </p>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Please type <strong className="bg-slate-100 px-2 py-1 rounded select-all font-mono">{workflowToDelete.name}</strong> to confirm.
                </label>
                <input 
                  type="text" 
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 font-mono text-sm"
                  placeholder={workflowToDelete.name}
                  autoFocus
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => { setWorkflowToDelete(null); setDeleteConfirmText(''); }}
                  className="flex-1 px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDeleteWorkflow}
                  disabled={deleteConfirmText !== workflowToDelete.name || isDeleting}
                  className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isDeleting ? 'Deleting...' : 'Delete this draft'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
