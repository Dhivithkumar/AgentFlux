import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Activity,
  Zap,
  Shield,
  Bot,
  Database,
  Calendar,
  Layers,
  Sparkles,
  CheckCircle2,
  Lock
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-indigo-500 selection:text-white">
      {/* Ambient background lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-b from-indigo-600/25 via-purple-600/10 to-transparent blur-3xl opacity-80" />
        <div className="absolute top-1/3 -left-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 -right-40 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      {/* Top Navbar */}
      <header className="relative z-20 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex justify-between items-center">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 p-0.5 shadow-lg shadow-indigo-600/30 flex items-center justify-center transition-transform group-hover:scale-105">
              <Activity className="text-white w-5 h-5" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-extrabold tracking-tight text-white">Agent Flux</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                v2.0
              </span>
            </div>
          </Link>
          <nav className="flex items-center gap-3 sm:gap-4">
            <Link
              to="/login"
              className="text-xs sm:text-sm font-semibold text-slate-300 hover:text-white px-3 py-2 transition-colors"
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-md shadow-indigo-600/20 hover:shadow-indigo-600/40"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 relative z-10 flex flex-col items-center justify-center text-center px-4 sm:px-6 max-w-5xl mx-auto pt-16 pb-20">
        {/* Release Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-semibold mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <Sparkles size={13} className="text-indigo-400" />
          <span>Enterprise Autonomous AI Orchestration</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>

        {/* Main Headline */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 max-w-4xl text-balance">
          Connect your business.{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-300 to-indigo-200">
            Automate every operation.
          </span>
        </h1>

        {/* Subhead */}
        <p className="text-base sm:text-xl text-slate-400 mb-10 max-w-2xl text-balance leading-relaxed">
          Agent Flux unifies your business communication, knowledge retrieval, CRM, order fulfillment, and finance ledgers into intelligent, self-driving workflows.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto justify-center mb-16">
          <Link
            to="/register"
            className="bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white px-8 py-3.5 rounded-xl font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:scale-[1.02] cursor-pointer"
          >
            Launch Command Center <ArrowRight size={18} />
          </Link>
          <Link
            to="/login"
            className="bg-slate-900/90 hover:bg-slate-800/90 text-slate-200 border border-slate-800 px-8 py-3.5 rounded-xl font-bold text-sm sm:text-base transition-all hover:text-white"
          >
            Sign In to Workspace
          </Link>
        </div>

        {/* Live Architecture Flow Preview Card */}
        <div className="w-full max-w-4xl bg-slate-900/80 backdrop-blur-xl border border-slate-800/90 rounded-2xl shadow-2xl p-6 sm:p-8 text-left relative overflow-hidden">
          <div className="flex items-center justify-between pb-6 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500/80" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
              <span className="text-xs font-mono text-slate-400 ml-2">agentflux-dag-engine.live</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Real-time Pipeline
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-6">
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold mb-2">
                <Zap size={14} /> 1. TRIGGER
              </div>
              <p className="text-xs text-white font-medium">Inbound Gmail / WhatsApp</p>
              <p className="text-[11px] text-slate-400 mt-1">Classifies intent & extracts requirements</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-purple-400 text-xs font-bold mb-2">
                <Database size={14} /> 2. RAG RETRIEVAL
              </div>
              <p className="text-xs text-white font-medium">Knowledge & Catalog</p>
              <p className="text-[11px] text-slate-400 mt-1">Vector search across pricing & inventory</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold mb-2">
                <Bot size={14} /> 3. AGENT ACTION
              </div>
              <p className="text-xs text-white font-medium">Quotation & Booking</p>
              <p className="text-[11px] text-slate-400 mt-1">Generates quote + Google Calendar slot</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-bold mb-2">
                <CheckCircle2 size={14} /> 4. SETTLEMENT
              </div>
              <p className="text-xs text-white font-medium">Finance & Sync</p>
              <p className="text-[11px] text-slate-400 mt-1">Dispatches WhatsApp bill & syncs ledger</p>
            </div>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-16 text-left w-full">
          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-4">
              <Layers size={20} />
            </div>
            <h3 className="font-bold text-base text-white mb-1.5">Universal Connectors</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Native integrations with Gmail, Google Calendar, Sheets, Drive, WhatsApp, Razorpay, Stripe, Notion, and Trello.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4">
              <Bot size={20} />
            </div>
            <h3 className="font-bold text-base text-white mb-1.5">AI Workflow Architect</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Describe your desired automation in natural language. Agent Flux compiles it into a connected DAG with human approval checkpoints.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4">
              <Shield size={20} />
            </div>
            <h3 className="font-bold text-base text-white mb-1.5">Autonomous Resilience</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Self-healing token refresh, encrypted credential vault, immutable version snapshots, and zero-downtime execution logs.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-800/80 py-8 px-4 text-center text-xs text-slate-500">
        <p>© 2026 Agent Flux Inc. Autonomous Enterprise Systems. All rights reserved.</p>
      </footer>
    </div>
  );
}
