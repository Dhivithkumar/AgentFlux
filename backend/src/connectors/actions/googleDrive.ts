import { ConnectorAction, ConnectorExecutionContext } from '../types';
import { google } from 'googleapis';
import * as fs from 'fs';

const getOAuthClient = (accessToken: string) => {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return oauth2Client;
};

export const googleDriveActions: ConnectorAction[] = [
  {
    id: 'drive.uploadFile',
    name: 'Upload File',
    description: 'Uploads a file to Google Drive',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        mimeType: { type: 'string' },
        filePath: { type: 'string' }
      },
      required: ['filename', 'mimeType', 'filePath']
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        webViewLink: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const drive = google.drive({ version: 'v3', auth });

      const fileMetadata = {
        name: input.filename
      };

      const media = {
        mimeType: input.mimeType,
        body: fs.createReadStream(input.filePath)
      };

      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink'
      });

      return {
        id: file.data.id,
        webViewLink: file.data.webViewLink
      };
    }
  }
];
