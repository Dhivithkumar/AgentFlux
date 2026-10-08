import { ConnectorAction, ConnectorExecutionContext } from '../types';
import { google } from 'googleapis';

const getOAuthClient = (accessToken: string) => {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return oauth2Client;
};

export const googleSheetsActions: ConnectorAction[] = [
  {
    id: 'sheets.appendRow',
    name: 'Append Rows',
    description: 'Appends rows to a Google Sheet',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: { type: 'string' },
        range: { type: 'string' },
        values: { type: 'array', items: { type: 'array', items: { type: 'string' } } }
      },
      required: ['spreadsheetId', 'range', 'values']
    },
    outputSchema: {
      type: 'object',
      properties: {
        updates: { type: 'object' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const sheets = google.sheets({ version: 'v4', auth });

      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: input.spreadsheetId,
        range: input.range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: input.values
        }
      });

      return {
        updates: response.data.updates
      };
    }
  }
];
