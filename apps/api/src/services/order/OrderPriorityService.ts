import { prisma } from '@agent-flux/database';
import { CustomerFinancialExposure } from '../finance/CustomerBalanceService';

export type OrderPriorityLevel = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export interface OrderPriorityEvaluation {
  priority: OrderPriorityLevel;
  priorityScore: number;       // 0 - 100
  priorityReason: string;
  riskFlags: string[];
  factors: {
    isHighValue: boolean;
    isUrgentDeadline: boolean;
    hasOverdueBalance: boolean;
    hasCreditBreach: boolean;
    isTrustedRepeatCustomer: boolean;
    isHighRiskCustomer: boolean;
    hasFailedPayment: boolean;
    orderTotal: number;
    hoursUntilDue: number | null;
    overdueAmount: number;
  };
}

export class OrderPriorityService {
  // Default thresholds (configurable per business)
  private readonly HIGH_VALUE_THRESHOLD = 50000; // e.g. ₹50,000
  private readonly URGENT_HOURS_THRESHOLD = 48;   // 48 hours to delivery

  /**
   * Evaluates priority for an order using verified financial context and operational deadlines.
   */
  evaluateOrderPriority(
    order: {
      id?: string;
      orderNumber?: string;
      totalAmount?: number | null;
      dueAt?: Date | string | null;
      status?: string;
      paymentStatus?: string;
    },
    financialSummary: CustomerFinancialExposure,
    failedPaymentsCount: number = 0,
    completedOrdersCount: number = 0
  ): OrderPriorityEvaluation {
    const orderTotal = Number(order.totalAmount || 0);
    const now = new Date();
    
    // 1. Evaluate Deadline Urgency
    let hoursUntilDue: number | null = null;
    let isUrgentDeadline = false;
    let isPastDueDeadline = false;

    if (order.dueAt) {
      const dueDate = new Date(order.dueAt);
      const diffMs = dueDate.getTime() - now.getTime();
      hoursUntilDue = Math.round(diffMs / (1000 * 60 * 60));

      if (hoursUntilDue < 0) {
        isPastDueDeadline = true;
      } else if (hoursUntilDue <= this.URGENT_HOURS_THRESHOLD) {
        isUrgentDeadline = true;
      }
    }

    // 2. Financial & Risk Indicators
    const isHighValue = orderTotal >= this.HIGH_VALUE_THRESHOLD;
    const hasOverdueBalance = financialSummary.overdueBalance > 0;
    const hasCreditBreach = financialSummary.creditBreached;
    const hasFailedPayment = failedPaymentsCount > 0 || order.paymentStatus === 'DISPUTED';

    // Trust calculation: Verified from payment score >= 80, at least 2 completed orders, and no overdue debt!
    const isTrustedRepeatCustomer = 
      (financialSummary.paymentScore !== null && financialSummary.paymentScore >= 80) &&
      completedOrdersCount >= 2 &&
      !hasOverdueBalance;

    const isHighRiskCustomer = 
      (financialSummary.paymentScore !== null && financialSummary.paymentScore < 40) ||
      hasCreditBreach ||
      (hasOverdueBalance && financialSummary.overdueBalance > 10000);

    const riskFlags: string[] = [];
    const reasons: string[] = [];

    // 3. Determine Priority Level and Score
    let priority: OrderPriorityLevel = 'NORMAL';
    let priorityScore = 50;

    // Rule A: Overdue payments, credit breaches, or failed payments trigger CRITICAL priority
    // regardless of whether order value is big or small!
    if (hasOverdueBalance || hasCreditBreach || isPastDueDeadline || hasFailedPayment) {
      priority = 'CRITICAL';
      priorityScore = 95;

      if (hasOverdueBalance) {
        riskFlags.push('OVERDUE_PAYMENT_RISK');
        reasons.push(`Customer has ₹${financialSummary.overdueBalance.toLocaleString()} in overdue debt balances`);
      }
      if (hasCreditBreach) {
        riskFlags.push('CREDIT_LIMIT_BREACH');
        reasons.push(`Account breached credit limit (Limit: ₹${financialSummary.creditLimit.toLocaleString()}, Outstanding: ₹${financialSummary.totalOutstanding.toLocaleString()})`);
      }
      if (isPastDueDeadline) {
        riskFlags.push('DEADLINE_PASSED');
        reasons.push(`Order delivery deadline was missed (${Math.abs(hoursUntilDue!)}h overdue)`);
      }
      if (hasFailedPayment) {
        riskFlags.push('PAYMENT_FAILURE_OR_DISPUTE');
        reasons.push('Order has failed payment attempt or active dispute requiring urgent resolution');
      }
    }
    // Rule B: High value, urgent deadline (<48h), or high-risk customer trigger HIGH priority
    else if (isHighValue || isUrgentDeadline || isHighRiskCustomer) {
      priority = 'HIGH';
      priorityScore = 75;

      if (isHighValue) {
        riskFlags.push('HIGH_ORDER_VALUE');
        reasons.push(`High order value of ₹${orderTotal.toLocaleString()} requires expedited fulfillment`);
      }
      if (isUrgentDeadline) {
        riskFlags.push('URGENT_DELIVERY_DEADLINE');
        reasons.push(`Delivery deadline approaching in ${hoursUntilDue} hours`);
      }
      if (isHighRiskCustomer) {
        riskFlags.push('ELEVATED_CUSTOMER_RISK');
        reasons.push(`Customer payment score (${financialSummary.paymentScore}/100) indicates elevated risk profile`);
      }
    }
    // Rule C: Trusted repeat customer with routine order -> NORMAL / low risk
    else if (isTrustedRepeatCustomer && !isUrgentDeadline) {
      if (orderTotal < 5000 && order.status === 'CONFIRMED') {
        priority = 'LOW';
        priorityScore = 25;
        riskFlags.push('TRUSTED_CUSTOMER_HISTORY');
        riskFlags.push('TRUSTED_REPEAT_CUSTOMER');
        reasons.push('Verified trusted repeat customer with zero overdue exposure');
      } else {
        priority = 'NORMAL';
        priorityScore = 40;
        riskFlags.push('TRUSTED_CUSTOMER_HISTORY');
        riskFlags.push('TRUSTED_REPEAT_CUSTOMER');
        reasons.push('Routine processing for trusted repeat customer');
      }
    }
    // Rule D: Standard routine order
    else {
      priority = 'NORMAL';
      priorityScore = 50;
      reasons.push('Standard order requiring routine production and fulfillment');
    }

    const priorityReason = reasons.join('; ');

    return {
      priority,
      priorityScore,
      priorityReason,
      riskFlags,
      factors: {
        isHighValue,
        isUrgentDeadline,
        hasOverdueBalance,
        hasCreditBreach,
        isTrustedRepeatCustomer,
        isHighRiskCustomer,
        hasFailedPayment,
        orderTotal,
        hoursUntilDue,
        overdueAmount: financialSummary.overdueBalance
      }
    };
  }

  /**
   * Evaluates and updates an existing order's priority in the database.
   */
  async updateOrderPriority(businessId: string, orderId: string): Promise<OrderPriorityEvaluation> {
    const { customerBalanceService } = await import('../finance/CustomerBalanceService');
    const order = await prisma.order.findUnique({
      where: { id: orderId, businessId },
      include: {
        customer: true,
        Payment: true
      }
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found in business ${businessId}`);
    }

    const financialSummary = await customerBalanceService.getCustomerFinancialSummary(
      businessId,
      order.customerId,
      order.id
    );

    const failedPayments = order.Payment.filter(p => p.status === 'FAILED').length;
    const completedOrders = await prisma.order.count({
      where: {
        businessId,
        customerId: order.customerId,
        status: { in: ['COMPLETED', 'DELIVERED'] }
      }
    });

    const evalResult = this.evaluateOrderPriority(
      order,
      financialSummary,
      failedPayments,
      completedOrders
    );

    await prisma.order.update({
      where: { id: orderId },
      data: {
        priority: evalResult.priority,
        priorityScore: evalResult.priorityScore,
        priorityReason: evalResult.priorityReason,
        priorityFactors: evalResult.riskFlags as any,
        paymentStatus: financialSummary.orderPaymentStatus,
        amountPaid: financialSummary.orderPaid,
        outstandingAmount: financialSummary.orderOutstanding
      }
    });

    return evalResult;
  }

  /**
   * Alias for evaluating and updating order priority
   */
  async evaluateAndSave(orderId: string, businessId: string): Promise<OrderPriorityEvaluation> {
    return this.updateOrderPriority(businessId, orderId);
  }
}

export const orderPriorityService = new OrderPriorityService();
