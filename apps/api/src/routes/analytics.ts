import { Router } from 'express';
import { prisma } from '@agent-flux/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authenticate);

// Middleware to verify business membership and inject it
router.use(async (req: AuthRequest, res, next) => {
  const businessId = req.params.businessId;
  const userId = req.user!.id;
  try {
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });
    if (!membership) return res.status(403).json({ error: 'Forbidden' });
    (req as any).membership = membership;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify membership' });
  }
});

// GET /overview
router.get('/overview', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    
    const [
      revenueAggr,
      orders,
      enquiries,
      pendingActions,
      pendingQuotations,
      workflowStats
    ] = await Promise.all([
      prisma.payment.aggregate({ where: { businessId, status: 'SUCCEEDED' }, _sum: { amount: true } }),
      prisma.order.count({ where: { businessId, status: 'CONFIRMED' } }),
      prisma.enquiry.count({ where: { businessId, status: 'NEW' } }),
      prisma.approvalRequest.count({ where: { businessId, status: 'PENDING' } }),
      prisma.quotation.count({ where: { businessId, status: 'SENT' } }),
      prisma.workflowExecution.groupBy({ by: ['status'], where: { businessId }, _count: true })
    ]);

    let totalExecs = 0, successExecs = 0;
    workflowStats.forEach(s => {
      totalExecs += s._count;
      if (s.status === 'SUCCESS' || s.status === 'COMPLETED') successExecs += s._count;
    });

    res.json({
      revenue: revenueAggr._sum.amount || 0,
      orders,
      enquiries,
      pendingActions,
      pendingQuotations,
      automationSuccessRate: totalExecs > 0 ? (successExecs / totalExecs) * 100 : 100,
      lastUpdated: new Date()
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /action-zone
router.get('/action-zone', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    
    const [
      pendingApprovals,
      overdueInvoices,
      stuckEnquiries,
      pendingOrders,
      failedWorkflows,
      integrationErrors
    ] = await Promise.all([
      prisma.approvalRequest.findMany({ where: { businessId, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.invoice.findMany({ 
        where: { businessId, status: { in: ['SENT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lt: new Date() } }, 
        include: { order: { include: { customer: true } } }, 
        take: 10,
        orderBy: { dueDate: 'asc' }
      }),
      prisma.enquiry.findMany({ 
        where: { businessId, status: 'NEW', createdAt: { lt: new Date(Date.now() - 48*3600*1000) } }, 
        include: { customer: true }, 
        take: 10,
        orderBy: { createdAt: 'asc' }
      }),
      prisma.order.findMany({ 
        where: { businessId, status: 'PENDING_OWNER_CONFIRMATION' }, 
        include: { customer: true }, 
        orderBy: { createdAt: 'desc' }, 
        take: 10 
      }),
      prisma.workflowExecution.findMany({ 
        where: { businessId, status: 'FAILED' }, 
        take: 10, 
        orderBy: { startedAt: 'desc' } 
      }),
      prisma.integration.findMany({ 
        where: { businessId, status: 'ERROR' } 
      })
    ]);

    res.json({
      pendingApprovals,
      overdueInvoices,
      stuckEnquiries,
      pendingOrders,
      failedWorkflows,
      integrationErrors
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /funnel
router.get('/funnel', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    
    const [
      enquiries,
      qualified,
      quotationsGenerated,
      quotationsAccepted,
      ordersAwaiting,
      confirmedOrders,
      invoices,
      paidInvoices
    ] = await Promise.all([
      prisma.enquiry.count({ where: { businessId } }),
      prisma.enquiry.count({ where: { businessId, status: { not: 'NEW' } } }),
      prisma.quotation.count({ where: { businessId } }),
      prisma.quotation.count({ where: { businessId, status: 'ACCEPTED' } }),
      prisma.order.count({ where: { businessId, status: 'PENDING_OWNER_CONFIRMATION' } }),
      prisma.order.count({ where: { businessId, status: 'CONFIRMED' } }),
      prisma.invoice.count({ where: { businessId } }),
      prisma.invoice.count({ where: { businessId, status: 'PAID' } })
    ]);

    res.json({
      stages: [
        { name: 'Enquiries', count: enquiries },
        { name: 'Qualified', count: qualified },
        { name: 'Quotations Generated', count: quotationsGenerated },
        { name: 'Quotations Accepted', count: quotationsAccepted },
        { name: 'Orders Awaiting', count: ordersAwaiting },
        { name: 'Confirmed Orders', count: confirmedOrders },
        { name: 'Invoices Generated', count: invoices },
        { name: 'Payments Completed', count: paidInvoices }
      ],
      conversionRates: {
        qualified: enquiries ? (qualified / enquiries) * 100 : 0,
        quoted: qualified ? (quotationsGenerated / qualified) * 100 : 0,
        accepted: quotationsGenerated ? (quotationsAccepted / quotationsGenerated) * 100 : 0,
        ordersAwaiting: quotationsAccepted ? (ordersAwaiting / quotationsAccepted) * 100 : 0,
        confirmed: ordersAwaiting ? (confirmedOrders / ordersAwaiting) * 100 : 0,
        invoiced: confirmedOrders ? (invoices / confirmedOrders) * 100 : 0,
        paid: invoices ? (paidInvoices / invoices) * 100 : 0
      }
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /revenue
router.get('/revenue', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const [
      collectedAggr,
      invoicedAggr,
      pendingAggr,
      refundedAggr
    ] = await Promise.all([
      prisma.payment.aggregate({ where: { businessId, status: 'SUCCEEDED' }, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: { businessId }, _sum: { totalAmount: true } }),
      prisma.invoice.aggregate({ where: { businessId, status: { in: ['SENT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, _sum: { outstandingAmount: true } }),
      prisma.payment.aggregate({ where: { businessId, status: 'REFUNDED' }, _sum: { amount: true } })
    ]);

    res.json({
      collected: collectedAggr._sum.amount || 0,
      totalInvoiced: invoicedAggr._sum.totalAmount || 0,
      outstanding: pendingAggr._sum.outstandingAmount || 0,
      refunds: refundedAggr._sum.amount || 0
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /activity
router.get('/activity', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    
    const [audits, executions] = await Promise.all([
      prisma.auditLog.findMany({ where: { businessId }, orderBy: { timestamp: 'desc' }, take: 20 }),
      prisma.workflowExecution.findMany({ where: { businessId }, include: { workflow: true }, orderBy: { startedAt: 'desc' }, take: 20 })
    ]);
    
    const feed = [
      ...audits.map(a => ({ id: a.id, type: 'AUDIT', title: a.eventType, timestamp: a.timestamp, status: 'SUCCESS' })),
      ...executions.map(e => ({ id: e.id, type: 'WORKFLOW', title: `Workflow: ${e.workflow?.name || e.workflowId}`, timestamp: e.startedAt, status: e.status }))
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 30);
    
    res.json(feed);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /connectors
router.get('/connectors', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const integrations = await prisma.integration.findMany({ where: { businessId } });
    res.json({ health: integrations });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /configuration-alerts
router.get('/configuration-alerts', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Not found' });
    
    const alerts = [];
    if (!business.addressLine1) alerts.push('Missing business address');
    if (!business.gstin && !business.taxRegistrationStatus) alerts.push('Missing tax configuration');
    if (!business.bankAccountNumber) alerts.push('Missing payment details');
    if (!business.authorizedSignatoryName) alerts.push('Missing authorized signatory');
    
    res.json({ alerts });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /insights
router.get('/insights', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const enquiries = await prisma.enquiry.count({ where: { businessId, status: 'NEEDS_INFORMATION' } });
    res.json({
      insights: [
        { text: `${enquiries} enquiries are waiting for customer information.`, evidence: 'Enquiry status == NEEDS_INFORMATION' }
      ]
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /workflows
router.get('/workflows', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const workflowStats = await prisma.workflowExecution.groupBy({
      by: ['workflowId', 'status'],
      where: { businessId },
      _count: true
    });
    res.json({ executionsByStatus: workflowStats });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
