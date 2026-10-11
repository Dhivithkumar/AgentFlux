import '../env';
import { prisma } from '@agent-flux/database';
import { google } from 'googleapis';
import { decrypt } from '../services/encryption';

async function main() {
  const integration = await prisma.integration.findUnique({
    where: { id: 'ecaefffb-da38-4470-bb62-f9a5759b6779' },
    include: { credential: true }
  });

  if (!integration || !integration.credential) {
    console.log('No integration found');
    process.exit(1);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  if (integration.credential.refreshTokenEncrypted) {
    const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      console.log('Token refreshed successfully! Access token length:', credentials.access_token?.length);
      oauth2Client.setCredentials({ access_token: credentials.access_token });
    } catch (refErr: any) {
      console.error('Refresh token error:', refErr.message);
    }
  } else {
    const accessToken = decrypt(integration.credential.accessTokenEncrypted);
    oauth2Client.setCredentials({ access_token: accessToken });
  }

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  try {
    const res = await drive.files.list({ pageSize: 5 });
    console.log('Drive files list success! Files found:', res.data.files?.length);
    if (res.data.files && res.data.files.length > 0) {
      console.log('Sample file:', res.data.files[0].name);
    }
  } catch (err: any) {
    console.error('Drive files list error:', err.message);
  }
  process.exit(0);
}

main().catch(console.error);
