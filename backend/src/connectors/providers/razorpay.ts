import { ConnectorProvider, ConnectorAccountInfo, OAuthTokenResult } from '../types';

export class RazorpayConnectorProvider implements ConnectorProvider {
  providerId = 'RAZORPAY';

  getAuthorizationUrl(): string {
    throw new Error('Razorpay uses Key ID and Key Secret.');
  }

  async handleOAuthCallback(): Promise<OAuthTokenResult> {
    throw new Error('OAuth callback not applicable for Razorpay API keys.');
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult> {
    return { accessToken: refreshToken };
  }

  async getAccountInfo(accessToken: string): Promise<ConnectorAccountInfo> {
    return {
      accountId: 'razorpay_account',
      accountEmail: null,
      displayName: 'Razorpay Merchant'
    };
  }

  async verifyConnection(accessToken: string): Promise<boolean> {
    return !!accessToken;
  }

  async disconnect(): Promise<void> {}

  getCapabilities(): string[] {
    return ['razorpay.createPaymentLink', 'razorpay.verifyPayment'];
  }
}
