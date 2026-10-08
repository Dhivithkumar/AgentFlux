import { google } from 'googleapis';
import { OperationalAdapter, OperationalRow, OperationalWorksheetSchema } from './types';
import { getConnectorProvider } from '../../connectors/registry';
import { GoogleConnectorProvider } from '../../connectors/providers/google';
import { prisma } from '@agent-flux/database';
import { decrypt } from '../encryption';

async function getGoogleAuth(integrationId: string) {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    include: { credential: true }
  });

  if (!integration || !integration.credential) {
    throw new Error('Google integration not found or missing credentials');
  }

  const provider = getConnectorProvider(integration.provider) as GoogleConnectorProvider;
  const accessToken = decrypt(integration.credential.accessTokenEncrypted);
  
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  
  if (integration.credential.refreshTokenEncrypted) {
    const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
    auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  } else {
    auth.setCredentials({ access_token: accessToken });
  }

  return auth;
}

export class GoogleSheetsAdapter implements OperationalAdapter {
  private integrationId: string;

  constructor(integrationId: string) {
    this.integrationId = integrationId;
  }

  getSpreadsheetUrl(spreadsheetId: string): string {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  }

  async listSpreadsheets(): Promise<{ id: string, name: string, lastModified: string, owner: string }[]> {
    const auth = await getGoogleAuth(this.integrationId);
    const drive = google.drive({ version: 'v3', auth });
    
    const res = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: "files(id, name, modifiedTime, owners)",
      orderBy: "modifiedTime desc",
      pageSize: 100
    });

    const files = res.data.files || [];
    return files.map(file => ({
      id: file.id || '',
      name: file.name || '',
      lastModified: file.modifiedTime || '',
      owner: file.owners?.[0]?.emailAddress || 'Unknown'
    }));
  }

  async getSpreadsheetInfo(spreadsheetId: string): Promise<{ id: string, name: string }> {
    const auth = await getGoogleAuth(this.integrationId);
    const sheets = google.sheets({ version: 'v4', auth });
    
    const doc = await sheets.spreadsheets.get({ spreadsheetId });
    return {
      id: doc.data.spreadsheetId || spreadsheetId,
      name: doc.data.properties?.title || 'Unknown Spreadsheet'
    };
  }

  async getWorksheets(spreadsheetId: string): Promise<{ id: string, name: string }[]> {
    const auth = await getGoogleAuth(this.integrationId);
    const sheets = google.sheets({ version: 'v4', auth });
    
    const doc = await sheets.spreadsheets.get({ spreadsheetId });
    const worksheets = doc.data.sheets || [];
    return worksheets.map(sheet => ({
      id: sheet.properties?.sheetId?.toString() || '',
      name: sheet.properties?.title || ''
    }));
  }

  async getWorksheetPreview(spreadsheetId: string, worksheetName: string): Promise<string[][]> {
    const auth = await getGoogleAuth(this.integrationId);
    const sheets = google.sheets({ version: 'v4', auth });
    
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${worksheetName}'!A1:Z10`
    });
    
    return res.data.values || [];
  }

  async verifyAccess(spreadsheetId: string): Promise<boolean> {
    try {
      const auth = await getGoogleAuth(this.integrationId);
      const sheets = google.sheets({ version: 'v4', auth });
      await sheets.spreadsheets.get({ spreadsheetId });
      return true;
    } catch (e) {
      return false;
    }
  }

  async initialize(spreadsheetName: string, schemas: OperationalWorksheetSchema[]): Promise<{ spreadsheetId: string, sheetMappings: Record<string, string> }> {
    const auth = await getGoogleAuth(this.integrationId);
    const sheets = google.sheets({ version: 'v4', auth });

    // Create Spreadsheet
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: spreadsheetName },
        sheets: schemas.map(schema => ({
          properties: { title: schema.name }
        }))
      }
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId!;
    const sheetMappings: Record<string, string> = {};
    
    // Add headers to each sheet
    for (const schema of schemas) {
      const sheet = spreadsheet.data.sheets?.find((s: any) => s.properties?.title === schema.name);
      if (sheet) {
        sheetMappings[schema.name] = sheet.properties!.sheetId!.toString();
      }
      
      await this.ensureWorksheetAndHeaders(spreadsheetId, schema, sheets);
    }

    return { spreadsheetId, sheetMappings };
  }

  async ensureWorksheetAndHeaders(spreadsheetId: string, schema: OperationalWorksheetSchema, _sheets?: any): Promise<string> {
    const auth = await getGoogleAuth(this.integrationId);
    const sheets = _sheets || google.sheets({ version: 'v4', auth });
    
    const doc = await sheets.spreadsheets.get({ spreadsheetId });
    let sheetId = '';
    
    const existingSheet = doc.data.sheets?.find((s: any) => s.properties?.title === schema.name);
    if (!existingSheet) {
      // Add sheet
      const response = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: schema.name }
            }
          }]
        }
      });
      sheetId = response.data.replies![0].addSheet!.properties!.sheetId!.toString();
    } else {
      sheetId = existingSheet.properties!.sheetId!.toString();
    }

    // Read existing headers
    const headerRowResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${schema.name}'!A1:Z1`
    });

    const currentHeaders: string[] = headerRowResponse.data.values?.[0] || [];

    // Append missing headers
    const missingHeaders = schema.headers.filter(h => !currentHeaders.includes(h));
    
    if (missingHeaders.length > 0) {
      const newHeaders = [...currentHeaders, ...missingHeaders];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${schema.name}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [newHeaders]
        }
      });
      // Formatting headers
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: {
                sheetId: parseInt(sheetId),
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                  textFormat: { bold: true }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          }]
        }
      });
    }

    return sheetId;
  }

  async syncRecords(spreadsheetId: string, worksheetName: string, records: OperationalRow[]): Promise<void> {
    if (records.length === 0) return;

    const auth = await getGoogleAuth(this.integrationId);
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Get current headers to map columns
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${worksheetName}'!1:1`
    });
    const headers = headerRes.data.values?.[0] || [];
    if (headers.length === 0) throw new Error(`Worksheet ${worksheetName} has no headers`);
    
    // 2. Get existing IDs to know whether to update or append
    // Assuming ID is in the first column, matching the schema
    const idColumnName = headers[0]; // e.g. "Enquiry ID" or "Customer ID"
    
    const allDataRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${worksheetName}'!A:Z`
    });
    
    const existingRows = allDataRes.data.values || [];
    // Skip header row
    const rowMapping = new Map<string, number>(); // ID -> Row Index (0-indexed)
    for (let i = 1; i < existingRows.length; i++) {
      const rowId = existingRows[i][0];
      if (rowId) {
        rowMapping.set(rowId.toString(), i);
      }
    }

    const appendValues: any[][] = [];
    const updateData: { range: string, values: any[][] }[] = [];

    for (const record of records) {
      // Build row array according to header order
      const rowData = headers.map(header => {
        if (header === idColumnName) return record.id;
        const val = record.data[header];
        if (val === undefined || val === null) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return val.toString();
      });

      if (rowMapping.has(record.id)) {
        // Update
        const rowIndex = rowMapping.get(record.id)!;
        updateData.push({
          range: `'${worksheetName}'!A${rowIndex + 1}`,
          values: [rowData]
        });
      } else {
        // Append
        appendValues.push(rowData);
      }
    }

    // Execute Updates
    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updateData
        }
      });
    }

    // Execute Appends
    if (appendValues.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${worksheetName}'!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: appendValues
        }
      });
    }
  }
}
