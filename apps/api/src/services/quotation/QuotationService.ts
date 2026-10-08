import { prisma, QuotationStatus } from '@agent-flux/database';
import { GovernanceService } from '../governance/GovernanceService';
import { ApprovalService } from '../governance/ApprovalService';

export class QuotationService {
  
  async createQuotation(businessId: string, data: any) {
    // Deterministic Financial Calculation
    let subtotal = 0;
    const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
    
    const processedItems = lineItems.map((item: any) => {
      const q = Number(item.quantity) || 0;
      const p = Number(item.unitPrice) || 0;
      if (q < 0) throw new Error('Quantity cannot be negative');
      if (p < 0) throw new Error('Unit price cannot be negative');
      const d = Number(item.discount) || 0;
      if (d < 0) throw new Error('Discount cannot be negative');
      const t = Number(item.taxRate) || 0;
      if (t < 0) throw new Error('Tax rate cannot be negative');

      const lineSub = q * p;
      const afterDiscount = Math.max(0, lineSub - d);
      const taxAmt = afterDiscount * (t / 100);
      const lineTotal = afterDiscount + taxAmt;

      subtotal += lineSub;
      return { ...item, lineTotal };
    });

    const discountAmount = processedItems.reduce((acc: number, curr: any) => acc + (Number(curr.discount) || 0), 0);
    const taxAmount = processedItems.reduce((acc: number, curr: any) => acc + (curr.lineTotal - Math.max(0, (Number(curr.quantity)*Number(curr.unitPrice)) - (Number(curr.discount)||0))), 0);
    const totalAmount = subtotal - discountAmount + taxAmount;

    // Take snapshots
    const customer = await prisma.customer.findUnique({ where: { id: data.customerId, businessId } });
    const business = await prisma.business.findUnique({ where: { id: businessId } });

    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const businessQuotations = await prisma.quotation.count({ where: { businessId } });
        const quotationNumber = `QUO-${(businessQuotations + 1 + attempt).toString().padStart(6, '0')}`;

        return await prisma.quotation.create({
          data: {
            businessId,
            customerId: data.customerId,
            orderId: data.orderId,
            quotationNumber,
            status: 'DRAFT',
            subtotal,
            discountAmount,
            taxAmount,
            totalAmount,
            lineItems: processedItems,
            customerSnapshot: customer ? JSON.parse(JSON.stringify(customer)) : null,
            businessSnapshot: business ? JSON.parse(JSON.stringify(business)) : null,
            gmailThreadId: data.gmailThreadId,
          }
        });
      } catch (e: any) {
        if (e.code === 'P2002' && attempt < maxRetries - 1) {
          attempt++;
          continue;
        }
        throw e;
      }
    }
    throw new Error("Failed to generate unique quotation number after retries");
  }

  async getQuotation(businessId: string, id: string) {
    return prisma.quotation.findUnique({
      where: { id, businessId },
      include: { customer: true, order: true }
    });
  }

  async updateStatus(businessId: string, id: string, status: QuotationStatus, requestedById?: string) {
    const quotation = await prisma.quotation.findUnique({ where: { id, businessId } });
    if (!quotation) throw new Error('Quotation not found');

    if (status === 'SENT' && requestedById) {
      const discountPercentage = quotation.totalAmount ? (quotation.discountAmount / (quotation.subtotal || 1)) * 100 : 0;
      
      const context = {
        quotation: {
          grandTotal: quotation.totalAmount,
          discountPercentage,
          currency: quotation.currency
        }
      };

      const gov = await GovernanceService.evaluateAction(businessId, 'QUOTATION_SEND', context);
      
      if (gov.requiresApproval) {
        // check if there's already an active approved request
        const existingApprovals = await prisma.approvalRequest.findMany({
          where: { businessId, resourceId: id, actionType: 'QUOTATION_SEND', status: 'APPROVED' }
        });
        if (existingApprovals.length === 0) {
          const activePending = await prisma.approvalRequest.findFirst({
            where: { businessId, resourceId: id, actionType: 'QUOTATION_SEND', status: 'PENDING' }
          });
          
          if (!activePending) {
             await ApprovalService.createApprovalRequest(
               businessId,
               requestedById,
               'QUOTATION_SEND',
               'Quotation',
               id,
               context,
               gov.rule,
               'System generated approval for QUOTATION_SEND'
             );
          }
          throw new Error('APPROVAL_REQUIRED');
        }
      }
    }

    return prisma.quotation.update({
      where: { id, businessId },
      data: { status }
    });
  }
}

export const quotationService = new QuotationService();
