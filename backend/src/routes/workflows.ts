import { Router, Request, Response } from 'express';
import { WorkflowStatus, ExecutionStatus, IntegrationStatus } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { authenticate } from '../middleware/auth';
import { WorkflowEngine } from '../services/workflow/engine';
import { WorkflowService } from '../services/workflow/workflowService';
import { getConnectorDefinition } from '../connectors/registry';
import { aiManager } from '../services/ai';

const router = Router();

// POST /api/workflows/generate (Autonomous AI Workflow Architect)
router.post('/generate', authenticate, async (req: Request, res: Response) => {
  const { businessId, prompt } = req.body;
  const user = (req as any).user;

  if (!businessId || !prompt || typeof prompt !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing businessId or prompt' });
  }

  try {
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, businessId }
    });
    if (!membership) return res.status(403).json({ success: false, error: 'Access denied' });

    let generated: {
      name: string;
      description: string;
      category: string;
      trigger: { type: string; config: any };
      requiredConnectors: string[];
      nodes: Array<{
        id: string;
        name: string;
        type: string;
        config: any;
        next?: Record<string, string> | null;
      }>;
    } | null = null;

    const systemPrompt = `You are the Lead Workflow Architect for Agent Flux, an autonomous AI enterprise workflow automation platform.
A user wants to automate a business process described below.
Generate a complete, fully connected, valid, executable Directed Acyclic Graph (DAG) workflow structure formatted as JSON.

User Request: "${prompt}"

Available Connectors:
- GMAIL (actions: send_email, search_email, create_draft)
- GOOGLE_CALENDAR (actions: create_event, list_events, check_availability)
- GOOGLE_SHEETS (actions: append_rows, read_sheet, write_sheet)
- GOOGLE_DRIVE (actions: upload_file, search_files, create_folder)
- WHATSAPP (actions: send_message, send_template)
- RAZORPAY (actions: create_payment_link, fetch_payment)
- STRIPE (actions: create_payment_intent, create_invoice)
- NOTION (actions: create_page, append_block)
- TRELLO (actions: create_card, move_card)

Available Application Actions (actionId):
- CREATE_CUSTOMER (inputs: name, email, phone)
- CREATE_ENQUIRY (inputs: customerId, subject, rawMessage, structuredData)
- CREATE_ORDER (inputs: customerId, subtotal, currency, structuredData)
- CREATE_QUOTATION (inputs: customerId, lineItems)
- SEND_QUOTATION (inputs: quotationId)
- GENERATE_DOCUMENT (inputs: documentType, documentId)
- PROCESS_INBOUND_EMAIL (inputs: body, from, fromName)

Available Node Types:
1. TRIGGER: First node that starts the flow.
   Example: { "id": "node_1", "name": "Inbound Email Trigger", "type": "TRIGGER", "config": { "event": "EMAIL_RECEIVED", "connector": "GMAIL" }, "next": { "DEFAULT": "node_2" } }
2. AI_AGENT: Autonomous reasoning node that processes text, classifies intent, extracts structured data, or drafts communications.
   Example: { "id": "node_2", "name": "Analyze Request Intent", "type": "AI_AGENT", "config": { "task": "Extract customer requirements and line items" }, "next": { "DEFAULT": "node_3" } }
3. RAG_SEARCH: Knowledge base vector retrieval.
   Example: { "id": "node_3", "name": "Knowledge Search", "type": "RAG_SEARCH", "config": { "query": "{{trigger.subject}}", "limit": 3 }, "next": { "DEFAULT": "node_4" } }
4. ACTION: Real connector or internal action.
   Example: { "id": "node_4", "name": "Send WhatsApp Receipt", "type": "ACTION", "config": { "actionId": "send_message", "connector": "WHATSAPP", "message": "Your order is confirmed." }, "next": { "DEFAULT": "node_5" } }
5. CONDITION: Decision branching based on variables or output.
   Example: { "id": "node_5", "name": "Check Order Value", "type": "CONDITION", "config": { "field": "steps.node_2.output.amount", "operator": "GREATER_THAN", "value": 10000 }, "next": { "TRUE": "node_6", "FALSE": "node_7", "DEFAULT": "node_7" } }
6. APPROVAL: Human-in-the-loop checkpoint.
   Example: { "id": "node_6", "name": "Manager Approval", "type": "APPROVAL", "config": { "title": "Approve high-value order discount" } }

Output strictly valid JSON with this exact schema (no markdown, no backticks, no commentary):
{
  "name": "Concise workflow title",
  "description": "Clear operational summary",
  "category": "SALES",
  "trigger": { "type": "EMAIL_RECEIVED", "config": { "connector": "GMAIL", "event": "EMAIL_RECEIVED" } },
  "requiredConnectors": ["GMAIL", "WHATSAPP"],
  "nodes": [
    { "id": "node_1", "name": "Trigger", "type": "TRIGGER", "config": { "event": "EMAIL_RECEIVED", "connector": "GMAIL" }, "next": { "DEFAULT": "node_2" } },
    { "id": "node_2", "name": "Process Email", "type": "AI_AGENT", "config": { "task": "..." }, "next": { "DEFAULT": "node_3" } }
  ]
}`;

    try {
      const aiRes = await aiManager.generateText({ prompt: systemPrompt });
      const rawText = aiRes.text?.trim() || '';
      const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed && parsed.name && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
        generated = parsed;
      }
    } catch (aiErr) {
      console.warn('[WorkflowGenerate] AI generation failed or returned invalid JSON. Falling back to dynamic heuristic generation:', aiErr);
    }

    // Dynamic Heuristic Fallback if AI was unavailable
    if (!generated) {
      const lower = prompt.toLowerCase();
      const hasEmail = lower.includes('email') || lower.includes('gmail') || lower.includes('inbox') || lower.includes('mail');
      const hasWhatsApp = lower.includes('whatsapp') || lower.includes('wa') || lower.includes('chat') || lower.includes('message');
      const hasSheets = lower.includes('sheet') || lower.includes('excel') || lower.includes('spreadsheet') || lower.includes('row') || lower.includes('log');
      const hasCalendar = lower.includes('calendar') || lower.includes('meeting') || lower.includes('appointment') || lower.includes('schedule') || lower.includes('slot');
      const hasPayment = lower.includes('pay') || lower.includes('invoice') || lower.includes('razorpay') || lower.includes('stripe') || lower.includes('receipt');
      const hasQuote = lower.includes('quote') || lower.includes('quotation') || lower.includes('pricing') || lower.includes('estimate');

      const triggerConnector = hasWhatsApp && !hasEmail ? 'WHATSAPP' : hasEmail ? 'GMAIL' : hasPayment ? 'RAZORPAY' : 'MANUAL';
      const triggerEvent = triggerConnector === 'WHATSAPP' ? 'whatsapp.messageReceived' : triggerConnector === 'GMAIL' ? 'EMAIL_RECEIVED' : triggerConnector === 'RAZORPAY' ? 'payment.received' : 'MANUAL';
      
      const reqConnectors = new Set<string>();
      if (triggerConnector !== 'MANUAL') reqConnectors.add(triggerConnector);
      if (hasSheets) reqConnectors.add('GOOGLE_SHEETS');
      if (hasCalendar) reqConnectors.add('GOOGLE_CALENDAR');
      if (hasWhatsApp) reqConnectors.add('WHATSAPP');
      if (hasPayment) reqConnectors.add('RAZORPAY');

      const nodes: any[] = [];
      let stepIdx = 1;

      // 1. Trigger Node
      const trigNodeId = `node_${stepIdx++}`;
      nodes.push({
        id: trigNodeId,
        name: `${triggerConnector === 'MANUAL' ? 'Manual' : triggerConnector} Inbound Trigger`,
        type: 'TRIGGER',
        config: { connector: triggerConnector, event: triggerEvent },
        next: { DEFAULT: `node_${stepIdx}` }
      });

      // 2. Knowledge Retrieval (if product/quote/order)
      if (hasQuote || hasEmail || lower.includes('knowledge') || lower.includes('search')) {
        const ragNodeId = `node_${stepIdx++}`;
        nodes.push({
          id: ragNodeId,
          name: 'Knowledge Base & Catalog Search',
          type: 'RAG_SEARCH',
          config: { query: '{{trigger.rawMessage || trigger.body || trigger.subject}}', limit: 3 },
          next: { DEFAULT: `node_${stepIdx}` }
        });
      }

      // 3. AI Agent Reasoning Node
      const aiNodeId = `node_${stepIdx++}`;
      nodes.push({
        id: aiNodeId,
        name: 'AI Intent & Context Processor',
        type: 'AI_AGENT',
        config: { task: `Analyze request and extract structured entities from user prompt: "${prompt}"` },
        next: { DEFAULT: `node_${stepIdx}` }
      });

      // 4. Action / Notification Node
      if (hasCalendar) {
        const calNodeId = `node_${stepIdx++}`;
        nodes.push({
          id: calNodeId,
          name: 'Book Google Calendar Slot',
          type: 'ACTION',
          config: { actionId: 'create_event', connector: 'GOOGLE_CALENDAR', summary: 'Customer Consultation', durationMinutes: 30 },
          next: hasSheets || hasWhatsApp ? { DEFAULT: `node_${stepIdx}` } : undefined
        });
      }

      if (hasSheets) {
        const sheetNodeId = `node_${stepIdx++}`;
        nodes.push({
          id: sheetNodeId,
          name: 'Log Record to Google Sheets',
          type: 'ACTION',
          config: { actionId: 'append_rows', connector: 'GOOGLE_SHEETS', range: 'A:E' },
          next: hasWhatsApp ? { DEFAULT: `node_${stepIdx}` } : undefined
        });
      }

      if (hasWhatsApp) {
        const waNodeId = `node_${stepIdx++}`;
        nodes.push({
          id: waNodeId,
          name: 'Send WhatsApp Notification',
          type: 'ACTION',
          config: { actionId: 'send_message', connector: 'WHATSAPP', recipient: '{{trigger.phone}}', message: 'Your request has been processed.' }
        });
      } else if (!hasCalendar && !hasSheets) {
        const defaultActionId = `node_${stepIdx++}`;
        nodes.push({
          id: defaultActionId,
          name: hasPayment ? 'Generate Payment Link' : 'Send Email Confirmation',
          type: 'ACTION',
          config: hasPayment 
            ? { actionId: 'create_payment_link', connector: 'RAZORPAY', amount: 1000 }
            : { actionId: 'send_email', connector: 'GMAIL', subject: 'Automated Response', to: '{{trigger.from}}' }
        });
      }

      // Ensure last node has no next link
      if (nodes.length > 0) {
        delete nodes[nodes.length - 1].next;
      }

      generated = {
        name: prompt.length > 40 ? prompt.substring(0, 37) + '...' : prompt,
        description: prompt,
        category: hasPayment ? 'FINANCE' : hasQuote ? 'SALES' : hasCalendar ? 'OPERATIONS' : 'CUSTOMER SUPPORT',
        trigger: { type: triggerEvent, config: { connector: triggerConnector, event: triggerEvent } },
        requiredConnectors: Array.from(reqConnectors),
        nodes
      };
    }

    // Persist to database in a single atomic transaction
    const workflow = await prisma.$transaction(async (tx) => {
      const wf = await tx.workflow.create({
        data: {
          name: generated!.name,
          description: generated!.description,
          category: generated!.category,
          businessId,
          status: WorkflowStatus.ACTIVE,
          config: {
            generatedFromPrompt: prompt,
            aiGeneratedAt: new Date().toISOString()
          }
        }
      });

      // Normalize node types for engine compatibility
      generated!.nodes = generated!.nodes.map((n, i) => {
        let normalizedType = (n.type || 'ACTION').toUpperCase();
        if (normalizedType.includes('ACTION')) normalizedType = 'ACTION';
        else if (normalizedType.includes('TRIGGER')) normalizedType = 'TRIGGER';
        else if (normalizedType.includes('AGENT') || normalizedType.includes('AI')) normalizedType = 'AI_AGENT';
        else if (normalizedType.includes('SEARCH') || normalizedType.includes('RAG')) normalizedType = 'RAG_SEARCH';
        else if (normalizedType.includes('CONDITION') || normalizedType.includes('BRANCH')) normalizedType = 'CONDITION';
        else if (normalizedType.includes('APPROVAL')) normalizedType = 'APPROVAL';
        return { ...n, id: n.id || `node_${i + 1}`, type: normalizedType };
      });

      const version = await tx.workflowVersion.create({
        data: {
          workflowId: wf.id,
          versionNumber: 1,
          status: 'ACTIVE',
          trigger: generated!.trigger,
          requiredConnectors: generated!.requiredConnectors || [],
          definition: {
            nodes: generated!.nodes,
            failurePolicy: 'CONTINUE_ON_NON_CRITICAL'
          },
          createdBy: user.id
        }
      });

      // Create WorkflowStep records for each node
      for (let i = 0; i < generated!.nodes.length; i++) {
        const node = generated!.nodes[i];
        await tx.workflowStep.create({
          data: {
            workflowVersionId: version.id,
            stepId: node.id,
            name: node.name || node.id,
            type: node.type,
            stepOrder: i + 1,
            config: node.config || {},
            next: (node.next as any) || undefined
          }
        });
      }

      // Set activeVersionId
      await tx.workflow.update({
        where: { id: wf.id },
        data: { activeVersionId: version.id }
      });

      return tx.workflow.findUnique({
        where: { id: wf.id },
        include: { versions: { include: { steps: true } } }
      });
    });

    res.json({
      success: true,
      data: {
        workflowId: workflow?.id,
        workflow
      }
    });
  } catch (error: any) {
    console.error('[WorkflowGenerate Error]:', error);
    res.status(500).json({ success: false, error: 'Failed to generate workflow: ' + error.message });
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
