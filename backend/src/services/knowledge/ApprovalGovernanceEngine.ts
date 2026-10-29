import { AASHA_DISCOUNT_RULES, AASHA_ORDER_VALUE_RULES, AASHA_REFUND_RULES } from './aashaKnowledgeData';

export interface ApprovalEvaluationResult {
  requiresApproval: boolean;
  approvalType: string;
  requiredApprover: string;
  reason: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  isException: boolean;
}

export class ApprovalGovernanceEngine {
  /**
   * Deterministically evaluates discount approval requirements.
   */
  public static evaluateDiscountApproval(discountPercentage: number): ApprovalEvaluationResult {
    const pct = Math.max(0, discountPercentage);

    if (pct === 0) {
      return {
        requiresApproval: false,
        approvalType: 'DISCOUNT',
        requiredApprover: 'None',
        reason: 'Standard price, no discount applied.',
        riskLevel: 'LOW',
        isException: false
      };
    }

    if (pct <= 5) {
      return {
        requiresApproval: false, // Standard sales executive delegated authority
        approvalType: 'DISCOUNT',
        requiredApprover: 'Sales Executive',
        reason: 'Discount within standard 0%–5% delegated sales authority.',
        riskLevel: 'LOW',
        isException: false
      };
    }

    if (pct <= 10) {
      return {
        requiresApproval: true,
        approvalType: 'DISCOUNT',
        requiredApprover: 'Sales Manager',
        reason: 'Discount >5%–10% requires Sales Manager approval.',
        riskLevel: 'MEDIUM',
        isException: false
      };
    }

    if (pct <= 15) {
      return {
        requiresApproval: true,
        approvalType: 'DISCOUNT',
        requiredApprover: 'Owner',
        reason: 'Discount >10%–15% requires Owner approval.',
        riskLevel: 'HIGH',
        isException: false
      };
    }

    return {
      requiresApproval: true,
      approvalType: 'DISCOUNT',
      requiredApprover: 'Owner exception',
      reason: 'Discount >15% is not permitted as standard discount; Owner must explicitly approve an exception.',
      riskLevel: 'HIGH',
      isException: true
    };
  }

  /**
   * Deterministically evaluates order value approval requirements.
   */
  public static evaluateOrderValueApproval(orderTotal: number): ApprovalEvaluationResult {
    if (orderTotal <= 100000) {
      return {
        requiresApproval: false,
        approvalType: 'ORDER_VALUE',
        requiredApprover: 'Sales authority',
        reason: 'Order value up to ₹1,00,000 falls within standard Sales authority.',
        riskLevel: 'LOW',
        isException: false
      };
    }

    if (orderTotal <= 300000) {
      return {
        requiresApproval: true,
        approvalType: 'ORDER_VALUE',
        requiredApprover: 'Manager',
        reason: 'Order value >₹1,00,000–₹3,00,000 requires Manager approval.',
        riskLevel: 'MEDIUM',
        isException: false
      };
    }

    return {
      requiresApproval: true,
      approvalType: 'ORDER_VALUE',
      requiredApprover: 'Owner',
      reason: 'Order value >₹3,00,000 requires Owner approval.',
      riskLevel: 'HIGH',
      isException: false
    };
  }

  /**
   * Deterministically evaluates credit sale request.
   * Credit is NEVER standard.
   */
  public static evaluateCreditRequest(requested: boolean): ApprovalEvaluationResult {
    if (!requested) {
      return {
        requiresApproval: false,
        approvalType: 'CREDIT',
        requiredApprover: 'None',
        reason: 'Standard terms: 50% advance, 50% balance before delivery.',
        riskLevel: 'LOW',
        isException: false
      };
    }

    return {
      requiresApproval: true,
      approvalType: 'CREDIT',
      requiredApprover: 'Finance',
      reason: 'Credit terms are not standard and strictly require Finance approval.',
      riskLevel: 'HIGH',
      isException: true
    };
  }

  /**
   * Deterministically evaluates refund approval.
   */
  public static evaluateRefundApproval(refundAmount: number): ApprovalEvaluationResult {
    if (refundAmount <= 10000) {
      return {
        requiresApproval: true,
        approvalType: 'REFUND',
        requiredApprover: 'Finance',
        reason: 'Refund up to ₹10,000 requires Finance approval.',
        riskLevel: 'MEDIUM',
        isException: false
      };
    }

    return {
      requiresApproval: true,
      approvalType: 'REFUND',
      requiredApprover: 'Owner',
      reason: 'Refund >₹10,000 requires Owner approval.',
      riskLevel: 'HIGH',
      isException: true
    };
  }

  /**
   * Segregation of duties validation.
   */
  public static validateSegregationOfDuties(requesterId: string, approverId: string, actionType: string): { valid: boolean; reason?: string } {
    if (requesterId === approverId) {
      return {
        valid: false,
        reason: `Segregation of duties violation: Requester and approver must be different users for ${actionType}.`
      };
    }
    return { valid: true };
  }

  /**
   * Evaluates production release readiness.
   */
  public static canReleaseToProduction(params: {
    orderStatus: string;
    advanceReceived: boolean;
    hasApprovedCreditException: boolean;
  }): { allowed: boolean; reason: string } {
    const { orderStatus, advanceReceived, hasApprovedCreditException } = params;

    if (orderStatus !== 'CONFIRMED') {
      return {
        allowed: false,
        reason: `Order must be CONFIRMED before release to production. Current status: ${orderStatus}.`
      };
    }

    if (!advanceReceived && !hasApprovedCreditException) {
      return {
        allowed: false,
        reason: 'Production release blocked: 50% advance payment required unless an approved credit exception exists.'
      };
    }

    return {
      allowed: true,
      reason: 'Order confirmed and advance received / credit approved. Released to production.'
    };
  }
}
