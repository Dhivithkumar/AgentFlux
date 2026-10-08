import { IntegrationStatus } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { getConnectorDefinition, getConnectorProvider } from '../../connectors/registry';
import { ConnectorExecutionContext } from '../../connectors/types';
import { decrypt } from '../encryption';



export class ActionExecutor {
  static async execute(
    businessId: string,
    workflowId: string,
    executionId: string,
    connectorId: string,
    actionId: string,
    inputData: any,
    isSimulation: boolean = false
  ) {
    // 1. Find connector definition and action
    const definition = getConnectorDefinition(connectorId);
    const action = definition.actions.find(a => a.id === actionId);
    
    if (!action) {
      throw new Error(`Action '${actionId}' not found on connector '${connectorId}'.`);
    }

    if (isSimulation && action.isWrite) {
      console.log(`[SIMULATION] Skipping write action ${actionId} on ${connectorId}`);
      return { _simulated: true, status: 'Simulated success' };
    }

    // 2. Find Business Integration
    const integration = await prisma.integration.findFirst({
      where: {
        businessId,
        provider: connectorId,
        status: IntegrationStatus.CONNECTED
      },
      include: { credential: true }
    });

    if (!integration || !integration.credential) {
      throw new Error(`Integration '${connectorId}' is missing, not connected, or lacks credentials for this business.`);
    }

    const providerImpl = getConnectorProvider(connectorId);

    // 3. Check token expiration & refresh if needed
    let accessToken = decrypt(integration.credential.accessTokenEncrypted);
    
    if (integration.credential.expiresAt && new Date() >= integration.credential.expiresAt) {
      if (!integration.credential.refreshTokenEncrypted) {
        // Mark as reconnect required
        await prisma.integration.update({
          where: { id: integration.id },
          data: { status: IntegrationStatus.RECONNECT_REQUIRED }
        });
        throw new Error(`Integration '${connectorId}' token expired and no refresh token available. Reconnection required.`);
      }

      try {
        const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
        const newTokens = await providerImpl.refreshAccessToken(refreshToken);
        
        accessToken = newTokens.accessToken;

        // Save new tokens
        await prisma.integrationCredential.update({
          where: { id: integration.credential.id },
          data: {
            accessTokenEncrypted: encrypt(newTokens.accessToken),
            refreshTokenEncrypted: newTokens.refreshToken ? encrypt(newTokens.refreshToken) : undefined,
            expiresAt: newTokens.expiresIn ? new Date(Date.now() + newTokens.expiresIn * 1000) : null
          }
        });
      } catch (err) {
        await prisma.integration.update({
          where: { id: integration.id },
          data: { status: IntegrationStatus.RECONNECT_REQUIRED }
        });
        throw new Error(`Failed to refresh token for '${connectorId}'. Reconnection required. Error: ${err}`);
      }
    }

    // 4. Build execution context
    const context: ConnectorExecutionContext = {
      businessId,
      workflowId,
      executionId,
      accessToken
    };

    // 5. Execute actual API request
    try {
      const result = await action.execute(context, inputData);
      return result;
    } catch (err: any) {
      // 6. Handle specific errors (e.g. 401s that weren't caught by the expiration check)
      if (err.response?.status === 401 || err.code === 401 || err.message?.includes('unauthorized')) {
        await prisma.integration.update({
          where: { id: integration.id },
          data: { status: IntegrationStatus.RECONNECT_REQUIRED }
        });
      }
      throw err;
    }
  }
}

// Ensure encrypt is available locally for the refresh token saving
import crypto from 'crypto';
const ENCRYPTION_KEY = process.env.CONNECTOR_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
const ALGORITHM = 'aes-256-gcm';

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY, 'base64');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}
