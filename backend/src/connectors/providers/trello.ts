import { ConnectorProvider, ConnectorAccountInfo, OAuthTokenResult } from '../types';

export class TrelloConnectorProvider implements ConnectorProvider {
  providerId = 'TRELLO';

  getAuthorizationUrl(): string {
    throw new Error('Trello uses API Key and Token.');
  }

  async handleOAuthCallback(): Promise<OAuthTokenResult> {
    throw new Error('OAuth callback not applicable for Trello API key & token.');
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult> {
    return { accessToken: refreshToken };
  }

  async getAccountInfo(accessToken: string): Promise<ConnectorAccountInfo> {
    return {
      accountId: 'trello_account',
      accountEmail: null,
      displayName: 'Trello Workspace'
    };
  }

  async verifyConnection(accessToken: string): Promise<boolean> {
    return !!accessToken;
  }

  async disconnect(): Promise<void> {}

  getCapabilities(): string[] {
    return ['trello.createCard', 'trello.moveCard'];
  }
}
