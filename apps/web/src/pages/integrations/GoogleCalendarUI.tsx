import { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { 
  Calendar as CalendarIcon, 
  Loader2, 
  Plus, 
  Clock, 
  FileText, 
  CheckCircle2, 
  Sparkles, 
  Video, 
  Users, 
  Bot, 
  Zap,
  ExternalLink
} from 'lucide-react';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';

export function GoogleCalendarUI() {
  const { business } = useOutletContext<{ business: any }>();
  const [calendars, setCalendars] = useState<any[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('primary');
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'AGENT_FLUX' | 'GENERAL' | 'HOLIDAYS'>('ALL');

  // New Event State
  const [isCreating, setIsCreating] = useState(false);
  const [newEvent, setNewEvent] = useState({
    summary: '',
    date: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '10:00',
    colorId: '2' // Default Sage Green for Agent Flux UI
  });

  useEffect(() => {
    if (business) {
      fetchCalendars();
    }
  }, [business]);

  useEffect(() => {
    if (business && selectedCalendarId) {
      fetchEvents();
    }
  }, [business, selectedCalendarId]);

  const fetchCalendars = async () => {
    try {
      const res = await apiCall(`/integrations/google-calendar/calendars?businessId=${business.id}`);
      setCalendars(res.data);
      if (res.data.length > 0 && !selectedCalendarId) {
        setSelectedCalendarId(res.data.find((c: any) => c.primary)?.id || res.data[0].id);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to connect to Google Calendar');
    } finally {
      setLoading(false);
    }
  };

  const fetchEvents = async () => {
    setLoadingEvents(true);
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      const endOfMonth = new Date();
      endOfMonth.setMonth(endOfMonth.getMonth() + 2); // Fetch 2 months ahead
      
      const res = await apiCall(`/integrations/google-calendar/events?businessId=${business.id}&calendarId=${encodeURIComponent(selectedCalendarId)}&timeMin=${startOfMonth.toISOString()}&timeMax=${endOfMonth.toISOString()}`);
      setEvents(res.data || []);
    } catch (e: any) {
      console.error('Failed to fetch events:', e);
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEvent.summary.trim()) return;

    setIsCreating(true);
    try {
      const startDateTime = new Date(`${newEvent.date}T${newEvent.startTime}:00`).toISOString();
      const endDateTime = new Date(`${newEvent.date}T${newEvent.endTime}:00`).toISOString();

      await apiCall('/integrations/google-calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          businessId: business.id,
          calendarId: selectedCalendarId,
          summary: newEvent.summary,
          colorId: newEvent.colorId,
          start: { dateTime: startDateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          end: { dateTime: endDateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        })
      });
      setNewEvent({ ...newEvent, summary: '' });
      fetchEvents(); // Refresh right side list
    } catch (err) {
      console.error(err);
      alert('Failed to create event');
    } finally {
      setIsCreating(false);
    }
  };

  const isAgentFluxEvent = (evt: any): boolean => {
    const title = (evt.summary || '').toLowerCase();
    const desc = (evt.description || '').toLowerCase();
    return (
      title.includes('agent flux') ||
      title.includes('aasha furniture') ||
      desc.includes('agent flux') ||
      desc.includes('scheduled automatically') ||
      evt.colorId === '2' || // Sage Green
      evt.colorId === '3'    // Grape Purple
    );
  };

  const categorizedEvents = useMemo(() => {
    const agentFluxEvents: any[] = [];
    const holidays: any[] = [];
    const generalEvents: any[] = [];

    events.forEach(evt => {
      const title = (evt.summary || '').toLowerCase();
      if (isAgentFluxEvent(evt)) {
        agentFluxEvents.push(evt);
      } else if (title.includes('holiday') || title.includes('vacation')) {
        holidays.push(evt);
      } else {
        generalEvents.push(evt);
      }
    });

    return { agentFluxEvents, holidays, generalEvents };
  }, [events]);

  if (loading) {
    return <div className="p-12 flex justify-center h-full items-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  if (error) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex items-center justify-center h-full">
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-8 text-center shadow-sm w-full max-w-md">
          <CalendarIcon className="w-12 h-12 text-rose-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-rose-900 mb-2">Calendar Integration Required</h2>
          <p className="text-rose-600 mb-6 text-sm">{error}</p>
          <a href="/dashboard/integrations" className="bg-rose-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-rose-700 transition-colors inline-block text-sm">
            Connect Google Calendar
          </a>
        </div>
      </div>
    );
  }

  const formatEventTime = (evt: any) => {
    if (evt.start?.date) return 'All Day';
    if (!evt.start?.dateTime) return '';
    return format(parseISO(evt.start.dateTime), 'h:mm a');
  };

  const EventCard = ({ evt }: { evt: any }) => {
    const isAgent = isAgentFluxEvent(evt);
    const title = (evt.summary || '').toLowerCase();
    const isHoliday = title.includes('holiday') || title.includes('vacation');

    // Distinct Visual Styling: Agent Flux Automated Schedule
    if (isAgent) {
      return (
        <div className="bg-gradient-to-br from-indigo-50/95 via-purple-50/50 to-white p-4 rounded-xl border border-indigo-200/90 border-l-4 border-l-indigo-600 shadow-sm hover:shadow-md hover:border-indigo-400 ring-1 ring-indigo-500/10 transition-all flex flex-col gap-2.5">
          <div className="flex justify-between items-start gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Bot size={15} className="text-indigo-600 shrink-0" />
              <h4 className="font-bold text-indigo-950 text-sm truncate">{evt.summary || 'Agent Flux Consultation'}</h4>
            </div>
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-xs flex items-center gap-1 shrink-0">
              <Sparkles size={11} className="text-amber-300" />
              Agent Flux
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-indigo-900/80 font-medium">
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-indigo-500" />
              {evt.start?.dateTime ? (
                isToday(parseISO(evt.start.dateTime)) ? 'Today' : 
                isTomorrow(parseISO(evt.start.dateTime)) ? 'Tomorrow' : 
                format(parseISO(evt.start.dateTime), 'MMM d, yyyy')
              ) : 'All Day'}
              {evt.start?.dateTime && ` at ${formatEventTime(evt)}`}
            </div>

            {evt.attendees && evt.attendees.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <Users size={12} className="text-indigo-500" />
                <span className="truncate max-w-[200px]">{evt.attendees.map((a: any) => a.displayName || a.email).join(', ')}</span>
              </div>
            )}
          </div>

          {evt.hangoutLink && (
            <div className="pt-1 flex items-center justify-between border-t border-indigo-100/70 mt-0.5">
              <a 
                href={evt.hangoutLink} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
              >
                <Video size={13} />
                Join Google Meet
              </a>
              {evt.htmlLink && (
                <a 
                  href={evt.htmlLink} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                >
                  View on Google <ExternalLink size={11} />
                </a>
              )}
            </div>
          )}
        </div>
      );
    }

    // Holiday styling
    if (isHoliday) {
      return (
        <div className="bg-rose-50/70 p-4 rounded-xl border border-rose-200/90 border-l-4 border-l-rose-500 shadow-sm hover:shadow-md transition-all flex flex-col gap-2">
          <div className="flex justify-between items-start gap-2">
            <h4 className="font-bold text-rose-950 text-sm truncate">{evt.summary || 'Holiday'}</h4>
            <span className="bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
              Holiday
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-rose-800/80 font-medium">
            <Clock size={12} className="text-rose-400" />
            {evt.start?.dateTime ? format(parseISO(evt.start.dateTime), 'MMM d, yyyy') : 'All Day'}
          </div>
        </div>
      );
    }

    // Standard styling
    return (
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 border-l-4 border-l-slate-400 shadow-sm hover:shadow-md transition-all flex flex-col gap-2">
        <div className="flex justify-between items-start gap-2">
          <h4 className="font-bold text-slate-800 text-sm truncate">{evt.summary || 'Untitled Event'}</h4>
          <span className="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
            Standard
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <Clock size={12} className="text-slate-400" />
          {evt.start?.dateTime ? (
            isToday(parseISO(evt.start.dateTime)) ? 'Today' : 
            isTomorrow(parseISO(evt.start.dateTime)) ? 'Tomorrow' : 
            format(parseISO(evt.start.dateTime), 'MMM d, yyyy')
          ) : 'All Day'}
          {evt.start?.dateTime && ` at ${formatEventTime(evt)}`}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 h-[calc(100vh-64px)] flex flex-col animate-in fade-in duration-500 bg-slate-50/50">
      <div className="w-full flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <CalendarIcon className="w-7 h-7 text-blue-600" />
            Command Center Calendar
          </h1>
          <p className="text-slate-500 text-sm mt-1">Split view: Full Calendar & Smart Categorized Events.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <select 
            value={selectedCalendarId}
            onChange={(e) => setSelectedCalendarId(e.target.value)}
            className="border-slate-200 rounded-lg text-sm bg-white shadow-sm font-medium text-slate-700 w-56 focus:ring-blue-500 focus:border-blue-500 py-2"
          >
            {calendars.map(c => (
              <option key={c.id} value={c.id}>{c.summary || c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 h-full overflow-hidden pb-4">
        
        {/* Left Side: Embedded Google Calendar (50%) */}
        <div className="w-full lg:w-1/2 h-full bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden relative group shrink-0">
           {selectedCalendarId && (
              <iframe 
                src={`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(selectedCalendarId)}&wkst=1&bgcolor=%23ffffff&ctz=${Intl.DateTimeFormat().resolvedOptions().timeZone}&mode=WEEK`}
                style={{ border: 0 }} 
                width="100%" 
                height="100%" 
                frameBorder="0" 
                scrolling="no"
                className="absolute inset-0 z-10"
                title="Google Calendar Embedded"
              ></iframe>
           )}
           <div className="absolute inset-0 flex items-center justify-center z-0 bg-slate-50">
              <Loader2 className="w-8 h-8 text-slate-300 animate-spin" />
           </div>
        </div>

        {/* Right Side: Event List & Quick Create (50%) */}
        <div className="w-full lg:w-1/2 h-full flex flex-col gap-6 overflow-hidden">
          
          {/* Quick Create with Colors */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 shrink-0">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4 text-sm">
              <Plus size={16} className="text-blue-500" /> Add Color-Coded Event
            </h3>
            <form onSubmit={handleCreateEvent} className="space-y-3">
              <div className="flex gap-3">
                <input 
                  type="text" 
                  placeholder="Event Title (e.g. Meeting with Agent Flux)" 
                  value={newEvent.summary}
                  onChange={e => setNewEvent({...newEvent, summary: e.target.value})}
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500"
                  required
                />
                <input 
                  type="date" 
                  value={newEvent.date}
                  onChange={e => setNewEvent({...newEvent, date: e.target.value})}
                  className="w-36 px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 text-slate-600"
                  required
                />
              </div>
              <div className="flex gap-3 items-center">
                <input 
                  type="time" 
                  value={newEvent.startTime}
                  onChange={e => setNewEvent({...newEvent, startTime: e.target.value})}
                  className="w-28 px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 text-slate-600"
                  required
                />
                <span className="text-slate-400 text-sm">to</span>
                <input 
                  type="time" 
                  value={newEvent.endTime}
                  onChange={e => setNewEvent({...newEvent, endTime: e.target.value})}
                  className="w-28 px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 text-slate-600"
                  required
                />
                <div className="flex-1"></div>
                
                {/* Color Selector */}
                <select 
                  value={newEvent.colorId}
                  onChange={e => setNewEvent({...newEvent, colorId: e.target.value})}
                  className="border border-slate-200 rounded-xl text-xs py-2 px-3 font-medium text-slate-600 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="2">Sage Green (Agent Flux)</option>
                  <option value="11">Tomato Red (Urgent)</option>
                  <option value="9">Blueberry (Default)</option>
                  <option value="3">Grape Purple (Personal)</option>
                  <option value="6">Tangerine (Meeting)</option>
                </select>

                <button 
                  type="submit" 
                  disabled={isCreating}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-70"
                >
                  {isCreating ? 'Adding...' : 'Add Event'}
                </button>
              </div>
            </form>
          </div>

          {/* Categorized Lists */}
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                  <FileText size={16} className="text-slate-500" /> Upcoming & Categorized Events
                </h3>

                {/* Legend indicator */}
                <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                    Agent Flux
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                    Standard
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                    Holidays
                  </span>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveFilter('ALL')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    activeFilter === 'ALL' 
                      ? 'bg-slate-900 text-white shadow-xs' 
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({events.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('AGENT_FLUX')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
                    activeFilter === 'AGENT_FLUX' 
                      ? 'bg-indigo-600 text-white shadow-xs' 
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  }`}
                >
                  <Sparkles size={11} />
                  Agent Flux ({categorizedEvents.agentFluxEvents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('GENERAL')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    activeFilter === 'GENERAL' 
                      ? 'bg-slate-900 text-white shadow-xs' 
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Standard ({categorizedEvents.generalEvents.length})
                </button>
                {categorizedEvents.holidays.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveFilter('HOLIDAYS')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      activeFilter === 'HOLIDAYS' 
                        ? 'bg-rose-600 text-white shadow-xs' 
                        : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                    }`}
                  >
                    Holidays ({categorizedEvents.holidays.length})
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
              {loadingEvents ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
              ) : (
                <>
                  {/* Agent Flux Events Section */}
                  {(activeFilter === 'ALL' || activeFilter === 'AGENT_FLUX') && categorizedEvents.agentFluxEvents.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-1.5">
                          <Zap size={13} className="text-indigo-600" />
                          ⚡ Automated by Agent Flux
                        </h4>
                        <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200/50">
                          {categorizedEvents.agentFluxEvents.length} scheduled
                        </span>
                      </div>
                      <div className="grid gap-3">
                        {categorizedEvents.agentFluxEvents.map(evt => (
                          <EventCard key={evt.id} evt={evt} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Holidays Section */}
                  {(activeFilter === 'ALL' || activeFilter === 'HOLIDAYS') && categorizedEvents.holidays.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-rose-700 uppercase tracking-wider">Holidays & Time Off</h4>
                      <div className="grid gap-3">
                        {categorizedEvents.holidays.map(evt => (
                          <EventCard key={evt.id} evt={evt} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Standard Appointments Section */}
                  {(activeFilter === 'ALL' || activeFilter === 'GENERAL') && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Other Appointments</h4>
                      {categorizedEvents.generalEvents.length === 0 ? (
                        <p className="text-xs text-slate-500 italic">No other appointments found.</p>
                      ) : (
                        <div className="grid gap-3">
                          {categorizedEvents.generalEvents.slice(0, 10).map(evt => (
                            <EventCard key={evt.id} evt={evt} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

