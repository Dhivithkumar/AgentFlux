import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { activateFurniturePack } from '../services/workflow/packs/furniturePack';

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireBusinessMembership);

router.post('/furniture/activate', asyncHandler(async (req: any, res: any) => {
  const businessId = req.params.businessId;
  const { workflowIndex } = req.body;
  const result = await activateFurniturePack(businessId, workflowIndex);
  res.json(result);
}));

export default router;
