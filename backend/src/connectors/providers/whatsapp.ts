import { ConnectorProvider, ConnectorAccountInfo, OAuthTokenResult } from '../types';

export class WhatsAppConnectorProvider implements ConnectorProvider {
  providerId = 'WHATSAPP';

  getAuthorizationUrl(): string {
    throw new Error('WhatsApp uses Cloud API Token and Phone Number ID.');
  }

  async handleOAuthCallback(): Promise<OAuthTokenResult> {
    throw new Error('OAuth callback not applicable for WhatsApp Cloud API.');
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult> {
    return { accessToken: refreshToken };
  }

  async getAccountInfo(accessToken: string): Promise<ConnectorAccountInfo> {
    try {
      // Test the token against Meta Graph API
      const res = await fetch('https://graph.facebook.com/v19.0/me?fields=id,name', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) {
        throw new Error(`WhatsApp API validation failed (${res.status}): ${await res.text()}`);
      }
      const data = await res.json();
      return {
        accountId: data.id || 'whatsapp_business',
        accountEmail: null,
        displayName: data.name || 'WhatsApp Business Account'
      };
    } catch {
      return {
        accountId: 'whatsapp_business',
        accountEmail: null,
        displayName: 'WhatsApp Business'
      };
    }
  }

  async verifyConnection(accessToken: string): Promise<boolean> {
    try {
      const res = await fetch('https://graph.facebook.com/v19.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    // No-op for API token
  }

  getCapabilities(): string[] {
    return ['whatsapp.sendMessage', 'whatsapp.sendTemplate'];
  }
}
