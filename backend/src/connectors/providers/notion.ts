import { ConnectorProvider, ConnectorAccountInfo, OAuthTokenResult } from '../types';

export class NotionConnectorProvider implements ConnectorProvider {
  providerId = 'NOTION';

  getAuthorizationUrl(): string {
    throw new Error('Notion uses Internal Integration Secret Token.');
  }

  async handleOAuthCallback(): Promise<OAuthTokenResult> {
    throw new Error('OAuth callback not applicable for Notion integration tokens.');
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult> {
    return { accessToken: refreshToken };
  }

  async getAccountInfo(accessToken: string): Promise<ConnectorAccountInfo> {
    try {
      const res = await fetch('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': '2022-06-28'
        }
      });
      if (res.ok) {
        const data = await res.json();
        return {
          accountId: data.id || 'notion_user',
          accountEmail: data.person?.email || null,
          displayName: data.name || 'Notion Workspace'
        };
      }
    } catch {}

    return {
      accountId: 'notion_account',
      accountEmail: null,
      displayName: 'Notion Workspace'
    };
  }

  async verifyConnection(accessToken: string): Promise<boolean> {
    try {
      const res = await fetch('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': '2022-06-28'
        }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {}

  getCapabilities(): string[] {
    return ['notion.createPage', 'notion.queryDatabase'];
  }
}

