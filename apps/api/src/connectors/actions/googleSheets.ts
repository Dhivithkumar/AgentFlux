import { ConnectorAction, ConnectorExecutionContext } from '../types';
import { google } from 'googleapis';
import { prisma } from '@agent-flux/database';
import { quoteSheetName } from '../../services/operations/utils';

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
      required: ['range', 'values']
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

      let spreadsheetId = input.spreadsheetId;
      if (!spreadsheetId && context.businessId) {
        const config = await prisma.operationalSheetConfig.findUnique({
          where: { businessId: context.businessId }
        });
        if (config?.spreadsheetId) {
          spreadsheetId = config.spreadsheetId;
        }
      }

      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required.');
      }

      // Safely quote A1 range if sheet name contains spaces or special characters
      let range = input.range || 'Sheet1!A:A';
      if (range.includes('!') && !range.startsWith("'")) {
        const parts = range.split('!');
        const sheetName = parts[0];
        const cellRange = parts.slice(1).join('!');
        range = `${quoteSheetName(sheetName)}!${cellRange}`;
      }

      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
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
