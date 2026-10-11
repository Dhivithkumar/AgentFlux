import { ExecutionStatus, WorkflowStep } from '@prisma/client';
import { prisma } from '@agent-flux/database';
import { resolveVariables, WorkflowContext } from './variableParser';
import { ActionExecutor } from './actionExecutor';
import { ActionRegistry } from './actionRegistry';
import { ConditionEngine } from './conditionEngine';
import { workflowQueue } from '../queue/workflowQueue';
import { aiManager } from '../ai';
import { knowledgeService } from '../knowledge';

export interface TriggerOptions {
  sync?: boolean;
}

export class WorkflowEngine {
  /**
   * Triggers a workflow execution for an active workflow version.
   * Execution is immutably pinned to the workflow's activeVersionId at trigger time.
   */
  static async triggerWorkflow(
    businessId: string,
    workflowId: string,
    triggerType: string,
    triggerPayload: any,
    idempotencyKey?: string,
    options?: TriggerOptions
  ): Promise<string> {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, businessId, status: 'ACTIVE' },
      include: { versions: true }
    });

    if (!workflow || !workflow.activeVersionId) {
      throw new Error(`Workflow ${workflowId} not found or not active`);
    }

    const version = workflow.versions.find(v => v.id === workflow.activeVersionId);
    if (!version) {
      throw new Error(`Active workflow version ${workflow.activeVersionId} not found`);
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
      trigger: triggerPayload || {},
      config: (workflow.config as Record<string, any>) || {},
      steps: {},
      variables: {}, 
      metadata: { triggerType, triggeredAt: new Date().toISOString() }
    };

    const execution = await prisma.workflowExecution.create({
      data: {
        businessId,
        workflowId,
        workflowVersionId: version.id, // Strictly pinned to this immutable version
        triggerType,
        triggerPayload: triggerPayload || {},
        status: ExecutionStatus.QUEUED,
        idempotencyKey,
        context: initialContext as any
      }
    });

    if (options?.sync) {
      await this.executeWorkflow(execution.id);
      return execution.id;
    }

    await workflowQueue.add('executeWorkflow', { executionId: execution.id }, {
      jobId: execution.id,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    });

    return execution.id;
  }

  /**
   * Cancels an in-flight or waiting workflow execution.
   */
  static async cancelWorkflow(executionId: string, reason?: string, cancelledBy?: string): Promise<boolean> {
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId }
    });

    if (!execution) return false;

    if (
      execution.status === ExecutionStatus.SUCCESS ||
      execution.status === ExecutionStatus.COMPLETED ||
      execution.status === ExecutionStatus.CANCELLED
    ) {
      return false;
    }

    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.CANCELLED,
        completedAt: new Date(),
        error: reason || `Cancelled by ${cancelledBy || 'user'}`
      }
    });

    console.log(`[WorkflowEngine] Execution ${executionId} cancelled. Reason: ${reason || 'N/A'}`);
    return true;
  }

  /**
   * Retries a failed or stuck workflow execution, optionally from a specific step.
   */
  static async retryExecution(executionId: string, fromStepId?: string, options?: TriggerOptions): Promise<void> {
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId }
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    let context = (execution.context as unknown as WorkflowContext) || {
      trigger: {},
      config: {},
      steps: {},
      variables: {},
      metadata: {}
    };

    if (fromStepId) {
      // Clear this step and any downstream steps from context
      if (context.steps && context.steps[fromStepId]) {
        delete context.steps[fromStepId];
      }
      // Delete any failed/waiting step executions for this step
      await prisma.workflowStepExecution.deleteMany({
        where: { executionId, step: { stepId: fromStepId } }
      });
    }

    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.QUEUED,
        error: null,
        context: context as any
      }
    });

    if (options?.sync) {
      await this.executeWorkflow(executionId);
      return;
    }

    await workflowQueue.add('executeWorkflow', { executionId }, {
      jobId: `retry_${executionId}_${Date.now()}`,
      removeOnComplete: true,
      removeOnFail: false
    });
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

  /**
   * Executes a queued or retrying workflow.
   * Guarantees immutable execution against the snapshot version linked to workflowVersionId.
   */
  static async executeWorkflow(executionId: string): Promise<void> {
    let execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: {
        version: {
          include: {
            steps: { orderBy: { stepOrder: 'asc' } }
          }
        }
      }
    });

    if (!execution || (execution.status !== ExecutionStatus.QUEUED && execution.status !== ExecutionStatus.RETRYING)) {
      return;
    }

    execution = await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.RUNNING, startedAt: new Date() },
      include: {
        version: {
          include: {
            steps: { orderBy: { stepOrder: 'asc' } }
          }
        }
      }
    });

    let context = (execution.context as unknown as WorkflowContext) || {
      trigger: (execution.triggerPayload as any) || {},
      config: {},
      steps: {},
      variables: {},
      metadata: {}
    };

    let steps = execution.version.steps as any[];
    
    // Fallback: If steps relation is empty, check version.definition.nodes
    if (!steps || steps.length === 0) {
      const dag = execution.version.definition as any;
      if (dag && dag.nodes) {
        steps = dag.nodes.map((n: any, idx: number) => ({
          id: n.id,
          stepId: n.id,
          stepOrder: idx + 1,
          type: n.type,
          name: n.name || n.id,
          config: n.config || {},
          next: n.next || null,
          retryPolicy: n.retryPolicy || null,
          errorHandler: n.errorHandler || null,
          failurePolicy: n.failurePolicy || null,
          continueOnError: n.continueOnError || false,
          _isMock: true
        }));
      }
    }

    if (!steps || steps.length === 0) {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.SUCCESS,
          completedAt: new Date(),
          context: context as any
        }
      });
      return;
    }

    // Determine workflow-level failure policy
    const versionDef = (execution.version.definition as any) || {};
    const defaultFailurePolicy = versionDef.failurePolicy || 'FAIL_FAST';

    const completedStepIds = Object.keys(context.steps || {}).filter(k => context.steps[k]?.status === 'SUCCESS');
    
    // Calculate incoming dependencies to find root entry points
    const incomingEdges: Record<string, number> = {};
    steps.forEach(s => incomingEdges[s.stepId] = 0);
    steps.forEach(s => {
      const nextConf = s.next as any;
      if (Array.isArray(nextConf)) {
        nextConf.forEach(n => { if (incomingEdges[n] !== undefined) incomingEdges[n]++; });
      } else if (typeof nextConf === 'object' && nextConf !== null) {
        Object.values(nextConf).forEach((target: any) => {
          if (Array.isArray(target)) {
            target.forEach(n => { if (incomingEdges[n] !== undefined) incomingEdges[n]++; });
          } else if (typeof target === 'string' && incomingEdges[target] !== undefined) {
            incomingEdges[target]++;
          }
        });
      }
    });

    let isSuspended = false;
    let hasFailed = false;
    const executedInSession = new Set<string>();

    const runNode = async (stepId: string): Promise<void> => {
      // 1. Check if execution has been cancelled concurrently
      const currentExec = await prisma.workflowExecution.findUnique({
        where: { id: executionId },
        select: { status: true }
      });
      if (currentExec?.status === ExecutionStatus.CANCELLED) {
        console.log(`[WorkflowEngine] Execution ${executionId} cancelled. Halting step ${stepId}`);
        return;
      }

      if (hasFailed || isSuspended || executedInSession.has(stepId) || completedStepIds.includes(stepId)) {
        return;
      }
      
      const currentStep = steps.find(s => s.stepId === stepId);
      if (!currentStep) {
        console.warn(`[WorkflowEngine] Step ${stepId} not found in version steps`);
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

      // Determine step failure & retry policy
      const retryPolicy = currentStep.retryPolicy || (currentStep.config?.retryPolicy) || {};
      const maxAttempts = Number(retryPolicy.maxAttempts) || 1;
      const backoffMs = Number(retryPolicy.delayMs) || 500;
      const stepFailurePolicy = currentStep.config?.failurePolicy || 
        currentStep.failurePolicy || 
        (currentStep.continueOnError ? 'CONTINUE_ON_FAILURE' : defaultFailurePolicy);

      let attempt = 0;
      let lastError: any = null;

      while (attempt < maxAttempts) {
        attempt++;
        try {
          const config = currentStep.config as any;
          stepInput = resolveVariables(config.inputs || config || {}, context);

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

            return; // Halt this branch cleanly for suspension
          }

          if (stepOutput?.status === 'FAILED') {
            throw new Error(stepOutput.error || 'Step execution returned failed status');
          }

          // Step succeeded
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
          if (attempt < maxAttempts) {
            console.log(`[WorkflowEngine] Step ${stepId} attempt ${attempt} failed: ${err.message}. Retrying in ${backoffMs}ms...`);
            await new Promise(res => setTimeout(res, backoffMs));
          }
        }
      }

      // Handle step outcome
      if (lastError) {
        const isContinueOnFailure = stepFailurePolicy === 'CONTINUE_ON_FAILURE' || 
          currentStep.continueOnError || 
          currentStep.errorHandler?.action === 'IGNORE';

        if (!currentStep._isMock) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExecution.id },
            data: {
              status: ExecutionStatus.FAILED,
              completedAt: new Date(),
              inputData: this.sanitize(stepInput),
              error: lastError.message || 'Unknown node error'
            }
          });
        }

        context.steps[currentStep.stepId] = {
          input: stepInput,
          status: 'FAILED',
          error: lastError.message || String(lastError)
        };

        if (isContinueOnFailure) {
          console.warn(`[WorkflowEngine] Step ${stepId} failed but CONTINUE_ON_FAILURE policy is active. Error: ${lastError.message}`);
          
          // Check if explicit error routing exists
          const nextConf = currentStep.next as any;
          if (nextConf && typeof nextConf === 'object' && nextConf['ON_FAILURE']) {
            const failureTarget = nextConf['ON_FAILURE'];
            nextNodes = Array.isArray(failureTarget) ? failureTarget : [failureTarget];
          } else if (currentStep.errorHandler?.nextStep) {
            nextNodes = [currentStep.errorHandler.nextStep];
          }
        } else {
          hasFailed = true;
          throw lastError;
        }
      } else {
        // Step succeeded
        context.steps[currentStep.stepId] = {
          input: stepInput,
          output: stepOutput,
          status: 'SUCCESS'
        };

        // Resolve next nodes based on routing configuration
        const nextConf = currentStep.next as any;
        if (Array.isArray(nextConf) && nextConf.length > 0) {
          nextNodes = nextConf;
        } else if (typeof nextConf === 'object' && nextConf !== null) {
          const route = stepOutput?.route || 'DEFAULT';
          const target = nextConf[route] !== undefined ? nextConf[route] : nextConf['DEFAULT'];
          if (target) {
            nextNodes = Array.isArray(target) ? target : [target];
          }
        } else if (!nextConf) {
          const nextChronological = steps.find(s => s.stepOrder === currentStep.stepOrder + 1);
          if (nextChronological) nextNodes = [nextChronological.stepId];
        }

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
      
      const waitingStepExec = await prisma.workflowStepExecution.findFirst({
        where: { executionId, status: ExecutionStatus.WAITING },
        include: { step: true }
      });

      if (waitingStepExec) {
        initialNodes = [waitingStepExec.step.stepId];
        await prisma.workflowStepExecution.delete({ where: { id: waitingStepExec.id } });
      } else if (initialNodes.length === 0) {
        const firstStep = steps.find(s => s.stepOrder === 1) || steps[0];
        if (firstStep) initialNodes = [firstStep.stepId];
      }

      await Promise.all(initialNodes.map(id => runNode(id)));

      // Final check on execution status
      const latestExec = await prisma.workflowExecution.findUnique({
        where: { id: executionId },
        select: { status: true }
      });

      if (latestExec?.status === ExecutionStatus.CANCELLED) {
        return;
      }

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
      
      // Internal Action registered in ActionRegistry
      if (config.actionId) {
        const handler = ActionRegistry.get(config.actionId);
        return await handler({ businessId, executionId, workflowId }, input);
      }
      
      // Direct Gmail send action
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
      
      // Specific action handlers or fallback
      return { status: 'SUCCESS', message: `Executed action ${config.action || config.connector || 'custom'}` };
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
      const branchRoute = ConditionEngine.evaluateBranch(step.config, {
        input,
        context,
        trigger: context.trigger,
        steps: context.steps,
        variables: context.variables
      });
      return { route: branchRoute, evaluated: true };
    }

    if (step.type === 'APPROVAL') {
      const { ApprovalService } = require('../governance/ApprovalService');
      
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
        return { _suspend: true, status: 'WAITING_APPROVAL', approvalRequestId: req.id };
      }
      return { status: 'APPROVED' };
    }

    if (step.type === 'DELAY') {
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
