import { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { Calendar as CalendarIcon, Loader2, Plus, Clock, FileText, CheckCircle2 } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';

export function GoogleCalendarUI() {
  const { business } = useOutletContext<{ business: any }>();
  const [calendars, setCalendars] = useState<any[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('primary');
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // Note: iframe doesn't auto-refresh, but that's standard for embedded frames
    } catch (err) {
      console.error(err);
      alert('Failed to create event');
    } finally {
      setIsCreating(false);
    }
  };

  const categorizedEvents = useMemo(() => {
    const agentFluxEvents: any[] = [];
    const holidays: any[] = [];
    const generalEvents: any[] = [];

    events.forEach(evt => {
      const title = (evt.summary || '').toLowerCase();
      if (title.includes('agent flux')) {
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
    if (evt.start?.date) return 'All Day'; // All day event
    if (!evt.start?.dateTime) return '';
    return format(parseISO(evt.start.dateTime), 'h:mm a');
  };

  const EventCard = ({ evt, badgeColor, badgeText }: { evt: any, badgeColor: string, badgeText: string }) => (
    <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col gap-2 hover:shadow-md transition-all">
      <div className="flex justify-between items-start">
        <h4 className="font-bold text-slate-800 text-sm truncate pr-2">{evt.summary || 'Untitled Event'}</h4>
        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap ${badgeColor}`}>
          {badgeText}
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs text-slate-500 font-medium">
        <div className="flex items-center gap-1.5">
          <Clock size={12} className="text-slate-400" />
          {evt.start?.dateTime ? (
            isToday(parseISO(evt.start.dateTime)) ? 'Today' : 
            isTomorrow(parseISO(evt.start.dateTime)) ? 'Tomorrow' : 
            format(parseISO(evt.start.dateTime), 'MMM d, yyyy')
          ) : 'All Day'}
          {evt.start?.dateTime && ` at ${formatEventTime(evt)}`}
        </div>
      </div>
    </div>
  );

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
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                <FileText size={16} className="text-slate-500" /> Upcoming & Categorized Events
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
              {loadingEvents ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
              ) : (
                <>
                  {categorizedEvents.agentFluxEvents.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle2 size={14} /> Fixed by Agent Flux
                      </h4>
                      <div className="grid gap-3">
                        {categorizedEvents.agentFluxEvents.map(evt => (
                          <EventCard key={evt.id} evt={evt} badgeColor="bg-emerald-100 text-emerald-700 border-emerald-200" badgeText="Agent Flux" />
                        ))}
                      </div>
                    </div>
                  )}

                  {categorizedEvents.holidays.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-rose-700 uppercase tracking-wider">Holidays & Time Off</h4>
                      <div className="grid gap-3">
                        {categorizedEvents.holidays.map(evt => (
                          <EventCard key={evt.id} evt={evt} badgeColor="bg-rose-100 text-rose-700 border-rose-200" badgeText="Holiday" />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-blue-700 uppercase tracking-wider">Other Appointments</h4>
                    {categorizedEvents.generalEvents.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No upcoming appointments found.</p>
                    ) : (
                      <div className="grid gap-3">
                        {categorizedEvents.generalEvents.slice(0, 10).map(evt => (
                          <EventCard key={evt.id} evt={evt} badgeColor="bg-slate-100 text-slate-600 border-slate-200" badgeText="Standard" />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
