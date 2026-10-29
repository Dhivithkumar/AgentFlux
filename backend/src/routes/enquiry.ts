import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { enquiryIntakeService } from '../services/enquiry/EnquiryIntakeService';
import { prisma } from '@agent-flux/database';

const router = Router();

// Endpoint to submit an enquiry
router.post('/', authenticate, requireBusinessMembership, async (req: any, res: any) => {
  try {
    const { businessId, source, customer, message, externalId } = req.body;

    // Validate request
    if (!businessId || !source || !customer || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Force override businessId from authenticated context (requireBusinessMembership ensures req.user has access to req.body.businessId or req.query.businessId)
    // The middleware already verifies the mapping.

    const enquiry = await enquiryIntakeService.submitEnquiry({
      businessId,
      source,
      customer,
      message,
      externalId
    });

    res.status(201).json(enquiry);
  } catch (error: any) {
    console.error('Error submitting enquiry:', error);
    res.status(500).json({ error: 'Failed to process enquiry', details: error.message });
  }
});

// Endpoint to list enquiries for a business
router.get('/', authenticate, requireBusinessMembership, async (req: any, res: any) => {
  try {
    // Check if businessId is in query
    const businessId = req.query.businessId as string;
    if (!businessId) {
      return res.status(400).json({ error: 'businessId query parameter is required' });
    }

    const enquiries = await prisma.enquiry.findMany({
      where: { businessId },
      include: {
        customer: {
          select: { name: true, email: true, phone: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(enquiries);
  } catch (error: any) {
    console.error('Error listing enquiries:', error);
    res.status(500).json({ error: 'Failed to list enquiries' });
  }
});

// Endpoint to get a specific enquiry details
router.get('/:id', authenticate, async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const enquiry = await prisma.enquiry.findUnique({
      where: { id },
      include: {
        customer: true,
        business: true
      }
    });

    if (!enquiry) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    // Security check: verify user has access to this business
    const membership = await prisma.membership.findUnique({
      where: {
        userId_businessId: {
          userId: req.user.id,
          businessId: enquiry.businessId
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(enquiry);
  } catch (error: any) {
    console.error('Error getting enquiry:', error);
    res.status(500).json({ error: 'Failed to get enquiry' });
  }
});

// Endpoint to update an enquiry (e.g. manual correction)
router.patch('/:id', authenticate, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { structuredData, status, nextAction } = req.body;

    const existingEnquiry = await prisma.enquiry.findUnique({
      where: { id }
    });

    if (!existingEnquiry) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    // Security check
    const membership = await prisma.membership.findUnique({
      where: {
        userId_businessId: {
          userId: req.user.id,
          businessId: existingEnquiry.businessId
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = await prisma.enquiry.update({
      where: { id },
      data: {
        ...(structuredData && { structuredData }),
        ...(status && { status }),
        ...(nextAction && { nextAction })
      }
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating enquiry:', error);
    res.status(500).json({ error: 'Failed to update enquiry' });
  }
});

// Endpoint to convert an enquiry to an order (Phase 4)
router.post('/:id/convert-to-order', authenticate, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    
    const enquiry = await prisma.enquiry.findUnique({ where: { id } });
    if (!enquiry) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    // Security check: verify user has access to this business
    const membership = await prisma.membership.findUnique({
      where: {
        userId_businessId: {
          userId: req.user.id,
          businessId: enquiry.businessId
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Lazy load order service to avoid circular dependencies if any
    const { orderService } = await import('../services/order/OrderService');
    const order = await orderService.convertEnquiryToOrder(enquiry.businessId, id, req.user.id);

    res.json(order);
  } catch (error: any) {
    console.error('Error converting enquiry to order:', error);
    res.status(500).json({ error: error.message || 'Failed to convert enquiry' });
  }
});

export default router;
