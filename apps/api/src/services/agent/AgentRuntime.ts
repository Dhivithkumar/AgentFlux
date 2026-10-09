import { prisma } from '@agent-flux/database';
import { aiManager } from '../ai';
import { ToolRegistry } from './ToolRegistry';

export class AgentRuntime {
  static async startExecution(
    businessId: string,
    agentId: string,
    triggerType: string,
    triggerData: any
  ) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId, businessId },
      include: { versions: true, permissions: true }
    });

    if (!agent || !agent.activeVersionId) {
      throw new Error('Agent or active version not found');
    }

    const version = agent.versions.find((v: any) => v.id === agent.activeVersionId);
    if (!version) {
      throw new Error('Agent active version missing');
    }

    const execution = await prisma.agentExecution.create({
      data: {
        businessId,
        agentId,
        agentVersionId: version.id,
        triggerType,
        triggerData,
        status: 'QUEUED',
        context: {
          history: [
            {
              role: 'user',
              content: `TRIGGER: ${triggerType}\nDATA: ${JSON.stringify(triggerData)}`
            }
          ]
        }
      }
    });

    // Enqueue execution in BullMQ (pseudo-code for now, will implement queue next)
    const { agentQueue } = require('../queue/agentQueue');
    await agentQueue.add('executeAgent', { executionId: execution.id });

    return execution.id;
  }

  static async resumeExecution(executionId: string, toolResult?: any) {
    let execution = await prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: { agent: { include: { permissions: true } }, version: true }
    });

    if (!execution || (execution.status !== 'QUEUED' && execution.status !== 'EXECUTING')) {
      return;
    }

    await prisma.agentExecution.update({
      where: { id: executionId },
      data: { status: 'EXECUTING' }
    });

    const context = execution.context as any;
    const history = context.history || [];

    if (toolResult) {
       history.push({
         role: 'model',
         parts: [{ functionResponse: { name: toolResult.name, response: toolResult.result } }]
       });
    }

    const agent = execution.agent;
    const version = execution.version;
    const allowedTools = ToolRegistry.getAllowedTools(agent.permissions);

    let currentStepNum = execution.currentStep + 1;
    let keepRunning = true;

    try {
      while (keepRunning && currentStepNum <= agent.maxSteps) {
        // Build system instruction
        let systemInstructions = version.systemInstructions || agent.systemInstructions || 'You are a helpful AI agent.';
        
        // Inject business knowledge if any
        systemInstructions += `\n\nBUSINESS KNOWLEDGE:\n[No knowledge loaded]`; // Placeholder for RAG

        const providerConfig = {
          model: agent.defaultModel,
          temperature: agent.temperature
        };

        const response = await aiManager.generateResponse({
          systemInstructions: systemInstructions,
          history: history,
          tools: allowedTools,
          config: providerConfig
        });

        const step = await prisma.agentExecutionStep.create({
          data: {
            executionId,
            stepNumber: currentStepNum,
            type: response.content.toolCalls ? 'TOOL_CALL' : 'MESSAGE',
            output: response.content as any,
            tokens: response.usage,
            latency: response.latency,
            status: 'COMPLETED'
          }
        });

        // Add model response to history
        if (response.content.toolCalls && response.content.toolCalls.length > 0) {
           history.push({
             role: 'model',
             parts: [{ functionCall: { name: response.content.toolCalls[0].name, args: response.content.toolCalls[0].arguments } }]
           });

           const toolCall = response.content.toolCalls[0];
           const tool = allowedTools.find((t: any) => t.name === toolCall.name);
           
           if (!tool) {
              history.push({ role: 'user', content: `Tool ${toolCall.name} not found or not allowed.` });
              currentStepNum++;
              continue;
           }

           // Check governance / permissions
           const perm = agent.permissions.find((p: any) => p.toolName === tool.name);
           if (perm?.permission === 'REQUIRES_APPROVAL') {
               await prisma.agentExecution.update({
                 where: { id: executionId },
                 data: { status: 'WAITING_FOR_APPROVAL', context: { ...context, history } }
               });
               // Create Approval Request...
               keepRunning = false;
               break;
           }

           // Execute tool safely
           try {
              const result = await tool.execute({ businessId: execution.businessId, executionId }, toolCall.arguments);
              history.push({
                role: 'user',
                parts: [{ functionResponse: { name: toolCall.name, response: result } }]
              });
           } catch (e: any) {
              history.push({
                role: 'user',
                parts: [{ functionResponse: { name: toolCall.name, response: { error: e.message } } }]
              });
           }
        } else {
           history.push({
             role: 'model',
             content: response.content.text
           });
           keepRunning = false; // Model decided to stop
        }
        
        currentStepNum++;
      }

      if (keepRunning === false && execution.status === 'EXECUTING') {
         await prisma.agentExecution.update({
           where: { id: executionId },
           data: { status: 'COMPLETED', completedAt: new Date(), context: { history } }
         });
      } else if (currentStepNum > agent.maxSteps) {
         await prisma.agentExecution.update({
           where: { id: executionId },
           data: { status: 'FAILED', error: 'Max steps exceeded', completedAt: new Date(), context: { history } }
         });
      }

    } catch (error: any) {
      await prisma.agentExecution.update({
        where: { id: executionId },
        data: { status: 'FAILED', error: error.message, completedAt: new Date(), context: { history } }
      });
    }
  }
}
