import { Router, Request, Response } from 'express';
import { GovernanceService } from '../services/governance/GovernanceService';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';

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

// Policies
router.get('/policies', async (req: any, res: any) => {
  const { businessId } = req.params;
  const policies = await prisma.governancePolicy.findMany({
    where: { businessId },
    include: { rules: true },
    orderBy: { priority: 'desc' }
  });
  res.json({ success: true, data: policies });
});

router.post('/policies', async (req: any, res: any) => {
  const { businessId } = req.params;
  const policy = await GovernanceService.createPolicy(businessId, req.body);
  res.json({ success: true, data: policy });
});

router.patch('/policies/:id', async (req: any, res: any) => {
  const { businessId, id } = req.params;
  const policy = await prisma.governancePolicy.update({
    where: { id },
    data: req.body
  });
  res.json({ success: true, data: policy });
});

router.delete('/policies/:id', async (req: any, res: any) => {
  const { businessId, id } = req.params;
  await prisma.governancePolicy.delete({
    where: { id }
  });
  res.json({ success: true, data: { deleted: true } });
});

// Rules
router.get('/rules', async (req: any, res: any) => {
  const { businessId } = req.params;
  const rules = await prisma.approvalRule.findMany({
    where: { businessId },
    include: { steps: true, policy: true },
    orderBy: { priority: 'desc' }
  });
  res.json({ success: true, data: rules });
});

router.post('/rules', async (req: any, res: any) => {
  const { businessId } = req.params;
  const { policyId, actionType, condition, approvalMode, priority, allowSelfApproval, steps } = req.body;
  
  // Validate basic required fields
  if (!policyId || !actionType || !condition) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const rule = await GovernanceService.createRule(businessId, policyId, {
    actionType, condition, priority, allowSelfApproval, approvalMode
  });

  if (steps && Array.isArray(steps)) {
    for (const step of steps) {
      await GovernanceService.addRuleStep(rule.id, step.stepOrder, step.approverRole, step.approverUserId);
    }
  }

  const updatedRule = await prisma.approvalRule.findUnique({
    where: { id: rule.id },
    include: { steps: true }
  });

  res.json({ success: true, data: updatedRule });
});

router.patch('/rules/:id', async (req: any, res: any) => {
  const { businessId, id } = req.params;
  const { steps, ...updateData } = req.body;
  const rule = await prisma.approvalRule.update({
    where: { id },
    data: updateData
  });
  res.json({ success: true, data: rule });
});

export default router;
