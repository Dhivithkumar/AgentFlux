import { Router } from 'express';
import { prisma } from '@agent-flux/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authenticate);

// GET /api/businesses/:businessId/analytics/overview
router.get('/overview', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const enquiries = await prisma.enquiry.count({ where: { businessId } });
    const orders = await prisma.order.count({ where: { businessId } });
    
    const successfulPayments = await prisma.payment.aggregate({
      where: { businessId, status: 'SUCCEEDED' },
      _sum: { amount: true }
    });
    
    const pendingActions = await prisma.approvalRequest.count({
      where: { businessId, status: 'PENDING' }
    });
    
    res.json({
      revenue: successfulPayments._sum.amount || 0,
      orders,
      enquiries,
      pendingActions,
      lastUpdated: new Date()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:businessId/analytics/funnel
router.get('/funnel', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const enquiries = await prisma.enquiry.count({ where: { businessId } });
    const quotations = await prisma.quotation.count({ where: { businessId } });
    const orders = await prisma.order.count({ where: { businessId } });
    const invoices = await prisma.invoice.count({ where: { businessId } });
    const paidInvoices = await prisma.invoice.count({ where: { businessId, status: 'PAID' } });

    res.json({
      stages: [
        { name: 'Enquiry', count: enquiries },
        { name: 'Quotation', count: quotations },
        { name: 'Order', count: orders },
        { name: 'Invoice', count: invoices },
        { name: 'Payment', count: paidInvoices }
      ],
      conversionRates: {
        enquiryToQuote: enquiries > 0 ? (quotations / enquiries) * 100 : 0,
        quoteToOrder: quotations > 0 ? (orders / quotations) * 100 : 0,
        orderToInvoice: orders > 0 ? (invoices / orders) * 100 : 0,
        invoiceToPayment: invoices > 0 ? (paidInvoices / invoices) * 100 : 0,
        overall: enquiries > 0 ? (paidInvoices / enquiries) * 100 : 0
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:businessId/analytics/revenue
router.get('/revenue', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const successfulPayments = await prisma.payment.aggregate({
      where: { businessId, status: 'SUCCEEDED' },
      _sum: { amount: true }
    });

    const pendingPayments = await prisma.payment.aggregate({
      where: { businessId, status: 'PENDING' },
      _sum: { amount: true }
    });

    const refundedPayments = await prisma.payment.aggregate({
      where: { businessId, status: 'REFUNDED' },
      _sum: { amount: true }
    });
    
    res.json({
      netRevenue: successfulPayments._sum.amount || 0,
      outstandingAmount: pendingPayments._sum.amount || 0,
      refunds: refundedPayments._sum.amount || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:businessId/analytics/workflows
router.get('/workflows', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const workflowStats = await prisma.workflowExecution.groupBy({
      by: ['workflowId', 'status'],
      where: { businessId },
      _count: true
    });

    res.json({
      executionsByStatus: workflowStats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:businessId/analytics/agents
router.get('/agents', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const agentExecutions = await prisma.agentExecution.findMany({
      where: { businessId },
      select: {
        id: true,
        agentId: true,
        status: true,
        tokenUsage: true
      }
    });
    
    let totalTokens = 0;
    agentExecutions.forEach(exec => {
      if (exec.tokenUsage && typeof exec.tokenUsage === 'object') {
        const usage = exec.tokenUsage as { totalTokens?: number };
        totalTokens += (usage.totalTokens || 0);
      }
    });

    res.json({
      totalExecutions: agentExecutions.length,
      successCount: agentExecutions.filter(e => e.status === 'COMPLETED').length,
      failureCount: agentExecutions.filter(e => e.status === 'FAILED').length,
      totalTokens,
      estimatedCostInCents: (totalTokens / 1000) * 1.5 // example rate
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:businessId/analytics/connectors
router.get('/connectors', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const integrations = await prisma.integration.findMany({
      where: { businessId }
    });

    res.json({
      health: integrations.map(int => ({
        provider: int.provider,
        status: int.status,
        lastConnectedAt: int.lastConnectedAt
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:businessId/analytics/errors
router.get('/errors', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const failedWorkflows = await prisma.workflowExecution.findMany({
      where: { businessId, status: 'FAILED' },
      select: { id: true, error: true, workflowId: true },
      take: 50,
      orderBy: { startedAt: 'desc' }
    });

    res.json({
      recentErrors: failedWorkflows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:businessId/analytics/insights
router.get('/insights', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const enquiries = await prisma.enquiry.count({ where: { businessId, status: 'NEEDS_INFORMATION' } });
    
    res.json({
      insights: [
        {
          text: `${enquiries} enquiries are waiting for customer information.`,
          evidence: `Enquiry status == NEEDS_INFORMATION`
        }
      ]
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:businessId/improvements
router.get('/improvements', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const recommendations = await prisma.improvementRecommendation.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(recommendations);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/businesses/:businessId/improvements/:id/review
router.post('/improvements/:id/review', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const id = req.params.id;
    
    const { status } = req.body;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership || membership.role !== 'OWNER') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await prisma.improvementRecommendation.update({
      where: { id, businessId },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedById: userId
      }
    });
    
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:businessId/analytics/action-zone
router.get('/action-zone', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const userId = req.user!.id;

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const pendingApprovals = await prisma.approvalRequest.findMany({
      where: { businessId, status: 'PENDING' },
      take: 5,
      orderBy: { createdAt: 'desc' }
    });

    const overdueInvoices = await prisma.invoice.findMany({
      where: { 
        businessId, 
        status: 'PAYMENT_PENDING',
        dueDate: { lt: new Date() }
      },
      include: { order: { include: { customer: true } } },
      take: 5,
      orderBy: { dueDate: 'asc' }
    });

    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const stuckEnquiries = await prisma.enquiry.findMany({
      where: {
        businessId,
        status: 'NEW',
        createdAt: { lt: twoDaysAgo }
      },
      include: { customer: true },
      take: 5,
      orderBy: { createdAt: 'asc' }
    });

    res.json({
      pendingApprovals,
      overdueInvoices,
      stuckEnquiries
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
