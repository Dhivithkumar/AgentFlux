import { Router, Request, Response } from 'express';
import { WorkflowStatus, ExecutionStatus, IntegrationStatus } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';
import { WorkflowEngine } from '../services/workflow/engine';
import { getConnectorDefinition } from '../connectors/registry';

const router = Router();


// POST /api/workflows/generate (AI Generation Phase 15)
router.post('/generate', authenticate, async (req: Request, res: Response) => {
  const { businessId, prompt } = req.body;
  const user = (req as any).user;

  if (!businessId || !prompt) {
    return res.status(400).json({ success: false, error: 'Missing businessId or prompt' });
  }

  try {
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    // Mock AI generated response
    const definition = {
      nodes: [
        { id: 'trigger_1', type: 'TRIGGER', config: { event: 'EMAIL_RECEIVED', connector: 'GMAIL' }, next: { DEFAULT: 'ai_agent_1' } },
        { id: 'ai_agent_1', type: 'AI_AGENT', config: { task: 'Analyze intent of request' }, next: { HIGH_PRIORITY: 'action_1', DEFAULT: 'action_2' } },
        { id: 'action_1', type: 'ACTION', config: { action: 'Send Slack Alert', connector: 'SLACK' }, next: { DEFAULT: 'action_2' } },
        { id: 'action_2', type: 'ACTION', config: { action: 'Log to Sheets', connector: 'GOOGLE_SHEETS' } }
      ]
    };

    const workflow = await prisma.workflow.create({
      data: {
        name: 'AI Generated: ' + prompt.substring(0, 20) + '...',
        description: prompt,
        category: 'CUSTOM',
        businessId,
        status: WorkflowStatus.DRAFT,
        versions: {
          create: {
            versionNumber: 1,
            definition,
            trigger: {},
            createdBy: user.id
          }
        }
      },
      include: { versions: true }
    });

    await prisma.workflow.update({
      where: { id: workflow.id },
      data: { activeVersionId: workflow.versions[0].id }
    });

    res.json({ success: true, data: { workflowId: workflow.id } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Failed to generate workflow' });
  }
});


// GET /api/workflows
router.get('/', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    const workflows = await prisma.workflow.findMany({
      where: { businessId },
      include: { versions: true, template: true }
    });
    res.json({ success: true, data: workflows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch workflows' });
  }
});

// GET /api/workflows/configurations
router.get('/configurations', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, businessId } });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    const configurations = await prisma.workflow.findMany({
      where: { businessId, category: { in: ['ENQUIRY_INTAKE', 'ORDER_BOOKING', 'INVOICING', 'PAYMENT_COLLECTION', 'APPROVAL_GOVERNANCE', 'NOTIFICATION'] } },
      include: { versions: true }
    });
    res.json({ success: true, data: configurations });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch configurations' });
  }
});

// GET /api/workflows/configurations/:type
router.get('/configurations/:type', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const { type } = req.params;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, businessId } });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    const workflow = await prisma.workflow.findFirst({
      where: { businessId, category: type },
      include: { versions: true }
    });
    res.json({ success: true, data: workflow });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch configuration' });
  }
});

// PUT /api/workflows/configurations/:type
router.put('/configurations/:type', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const { type } = req.params;
  const { config, name, description } = req.body;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, businessId } });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    let workflow = await prisma.workflow.findFirst({ where: { businessId, category: type } });
    
    if (workflow) {
      workflow = await prisma.workflow.update({
        where: { id: workflow.id },
        data: {
          config: config ?? workflow.config,
          name: name ?? workflow.name,
          description: description ?? workflow.description,
        }
      });
    } else {
      workflow = await prisma.workflow.create({
        data: {
          businessId,
          name: name || type,
          category: type,
          description: description || `Workflow configuration for ${type}`,
          status: 'DRAFT',
          config: config || {},
          versions: {
            create: {
              versionNumber: 1,
              trigger: {},
              createdBy: user.id
            }
          }
        },
        include: { versions: true }
      });
      const createdWorkflow = await prisma.workflow.findUnique({ where: { id: workflow.id }, include: { versions: true } });
      if (createdWorkflow && createdWorkflow.versions.length > 0) {
        await prisma.workflow.update({
          where: { id: workflow.id },
          data: { activeVersionId: createdWorkflow.versions[0].id }
        });
      }
    }
    res.json({ success: true, data: workflow });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update configuration' });
  }
});

// GET /api/workflows/:type/fields
router.get('/:type/fields', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const { type } = req.params;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, businessId } });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    const fields = await prisma.workflowFieldDefinition.findMany({
      where: { businessId, workflowType: type },
      orderBy: { displayOrder: 'asc' }
    });
    res.json({ success: true, data: fields });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch fields' });
  }
});

// POST /api/workflows/:type/fields
router.post('/:type/fields', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const { type } = req.params;
  const { fieldKey, label, description, type: fieldType, required, options, defaultValue, validation, displayOrder, active } = req.body;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, businessId } });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    if ((fieldType === 'SELECT' || fieldType === 'MULTI_SELECT') && (!options || !Array.isArray(options) || options.length === 0)) {
      return res.status(400).json({ success: false, error: 'SELECT fields must have options' });
    }

    const field = await prisma.workflowFieldDefinition.create({
      data: {
        businessId,
        workflowType: type,
        fieldKey,
        label,
        description,
        type: fieldType,
        required: required || false,
        options: options || null,
        defaultValue: defaultValue || null,
        validation: validation || null,
        displayOrder: displayOrder || 0,
        active: active !== undefined ? active : true
      }
    });
    res.json({ success: true, data: field });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, error: 'Duplicate field key' });
    }
    res.status(500).json({ success: false, error: 'Failed to create field' });
  }
});

// PATCH /api/workflows/:type/fields/:id
router.patch('/:type/fields/:id', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const { id } = req.params;
  const { label, description, type: fieldType, required, options, defaultValue, validation, displayOrder, active } = req.body;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, businessId } });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    const existingField = await prisma.workflowFieldDefinition.findUnique({ where: { id } });
    if (!existingField || existingField.businessId !== businessId) {
      return res.status(404).json({ success: false, error: 'Field not found' });
    }

    if ((fieldType === 'SELECT' || fieldType === 'MULTI_SELECT' || existingField.type === 'SELECT' || existingField.type === 'MULTI_SELECT') && 
        req.body.hasOwnProperty('options') && (!options || !Array.isArray(options) || options.length === 0)) {
      return res.status(400).json({ success: false, error: 'SELECT fields must have options' });
    }

    const field = await prisma.workflowFieldDefinition.update({
      where: { id },
      data: {
        ...(label !== undefined && { label }),
        ...(description !== undefined && { description }),
        ...(fieldType !== undefined && { type: fieldType }),
        ...(required !== undefined && { required }),
        ...(options !== undefined && { options }),
        ...(defaultValue !== undefined && { defaultValue }),
        ...(validation !== undefined && { validation }),
        ...(displayOrder !== undefined && { displayOrder }),
        ...(active !== undefined && { active }),
      }
    });
    res.json({ success: true, data: field });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update field' });
  }
});

// DELETE /api/workflows/:type/fields/:id
router.delete('/:type/fields/:id', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const { id } = req.params;
  const user = (req as any).user;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, businessId } });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    const existingField = await prisma.workflowFieldDefinition.findUnique({ where: { id } });
    if (!existingField || existingField.businessId !== businessId) {
      return res.status(404).json({ success: false, error: 'Field not found' });
    }

    await prisma.workflowFieldDefinition.delete({ where: { id } });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete field' });
  }
});

// GET /api/workflows/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  const user = (req as any).user;

  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id },
      include: { 
        template: true,
        versions: { include: { steps: true } } 
      }
    });
    if (!workflow || workflow.businessId !== businessId) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }
    res.json({ success: true, data: workflow });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch workflow' });
  }
});

// PATCH /api/workflows/:id/config
router.patch('/:id/config', authenticate, async (req: Request, res: Response) => {
  const { businessId, config } = req.body;
  try {
    const workflow = await prisma.workflow.update({
      where: { id: req.params.id },
      data: { config }
    });
    res.json({ success: true, data: workflow });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update config' });
  }
});

// GET /api/workflows/:id/readiness
router.get('/:id/readiness', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id },
      include: { versions: true, template: true }
    });
    if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found' });
    
    const version = workflow.versions.find(v => v.id === workflow.activeVersionId) || workflow.versions[0];
    if (!version) return res.status(404).json({ success: false, error: 'Workflow version not found' });

    const checks: any[] = [];
    let isReady = true;

    // 1. Integration Checks
    for (const connectorId of version.requiredConnectors) {
      try {
        const def = getConnectorDefinition(connectorId);
        const integration = await prisma.integration.findFirst({
          where: { businessId: workflow.businessId, provider: connectorId }
        });

        if (!integration) {
          checks.push({ name: def.name, type: 'INTEGRATION', status: 'MISSING', connectUrl: `/dashboard/integrations` });
          isReady = false;
        } else if (integration.status === IntegrationStatus.RECONNECT_REQUIRED) {
          checks.push({ name: def.name, type: 'INTEGRATION', status: 'RECONNECT_REQUIRED' });
          isReady = false;
        } else {
          checks.push({ name: def.name, type: 'INTEGRATION', status: 'CONNECTED' });
        }
      } catch (err) {
         checks.push({ name: connectorId, type: 'INTEGRATION', status: 'UNKNOWN_PROVIDER' });
         isReady = false;
      }
    }

    // 1b. Capability Checks (Phase 4)
    if (version.requiredCapabilities && version.requiredCapabilities.length > 0) {
      const bindings = await prisma.workflowConnectorBinding.findMany({
        where: { workflowVersionId: version.id },
        include: { integration: true }
      });
      
      for (const cap of version.requiredCapabilities) {
        const binding = bindings.find(b => b.capability === cap);
        if (!binding) {
           checks.push({ name: `Capability: ${cap}`, type: 'CAPABILITY', status: 'MISSING', connectUrl: `/dashboard/workflows/${workflow.id}/setup-connectors` });
           isReady = false;
        } else if (binding.integration.status === IntegrationStatus.RECONNECT_REQUIRED) {
           checks.push({ name: `Capability: ${cap}`, type: 'CAPABILITY', status: 'RECONNECT_REQUIRED' });
           isReady = false;
        } else {
           checks.push({ name: `Capability: ${cap}`, type: 'CAPABILITY', status: 'CONNECTED' });
        }
      }
    }

    // 2. Configuration Check
    let configValid = true;
    if (workflow.template?.configurationSchema && Object.keys(workflow.template.configurationSchema).length > 0) {
      const schema = workflow.template.configurationSchema as Record<string, any>;
      const config = (workflow.config || {}) as Record<string, any>;
      for (const [key, field] of Object.entries(schema)) {
        if (field.required && (config[key] === undefined || config[key] === null || config[key] === '')) {
          configValid = false;
          break;
        }
      }
    }

    if (!configValid) {
      checks.push({ name: 'Configuration', status: 'MISSING' });
      isReady = false;
    } else {
      checks.push({ name: 'Configuration', status: 'VALID' });
    }

    // 3. Workflow Graph
    checks.push({ name: 'Workflow Graph', status: 'VALID' }); // Simplified for now
    
    res.json({ success: true, data: { ready: isReady, checks } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Readiness check failed' });
  }
});

// POST /api/workflows/:id/trigger
router.post('/:id/trigger', authenticate, async (req: Request, res: Response) => {
  const { businessId, payload, triggerType, idempotencyKey } = req.body;
  try {
    const executionId = await WorkflowEngine.triggerWorkflow(
      businessId,
      req.params.id,
      triggerType || 'MANUAL',
      payload || {},
      idempotencyKey
    );
    res.json({ success: true, data: { executionId } });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /api/workflows/:id/executions
router.get('/:id/executions', authenticate, async (req: Request, res: Response) => {
  try {
    const executions = await prisma.workflowExecution.findMany({
      where: { workflowId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take: 50
    });
    res.json({ success: true, data: executions });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch executions' });
  }
});

// POST /api/workflows/:id/activate
router.post('/:id/activate', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.body;
  try {
    // In a full implementation, we'd run readiness here before allowing ACTIVATE
    const workflow = await prisma.workflow.update({
      where: { id: req.params.id },
      data: { status: WorkflowStatus.ACTIVE }
    });
    res.json({ success: true, data: workflow });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to activate workflow' });
  }
});

// POST /api/workflows/:id/simulate
router.post('/:id/simulate', authenticate, async (req: Request, res: Response) => {
  // Mock simulation for now. Engine support needed for deep simulation
  res.json({ success: true, data: { message: "Simulation completed successfully" } });
});


// POST /api/workflows/:id/validate
router.post('/:id/validate', authenticate, async (req: Request, res: Response) => {
  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id },
      include: { template: true }
    });

    if (!workflow) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    const errors: string[] = [];
    let valid = true;

    if (workflow.template?.configurationSchema && Object.keys(workflow.template.configurationSchema).length > 0) {
      const schema = workflow.template.configurationSchema as Record<string, any>;
      const config = (workflow.config || {}) as Record<string, any>;
      for (const [key, field] of Object.entries(schema)) {
        if (field.required && (config[key] === undefined || config[key] === null || config[key] === '')) {
          valid = false;
          errors.push(`${field.label || key} is required`);
        }
      }
    }

    res.json({ success: true, data: { valid, errors } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Validation failed' });
  }
});

// DELETE /api/workflows/:id
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;
  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id }
    });

    if (!workflow) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    // Verify ownership via business
    if (businessId && workflow.businessId !== businessId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    await prisma.workflow.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete workflow' });
  }
});

// POST /api/workflows/:id/bindings
router.post('/:id/bindings', authenticate, async (req: Request, res: Response) => {
  const { businessId, capability, integrationId } = req.body;
  
  if (!businessId || !capability || !integrationId) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id }
    });

    if (!workflow || workflow.businessId !== businessId) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    if (!workflow.activeVersionId) {
      return res.status(400).json({ success: false, error: 'Workflow has no active version' });
    }

    // Upsert the binding for the active version
    const binding = await prisma.workflowConnectorBinding.upsert({
      where: {
        workflowVersionId_capability: {
          workflowVersionId: workflow.activeVersionId,
          capability
        }
      },
      update: { integrationId },
      create: {
        workflowId: workflow.id,
        workflowVersionId: workflow.activeVersionId,
        capability,
        integrationId
      }
    });

    res.json({ success: true, data: binding });
  } catch (error) {
    console.error('Update Binding Error:', error);
    res.status(500).json({ success: false, error: 'Failed to update binding' });
  }
});

export default router;
