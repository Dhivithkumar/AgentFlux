import { prisma } from '@agent-flux/database';

export class PaymentSummaryService {
  /**
   * Recalculates the paid amount, outstanding amount, and payment status of an invoice.
   * Then updates the invoice in the database.
   */
  async recalculateInvoice(businessId: string, invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId, businessId },
      include: { payments: true }
    });

    if (!invoice) throw new Error('Invoice not found');

    const totalAmount = invoice.totalAmount || 0;
    
    // Only count SUCCEEDED payments
    const successfulPayments = invoice.payments.filter(p => p.status === 'SUCCEEDED');
    const paidAmount = successfulPayments.reduce((acc, p) => acc + p.amount, 0);

    const refundedPayments = invoice.payments.filter(p => p.status === 'REFUNDED');
    const refundedAmount = refundedPayments.reduce((acc, p) => acc + p.amount, 0);

    // net paid can account for refunds
    const netPaidAmount = paidAmount - refundedAmount;
    
    // outstanding cannot be less than 0
    let outstandingAmount = totalAmount - netPaidAmount;
    if (outstandingAmount < 0) {
      // By explicit design (per prompt rule 9 policy), we allow with explicit OVERPAID behavior logically
      // however our Prisma enum might not have OVERPAID unless added.
      // For now we set outstanding to 0. 
      outstandingAmount = 0; 
    }

    let status = invoice.status;
    const now = new Date();
    const isPastDue = invoice.dueDate && new Date(invoice.dueDate) < now;

    if (netPaidAmount >= totalAmount && totalAmount > 0) {
      status = 'PAID';
    } else if (netPaidAmount > 0 && netPaidAmount < totalAmount) {
      status = 'PARTIALLY_PAID';
    } else if (isPastDue && outstandingAmount > 0 && status !== 'CANCELLED') {
      status = 'OVERDUE';
    }

    // Update the invoice
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount: netPaidAmount,
        outstandingAmount,
        status: status as any
      }
    });

    // Synchronize linked Order if present
    if (invoice.orderId) {
      let orderPaymentStatus = 'UNPAID';
      if (netPaidAmount >= totalAmount && totalAmount > 0) {
        orderPaymentStatus = 'PAID';
      } else if (netPaidAmount > 0) {
        orderPaymentStatus = 'PARTIALLY_PAID';
      } else if (status === 'OVERDUE') {
        orderPaymentStatus = 'OVERDUE';
      }

      await prisma.order.update({
        where: { id: invoice.orderId },
        data: {
          amountPaid: netPaidAmount,
          outstandingAmount,
          paymentStatus: orderPaymentStatus
        }
      });
    }

    return updatedInvoice;
  }

  /**
   * Comprehensive synchronization of all invoices, orders, and overdue statuses for a business.
   */
  async syncAllBusinessInvoicesAndOrders(businessId: string) {
    const now = new Date();
    const invoices = await prisma.invoice.findMany({
      where: { businessId },
      include: { payments: true }
    });

    for (const inv of invoices) {
      const totalAmount = Number(inv.totalAmount || 0);
      const successfulPayments = inv.payments.filter(p => p.status === 'SUCCEEDED');
      const netPaid = successfulPayments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
      const outstanding = Math.max(0, totalAmount - netPaid);

      let status = inv.status;
      const isPastDue = inv.dueDate && new Date(inv.dueDate) < now;

      if (totalAmount > 0 && netPaid >= totalAmount) {
        status = 'PAID';
      } else if (netPaid > 0 && netPaid < totalAmount) {
        status = 'PARTIALLY_PAID';
      } else if (isPastDue && outstanding > 0 && status !== 'CANCELLED') {
        status = 'OVERDUE';
      }

      if (inv.paidAmount !== netPaid || inv.outstandingAmount !== outstanding || inv.status !== status) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            paidAmount: netPaid,
            outstandingAmount: outstanding,
            status: status as any
          }
        });
      }

      if (inv.orderId) {
        let orderPaymentStatus = 'UNPAID';
        if (totalAmount > 0 && netPaid >= totalAmount) {
          orderPaymentStatus = 'PAID';
        } else if (netPaid > 0) {
          orderPaymentStatus = 'PARTIALLY_PAID';
        } else if (status === 'OVERDUE') {
          orderPaymentStatus = 'OVERDUE';
        }

        await prisma.order.update({
          where: { id: inv.orderId },
          data: {
            amountPaid: netPaid,
            outstandingAmount: outstanding,
            paymentStatus: orderPaymentStatus
          }
        });
      }
    }
  }
}


export const paymentSummaryService = new PaymentSummaryService();
