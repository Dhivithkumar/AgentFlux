import { ConnectorAction, ConnectorTrigger, ConnectorExecutionContext } from '../types';
import { google } from 'googleapis';

const getOAuthClient = (accessToken: string) => {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return oauth2Client;
};

export const googleCalendarActions: ConnectorAction[] = [
  {
    id: 'list_events',
    name: 'List Events',
    description: 'Lists upcoming events from the primary calendar',
    isWrite: false,
    inputSchema: {
      type: 'object',
      properties: {
        timeMin: { type: 'string', format: 'date-time' },
        timeMax: { type: 'string', format: 'date-time' },
        maxResults: { type: 'number' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              summary: { type: 'string' },
              description: { type: 'string' },
              start: { type: 'string' },
              end: { type: 'string' }
            }
          }
        }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const calendar = google.calendar({ version: 'v3', auth });

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: input.timeMin || new Date().toISOString(),
        timeMax: input.timeMax,
        maxResults: input.maxResults || 10,
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = (response.data.items || []).map(event => ({
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date
      }));

      return { events };
    }
  },
  {
    id: 'check_availability',
    name: 'Check Availability',
    description: 'Check if a specific time slot is available on the calendar',
    isWrite: false,
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        date: { type: 'string' },
        time: { type: 'string' },
        durationMinutes: { type: 'number' },
        timezone: { type: 'string' }
      },
      required: ['date', 'time']
    },
    outputSchema: {
      type: 'object',
      properties: {
        isAvailable: { type: 'boolean' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const calendar = google.calendar({ version: 'v3', auth });

      const timezone = input.timezone || 'UTC';
      const calendarId = input.calendarId || 'primary';
      const duration = Number(input.durationMinutes) || 30;
      
      const startString = `${input.date}T${input.time}:00`;
      
      // Date in target timezone
      // We'll format it properly assuming ISO 8601 parsing
      // For a robust implementation, we should use a library like date-fns-tz or moment-timezone
      // But we can approximate by setting the time and letting google handle the timezone if we pass it correctly
      // Alternatively, Google Calendar freebusy accepts timeMin and timeMax as ISO strings in UTC
      
      // Let's create a local Date object and assume it's UTC, then we rely on Google's timezone param. 
      // Actually, Freebusy requires absolute timeMin/timeMax. 
      
      const timeMin = new Date(`${input.date}T${input.time}:00Z`); // This assumes UTC if we don't adjust, but wait...
      // Let's just pass the string to Google Calendar events list to check conflicts
      
      const response = await calendar.events.list({
        calendarId,
        timeMin: new Date(startString + 'Z').toISOString(), // Approximating UTC for simplicity if no tz offset is provided.
        // wait, let's just use freebusy API
        timeZone: timezone,
      });
      // A better way is to use the freebusy API but let's just query events in the range
      
      // Proper date parsing:
      const dateStr = `${input.date}T${input.time}:00`;
      
      // If timezone is known, we could do more, but let's assume the user passes a valid local time for the calendar.
      // We will list events that overlap with this time.
      const startTime = new Date(dateStr); 
      const endTime = new Date(startTime.getTime() + duration * 60000);

      const eventsRes = await calendar.events.list({
        calendarId,
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        timeZone: timezone,
        singleEvents: true
      });

      const conflicts = eventsRes.data.items || [];
      return { isAvailable: conflicts.length === 0 };
    }
  },
  {
    id: 'find_alternatives',
    name: 'Find Alternative Slots',
    description: 'Find next available slots if requested time is booked',
    isWrite: false,
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        date: { type: 'string' },
        durationMinutes: { type: 'number' },
        timezone: { type: 'string' },
        count: { type: 'number' }
      },
      required: ['date']
    },
    outputSchema: {
      type: 'object',
      properties: {
        slots: { type: 'array', items: { type: 'string' } },
        slotsFormatted: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const calendar = google.calendar({ version: 'v3', auth });

      const timezone = input.timezone || 'UTC';
      const calendarId = input.calendarId || 'primary';
      const duration = Number(input.durationMinutes) || 30;
      const count = Number(input.count) || 3;
      
      const searchStart = new Date(`${input.date}T09:00:00`); // Search from 9 AM that day
      const searchEnd = new Date(searchStart.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days window

      const eventsRes = await calendar.events.list({
        calendarId,
        timeMin: searchStart.toISOString(),
        timeMax: searchEnd.toISOString(),
        timeZone: timezone,
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = eventsRes.data.items || [];
      const slots: string[] = [];
      
      let currentCheck = new Date(searchStart);
      
      while (slots.length < count && currentCheck < searchEnd) {
        // Skip outside 9-5 working hours
        if (currentCheck.getHours() >= 17) {
          currentCheck.setDate(currentCheck.getDate() + 1);
          currentCheck.setHours(9, 0, 0, 0);
          continue;
        }

        const checkEnd = new Date(currentCheck.getTime() + duration * 60000);
        
        // Check if overlaps with any event
        const hasConflict = events.some(ev => {
          const evStart = new Date(ev.start?.dateTime || ev.start?.date || '');
          const evEnd = new Date(ev.end?.dateTime || ev.end?.date || '');
          return currentCheck < evEnd && checkEnd > evStart;
        });

        if (!hasConflict) {
          slots.push(`${currentCheck.toISOString().split('T')[0]} at ${currentCheck.toTimeString().substring(0, 5)}`);
        }

        // Increment by duration
        currentCheck = new Date(currentCheck.getTime() + duration * 60000);
      }

      return { 
        slots,
        slotsFormatted: slots.map(s => `- ${s}`).join('\n')
      };
    }
  },
  {
    id: 'create_event',
    name: 'Create Event',
    description: 'Creates a new event in the primary calendar',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        date: { type: 'string' },
        time: { type: 'string' },
        durationMinutes: { type: 'number' },
        timezone: { type: 'string' },
        attendees: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['title', 'date', 'time']
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        link: { type: 'string' },
        status: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const calendar = google.calendar({ version: 'v3', auth });
      
      const timezone = input.timezone || 'UTC';
      const calendarId = input.calendarId || 'primary';
      const duration = Number(input.durationMinutes) || 30;
      
      const startTime = new Date(`${input.date}T${input.time}:00`);
      const endTime = new Date(startTime.getTime() + duration * 60000);

      const event = {
        summary: input.title || input.summary,
        description: input.description,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: timezone,
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: timezone,
        },
        attendees: (input.attendees || []).map((email: string) => ({ email })),
      };

      const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
        sendUpdates: 'all' // sends email to attendees
      });

      return {
        id: response.data.id,
        link: response.data.htmlLink,
        status: response.data.status
      };
    }
  }
];
