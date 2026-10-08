import React, { useEffect, useState } from 'react';
import { apiCall } from '../../lib/api';
import { Plus, BookOpen, FileText } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';

export default function KnowledgeCenter() {
  const { business } = useOutletContext<{ business: any }>();
  const [bases, setBases] = useState<any[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();

  const loadBases = async () => {
    if (!business?.id) return;
    const res = await apiCall(`/knowledge?businessId=${business.id}`);
    setBases(res);
  };

  useEffect(() => {
    loadBases();
  }, [business?.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;
    await apiCall('/knowledge', {
      method: 'POST',
      body: JSON.stringify({ name, description, businessId: business.id })
    });
    setIsCreating(false);
    setName('');
    setDescription('');
    loadBases();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Knowledge Centre</h2>
        <button 
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700"
        >
          <Plus size={18} /> Create Knowledge Base
        </button>
      </div>

      {isCreating && (
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm mb-6">
          <h3 className="text-lg font-medium mb-4">New Knowledge Base</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Name</label>
              <input 
                autoFocus
                type="text" 
                required 
                className="mt-1 w-full p-2 border border-slate-300 rounded"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Description</label>
              <textarea 
                className="mt-1 w-full p-2 border border-slate-300 rounded"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="bg-primary-600 text-white px-4 py-2 rounded">Create</button>
              <button type="button" onClick={() => setIsCreating(false)} className="bg-slate-200 px-4 py-2 rounded">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {bases.map(kb => (
          <div 
            key={kb.id} 
            className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-primary-300 transition-colors"
            onClick={() => navigate(`/dashboard/knowledge/${kb.id}`)}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-primary-50 text-primary-600 rounded-lg">
                <BookOpen size={24} />
              </div>
              <h3 className="font-semibold text-lg text-slate-900">{kb.name}</h3>
            </div>
            <p className="text-slate-500 text-sm mb-4 line-clamp-2 min-h-[40px]">
              {kb.description || 'No description provided.'}
            </p>
            <div className="flex items-center justify-between text-sm text-slate-600 border-t border-slate-100 pt-4">
              <div className="flex items-center gap-1">
                <FileText size={16} />
                <span>{kb._count?.documents || 0} Documents</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
