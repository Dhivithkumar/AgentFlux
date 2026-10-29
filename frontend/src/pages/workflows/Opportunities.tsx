// @ts-nocheck
import { useState, useEffect } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { Sparkles, TrendingUp, Zap, Clock, MessageSquare, Mail, Search, ArrowRight, Loader2, Target } from 'lucide-react';

export default function Opportunities() {
  const { business } = useOutletContext<{ business: any }>();
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState<any[]>([]);

  useEffect(() => {
    if (business) {
      fetchData();
    }
  }, [business]);

  const fetchData = async () => {
    try {
      const res = await apiCall(`/integrations?businessId=${business.id}`);
      setIntegrations(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;
  }

  // Dynamic recommendations based on connected integrations
  const hasGmail = integrations.some(i => i.provider === 'GMAIL' && i.status === 'CONNECTED');
  const hasSlack = integrations.some(i => i.provider === 'SLACK' && i.status === 'CONNECTED');
  const hasCalendar = integrations.some(i => i.provider === 'GOOGLE_CALENDAR' && i.status === 'CONNECTED');

  const opportunities = [
    {
      id: 1,
      title: 'Automate Customer Support Triage',
      description: 'Use AI to analyze incoming emails, categorize them by intent, and automatically draft replies or route them to the right team member.',
      impact: 'High Impact',
      timeSaved: '15 hrs/week',
      icon: Mail,
      color: 'blue',
      requires: ['GMAIL'],
      isReady: hasGmail
    },
    {
      id: 2,
      title: 'Smart Meeting Follow-ups',
      description: 'After a Google Calendar meeting ends, automatically generate an AI summary from your notes and send it to all attendees via Slack or Email.',
      impact: 'Medium Impact',
      timeSaved: '5 hrs/week',
      icon: Clock,
      color: 'emerald',
      requires: ['GOOGLE_CALENDAR', 'SLACK'],
      isReady: hasCalendar && hasSlack
    },
    {
      id: 3,
      title: 'Lead Qualification Bot',
      description: 'Instantly respond to new leads, score their intent using AI, and alert your sales team in Slack if the lead is high priority.',
      impact: 'High Impact',
      timeSaved: '10 hrs/week',
      icon: Target,
      color: 'rose',
      requires: ['SLACK'],
      isReady: hasSlack
    },
    {
      id: 4,
      title: 'Daily Business Summary',
      description: 'Get a daily AI-generated summary of key metrics, emails, and upcoming meetings delivered to your preferred channel every morning.',
      impact: 'Low Impact',
      timeSaved: '2 hrs/week',
      icon: TrendingUp,
      color: 'amber',
      requires: ['GMAIL', 'GOOGLE_CALENDAR'],
      isReady: hasGmail && hasCalendar
    }
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-indigo-500" />
            Automation Opportunities
          </h1>
          <p className="text-slate-500 mt-2 text-lg max-w-2xl">
            AI-driven recommendations for workflows you should build next, tailored to your connected integrations.
          </p>
        </div>
        <Link to="/dashboard/workflows" className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg font-medium hover:bg-indigo-100 transition-colors">
          Go to Workflow Center
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {opportunities.map((opp) => {
          const Icon = opp.icon;
          const colorClasses = {
            blue: 'bg-blue-50 text-blue-600 border-blue-100',
            emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
            rose: 'bg-rose-50 text-rose-600 border-rose-100',
            amber: 'bg-amber-50 text-amber-600 border-amber-100',
          }[opp.color];

          return (
            <div key={opp.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col group hover:shadow-md transition-all">
              <div className="p-6 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-3 rounded-xl border ${colorClasses}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-bold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">{opp.impact}</span>
                    <span className="text-xs font-semibold text-emerald-600 mt-2 flex items-center gap-1">
                      <Zap size={12} /> Saves {opp.timeSaved}
                    </span>
                  </div>
                </div>
                
                <h3 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors">{opp.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed mb-6">{opp.description}</p>
                
                <div className="flex flex-wrap gap-2 mb-2">
                  {opp.requires.map(req => (
                     <span key={req} className="text-[10px] font-bold px-2 py-1 bg-slate-100 border border-slate-200 text-slate-500 rounded uppercase tracking-wider flex items-center gap-1">
                       {req}
                     </span>
                  ))}
                </div>
              </div>
              
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
                {opp.isReady ? (
                  <Link to="/dashboard/workflows" className="w-full flex items-center justify-center gap-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 px-4 rounded-xl transition-colors">
                    Build This Workflow <ArrowRight className="w-4 h-4" />
                  </Link>
                ) : (
                  <div className="w-full flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-500">Missing required integrations</span>
                    <Link to="/dashboard/integrations" className="text-sm font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors">
                      Connect Now
                    </Link>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
