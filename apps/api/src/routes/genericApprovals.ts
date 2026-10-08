import { Router, Request, Response } from 'express';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';
import { ApprovalService } from '../services/governance/ApprovalService';

const router = Router({ mergeParams: true });
router.use(authenticate);

// Middleware to verify membership
router.use(async (req: any, res: any, next) => {
  const { businessId } = req.params;
  const membership = await prisma.membership.findFirst({
    where: { userId: req.user!.id, businessId }
  });
  if (!membership) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  next();
});

router.get('/', async (req: any, res: any) => {
  const { businessId } = req.params;
  const approvals = await prisma.approvalRequest.findMany({
    where: { businessId },
    include: { steps: true, decisions: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json({ success: true, data: approvals });
});

router.get('/:id', async (req: any, res: any) => {
  const { businessId, id } = req.params;
  const approval = await prisma.approvalRequest.findUnique({
    where: { id },
    include: { steps: true, decisions: true }
  });
  if (!approval || approval.businessId !== businessId) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  res.json({ success: true, data: approval });
});

router.post('/:id/approve', async (req: any, res: any) => {
  const { businessId, id } = req.params;
  const { comment } = req.body;
  try {
    const updated = await ApprovalService.approve(businessId, id, req.user!.id, comment);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/:id/reject', async (req: any, res: any) => {
  const { businessId, id } = req.params;
  const { comment } = req.body;
  try {
    const updated = await ApprovalService.reject(businessId, id, req.user!.id, comment);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// request changes
router.post('/:id/request-changes', async (req: any, res: any) => {
  const { businessId, id } = req.params;
  const { comment } = req.body;
  try {
    const request = await prisma.approvalRequest.findUnique({ where: { id } });
    if (!request || request.businessId !== businessId || request.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: 'Invalid approval request' });
    }
    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: { status: 'CHANGES_REQUESTED' }
    });
    await prisma.approvalDecision.create({
      data: { businessId, approvalRequestId: id, actorId: req.user!.id, decision: 'CHANGES_REQUESTED', comment }
    });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/:id/cancel', async (req: any, res: any) => {
  const { businessId, id } = req.params;
  const { comment } = req.body;
  try {
    const request = await prisma.approvalRequest.findUnique({ where: { id } });
    if (!request || request.businessId !== businessId || request.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: 'Invalid approval request' });
    }
    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });
    await prisma.approvalDecision.create({
      data: { businessId, approvalRequestId: id, actorId: req.user!.id, decision: 'CANCELLED', comment }
    });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
