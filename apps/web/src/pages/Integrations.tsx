// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { Loader2, Search, CheckCircle2, AlertTriangle, Plug, Plus, Zap, RefreshCw } from 'lucide-react';

const getFavicon = (domain: string) => `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`;

const ALL_CONNECTORS = [
  // Google Workspace
  { id: 'GMAIL', name: 'Gmail', category: 'Google Workspace', description: 'Read, send, and manage emails automatically.', iconUrl: getFavicon('mail.google.com') },
  { id: 'GOOGLE_CALENDAR', name: 'Google Calendar', category: 'Google Workspace', description: 'Manage calendar events and schedules.', iconUrl: getFavicon('calendar.google.com') },
  { id: 'GOOGLE_DRIVE', name: 'Google Drive', category: 'Google Workspace', description: 'Manage and sync files in Google Drive.', iconUrl: getFavicon('drive.google.com') },
  { id: 'GOOGLE_SHEETS', name: 'Google Sheets', category: 'Google Workspace', description: 'Read and write data to spreadsheets.', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/30/Google_Sheets_logo_%282014-2020%29.svg' },
  { id: 'GOOGLE_DOCS', name: 'Google Docs', category: 'Google Workspace', description: 'Create and edit documents automatically.', iconUrl: getFavicon('docs.google.com') },
  { id: 'GOOGLE_FORMS', name: 'Google Forms', category: 'Google Workspace', description: 'Automate form responses and data.', iconUrl: getFavicon('forms.google.com') },
  { id: 'GOOGLE_ANALYTICS', name: 'Google Analytics', category: 'Google Workspace', description: 'Track and analyze website traffic.', iconUrl: getFavicon('analytics.google.com') },
  { id: 'GOOGLE_ADS', name: 'Google Ads', category: 'Google Workspace', description: 'Manage advertising campaigns.', iconUrl: getFavicon('ads.google.com') },

  // Email & Calendar
  { id: 'OUTLOOK', name: 'Outlook', category: 'Email & Calendar', description: 'Microsoft Outlook email integration.', iconUrl: getFavicon('outlook.live.com') },
  { id: 'APPLE_CALENDAR', name: 'Apple Calendar', category: 'Email & Calendar', description: 'Sync with iCloud calendar.', iconUrl: getFavicon('icloud.com') },
  { id: 'CALENDLY', name: 'Calendly', category: 'Email & Calendar', description: 'Automate meeting scheduling.', iconUrl: getFavicon('calendly.com') },
  
  // Productivity & Docs
  { id: 'NOTION', name: 'Notion', category: 'Productivity & Docs', description: 'Automate Notion databases and pages.', iconUrl: getFavicon('notion.so') },
  { id: 'CODA', name: 'Coda', category: 'Productivity & Docs', description: 'Sync data with Coda docs.', iconUrl: getFavicon('coda.io') },
  { id: 'EVERNOTE', name: 'Evernote', category: 'Productivity & Docs', description: 'Create and manage notes.', iconUrl: getFavicon('evernote.com') },
  { id: 'TRELLO', name: 'Trello', category: 'Productivity & Docs', description: 'Manage boards, lists, and cards.', iconUrl: getFavicon('trello.com') },
  { id: 'ASANA', name: 'Asana', category: 'Productivity & Docs', description: 'Manage team projects and tasks.', iconUrl: getFavicon('asana.com') },
  { id: 'CLICKUP', name: 'ClickUp', category: 'Productivity & Docs', description: 'One app to replace them all.', iconUrl: getFavicon('clickup.com') },
  { id: 'DROPBOX', name: 'Dropbox', category: 'Productivity & Docs', description: 'Secure file sharing and storage.', iconUrl: getFavicon('dropbox.com') },
  { id: 'ONEDRIVE', name: 'OneDrive', category: 'Productivity & Docs', description: 'Microsoft cloud storage sync.', iconUrl: getFavicon('onedrive.live.com') },
  { id: 'AIRTABLE', name: 'Airtable', category: 'Productivity & Docs', description: 'Low-code platform for building collaborative apps.', iconUrl: getFavicon('airtable.com') },

  // CRM & Sales
  { id: 'SALESFORCE', name: 'Salesforce', category: 'CRM & Sales', description: 'Manage leads, contacts, and opportunities.', iconUrl: getFavicon('salesforce.com') },
  { id: 'HUBSPOT', name: 'HubSpot', category: 'CRM & Sales', description: 'Inbound marketing and sales automation.', iconUrl: getFavicon('hubspot.com') },
  { id: 'PIPEDRIVE', name: 'Pipedrive', category: 'CRM & Sales', description: 'Sales CRM and pipeline management.', iconUrl: getFavicon('pipedrive.com') },
  { id: 'ZOHO_CRM', name: 'Zoho CRM', category: 'CRM & Sales', description: 'Automate Zoho CRM workflows.', iconUrl: getFavicon('zoho.com') },
  { id: 'CLOSE', name: 'Close', category: 'CRM & Sales', description: 'Inside sales CRM for startups.', iconUrl: getFavicon('close.com') },

  // Ecommerce
  { id: 'SHOPIFY', name: 'Shopify', category: 'Ecommerce', description: 'Automate e-commerce operations.', iconUrl: getFavicon('shopify.com') },
  { id: 'WOOCOMMERCE', name: 'WooCommerce', category: 'Ecommerce', description: 'Open-source e-commerce plugin for WordPress.', iconUrl: getFavicon('woocommerce.com') },

  // Support & Helpdesk
  { id: 'ZENDESK', name: 'Zendesk', category: 'Support & Helpdesk', description: 'Manage customer support tickets.', iconUrl: getFavicon('zendesk.com') },
  { id: 'INTERCOM', name: 'Intercom', category: 'Support & Helpdesk', description: 'Conversational relationship platform.', iconUrl: getFavicon('intercom.com') },
  { id: 'FRESHDESK', name: 'Freshdesk', category: 'Support & Helpdesk', description: 'Cloud-based customer support.', iconUrl: getFavicon('freshdesk.com') },
  { id: 'FRONT', name: 'Front', category: 'Support & Helpdesk', description: 'Customer communication hub.', iconUrl: getFavicon('front.com') },
  { id: 'GORGIAS', name: 'Gorgias', category: 'Support & Helpdesk', description: 'Ecommerce helpdesk automation.', iconUrl: getFavicon('gorgias.com') },

  // Messaging & Chat
  { id: 'SLACK', name: 'Slack', category: 'Messaging & Chat', description: 'Send messages and notifications to channels.', iconUrl: getFavicon('slack.com') },
  { id: 'DISCORD', name: 'Discord', category: 'Messaging & Chat', description: 'Automate Discord server messages.', iconUrl: getFavicon('discord.com') },
  { id: 'MS_TEAMS', name: 'Microsoft Teams', category: 'Messaging & Chat', description: 'Chat and collaboration automation.', iconUrl: getFavicon('teams.microsoft.com') },
  { id: 'WHATSAPP', name: 'WhatsApp Business', category: 'Messaging & Chat', description: 'Send WhatsApp Business messages.', iconUrl: getFavicon('whatsapp.com') },
  { id: 'TELEGRAM', name: 'Telegram', category: 'Messaging & Chat', description: 'Automate Telegram bots and channels.', iconUrl: getFavicon('telegram.org') },

  // Social Media
  { id: 'TWITTER', name: 'X (Twitter)', category: 'Social Media', description: 'Automate tweets and monitoring.', iconUrl: getFavicon('x.com') },
  { id: 'LINKEDIN', name: 'LinkedIn', category: 'Social Media', description: 'Post updates and manage company pages.', iconUrl: getFavicon('linkedin.com') },
  { id: 'FACEBOOK', name: 'Facebook', category: 'Social Media', description: 'Manage Facebook pages and groups.', iconUrl: getFavicon('facebook.com') },
  { id: 'INSTAGRAM', name: 'Instagram', category: 'Social Media', description: 'Automate Instagram posts and stories.', iconUrl: getFavicon('instagram.com') },
  { id: 'TIKTOK', name: 'TikTok', category: 'Social Media', description: 'Manage TikTok publishing and analytics.', iconUrl: getFavicon('tiktok.com') },

  // Marketing & Ads
  { id: 'MAILCHIMP', name: 'Mailchimp', category: 'Marketing & Ads', description: 'Email marketing and automations.', iconUrl: getFavicon('mailchimp.com') },
  { id: 'ACTIVECAMPAIGN', name: 'ActiveCampaign', category: 'Marketing & Ads', description: 'Customer experience automation.', iconUrl: getFavicon('activecampaign.com') },
  { id: 'META_ADS', name: 'Meta Ads', category: 'Marketing & Ads', description: 'Automate Facebook and Instagram ads.', iconUrl: getFavicon('business.facebook.com') },
  { id: 'KLAVIYO', name: 'Klaviyo', category: 'Marketing & Ads', description: 'Marketing automation for ecommerce.', iconUrl: getFavicon('klaviyo.com') },
  { id: 'BREVO', name: 'Brevo', category: 'Marketing & Ads', description: 'Email marketing and CRM tools.', iconUrl: getFavicon('brevo.com') },

  // Finance & Billing
  { id: 'STRIPE', name: 'Stripe', category: 'Finance & Billing', description: 'Payment processing and subscriptions.', iconUrl: getFavicon('stripe.com') },
  { id: 'QUICKBOOKS', name: 'QuickBooks', category: 'Finance & Billing', description: 'Accounting and invoicing automation.', iconUrl: getFavicon('quickbooks.intuit.com') },
  { id: 'XERO', name: 'Xero', category: 'Finance & Billing', description: 'Cloud-based accounting software.', iconUrl: getFavicon('xero.com') },
  { id: 'PAYPAL', name: 'PayPal', category: 'Finance & Billing', description: 'Online payments system.', iconUrl: getFavicon('paypal.com') },
  { id: 'RAZORPAY', name: 'Razorpay', category: 'Finance & Billing', description: 'Payment gateway and financial solutions.', iconUrl: getFavicon('razorpay.com') },

  // Developer Tools
  { id: 'GITHUB', name: 'GitHub', category: 'Developer Tools', description: 'Automate issues, PRs, and repositories.', iconUrl: getFavicon('github.com') },
  { id: 'GITLAB', name: 'GitLab', category: 'Developer Tools', description: 'DevOps and CI/CD automation.', iconUrl: getFavicon('gitlab.com') },
  { id: 'JIRA', name: 'Jira', category: 'Developer Tools', description: 'Issue and project tracking.', iconUrl: getFavicon('atlassian.com') },
  { id: 'BITBUCKET', name: 'Bitbucket', category: 'Developer Tools', description: 'Git code management.', iconUrl: getFavicon('bitbucket.org') },

  // AI & Machine Learning
  { id: 'OPENAI', name: 'OpenAI', category: 'AI & Machine Learning', description: 'Integrate GPT-4 and DALL-E.', iconUrl: getFavicon('openai.com') },
  { id: 'GEMINI', name: 'Gemini', category: 'AI & Machine Learning', description: 'Google DeepMind AI integration.', iconUrl: getFavicon('deepmind.google') },
  { id: 'GROQ', name: 'Groq', category: 'AI & Machine Learning', description: 'Fast AI inference engine.', iconUrl: getFavicon('groq.com') },
  { id: 'HUGGINGFACE', name: 'Hugging Face', category: 'AI & Machine Learning', description: 'Machine learning models and datasets.', iconUrl: getFavicon('huggingface.co') }
];

const ConnectorImage = ({ src, alt }: { src?: string, alt: string }) => {
  const [error, setError] = useState(false);
  
  if (!src || error) {
    return <Plug className="w-6 h-6 text-slate-400" />;
  }
  
  return (
    <img 
      src={src} 
      alt={alt} 
      onError={() => setError(true)}
      className="w-full h-full object-contain mix-blend-multiply" 
    />
  );
};

export function Integrations() {
  const { business } = useOutletContext<{ business: any }>();
  const [activeIntegrations, setActiveIntegrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    if (business) {
      loadData();
    }
  }, [business]);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await apiCall(`/integrations?businessId=${business?.id}`);
      setActiveIntegrations(res.data || []);
    } catch (error) {
      console.error('Failed to load integrations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (integrationId: string) => {
    if (!confirm('Are you sure you want to disconnect this application? Automations using this connection will be affected.')) return;
    try {
      await apiCall(`/integrations/${integrationId}/disconnect`, { method: 'POST' });
      loadData();
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  const handleConnect = async (providerId: string) => {
    setConnecting(providerId);
    try {
      const res = await apiCall(`/integrations/${providerId}/connect?businessId=${business?.id}`);
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        alert('Connector coming soon or OAuth setup required in backend.');
      }
    } catch (error) {
      console.error('Failed to initiate connection:', error);
    } finally {
      setConnecting(null);
    }
  };

  const categories = ['All', ...Array.from(new Set(ALL_CONNECTORS.map(c => c.category)))];

  const filteredConnectors = useMemo(() => {
    return ALL_CONNECTORS.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || c.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Manage Integrations</h1>
          <p className="text-slate-500 mt-2 text-lg">Connect and manage available applications for your business.</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 border-b border-slate-200 justify-between md:items-center pb-4 sticky top-0 bg-[#f8fafc] z-10 pt-4 -mt-4">
        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 custom-scrollbar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all shadow-sm ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white shadow-blue-500/30'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        
        <div className="relative w-full md:w-72 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input 
            type="text"
            placeholder="Search integrations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-medium placeholder-slate-400 transition-all"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-12">
          
          {/* Active Connections Highlight */}
          {activeIntegrations.length > 0 && selectedCategory === 'All' && !searchQuery && (
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50/30 rounded-2xl border border-emerald-100 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-emerald-900 flex items-center gap-2 mb-6">
                <Zap className="w-5 h-5 text-emerald-600" /> Active Connections
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {activeIntegrations.map((active) => {
                  const baseConnector = ALL_CONNECTORS.find(c => c.id === active.provider);
                  return (
                    <div key={active.id} className="bg-white p-5 rounded-xl border border-emerald-200 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow group">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-100 p-2 shrink-0">
                           <ConnectorImage src={baseConnector?.iconUrl} alt={baseConnector?.name || active.provider} />
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 leading-tight">{baseConnector?.name || active.provider}</div>
                          <div className="text-[10px] text-emerald-600 font-bold mt-1.5 flex items-center gap-1 uppercase tracking-wider bg-emerald-50 px-2 py-0.5 rounded-full w-fit border border-emerald-100">
                            <CheckCircle2 size={10} /> CONNECTED
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDisconnect(active.id)}
                        className="text-xs text-slate-400 font-medium hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        Disconnect
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Connectors Grid by Category */}
          {categories.filter(c => c !== 'All' && (selectedCategory === 'All' || selectedCategory === c)).map(category => {
            const categoryConnectors = filteredConnectors.filter(c => c.category === category);
            if (categoryConnectors.length === 0) return null;
            
            return (
              <div key={category} className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-4">
                <h2 className="text-xl font-bold text-slate-900 border-b border-slate-200 pb-3 flex items-center gap-2">
                  {category}
                  <span className="text-xs font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{categoryConnectors.length}</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {categoryConnectors.map((connector) => {
                    const activeInstance = activeIntegrations.find(a => a.provider === connector.id);
                    const isConnected = !!activeInstance && activeInstance.status === 'CONNECTED';
                    const isThisConnecting = connecting === connector.id;
                    
                    return (
                      <div key={connector.id} className={`bg-white rounded-2xl p-6 border flex flex-col h-full hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ${isConnected ? 'border-emerald-300 ring-2 ring-emerald-50 shadow-emerald-100/50' : 'border-slate-200 shadow-sm'}`}>
                        <div className="flex justify-between items-start mb-4">
                          <div className="w-14 h-14 rounded-2xl bg-white shadow-sm flex items-center justify-center border border-slate-100 p-2.5">
                             <ConnectorImage src={connector.iconUrl} alt={connector.name} />
                          </div>
                          {isConnected && (
                             <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-emerald-100 shadow-sm">
                               <CheckCircle2 size={12} /> ACTIVE
                             </span>
                          )}
                        </div>
                        
                        <h3 className="font-bold text-slate-900 text-lg">{connector.name}</h3>
                        <p className="text-sm text-slate-500 mt-2 mb-6 flex-grow leading-relaxed">{connector.description}</p>
                        
                        <div className="mt-auto">
                          {isConnected ? (
                            <button 
                              onClick={() => handleDisconnect(activeInstance.id)}
                              className="w-full py-2.5 text-sm font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded-xl transition-colors shadow-sm"
                            >
                              Manage Connection
                            </button>
                          ) : (
                            <button 
                              disabled={isThisConnecting}
                              onClick={() => handleConnect(connector.id)}
                              className="w-full py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-blue-600 disabled:opacity-70 disabled:cursor-not-allowed rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
                            >
                              {isThisConnecting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                              {isThisConnecting ? 'Connecting...' : 'Connect'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

        </div>
      )}
    </div>
  );
}
