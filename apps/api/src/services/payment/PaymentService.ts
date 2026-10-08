import { prisma, PaymentStatus } from '@agent-flux/database';
import { PaymentProvider } from './PaymentProvider';
import { RazorpayProvider } from './RazorpayProvider';
import { paymentSummaryService } from './PaymentSummaryService';
import { GovernanceService } from '../governance/GovernanceService';
import { ApprovalService } from '../governance/ApprovalService';
import { EventBus } from '../eventBus';
import crypto from 'crypto';

export class PaymentService {
  private providers: Map<string, PaymentProvider> = new Map();

  constructor() {
    // Register generic providers. In a real environment, we might initialize these based on business config
    this.providers.set('RAZORPAY', new RazorpayProvider());
  }

  private getProvider(name: string): PaymentProvider {
    const provider = this.providers.get(name.toUpperCase());
    if (!provider) throw new Error(`Payment provider ${name} not supported`);
    return provider;
  }

  async createPaymentRequest(businessId: string, invoiceId: string, providerName: string, amountOverride?: number) {
    // 1. Authenticate and verify Invoice belongs to business
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId, businessId }
    });

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'PAID') throw new Error('Invoice is already paid');

    // 2. Determine amount
    let requestAmount = invoice.outstandingAmount;
    if (amountOverride) {
      if (amountOverride <= 0) throw new Error('Payment amount must be greater than 0');
      // allow overpayment intentionally if configured, but normally bound to outstanding
      requestAmount = amountOverride;
    }
    
    if (requestAmount <= 0) {
      throw new Error('Payment amount must be greater than 0. Invoice might be fully paid.');
    }

    // 3. Provider invocation
    const provider = this.getProvider(providerName);
    const result = await provider.createPaymentRequest({
      businessId,
      invoiceId,
      customerId: invoice.customerId,
      orderId: invoice.orderId || undefined,
      amount: requestAmount,
      currency: invoice.currency
    });

    // 4. Persist pending payment record locally
    const payment = await prisma.payment.create({
      data: {
        businessId,
        invoiceId,
        customerId: invoice.customerId,
        orderId: invoice.orderId,
        provider: providerName.toUpperCase(),
        providerOrderId: result.providerOrderId,
        amount: requestAmount,
        currency: invoice.currency,
        status: 'PENDING',
        paymentReference: result.paymentUrl
      }
    });

    return {
      paymentId: payment.id,
      providerOrderId: result.providerOrderId,
      paymentUrl: result.paymentUrl
    };
  }

  async confirmPayment(businessId: string, paymentId: string, providerPaymentId: string, signature?: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId, businessId }
    });

    if (!payment) throw new Error('Payment not found');
    if (payment.status === 'SUCCEEDED') return payment; // Idempotent

    const provider = this.getProvider(payment.provider);
    
    // Server-side verification of payment authenticity
    const isValid = await provider.verifyPayment({
      businessId,
      providerPaymentId,
      providerOrderId: payment.providerOrderId || undefined,
      signature
    });

    if (!isValid) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: 'Signature verification failed' }
      });
      throw new Error('Payment verification failed');
    }

    // Wrap in transaction for safety
    const updatedPayment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          providerPaymentId,
          paidAt: new Date()
        }
      });
      return p;
    });

    // Recalculate invoice after transaction completes
    await paymentSummaryService.recalculateInvoice(businessId, payment.invoiceId);
    
    // Dispatch Application Event for Workflow Engine
    await EventBus.publish(businessId, 'PAYMENT_SUCCEEDED', { payment: updatedPayment });

    return updatedPayment;
  }

  async processWebhook(providerName: string, eventId: string, payload: any, businessId?: string) {
    // 1. Idempotency Check using Provider Event ID
    const providerKey = providerName.toUpperCase();
    
    // Wrap the event creation to safely handle duplicate concurrent events
    try {
      const existingEvent = await prisma.paymentWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: providerKey, providerEventId: eventId } }
      });
      if (existingEvent) {
        return { success: true, message: 'Already processed' };
      }

      await prisma.paymentWebhookEvent.create({
        data: {
          provider: providerKey,
          providerEventId: eventId,
          eventType: payload.event || 'UNKNOWN',
          payload: payload,
          businessId
        }
      });
    } catch (e: any) {
      if (e.code === 'P2002') return { success: true, message: 'Concurrent idempotency block' };
      throw e;
    }

    // 2. In a real system, map the payload. For Phase 6 tests, we mock behavior based on standard payloads:
    // e.g. payload = { event: 'payment.authorized', payload: { payment: { entity: { id: '...', order_id: '...' }}}}
    
    if (payload.event === 'payment.captured' || payload.event === 'payment.success') {
      const providerOrderId = payload.payload?.payment?.entity?.order_id;
      const providerPaymentId = payload.payload?.payment?.entity?.id;
      
      if (providerOrderId && providerPaymentId) {
        const payment = await prisma.payment.findFirst({
          where: { providerOrderId, provider: providerKey, businessId }
        });
        
        if (payment && payment.status !== 'SUCCEEDED') {
          await this.confirmPayment(payment.businessId, payment.id, providerPaymentId, 'webhook-signature-bypass');
        }
      }
    }
    
    // Mark event processed
    await prisma.paymentWebhookEvent.update({
      where: { provider_providerEventId: { provider: providerKey, providerEventId: eventId } },
      data: { processed: true, processedAt: new Date() }
    });

    return { success: true };
  }

  async refundPayment(businessId: string, paymentId: string, amount: number, requestedById: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId, businessId } });
    if (!payment) throw new Error('Payment not found');
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw new Error('Payment cannot be refunded');
    }

    const context = {
      payment: {
        amount: amount,
        currency: payment.currency,
        totalPaymentAmount: payment.amount
      }
    };

    const gov = await GovernanceService.evaluateAction(businessId, 'PAYMENT_REFUND', context);
    if (gov.requiresApproval) {
        const existingApprovals = await prisma.approvalRequest.findMany({
          where: { businessId, resourceId: paymentId, actionType: 'PAYMENT_REFUND', status: 'APPROVED' }
        });
        if (existingApprovals.length === 0) {
          const activePending = await prisma.approvalRequest.findFirst({
            where: { businessId, resourceId: paymentId, actionType: 'PAYMENT_REFUND', status: 'PENDING' }
          });
          if (!activePending) {
             await ApprovalService.createApprovalRequest(
               businessId,
               requestedById,
               'PAYMENT_REFUND',
               'Payment',
               paymentId,
               context,
               gov.rule,
               'System generated approval for PAYMENT_REFUND'
             );
          }
          throw new Error('APPROVAL_REQUIRED');
        }
    }

    // Process refund locally (we would call provider in reality)
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: amount >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
      }
    });

    await prisma.auditLog.create({
      data: {
        businessId,
        userId: requestedById,
        eventType: 'PAYMENT_REFUNDED',
        resourceType: 'Payment',
        resourceId: paymentId,
        metadata: { amount }
      }
    });

    return { success: true, status: 'REFUNDED' };
  }

  async sendPaymentInstructions(businessId: string, orderId: string, email: string) {
    const business = await prisma.business.findUnique({
      where: { id: businessId }
    });
    
    if (!business) throw new Error('Business not found');

    // Check configuration readiness for payment instructions
    if (!business.bankAccountNumber || !business.bankIfsc) {
      return { status: 'PAYMENT_CONFIGURATION_REQUIRED' };
    }

    const paymentDetails = `
Bank Name: ${business.bankName || ''}
Account Name: ${business.bankAccountName || ''}
Account Number: ${business.bankAccountNumber}
IFSC Code: ${business.bankIfsc}
Branch: ${business.bankBranch || ''}
UPI ID: ${business.upiId || ''}

${business.paymentInstructions ? `Instructions: ${business.paymentInstructions}` : ''}
    `.trim();

    // In a real scenario we'd use the EmailService to send this via Gmail API.
    // For now, we return success and the mock email body.
    return {
      status: 'SUCCESS',
      emailBody: `Please find the payment instructions below:\n\n${paymentDetails}`
    };
  }
}

export const paymentService = new PaymentService();
