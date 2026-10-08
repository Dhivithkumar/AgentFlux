import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { templateService } from '../services/template/TemplateService';

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use(requireBusinessMembership);

router.get('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const { type } = req.query;
    const templates = await templateService.getTemplates(businessId, type as any);
    res.json(templates);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.user.id;
    const template = await templateService.createTemplate(businessId, req.body, userId);
    res.status(201).json(template);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const template = await templateService.updateTemplate(businessId, id, req.body);
    res.json(template);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/activate', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const template = await templateService.activateTemplate(businessId, id);
    res.json(template);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
