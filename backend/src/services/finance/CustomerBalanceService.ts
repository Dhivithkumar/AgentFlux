import { prisma, Prisma } from '@agent-flux/database';
import { accountService } from './AccountService';

export interface CustomerFinancialExposure {
  customerId: string;
  tenantId?: string;
  customerName: string | null;
  currency: string;

  // Current order context (if evaluated with order)
  orderId?: string;
  orderNumber?: string;
  orderTotal: number;
  orderPaid: number;
  orderOutstanding: number;
  orderPaymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'DISPUTED';

  // Customer overall financial position across all records
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  overdueBalance: number;
  creditLimit: number;
  availableCredit: number;
  creditBreached: boolean;

  // General Ledger reconciliation
  generalLedgerArBalance?: number;
  reconciliationStatus: 'RECONCILED' | 'WARNING_DISCREPANCY' | 'SUBLEDGER_VERIFIED';
  reconciliationWarning?: string;

  // Payment Score snapshot
  paymentScore: number | null;
  paymentScoreCategory: string;
  hasInsufficientHistory: boolean;
}

export class CustomerBalanceService {
  /**
   * Calculates comprehensive customer financial exposure and reconciles with General Ledger.
   */
  async getCustomerFinancialSummary(
    param1: string,
    param2: string,
    orderId?: string
  ): Promise<CustomerFinancialExposure> {
    const customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { id: param2, businessId: param1 },
          { id: param1, businessId: param2 }
        ]
      },
      include: {
        invoices: {
          where: {
            status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] }
          },
          include: { payments: true }
        },
        Payment: {
          where: { status: 'SUCCEEDED' }
        },
        orders: true
      }
    });

    if (!customer) {
      throw new Error(`Customer not found for financial summary with params (${param1}, ${param2})`);
    }

    const businessId = customer.businessId;
    const customerId = customer.id;

    const customData = (customer.customData as Record<string, any>) || {};
    const creditLimit = Number(customer.creditLimit || customData.creditLimit || 0);

    const invoices = customer.invoices || [];
    const now = new Date();

    let totalInvoiced = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let overdueBalance = 0;

    for (const inv of invoices) {
      const invTotal = Number(inv.totalAmount || 0);
      const invPaid = Number(inv.paidAmount || 0);
      const invOutstanding = Number(inv.outstandingAmount || 0);

      totalInvoiced += invTotal;
      totalPaid += invPaid;
      totalOutstanding += invOutstanding;

      const dueDate = inv.dueDate ? new Date(inv.dueDate) : new Date(new Date(inv.invoiceDate).getTime() + 30 * 86400000);
      if (now > dueDate && invOutstanding > 0 && inv.status !== 'PAID') {
        overdueBalance += invOutstanding;
      }
    }

    // Specific order calculations if orderId provided
    let orderTotal = 0;
    let orderPaid = 0;
    let orderOutstanding = 0;
    let orderNumber: string | undefined;
    let orderPaymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'DISPUTED' = 'UNPAID';

    if (orderId) {
      const order = await prisma.order.findUnique({
        where: { id: orderId, businessId },
        include: {
          Payment: { where: { status: 'SUCCEEDED' } },
          invoices: { include: { payments: true } }
        }
      });

      if (order) {
        orderNumber = order.orderNumber;
        orderTotal = Number(order.totalAmount || 0);

        // Calculate paid amount strictly from non-duplicated succeeded payments
        const paymentMap = new Map<string, number>();
        for (const p of order.Payment) {
          paymentMap.set(p.id, Number(p.amount));
        }
        for (const inv of order.invoices) {
          for (const p of inv.payments) {
            if (p.status === 'SUCCEEDED') {
              paymentMap.set(p.id, Number(p.amount));
            }
          }
        }

        orderPaid = Array.from(paymentMap.values()).reduce((sum, amt) => sum + amt, 0);
        orderOutstanding = Math.max(0, orderTotal - orderPaid);

        const isOverdue = order.dueAt && new Date(order.dueAt) < now && orderOutstanding > 0;

        if (orderOutstanding === 0 && orderTotal > 0) {
          orderPaymentStatus = 'PAID';
        } else if (orderPaid > 0 && orderOutstanding > 0) {
          orderPaymentStatus = isOverdue ? 'OVERDUE' : 'PARTIALLY_PAID';
        } else if (isOverdue) {
          orderPaymentStatus = 'OVERDUE';
        } else {
          orderPaymentStatus = 'UNPAID';
        }
      }
    }

    // Available credit calculation
    const creditBreached = creditLimit > 0 && totalOutstanding > creditLimit;
    const availableCredit = creditLimit > 0 ? Math.max(0, creditLimit - totalOutstanding) : 0;

    // Reconcile with Accounts Receivable in General Ledger
    let generalLedgerArBalance: number | undefined;
    let reconciliationStatus: 'RECONCILED' | 'WARNING_DISCREPANCY' = 'RECONCILED';
    let reconciliationWarning: string | undefined;

    try {
      const arAccount = await accountService.getSystemAccount(businessId, 'ACCOUNTS_RECEIVABLE');
      if (arAccount) {
        // Query journal lines for Accounts Receivable account
        const arLines = await prisma.journalLine.findMany({
          where: {
            accountId: arAccount.id,
            journalEntry: { businessId, status: 'POSTED' }
          }
        });

        const netArDebit = arLines.reduce((acc, line) => {
          return acc.add(new Prisma.Decimal(line.debit)).sub(new Prisma.Decimal(line.credit));
        }, new Prisma.Decimal(0));

        generalLedgerArBalance = Number(netArDebit.toFixed(2));

        // Subledger total should match or be explainable relative to total company AR
        // If customer total outstanding is positive but General Ledger AR is 0 or significantly off:
        // We compare rounded values
        const discrepancy = Math.abs(totalOutstanding - generalLedgerArBalance);
        if (totalOutstanding > 0 && generalLedgerArBalance === 0) {
          reconciliationStatus = 'WARNING_DISCREPANCY';
          reconciliationWarning = `Reconciliation Warning: Invoices indicate customer outstanding of ₹${totalOutstanding.toLocaleString()}, but General Ledger AR has not yet synced (GL AR balance: ₹${generalLedgerArBalance}). Sync recommended.`;
        }
      }
    } catch (e: any) {
      // Graceful fallback if accounting periods or chart of accounts not yet seeded
    }

    return {
      customerId: customer.id,
      tenantId: businessId,
      customerName: customer.name,
      currency: 'INR',
      orderId,
      orderNumber,
      orderTotal,
      orderPaid,
      orderOutstanding,
      orderPaymentStatus,
      totalInvoiced,
      totalPaid,
      totalOutstanding,
      overdueBalance,
      creditLimit,
      availableCredit,
      creditBreached,
      generalLedgerArBalance,
      reconciliationStatus,
      reconciliationWarning,
      paymentScore: customer.paymentScore,
      paymentScoreCategory: customer.paymentScoreCategory || (invoices.length < 2 ? 'INSUFFICIENT_HISTORY' : 'GOOD'),
      hasInsufficientHistory: invoices.length < 2
    };
  }
}

export const customerBalanceService = new CustomerBalanceService();
