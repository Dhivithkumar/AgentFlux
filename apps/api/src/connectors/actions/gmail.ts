import { ConnectorAction, ConnectorTrigger, ConnectorExecutionContext } from '../types';
import { google } from 'googleapis';

const getOAuthClient = (accessToken: string) => {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return oauth2Client;
};

export const gmailActions: ConnectorAction[] = [
  {
    id: 'read_email',
    name: 'Read Email',
    description: 'Reads an email by its ID',
    isWrite: false,
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string' }
      },
      required: ['messageId']
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        snippet: { type: 'string' },
        subject: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        body: { type: 'string' },
        date: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const gmail = google.gmail({ version: 'v1', auth });

      const response = await gmail.users.messages.get({
        userId: 'me',
        id: input.messageId,
        format: 'full'
      });

      const message = response.data;
      const headers = message.payload?.headers || [];
      const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
      const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
      const to = headers.find(h => h.name?.toLowerCase() === 'to')?.value || '';
      const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value || '';

      // Simple body extraction (can be improved for multipart emails)
      let body = '';
      if (message.payload?.body?.data) {
        body = Buffer.from(message.payload.body.data, 'base64').toString('utf8');
      } else if (message.payload?.parts) {
        const textPart = message.payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf8');
        }
      }

      return {
        id: message.id,
        snippet: message.snippet,
        subject,
        from,
        to,
        body,
        date
      };
    }
  },
  {
    id: 'send_email',
    name: 'Send Email',
    description: 'Sends an email from your Gmail account',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              mimeType: { type: 'string' },
              content: { type: 'string' }, // Base64 content
              filePath: { type: 'string' } // Or absolute file path
            }
          }
        }
      },
      required: ['to', 'subject', 'body']
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const gmail = google.gmail({ version: 'v1', auth });

      // Construct MIME email
      const utf8Subject = `=?utf-8?B?${Buffer.from(input.subject).toString('base64')}?=`;
      
      const commonHeaders = [
        `To: ${input.to}`,
        `Subject: ${utf8Subject}`,
        'MIME-Version: 1.0'
      ];
      
      if (input.inReplyTo) {
        commonHeaders.push(`In-Reply-To: ${input.inReplyTo}`);
        commonHeaders.push(`References: ${input.inReplyTo}`);
      }
      
      let rawMessage = '';
      if (input.attachments && input.attachments.length > 0) {
        const boundary = 'foo_bar_baz_boundary_12345';
        const messageParts = [
          ...commonHeaders,
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/html; charset=utf-8',
          '',
          input.body,
          ''
        ];

        for (const att of input.attachments) {
          let base64Content = att.content;
          if (att.filePath) {
            const fs = require('fs');
            base64Content = fs.readFileSync(att.filePath).toString('base64');
          }
          messageParts.push(`--${boundary}`);
          messageParts.push(`Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${att.filename}"`);
          messageParts.push(`Content-Disposition: attachment; filename="${att.filename}"`);
          messageParts.push('Content-Transfer-Encoding: base64');
          messageParts.push('');
          messageParts.push(base64Content);
          messageParts.push('');
        }
        messageParts.push(`--${boundary}--`);

        rawMessage = Buffer.from(messageParts.join('\r\n'))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      } else {
        const messageParts = [
          ...commonHeaders,
          'Content-Type: text/html; charset=utf-8',
          '',
          input.body
        ];

        rawMessage = Buffer.from(messageParts.join('\r\n'))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      }

      const requestBody: any = { raw: rawMessage };
      if (input.threadId) {
          requestBody.threadId = input.threadId;
      }

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody
      });

      return {
        id: response.data.id,
        status: 'sent'
      };
    }
  },
  {
    id: 'search_emails',
    name: 'Search Emails',
    description: 'Search emails by query',
    isWrite: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        maxResults: { type: 'number' }
      },
      required: ['query']
    },
    outputSchema: {
      type: 'object',
      properties: {
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              threadId: { type: 'string' }
            }
          }
        }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const gmail = google.gmail({ version: 'v1', auth });

      const response = await gmail.users.messages.list({
        userId: 'me',
        q: input.query,
        maxResults: input.maxResults || 10
      });

      return {
        messages: response.data.messages || []
      };
    }
  },
  {
    id: 'reply_email',
    name: 'Reply to Email',
    description: 'Reply to an existing email thread',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        messageId: { type: 'string' }, // The message to reply to
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['threadId', 'messageId', 'to', 'subject', 'body']
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const auth = getOAuthClient(context.accessToken);
      const gmail = google.gmail({ version: 'v1', auth });

      const utf8Subject = `=?utf-8?B?${Buffer.from(input.subject).toString('base64')}?=`;
      const messageParts = [
        `To: ${input.to}`,
        `Subject: ${utf8Subject}`,
        `In-Reply-To: ${input.messageId}`,
        `References: ${input.messageId}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        input.body
      ];

      const rawMessage = Buffer.from(messageParts.join('\n'))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: rawMessage,
          threadId: input.threadId
        }
      });

      return {
        id: response.data.id,
        status: 'replied'
      };
    }
  }
];

export const gmailTriggers: ConnectorTrigger[] = [
  {
    id: 'email_received',
    name: 'New Email Received',
    eventSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        historyId: { type: 'string' }
      }
    }
  }
];
