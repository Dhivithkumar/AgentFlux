import { ConnectorAction, ConnectorExecutionContext } from '../types';
import { prisma } from '@agent-flux/database';
import { decrypt } from '../../services/encryption';

export const razorpayActions: ConnectorAction[] = [
  {
    id: 'razorpay.createPaymentLink',
    name: 'Create Razorpay Payment Link',
    description: 'Generates an instant online payment link for an invoice or order',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount in currency units (e.g. 500 for ₹500)' },
        currency: { type: 'string', default: 'INR' },
        description: { type: 'string' },
        customerName: { type: 'string' },
        customerEmail: { type: 'string' },
        customerPhone: { type: 'string' }
      },
      required: ['amount']
    },
    outputSchema: {
      type: 'object',
      properties: {
        paymentLinkId: { type: 'string' },
        shortUrl: { type: 'string' },
        status: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const integration = await prisma.integration.findFirst({
        where: { businessId: context.businessId, provider: 'RAZORPAY', status: 'CONNECTED' },
        include: { credential: true }
      });

      if (!integration || !integration.credential) {
        throw new Error('Razorpay integration not configured for this business.');
      }

      const keyId = decrypt(integration.credential.accessTokenEncrypted);
      const keySecret = integration.credential.refreshTokenEncrypted
        ? decrypt(integration.credential.refreshTokenEncrypted)
        : '';

      const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const amountPaise = Math.round(Number(input.amount) * 100);

      const payload = {
        amount: amountPaise,
        currency: input.currency || 'INR',
        accept_partial: false,
        description: input.description || 'AgentFlux Order Payment',
        customer: {
          name: input.customerName || 'Valued Customer',
          email: input.customerEmail || undefined,
          contact: input.customerPhone || undefined
        },
        notify: {
          sms: !!input.customerPhone,
          email: !!input.customerEmail
        },
        reminder_enable: true
      };

      const response = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(`Razorpay Error: ${resData?.error?.description || response.statusText}`);
      }

      return {
        paymentLinkId: resData.id,
        shortUrl: resData.short_url,
        status: resData.status
      };
    }
  }
];
