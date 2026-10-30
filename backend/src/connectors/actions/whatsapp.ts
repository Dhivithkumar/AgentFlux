import { ConnectorAction, ConnectorTrigger, ConnectorExecutionContext } from '../types';
import { prisma } from '@agent-flux/database';

export const whatsappActions: ConnectorAction[] = [
  {
    id: 'whatsapp.sendMessage',
    name: 'Send WhatsApp Message',
    description: 'Sends a direct WhatsApp text message to a recipient phone number',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient phone number with country code (e.g. 919876543210)' },
        message: { type: 'string', description: 'The text message body to send' }
      },
      required: ['to', 'message']
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        messageId: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const integration = await prisma.integration.findFirst({
        where: { businessId: context.businessId, provider: 'WHATSAPP', status: 'CONNECTED' }
      });

      const meta = (integration?.metadata as any) || {};
      const phoneNumberId = meta.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

      if (!phoneNumberId) {
        throw new Error('WhatsApp Phone Number ID is required. Please update WhatsApp integration settings.');
      }

      // Clean recipient phone number (remove +, spaces, hyphens)
      const cleanPhone = String(input.to).replace(/[^0-9]/g, '');

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: {
          preview_url: false,
          body: input.message
        }
      };

      const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${context.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(`WhatsApp API Error: ${resData?.error?.message || response.statusText}`);
      }

      return {
        success: true,
        messageId: resData?.messages?.[0]?.id || 'msg_sent'
      };
    }
  }
];

export const whatsappTriggers: ConnectorTrigger[] = [
  {
    id: 'whatsapp.messageReceived',
    name: 'WhatsApp Message Received',
    eventSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        text: { type: 'string' },
        timestamp: { type: 'string' }
      }
    }
  }
];
