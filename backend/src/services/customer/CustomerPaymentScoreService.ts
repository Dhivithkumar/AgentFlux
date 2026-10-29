import { prisma } from '@agent-flux/database';

export interface ScoreContributingFactors {
  onTimePaymentRate: number;       // 0 - 100
  paymentCompletionRate: number;   // 0 - 100
  timelinessScore: number;         // 0 - 100
  averageDaysLate: number;
  debtAndRiskScore: number;        // 0 - 100
  totalInvoicesEvaluated: number;
  totalPaidAmount: number;
  totalInvoicedAmount: number;
  totalOutstandingAmount: number;
  overdueBalance: number;
  creditLimit: number;
  creditBreached: boolean;
}

export type ScoreCategory = 'STRONG' | 'GOOD' | 'CAUTION' | 'HIGH_RISK' | 'INSUFFICIENT_HISTORY';

export interface CustomerPaymentScoreResult {
  customerId: string;
  customerName: string | null;
  score: number | null;
  category: ScoreCategory;
  categoryLabel: string;
  isEligible: boolean;
  contributingFactors: ScoreContributingFactors;
  lastCalculatedAt: Date;
  summaryReason: string;
}

/**
 * PRODUCTION CUSTOMER PAYMENT SCORE ENGINE (0 - 100)
 *
 * Scoring Algorithm Weights:
 * - On-time payment rate: 40% (W1)
 * - Payment completion rate: 25% (W2)
 * - Payment timeliness (average days late): 20% (W3)
 * - Outstanding debt & overdue risk: 15% (W4)
 *
 * Categories:
 * - 80 - 100: STRONG ("Strong payment history")
 * - 60 - 79:  GOOD ("Good payment history")
 * - 40 - 59:  CAUTION ("Caution - elevated late payment / debt risk")
 * - 0 - 39:   HIGH_RISK ("High payment risk - severe defaults / overdue")
 * - Insufficient history: INSUFFICIENT_HISTORY (customers with < 2 completed billing cycles)
 */
export class CustomerPaymentScoreService {
  // Default configurable weights
  private readonly W_ON_TIME = 0.40;
  private readonly W_COMPLETION = 0.25;
  private readonly W_TIMELINESS = 0.20;
  private readonly W_DEBT_RISK = 0.15;

  /**
   * Calculates the Customer Payment Score for a given customer within a tenant business.
   */
  async calculateCustomerScore(businessId: string, customerId: string): Promise<CustomerPaymentScoreResult> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId, businessId },
      include: {
        invoices: {
          where: {
            status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] }
          },
          include: { payments: true }
        },
        Payment: {
          where: { status: 'SUCCEEDED' }
        }
      }
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found in business ${businessId}`);
    }

    const customData = (customer.customData as Record<string, any>) || {};
    const creditLimit = Number(customer.creditLimit || customData.creditLimit || 0);

    const invoices = customer.invoices || [];
    const now = new Date();

    // 1. Check eligibility: new customers with fewer than 2 completed/active invoices have insufficient history
    if (invoices.length < 2) {
      const result: CustomerPaymentScoreResult = {
        customerId: customer.id,
        customerName: customer.name,
        score: null,
        category: 'INSUFFICIENT_HISTORY',
        categoryLabel: 'Insufficient History',
        isEligible: false,
        contributingFactors: {
          onTimePaymentRate: 0,
          paymentCompletionRate: 0,
          timelinessScore: 0,
          averageDaysLate: 0,
          debtAndRiskScore: 0,
          totalInvoicesEvaluated: invoices.length,
          totalPaidAmount: customer.Payment.reduce((sum, p) => sum + p.amount, 0),
          totalInvoicedAmount: invoices.reduce((sum, i) => sum + (i.totalAmount || 0), 0),
          totalOutstandingAmount: invoices.reduce((sum, i) => sum + (i.outstandingAmount || 0), 0),
          overdueBalance: 0,
          creditLimit,
          creditBreached: false
        },
        lastCalculatedAt: new Date(),
        summaryReason: 'Customer has insufficient transaction history (minimum 2 billing cycles required for financial scoring).'
      };

      return result;
    }

    // 2. Metrics calculation
    let paidOnTimeCount = 0;
    let totalEvaluatedInvoices = 0;
    let totalInvoicedAmount = 0;
    let totalPaidAmount = 0;
    let totalOutstandingAmount = 0;
    let overdueBalance = 0;
    let totalLateDays = 0;

    for (const inv of invoices) {
      totalEvaluatedInvoices++;
      totalInvoicedAmount += inv.totalAmount || 0;
      totalPaidAmount += inv.paidAmount || 0;
      totalOutstandingAmount += inv.outstandingAmount || 0;

      const dueDate = inv.dueDate ? new Date(inv.dueDate) : new Date(new Date(inv.invoiceDate).getTime() + 30 * 86400000);
      const isPaid = inv.status === 'PAID';

      if (isPaid) {
        // Find latest successful payment
        const successfulPayments = (inv.payments || []).filter(p => p.status === 'SUCCEEDED' && p.paidAt);
        const lastPaidAt = successfulPayments.length > 0 
          ? new Date(Math.max(...successfulPayments.map(p => new Date(p.paidAt!).getTime())))
          : new Date(inv.invoiceDate);

        if (lastPaidAt <= dueDate) {
          paidOnTimeCount++;
        } else {
          const lateDays = Math.max(0, Math.ceil((lastPaidAt.getTime() - dueDate.getTime()) / 86400000));
          totalLateDays += lateDays;
        }
      } else {
        // Unpaid or partially paid
        if (now > dueDate && (inv.outstandingAmount || 0) > 0) {
          overdueBalance += inv.outstandingAmount;
          const lateDays = Math.max(0, Math.ceil((now.getTime() - dueDate.getTime()) / 86400000));
          totalLateDays += lateDays;
        }
      }
    }

    // A. On-Time Payment Rate (0 - 100) [40% weight]
    const onTimePaymentRate = totalEvaluatedInvoices > 0
      ? (paidOnTimeCount / totalEvaluatedInvoices) * 100
      : 100;

    // B. Payment Completion Rate (0 - 100) [25% weight]
    const paymentCompletionRate = totalInvoicedAmount > 0
      ? Math.min(100, Math.max(0, (totalPaidAmount / totalInvoicedAmount) * 100))
      : 100;

    // C. Payment Timeliness / Average Days Late (0 - 100) [20% weight]
    const averageDaysLate = totalEvaluatedInvoices > 0 ? (totalLateDays / totalEvaluatedInvoices) : 0;
    let timelinessScore = 100;
    if (averageDaysLate <= 0) {
      timelinessScore = 100;
    } else if (averageDaysLate <= 7) {
      timelinessScore = 85;
    } else if (averageDaysLate <= 14) {
      timelinessScore = 65;
    } else if (averageDaysLate <= 30) {
      timelinessScore = 40;
    } else {
      timelinessScore = Math.max(0, 40 - (averageDaysLate - 30));
    }

    // D. Outstanding Debt & Overdue Risk (0 - 100) [15% weight]
    let debtAndRiskScore = 100;
    const overdueRatio = totalInvoicedAmount > 0 ? (overdueBalance / totalInvoicedAmount) : 0;
    if (overdueBalance === 0) {
      debtAndRiskScore = 100;
    } else if (overdueRatio < 0.10) {
      debtAndRiskScore = 75;
    } else if (overdueRatio < 0.30) {
      debtAndRiskScore = 40;
    } else {
      debtAndRiskScore = 10;
    }

    // Credit limit breach penalty
    const creditBreached = creditLimit > 0 && totalOutstandingAmount > creditLimit;
    if (creditBreached) {
      const breachPercentage = ((totalOutstandingAmount - creditLimit) / creditLimit) * 100;
      debtAndRiskScore = Math.max(0, debtAndRiskScore - Math.min(50, breachPercentage * 0.5));
    }

    // Composite Weighted Score
    const rawScore = 
      (onTimePaymentRate * this.W_ON_TIME) +
      (paymentCompletionRate * this.W_COMPLETION) +
      (timelinessScore * this.W_TIMELINESS) +
      (debtAndRiskScore * this.W_DEBT_RISK);

    const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

    // Categorization
    let category: ScoreCategory = 'GOOD';
    let categoryLabel = 'Good payment history';
    if (finalScore >= 80) {
      category = 'STRONG';
      categoryLabel = 'Strong payment history';
    } else if (finalScore >= 60) {
      category = 'GOOD';
      categoryLabel = 'Good payment history';
    } else if (finalScore >= 40) {
      category = 'CAUTION';
      categoryLabel = 'Caution - moderate late payment / debt risk';
    } else {
      category = 'HIGH_RISK';
      categoryLabel = 'High payment risk';
    }

    let summaryReason = `${categoryLabel} (Score: ${finalScore}/100). On-time rate: ${Math.round(onTimePaymentRate)}%, completion: ${Math.round(paymentCompletionRate)}%.`;
    if (overdueBalance > 0) {
      summaryReason += ` Warning: Overdue balance of ₹${Math.round(overdueBalance).toLocaleString()} detected.`;
    }
    if (creditBreached) {
      summaryReason += ` Alert: Credit limit of ₹${creditLimit.toLocaleString()} has been breached.`;
    }

    return {
      customerId: customer.id,
      customerName: customer.name,
      score: finalScore,
      category,
      categoryLabel,
      isEligible: true,
      contributingFactors: {
        onTimePaymentRate: Math.round(onTimePaymentRate * 10) / 10,
        paymentCompletionRate: Math.round(paymentCompletionRate * 10) / 10,
        timelinessScore: Math.round(timelinessScore * 10) / 10,
        averageDaysLate: Math.round(averageDaysLate * 10) / 10,
        debtAndRiskScore: Math.round(debtAndRiskScore * 10) / 10,
        totalInvoicesEvaluated: totalEvaluatedInvoices,
        totalPaidAmount,
        totalInvoicedAmount,
        totalOutstandingAmount,
        overdueBalance,
        creditLimit,
        creditBreached
      },
      lastCalculatedAt: new Date(),
      summaryReason
    };
  }

  /**
   * Calculates and saves the score and financial exposure directly to the customer database record.
   */
  async calculateAndPersistScore(businessId: string, customerId: string): Promise<CustomerPaymentScoreResult> {
    const result = await this.calculateCustomerScore(businessId, customerId);

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        paymentScore: result.score,
        paymentScoreCategory: result.category,
        paymentScoreFactors: result.contributingFactors as any,
        paymentScoreCalculatedAt: result.lastCalculatedAt,
        totalOutstanding: result.contributingFactors.totalOutstandingAmount,
        overdueBalance: result.contributingFactors.overdueBalance
      }
    });

    return result;
  }

  /**
   * Alias for calculating and persisting customer payment score
   */
  async calculateAndSave(param1: string, param2: string): Promise<CustomerPaymentScoreResult> {
    const customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { id: param1, businessId: param2 },
          { id: param2, businessId: param1 }
        ]
      }
    });

    if (!customer) {
      throw new Error(`Customer not found for payment score calculation with params (${param1}, ${param2})`);
    }

    return this.calculateAndPersistScore(customer.businessId, customer.id);
  }
}

export const customerPaymentScoreService = new CustomerPaymentScoreService();
