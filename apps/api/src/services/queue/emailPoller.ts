import { prisma, WorkflowStatus } from '@agent-flux/database';
import { WorkflowEngine } from '../workflow/engine';
import { getConnectorProvider } from '../../connectors/registry';
import { encrypt, decrypt } from '../encryption';

// Very basic poller loop
export class EmailPoller {
  private isRunning = false;
  private intervalId: any = null;

  start(intervalMs = 60000) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`Starting Email Poller (interval: ${intervalMs}ms)`);
    this.intervalId = setInterval(() => this.poll(), intervalMs);
    // run immediately
    this.poll();
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async poll() {
    try {
      // 1. Get all active workflows
      const workflows = await prisma.workflow.findMany({
        where: { status: WorkflowStatus.ACTIVE },
        include: { versions: true }
      });

      for (const workflow of workflows) {
        if (!workflow.activeVersionId) continue;
        const version = workflow.versions.find((v: any) => v.id === workflow.activeVersionId);
        if (!version) continue;

        const trigger = version.trigger as any;
        if (trigger?.type !== 'EMAIL_RECEIVED' && trigger?.type !== 'gmail.email.received') continue;

        await this.processWorkflowEmails(workflow, trigger);
      }
    } catch (e) {
      console.error('Error in EmailPoller loop:', e);
    }
  }

  private async processWorkflowEmails(workflow: any, trigger: any) {
    try {
      // Find GMAIL integration for this business
      const integration = await prisma.integration.findFirst({
        where: { businessId: workflow.businessId, provider: 'GMAIL', status: 'CONNECTED' },
        include: { credential: true }
      });

      if (!integration || !integration.credential) return; // No integration found

      // Auto-refresh token if needed
      let accessToken = decrypt(integration.credential.accessTokenEncrypted);
      if (integration.credential.expiresAt && new Date(integration.credential.expiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
        if (integration.credential.refreshTokenEncrypted) {
          const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
          const providerImpl = getConnectorProvider('GMAIL');
          try {
            const newTokens = await providerImpl.refreshAccessToken(refreshToken);
            accessToken = newTokens.accessToken;
            await prisma.integrationCredential.update({
              where: { integrationId: integration.id },
              data: {
                accessTokenEncrypted: encrypt(newTokens.accessToken),
                expiresAt: newTokens.expiresIn ? new Date(Date.now() + newTokens.expiresIn * 1000) : null,
                ...(newTokens.refreshToken ? { refreshTokenEncrypted: encrypt(newTokens.refreshToken) } : {})
              }
            });
            console.log('Successfully refreshed GMAIL access token for background poller');
          } catch (refreshErr: any) {
            console.error("GMAIL Token refresh failed:", refreshErr);
            
            // If the grant is completely invalid/revoked, stop polling it
            if (refreshErr.message === 'invalid_grant' || refreshErr?.response?.data?.error === 'invalid_grant') {
              await prisma.integration.update({
                where: { id: integration.id },
                data: { status: 'RECONNECT_REQUIRED' }
              });
              console.log(`Integration ${integration.id} marked as RECONNECT_REQUIRED due to invalid_grant.`);
            }
            
            return; // Can't proceed if token is expired and refresh fails
          }
        } else {
           return; // Expired and no refresh token
        }
      }

      // Fetch unread emails from the last 24 hours
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread newer_than:1d', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        console.error('Failed to fetch emails:', await response.text());
        return;
      }

      const data = await response.json();
      const messages = data.messages || [];

      if (messages.length > 0) {
        console.log(`Found ${messages.length} unread emails for workflow ${workflow.id}`);
      }

      for (const msg of messages) {
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();
        
        // Parse email payload
        const headers = msgData.payload.headers;
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
        const from = headers.find((h: any) => h.name === 'From')?.value || '';
        const to = headers.find((h: any) => h.name === 'To')?.value || '';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';
        
        let body = this.parseEmailBody(msgData.payload);

        const payload = {
            email: {
                id: msg.id,
                threadId: msgData.threadId,
                subject,
                from,
                to,
                date,
                body,
                raw: msgData
            }
        };

        // Trigger workflow
        console.log(`EmailPoller: Triggering workflow ${workflow.id} for email ${msg.id} (Subject: ${subject})`);
        
        // Pass msg.id as idempotencyKey so we don't process same email twice if mark-as-read fails
        // Replace legacy generic workflow with canonical ConversationOrchestrator
        let success = false;
        try {
          const { ConversationOrchestrator } = require('../intake/ConversationOrchestrator');
          await ConversationOrchestrator.processIncomingMessage(
              workflow.businessId,
              payload.email,
              integration.id
          );
          success = true;
        } catch (execErr: any) {
          console.error(`Workflow execution failed for ${workflow.id}:`, execErr);
        }

        if (success) {
            // Mark as read so we don't fetch it again
            const markAsReadRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`, {
                method: 'POST',
                headers: { 
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    removeLabelIds: ['UNREAD']
                })
            });
            
            if (!markAsReadRes.ok) {
                console.error(`Failed to mark email ${msg.id} as read:`, await markAsReadRes.text());
            } else {
                console.log(`EmailPoller: Successfully marked email ${msg.id} as read.`);
            }
        } else {
            console.log(`EmailPoller: Skipping mark-as-read for email ${msg.id} due to execution failure.`);
        }
      }

    } catch (e) {
      console.error(`Error processing emails for workflow ${workflow.id}:`, e);
    }
  }
  private parseEmailBody(payload: any): string {
    let body = '';
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    } else if (payload.mimeType === 'text/html' && payload.body?.data && !body) {
      body = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    } else if (payload.parts && payload.parts.length > 0) {
      const plainTextPart = this.findMimePart(payload.parts, 'text/plain');
      if (plainTextPart && plainTextPart.body?.data) {
        body = Buffer.from(plainTextPart.body.data, 'base64url').toString('utf-8');
      } else {
        const htmlPart = this.findMimePart(payload.parts, 'text/html');
        if (htmlPart && htmlPart.body?.data) {
          body = Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8');
        }
      }
    } else if (payload.body?.data) {
       body = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    }
    return body;
  }

  private findMimePart(parts: any[], mimeType: string): any {
    for (const part of parts) {
      if (part.mimeType === mimeType) {
        return part;
      }
      if (part.parts && part.parts.length > 0) {
        const found = this.findMimePart(part.parts, mimeType);
        if (found) return found;
      }
    }
    return null;
  }
}

// Export singleton instance
export const emailPoller = new EmailPoller();
