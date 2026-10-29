import { Router, Request, Response } from 'express';
import { ExecutionStatus } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';
import { WorkflowEngine } from '../services/workflow/engine';

const router = Router();

// GET /api/executions
router.get('/', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query as { businessId?: string };
  if (!businessId) {
    return res.status(400).json({ success: false, error: 'businessId is required' });
  }

  try {
    // Verify membership
    const membership = await prisma.membership.findFirst({
      where: { userId: (req as any).user!.id, businessId: String(businessId) }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const executions = await prisma.workflowExecution.findMany({
      where: { businessId: String(businessId) },
      include: {
        workflow: { select: { name: true, category: true } }
      },
      orderBy: { startedAt: 'desc' },
      take: 100
    });

    res.json({ success: true, data: executions });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch executions' });
  }
});

// GET /api/executions/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query as { businessId?: string };
  try {
    if (!businessId) {
      return res.status(400).json({ success: false, error: 'businessId is required' });
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: (req as any).user!.id, businessId: String(businessId) }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const execution = await prisma.workflowExecution.findUnique({
      where: { id: req.params.id },
      include: {
        workflow: true,
        stepExecutions: {
          orderBy: { startedAt: 'asc' }
        }
      }
    });

    if (!execution) {
      return res.status(404).json({ success: false, error: 'Execution not found' });
    }

    if (execution.businessId !== businessId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    res.json({ success: true, data: execution });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch execution' });
  }
});

// Helper for membership verification
const verifyMembership = async (req: Request, businessId: string) => {
  if (!businessId) return false;
  const membership = await prisma.membership.findFirst({
    where: { userId: (req as any).user!.id, businessId: String(businessId) }
  });
  return !!membership;
};

// POST /api/executions/:id/retry
router.post('/:id/retry', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  if (!(await verifyMembership(req, businessId as string))) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  try {
    const execution = await prisma.workflowExecution.findUnique({ where: { id: req.params.id } });
    if (!execution || execution.businessId !== businessId) return res.status(404).json({ success: false, error: 'Not found' });
    
    await WorkflowEngine.resumeWorkflow(execution.id);
    res.json({ success: true, data: { status: 'RETRYING' } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retry' });
  }
});

// POST /api/executions/:id/cancel
router.post('/:id/cancel', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  if (!(await verifyMembership(req, businessId as string))) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  try {
    const execution = await prisma.workflowExecution.findUnique({ where: { id: req.params.id } });
    if (!execution || execution.businessId !== businessId) return res.status(404).json({ success: false, error: 'Not found' });
    
    const updated = await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: ExecutionStatus.CANCELLED, completedAt: new Date() }
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to cancel' });
  }
});

// POST /api/executions/:id/pause
router.post('/:id/pause', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  if (!(await verifyMembership(req, businessId as string))) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  try {
    const execution = await prisma.workflowExecution.findUnique({ where: { id: req.params.id } });
    if (!execution || execution.businessId !== businessId) return res.status(404).json({ success: false, error: 'Not found' });
    
    const updated = await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: ExecutionStatus.WAITING }
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to pause' });
  }
});

// POST /api/executions/:id/resume
router.post('/:id/resume', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  if (!(await verifyMembership(req, businessId as string))) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  try {
    const execution = await prisma.workflowExecution.findUnique({ where: { id: req.params.id } });
    if (!execution || execution.businessId !== businessId) return res.status(404).json({ success: false, error: 'Not found' });
    
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: ExecutionStatus.WAITING }
    });
    await WorkflowEngine.resumeWorkflow(execution.id);
    res.json({ success: true, data: { status: 'RESUMING' } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to resume' });
  }
});

export default router;
