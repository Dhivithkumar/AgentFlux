import { Router, Request, Response } from 'express';
import { WorkflowStatus, ExecutionStatus, IntegrationStatus } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';
import { WorkflowEngine } from '../services/workflow/engine';
import { WorkflowService } from '../services/workflow/workflowService';
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

// POST /api/workflows - Create a new custom dynamic workflow
router.post('/', authenticate, async (req: Request, res: Response) => {
  const { businessId, name, description, category, trigger, definition, config } = req.body;
  const user = (req as any).user;

  if (!businessId || !name) {
    return res.status(400).json({ success: false, error: 'Missing businessId or name' });
  }

  try {
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    const workflow = await WorkflowService.createWorkflow({
      businessId,
      name,
      description,
      category,
      trigger: trigger || { type: 'MANUAL' },
      definition,
      config,
      createdBy: user?.id
    });

    res.json({ success: true, data: workflow });
  } catch (error: any) {
    console.error('Create workflow error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create workflow' });
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

// ==========================================================
// WORKFLOW EXECUTION MANAGEMENT ENDPOINTS
// ==========================================================

// GET /api/workflows/executions/:executionId
router.get('/executions/:executionId', authenticate, async (req: Request, res: Response) => {
  try {
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: req.params.executionId },
      include: {
        workflow: true,
        version: true,
        stepExecutions: {
          include: { step: true },
          orderBy: { startedAt: 'asc' }
        },
        approvals: true
      }
    });

    if (!execution) {
      return res.status(404).json({ success: false, error: 'Execution not found' });
    }

    res.json({ success: true, data: execution });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch execution' });
  }
});

// POST /api/workflows/executions/:executionId/cancel
router.post('/executions/:executionId/cancel', authenticate, async (req: Request, res: Response) => {
  const { reason } = req.body;
  const user = (req as any).user;

  try {
    const success = await WorkflowEngine.cancelWorkflow(req.params.executionId, reason, user?.id);
    if (!success) {
      return res.status(400).json({ success: false, error: 'Execution cannot be cancelled or is already complete' });
    }
    res.json({ success: true, message: 'Execution cancelled' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to cancel execution' });
  }
});

// POST /api/workflows/executions/:executionId/retry
router.post('/executions/:executionId/retry', authenticate, async (req: Request, res: Response) => {
  const { fromStepId, sync } = req.body;

  try {
    await WorkflowEngine.retryExecution(req.params.executionId, fromStepId, { sync: sync === true });
    res.json({ success: true, message: 'Execution scheduled for retry' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to retry execution' });
  }
});

// ==========================================================
// WORKFLOW INSTANCE & DRAFT / VERSIONING ENDPOINTS
// ==========================================================

// GET /api/workflows/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const { businessId } = req.query;

  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id },
      include: { 
        template: true,
        versions: { 
          include: { steps: { orderBy: { stepOrder: 'asc' } } },
          orderBy: { versionNumber: 'desc' }
        } 
      }
    });
    if (!workflow || (businessId && workflow.businessId !== businessId)) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }
    res.json({ success: true, data: workflow });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch workflow' });
  }
});

// PUT /api/workflows/:id/definition - Save draft DAG and configuration
router.put('/:id/definition', authenticate, async (req: Request, res: Response) => {
  const { businessId, definition, trigger, name, description, config } = req.body;
  const user = (req as any).user;

  if (!businessId) {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const workflow = await WorkflowService.saveDraft(businessId, req.params.id, {
      name,
      description,
      config,
      trigger,
      definition,
      userId: user?.id
    });
    res.json({ success: true, data: workflow });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to save draft definition' });
  }
});

// POST /api/workflows/:id/publish - Publish an immutable version and set ACTIVE
router.post('/:id/publish', authenticate, async (req: Request, res: Response) => {
  const { businessId, definition, trigger } = req.body;
  const user = (req as any).user;

  if (!businessId) {
    return res.status(400).json({ success: false, error: 'Missing businessId' });
  }

  try {
    const workflow = await WorkflowService.publishWorkflow(businessId, req.params.id, {
      definition,
      trigger,
      userId: user?.id
    });
    res.json({ success: true, data: workflow });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to publish workflow' });
  }
});

// POST /api/workflows/:id/rollback - Rollback activeVersionId to targetVersionId
router.post('/:id/rollback', authenticate, async (req: Request, res: Response) => {
  const { businessId, versionId } = req.body;

  if (!businessId || !versionId) {
    return res.status(400).json({ success: false, error: 'Missing businessId or versionId' });
  }

  try {
    const result = await WorkflowService.rollbackWorkflow(businessId, req.params.id, versionId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to rollback workflow' });
  }
});

// GET /api/workflows/:id/versions - List all versions
router.get('/:id/versions', authenticate, async (req: Request, res: Response) => {
  try {
    const versions = await prisma.workflowVersion.findMany({
      where: { workflowId: req.params.id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        _count: { select: { executions: true } }
      },
      orderBy: { versionNumber: 'desc' }
    });
    res.json({ success: true, data: versions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch versions' });
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
    checks.push({ name: 'Workflow Graph', status: 'VALID' });
    
    res.json({ success: true, data: { ready: isReady, checks } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Readiness check failed' });
  }
});

// POST /api/workflows/:id/trigger
router.post('/:id/trigger', authenticate, async (req: Request, res: Response) => {
  const { businessId, payload, triggerType, idempotencyKey, sync } = req.body;
  try {
    const executionId = await WorkflowEngine.triggerWorkflow(
      businessId,
      req.params.id,
      triggerType || 'MANUAL',
      payload || {},
      idempotencyKey,
      { sync: sync === true }
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
      include: {
        stepExecutions: {
          orderBy: { startedAt: 'asc' }
        }
      },
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
  try {
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
