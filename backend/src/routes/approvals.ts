// @ts-nocheck
import { Router, Request, Response } from 'express';
import { prisma, ApprovalStatus, ExecutionStatus } from '@agent-flux/database';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { WorkflowEngine } from '../services/workflow/engine';

const router = Router();
router.use(authenticate);
router.use(requireBusinessMembership);

// GET /api/approvals
router.get('/', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  if (!businessId) {
    return res.status(400).json({ success: false, error: 'businessId is required' });
  }

  try {
    // Verify membership
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId: req.user!.id, businessId: String(businessId) } }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const approvals = await prisma.workflowApproval.findMany({
      where: { 
        execution: {
          businessId: String(businessId)
        }
      },
      include: {
        execution: {
          include: {
            workflow: { select: { name: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: approvals });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch approvals' });
  }
});

// GET /api/approvals/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  try {
    const approval = await prisma.workflowApproval.findUnique({
      where: { id: req.params.id },
      include: {
        execution: {
          include: { workflow: true }
        }
      }
    });

    if (!approval || approval.execution.businessId !== businessId) {
      return res.status(404).json({ success: false, error: 'Approval not found' });
    }

    res.json({ success: true, data: approval });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch approval' });
  }
});

// POST /api/approvals/:id/approve
router.post('/:id/approve', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.body;
  try {
    const approval = await prisma.workflowApproval.findUnique({
      where: { id: req.params.id },
      include: { execution: true }
    });

    if (!approval || approval.execution.businessId !== businessId) {
      return res.status(404).json({ success: false, error: 'Approval not found' });
    }

    if (approval.status !== ApprovalStatus.PENDING) {
      return res.status(400).json({ success: false, error: 'Approval is not pending' });
    }

    // Update approval
    await prisma.workflowApproval.update({
      where: { id: req.params.id },
      data: {
        status: ApprovalStatus.APPROVED,
        approverId: req.user!.id,
        decidedAt: new Date()
      }
    });

    // Update execution status so workflow engine can resume
    await prisma.workflowExecution.update({
      where: { id: approval.executionId },
      data: { status: ExecutionStatus.RUNNING }
    });

    res.json({ success: true, data: { status: 'APPROVED' } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to approve' });
  }
});

// POST /api/approvals/:id/reject
router.post('/:id/reject', authenticate, async (req: Request, res: Response) => {
  const { businessId, reason } = req.body;
  try {
    const approval = await prisma.workflowApproval.findUnique({
      where: { id: req.params.id },
      include: { execution: true }
    });

    if (!approval || approval.execution.businessId !== businessId) {
      return res.status(404).json({ success: false, error: 'Approval not found' });
    }

    if (approval.status !== ApprovalStatus.PENDING) {
      return res.status(400).json({ success: false, error: 'Approval is not pending' });
    }

    // Update approval
    await prisma.workflowApproval.update({
      where: { id: req.params.id },
      data: {
        status: ApprovalStatus.REJECTED,
        approverId: req.user!.id,
        decisionReason: reason,
        decidedAt: new Date()
      }
    });

    // We fail the execution for now (or branch if workflow supports it)
    await prisma.workflowExecution.update({
      where: { id: approval.executionId },
      data: { 
        status: ExecutionStatus.FAILED,
        error: `Execution rejected during manual approval. Reason: ${reason}`
      }
    });

    res.json({ success: true, data: { status: 'REJECTED' } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reject' });
  }
});

export default router;
