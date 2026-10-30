import { ConnectorAction, ConnectorExecutionContext } from '../types';
import { prisma } from '@agent-flux/database';
import { decrypt } from '../../services/encryption';

export const stripeActions: ConnectorAction[] = [
  {
    id: 'stripe.createCheckoutSession',
    name: 'Create Stripe Checkout Session',
    description: 'Creates a hosted Stripe checkout session for credit card/online customer payment',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount in currency units (e.g. 100 for $100)' },
        currency: { type: 'string', default: 'usd' },
        productName: { type: 'string' },
        successUrl: { type: 'string' },
        cancelUrl: { type: 'string' }
      },
      required: ['amount']
    },
    outputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        sessionUrl: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const integration = await prisma.integration.findFirst({
        where: { businessId: context.businessId, provider: 'STRIPE', status: 'CONNECTED' },
        include: { credential: true }
      });

      if (!integration || !integration.credential) {
        throw new Error('Stripe integration not configured for this business.');
      }

      const secretKey = decrypt(integration.credential.accessTokenEncrypted);
      const amountCents = Math.round(Number(input.amount) * 100);

      const params = new URLSearchParams();
      params.append('payment_method_types[0]', 'card');
      params.append('mode', 'payment');
      params.append('line_items[0][price_data][currency]', (input.currency || 'usd').toLowerCase());
      params.append('line_items[0][price_data][unit_amount]', String(amountCents));
      params.append('line_items[0][price_data][product_data][name]', input.productName || 'AgentFlux Invoice Payment');
      params.append('line_items[0][quantity]', '1');
      params.append('success_url', input.successUrl || 'https://agentflux.app/payment/success');
      params.append('cancel_url', input.cancelUrl || 'https://agentflux.app/payment/cancel');

      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(`Stripe Error: ${resData?.error?.message || response.statusText}`);
      }

      return {
        sessionId: resData.id,
        sessionUrl: resData.url
      };
    }
  }
];
