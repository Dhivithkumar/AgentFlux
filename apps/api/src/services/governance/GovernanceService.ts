import { prisma } from '@agent-flux/database';
import { PolicyEvaluationService } from './PolicyEvaluationService';

const db = prisma as any;

export class GovernanceService {
  /**
   * Evaluates if a given action requires approval based on the business's active governance policies.
   */
  public static async evaluateAction(
    businessId: string,
    actionType: string,
    context: Record<string, any>
  ) {
    const policies = await db.governancePolicy.findMany({
      where: { businessId, active: true },
      include: {
        rules: {
          where: { actionType, active: true },
          orderBy: { priority: 'desc' },
          include: { steps: { orderBy: { stepOrder: 'asc' } } },
        },
      },
      orderBy: { priority: 'desc' },
    });

    if (!policies || policies.length === 0) {
      return { requiresApproval: false };
    }

    // Evaluate all rules across active policies, prioritizing by rule priority
    const allRules = policies.flatMap((p: any) => p.rules || []).sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));

    for (const rule of allRules) {
      const isMatch = PolicyEvaluationService.evaluate(rule.condition as any, context);
      
      if (isMatch) {
        return {
          requiresApproval: true,
          rule: rule,
        };
      }
    }

    return { requiresApproval: false };
  }

  // --- CRUD for Policies & Rules ---

  public static async createPolicy(businessId: string, data: { name: string; description?: string; priority?: number }) {
    return db.governancePolicy.create({
      data: {
        businessId,
        name: data.name,
        description: data.description,
        priority: data.priority ?? 0,
      },
    });
  }

  public static async createRule(
    businessId: string, 
    policyId: string, 
    data: { actionType: string; condition: any; priority?: number; allowSelfApproval?: boolean; approvalMode?: any }
  ) {
    return db.approvalRule.create({
      data: {
        businessId,
        policyId,
        actionType: data.actionType,
        condition: data.condition,
        priority: data.priority ?? 0,
        allowSelfApproval: data.allowSelfApproval ?? false,
        approvalMode: data.approvalMode || 'SINGLE_APPROVER',
      },
    });
  }

  public static async addRuleStep(ruleId: string, stepOrder: number, approverRole?: string, approverUserId?: string) {
    return db.approvalRuleStep.create({
      data: {
        ruleId,
        stepOrder,
        approverRole,
        approverUserId,
      },
    });
  }
}
