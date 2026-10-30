import { ConnectorProvider, ConnectorAccountInfo, OAuthTokenResult } from '../types';

export class StripeConnectorProvider implements ConnectorProvider {
  providerId = 'STRIPE';

  getAuthorizationUrl(): string {
    throw new Error('Stripe uses Secret Key and Publishable Key.');
  }

  async handleOAuthCallback(): Promise<OAuthTokenResult> {
    throw new Error('OAuth callback not applicable for Stripe API keys.');
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult> {
    return { accessToken: refreshToken };
  }

  async getAccountInfo(accessToken: string): Promise<ConnectorAccountInfo> {
    try {
      const res = await fetch('https://api.stripe.com/v1/account', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        return {
          accountId: data.id || 'stripe_account',
          accountEmail: data.email || null,
          displayName: data.business_profile?.name || 'Stripe Merchant'
        };
      }
    } catch {}

    return {
      accountId: 'stripe_account',
      accountEmail: null,
      displayName: 'Stripe Merchant'
    };
  }

  async verifyConnection(accessToken: string): Promise<boolean> {
    try {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {}

  getCapabilities(): string[] {
    return ['stripe.createCheckoutSession', 'stripe.createPaymentLink'];
  }
}
