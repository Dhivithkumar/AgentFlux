import { Router, Request, Response } from 'express';
import { PrismaClient, WorkflowStatus } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';

const router = Router();


// GET /api/workflow-templates
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { category, search } = req.query;
    let where: any = { status: 'AVAILABLE' };

    if (category && typeof category === 'string') {
      where.category = category;
    }
    
    if (search && typeof search === 'string') {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const templates = await prisma.workflowTemplate.findMany({
      where,
      orderBy: { name: 'asc' }
    });
    
    res.json({ success: true, data: templates });
  } catch (error: any) {
    console.error('Fetch Workflow Templates Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch templates' });
  }
});

// GET /api/workflow-templates/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const template = await prisma.workflowTemplate.findUnique({
      where: { id: req.params.id }
    });

    if (!template) {
      return res.status(404).json({ success: false, error: 'Workflow template not found' });
    }

    res.json({ success: true, data: template });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch template' });
  }
});

// POST /api/workflow-templates/:id/use
router.post('/:id/use', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.body;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });

    if (!membership) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const template = await prisma.workflowTemplate.findUnique({
      where: { id: req.params.id }
    });

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    // Create the workflow based on template
    const newWorkflow = await prisma.$transaction(async (tx: any) => {
      const workflow = await tx.workflow.create({
        data: {
          businessId,
          templateId: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          status: WorkflowStatus.DRAFT,
          riskLevel: template.riskLevel,
        }
      });

      const version = await tx.workflowVersion.create({
        data: {
          workflowId: workflow.id,
          versionNumber: 1,
          trigger: (template.workflowDefinition as any)?.trigger || {},
          requiredConnectors: template.requiredIntegrations || [],
          optionalConnectors: (template as any).optionalConnectors || [],
          requiredCapabilities: template.requiredCapabilities || [],
          definition: template.workflowDefinition
        }
      });

      // Update the workflow to point to this initial version
      await tx.workflow.update({
        where: { id: workflow.id },
        data: { activeVersionId: version.id }
      });

      // Clone steps
      const def = template.workflowDefinition as any;
      const steps: any[] = def?.nodes || [];
      if (steps.length > 0) {
        await tx.workflowStep.createMany({
          data: steps.map((step: any, index: number) => ({
            workflowVersionId: version.id,
            stepOrder: index + 1,
            stepId: step.id,
            type: step.type,
            config: step.config || {},
            next: step.next || null,
            inputSchema: step.inputSchema || null,
            outputSchema: step.outputSchema || null,
            errorHandler: step.errorHandler || null,
            retryPolicy: step.retryPolicy || null,
            timeout: step.timeout || null
          }))
        });
      }

      return workflow;
    });

    res.json({ success: true, data: { workflowId: newWorkflow.id, status: newWorkflow.status } });
  } catch (error: any) {
    console.error('Use Template Error:', error);
    res.status(500).json({ success: false, error: 'Failed to create workflow from template' });
  }
});

export default router;
