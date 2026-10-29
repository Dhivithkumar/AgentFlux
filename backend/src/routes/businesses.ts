import { Router } from 'express';
import { PrismaClient, Role, prisma } from '@agent-flux/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();


router.use(authenticate);

router.get('/', async (req: AuthRequest, res) => {
  try {
    const memberships = await prisma.membership.findMany({
      where: { userId: req.user!.id },
      include: { business: true }
    });
    
    const businesses = memberships.map((m: any) => m.business);
    res.json({ success: true, data: businesses });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const { name, industry, website, description } = req.body;
    
    if (!name || !industry) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing fields' } });
    }

    const business = await prisma.business.create({
      data: {
        name,
        industry,
        website,
        description,
        memberships: {
          create: {
            userId: req.user!.id,
            role: Role.OWNER
          }
        }
      }
    });

    res.json({ success: true, data: business });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
});

import { BusinessProfileService } from '../services/business/profileService';

router.get('/profile', async (req: AuthRequest, res) => {
  try {
    const businessId = (req.query.businessId as string) || (req.headers['x-business-id'] as string);
    if (!businessId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing businessId' } });
    }
    
    const membership = await prisma.membership.findUnique({
      where: {
        userId_businessId: {
          userId: req.user!.id,
          businessId
        }
      },
      include: { business: true }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    const profile = BusinessProfileService.flattenProfile(membership.business, true);
    const readiness = BusinessProfileService.calculateReadiness(profile);

    res.json({ success: true, data: profile, readiness });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message || 'Internal server error' } });
  }
});

router.patch('/profile', async (req: AuthRequest, res) => {
  try {
    const businessId = (req.query.businessId as string) || (req.body.businessId as string) || (req.headers['x-business-id'] as string);
    if (!businessId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing businessId' } });
    }
    
    const membership = await prisma.membership.findUnique({
      where: {
        userId_businessId: {
          userId: req.user!.id,
          businessId
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    const updatedProfile = await BusinessProfileService.updateProfile(businessId, req.body);
    const readiness = BusinessProfileService.calculateReadiness(updatedProfile);

    res.json({ success: true, data: updatedProfile, readiness });
  } catch (error: any) {
    console.error('Error updating profile:', error);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message || 'Internal server error' } });
  }
});

router.get('/:businessId', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    
    const membership = await prisma.membership.findUnique({
      where: {
        userId_businessId: {
          userId: req.user!.id,
          businessId
        }
      },
      include: { business: true }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    res.json({ success: true, data: membership.business });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
});

router.get('/:businessId/metrics', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    
    // Verify membership
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId: req.user!.id, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    // Calculate metrics
    const automations = await prisma.workflow.count({
      where: { businessId, status: 'ACTIVE' }
    });
    
    const tasksToday = await prisma.workflowExecution.count({
      where: {
        businessId,
        startedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      }
    });

    const failedTasks = await prisma.workflowExecution.count({
      where: {
        businessId,
        status: 'FAILED',
        startedAt: { gte: new Date(new Date().setDate(new Date().getDate() - 7)) } // Last 7 days
      }
    });

    // We'll mock "Time Saved" as tasksToday * 15 minutes
    const timeSavedHours = (tasksToday * 15) / 60;

    res.json({
      success: true,
      data: {
        automations,
        tasksToday,
        failedTasks,
        timeSavedHours: timeSavedHours.toFixed(1)
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
});

import { BusinessConfigurationService } from '../services/business/configurationService';

// GET /:businessId/configuration
router.get('/:businessId/configuration', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId: req.user!.id, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    const config = await BusinessConfigurationService.getConfiguration(businessId);
    res.json({ success: true, data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message || 'Internal server error' } });
  }
});

// PATCH /:businessId/configuration
router.patch('/:businessId/configuration', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId: req.user!.id, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    const updated = await BusinessConfigurationService.updateConfiguration(businessId, req.body);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message || 'Internal server error' } });
  }
});

// POST /:businessId/configuration/review
router.post('/:businessId/configuration/review', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId: req.user!.id, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    const review = await BusinessConfigurationService.reviewConfiguration(businessId);
    res.json({ success: true, data: review });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message || 'Internal server error' } });
  }
});

// POST /:businessId/configuration/confirm
router.post('/:businessId/configuration/confirm', async (req: AuthRequest, res) => {
  try {
    const { businessId } = req.params;
    const confirmed = await BusinessConfigurationService.confirmConfiguration(businessId, req.user!.id);
    res.json({ success: true, data: confirmed });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CONFIRMATION_FAILED', message: error.message || 'Failed to confirm configuration' } });
  }
});

export default router;

