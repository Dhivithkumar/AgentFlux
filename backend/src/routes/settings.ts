// @ts-nocheck
import { Router, Request, Response } from 'express';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/settings
router.get('/', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  if (!businessId) {
    return res.status(400).json({ success: false, error: 'businessId is required' });
  }

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId: req.user!.id, businessId: String(businessId) } },
      include: { business: true }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    // For now, settings is just the business profile and some defaults
    const settings = {
      business: membership.business,
      role: membership.role,
      notifications: {
        emailAlerts: true,
        workflowFailures: true,
        approvalRequests: true
      },
      security: {
        mfaEnabled: false
      }
    };

    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

// PATCH /api/settings
router.patch('/', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const updates = req.body;
  
  if (!businessId) {
    return res.status(400).json({ success: false, error: 'businessId is required' });
  }

  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId: req.user!.id, businessId: String(businessId) } }
    });

    if (!membership || membership.role !== 'OWNER') {
      return res.status(403).json({ success: false, error: 'Forbidden. Only owners can update settings.' });
    }

    if (updates.business) {
      await prisma.business.update({
        where: { id: String(businessId) },
        data: {
          name: updates.business.name,
          industry: updates.business.industry,
          website: updates.business.website,
          description: updates.business.description
        }
      });
    }

    // Other settings (like notifications) would be saved to a Settings model here

    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

export default router;
