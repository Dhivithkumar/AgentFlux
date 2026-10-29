import { google } from 'googleapis';
import {
  OperationalAdapter,
  OperationalRow,
  OperationalWorksheetSchema,
  SyncRecordsOptions,
  SetupRequiredError,
  ColumnConflictError,
  PermissionDeniedError
} from './types';
import { getConnectorProvider } from '../../connectors/registry';
import { GoogleConnectorProvider } from '../../connectors/providers/google';
import { prisma } from '@agent-flux/database';
import { decrypt, encrypt } from '../encryption';
import { quoteSheetName, formatA1Range, normalizeHeader, deduplicateHeaders, sheetLock } from './utils';

export function columnToLetter(column: number): string {
  let temp: number;
  let letter = '';
  let col = column + 1;
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = Math.floor((col - temp) / 26);
  }
  return letter;
}

export async function getGoogleAuth(integrationId: string, expectedBusinessId?: string) {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    include: { credential: true }
  });

  if (!integration || !integration.credential) {
    throw new SetupRequiredError('Google Sheets integration not found or missing credentials');
  }

  if (expectedBusinessId && integration.businessId !== expectedBusinessId) {
    throw new PermissionDeniedError(`Integration does not belong to business ${expectedBusinessId}`);
  }

  if (integration.status === 'RECONNECT_REQUIRED') {
    throw new PermissionDeniedError('Google integration requires reconnection before sync can proceed');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  let accessToken = decrypt(integration.credential.accessTokenEncrypted);

  // Auto-refresh token if expired or close to expiry (within 60s)
  if (
    integration.credential.expiresAt &&
    integration.credential.expiresAt.getTime() < Date.now() + 60000 &&
    integration.credential.refreshTokenEncrypted
  ) {
    try {
      const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
      const provider = getConnectorProvider(integration.provider) as GoogleConnectorProvider;
      const newTokens = await provider.refreshAccessToken(refreshToken);

      accessToken = newTokens.accessToken;

      const updateResult = await prisma.integrationCredential.updateMany({
        where: {
          id: integration.credential.id,
          accessTokenEncrypted: integration.credential.accessTokenEncrypted
        },
        data: {
          accessTokenEncrypted: encrypt(newTokens.accessToken),
          refreshTokenEncrypted: newTokens.refreshToken
            ? encrypt(newTokens.refreshToken)
            : integration.credential.refreshTokenEncrypted,
          expiresAt: newTokens.expiresIn ? new Date(Date.now() + newTokens.expiresIn * 1000) : null
        }
      });

      if (updateResult.count === 0) {
        const latestCreds = await prisma.integrationCredential.findUnique({
          where: { id: integration.credential.id }
        });
        if (latestCreds) {
          accessToken = decrypt(latestCreds.accessTokenEncrypted);
        }
      }
    } catch (refreshErr: any) {
      console.error('[GoogleSheetsAdapter] Token refresh failed:', refreshErr.message);
      const isAuthError =
        refreshErr.response?.status === 400 ||
        refreshErr.response?.status === 401 ||
        refreshErr.message?.includes('invalid_grant');
      if (isAuthError) {
        await prisma.integration.update({
          where: { id: integration.id },
          data: { status: 'RECONNECT_REQUIRED' }
        });
        throw new PermissionDeniedError(
          'Google integration token expired and refresh failed. Reconnection required.'
        );
      }
      throw refreshErr;
    }
  }

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
  private businessId?: string;

  constructor(integrationId: string, businessId?: string) {
    this.integrationId = integrationId;
    this.businessId = businessId;
  }

  private async getAuth() {
    return getGoogleAuth(this.integrationId, this.businessId);
  }

  private handleGoogleError(err: any): never {
    const status = err.response?.status || err.code;
    const msg = err.message || '';
    if (
      status === 401 ||
      status === 403 ||
      msg.includes('invalid_grant') ||
      msg.includes('unauthorized') ||
      msg.includes('The caller does not have permission')
    ) {
      // Mark integration as RECONNECT_REQUIRED asynchronously
      prisma.integration
        .update({
          where: { id: this.integrationId },
          data: { status: 'RECONNECT_REQUIRED' }
        })
        .catch(console.error);

      throw new PermissionDeniedError(`Google Sheets permission denied: ${msg}`);
    }
    throw err;
  }

  getSpreadsheetUrl(spreadsheetId: string): string {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  }

  async listSpreadsheets(): Promise<{ id: string; name: string; lastModified: string; owner: string }[]> {
    try {
      const auth = await this.getAuth();
      const drive = google.drive({ version: 'v3', auth });

      const res = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: 'files(id, name, modifiedTime, owners)',
        orderBy: 'modifiedTime desc',
        pageSize: 100
      });

      const files = res.data.files || [];
      return files.map((file) => ({
        id: file.id || '',
        name: file.name || '',
        lastModified: file.modifiedTime || '',
        owner: file.owners?.[0]?.emailAddress || 'Unknown'
      }));
    } catch (e: any) {
      return this.handleGoogleError(e);
    }
  }

  async getSpreadsheetInfo(spreadsheetId: string): Promise<{ id: string; name: string }> {
    try {
      const auth = await this.getAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      const doc = await sheets.spreadsheets.get({ spreadsheetId });
      return {
        id: doc.data.spreadsheetId || spreadsheetId,
        name: doc.data.properties?.title || 'Unknown Spreadsheet'
      };
    } catch (e: any) {
      return this.handleGoogleError(e);
    }
  }

  async getWorksheets(spreadsheetId: string): Promise<{ id: string; name: string }[]> {
    try {
      const auth = await this.getAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      const doc = await sheets.spreadsheets.get({ spreadsheetId });
      const worksheets = doc.data.sheets || [];
      return worksheets.map((sheet) => ({
        id: sheet.properties?.sheetId?.toString() || '',
        name: sheet.properties?.title || ''
      }));
    } catch (e: any) {
      return this.handleGoogleError(e);
    }
  }

  async getWorksheetPreview(spreadsheetId: string, worksheetName: string, limit: number = 100): Promise<string[][]> {
    try {
      const auth = await this.getAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      const range = formatA1Range(worksheetName, `A1:Z${limit}`);
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range
      });

      return res.data.values || [];
    } catch (e: any) {
      return this.handleGoogleError(e);
    }
  }

  async verifyAccess(spreadsheetId: string): Promise<boolean> {
    try {
      const auth = await this.getAuth();
      const sheets = google.sheets({ version: 'v4', auth });
      await sheets.spreadsheets.get({ spreadsheetId });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Explicit setup operation: creates a new spreadsheet and initializes schema worksheets and headers.
   */
  async initialize(
    spreadsheetName: string,
    schemas: OperationalWorksheetSchema[]
  ): Promise<{ spreadsheetId: string; sheetMappings: Record<string, string> }> {
    try {
      const auth = await this.getAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      // Deduplicate schema names
      const seenSheetNames = new Set<string>();
      const dedupedSchemas: OperationalWorksheetSchema[] = [];
      for (const s of schemas) {
        const norm = normalizeHeader(s.name);
        if (!seenSheetNames.has(norm)) {
          seenSheetNames.add(norm);
          dedupedSchemas.push(s);
        }
      }

      // Create Spreadsheet with first sheet or all sheets
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: spreadsheetName },
          sheets: dedupedSchemas.map((schema) => ({
            properties: { title: schema.name }
          }))
        }
      });

      const spreadsheetId = spreadsheet.data.spreadsheetId!;
      const sheetMappings: Record<string, string> = {};

      for (const schema of dedupedSchemas) {
        const sheet = spreadsheet.data.sheets?.find(
          (s: any) => normalizeHeader(s.properties?.title) === normalizeHeader(schema.name)
        );
        if (sheet?.properties?.sheetId !== undefined && sheet?.properties?.sheetId !== null) {
          sheetMappings[schema.name] = sheet.properties.sheetId.toString();
        }

        await this.ensureWorksheetAndHeaders(spreadsheetId, schema, sheets);
      }

      return { spreadsheetId, sheetMappings };
    } catch (e: any) {
      return this.handleGoogleError(e);
    }
  }

  /**
   * Ensures the worksheet exists and has all required schema headers.
   * Matches existing headers case-insensitively after trimming whitespace.
   * Checks for column conflicts in existing sheets.
   * Appends ONLY genuinely missing headers to the end of row 1, preserving existing columns.
   */
  async ensureWorksheetAndHeaders(
    spreadsheetId: string,
    schema: OperationalWorksheetSchema,
    targetOrSheets?: string | any,
    _sheets?: any
  ): Promise<string> {
    try {
      const auth = await this.getAuth();
      const customSheetName = typeof targetOrSheets === 'string' ? targetOrSheets : undefined;
      const sheets = (typeof targetOrSheets !== 'string' ? targetOrSheets : _sheets) || google.sheets({ version: 'v4', auth });
      const targetName = customSheetName || schema.name;

      const doc = await sheets.spreadsheets.get({ spreadsheetId });
      const existingSheets = doc.data.sheets || [];

      // Match sheet case-insensitively to prevent duplicate worksheet tabs
      const targetNormTitle = normalizeHeader(targetName);
      let existingSheet = existingSheets.find(
        (s: any) => normalizeHeader(s.properties?.title) === targetNormTitle
      );

      let sheetId = '';
      let actualSheetName = targetName;

      if (!existingSheet) {
        const addRes = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: { title: targetName }
                }
              }
            ]
          }
        });
        sheetId = addRes.data.replies![0].addSheet!.properties!.sheetId!.toString();
        actualSheetName = targetName;
      } else {
        sheetId = existingSheet.properties!.sheetId!.toString();
        actualSheetName = existingSheet.properties!.title!;
      }

      // Read existing headers from row 1
      const headerRange = formatA1Range(actualSheetName, '1:1');
      const headerRowRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: headerRange
      });

      const currentHeaders: string[] = headerRowRes.data.values?.[0] || [];

      // Detect column conflicts in existing headers (case-insensitive duplicate check)
      const currentNormMap = new Map<string, { original: string; index: number }>();
      for (let i = 0; i < currentHeaders.length; i++) {
        const orig = currentHeaders[i];
        const norm = normalizeHeader(orig);
        if (!norm) continue;
        if (currentNormMap.has(norm)) {
          const conflicting = currentNormMap.get(norm)!;
          throw new ColumnConflictError(
            `Column conflict in worksheet "${actualSheetName}": Multiple columns have conflicting header "${orig}" and "${conflicting.original}" (columns ${conflicting.index + 1} and ${i + 1}).`
          );
        }
        currentNormMap.set(norm, { original: orig, index: i });
      }

      // Normalise and deduplicate requested schema headers
      const requestedHeaders = deduplicateHeaders(schema.headers);

      // Find genuinely missing headers
      const missingHeaders: string[] = [];
      for (const reqH of requestedHeaders) {
        const norm = normalizeHeader(reqH);
        if (!currentNormMap.has(norm)) {
          missingHeaders.push(reqH);
        }
      }

      // Append genuinely missing headers if any
      if (missingHeaders.length > 0) {
        const updatedHeaders = [...currentHeaders, ...missingHeaders];
        const writeRange = formatA1Range(actualSheetName, '1:1');

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: writeRange,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [updatedHeaders]
          }
        });

        // Format header row (bold and soft grey background)
        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  repeatCell: {
                    range: {
                      sheetId: parseInt(sheetId),
                      startRowIndex: 0,
                      endRowIndex: 1,
                      startColumnIndex: 0,
                      endColumnIndex: updatedHeaders.length
                    },
                    cell: {
                      userEnteredFormat: {
                        backgroundColor: { red: 0.94, green: 0.95, blue: 0.97 },
                        textFormat: { bold: true }
                      }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat)'
                  }
                }
              ]
            }
          });
        } catch {
          // Non-fatal if formatting batch fails
        }
      }

      return sheetId;
    } catch (e: any) {
      if (e instanceof ColumnConflictError) throw e;
      return this.handleGoogleError(e);
    }
  }

  /**
   * Authoritative upsert method for syncing operational records into a worksheet.
   * Uses an in-memory lock per (spreadsheetId + worksheetName) to protect against concurrent duplicate appends.
   * Matches rows by the stable entity ID in the configured/schema ID column.
   * Updates matching row in-place; appends only when absent.
   */
  async syncRecords(
    spreadsheetId: string,
    worksheetName: string,
    records: OperationalRow[],
    options?: SyncRecordsOptions
  ): Promise<void> {
    if (!records || records.length === 0) return;

    // Serialize operations for this worksheet to protect against concurrent duplicate appends
    const lockKey = `${spreadsheetId}:${normalizeHeader(worksheetName)}`;

    return await sheetLock.acquire(lockKey, async () => {
      try {
        const auth = await this.getAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // Find actual sheet name case-insensitively
        const doc = await sheets.spreadsheets.get({ spreadsheetId });
        const existingSheets = doc.data.sheets || [];
        const matchedSheet = existingSheets.find(
          (s: any) => normalizeHeader(s.properties?.title) === normalizeHeader(worksheetName)
        );

        if (!matchedSheet) {
          throw new SetupRequiredError(
            `Worksheet "${worksheetName}" does not exist in spreadsheet ${spreadsheetId}. Setup is required.`
          );
        }

        const actualTitle = matchedSheet.properties!.title!;

        // 1. Read existing headers from row 1
        const headerRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: formatA1Range(actualTitle, '1:1')
        });

        const headers: string[] = headerRes.data.values?.[0] || [];
        if (headers.length === 0) {
          throw new SetupRequiredError(
            `Worksheet "${actualTitle}" has no headers. Initialize worksheet schema first.`
          );
        }

        // Validate headers for conflicts
        const headerNormMap = new Map<string, number>();
        for (let i = 0; i < headers.length; i++) {
          const norm = normalizeHeader(headers[i]);
          if (!norm) continue;
          if (headerNormMap.has(norm)) {
            throw new ColumnConflictError(
              `Column conflict in worksheet "${actualTitle}": Header "${headers[i]}" duplicates column ${headerNormMap.get(norm)! + 1}.`
            );
          }
          headerNormMap.set(norm, i);
        }

        // 2. Identify the ID column index
        const targetIdHeader = options?.idField || headers[0];
        let idColIndex = -1;

        // Check if custom columnMapping maps the ID field
        if (options?.columnMapping && options.columnMapping[targetIdHeader]) {
          const mappedHeader = options.columnMapping[targetIdHeader];
          const normMapped = normalizeHeader(mappedHeader);
          if (headerNormMap.has(normMapped)) {
            idColIndex = headerNormMap.get(normMapped)!;
          }
        }

        if (idColIndex === -1) {
          const normTarget = normalizeHeader(targetIdHeader);
          if (headerNormMap.has(normTarget)) {
            idColIndex = headerNormMap.get(normTarget)!;
          } else {
            // Fallback: search for header ending with 'id' or first column
            for (let i = 0; i < headers.length; i++) {
              if (normalizeHeader(headers[i]).includes('id')) {
                idColIndex = i;
                break;
              }
            }
            if (idColIndex === -1) {
              idColIndex = 0;
            }
          }
        }

        // 3. Read existing data rows to locate matching entity IDs
        const endColLetter = columnToLetter(Math.max(headers.length - 1, 0));
        const dataRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: formatA1Range(actualTitle, `A2:${endColLetter}`)
        });

        const existingRows = dataRes.data.values || [];
        // Map entityId -> row index (1-based sheet row number; row 1 is headers, so existingRows[0] is row 2)
        const rowMapping = new Map<string, number>();
        for (let i = 0; i < existingRows.length; i++) {
          const row = existingRows[i];
          const rowId = row[idColIndex];
          if (rowId !== undefined && rowId !== null) {
            const trimmedId = String(rowId).trim();
            if (trimmedId) {
              rowMapping.set(trimmedId, i + 2);
            }
          }
        }

        // Build inverted column mapping: sheetHeaderNorm -> record field key
        // If columnMapping is passed, respect: schemaKey -> actualHeader
        const headerToFieldKey = new Map<number, string>();
        for (let c = 0; c < headers.length; c++) {
          const sheetHeaderNorm = normalizeHeader(headers[c]);
          let matchedKey: string | null = null;

          if (options?.columnMapping) {
            for (const [schemaKey, sheetCol] of Object.entries(options.columnMapping)) {
              if (normalizeHeader(sheetCol) === sheetHeaderNorm) {
                matchedKey = schemaKey;
                break;
              }
            }
          }

          if (!matchedKey) {
            // Find key in record data matching case-insensitively
            for (const rec of records) {
              for (const key of Object.keys(rec.data)) {
                if (normalizeHeader(key) === sheetHeaderNorm) {
                  matchedKey = key;
                  break;
                }
              }
              if (matchedKey) break;
            }
          }

          if (matchedKey) {
            headerToFieldKey.set(c, matchedKey);
          }
        }

        const appendValues: any[][] = [];
        const updateData: { range: string; values: any[][] }[] = [];

        for (const record of records) {
          // Construct row array aligned with sheet's existing header order
          const rowData = headers.map((header, colIdx) => {
            if (colIdx === idColIndex) {
              return record.id;
            }

            const fieldKey = headerToFieldKey.get(colIdx) || header;
            let val = record.data[fieldKey];

            // Case-insensitive fallback lookup in record.data
            if (val === undefined) {
              const normHeader = normalizeHeader(header);
              for (const [k, v] of Object.entries(record.data)) {
                if (normalizeHeader(k) === normHeader) {
                  val = v;
                  break;
                }
              }
            }

            if (val === undefined || val === null) return '';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          });

          const existingRowIndex = rowMapping.get(record.id.trim());

          if (existingRowIndex !== undefined) {
            // Update existing row
            updateData.push({
              range: formatA1Range(actualTitle, `A${existingRowIndex}:${endColLetter}${existingRowIndex}`),
              values: [rowData]
            });
          } else {
            // Append absent record
            appendValues.push(rowData);
            // Register newly appended row in rowMapping to protect against duplicate records in the same batch
            const nextRowIndex = existingRows.length + appendValues.length + 1;
            rowMapping.set(record.id.trim(), nextRowIndex);
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
            range: formatA1Range(actualTitle, `A:${endColLetter}`),
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: appendValues
            }
          });
        }
      } catch (e: any) {
        if (e instanceof SetupRequiredError || e instanceof ColumnConflictError || e instanceof PermissionDeniedError) {
          throw e;
        }
        return this.handleGoogleError(e);
      }
    });
  }
}
