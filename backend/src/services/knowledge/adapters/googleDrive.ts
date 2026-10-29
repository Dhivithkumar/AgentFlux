import { KnowledgeSource } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { KnowledgeSourceAdapter, KnowledgeItem } from './adapter';
import { decrypt, encrypt } from '../../encryption';
import { google } from 'googleapis';
import { getConnectorProvider } from '../../../connectors/registry';
import { GoogleConnectorProvider } from '../../../connectors/providers/google';

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

export class GoogleDriveKnowledgeAdapter implements KnowledgeSourceAdapter {
  async sync(source: KnowledgeSource): Promise<KnowledgeItem[]> {
    if (!source.connectorId) throw new Error('No connectorId provided');
    const auth = await getGoogleAuth(source.connectorId);
    const drive = google.drive({ version: 'v3', auth });

    const config: any = source.configuration || {};
    const folders = config.folders || [];
    
    // Simplification: if folders specified, search within them. If not, just get recent files.
    // Production ready: iterate folders and fetch supported files.
    let q = "mimeType = 'application/pdf' or mimeType = 'text/plain' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'";
    if (folders.length > 0) {
      const parentQueries = folders.map((fId: string) => `'${fId}' in parents`).join(' or ');
      q = `(${parentQueries}) and (${q})`;
    }

    const res = await drive.files.list({
      q,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
      pageSize: 50
    });

    const items: KnowledgeItem[] = [];
    const files = res.data.files || [];

    for (const file of files) {
      if (!file.id) continue;
      
      // Download content
      try {
        const response = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data as ArrayBuffer);
        
        let content = '';
        if (file.mimeType === 'application/pdf') {
          const { PDFParse } = require('pdf-parse');
          const parser = new PDFParse({ data: buffer });
          const data = await parser.getText();
          content = data.text;
        } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const mammoth = require('mammoth');
          const data = await mammoth.extractRawText({ buffer });
          content = data.value;
        } else {
          content = buffer.toString('utf-8');
        }

        items.push({
          externalId: file.id,
          title: file.name || 'Unknown Document',
          content,
          mimeType: file.mimeType || 'application/octet-stream',
          url: file.webViewLink || undefined,
          modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
          metadata: { folderId: folders.length > 0 ? folders[0] : null }
        });
      } catch (err) {
        console.error(`Failed to download Drive file ${file.id}:`, err);
      }
    }

    return items;
  }

  async testConnection(source: KnowledgeSource): Promise<boolean> {
    if (!source.connectorId) return false;
    try {
      const auth = await getGoogleAuth(source.connectorId);
      const drive = google.drive({ version: 'v3', auth });
      await drive.about.get({ fields: 'user' });
      return true;
    } catch {
      return false;
    }
  }
}
