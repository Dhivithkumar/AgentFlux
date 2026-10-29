import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { prisma } from '@agent-flux/database';
import { customerPaymentScoreService } from '../services/customer/CustomerPaymentScoreService';
import { customerBalanceService } from '../services/finance/CustomerBalanceService';

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use(requireBusinessMembership);

/**
 * GET /api/businesses/:businessId/customers
 * Query params: search, limit
 */
router.get('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const { search, limit } = req.query;

    const where: any = { businessId };

    if (search) {
      const q = String(search).trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { externalId: { contains: q, mode: 'insensitive' } }
      ];
    }

    const customers = await prisma.customer.findMany({
      where,
      take: limit ? Math.min(100, parseInt(limit, 10)) : 50,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { orders: true, invoices: true }
        }
      }
    });

    res.json({ success: true, data: customers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/businesses/:businessId/customers
 * Body: { name, email, phone, creditLimit, address, notes }
 */
router.post('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const { name, email, phone, creditLimit, address, notes, source } = req.body;

    if (!name && !email && !phone) {
      return res.status(400).json({ error: 'Customer name, email, or phone is required.' });
    }

    const customer = await prisma.customer.create({
      data: {
        businessId,
        name: name || null,
        email: email || null,
        phone: phone || null,
        source: source || 'DIRECT_ENTRY',
        creditLimit: creditLimit ? Number(creditLimit) : 0,
        customData: {
          address: address || null,
          notes: notes || null
        }
      }
    });

    res.status(201).json({ success: true, data: customer });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/businesses/:businessId/customers/:id
 */
router.get('/:id', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const customer = await prisma.customer.findUnique({
      where: { id, businessId },
      include: {
        orders: { orderBy: { createdAt: 'desc' }, take: 10 },
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 }
      }
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const summary = await customerBalanceService.getCustomerFinancialSummary(businessId, id);
    res.json({ success: true, data: { ...customer, financialSummary: summary } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/businesses/:businessId/customers/:id/score
 */
router.get('/:id/score', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const scoreResult = await customerPaymentScoreService.calculateCustomerScore(businessId, id);
    res.json({ success: true, data: scoreResult });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/businesses/:businessId/customers/:id/score/recalculate
 */
router.post('/:id/score/recalculate', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const scoreResult = await customerPaymentScoreService.calculateAndPersistScore(businessId, id);
    res.json({ success: true, data: scoreResult });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/businesses/:businessId/customers/:id/financial-summary
 */
router.get('/:id/financial-summary', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const summary = await customerBalanceService.getCustomerFinancialSummary(businessId, id);
    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
