import { Router, Request, Response } from 'express';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';
import { AgentRuntime } from '../services/agent/AgentRuntime';

const router = Router({ mergeParams: true });

// GET /api/businesses/:businessId/agents
router.get('/', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const agents = await prisma.agent.findMany({
    where: { businessId },
    include: { versions: true }
  });
  res.json({ success: true, data: agents });
});

// POST /api/businesses/:businessId/agents
router.post('/', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const { name, description, purpose, systemInstructions, tokenBudget } = req.body;

  const agent = await prisma.agent.create({
    data: {
      businessId,
      name,
      description,
      purpose,
      systemInstructions,
      tokenBudget,
      status: 'DRAFT',
      versions: {
        create: {
          version: 1,
          systemInstructions
        }
      }
    },
    include: { versions: true }
  });
  res.json({ success: true, data: agent });
});

// GET /api/businesses/:businessId/agents/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const { businessId, id } = req.params;
  const agent = await prisma.agent.findUnique({
    where: { id, businessId },
    include: { versions: true, permissions: true }
  });
  res.json({ success: true, data: agent });
});

// POST /api/businesses/:businessId/agents/:id/run
router.post('/:id/run', authenticate, async (req: Request, res: Response) => {
  const { businessId, id } = req.params;
  const { goal } = req.body;

  try {
    const executionId = await AgentRuntime.startExecution(
      businessId,
      id,
      'MANUAL',
      { goal }
    );
    res.json({ success: true, data: { executionId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/businesses/:businessId/agent-executions
router.get('/:id/executions', authenticate, async (req: Request, res: Response) => {
  const { businessId, id } = req.params;
  const executions = await prisma.agentExecution.findMany({
    where: { businessId, agentId: id },
    orderBy: { startedAt: 'desc' },
    include: { steps: true }
  });
  res.json({ success: true, data: executions });
});

export default router;
