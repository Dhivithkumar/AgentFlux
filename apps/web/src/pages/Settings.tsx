import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { Settings as SettingsIcon, Building, Users, Shield, Zap, Bell, Workflow, Database, Activity, Save, Loader2 } from 'lucide-react';
import WorkflowConfigSettings from '../components/WorkflowConfigSettings';
import OperationsSettings from '../components/OperationsSettings';
import BusinessProfileSettings from '../components/BusinessProfileSettings';

export default function Settings() {
  const { business } = useOutletContext<{ business: any }>();
  const [activeTab, setActiveTab] = useState('GENERAL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    industry: '',
    website: '',
    description: ''
  });

  useEffect(() => {
    if (business) {
      loadSettings();
    }
  }, [business]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await apiCall(`/settings?businessId=${business.id}`);
      if (res.data?.business) {
        setFormData({
          name: res.data.business.name || '',
          industry: res.data.business.industry || '',
          website: res.data.business.website || '',
          description: res.data.business.description || ''
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiCall(`/settings?businessId=${business.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ business: formData })
      });
      alert('Settings saved successfully');
    } catch (e) {
      console.error(e);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const TABS = [
    { id: 'GENERAL', label: 'General', icon: <SettingsIcon size={18} /> },
    { id: 'BUSINESS', label: 'Business Profile', icon: <Building size={18} /> },
    { id: 'TEAM', label: 'Team', icon: <Users size={18} /> },
    { id: 'SECURITY', label: 'Security', icon: <Shield size={18} /> },
    { id: 'AI', label: 'AI Providers', icon: <Zap size={18} /> },
    { id: 'NOTIFICATIONS', label: 'Notifications', icon: <Bell size={18} /> },
    { id: 'WORKFLOWS', label: 'Workflows', icon: <Workflow size={18} /> },
    { id: 'OPERATIONS', label: 'Operations', icon: <Database size={18} /> },
    { id: 'KNOWLEDGE', label: 'Knowledge', icon: <Database size={18} /> },
    { id: 'AUDIT', label: 'Audit Log', icon: <Activity size={18} /> },
  ];

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 text-primary-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Settings</h1>
        <p className="text-slate-500 mt-2 text-lg">Manage configuration for {business.name}.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar Tabs */}
        <div className="w-full md:w-64 shrink-0">
          <nav className="space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className={activeTab === tab.id ? 'text-slate-300' : 'text-slate-400'}>
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 min-h-[500px]">
            {activeTab === 'BUSINESS' ? (
              <BusinessProfileSettings businessId={business.id} />
            ) : activeTab === 'GENERAL' ? (
              <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="border-b border-slate-200 pb-4 mb-6">
                  <h2 className="text-xl font-bold text-slate-900">General Settings</h2>
                  <p className="text-slate-500 mt-1">Update your business details and core configuration.</p>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Business Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
                    <input
                      type="text"
                      value={formData.industry}
                      onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Website</label>
                    <input
                      type="url"
                      value={formData.website}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="https://"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      rows={4}
                    />
                  </div>
                </div>

                <div className="pt-6">
                  <button 
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 transition-all disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    Save Changes
                  </button>
                </div>
              </div>
            ) : activeTab === 'WORKFLOWS' ? (
              <WorkflowConfigSettings businessId={business.id} />
            ) : activeTab === 'OPERATIONS' ? (
              <OperationsSettings businessId={business.id} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center py-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center mb-4">
                  {TABS.find(t => t.id === activeTab)?.icon}
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">{TABS.find(t => t.id === activeTab)?.label} Configuration</h3>
                <p className="text-slate-500 max-w-sm">This configuration module is fully routable and securely locked to your business. Settings options will appear here.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
