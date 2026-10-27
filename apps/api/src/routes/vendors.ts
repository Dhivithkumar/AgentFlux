import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { prisma } from '@agent-flux/database';
import { vendorVerificationService } from '../services/vendor/VendorVerificationService';
import { enqueueVendorVerification } from '../services/queue/vendorQueue';

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use(requireBusinessMembership);

/**
 * GET /api/businesses/:businessId/vendors
 */
router.get('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const { status, verificationStatus, search } = req.query;

    const where: any = { businessId };
    if (status) where.status = status;
    if (verificationStatus) where.verificationStatus = verificationStatus;

    if (search) {
      const q = String(search).trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { legalName: { contains: q, mode: 'insensitive' } },
        { taxId: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } }
      ];
    }

    const vendors = await prisma.vendor.findMany({
      where,
      include: {
        _count: {
          select: { orders: true, verificationLogs: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: vendors });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/businesses/:businessId/vendors
 */
router.post('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const {
      name,
      legalName,
      taxId,
      registrationNumber,
      email,
      website,
      phone,
      address,
      category,
      autoVerify
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Vendor name is required' });
    }

    const vendor = await prisma.vendor.create({
      data: {
        businessId,
        name: name.trim(),
        legalName: legalName?.trim() || null,
        taxId: taxId?.trim() || null,
        registrationNumber: registrationNumber?.trim() || null,
        email: email?.trim() || null,
        website: website?.trim() || null,
        phone: phone?.trim() || null,
        address: address || null,
        category: category || 'SUPPLIER',
        verificationStatus: 'PENDING_VERIFICATION'
      }
    });

    // Optionally auto-enqueue verification immediately
    if (autoVerify) {
      await enqueueVendorVerification(businessId, vendor.id, req.user?.id);
    }

    res.status(201).json({ success: true, data: vendor });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/businesses/:businessId/vendors/:id
 */
router.get('/:id', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const vendor = await prisma.vendor.findUnique({
      where: { id, businessId },
      include: {
        verificationLogs: {
          include: { performedBy: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20
        },
        orders: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, orderNumber: true, totalAmount: true, status: true, priority: true }
        }
      }
    });

    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }

    res.json({ success: true, data: vendor });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/businesses/:businessId/vendors/:id/verify
 */
router.post('/:id/verify', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const userId = req.user?.id;
    const asyncQueue = req.query.async === 'true';

    if (asyncQueue) {
      const queued = await enqueueVendorVerification(businessId, id, userId);
      return res.json({ success: true, queued: true, jobId: queued.jobId });
    }

    // Direct synchronous verification for instant UI feedback
    const report = await vendorVerificationService.verifyVendor(businessId, id, userId);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/businesses/:businessId/vendors/:id/manual-review
 */
router.post('/:id/manual-review', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const userId = req.user?.id;
    const { status, reason, notes, documentReferences } = req.body;

    if (!status || !reason) {
      return res.status(400).json({ success: false, error: 'Status and reason are required for manual review.' });
    }

    const updated = await vendorVerificationService.manualReviewVendor(
      businessId,
      id,
      { status, reason, notes, documentReferences },
      userId
    );

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/businesses/:businessId/vendors/:id/logs
 */
router.get('/:id/logs', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const logs = await prisma.vendorVerificationLog.findMany({
      where: { vendorId: id, businessId },
      include: { performedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
