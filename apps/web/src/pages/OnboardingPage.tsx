import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../lib/api';

export default function OnboardingPage() {
  const [formData, setFormData] = useState({ name: '', industry: '', website: '', description: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // If they already have a business, skip onboarding
    apiCall('/businesses').then(res => {
      if (res.data && res.data.length > 0) {
        navigate('/dashboard');
      }
    }).catch(() => {});
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      await apiCall('/businesses', {
        method: 'POST',
        body: JSON.stringify(formData)
      });
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Tell us about your business</h2>
        <p className="text-slate-500 mb-8">This helps Agent Flux understand your processes better.</p>
        
        <form className="space-y-6" onSubmit={handleSubmit}>
          {error && <div className="text-red-500 text-sm bg-red-50 p-3 rounded">{error}</div>}
          
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700">Business name</label>
              <input required type="text" placeholder="e.g. NovaCart" className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700">Industry</label>
              <input required type="text" placeholder="e.g. E-commerce" className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500" value={formData.industry} onChange={e => setFormData({...formData, industry: e.target.value})} />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700">Website</label>
              <input type="url" placeholder="https://example.com" className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500" value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700">Description</label>
              <textarea rows={4} placeholder="We sell consumer electronics online." className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
            </div>
          </div>
          
          <div className="flex justify-end pt-4">
            <button disabled={loading} type="submit" className="bg-primary-600 hover:bg-primary-700 text-white py-2 px-6 border border-transparent rounded-md shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50">
              {loading ? 'Creating...' : 'Create Business'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
