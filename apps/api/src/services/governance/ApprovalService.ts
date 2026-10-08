import { prisma } from '@agent-flux/database';

export class ApprovalService {
  /**
   * Initializes a new approval request. 
   * The status starts as PENDING.
   */
  public static async createApprovalRequest(
    businessId: string,
    requestedById: string,
    actionType: string,
    resourceType: string,
    resourceId: string,
    contextSnapshot: Record<string, any>,
    rule: any,
    reason?: string,
    expiresAt?: Date
  ) {
    const request = await prisma.approvalRequest.create({
      data: {
        businessId,
        requestedById,
        actionType,
        resourceType,
        resourceId,
        contextSnapshot,
        priority: rule.priority,
        reason,
        expiresAt,
        steps: {
          create: rule.steps?.map((step: any) => ({
            stepOrder: step.stepOrder,
            approverRole: step.approverRole,
            approverUserId: step.approverUserId,
            status: 'PENDING',
          })) || [],
        },
      },
      include: { steps: true },
    });

    // Log to audit
    await prisma.auditLog.create({
      data: {
        businessId,
        userId: requestedById,
        eventType: 'APPROVAL_REQUESTED',
        resourceType,
        resourceId,
        metadata: { approvalRequestId: request.id, ruleId: rule.id },
      },
    });

    return request;
  }

  public static async approve(
    businessId: string,
    approvalRequestId: string,
    actorId: string,
    comment?: string
  ) {
    // Basic validations missing: Check if actor is allowed, check if request is active
    const request = await prisma.approvalRequest.findUnique({
      where: { id: approvalRequestId },
      include: { steps: true },
    });

    if (!request || request.businessId !== businessId || request.status !== 'PENDING') {
      throw new Error('Invalid approval request');
    }

    // Assume we're just approving the whole request for now if SINGLE_APPROVER.
    // In a real multi-step workflow, you'd advance the steps.
    const updatedRequest = await prisma.approvalRequest.update({
      where: { id: approvalRequestId },
      data: { status: 'APPROVED' },
    });

    await prisma.approvalDecision.create({
      data: {
        businessId,
        approvalRequestId,
        actorId,
        decision: 'APPROVED',
        comment,
      },
    });

    await prisma.auditLog.create({
      data: {
        businessId,
        userId: actorId,
        eventType: 'APPROVAL_APPROVED',
        resourceType: request.resourceType,
        resourceId: request.resourceId,
        metadata: { approvalRequestId, comment },
      },
    });

    return updatedRequest;
  }

  public static async reject(
    businessId: string,
    approvalRequestId: string,
    actorId: string,
    comment?: string
  ) {
    const request = await prisma.approvalRequest.findUnique({
      where: { id: approvalRequestId },
    });

    if (!request || request.businessId !== businessId || request.status !== 'PENDING') {
      throw new Error('Invalid approval request');
    }

    const updatedRequest = await prisma.approvalRequest.update({
      where: { id: approvalRequestId },
      data: { status: 'REJECTED' },
    });

    await prisma.approvalDecision.create({
      data: {
        businessId,
        approvalRequestId,
        actorId,
        decision: 'REJECTED',
        comment,
      },
    });

    await prisma.auditLog.create({
      data: {
        businessId,
        userId: actorId,
        eventType: 'APPROVAL_REJECTED',
        resourceType: request.resourceType,
        resourceId: request.resourceId,
        metadata: { approvalRequestId, comment },
      },
    });

    return updatedRequest;
  }
}
