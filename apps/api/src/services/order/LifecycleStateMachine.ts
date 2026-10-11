/**
 * Explicit Persisted State Machine for Order Lifecycle.
 * Covers Quotation, Order, and Invoice state transitions.
 * Defines valid transitions, rejected transitions, transition guards, and audit trail persistence.
 */

export class InvalidStateTransitionError extends Error {
  public readonly entityType: string;
  public readonly fromStatus: string;
  public readonly toStatus: string;

  constructor(entityType: string, fromStatus: string, toStatus: string, reason: string) {
    super(`INVALID_STATE_TRANSITION: Cannot transition ${entityType} from '${fromStatus}' to '${toStatus}'. ${reason}`);
    this.name = 'InvalidStateTransitionError';
    this.entityType = entityType;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

export type QuotationState = 
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'GENERATED'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

export type OrderState =
  | 'DRAFT'
  | 'PENDING_OWNER_CONFIRMATION'
  | 'CONFIRMED'
  | 'CUSTOMER_INFORMATION_REQUIRED'
  | 'READY_FOR_INVOICE'
  | 'INVOICE_SENT'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED';

export type InvoiceState =
  | 'DRAFT'
  | 'ISSUED'
  | 'SENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED';

export const QUOTATION_TRANSITIONS: Record<QuotationState, QuotationState[]> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'GENERATED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['GENERATED', 'SENT', 'CANCELLED'],
  GENERATED: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: [], // Terminal for acceptance: re-accepting is handled idempotently
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: []
};

export const ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  DRAFT: ['PENDING_OWNER_CONFIRMATION', 'CONFIRMED', 'CANCELLED'],
  PENDING_OWNER_CONFIRMATION: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['CUSTOMER_INFORMATION_REQUIRED', 'READY_FOR_INVOICE', 'CANCELLED'],
  CUSTOMER_INFORMATION_REQUIRED: ['READY_FOR_INVOICE', 'CANCELLED'],
  READY_FOR_INVOICE: ['INVOICE_SENT', 'CANCELLED'],
  INVOICE_SENT: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: []
};

export const INVOICE_TRANSITIONS: Record<InvoiceState, InvoiceState[]> = {
  DRAFT: ['ISSUED', 'CANCELLED'],
  ISSUED: ['SENT', 'CANCELLED'],
  SENT: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID', 'CANCELLED'],
  PAID: [],
  OVERDUE: ['PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  CANCELLED: []
};

export class LifecycleStateMachine {
  /**
   * Validates if a Quotation can transition to target status.
   */
  static validateQuotationTransition(fromStatus: string, toStatus: string, quotation?: any): { allowed: boolean; reason?: string } {
    if (fromStatus === toStatus) {
      return { allowed: true };
    }

    const validNext = QUOTATION_TRANSITIONS[fromStatus as QuotationState] || [];
    if (!validNext.includes(toStatus as QuotationState)) {
      return {
        allowed: false,
        reason: `Valid next states from '${fromStatus}' are: [${validNext.join(', ')}].`
      };
    }

    // Additional guards
    if (toStatus === 'ACCEPTED') {
      if (quotation) {
        if (quotation.status === 'EXPIRED' || (quotation.validUntil && new Date(quotation.validUntil) < new Date())) {
          return { allowed: false, reason: 'Quotation has expired and cannot be accepted.' };
        }
        if (quotation.status === 'CANCELLED') {
          return { allowed: false, reason: 'Quotation was cancelled and cannot be accepted.' };
        }
        if (quotation.orderId) {
          return { allowed: false, reason: 'Quotation has already been converted to an order.' };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Validates if an Order can transition to target status.
   */
  static validateOrderTransition(fromStatus: string, toStatus: string, context?: any): { allowed: boolean; reason?: string } {
    if (fromStatus === toStatus) {
      return { allowed: true };
    }

    const validNext = ORDER_TRANSITIONS[fromStatus as OrderState] || [];
    if (!validNext.includes(toStatus as OrderState)) {
      return {
        allowed: false,
        reason: `Valid next states from '${fromStatus}' are: [${validNext.join(', ')}].`
      };
    }

    // Guard: transition from PENDING_OWNER_CONFIRMATION to CONFIRMED requires owner review
    if (fromStatus === 'PENDING_OWNER_CONFIRMATION' && toStatus === 'CONFIRMED') {
      if (context?.requiresOwnerApproval && !context?.ownerApproved) {
        return { allowed: false, reason: 'Order requires owner approval before it can be confirmed.' };
      }
    }

    // Guard: transition to READY_FOR_INVOICE requires complete billing details
    if (toStatus === 'READY_FOR_INVOICE') {
      if (context?.billingAddressMissing) {
        return { allowed: false, reason: 'Cannot transition to READY_FOR_INVOICE while billing information is incomplete.' };
      }
    }

    return { allowed: true };
  }

  /**
   * Validates if an Invoice can transition to target status.
   */
  static validateInvoiceTransition(fromStatus: string, toStatus: string, context?: any): { allowed: boolean; reason?: string } {
    if (fromStatus === toStatus) {
      return { allowed: true };
    }

    const validNext = INVOICE_TRANSITIONS[fromStatus as InvoiceState] || [];
    if (!validNext.includes(toStatus as InvoiceState)) {
      return {
        allowed: false,
        reason: `Valid next states from '${fromStatus}' are: [${validNext.join(', ')}].`
      };
    }

    // Guard: transition from DRAFT to ISSUED requires generated PDF and Drive document
    if (fromStatus === 'DRAFT' && toStatus === 'ISSUED') {
      if (context && !context.generatedDocumentId) {
        return { allowed: false, reason: 'Cannot issue invoice without a generated PDF document and Drive storage.' };
      }
    }

    // Guard: transition to SENT requires actual email delivery confirmation
    if (toStatus === 'SENT') {
      if (context && !context.emailSent) {
        return { allowed: false, reason: 'Cannot transition invoice to SENT without verified email dispatch.' };
      }
    }

    return { allowed: true };
  }

  /**
   * Transition an order to a new state and record in OrderStatusHistory.
   */
  static async transitionOrder(
    businessId: string,
    orderId: string,
    toStatus: OrderState,
    actorId?: string,
    reason?: string,
    context?: any
  ): Promise<any> {
    const { prisma } = require('@agent-flux/database');
    const order = await prisma.order.findUnique({
      where: { id: orderId, businessId }
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found for business ${businessId}`);
    }

    const check = this.validateOrderTransition(order.status, toStatus, context);
    if (!check.allowed) {
      throw new InvalidStateTransitionError('Order', order.status, toStatus, check.reason || 'Transition disallowed');
    }

    if (order.status === toStatus) {
      return order; // No-op if status unchanged
    }

    const updated = await prisma.$transaction(async (tx: any) => {
      const u = await tx.order.update({
        where: { id: orderId },
        data: { status: toStatus }
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus,
          reason: reason || `Transitioned from ${order.status} to ${toStatus}`,
          changedById: actorId || null
        }
      });

      return u;
    });

    return updated;
  }
}
