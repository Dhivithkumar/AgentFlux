import { ToolRegistry } from './ToolRegistry';
import { prisma } from '@agent-flux/database';
import { WorkflowEngine } from '../workflow/engine';
import { ApprovalService } from '../governance/ApprovalService';

ToolRegistry.register({
  name: 'get_customer',
  description: 'Retrieve details of a customer by their email or ID',
  inputSchema: {
    properties: {
      email: { type: 'string' },
      customerId: { type: 'string' }
    }
  },
  category: 'CRM',
  riskLevel: 'LOW',
  requiredPermissions: ['CRM.READ'],
  execute: async (context, input) => {
    const { businessId } = context;
    let customer;
    if (input.customerId) {
      customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
    } else if (input.email) {
      customer = await prisma.customer.findFirst({ where: { businessId, email: input.email } });
    }
    
    if (!customer || customer.businessId !== businessId) {
       throw new Error('Customer not found');
    }
    return customer;
  }
});

ToolRegistry.register({
  name: 'search_knowledge',
  description: 'Search the business knowledge base for information, policies, pricing, and FAQs.',
  inputSchema: {
    properties: {
      query: { type: 'string', description: 'The search query' }
    },
    required: ['query']
  },
  category: 'KNOWLEDGE',
  riskLevel: 'LOW',
  requiredPermissions: ['KNOWLEDGE.READ'],
  execute: async (context, input) => {
     const { knowledgeService } = require('../knowledge');
     const searchResults = await knowledgeService.searchKnowledgeBase({
         businessId: context.businessId,
         query: input.query,
         topK: 5
     });
     return { results: searchResults };
  }
});

ToolRegistry.register({
  name: 'trigger_workflow',
  description: 'Triggers a Phase 8 background workflow (e.g. create quotation, send email).',
  inputSchema: {
    properties: {
      workflowId: { type: 'string' },
      payload: { type: 'object' }
    },
    required: ['workflowId', 'payload']
  },
  category: 'WORKFLOW',
  riskLevel: 'HIGH',
  requiredPermissions: ['WORKFLOW.EXECUTE'],
  execute: async (context, input) => {
    const { businessId } = context;
    const executionId = await WorkflowEngine.triggerWorkflow(
      businessId,
      input.workflowId,
      'AGENT',
      input.payload
    );
    return { success: true, executionId };
  }
});

ToolRegistry.register({
  name: 'request_approval',
  description: 'Request a human approval for a specific action.',
  inputSchema: {
    properties: {
      actionType: { type: 'string' },
      reason: { type: 'string' },
      contextPayload: { type: 'object' }
    },
    required: ['actionType', 'reason', 'contextPayload']
  },
  category: 'GOVERNANCE',
  riskLevel: 'LOW',
  requiredPermissions: ['APPROVAL.CREATE'],
  execute: async (context, input) => {
    const { businessId, executionId } = context;
    const req = await ApprovalService.createApprovalRequest(
      businessId,
      'system',
      input.actionType,
      'AgentExecution',
      executionId,
      input.contextPayload,
      null,
      input.reason
    );
    return { success: true, approvalRequestId: req.id };
  }
});
