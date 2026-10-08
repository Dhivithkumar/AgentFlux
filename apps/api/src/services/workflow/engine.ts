import { ExecutionStatus, WorkflowStep } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { resolveVariables, WorkflowContext } from './variableParser';
import { ActionExecutor } from './actionExecutor';
import { ActionRegistry } from './actionRegistry';
import { ConditionEngine } from './conditionEngine';
import { workflowQueue } from '../queue/workflowQueue';
import { aiManager } from '../ai';
import { knowledgeService } from '../knowledge';

export class WorkflowEngine {
  static async triggerWorkflow(
    businessId: string,
    workflowId: string,
    triggerType: string,
    triggerPayload: any,
    idempotencyKey?: string
  ) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, businessId, status: 'ACTIVE' },
      include: { versions: true }
    });

    if (!workflow || !workflow.activeVersionId) {
      throw new Error('Workflow not found or not active');
    }

    const version = workflow.versions.find(v => v.id === workflow.activeVersionId);
    if (!version) {
      throw new Error('Active workflow version not found');
    }

    if (idempotencyKey) {
      const existing = await prisma.workflowExecution.findUnique({
        where: { businessId_workflowId_idempotencyKey: { businessId, workflowId, idempotencyKey } }
      });
      if (existing) {
        console.log(`[WorkflowEngine] Execution already exists for idempotencyKey: ${idempotencyKey}. Skipping queue addition and returning existing execution ${existing.id}`);
        return existing.id;
      }
    }

    const initialContext: WorkflowContext = {
      trigger: triggerPayload,
      config: (workflow.config as Record<string, any>) || {},
      steps: {},
      variables: {}, 
      metadata: { triggerType }
    };

    const execution = await prisma.workflowExecution.create({
      data: {
        businessId,
        workflowId,
        workflowVersionId: version.id,
        triggerType,
        triggerPayload,
        status: ExecutionStatus.QUEUED,
        idempotencyKey,
        context: initialContext as any
      }
    });

    await workflowQueue.add('executeWorkflow', { executionId: execution.id }, {
      jobId: execution.id,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    });

    return execution.id;
  }

  static async resumeWorkflow(executionId: string, additionalContext: any = {}) {
     const execution = await prisma.workflowExecution.findUnique({ where: { id: executionId } });
     if (!execution || (execution.status !== ExecutionStatus.WAITING && execution.status !== ExecutionStatus.WAITING_APPROVAL)) return;

     let context = execution.context as any;
     context = { ...context, ...additionalContext };

     await prisma.workflowExecution.update({
       where: { id: executionId },
       data: { status: ExecutionStatus.QUEUED, context }
     });

     await workflowQueue.add('executeWorkflow', { executionId }, {
       jobId: `resume_${executionId}_${Date.now()}`,
       removeOnComplete: true,
       removeOnFail: false
     });
  }

  static async executeWorkflow(executionId: string) {
    let execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { version: { include: { steps: true } } }
    });

    if (!execution || (execution.status !== ExecutionStatus.QUEUED && execution.status !== ExecutionStatus.RETRYING)) {
      return;
    }

    execution = await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.RUNNING, startedAt: new Date() },
      include: { version: { include: { steps: true } } }
    });

    let context = execution.context as unknown as WorkflowContext;
    let steps = execution.version.steps as any[];
    
    if (!steps || steps.length === 0) {
      const dag = execution.version.definition as any;
      if (dag && dag.nodes) {
         steps = dag.nodes.map((n: any, idx: number) => ({
            id: n.id,
            stepId: n.id,
            stepOrder: idx,
            type: n.type,
            config: n.config || {},
            next: n.next || null,
            _isMock: true
         }));
      }
    }
    // Resume logic: if we have WAITING steps that are now READY?
    // Actually, execution engine will just find steps that are PENDING or RUNNING but failed previously if RETRYING.
    // To simplify: find entry points
    
    // Which steps are already complete?
    const completedStepIds = Object.keys(context.steps || {}).filter(k => context.steps[k].status === 'SUCCESS');
    
    const incomingEdges: Record<string, number> = {};
    steps.forEach(s => incomingEdges[s.stepId] = 0);
    steps.forEach(s => {
      const nextConf = s.next as any;
      if (Array.isArray(nextConf)) {
        nextConf.forEach(n => { if (incomingEdges[n] !== undefined) incomingEdges[n]++; });
      } else if (typeof nextConf === 'object' && nextConf !== null) {
        Object.values(nextConf).forEach((n: any) => { if (incomingEdges[n] !== undefined) incomingEdges[n]++; });
      }
    });

    // We start from nodes with 0 incoming edges that are NOT completed,
    // OR nodes where ALL their dependencies are completed.
    // A proper DAG runner tracks dependencies. For simplicity in parallel DAG:
    // we run any node whose incoming dependencies have all fired their next routing.
    
    let isSuspended = false;
    let hasFailed = false;
    const executedInSession = new Set<string>();

    const runNode = async (stepId: string): Promise<void> => {
      console.log(`runNode called for: ${stepId}`);
      if (hasFailed || isSuspended || executedInSession.has(stepId) || completedStepIds.includes(stepId)) {
        console.log(`runNode skipping ${stepId}. hasFailed=${hasFailed} isSusp=${isSuspended} inSession=${executedInSession.has(stepId)} completed=${completedStepIds.includes(stepId)}`);
        return;
      }
      
      const currentStep = steps.find(s => s.stepId === stepId);
      if (!currentStep) {
        console.log(`runNode step ${stepId} not found in steps!`);
        return;
      }
      executedInSession.add(stepId);

      let stepExecution: any = { id: `mock-${currentStep.stepId}` };
      if (!currentStep._isMock) {
        stepExecution = await prisma.workflowStepExecution.create({
          data: {
            executionId,
            stepId: currentStep.id,
            status: ExecutionStatus.RUNNING
          }
        });
      }

      let stepInput: any = {};
      let stepOutput: any = {};
      let nextNodes: string[] = [];

      try {
        const config = currentStep.config as any;
        stepInput = resolveVariables(config.inputs || {}, context);

        stepOutput = await this.executeNode(
          execution.businessId!,
          execution.workflowId,
          execution.id,
          currentStep,
          stepInput,
          context
        );

        if (stepOutput?._suspend) {
           isSuspended = true;
           if (!currentStep._isMock) {
             await prisma.workflowStepExecution.update({
               where: { id: stepExecution.id },
               data: { status: ExecutionStatus.WAITING, inputData: this.sanitize(stepInput) }
             });
           }
           
           if (stepOutput.waitType === 'EVENT') {
              context.metadata = context.metadata || {};
              context.metadata.waitingForEvent = stepOutput.waitingForEvent;
           }

           return; // Stop this branch
        }

        if (stepOutput?.status === 'FAILED') {
          throw new Error(stepOutput.error || 'Step execution failed');
        }

        context.steps[currentStep.stepId] = {
          input: stepInput,
          output: stepOutput,
          status: 'SUCCESS'
        };

        const nextConf = currentStep.next as any;
        console.log(`Evaluating nextConf for ${currentStep.stepId}:`, nextConf, `with route:`, stepOutput?.route);
        if (Array.isArray(nextConf) && nextConf.length > 0) {
          nextNodes = nextConf;
        } else if (typeof nextConf === 'object' && nextConf !== null) {
          const route = stepOutput?.route || 'DEFAULT';
          if (nextConf[route]) {
            nextNodes = [nextConf[route]];
          }
        } else if (!nextConf) {
           const nextChronological = steps.find(s => s.stepOrder === currentStep.stepOrder + 1);
           if (nextChronological) nextNodes = [nextChronological.stepId];
        }
        console.log(`Determined nextNodes for ${currentStep.stepId}:`, nextNodes);

        if (!currentStep._isMock) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExecution.id },
            data: {
              status: ExecutionStatus.SUCCESS,
              completedAt: new Date(),
              inputData: this.sanitize(stepInput),
              outputData: this.sanitize(stepOutput)
            }
          });
        }
      } catch (stepError: any) {
        hasFailed = true;
        if (!currentStep._isMock) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExecution.id },
            data: {
              status: ExecutionStatus.FAILED,
              completedAt: new Date(),
              inputData: this.sanitize(stepInput),
              error: stepError.message || 'Unknown node error'
            }
          });
        }
        context.steps[currentStep.stepId] = { input: stepInput, status: 'FAILED', error: stepError.message || String(stepError) };
        throw stepError;
      }

      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: { context: context as any }
      });

      const promises = nextNodes.map(id => runNode(id));
      await Promise.all(promises);
    };

    try {
      // Find starting nodes: 0 incoming edges OR explicitly waiting to be resumed
      let initialNodes = steps.filter(s => incomingEdges[s.stepId] === 0).map(s => s.stepId);
      
      // If we are resuming, we should find the step that was WAITING
      const waitingStepExec = await prisma.workflowStepExecution.findFirst({
         where: { executionId, status: ExecutionStatus.WAITING },
         include: { step: true }
      });
      if (waitingStepExec) {
         initialNodes = [waitingStepExec.step.stepId];
         // clean up the waiting step exec since we're retrying/resuming it
         await prisma.workflowStepExecution.delete({ where: { id: waitingStepExec.id } });
      } else if (initialNodes.length === 0) {
         const firstStep = steps.find(s => s.stepOrder === 1);
         if (firstStep) initialNodes = [firstStep.stepId];
      }

      console.log(`Starting execution ${executionId} with initialNodes:`, initialNodes);
      
      await Promise.all(initialNodes.map(id => runNode(id)));
      
      console.log(`Execution ${executionId} finished runNode promises.`);

      if (isSuspended) {
        await prisma.workflowExecution.update({
          where: { id: executionId },
          data: { status: ExecutionStatus.WAITING, context: context as any }
        });
      } else if (!hasFailed) {
        await prisma.workflowExecution.update({
          where: { id: executionId },
          data: { status: ExecutionStatus.SUCCESS, completedAt: new Date(), context: context as any }
        });
      }
    } catch (workflowError: any) {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.FAILED,
          completedAt: new Date(),
          context: context as any,
          error: workflowError.message || 'Workflow execution failed'
        }
      });
    }
  }

  private static async executeNode(
    businessId: string,
    workflowId: string,
    executionId: string,
    step: WorkflowStep,
    input: any,
    context: WorkflowContext
  ): Promise<any> {
    
    if (step.type === 'ACTION') {
       const config = step.config as any;
       // Internal Action
       if (config.actionId) {
          const handler = ActionRegistry.get(config.actionId);
          return await handler({ businessId, executionId, workflowId }, input);
       }
       
       if (config.connector === 'GMAIL' && config.action === 'gmail.send') {
          const to = resolveVariables({ text: config.to || '{{trigger.email.from}}' }, context).text;
          const subject = resolveVariables({ text: config.subject }, context).text;
          const body = resolveVariables({ text: config.body || '' }, context).text;
          let attachments = undefined;
          
          if (config.attachments) {
              if (typeof config.attachments === 'string' && config.attachments.startsWith('{{') && config.attachments.endsWith('}}')) {
                  const parts = config.attachments.slice(2, -2).split('.');
                  let current: any = context;
                  for (const part of parts) {
                      if (current && current[part] !== undefined) {
                          current = current[part];
                      } else {
                          current = undefined;
                          break;
                      }
                  }
                  attachments = current;
              } else {
                  attachments = config.attachments;
              }
          }
          
          return await ActionExecutor.execute(businessId, workflowId, executionId, 'GMAIL', 'send_email', { to, subject, body, attachments });
       }
       
       // Fallback for missing actionId (e.g. connector actions not mapped to TOOL_ACTION yet)
       return { status: 'SUCCESS', message: `Simulated action ${config.action || config.connector || 'Unknown'}` };
    }

    if (step.type === 'TOOL_ACTION' || step.type === 'CONNECTOR_ACTION') {
      const config = step.config as any;
      let connectorId = config.connectorId;
      if (config.capability) {
        const binding = await prisma.workflowConnectorBinding.findFirst({
           where: { workflowVersionId: step.workflowVersionId, capability: config.capability },
           include: { integration: true }
        });
        if (binding?.integration) connectorId = binding.integration.provider;
        else throw new Error(`Capability ${config.capability} not bound to integration.`);
      }
      if (!connectorId || !config.actionId) throw new Error('Missing connector config');
      return await ActionExecutor.execute(businessId, workflowId, executionId, connectorId, config.actionId, input);
    }
    
    if (step.type === 'CONDITION') {
      const route = ConditionEngine.evaluate(step.config, { input, context }) ? 'YES' : 'NO';
      return { route, evaluated: true };
    }

    if (step.type === 'APPROVAL') {
      const { GovernanceService } = require('../governance/GovernanceService');
      const { ApprovalService } = require('../governance/ApprovalService');
      
      // We will create an approval request for this execution
      // and suspend the workflow
      if (!context.metadata?.approvalRequestId) {
          const req = await ApprovalService.createApprovalRequest(
             businessId,
             'system',
             'WORKFLOW_STEP',
             'WorkflowExecution',
             executionId,
             { executionId, stepId: step.id, input },
             null,
             'Workflow requested approval'
          );
          // Just set suspend. We can't attach it to context safely here without returning
          return { _suspend: true, status: 'WAITING_APPROVAL', approvalRequestId: req.id };
      }
      return { status: 'APPROVED' };
    }

    if (step.type === 'DELAY') {
      // For delay, we need a chron or BullMQ delayed job.
      const config = step.config as any;
      const delayMs = config.delayMs || 60000;
      await workflowQueue.add('executeWorkflow', { executionId }, {
        jobId: `resume_${executionId}_${Date.now()}`,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: false
      });
      return { _suspend: true, status: 'WAITING_DELAY' };
    }

    if (step.type === 'WAIT_FOR_EVENT') {
      const config = step.config as any;
      if (context.metadata?.eventReceived) {
          const event = context.metadata.eventReceived;
          delete context.metadata.eventReceived;
          return { event, status: 'RESUMED' };
      }
      return { _suspend: true, waitType: 'EVENT', waitingForEvent: config };
    }

    if (step.type === 'TRIGGER') {
      return context.trigger;
    }

    if (step.type === 'AI_AGENT' || step.type === 'AI_TASK') {
      const config = step.config as any;
      try {
        const schema = config.outputSchema || { type: 'object', properties: { result: { type: 'string' } } };
        const result = await aiManager.generateStructured<any>({ prompt: config.task + '\n\nInput: ' + JSON.stringify(input), schema });
        return { ...result, status: 'SUCCESS' };
      } catch(e: any) {
        return { output: 'AI generation failed', error: e.message, status: 'FAILED' };
      }
    }
    if (step.type === 'RAG_SEARCH') {
      const config = step.config as any;
      try {
        const query = resolveVariables({ text: config.query || '' }, context).text || '';
        const limit = config.limit || 3;
        
        if (!query.trim()) {
           return { results: 'No specific query extracted to search knowledge base.', status: 'SUCCESS' };
        }
        
        const searchResults = await knowledgeService.searchKnowledgeBase({
          businessId,
          query,
          topK: limit
        });
        
        if (searchResults.length === 0) {
          return {
            results: '',
            status: 'SUCCESS_NO_RESULTS'
          };
        }

        const formattedResults = searchResults.map(r => r.content).join('\n---\n');
        
        return { 
           results: formattedResults,
           status: 'SUCCESS_WITH_RESULTS' 
        };
      } catch (error: any) {
        console.error('RAG Search failed:', error);
        return { 
          results: '',
          status: 'RETRIEVAL_FAILED', 
          errorCode: error.code || 'UNKNOWN_ERROR', 
          retryable: true 
        };
      }
    }

    throw new Error(`Unsupported node type: ${step.type}`);
  }

  private static sanitize(obj: any): any {
    if (!obj) return obj;
    const copy = JSON.parse(JSON.stringify(obj));
    const hideKeys = ['password', 'token', 'secret', 'authorization'];
    const scrub = (target: any) => {
      if (typeof target !== 'object' || target === null) return;
      for (const key in target) {
        if (hideKeys.some(hk => key.toLowerCase().includes(hk))) target[key] = '[REDACTED]';
        else if (typeof target[key] === 'object') scrub(target[key]);
      }
    };
    scrub(copy);
    return copy;
  }
}
