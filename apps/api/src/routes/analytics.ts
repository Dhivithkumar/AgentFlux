import { Router, Response } from 'express';
import { prisma } from '@agent-flux/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { dashboardEventBus } from '../services/analytics/dashboardEvents';
import { operationalSyncPoller } from '../services/queue/operationalSyncPoller';

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
    if (!membership) return res.status(403).json({ error: 'Forbidden: User not a member of this business' });
    (req as any).membership = membership;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify membership' });
  }
});

// GET /live — Server-Sent Events (SSE) push stream
router.get('/live', async (req: AuthRequest, res: Response) => {
  const businessId = req.params.businessId;

  // Set standard SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Initial connection acknowledgment
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', businessId, timestamp: new Date().toISOString() })}\n\n`);

  // Subscribe to live dashboard events (cross-process via Redis / in-process fallback)
  const unsubscribe = dashboardEventBus.subscribe(businessId, (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      // Stream write error
    }
  });

  // Keep-alive heartbeat ping every 15 seconds
  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(pingInterval);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    unsubscribe();
  });
});

// GET /overview — Real business KPIs
router.get('/overview', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const [
      business,
      revenueAggr,
      invoicedAggr,
      outstandingAggr,
      overdueAggr,
      overdueInvoicesCount,
      confirmedOrders,
      pendingOrders,
      newEnquiries,
      pendingApprovals,
      pendingQuotations,
      acceptedQuotations,
      syncJobsStats,
      workflowStats
    ] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { id: true, name: true, currency: true }
      }),
      prisma.payment.aggregate({
        where: { businessId, status: 'SUCCEEDED' },
        _sum: { amount: true }
      }),
      prisma.invoice.aggregate({
        where: { businessId },
        _sum: { totalAmount: true }
      }),
      prisma.invoice.aggregate({
        where: { businessId, status: { in: ['SENT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
        _sum: { outstandingAmount: true }
      }),
      prisma.invoice.aggregate({
        where: {
          businessId,
          status: { in: ['SENT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
          dueDate: { lt: new Date() }
        },
        _sum: { totalAmount: true }
      }),
      prisma.invoice.count({
        where: {
          businessId,
          status: { in: ['SENT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
          dueDate: { lt: new Date() }
        }
      }),
      prisma.order.count({ where: { businessId, status: 'CONFIRMED' } }),
      prisma.order.count({ where: { businessId, status: 'PENDING_OWNER_CONFIRMATION' } }),
      prisma.enquiry.count({ where: { businessId, status: 'NEW' } }),
      prisma.approvalRequest.count({ where: { businessId, status: 'PENDING' } }),
      prisma.quotation.count({ where: { businessId, status: { in: ['DRAFT', 'GENERATED', 'SENT'] } } }),
      prisma.quotation.count({ where: { businessId, status: 'ACCEPTED' } }),
      prisma.operationalSyncJob.groupBy({
        by: ['status'],
        where: { businessId },
        _count: true
      }),
      prisma.workflowExecution.groupBy({
        by: ['status'],
        where: { businessId },
        _count: true
      })
    ]);

    // Aggregate sync jobs breakdown
    const syncJobs = {
      queued: 0,
      processing: 0,
      retrying: 0,
      succeeded: 0,
      failed: 0,
      total: 0
    };
    syncJobsStats.forEach((s) => {
      const count = s._count;
      syncJobs.total += count;
      if (s.status === 'PENDING') syncJobs.queued += count;
      else if (s.status === 'PROCESSING') syncJobs.processing += count;
      else if (s.status === 'RETRYING') syncJobs.retrying += count;
      else if (s.status === 'SUCCEEDED') syncJobs.succeeded += count;
      else if (s.status === 'FAILED') syncJobs.failed += count;
    });

    // Workflow success calculation
    let totalWorkflows = 0;
    let successfulWorkflows = 0;
    workflowStats.forEach((w) => {
      totalWorkflows += w._count;
      if (w.status === 'SUCCESS' || w.status === 'COMPLETED') successfulWorkflows += w._count;
    });

    const totalAutomationJobs = totalWorkflows + syncJobs.succeeded + syncJobs.failed;
    const successfulAutomationJobs = successfulWorkflows + syncJobs.succeeded;
    const automationSuccessRate =
      totalAutomationJobs > 0 ? (successfulAutomationJobs / totalAutomationJobs) * 100 : 100;

    const pendingActions = pendingApprovals + pendingOrders + overdueInvoicesCount;

    res.json({
      revenue: revenueAggr._sum.amount || 0,
      totalInvoiced: invoicedAggr._sum.totalAmount || 0,
      outstanding: outstandingAggr._sum.outstandingAmount || 0,
      overdueAmount: overdueAggr._sum.totalAmount || 0,
      overdueCount: overdueInvoicesCount,
      orders: confirmedOrders,
      pendingOrders,
      enquiries: newEnquiries,
      pendingActions,
      pendingQuotations,
      acceptedQuotations,
      syncJobs,
      automationSuccessRate: Number(automationSuccessRate.toFixed(1)),
      currency: business?.currency || 'INR',
      businessName: business?.name || '',
      lastUpdated: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /action-zone — Real action items and persisted unresolved failures
router.get('/action-zone', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const [
      pendingApprovals,
      overdueInvoices,
      stuckEnquiries,
      pendingOrders,
      failedSyncJobs,
      failedWorkflows
    ] = await Promise.all([
      prisma.approvalRequest.findMany({
        where: { businessId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 10
      }),
      prisma.invoice.findMany({
        where: {
          businessId,
          status: { in: ['SENT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
          dueDate: { lt: new Date() }
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          order: { select: { id: true, orderNumber: true } }
        },
        orderBy: { dueDate: 'asc' },
        take: 10
      }),
      prisma.enquiry.findMany({
        where: {
          businessId,
          status: 'NEW',
          createdAt: { lt: new Date(Date.now() - 48 * 3600 * 1000) }
        },
        include: { customer: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
        take: 10
      }),
      prisma.order.findMany({
        where: { businessId, status: 'PENDING_OWNER_CONFIRMATION' },
        include: { customer: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10
      }),
      prisma.operationalSyncJob.findMany({
        where: { businessId, status: { in: ['FAILED', 'RETRYING'] } },
        orderBy: { updatedAt: 'desc' },
        take: 10
      }),
      prisma.workflowExecution.findMany({
        where: { businessId, status: 'FAILED' },
        include: { workflow: { select: { id: true, name: true } } },
        orderBy: { startedAt: 'desc' },
        take: 10
      })
    ]);

    const unresolvedFailuresCount = failedSyncJobs.length + failedWorkflows.length;
    const totalActionCount =
      pendingApprovals.length +
      pendingOrders.length +
      overdueInvoices.length +
      stuckEnquiries.length +
      unresolvedFailuresCount;

    res.json({
      pendingApprovals,
      overdueInvoices,
      stuckEnquiries,
      pendingOrders,
      failedSyncJobs,
      failedWorkflows,
      unresolvedFailuresCount,
      totalActionCount
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /connectors — Real Google Sheets, Google Drive, Gmail and sync health
router.get('/connectors', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const [sheetConfig, integrations, syncJobCounts, storedDocsCount] = await Promise.all([
      prisma.operationalSheetConfig.findUnique({
        where: { businessId },
        include: { integration: true }
      }),
      prisma.integration.findMany({
        where: { businessId },
        select: {
          id: true,
          provider: true,
          status: true,
          displayName: true,
          accountEmail: true,
          lastConnectedAt: true,
          lastVerifiedAt: true
        }
      }),
      prisma.operationalSyncJob.groupBy({
        by: ['status'],
        where: { businessId },
        _count: true
      }),
      prisma.invoice.count({
        where: { businessId, generatedDocumentId: { not: null } }
      })
    ]);

    const sheetsIntegration = integrations.find((i) => i.provider === 'GOOGLE_SHEETS');
    const driveIntegration = integrations.find((i) => i.provider === 'GOOGLE_DRIVE');
    const gmailIntegration = integrations.find((i) => i.provider === 'GMAIL');

    // Sync jobs queue status
    const queueStats = { queued: 0, processing: 0, retrying: 0, succeeded: 0, failed: 0 };
    syncJobCounts.forEach((s) => {
      if (s.status === 'PENDING') queueStats.queued += s._count;
      else if (s.status === 'PROCESSING') queueStats.processing += s._count;
      else if (s.status === 'RETRYING') queueStats.retrying += s._count;
      else if (s.status === 'SUCCEEDED') queueStats.succeeded += s._count;
      else if (s.status === 'FAILED') queueStats.failed += s._count;
    });

    const googleSheets = {
      connected: !!sheetsIntegration && sheetsIntegration.status === 'CONNECTED',
      status: sheetConfig ? sheetConfig.status : sheetsIntegration ? 'CONNECTED' : 'NOT_CONFIGURED',
      spreadsheetId: sheetConfig?.spreadsheetId || null,
      spreadsheetName: sheetConfig?.spreadsheetName || null,
      lastSyncedAt: sheetConfig?.lastSyncedAt || null,
      errorMessage: sheetConfig?.errorMessage || null,
      url: sheetConfig?.spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`
        : null
    };

    const googleDrive = {
      connected: !!driveIntegration && driveIntegration.status === 'CONNECTED',
      status: driveIntegration?.status || 'NOT_CONFIGURED',
      accountEmail: driveIntegration?.accountEmail || null,
      lastConnectedAt: driveIntegration?.lastConnectedAt || null,
      lastVerifiedAt: driveIntegration?.lastVerifiedAt || null,
      storedDocumentsCount: storedDocsCount
    };

    const gmail = {
      connected: !!gmailIntegration && gmailIntegration.status === 'CONNECTED',
      status: gmailIntegration?.status || 'NOT_CONFIGURED',
      accountEmail: gmailIntegration?.accountEmail || null,
      lastConnectedAt: gmailIntegration?.lastConnectedAt || null,
      lastVerifiedAt: gmailIntegration?.lastVerifiedAt || null
    };

    res.json({
      googleSheets,
      googleDrive,
      gmail,
      syncWorker: {
        status: queueStats.failed > 0 ? 'DEGRADED' : queueStats.processing > 0 ? 'BUSY' : 'HEALTHY',
        queue: queueStats
      },
      integrations
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /configuration-alerts — Persisted required setup and warnings with remediation links
router.get('/configuration-alerts', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const [business, sheetConfig, driveIntegration, failedJobsCount] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId } }),
      prisma.operationalSheetConfig.findUnique({ where: { businessId } }),
      prisma.integration.findFirst({ where: { businessId, provider: 'GOOGLE_DRIVE' } }),
      prisma.operationalSyncJob.count({ where: { businessId, status: 'FAILED' } })
    ]);

    if (!business) return res.status(404).json({ error: 'Business not found' });

    const contactInfo = (business.contactInfo as any) || {};
    const preferences = (business.preferences as any) || {};

    const address =
      (business as any).addressLine1 ||
      (business as any).address ||
      contactInfo.address ||
      contactInfo.addressLine1 ||
      preferences.address;

    const gstin =
      (business as any).gstin ||
      contactInfo.gstin ||
      preferences.gstin ||
      (business as any).taxRegistrationStatus;

    const bankDetails =
      preferences.bankAccountNumber ||
      preferences.bankDetails ||
      contactInfo.bankAccountNumber ||
      contactInfo.bankDetails;

    const alerts: Array<{
      id: string;
      title: string;
      description: string;
      severity: 'error' | 'warning' | 'info';
      remediationUrl: string;
      actionLabel: string;
    }> = [];

    if (!address) {
      alerts.push({
        id: 'missing_address',
        title: 'Missing Business Address',
        description: 'Business address is required for official quotations and tax invoices.',
        severity: 'warning',
        remediationUrl: '/dashboard/settings',
        actionLabel: 'Add Address'
      });
    }

    if (!gstin) {
      alerts.push({
        id: 'missing_tax_id',
        title: 'GSTIN / Tax Configuration Missing',
        description: 'Configure your GSTIN or tax registration number to ensure valid tax invoices.',
        severity: 'warning',
        remediationUrl: '/dashboard/settings',
        actionLabel: 'Configure Tax'
      });
    }

    if (!bankDetails) {
      alerts.push({
        id: 'missing_bank_details',
        title: 'Bank & Settlement Details Required',
        description: 'Add bank account details for customer payment instructions on issued invoices.',
        severity: 'warning',
        remediationUrl: '/dashboard/settings',
        actionLabel: 'Setup Bank Details'
      });
    }

    if (!sheetConfig || sheetConfig.status === 'FAILED' || sheetConfig.status === 'DISCONNECTED') {
      alerts.push({
        id: 'sheet_sync_required',
        title: 'Operational Google Sheets Disconnected',
        description:
          sheetConfig?.errorMessage ||
          'Google Sheets is required for real-time customer and order operational synchronization.',
        severity: 'error',
        remediationUrl: '/dashboard/integrations',
        actionLabel: 'Connect Sheets'
      });
    }

    if (!driveIntegration || driveIntegration.status !== 'CONNECTED') {
      alerts.push({
        id: 'drive_storage_required',
        title: 'Google Drive Storage Disconnected',
        description:
          'Connect Google Drive to enable durable PDF storage for generated quotations and invoices.',
        severity: 'error',
        remediationUrl: '/dashboard/integrations',
        actionLabel: 'Connect Drive'
      });
    }

    if (failedJobsCount > 0) {
      alerts.push({
        id: 'sync_failures_detected',
        title: `${failedJobsCount} Failed Operational Sync Job(s)`,
        description: 'One or more synchronization operations failed. Inspect errors and retry.',
        severity: 'error',
        remediationUrl: '/dashboard/integrations',
        actionLabel: 'View Sync Failures'
      });
    }

    res.json({ alerts, totalAlerts: alerts.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs — Consistent background job status visibility
router.get('/jobs', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const [syncJobsStats, recentSyncJobs, recentWorkflowExecs] = await Promise.all([
      prisma.operationalSyncJob.groupBy({
        by: ['status'],
        where: { businessId },
        _count: true
      }),
      prisma.operationalSyncJob.findMany({
        where: { businessId },
        orderBy: { updatedAt: 'desc' },
        take: 20
      }),
      prisma.workflowExecution.findMany({
        where: { businessId },
        include: { workflow: { select: { id: true, name: true } } },
        orderBy: { startedAt: 'desc' },
        take: 20
      })
    ]);

    const summary = {
      queued: 0,
      processing: 0,
      retrying: 0,
      succeeded: 0,
      failed: 0,
      total: 0
    };
    syncJobsStats.forEach((s) => {
      summary.total += s._count;
      if (s.status === 'PENDING') summary.queued += s._count;
      else if (s.status === 'PROCESSING') summary.processing += s._count;
      else if (s.status === 'RETRYING') summary.retrying += s._count;
      else if (s.status === 'SUCCEEDED') summary.succeeded += s._count;
      else if (s.status === 'FAILED') summary.failed += s._count;
    });

    res.json({
      summary,
      recentSyncJobs,
      recentWorkflowExecs
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /jobs/:jobId/retry — Explicit remediation action to retry failed sync job
router.post('/jobs/:jobId/retry', async (req: AuthRequest, res) => {
  try {
    const { businessId, jobId } = req.params;

    const job = await prisma.operationalSyncJob.findFirst({
      where: { id: jobId, businessId }
    });

    if (!job) {
      return res.status(404).json({ error: 'Sync job not found or does not belong to this business' });
    }

    const updatedJob = await prisma.operationalSyncJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        nextAttemptAt: new Date(),
        updatedAt: new Date()
      }
    });

    // Notify poller to process pending jobs
    operationalSyncPoller.poll().catch(() => {});

    // Publish live dashboard event
    dashboardEventBus.publish(businessId, 'SYNC_JOB_UPDATED', {
      jobId,
      status: 'PENDING'
    }).catch(() => {});

    res.json({
      success: true,
      message: 'Sync job reset to PENDING and scheduled for immediate retry.',
      job: updatedJob
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /funnel — Accurate end-to-end customer conversion funnel
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
        { name: 'Enquiries Intake', count: enquiries },
        { name: 'Qualified Enquiries', count: qualified },
        { name: 'Quotations Generated', count: quotationsGenerated },
        { name: 'Quotations Accepted', count: quotationsAccepted },
        { name: 'Orders Awaiting Confirmation', count: ordersAwaiting },
        { name: 'Confirmed Orders', count: confirmedOrders },
        { name: 'Invoices Generated', count: invoices },
        { name: 'Payments Completed', count: paidInvoices }
      ],
      conversionRates: {
        qualified: enquiries > 0 ? (qualified / enquiries) * 100 : 0,
        quoted: qualified > 0 ? (quotationsGenerated / qualified) * 100 : 0,
        accepted: quotationsGenerated > 0 ? (quotationsAccepted / quotationsGenerated) * 100 : 0,
        ordersAwaiting: quotationsAccepted > 0 ? (ordersAwaiting / quotationsAccepted) * 100 : 0,
        confirmed: ordersAwaiting > 0 ? (confirmedOrders / (ordersAwaiting + confirmedOrders)) * 100 : 0,
        invoiced: confirmedOrders > 0 ? (invoices / confirmedOrders) * 100 : 0,
        paid: invoices > 0 ? (paidInvoices / invoices) * 100 : 0
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /revenue — Multi-currency and INR financial snapshot
router.get('/revenue', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const [collectedAggr, invoicedAggr, pendingAggr, refundedAggr, business] = await Promise.all([
      prisma.payment.aggregate({ where: { businessId, status: 'SUCCEEDED' }, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: { businessId }, _sum: { totalAmount: true } }),
      prisma.invoice.aggregate({
        where: { businessId, status: { in: ['SENT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
        _sum: { outstandingAmount: true }
      }),
      prisma.payment.aggregate({ where: { businessId, status: 'REFUNDED' }, _sum: { amount: true } }),
      prisma.business.findUnique({ where: { id: businessId }, select: { currency: true } })
    ]);

    res.json({
      collected: collectedAggr._sum.amount || 0,
      totalInvoiced: invoicedAggr._sum.totalAmount || 0,
      outstanding: pendingAggr._sum.outstandingAmount || 0,
      refunds: refundedAggr._sum.amount || 0,
      currency: business?.currency || 'INR'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /activity — Recent operational audit trail
router.get('/activity', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const [audits, executions] = await Promise.all([
      prisma.auditLog.findMany({ where: { businessId }, orderBy: { timestamp: 'desc' }, take: 20 }),
      prisma.workflowExecution.findMany({
        where: { businessId },
        include: { workflow: true },
        orderBy: { startedAt: 'desc' },
        take: 20
      })
    ]);

    const feed = [
      ...audits.map((a) => ({
        id: a.id,
        type: 'AUDIT',
        title: a.eventType,
        timestamp: a.timestamp,
        status: 'SUCCESS'
      })),
      ...executions.map((e) => ({
        id: e.id,
        type: 'WORKFLOW',
        title: `Workflow: ${e.workflow?.name || e.workflowId}`,
        timestamp: e.startedAt,
        status: e.status
      }))
    ]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 30);

    res.json(feed);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /insights
router.get('/insights', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const enquiries = await prisma.enquiry.count({ where: { businessId, status: 'NEEDS_INFORMATION' } });
    res.json({
      insights: [
        {
          text: `${enquiries} enquiries are waiting for customer information.`,
          evidence: 'Enquiry status == NEEDS_INFORMATION'
        }
      ]
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /priority-orders — Prominent High-Priority Orders Intelligence
router.get('/priority-orders', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;
    const orders = await prisma.order.findMany({
      where: {
        businessId,
        status: { notIn: ['COMPLETED', 'DELIVERED', 'CANCELLED'] }
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            paymentScore: true,
            paymentScoreCategory: true,
            creditLimit: true,
            totalOutstanding: true,
            overdueBalance: true
          }
        },
        vendor: {
          select: { id: true, name: true, verificationStatus: true }
        }
      },
      orderBy: [
        { priorityScore: 'desc' },
        { createdAt: 'desc' }
      ],
      take: 10
    });

    const criticalCount = orders.filter(o => o.priority === 'CRITICAL').length;
    const highCount = orders.filter(o => o.priority === 'HIGH').length;

    res.json({
      success: true,
      data: {
        orders,
        summary: {
          totalPriorityOrders: orders.length,
          criticalCount,
          highCount
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /customer-health — Customer Payment Scores & Exposure Distribution
router.get('/customer-health', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const customers = await prisma.customer.findMany({
      where: { businessId },
      include: {
        invoices: {
          where: { status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] } },
          select: { totalAmount: true, paidAmount: true, outstandingAmount: true, status: true, dueDate: true, invoiceDate: true }
        }
      },
      take: 20
    });

    let strongCount = 0;
    let goodCount = 0;
    let cautionCount = 0;
    let highRiskCount = 0;
    let insufficientHistoryCount = 0;
    let totalOutstandingAll = 0;
    let totalOverdueAll = 0;

    const enrichedCustomers = customers.map(c => {
      const invoices = c.invoices || [];
      const outstanding = invoices.reduce((s, i) => s + (i.outstandingAmount || 0), 0);
      const now = new Date();
      const overdue = invoices.reduce((s, i) => {
        const due = i.dueDate ? new Date(i.dueDate) : new Date(new Date(i.invoiceDate).getTime() + 30 * 86400000);
        return (now > due && i.outstandingAmount > 0) ? s + i.outstandingAmount : s;
      }, 0);

      totalOutstandingAll += outstanding;
      totalOverdueAll += overdue;

      const score = c.paymentScore;
      const category = c.paymentScoreCategory || (invoices.length < 2 ? 'INSUFFICIENT_HISTORY' : 'GOOD');

      if (category === 'STRONG') strongCount++;
      else if (category === 'GOOD') goodCount++;
      else if (category === 'CAUTION') cautionCount++;
      else if (category === 'HIGH_RISK') highRiskCount++;
      else insufficientHistoryCount++;

      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        paymentScore: score,
        category,
        creditLimit: c.creditLimit || 0,
        outstandingBalance: outstanding,
        overdueBalance: overdue,
        invoiceCount: invoices.length
      };
    });

    // Top accounts needing attention (highest overdue or lowest score)
    const riskAccounts = [...enrichedCustomers]
      .filter(c => c.overdueBalance > 0 || (c.paymentScore !== null && c.paymentScore < 50))
      .sort((a, b) => b.overdueBalance - a.overdueBalance)
      .slice(0, 5);

    res.json({
      success: true,
      data: {
        customers: enrichedCustomers,
        riskAccounts,
        summary: {
          strongCount,
          goodCount,
          cautionCount,
          highRiskCount,
          insufficientHistoryCount,
          totalOutstandingAll,
          totalOverdueAll
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /vendor-summary — Vendor Verification Summary
router.get('/vendor-summary', async (req: AuthRequest, res) => {
  try {
    const businessId = req.params.businessId;

    const vendors = await prisma.vendor.findMany({
      where: { businessId },
      select: { id: true, name: true, verificationStatus: true, verifiedAt: true, category: true }
    });

    const statusCounts = {
      VERIFIED: 0,
      PARTIALLY_VERIFIED: 0,
      PENDING_VERIFICATION: 0,
      VERIFICATION_FAILED: 0,
      MANUAL_REVIEW_REQUIRED: 0,
      EXPIRED_VERIFICATION: 0
    };

    for (const v of vendors) {
      const st = v.verificationStatus as keyof typeof statusCounts;
      if (statusCounts[st] !== undefined) {
        statusCounts[st]++;
      }
    }

    res.json({
      success: true,
      data: {
        totalVendors: vendors.length,
        statusCounts,
        recentVendors: vendors.slice(0, 5)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
