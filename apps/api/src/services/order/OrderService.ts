import { prisma } from '@agent-flux/database';
import { randomBytes } from 'crypto';
import { operationalSyncPoller } from '../queue/operationalSyncPoller';

export class OrderService {
  async generateOrderNumber(businessId: string): Promise<string> {
    const count = await prisma.order.count({ where: { businessId } });
    const sequence = (count + 1).toString().padStart(6, '0');
    return `AF-ORD-${sequence}`;
  }

  async processQuotationAcceptance(businessId: string, customerId: string, message: string, threadId: string) {
    // 1. Resolve quotation (prioritize thread context, then explicit quotation number)
    let quotation;
    
    if (threadId) {
      quotation = await prisma.quotation.findFirst({
        // @ts-ignore - Prisma client out of sync
        where: { businessId, customerId, gmailThreadId: threadId },
        orderBy: { createdAt: 'desc' }
      });
    }

    if (!quotation) {
      const qtnMatch = message.match(/AF-QTN-\d+/i);
      if (qtnMatch) {
        quotation = await prisma.quotation.findFirst({
          where: { businessId, customerId, quotationNumber: qtnMatch[0].toUpperCase() }
        });
      }
    }

    if (!quotation) {
      return { status: 'FAILED', emailBody: 'We could not find a valid quotation for your request. Please specify the quotation number.' };
    }

    // 2. Validate
    if (quotation.status === 'EXPIRED') return { status: 'FAILED', emailBody: 'This quotation has expired.' };
    if (quotation.status === 'CANCELLED') return { status: 'FAILED', emailBody: 'This quotation was cancelled.' };
    
    // Idempotency check: if order already created from this quotation
    const existingOrder = await prisma.order.findFirst({
      // @ts-ignore - Prisma client out of sync
      where: { businessId, quotationId: quotation.id }
    });

    if (existingOrder) {
      // Return existing order data
      return this.buildAcceptanceSuccessPayload(existingOrder, quotation);
    }

    // 3. Create Order transactionally
    let order;
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      const orderNumber = await this.generateOrderNumber(businessId);
      
      try {
        order = await prisma.$transaction(async (tx) => {
          // Lock/verify quotation hasn't changed
          const checkQtn = await tx.quotation.findUnique({ where: { id: quotation.id } });
          if (!checkQtn || checkQtn.orderId) throw new Error('QUOTATION_ALREADY_PROCESSED');
          if (checkQtn.validUntil && checkQtn.validUntil < new Date()) throw new Error('QUOTATION_EXPIRED');

          const newOrder = await tx.order.create({
            data: {
              businessId,
              customerId,
              // @ts-ignore - Prisma client out of sync
              quotationId: quotation.id,
              orderNumber,
              status: 'PENDING_OWNER_CONFIRMATION',
              source: 'GMAIL',
              subtotal: quotation.subtotal,
              discount: quotation.discountAmount,
              tax: quotation.taxAmount,
              totalAmount: quotation.totalAmount,
              currency: quotation.currency,
              statusHistory: {
                create: {
                  toStatus: 'PENDING_OWNER_CONFIRMATION',
                  reason: 'Customer accepted quotation via email, pending owner review'
                }
              }
            }
          });

          // Create Order Items
          const lineItems: any[] = typeof quotation.lineItems === 'string' ? JSON.parse(quotation.lineItems) : quotation.lineItems;
          if (Array.isArray(lineItems)) {
            // @ts-ignore - Prisma client out of sync
            await (tx as any).orderItem.createMany({
              data: lineItems.map(item => ({
                orderId: newOrder.id,
                productRef: item.sku || item.productRef,
                productName: item.productName || item.description || 'Unknown Product',
                sku: item.sku,
                description: item.description,
                quantity: item.quantity || 1,
                unitPrice: item.unitPrice || 0,
                taxableValue: item.taxableValue || ((item.unitPrice || 0) * (item.quantity || 1)),
                tax: item.taxAmount || 0,
                lineTotal: item.total || 0
              }))
            });
          }

          // Update quotation status and orderId
          await tx.quotation.update({
            where: { id: quotation.id },
            data: { status: 'ACCEPTED', orderId: newOrder.id }
          });

          return newOrder;
        });
        break;
      } catch (err: any) {
        if (err.message === 'QUOTATION_ALREADY_PROCESSED') {
          // @ts-ignore - Prisma client out of sync
          const raceOrder = await prisma.order.findFirst({ where: { businessId, quotationId: quotation.id } });
          if (raceOrder) {
            order = raceOrder;
            break;
          }
        }
        if (err.message === 'QUOTATION_EXPIRED') {
          return { status: 'FAILED', emailBody: 'Your quotation has expired. Please request a new quotation.' };
        }
        if (err.code === 'P2002' && err.meta?.target?.includes('orderNumber')) {
          continue; // Retry on unique constraint violation
        }
        throw err;
      }
    }

    if (!order) throw new Error('Order creation failed due to concurrency constraints.');

    // 4. Emit event
    const { EventBus } = require('../../services/eventBus');
    EventBus.publish(businessId, 'ORDER_CREATED', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      quotationId: quotation.id,
      customerId
    });

    const { operationalSyncPoller } = require('../queue/operationalSyncPoller');
    operationalSyncPoller.enqueue(businessId, 'ORDER', order.id, 'CREATE').catch(console.error);

    return this.buildAcceptanceSuccessPayload(order, quotation);
  }

  private async buildAcceptanceSuccessPayload(order: any, quotation: any) {
    const customer = await prisma.customer.findUnique({ where: { id: order.customerId } });
    
    // Formatting email exactly as requested by prompt
    let orderItemsSummary = '';
    try {
      const lineItems = typeof quotation.lineItems === 'string' ? JSON.parse(quotation.lineItems) : quotation.lineItems;
      if (Array.isArray(lineItems)) {
        orderItemsSummary = lineItems.map((item: any) => `${item.quantity || 1} × ${item.productName || item.description || 'Item'}`).join(', ');
      }
    } catch (e) {
      orderItemsSummary = 'Items confirmed';
    }

    let deliveryLocation = 'Customer Address';
    try {
      if (quotation.customerSnapshot) {
        const snap = typeof quotation.customerSnapshot === 'string' ? JSON.parse(quotation.customerSnapshot) : quotation.customerSnapshot;
        if (snap && snap.deliveryLocation) {
          deliveryLocation = snap.deliveryLocation;
        } else if (snap && snap.address) {
          deliveryLocation = snap.address;
        }
      } else if (order.deliveryLocation) {
        deliveryLocation = order.deliveryLocation;
      }
    } catch (e) {
      console.error('Error parsing customerSnapshot for deliveryLocation', e);
    }

    const emailBody = `Dear ${customer?.name || 'Customer'},

Thank you for accepting the quotation.

Your order request for ${orderItemsSummary} has been received and is currently pending final confirmation from our team.

Delivery Location: ${deliveryLocation}.

We will review your request and send you the formal order confirmation and invoice shortly.

Warm regards,
Aasha Furniture Team`;
    
    // Format for sheets sync
    const sheetsRow = [
      order.orderNumber,
      quotation.quotationNumber,
      customer?.name || '',
      customer?.email || '',
      'Products', // Simplification for product summary
      '1', // Simplification for quantity
      order.subtotal?.toString() || '0',
      order.discount?.toString() || '0',
      (order.subtotal - order.discount).toString(),
      order.tax?.toString() || '0',
      order.totalAmount?.toString() || '0',
      order.currency || 'INR',
      'Location',
      order.status,
      'PENDING',
      new Date().toISOString(),
      order.createdAt.toISOString(),
      order.updatedAt.toISOString()
    ];

    return {
      status: 'SUCCESS',
      emailSubject: `Order Confirmed – ${order.orderNumber}`,
      emailBody,
      sheetsRow
    };
  }

  async convertEnquiryToOrder(businessId: string, enquiryId: string, userId: string): Promise<any> {
    // 1. Validate business and enquiry ownership
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId, businessId },
      include: { customer: true }
    });

    if (!enquiry) {
      throw new Error('Enquiry not found or does not belong to this business');
    }

    // 2. Idempotency Check: Prevent duplicate conversion
    let existingOrder = await prisma.order.findUnique({
      where: { enquiryId }
    });

    if (existingOrder) {
      return existingOrder; // Return existing if already converted
    }

    // 3. Verify workflow configuration if any (for Phase 0 reuse)
    let totalAmount = 0;
    const structuredData = (enquiry.structuredData as Record<string, any>) || {};

    if (structuredData.totalAmount) {
      totalAmount = parseFloat(structuredData.totalAmount);
    } else if (structuredData.price || structuredData.budget) {
      totalAmount = parseFloat(structuredData.price || structuredData.budget);
    }

    let order;
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      const orderNumber = await this.generateOrderNumber(businessId);
      
      try {
        // 4. Transaction to ensure Order creation and History creation atomicity
        order = await prisma.$transaction(async (tx) => {
          const newOrder = await tx.order.create({
            data: {
              businessId,
              customerId: enquiry.customerId,
              enquiryId: enquiry.id,
              workflowId: enquiry.workflowId,
              orderNumber,
              status: 'DRAFT',
              source: enquiry.source,
              structuredData: enquiry.structuredData as any,
              totalAmount: isNaN(totalAmount) ? null : totalAmount,
              currency: 'USD',
              assignedTo: enquiry.assignedTo,
              statusHistory: {
                create: {
                  toStatus: 'DRAFT',
                  reason: 'Converted from Enquiry',
                  changedById: userId
                }
              }
            }
          });

          // Optionally, update enquiry status to RESOLVED or PROCESSING
          await tx.enquiry.update({
            where: { id: enquiry.id },
            data: { status: 'RESOLVED' }
          });

          return newOrder;
        });
        
        break; // Success, exit loop
      } catch (error: any) {
        if (error.code === 'P2002') {
          const target = error.meta?.target as string[] | string | undefined;
          const targetStr = Array.isArray(target) ? target.join(',') : (target || '');
          
          if (targetStr.includes('enquiryId')) {
            // Race condition: another request created the order
            const raceOrder = await prisma.order.findUnique({ where: { enquiryId } });
            if (raceOrder) return raceOrder;
          }
          if (targetStr.includes('orderNumber')) {
            // Race condition: order number collision, retry loop
            continue;
          }
        }
        throw error;
      }
    }
    
    if (!order) throw new Error('Failed to create order due to concurrent collisions');

    // 5. Trigger operational synchronization (Phase 3)
    // Send to durable job queue
    operationalSyncPoller.enqueue(businessId, 'ORDER', order.id, 'CREATE').catch(console.error);
    operationalSyncPoller.enqueue(businessId, 'ENQUIRY', enquiry.id, 'UPDATE').catch(console.error);

    return order;
  }

  async getOrders(businessId: string, filters: any = {}) {
    const where: any = { businessId };
    
    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.assignedTo) where.assignedTo = filters.assignedTo;
    
    return prisma.order.findMany({
      where,
      include: {
        customer: true,
        assignee: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getOrder(businessId: string, orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, businessId },
      include: {
        customer: true,
        enquiry: true,
        assignee: true,
        statusHistory: {
          include: { changedBy: true },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    return order;
  }

  async updateOrderStatus(businessId: string, orderId: string, newStatus: string, userId: string, reason?: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId, businessId } });
    if (!order) throw new Error('Order not found');

    // Simple transition validation could go here based on Workflow configuration.
    // Assuming generic configuration allows transitions if valid strings.
    if (order.status === newStatus) return order;

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: newStatus }
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: newStatus,
          reason,
          changedById: userId
        }
      });

      return updated;
    });

    // Operational Sync
    operationalSyncPoller.enqueue(businessId, 'ORDER', updatedOrder.id, 'STATUS_UPDATE').catch(console.error);

    // Trigger Invoice Generation Pipeline explicitly if owner confirmed
    if (newStatus === 'CONFIRMED' && order.status === 'PENDING_OWNER_CONFIRMATION') {
        const { invoiceService } = require('../invoice/InvoiceService');
        try {
            const invoiceId = await invoiceService.generateInvoice(businessId, updatedOrder.id);
            // Optionally auto-send or rely on another trigger. We'll auto-send since it's confirmed.
            invoiceService.sendInvoice(businessId, invoiceId).catch(console.error);
        } catch (e) {
            console.error('[OrderService] Failed to generate/send invoice upon confirmation:', e);
        }
    }

    return updatedOrder;
  }

  async updateOrder(businessId: string, orderId: string, data: any, userId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId, businessId } });
    if (!order) throw new Error('Order not found');

    // Prevent restricted fields update
    delete data.businessId;
    delete data.id;
    delete data.orderNumber;
    delete data.enquiryId;
    delete data.createdAt;

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data
    });

    operationalSyncPoller.enqueue(businessId, 'ORDER', updatedOrder.id, 'UPDATE').catch(console.error);

    return updatedOrder;
  }
}

export const orderService = new OrderService();
