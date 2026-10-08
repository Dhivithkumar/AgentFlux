import { useEffect, useState } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { Activity, LayoutDashboard, Settings, ChevronDown, CheckCircle, LogOut, Plus, Building2, Calendar } from 'lucide-react';

export default function DashboardLayout() {
  const [user, setUser] = useState<any>(null);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newBusinessName, setNewBusinessName] = useState('');
  const [newBusinessIndustry, setNewBusinessIndustry] = useState('');
  const navigate = useNavigate();

  const fetchBusinesses = async () => {
    const busRes = await apiCall('/businesses');
    setBusinesses(busRes.data);
    return busRes.data;
  };

  useEffect(() => {
    Promise.all([
      apiCall('/auth/me'),
      fetchBusinesses()
    ]).then(([userRes, businesses]) => {
      setUser(userRes.data.user);
      if (businesses.length === 0) {
        navigate('/onboarding');
      } else {
        const stored = localStorage.getItem('activeBusinessId');
        if (stored && businesses.find((b: any) => b.id === stored)) {
          setActiveBusinessId(stored);
        } else {
          setActiveBusinessId(businesses[0].id);
        }
      }
    });
  }, [navigate]);

  const handleSwitchBusiness = (id: string) => {
    setActiveBusinessId(id);
    localStorage.setItem('activeBusinessId', id);
    setIsSwitcherOpen(false);
  };

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiCall('/businesses', {
        method: 'POST',
        body: JSON.stringify({ name: newBusinessName, industry: newBusinessIndustry })
      });
      const newBus = res.data;
      await fetchBusinesses();
      handleSwitchBusiness(newBus.id);
      setIsCreateModalOpen(false);
      setNewBusinessName('');
      setNewBusinessIndustry('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    try {
      await apiCall('/auth/logout', { method: 'POST' });
    } catch (e) {}
    localStorage.removeItem('token');
    localStorage.removeItem('activeBusinessId');
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Calendar', path: '/dashboard/calendar', icon: Calendar },
    { name: 'Knowledge', isHeader: true },
    { name: 'Knowledge Centre', path: '/dashboard/knowledge' },
    { name: 'Enquiries', isHeader: true },
    { name: 'Enquiry Inbox', path: '/dashboard/enquiries' },
    { name: 'Orders & Bookings', path: '/dashboard/orders' },
    { name: 'Business Data', path: '/dashboard/business-data' },
    { name: 'Automations', isHeader: true },
    { name: 'Workflow Packs', path: '/dashboard/workflow-packs' },
    { name: 'Workflow Center', path: '/dashboard/workflows' },
    { name: 'Drafts', path: '/dashboard/workflows/drafts' },
    { name: 'Opportunities', path: '/dashboard/workflows/opportunities' },
    { name: 'Approvals', path: '/dashboard/workflows/approvals' },
    { name: 'Executions', path: '/dashboard/workflows/executions' },
    { name: 'Integrations', isHeader: true },
    { name: 'Manage Integrations', path: '/dashboard/integrations' },

    { name: 'Analytics', path: '/dashboard/integrations/analytics' },
    { name: 'Settings', path: '/dashboard/settings', icon: Settings },
  ];

  if (!user || businesses.length === 0 || !activeBusinessId) return <div>Loading...</div>;

  const currentBusiness = businesses.find(b => b.id === activeBusinessId) || businesses[0];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col border-r border-slate-800">
        <div className="p-4 flex items-center gap-2 border-b border-slate-800">
          <Activity className="text-primary-500" />
          <span className="font-bold text-lg">Agent Flux</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            {navItems.map((item, i) => {
              if (item.isHeader) {
                return <li key={i} className="pt-4 pb-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{item.name}</li>;
              }
              const Icon = item.icon;
              return (
                <li key={i}>
                  <Link to={item.path || '#'} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">
                    {Icon && <Icon size={18} />}
                    <span>{item.name}</span>
                    {(item as any).comingSoon && <span className="ml-auto text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded">Soon</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="p-4 border-t border-slate-800">
          <button onClick={handleLogout} className="flex items-center gap-3 text-sm text-slate-400 hover:text-white transition-colors w-full px-3 py-2">
            <LogOut size={18} /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative">
        <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-4 relative">
            <h1 className="text-lg font-medium text-slate-900 whitespace-nowrap truncate max-w-[200px] md:max-w-md">Good morning, {user.name}</h1>
            
            {/* Business Switcher */}
            <div className="relative">
              <button 
                onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
                className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-md text-sm border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors"
              >
                <Building2 size={14} className="text-primary-600" />
                <span className="font-bold text-slate-800">{currentBusiness.name}</span>
                <ChevronDown size={16} className={`text-slate-500 transition-transform ${isSwitcherOpen ? 'rotate-180' : ''}`} />
              </button>

              {isSwitcherOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden py-2 animate-in fade-in slide-in-from-top-2 duration-200 z-50">
                  <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Business</div>
                  {businesses.map(b => (
                    <button
                      key={b.id}
                      onClick={() => handleSwitchBusiness(b.id)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between transition-colors"
                    >
                      <span className={`font-medium ${activeBusinessId === b.id ? 'text-primary-600' : 'text-slate-700'}`}>{b.name}</span>
                      {activeBusinessId === b.id && <CheckCircle size={14} className="text-primary-600" />}
                    </button>
                  ))}
                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                      onClick={() => { setIsSwitcherOpen(false); setIsCreateModalOpen(true); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-primary-600 flex items-center gap-2 transition-colors"
                    >
                      <Plus size={16} /> Create Business
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
            <CheckCircle size={16} /> All systems healthy
          </div>
        </header>

        {/* Global Create Business Modal */}
        {isCreateModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-slate-100">
                <h3 className="text-xl font-bold text-slate-900">Create New Business</h3>
                <p className="text-sm text-slate-500 mt-1">Set up a new isolated workspace.</p>
              </div>
              <form onSubmit={handleCreateBusiness} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Business Name</label>
                  <input required type="text" value={newBusinessName} onChange={e => setNewBusinessName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="e.g. Acme Corp" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
                  <input required type="text" value={newBusinessIndustry} onChange={e => setNewBusinessIndustry(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="e.g. E-commerce" />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setIsCreateModalOpen(false)} className="flex-1 px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancel</button>
                  <button type="submit" className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors shadow-sm">Create Business</button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="flex-1 p-8 overflow-y-auto">
          {/* We pass a unique key to Outlet to force full re-mount on business switch */}
          <Outlet key={currentBusiness.id} context={{ business: currentBusiness }} />
        </div>
      </main>
    </div>
  );
}

