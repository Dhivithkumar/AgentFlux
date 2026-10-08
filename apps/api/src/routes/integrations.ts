import { Router, Request, Response } from 'express';
import { IntegrationStatus } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';
import { getAllConnectors, getConnectorDefinition, getConnectorProvider } from '../connectors/registry';
import { encrypt, decrypt } from '../services/encryption';
import crypto from 'crypto';

const router = Router();


// In-memory state store for OAuth (In production, use Redis or DB to prevent memory leaks)
// Stores: state -> { userId, businessId, provider, scopes }
const oauthStates = new Map<string, any>();

// Get all available connector definitions
router.get('/registry', authenticate, (req: Request, res: Response) => {
  res.json({ success: true, data: getAllConnectors() });
});

// Get analytics for integrations
router.get('/analytics', authenticate, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.query;
    const user = (req as any).user;

    if (!businessId || typeof businessId !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing businessId' });
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Persisted telemetry
    const totalIntegrations = await prisma.integration.count({ where: { businessId } });
    const activeIntegrations = await prisma.integration.count({ where: { businessId, status: 'CONNECTED' } });
    const failedIntegrations = await prisma.integration.count({ where: { businessId, status: 'ERROR' } });
    
    // We can infer some execution telemetry for now based on executions
    const totalExecutions = await prisma.workflowExecution.count({ where: { businessId } });
    const failedExecutions = await prisma.workflowExecution.count({ where: { businessId, status: 'FAILED' } });

    res.json({
      success: true,
      data: {
        totalIntegrations,
        activeIntegrations,
        failedIntegrations,
        totalExecutions,
        failedExecutions,
        successRate: totalExecutions > 0 ? ((totalExecutions - failedExecutions) / totalExecutions) * 100 : 100
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

// Get all connected integrations for a business
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.query;
    const user = (req as any).user;

    if (!businessId || typeof businessId !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing businessId' });
    }

    // Validate business membership
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const integrations = await prisma.integration.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: integrations });
  } catch (error: any) {
    console.error('Fetch Integrations Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch integrations' });
  }
});

// Start OAuth flow
router.get('/:provider/connect', authenticate, async (req: Request, res: Response) => {
  const { provider } = req.params;
  const { businessId } = req.query;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, businessId }
  });

  if (!membership) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  try {
    const def = getConnectorDefinition(provider);
    const providerImpl = getConnectorProvider(provider);
    
    // Generate secure state
    const state = crypto.randomBytes(32).toString('hex');
    const stateHash = crypto.createHash('sha256').update(state).digest('hex');
    
    // Store context in DB
    await prisma.oAuthState.create({
      data: {
        userId: user.id,
        businessId,
        provider,
        scopes: def.defaultScopes,
        stateHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 mins
      }
    });

    const authUrl = providerImpl.getAuthorizationUrl(state, def.defaultScopes);
    
    res.json({ success: true, data: { url: authUrl } });
  } catch (error: any) {
    console.error('Connect Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// OAuth Callback
// Note: This endpoint is usually hit by the browser redirect directly or the frontend can proxy it.
// We'll design it to be called by the frontend which receives the code and state.
// OAuth Callback (Direct from Google)
router.get('/:provider/callback', async (req: Request, res: Response) => {
  const provider = req.params.provider;
  const code = req.query.code as string;
  const state = req.query.state as string;
  const error = req.query.error as string;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error) {
    return res.redirect(frontendUrl + '/dashboard/integrations?error=' + encodeURIComponent(error));
  }

  if (!code || !state) {
    return res.redirect(frontendUrl + '/dashboard/integrations?error=missing_params');
  }

  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  const context = await prisma.oAuthState.findUnique({
    where: { stateHash }
  });

  if (!context || context.expiresAt < new Date()) {
    return res.redirect(frontendUrl + '/dashboard/integrations?error=invalid_state');
  }

  // Clear state to prevent reuse
  await prisma.oAuthState.delete({ where: { id: context.id } });

  try {
    const providerImpl = getConnectorProvider(context.provider);
    const tokens = await providerImpl.handleOAuthCallback(code);
    
    const accountInfo = await providerImpl.getAccountInfo(tokens.accessToken);

    // Create or Update Integration
    const integration = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.integration.findUnique({
        where: {
          businessId_provider_accountId: {
            businessId: context.businessId,
            provider: context.provider,
            accountId: accountInfo.accountId
          }
        }
      });

      let intId = '';

      if (existing) {
        intId = existing.id;
        await tx.integration.update({
          where: { id: existing.id },
          data: {
            accountEmail: accountInfo.accountEmail,
            displayName: accountInfo.displayName,
            status: IntegrationStatus.CONNECTED,
            scopes: context.scopes,
            metadata: accountInfo.metadata,
            lastConnectedAt: new Date(),
            lastVerifiedAt: new Date()
          }
        });

        await tx.integrationCredential.upsert({
          where: { integrationId: existing.id },
          create: {
            integrationId: existing.id,
            accessTokenEncrypted: encrypt(tokens.accessToken),
            refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : undefined,
            expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
            tokenType: tokens.tokenType || 'Bearer'
          },
          update: {
            accessTokenEncrypted: encrypt(tokens.accessToken),
            refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : undefined,
            expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
            tokenType: tokens.tokenType
          }
        });
      } else {
        // Create new
        const newInt = await tx.integration.create({
          data: {
            businessId: context.businessId,
            provider: context.provider,
            accountId: accountInfo.accountId,
            accountEmail: accountInfo.accountEmail,
            displayName: accountInfo.displayName,
            status: IntegrationStatus.CONNECTED,
            scopes: context.scopes,
            metadata: accountInfo.metadata,
            lastConnectedAt: new Date(),
            lastVerifiedAt: new Date(),
            credential: {
              create: {
                accessTokenEncrypted: encrypt(tokens.accessToken),
                refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
                expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
                tokenType: tokens.tokenType
              }
            }
          }
        });
        intId = newInt.id;
      }

      await tx.auditLog.create({
        data: {
          businessId: context.businessId,
          userId: context.userId,
          integrationId: intId,
          eventType: existing ? 'CONNECTOR_RECONNECTED' : 'CONNECTOR_CONNECTED'
        }
      });

      return tx.integration.findUnique({ where: { id: intId } });
    }, { timeout: 15000 });

    return res.redirect(frontendUrl + '/dashboard/integrations?connected=' + encodeURIComponent(provider.toLowerCase()));
  } catch (err: any) {
    console.error('Callback Error:', err);
    return res.redirect(frontendUrl + '/dashboard/integrations?error=gmail_connection_failed');
  }
});

// Verify connection


router.post('/:integrationId/verify', authenticate, async (req: Request, res: Response) => {
  const { integrationId } = req.params;
  const user = (req as any).user;

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    include: { business: { include: { memberships: true } }, credential: true }
  });

  if (!integration) {
    return res.status(404).json({ success: false, error: 'Integration not found' });
  }

  const isMember = integration.business.memberships.some((m: any) => m.userId === user.id);
  if (!isMember) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  if (!integration.credential) {
    return res.status(400).json({ success: false, error: 'No credentials found' });
  }

  try {
    const providerImpl = getConnectorProvider(integration.provider);
    const accessToken = decrypt(integration.credential.accessTokenEncrypted);
    
    // We should implement automatic token refresh here if it's expired before verifying
    // But for verification purposes, we'll try it directly. If it fails, we mark RECONNECT_REQUIRED.
    const isValid = await providerImpl.verifyConnection(accessToken);

    if (isValid) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: { 
          status: IntegrationStatus.CONNECTED,
          lastVerifiedAt: new Date()
        }
      });
      res.json({ success: true, data: { status: IntegrationStatus.CONNECTED } });
    } else {
      await prisma.integration.update({
        where: { id: integration.id },
        data: { status: IntegrationStatus.RECONNECT_REQUIRED }
      });
      res.json({ success: true, data: { status: IntegrationStatus.RECONNECT_REQUIRED } });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// Disconnect
router.post('/:integrationId/disconnect', authenticate, async (req: Request, res: Response) => {
  const { integrationId } = req.params;
  const user = (req as any).user;

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    include: { business: { include: { memberships: true } }, credential: true }
  });

  if (!integration) {
    return res.status(404).json({ success: false, error: 'Integration not found' });
  }

  const isMember = integration.business.memberships.some((m: any) => m.userId === user.id);
  if (!isMember) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  try {
    if (integration.credential) {
      const providerImpl = getConnectorProvider(integration.provider);
      const accessToken = decrypt(integration.credential.accessTokenEncrypted);
      
      // Try to revoke the token at the provider
      await providerImpl.disconnect(accessToken);
    }

    // Mark as disconnected and delete credentials
    await prisma.$transaction(async (tx: any) => {
      await tx.integration.update({
        where: { id: integration.id },
        data: { status: IntegrationStatus.DISCONNECTED }
      });

      if (integration.credential) {
        await tx.integrationCredential.delete({
          where: { integrationId: integration.id }
        });
      }

      await tx.auditLog.create({
        data: {
          businessId: integration.businessId,
          userId: user.id,
          integrationId: integration.id,
          eventType: 'CONNECTOR_DISCONNECTED'
        }
      });
    });

    res.json({ success: true, data: { status: IntegrationStatus.DISCONNECTED } });
  } catch (error: any) {
    console.error('Disconnect Error:', error);
    res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});


// GET /api/integrations/google-calendar/calendars
router.get('/google-calendar/calendars', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const user = (req as any).user;

  console.log('==> CALENDAR FETCH:', businessId, user.id);
  try {
    if (!businessId || typeof businessId !== 'string') {
      return res.status(400).json({ success: false, error: 'businessId is required' });
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const integration = await prisma.integration.findFirst({
      where: { businessId: businessId as string, provider: 'GOOGLE_CALENDAR', status: 'CONNECTED' },
      include: { credential: true }
    });

    if (!integration || !integration.credential) {
      return res.status(404).json({ success: false, error: 'Google Calendar integration not found or missing credentials' });
    }

    let accessToken = decrypt(integration.credential.accessTokenEncrypted);
    
    // Auto-refresh token if expired or expiring in next 5 mins
    if (integration.credential.expiresAt && new Date(integration.credential.expiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
      if (integration.credential.refreshTokenEncrypted) {
        const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
        const providerImpl = getConnectorProvider(integration.provider);
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
          console.log('Successfully refreshed Google Calendar access token');
        } catch (refreshErr) {
          console.error("Token refresh failed:", refreshErr);
        }
      }
    }
    
    // Call Google Calendar API to list calendars
    const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: 'Failed to fetch calendars from Google' });
    }

    const data = await response.json();
    const calendars = data.items.map((item: any) => ({
      id: item.id,
      name: item.summary,
      primary: item.primary || false
    }));

    res.json({ success: true, data: calendars });
  } catch (err: any) {
    console.error('Fetch Calendars Error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch calendars' });
  }
});


// GET /api/integrations/google-calendar/events
router.get('/google-calendar/events', authenticate, async (req: Request, res: Response) => {
  const { businessId, calendarId, timeMin, timeMax } = req.query;
  const user = (req as any).user;

  try {
    if (!businessId || typeof businessId !== 'string') {
      return res.status(400).json({ success: false, error: 'businessId is required' });
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const integration = await prisma.integration.findFirst({
      where: { businessId: businessId as string, provider: 'GOOGLE_CALENDAR', status: 'CONNECTED' },
      include: { credential: true }
    });

    if (!integration || !integration.credential) {
      return res.status(404).json({ success: false, error: 'Google Calendar integration not found or missing credentials' });
    }

    let accessToken = decrypt(integration.credential.accessTokenEncrypted);
    
    // Auto-refresh token if expired or expiring in next 5 mins
    if (integration.credential.expiresAt && new Date(integration.credential.expiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
      if (integration.credential.refreshTokenEncrypted) {
        const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
        const providerImpl = getConnectorProvider(integration.provider);
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
        } catch (refreshErr) {
          console.error("Token refresh failed:", refreshErr);
        }
      }
    }
    
    const query = new URLSearchParams();
    if (timeMin) query.append('timeMin', timeMin as string);
    if (timeMax) query.append('timeMax', timeMax as string);
    query.append('singleEvents', 'true');
    query.append('orderBy', 'startTime');

    const calId = calendarId || 'primary';
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId as string)}/events?${query.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
       const text = await response.text();
       return res.status(response.status).json({ success: false, error: 'Failed to fetch events from Google', details: text });
    }

    const data = await response.json();
    res.json({ success: true, data: data.items });
  } catch (err: any) {
    console.error('Fetch Events Error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch events' });
  }
});


// POST /api/integrations/google-calendar/events
router.post('/google-calendar/events', authenticate, async (req: Request, res: Response) => {
  const { businessId, calendarId, summary, description, start, end, colorId } = req.body;
  const user = (req as any).user;

  try {
    if (!businessId || typeof businessId !== 'string') {
      return res.status(400).json({ success: false, error: 'businessId is required' });
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const integration = await prisma.integration.findFirst({
      where: { businessId: businessId as string, provider: 'GOOGLE_CALENDAR', status: 'CONNECTED' },
      include: { credential: true }
    });

    if (!integration || !integration.credential) {
      return res.status(404).json({ success: false, error: 'Google Calendar integration not found or missing credentials' });
    }

    let accessToken = decrypt(integration.credential.accessTokenEncrypted);
    
    // Auto-refresh token if expired or expiring in next 5 mins
    if (integration.credential.expiresAt && new Date(integration.credential.expiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
      if (integration.credential.refreshTokenEncrypted) {
        const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
        const providerImpl = getConnectorProvider(integration.provider);
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
        } catch (refreshErr) {
          console.error("Token refresh failed:", refreshErr);
        }
      }
    }

    // Auto-assign color if it's an Agent Flux appointment (colorId 2 = Green)
    let finalColorId = colorId;
    if (!finalColorId && summary && summary.toLowerCase().includes('agent flux')) {
      finalColorId = "2";
    }

    const calId = calendarId || 'primary';
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId as string)}/events`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary,
        description,
        start,
        end,
        ...(finalColorId ? { colorId: finalColorId } : {})
      })
    });

    if (!response.ok) {
       const text = await response.text();
       return res.status(response.status).json({ success: false, error: 'Failed to create event', details: text });
    }

    const data = await response.json();
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('Create Event Error:', err);
    res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

export default router;

