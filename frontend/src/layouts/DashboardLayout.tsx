import React, { useEffect, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { apiCall } from '../lib/api';
import {
  Activity,
  LayoutDashboard,
  Settings,
  ChevronDown,
  CheckCircle,
  LogOut,
  Plus,
  Building2,
  Calendar,
  Landmark,
  ShieldCheck,
  Menu,
  X,
  Inbox,
  ShoppingBag,
  Database,
  Sparkles,
  CheckSquare,
  GitBranch,
  TrendingUp,
  Plug,
  BookOpen,
  User,
  Workflow,
  ChevronRight,
  Shield,
  Layers
} from 'lucide-react';
import { ToastProvider } from '../components/ui/Toast';

export default function DashboardLayout() {
  const [user, setUser] = useState<any>(null);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newBusinessName, setNewBusinessName] = useState('');
  const [newBusinessIndustry, setNewBusinessIndustry] = useState('');
  
  const navigate = useNavigate();
  const location = useLocation();
  const mainContentRef = React.useRef<HTMLElement>(null);

  const fetchBusinesses = async () => {
    try {
      const busRes = await apiCall('/businesses');
      setBusinesses(busRes.data || []);
      return busRes.data || [];
    } catch (e) {
      console.error('Failed to fetch businesses:', e);
      return [];
    }
  };

  useEffect(() => {
    Promise.all([
      apiCall('/auth/me').catch(() => null),
      fetchBusinesses()
    ]).then(([userRes, busList]) => {
      if (userRes?.data?.user) {
        setUser(userRes.data.user);
      }
      if (!busList || busList.length === 0) {
        navigate('/onboarding');
      } else {
        const stored = localStorage.getItem('activeBusinessId');
        if (stored && busList.find((b: any) => b.id === stored)) {
          setActiveBusinessId(stored);
        } else {
          const preferred =
            busList.find((b: any) => b.integrations && b.integrations.some((i: any) => i.status === 'CONNECTED')) ||
            busList[0];
          setActiveBusinessId(preferred.id);
          localStorage.setItem('activeBusinessId', preferred.id);
        }
      }
    });
  }, [navigate]);

  // Close mobile drawer and dropdowns on route changes, and reset main content scroll
  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsSwitcherOpen(false);
    setIsUserMenuOpen(false);
    if (mainContentRef.current) {
      mainContentRef.current.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [location.pathname]);

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

  const navSections = [
    {
      title: 'COMMAND',
      items: [
        { name: 'Dashboard Overview', path: '/dashboard', icon: LayoutDashboard },
        { name: 'Calendar & Meet', path: '/dashboard/calendar', icon: Calendar }
      ]
    },
    {
      title: 'OPERATIONS & REVENUE',
      items: [
        { name: 'Enquiry Inbox', path: '/dashboard/enquiries', icon: Inbox },
        { name: 'Orders & Fulfillment', path: '/dashboard/orders', icon: ShoppingBag },
        { name: 'Finance & Ledger', path: '/dashboard/finance', icon: Landmark },
        { name: 'Vendor Centre', path: '/dashboard/vendors', icon: ShieldCheck },
        { name: 'Business Data Sync', path: '/dashboard/business-data', icon: Database }
      ]
    },
    {
      title: 'AUTONOMOUS WORKFLOWS',
      items: [
        { name: 'Workflow Studio', path: '/dashboard/workflows', icon: Workflow },
        { name: 'Ready Packs', path: '/dashboard/workflow-packs', icon: Sparkles },
        { name: 'Human Approvals', path: '/dashboard/workflows/approvals', icon: CheckSquare },
        { name: 'Execution History', path: '/dashboard/workflows/executions', icon: Activity },
        { name: 'Draft Workflows', path: '/dashboard/workflows/drafts', icon: GitBranch },
        { name: 'AI Opportunities', path: '/dashboard/workflows/opportunities', icon: TrendingUp }
      ]
    },
    {
      title: 'ECOSYSTEM & CONFIG',
      items: [
        { name: 'Manage Integrations', path: '/dashboard/integrations', icon: Plug },
        { name: 'Connector Health', path: '/dashboard/integrations/analytics', icon: Layers },
        { name: 'Knowledge Center', path: '/dashboard/knowledge', icon: BookOpen },
        { name: 'Settings & Profile', path: '/dashboard/settings', icon: Settings }
      ]
    }
  ];

  if (!user || businesses.length === 0 || !activeBusinessId) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center animate-pulse">
            <Activity className="text-indigo-400 w-6 h-6 animate-spin" />
          </div>
        </div>
        <p className="text-sm font-medium tracking-wide">Initializing workspace...</p>
      </div>
    );
  }

  const currentBusiness = businesses.find((b) => b.id === activeBusinessId) || businesses[0];
  const connectedAppsCount = currentBusiness.integrations?.filter((i: any) => i.status === 'CONNECTED').length || 0;

  const userInitials = user.name
    ? user.name
        .split(' ')
        .map((p: string) => p[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'AF';

  const isRouteActive = (itemPath: string) => {
    if (itemPath === '/dashboard') {
      return location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(itemPath);
  };

  // Find active breadcrumb title
  let currentTitle = 'Dashboard';
  for (const sec of navSections) {
    for (const it of sec.items) {
      if (isRouteActive(it.path)) {
        currentTitle = it.name;
      }
    }
  }

  // Check if current page is full-bleed studio canvas (e.g. Workflow Builder or Calendar Split-View)
  const isStudioPage =
    location.pathname.startsWith('/dashboard/calendar') ||
    (location.pathname.startsWith('/dashboard/workflows/') &&
      !['/dashboard/workflows', '/dashboard/workflows/drafts', '/dashboard/workflows/opportunities', '/dashboard/workflows/approvals', '/dashboard/workflows/executions'].includes(location.pathname));

  return (
    <div className="h-screen max-h-screen h-[100dvh] max-h-[100dvh] w-full bg-slate-50 flex overflow-hidden antialiased font-sans">
      {/* MOBILE BACKDROP */}
      {isMobileMenuOpen && (
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-40 md:hidden transition-opacity"
        />
      )}

      {/* SIDEBAR NAVIGATION - FIXED WITH INDEPENDENT SCROLL */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 h-full max-h-screen max-h-[100dvh] bg-slate-900 border-r border-slate-800/80 text-slate-300 flex flex-col shrink-0 transform transition-transform duration-300 ease-in-out md:static md:translate-x-0 select-none ${
          isMobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 shrink-0 px-6 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/40">
          <Link to="/dashboard" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 p-0.5 shadow-lg shadow-indigo-600/30 flex items-center justify-center transition-transform group-hover:scale-105">
              <Activity className="text-white w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-white text-base tracking-tight">Agent Flux</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30">
                  v2.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Autonomous Operations</p>
            </div>
          </Link>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Sections - Independently Scrollable */}
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 focus:outline-none">
          {navSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {section.title}
              </div>
              {section.items.map((item, iIdx) => {
                const active = isRouteActive(item.path);
                const Icon = item.icon;
                return (
                  <Link
                    key={iIdx}
                    to={item.path}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group relative ${
                      active
                        ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-semibold shadow-md shadow-indigo-900/30 ring-1 ring-white/10'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/70 hover:translate-x-0.5'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-white rounded-r-full shadow-sm" />
                    )}
                    <Icon
                      size={18}
                      className={`shrink-0 transition-colors ${
                        active ? 'text-white' : 'text-slate-400 group-hover:text-indigo-400'
                      }`}
                    />
                    <span className="truncate">{item.name}</span>
                    {active && <ChevronRight size={14} className="ml-auto text-indigo-200 shrink-0" />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer User Profile Card - Pinned at bottom of sidebar */}
        <div className="shrink-0 p-4 border-t border-slate-800/80 bg-slate-950/60">
          <div className="flex items-center gap-3 p-2 rounded-xl bg-slate-800/50 border border-slate-700/50">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white truncate">{user.name || 'Account'}</p>
              <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA - INDEPENDENT SCROLL */}
      <div className="flex-1 flex flex-col min-w-0 h-full max-h-screen max-h-[100dvh] overflow-hidden">
        {/* Top Header Navbar - Pinned at top of main area */}
        <header className="h-16 shrink-0 bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between px-4 sm:px-8 z-30 shadow-xs select-none">
          {/* Left: Mobile Toggle & Business Switcher */}
          <div className="flex items-center gap-3 sm:gap-5 min-w-0">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
            >
              <Menu size={20} />
            </button>

            {/* Business Switcher Pill */}
            <div className="relative">
              <button
                onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
                className="flex items-center gap-2.5 bg-slate-50 hover:bg-slate-100/90 text-slate-800 px-3.5 py-1.5 rounded-xl border border-slate-200/90 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <div className="w-5 h-5 rounded-md bg-indigo-600/10 text-indigo-600 flex items-center justify-center shrink-0">
                  <Building2 size={13} />
                </div>
                <div className="flex flex-col text-left">
                  <span className="font-bold text-xs text-slate-900 truncate max-w-[120px] sm:max-w-[180px]">
                    {currentBusiness.name}
                  </span>
                </div>
                <span className="hidden sm:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {connectedAppsCount} App{connectedAppsCount === 1 ? '' : 's'}
                </span>
                <ChevronDown
                  size={14}
                  className={`text-slate-400 transition-transform ${isSwitcherOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isSwitcherOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsSwitcherOpen(false)} />
                  <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden py-2 animate-in fade-in slide-in-from-top-2 duration-200 z-50">
                    <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Workspaces ({businesses.length})
                      </span>
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                      {businesses.map((b) => {
                        const isCurrent = activeBusinessId === b.id;
                        const bApps = b.integrations?.filter((i: any) => i.status === 'CONNECTED').length || 0;
                        return (
                          <button
                            key={b.id}
                            onClick={() => handleSwitchBusiness(b.id)}
                            className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between transition-colors ${
                              isCurrent ? 'bg-indigo-50/70 text-indigo-900 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <div
                                className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                                  isCurrent ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {b.name ? b.name[0].toUpperCase() : 'B'}
                              </div>
                              <div className="truncate">
                                <p className="truncate">{b.name}</p>
                                <p className="text-[10px] text-slate-400 font-normal">
                                  {b.industry || 'Business'} • {bApps} connected
                                </p>
                              </div>
                            </div>
                            {isCurrent && <CheckCircle size={15} className="text-indigo-600 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="border-t border-slate-100 pt-1 mt-1 px-2">
                      <button
                        onClick={() => {
                          setIsSwitcherOpen(false);
                          setIsCreateModalOpen(true);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center gap-2 transition-colors"
                      >
                        <Plus size={15} /> Add New Business
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Breadcrumb Title */}
            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400 border-l border-slate-200 pl-4">
              <span>Agent Flux</span>
              <ChevronRight size={12} />
              <span className="font-semibold text-slate-700">{currentTitle}</span>
            </div>
          </div>

          {/* Right: Status Pill & User Quick Menu */}
          <div className="flex items-center gap-3">
            {/* Live Operational Health Badge */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/80 text-emerald-700 text-xs font-semibold shadow-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>Autonomous Systems Active</span>
            </div>

            {/* User Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-100 transition-colors focus:outline-none"
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white text-xs font-bold shadow-xs">
                  {userInitials}
                </div>
                <ChevronDown size={14} className="text-slate-400" />
              </button>

              {isUserMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-2xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <p className="text-xs font-bold text-slate-900">{user.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                    </div>
                    <div className="py-1">
                      <Link
                        to="/dashboard/settings"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
                      >
                        <Settings size={15} /> Workspace Settings
                      </Link>
                      <Link
                        to="/dashboard/integrations"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
                      >
                        <Plug size={15} /> Connected Integrations
                      </Link>
                      <Link
                        to="/dashboard/business-data"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
                      >
                        <Database size={15} /> Business Data & Sync
                      </Link>
                    </div>
                    <div className="border-t border-slate-100 pt-1">
                      <button
                        onClick={handleLogout}
                        className="w-full text-left flex items-center gap-2.5 px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <LogOut size={15} /> Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Global Create Business Modal */}
        {isCreateModalOpen && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Create New Business</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Initialize an isolated workspace profile.</p>
                </div>
                <button
                  onClick={() => setIsCreateModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleCreateBusiness} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Business Name
                  </label>
                  <input
                    required
                    type="text"
                    value={newBusinessName}
                    onChange={(e) => setNewBusinessName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                    placeholder="e.g. Aasha Furniture"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Industry
                  </label>
                  <input
                    required
                    type="text"
                    value={newBusinessIndustry}
                    onChange={(e) => setNewBusinessIndustry(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                    placeholder="e.g. Furniture Manufacturing"
                  />
                </div>
                <div className="flex gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all"
                  >
                    Create Workspace
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Dynamic Page Outlet with Independent Scroll */}
        <main
          ref={mainContentRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain focus:outline-none custom-main-scroll"
        >
          <div className={`w-full ${isStudioPage ? 'h-full min-h-full p-2 sm:p-4' : 'max-w-7xl mx-auto p-4 sm:p-6 lg:p-8'}`}>
            <ToastProvider>
              <Outlet key={currentBusiness.id} context={{ business: currentBusiness, user }} />
            </ToastProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
