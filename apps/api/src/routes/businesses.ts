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

router.get('/profile', async (req: AuthRequest, res) => {
  try {
    const businessId = req.query.businessId as string;
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

    res.json({ success: true, data: membership.business });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
});

router.patch('/profile', async (req: AuthRequest, res) => {
  try {
    const businessId = req.query.businessId as string || req.body.businessId as string;
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
    
    const { 
      name, industry, businessType, country, timezone, currency, website, description, contactInfo, operatingHours, preferences,
      legalBusinessName, displayName, email, phone, alternatePhone, supportEmail,
      addressLine1, addressLine2, city, state, postalCode,
      taxRegistrationStatus, gstin, pan, defaultTaxRate,
      invoicePrefix, quotationPrefix, orderPrefix, defaultPaymentTerms, defaultInvoiceDueDays, invoiceNotes, invoiceFooter, quotationFooter,
      bankName, bankAccountName, bankAccountNumber, bankIfsc, bankBranch, upiId, paymentInstructions,
      authorizedSignatoryName, authorizedSignatoryDesignation, authorizedSignatoryEmail, authorizedSignatoryPhone, authorizedSignatorySignatureUrl
    } = req.body;

    const updateData: any = {
      ...(name !== undefined && { name }),
      ...(industry !== undefined && { industry }),
      ...(businessType !== undefined && { businessType }),
      ...(country !== undefined && { country }),
      ...(timezone !== undefined && { timezone }),
      ...(currency !== undefined && { currency }),
      ...(website !== undefined && { website }),
      ...(description !== undefined && { description }),
      ...(contactInfo !== undefined && { contactInfo }),
      ...(operatingHours !== undefined && { operatingHours }),
      ...(preferences !== undefined && { preferences }),
      ...(legalBusinessName !== undefined && { legalBusinessName }),
      ...(displayName !== undefined && { displayName }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(alternatePhone !== undefined && { alternatePhone }),
      ...(supportEmail !== undefined && { supportEmail }),
      ...(addressLine1 !== undefined && { addressLine1 }),
      ...(addressLine2 !== undefined && { addressLine2 }),
      ...(city !== undefined && { city }),
      ...(state !== undefined && { state }),
      ...(postalCode !== undefined && { postalCode }),
      ...(taxRegistrationStatus !== undefined && { taxRegistrationStatus }),
      ...(gstin !== undefined && { gstin }),
      ...(pan !== undefined && { pan }),
      ...(defaultTaxRate !== undefined && { defaultTaxRate: defaultTaxRate ? parseFloat(defaultTaxRate) : null }),
      ...(invoicePrefix !== undefined && { invoicePrefix }),
      ...(quotationPrefix !== undefined && { quotationPrefix }),
      ...(orderPrefix !== undefined && { orderPrefix }),
      ...(defaultPaymentTerms !== undefined && { defaultPaymentTerms }),
      ...(defaultInvoiceDueDays !== undefined && { defaultInvoiceDueDays: defaultInvoiceDueDays !== null ? parseInt(defaultInvoiceDueDays) : null }),
      ...(invoiceNotes !== undefined && { invoiceNotes }),
      ...(invoiceFooter !== undefined && { invoiceFooter }),
      ...(quotationFooter !== undefined && { quotationFooter }),
      ...(bankName !== undefined && { bankName }),
      ...(bankAccountName !== undefined && { bankAccountName }),
      ...(bankAccountNumber !== undefined && { bankAccountNumber }),
      ...(bankIfsc !== undefined && { bankIfsc }),
      ...(bankBranch !== undefined && { bankBranch }),
      ...(upiId !== undefined && { upiId }),
      ...(paymentInstructions !== undefined && { paymentInstructions }),
      ...(authorizedSignatoryName !== undefined && { authorizedSignatoryName }),
      ...(authorizedSignatoryDesignation !== undefined && { authorizedSignatoryDesignation }),
      ...(authorizedSignatoryEmail !== undefined && { authorizedSignatoryEmail }),
      ...(authorizedSignatoryPhone !== undefined && { authorizedSignatoryPhone }),
      ...(authorizedSignatorySignatureUrl !== undefined && { authorizedSignatorySignatureUrl }),
    };

    const business = await prisma.business.update({
      where: { id: businessId },
      data: updateData
    });

    res.json({ success: true, data: business });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
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

export default router;
