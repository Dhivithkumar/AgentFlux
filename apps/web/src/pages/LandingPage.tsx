import { Link } from 'react-router-dom';
import { ArrowRight, Activity } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="container mx-auto px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Activity className="text-primary-500" />
          <span className="text-xl font-bold tracking-tight">Agent Flux</span>
        </div>
        <nav className="flex gap-4">
          <Link to="/login" className="text-slate-300 hover:text-white px-4 py-2">Sign In</Link>
          <Link to="/register" className="bg-primary-600 hover:bg-primary-500 px-4 py-2 rounded-md font-medium transition-colors">Get Started</Link>
        </nav>
      </header>
      
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 max-w-4xl mx-auto">
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6">
          Connect your business. <br/>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-purple-400">Automate repetitive work.</span>
        </h1>
        <p className="text-xl text-slate-400 mb-10 max-w-2xl">
          Connect your business tools. Agent Flux understands your processes. Review automation opportunities. Approve automations. Agent Flux executes and monitors them.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Link to="/register" className="bg-primary-600 hover:bg-primary-500 text-white px-8 py-4 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-all hover:scale-105">
            Get Started <ArrowRight size={20} />
          </Link>
          <Link to="/login" className="bg-slate-800 hover:bg-slate-700 text-white px-8 py-4 rounded-lg font-bold text-lg transition-all">
            Sign In
          </Link>
        </div>
      </main>
    </div>
  );
}
