import { prisma, InvoiceStatus, PaymentStatus, Prisma } from '@agent-flux/database';
import { accountService } from './AccountService';
import { ledgerService } from './LedgerService';

export interface SyncResult {
  success: boolean;
  journalEntryId?: string;
  entryNumber?: string;
  alreadySynced?: boolean;
  error?: string;
}

export class LedgerSyncService {
  /**
   * Synchronises an issued customer invoice to the General Ledger.
   * Debits Accounts Receivable (1200) and Credits Sales Revenue (4010) + Tax Payable (2100).
   */
  async syncInvoiceToLedger(
    businessId: string,
    invoiceId: string,
    userId?: string
  ): Promise<SyncResult> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId, businessId },
      include: {
        customer: true,
        business: true
      }
    });

    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found in business ${businessId}`);
    }

    // Only non-draft, active invoices should be posted to the ledger
    const validStatuses: InvoiceStatus[] = ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
    if (!validStatuses.includes(invoice.status)) {
      return {
        success: false,
        error: `Invoice ${invoice.invoiceNumber} status is ${invoice.status}; only issued invoices can be posted to ledger.`
      };
    }

    const idempotencyKey = `inv-ledger-${invoice.id}`;

    // Check if already posted
    const existing = await prisma.journalEntry.findUnique({
      where: {
        businessId_sourceType_sourceId: {
          businessId,
          sourceType: 'CUSTOMER_INVOICE',
          sourceId: invoice.id
        }
      }
    });

    if (existing) {
      return {
        success: true,
        journalEntryId: existing.id,
        entryNumber: existing.entryNumber,
        alreadySynced: true
      };
    }

    // Resolve system Chart of Accounts
    const arAccount = await accountService.getSystemAccount(businessId, 'ACCOUNTS_RECEIVABLE');
    const revenueAccount = await accountService.getSystemAccount(businessId, 'OPERATING_REVENUE');
    const taxAccount = await accountService.getSystemAccount(businessId, 'TAX_PAYABLE');

    // Financial arithmetic using exact decimals
    const totalAmount = new Prisma.Decimal(invoice.totalAmount);
    const taxAmount = new Prisma.Decimal(invoice.taxAmount);
    const discountAmount = new Prisma.Decimal(invoice.discountAmount);
    const subtotal = new Prisma.Decimal(invoice.subtotal);

    // In double-entry: Total Debit (AR) = Total Credit (Revenue + Tax)
    // Net revenue earned = Total gross - Tax
    const netRevenue = totalAmount.sub(taxAmount);

    const lines: any[] = [
      {
        accountId: arAccount.id,
        debit: totalAmount,
        credit: new Prisma.Decimal(0),
        description: `Accounts Receivable for Invoice ${invoice.invoiceNumber}`,
        currency: invoice.currency
      },
      {
        accountId: revenueAccount.id,
        debit: new Prisma.Decimal(0),
        credit: netRevenue,
        description: `Sales Revenue for Invoice ${invoice.invoiceNumber}`,
        currency: invoice.currency
      }
    ];

    if (taxAmount.greaterThan(0)) {
      lines.push({
        accountId: taxAccount.id,
        debit: new Prisma.Decimal(0),
        credit: taxAmount,
        description: `Sales Tax / GST Payable on Invoice ${invoice.invoiceNumber}`,
        currency: invoice.currency
      });
    }

    const customerName = invoice.customer ? invoice.customer.name : 'Customer';
    const journalEntry = await ledgerService.createJournalEntry(
      businessId,
      {
        postingDate: invoice.invoiceDate,
        memo: `Invoice ${invoice.invoiceNumber} issued to ${customerName}`,
        sourceType: 'CUSTOMER_INVOICE',
        sourceId: invoice.id,
        idempotencyKey,
        lines,
        autoPost: true
      },
      userId
    );

    return {
      success: true,
      journalEntryId: journalEntry.id,
      entryNumber: journalEntry.entryNumber,
      alreadySynced: false
    };
  }

  /**
   * Synchronises a received customer payment to the General Ledger.
   * Debits Operating Bank (1010) and Credits Accounts Receivable (1200).
   * If payment gateway processing fees exist, debits Payment Gateway Fees (6010).
   */
  async syncPaymentToLedger(
    businessId: string,
    paymentId: string,
    userId?: string
  ): Promise<SyncResult> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId, businessId },
      include: {
        invoice: true,
        customer: true
      }
    });

    if (!payment) {
      throw new Error(`Payment ${paymentId} not found in business ${businessId}`);
    }

    if (payment.status !== 'SUCCEEDED') {
      return {
        success: false,
        error: `Payment status is ${payment.status}; only SUCCEEDED payments are posted to ledger.`
      };
    }

    const idempotencyKey = `pay-ledger-${payment.id}`;

    // Check if already posted
    const existing = await prisma.journalEntry.findUnique({
      where: {
        businessId_sourceType_sourceId: {
          businessId,
          sourceType: 'CUSTOMER_PAYMENT',
          sourceId: payment.id
        }
      }
    });

    if (existing) {
      return {
        success: true,
        journalEntryId: existing.id,
        entryNumber: existing.entryNumber,
        alreadySynced: true
      };
    }

    // Resolve system Chart of Accounts
    const bankAccount = await accountService.getSystemAccount(businessId, 'CASH_AND_BANK');
    const arAccount = await accountService.getSystemAccount(businessId, 'ACCOUNTS_RECEIVABLE');
    const feeAccount = await accountService.getSystemAccount(businessId, 'OPERATING_EXPENSE');

    const totalPaid = new Prisma.Decimal(payment.amount);
    
    // Extract optional gateway fee
    const meta = (payment.metadata as any) || {};
    const feeNumber = Number(meta.fee ?? meta.feeAmount ?? 0);
    const gatewayFee = feeNumber > 0 ? new Prisma.Decimal(feeNumber) : new Prisma.Decimal(0);
    const netDeposit = totalPaid.sub(gatewayFee);

    const invNum = payment.invoice ? payment.invoice.invoiceNumber : 'Direct';
    const lines: any[] = [
      {
        accountId: bankAccount.id,
        debit: netDeposit,
        credit: new Prisma.Decimal(0),
        description: `Bank deposit for Invoice ${invNum} (${payment.provider})`,
        currency: payment.currency
      }
    ];

    if (gatewayFee.greaterThan(0)) {
      lines.push({
        accountId: feeAccount.id,
        debit: gatewayFee,
        credit: new Prisma.Decimal(0),
        description: `Payment gateway fee for Invoice ${invNum} (${payment.provider})`,
        currency: payment.currency
      });
    }

    lines.push({
      accountId: arAccount.id,
      debit: new Prisma.Decimal(0),
      credit: totalPaid,
      description: `Accounts Receivable settlement for Invoice ${invNum}`,
      currency: payment.currency
    });

    const customerName = payment.customer ? payment.customer.name : 'Customer';
    const journalEntry = await ledgerService.createJournalEntry(
      businessId,
      {
        postingDate: payment.paidAt || payment.createdAt,
        memo: `Payment received for Invoice ${invNum} from ${customerName} via ${payment.provider}`,
        sourceType: 'CUSTOMER_PAYMENT',
        sourceId: payment.id,
        idempotencyKey,
        lines,
        autoPost: true
      },
      userId
    );

    return {
      success: true,
      journalEntryId: journalEntry.id,
      entryNumber: journalEntry.entryNumber,
      alreadySynced: false
    };
  }

  /**
   * Automatically reverses the journal entry when an invoice is cancelled.
   */
  async syncInvoiceCancellationToLedger(
    businessId: string,
    invoiceId: string,
    reason: string = 'Invoice cancelled',
    userId?: string
  ): Promise<SyncResult> {
    const existing = await prisma.journalEntry.findUnique({
      where: {
        businessId_sourceType_sourceId: {
          businessId,
          sourceType: 'CUSTOMER_INVOICE',
          sourceId: invoiceId
        }
      }
    });

    if (!existing) {
      return { success: true, error: 'No journal entry found to void' };
    }

    const voidResult = await ledgerService.voidJournalEntry(
      businessId,
      existing.id,
      reason,
      userId
    );

    return {
      success: true,
      journalEntryId: voidResult.reversalEntry ? voidResult.reversalEntry.id : existing.id,
      entryNumber: voidResult.reversalEntry ? voidResult.reversalEntry.entryNumber : existing.entryNumber
    };
  }

  /**
   * Batch synchronises any unsynced issued invoices and succeeded payments.
   */
  async batchSyncOperationalRecords(businessId: string): Promise<{
    invoicesSynced: number;
    paymentsSynced: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let invoicesSynced = 0;
    let paymentsSynced = 0;

    // 1. Invoices
    const invoices = await prisma.invoice.findMany({
      where: {
        businessId,
        status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] }
      }
    });

    for (const inv of invoices) {
      try {
        const res = await this.syncInvoiceToLedger(businessId, inv.id);
        if (res.success && !res.alreadySynced) {
          invoicesSynced++;
        }
      } catch (err: any) {
        errors.push(`Invoice ${inv.invoiceNumber}: ${err.message}`);
      }
    }

    // 2. Payments
    const payments = await prisma.payment.findMany({
      where: {
        businessId,
        status: 'SUCCEEDED'
      }
    });

    for (const pay of payments) {
      try {
        const res = await this.syncPaymentToLedger(businessId, pay.id);
        if (res.success && !res.alreadySynced) {
          paymentsSynced++;
        }
      } catch (err: any) {
        errors.push(`Payment ${pay.id}: ${err.message}`);
      }
    }

    return {
      invoicesSynced,
      paymentsSynced,
      errors
    };
  }
}

export const ledgerSyncService = new LedgerSyncService();
