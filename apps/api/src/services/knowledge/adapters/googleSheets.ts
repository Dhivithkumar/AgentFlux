import { KnowledgeSource } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { KnowledgeSourceAdapter, KnowledgeItem } from './adapter';
import { decrypt, encrypt } from '../../encryption';
import { google } from 'googleapis';
import { getConnectorProvider } from '../../../connectors/registry';
import { GoogleConnectorProvider } from '../../../connectors/providers/google';

// We reuse the auth logic
async function getGoogleAuth(integrationId: string) {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    include: { credential: true }
  });
  if (!integration || !integration.credential) throw new Error('Integration not found or missing credentials');

  const provider = getConnectorProvider(integration.provider) as GoogleConnectorProvider;
  let accessToken = decrypt(integration.credential.accessTokenEncrypted);

  if (integration.credential.expiresAt && integration.credential.expiresAt < new Date()) {
    if (integration.credential.refreshTokenEncrypted) {
      const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
      const newTokens = await provider.refreshAccessToken(refreshToken);
      accessToken = newTokens.accessToken;
      
      await prisma.integrationCredential.update({
        where: { id: integration.credential.id },
        data: {
          accessTokenEncrypted: encrypt(accessToken),
          expiresAt: newTokens.expiresIn ? new Date(Date.now() + newTokens.expiresIn * 1000) : null
        }
      });
    } else {
      throw new Error('Token expired and no refresh token available');
    }
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export class GoogleSheetsKnowledgeAdapter implements KnowledgeSourceAdapter {
  async sync(source: KnowledgeSource): Promise<KnowledgeItem[]> {
    if (!source.connectorId) throw new Error('No connectorId provided');
    const auth = await getGoogleAuth(source.connectorId);
    const sheets = google.sheets({ version: 'v4', auth });

    const config: any = source.configuration || {};
    const spreadsheets = config.spreadsheets || []; // e.g. [{ spreadsheetId, sheets: ['Sheet1', 'Sheet2'] }]
    
    const items: KnowledgeItem[] = [];

    for (const doc of spreadsheets) {
      for (const sheetName of doc.sheets) {
        try {
          const res = await sheets.spreadsheets.values.get({
            spreadsheetId: doc.spreadsheetId,
            range: sheetName
          });

          const rows = res.data.values || [];
          if (rows.length === 0) continue;

          // Convert rows into structured JSON text representations
          const headers = rows[0];
          for (let i = 1; i < rows.length; i++) {
            const rowData = rows[i];
            let rowContent = '';
            for (let j = 0; j < headers.length; j++) {
              if (rowData[j]) {
                rowContent += `${headers[j]}: ${rowData[j]}\n`;
              }
            }

            if (rowContent.trim()) {
              items.push({
                externalId: `${doc.spreadsheetId}#${sheetName}#${i}`,
                title: `Row ${i} from ${sheetName}`,
                content: rowContent.trim(),
                mimeType: 'application/vnd.google-apps.spreadsheet',
                url: `https://docs.google.com/spreadsheets/d/${doc.spreadsheetId}/edit#gid=0`,
                metadata: { spreadsheetId: doc.spreadsheetId, sheetName, rowNumber: i }
              });
            }
          }
        } catch (err) {
          console.error(`Failed to process sheet ${sheetName} in ${doc.spreadsheetId}`, err);
        }
      }
    }

    return items;
  }

  async testConnection(source: KnowledgeSource): Promise<boolean> {
    if (!source.connectorId) return false;
    try {
      const auth = await getGoogleAuth(source.connectorId);
      // We can't really do an "about" for sheets, but we can list a spreadsheet if we have one or just rely on drive
      const drive = google.drive({ version: 'v3', auth });
      await drive.about.get({ fields: 'user' });
      return true;
    } catch {
      return false;
    }
  }
}
