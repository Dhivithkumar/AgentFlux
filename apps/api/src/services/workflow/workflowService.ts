import { prisma } from '@agent-flux/database';
import { WorkflowStatus, RiskLevel } from '@prisma/client';

export interface WorkflowNodeDefinition {
  id: string;
  type: string;
  name?: string;
  config: Record<string, any>;
  next?: any; // string[] | Record<string, string | string[]>
  retryPolicy?: {
    maxAttempts?: number;
    delayMs?: number;
    backoff?: 'FIXED' | 'EXPONENTIAL';
  };
  errorHandler?: {
    action?: 'FAIL' | 'IGNORE' | 'ROUTE';
    nextStep?: string;
  };
  failurePolicy?: 'FAIL_FAST' | 'CONTINUE_ON_FAILURE';
  continueOnError?: boolean;
}

export interface WorkflowDAGDefinition {
  nodes: WorkflowNodeDefinition[];
  failurePolicy?: 'FAIL_FAST' | 'CONTINUE_ON_FAILURE';
  variables?: Record<string, any>;
}

export class WorkflowService {
  /**
   * Creates a new workflow in DRAFT status with initial Version 1.
   */
  static async createWorkflow(params: {
    businessId: string;
    name: string;
    description?: string;
    category?: string;
    trigger: {
      type: 'EVENT' | 'SCHEDULE' | 'MANUAL';
      eventType?: string;
      cron?: string;
      filters?: any;
    };
    definition?: WorkflowDAGDefinition;
    config?: Record<string, any>;
    createdBy?: string;
  }) {
    const { businessId, name, description, category, trigger, definition, config, createdBy } = params;

    const initialDef = definition || {
      nodes: [
        {
          id: 'step_1',
          type: 'TRIGGER',
          name: 'Initial Trigger',
          config: trigger
        }
      ]
    };

    const workflow = await prisma.workflow.create({
      data: {
        businessId,
        name,
        description: description || '',
        category: category || 'CUSTOM',
        status: WorkflowStatus.DRAFT,
        config: config || {},
        createdBy,
        versions: {
          create: {
            versionNumber: 1,
            definition: initialDef as any,
            trigger: trigger as any,
            requiredConnectors: [],
            optionalConnectors: [],
            requiredCapabilities: [],
            status: 'DRAFT',
            createdBy
          }
        }
      },
      include: { versions: true }
    });

    const v1 = workflow.versions[0];
    await this.compileStepsForVersion(v1.id, initialDef.nodes);

    await prisma.workflow.update({
      where: { id: workflow.id },
      data: { activeVersionId: v1.id }
    });

    return await prisma.workflow.findUnique({
      where: { id: workflow.id },
      include: { versions: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } }
    });
  }

  /**
   * Saves a draft definition or config without modifying already published/active versions.
   */
  static async saveDraft(
    businessId: string,
    workflowId: string,
    data: {
      name?: string;
      description?: string;
      config?: Record<string, any>;
      trigger?: any;
      definition?: WorkflowDAGDefinition;
      userId?: string;
    }
  ) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, businessId },
      include: { versions: true }
    });

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found for business ${businessId}`);
    }

    // Update workflow top-level attributes
    await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.config && { config: data.config })
      }
    });

    // Find the latest draft version, or create one if latest is already published
    let draftVersion = workflow.versions.find(v => v.status === 'DRAFT');

    if (!draftVersion) {
      const highestVersion = Math.max(...workflow.versions.map(v => v.versionNumber), 0);
      const activeVersion = workflow.versions.find(v => v.id === workflow.activeVersionId);

      draftVersion = await prisma.workflowVersion.create({
        data: {
          workflowId,
          versionNumber: highestVersion + 1,
          status: 'DRAFT',
          definition: (data.definition || activeVersion?.definition || { nodes: [] }) as any,
          trigger: (data.trigger || activeVersion?.trigger || { type: 'MANUAL' }) as any,
          requiredConnectors: activeVersion?.requiredConnectors || [],
          optionalConnectors: activeVersion?.optionalConnectors || [],
          requiredCapabilities: activeVersion?.requiredCapabilities || [],
          createdBy: data.userId
        }
      });
    } else {
      await prisma.workflowVersion.update({
        where: { id: draftVersion.id },
        data: {
          ...(data.definition && { definition: data.definition as any }),
          ...(data.trigger && { trigger: data.trigger as any })
        }
      });
    }

    // If definition was passed, compile draft steps
    if (data.definition?.nodes) {
      await this.compileStepsForVersion(draftVersion.id, data.definition.nodes);
    }

    return await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: { versions: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } }
    });
  }

  /**
   * Publishes the workflow:
   * Takes the current draft (or creates a new published version from definition),
   * marks it as 'PUBLISHED', binds compiled WorkflowStep records immutably,
   * sets workflow.activeVersionId = publishedVersion.id,
   * and sets workflow.status = 'ACTIVE'.
   */
  static async publishWorkflow(
    businessId: string,
    workflowId: string,
    options?: {
      definition?: WorkflowDAGDefinition;
      trigger?: any;
      userId?: string;
    }
  ) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, businessId },
      include: { versions: { include: { steps: true } } }
    });

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const highestVersion = Math.max(...workflow.versions.map(v => v.versionNumber), 0);
    const existingDraft = workflow.versions.find(v => v.status === 'DRAFT');

    let publishedVersion;

    const targetDef: WorkflowDAGDefinition = options?.definition || 
      (existingDraft?.definition as any) || 
      (workflow.versions.find(v => v.id === workflow.activeVersionId)?.definition as any) || 
      { nodes: [] };

    const targetTrigger = options?.trigger || 
      (existingDraft?.trigger as any) || 
      (workflow.versions.find(v => v.id === workflow.activeVersionId)?.trigger as any) || 
      { type: 'MANUAL' };

    // Create an immutable new published version
    publishedVersion = await prisma.workflowVersion.create({
      data: {
        workflowId,
        versionNumber: highestVersion + 1,
        status: 'PUBLISHED',
        definition: targetDef as any,
        trigger: targetTrigger as any,
        requiredConnectors: this.extractRequiredConnectors(targetDef.nodes),
        optionalConnectors: [],
        requiredCapabilities: [],
        createdBy: options?.userId
      }
    });

    // Compile steps for this version
    await this.compileStepsForVersion(publishedVersion.id, targetDef.nodes);

    // If there was an old draft, we can delete or keep it. Let's mark it SUPERSEDED or delete it
    if (existingDraft) {
      await prisma.workflowVersion.delete({ where: { id: existingDraft.id } }).catch(() => {});
    }

    // Set activeVersionId and workflow status to ACTIVE
    await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        activeVersionId: publishedVersion.id,
        status: WorkflowStatus.ACTIVE
      }
    });

    return await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: {
        versions: {
          where: { id: publishedVersion.id },
          include: { steps: { orderBy: { stepOrder: 'asc' } } }
        }
      }
    });
  }

  /**
   * Rollback workflow activeVersionId to an existing published version.
   */
  static async rollbackWorkflow(businessId: string, workflowId: string, targetVersionId: string) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, businessId },
      include: { versions: true }
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const targetVersion = workflow.versions.find(v => v.id === targetVersionId);
    if (!targetVersion) {
      throw new Error(`Target version ${targetVersionId} not found for this workflow`);
    }

    await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        activeVersionId: targetVersion.id,
        status: WorkflowStatus.ACTIVE
      }
    });

    return {
      success: true,
      workflowId,
      activeVersionId: targetVersion.id,
      versionNumber: targetVersion.versionNumber
    };
  }

  /**
   * Compiles DAG node definitions into relational WorkflowStep rows.
   */
  private static async compileStepsForVersion(workflowVersionId: string, nodes: WorkflowNodeDefinition[]) {
    // Delete any existing steps for this version
    await prisma.workflowStep.deleteMany({
      where: { workflowVersionId }
    });

    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return;
    }

    // Insert steps with 1-based ordering
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      await prisma.workflowStep.create({
        data: {
          workflowVersionId,
          stepOrder: i + 1,
          stepId: node.id,
          name: node.name || node.id,
          type: node.type,
          config: node.config || {},
          next: node.next ? (node.next as any) : null,
          retryPolicy: node.retryPolicy ? (node.retryPolicy as any) : null,
          errorHandler: node.errorHandler ? (node.errorHandler as any) : null
        }
      });
    }
  }

  private static extractRequiredConnectors(nodes: WorkflowNodeDefinition[]): string[] {
    const connectors = new Set<string>();
    for (const node of nodes || []) {
      if (node.config?.connector) {
        connectors.add(String(node.config.connector).toLowerCase());
      }
      if (node.config?.connectorId) {
        connectors.add(String(node.config.connectorId).toLowerCase());
      }
    }
    return Array.from(connectors);
  }
}
