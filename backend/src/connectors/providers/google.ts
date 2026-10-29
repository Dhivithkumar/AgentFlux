import { google } from 'googleapis';
import { ConnectorProvider, ConnectorAccountInfo, OAuthTokenResult } from '../types';

export class GoogleConnectorProvider implements ConnectorProvider {
  providerId: string;
  private oauth2Client: any;

  constructor(providerId: string) {
    this.providerId = providerId;
    
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      console.warn('Google OAuth credentials are not set in environment.');
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );
  }

  getAuthorizationUrl(state: string, scopes: string[]): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // Request refresh token
      prompt: 'consent', // Force consent screen to always get a refresh token
      state,
      scope: scopes,
    });
  }

  async handleOAuthCallback(code: string): Promise<OAuthTokenResult> {
    const { tokens } = await this.oauth2Client.getToken(code);
    
    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token || undefined,
      expiresIn: tokens.expiry_date ? Math.floor((tokens.expiry_date - Date.now()) / 1000) : undefined,
      tokenType: tokens.token_type || 'Bearer',
      scope: tokens.scope || undefined
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult> {
    this.oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    const { credentials } = await this.oauth2Client.refreshAccessToken();

    return {
      accessToken: credentials.access_token!,
      refreshToken: credentials.refresh_token || undefined, // Sometimes refresh tokens aren't returned on refresh
      expiresIn: credentials.expiry_date ? Math.floor((credentials.expiry_date - Date.now()) / 1000) : undefined,
      tokenType: credentials.token_type || 'Bearer',
      scope: credentials.scope || undefined
    };
  }

  async getAccountInfo(accessToken: string): Promise<ConnectorAccountInfo> {
    this.oauth2Client.setCredentials({ access_token: accessToken });
    const oauth2 = google.oauth2({
      auth: this.oauth2Client,
      version: 'v2'
    });

    const userInfo = await oauth2.userinfo.get();
    
    return {
      accountId: userInfo.data.id || '',
      accountEmail: userInfo.data.email || null,
      displayName: userInfo.data.name || null,
      metadata: {
        picture: userInfo.data.picture,
        verified_email: userInfo.data.verified_email
      }
    };
  }

  async verifyConnection(accessToken: string): Promise<boolean> {
    try {
      await this.getAccountInfo(accessToken);
      return true;
    } catch (error) {
      return false;
    }
  }

  async disconnect(accessToken: string): Promise<void> {
    try {
      await this.oauth2Client.revokeToken(accessToken);
    } catch (error) {
      console.error('Error revoking Google token:', error);
      // We don't throw here because if the token is already invalid, revoking it might fail, 
      // but we still want to proceed with local disconnection.
    }
  }

  getCapabilities(): string[] {
    switch (this.providerId) {
      case 'GMAIL':
        return ['read_email', 'search_email', 'send_email', 'create_draft'];
      case 'GOOGLE_CALENDAR':
        return ['read_events', 'create_event', 'update_event', 'delete_event'];
      case 'GOOGLE_SHEETS':
        return ['read_sheet', 'write_sheet', 'append_rows', 'update_cells'];
      case 'GOOGLE_DRIVE':
        return ['search_files', 'read_file', 'upload_file', 'create_folder'];
      default:
        return [];
    }
  }
}
