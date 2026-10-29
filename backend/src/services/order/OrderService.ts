import { prisma } from '@agent-flux/database';
import { randomBytes } from 'crypto';
import { operationalSyncPoller } from '../queue/operationalSyncPoller';
import { LifecycleStateMachine, OrderState } from './LifecycleStateMachine';
import { EventBus } from '../eventBus';

export class OrderService {
  async generateOrderNumber(businessId: string): Promise<string> {
    const count = await prisma.order.count({ where: { businessId } });
    const sequence = (count + 1).toString().padStart(6, '0');
    return `ORD-${sequence}`;
  }

  async processQuotationAcceptance(businessId: string, customerId: string, message: string, threadId: string) {
    // 1. Resolve quotation (prioritize thread context, then exact UUID, then quotation number)
    let quotation;
    
    if (threadId) {
      quotation = await prisma.quotation.findFirst({
        where: { businessId, customerId, gmailThreadId: threadId } as any,
        orderBy: { createdAt: 'desc' }
      });
    }

    if (!quotation && message) {
      // Check for UUID match
      const uuidMatch = message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (uuidMatch) {
        quotation = await prisma.quotation.findFirst({
          where: { businessId, customerId, id: uuidMatch[0] }
        });
      }
    }

    if (!quotation) {
      const qtnMatch = message.match(/(?:AF-QTN-|QUO-)[A-Za-z0-9_-]+/i);
      if (qtnMatch) {
        quotation = await prisma.quotation.findFirst({
          where: { businessId, customerId, quotationNumber: qtnMatch[0].toUpperCase() }
        });
      }
    }

    if (!quotation) {
      return { status: 'FAILED', emailBody: 'We could not find a valid quotation for your request. Please specify the quotation number.' };
    }

    // 2. Validate Quotation State
    if (quotation.status === 'EXPIRED' || (quotation.validUntil && new Date(quotation.validUntil) < new Date())) {
      return { status: 'FAILED', emailBody: 'This quotation has expired.' };
    }
    if (quotation.status === 'CANCELLED') {
      return { status: 'FAILED', emailBody: 'This quotation was cancelled.' };
    }
    
    // Idempotency check: if order already created from this quotation
    const existingOrder = await prisma.order.findFirst({
      where: { businessId, quotationId: quotation.id }
    });

    if (existingOrder) {
      // Return existing order data idempotently
      return this.buildAcceptanceSuccessPayload(existingOrder, quotation);
    }

    // Check owner approval configuration
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    const preferences = (business?.preferences as any) || {};
    const requiresOwnerApproval = Boolean(preferences.requireOwnerApprovalForOrders);

    const initialStatus = requiresOwnerApproval ? 'PENDING_OWNER_CONFIRMATION' : 'CONFIRMED';
    const statusReason = requiresOwnerApproval 
      ? 'Customer accepted quotation via email, pending owner review'
      : 'Customer accepted quotation via email, auto-confirmed';

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

          const rawLineItems = typeof quotation.lineItems === 'string' ? JSON.parse(quotation.lineItems) : quotation.lineItems;
          const lineItems = Array.isArray(rawLineItems) ? rawLineItems : [];

          const newOrder = await tx.order.create({
            data: {
              businessId,
              customerId,
              quotationId: quotation.id,
              orderNumber,
              status: initialStatus,
              source: 'GMAIL',
              subtotal: quotation.subtotal,
              discount: quotation.discountAmount,
              tax: quotation.taxAmount,
              totalAmount: quotation.totalAmount,
              currency: quotation.currency,
              structuredData: {
                lineItems,
                quotationNumber: quotation.quotationNumber,
                customerSnapshot: quotation.customerSnapshot,
                requiresOwnerApproval
              },
              statusHistory: {
                create: {
                  toStatus: initialStatus,
                  reason: statusReason
                }
              }
            }
          });

          // Create Order Items if model supported
          try {
            if (lineItems.length > 0 && (tx as any).orderItem) {
              await (tx as any).orderItem.createMany({
                data: lineItems.map((item: any) => ({
                  orderId: newOrder.id,
                  productRef: item.sku || item.productRef,
                  productName: item.productName || item.description || 'Unknown Product',
                  sku: item.sku,
                  description: item.description,
                  quantity: item.quantity || 1,
                  unitPrice: item.unitPrice || 0,
                  taxableValue: item.taxableValue || ((item.unitPrice || 0) * (item.quantity || 1)),
                  tax: item.taxAmount || 0,
                  lineTotal: item.total || item.lineTotal || 0
                }))
              });
            }
          } catch {
            // Safe fallback if orderItem model is absent
          }

          // Update quotation status and orderId
          await tx.quotation.update({
            where: { id: quotation.id },
            data: { status: 'ACCEPTED', orderId: newOrder.id }
          });

          return newOrder;
        }, { timeout: 15000, maxWait: 10000 });
        break;
      } catch (err: any) {
        if (err.message === 'QUOTATION_ALREADY_PROCESSED') {
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

    // 4. Emit event based on approval state
    const { EventBus } = require('../../services/eventBus');
    if (order.status === 'CONFIRMED') {
      EventBus.publish(businessId, 'ORDER_CONFIRMED', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        quotationId: quotation.id,
        customerId
      });
    } else {
      EventBus.publish(businessId, 'ORDER_CREATED', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        quotationId: quotation.id,
        customerId,
        requiresOwnerApproval: true
      });
    }

    const { operationalSyncPoller } = require('../queue/operationalSyncPoller');
    operationalSyncPoller.enqueue(businessId, 'ORDER', order.id, 'CREATE').catch(console.error);
    operationalSyncPoller.enqueue(businessId, 'QUOTATION', quotation.id, 'UPDATE').catch(console.error);

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
              currency: 'INR',
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

  async createManualOrder(businessIdOrData: any, maybeData?: any, maybeUserId?: string): Promise<any> {
    let businessId: string;
    let data: any;
    let userId: string | undefined;

    if (typeof businessIdOrData === 'object' && businessIdOrData !== null) {
      businessId = businessIdOrData.businessId;
      data = businessIdOrData;
      userId = businessIdOrData.userId || maybeUserId;
    } else {
      businessId = businessIdOrData;
      data = maybeData || {};
      userId = maybeUserId;
    }
    const { orderPriorityService } = await import('./OrderPriorityService');
    const { customerBalanceService } = await import('../finance/CustomerBalanceService');
    const { customerPaymentScoreService } = await import('../customer/CustomerPaymentScoreService');

    // 1. Idempotency Check: if idempotencyKey was provided, check if order exists
    if (data.idempotencyKey) {
      const existing = await prisma.order.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId,
            idempotencyKey: data.idempotencyKey
          }
        },
        include: {
          customer: true,
          vendor: true,
          statusHistory: true
        }
      });
      if (existing) {
        return existing;
      }
    }

    // 2. Resolve or Create Customer
    let customerId = data.customerId;
    if (!customerId && (data.customerName || data.customerEmail || data.customerPhone)) {
      // Find or create customer
      const existingCustomer = await prisma.customer.findFirst({
        where: {
          businessId,
          OR: [
            ...(data.customerEmail ? [{ email: data.customerEmail }] : []),
            ...(data.customerPhone ? [{ phone: data.customerPhone }] : [])
          ]
        }
      });

      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const newCustomer = await prisma.customer.create({
          data: {
            businessId,
            name: data.customerName || 'Direct Customer',
            email: data.customerEmail || null,
            phone: data.customerPhone || null,
            source: 'MANUAL_ENTRY',
            creditLimit: data.creditLimit ? Number(data.creditLimit) : 0,
            customData: data.customerAddress ? { address: data.customerAddress } : undefined
          }
        });
        customerId = newCustomer.id;
      }
    }

    if (!customerId) {
      throw new Error('A customer must be selected or customer details provided.');
    }

    // 3. Process Line Items and Calculate Totals
    const rawItems = Array.isArray(data.items) ? data.items : [];
    if (rawItems.length === 0 && !data.totalAmount) {
      throw new Error('At least one order line item or a total amount is required.');
    }

    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    const lineItems = rawItems.map((item: any) => {
      const qty = Number(item.quantity || 1);
      const unitPrice = Number(item.unitPrice || 0);
      const discount = Number(item.discount || 0);
      const taxRate = Number(item.taxRate || 0);

      const itemSubtotal = qty * unitPrice;
      const taxableAmount = Math.max(0, itemSubtotal - discount);
      const itemTax = (taxableAmount * taxRate) / 100;
      const lineTotal = taxableAmount + itemTax;

      subtotal += itemSubtotal;
      totalDiscount += discount;
      totalTax += itemTax;

      return {
        productName: item.productName || item.description || 'Product / Service',
        description: item.description || '',
        quantity: qty,
        unitPrice,
        discount,
        taxRate,
        lineTotal: Math.round(lineTotal * 100) / 100
      };
    });

    const calculatedTotal = Math.max(0, subtotal - totalDiscount + totalTax);
    const totalAmount = data.totalAmount !== undefined ? Number(data.totalAmount) : calculatedTotal;

    // 4. Paid and Outstanding Amounts
    const amountPaid = Number(data.paidAmount || data.amountPaid || 0);
    const outstandingAmount = Math.max(0, totalAmount - amountPaid);
    
    let paymentStatus = data.paymentStatus || 'UNPAID';
    if (totalAmount > 0 && amountPaid >= totalAmount) {
      paymentStatus = 'PAID';
    } else if (amountPaid > 0 && amountPaid < totalAmount) {
      paymentStatus = 'PARTIALLY_PAID';
    } else {
      paymentStatus = 'UNPAID';
    }

    // 5. Customer Financial Exposure and Priority Evaluation
    const financialSummary = await customerBalanceService.getCustomerFinancialSummary(
      businessId,
      customerId
    );

    const initialDueAt = data.dueAt ? new Date(data.dueAt) : null;
    const initialStatus = data.status || 'CONFIRMED';

    const priorityEval = orderPriorityService.evaluateOrderPriority(
      {
        totalAmount,
        dueAt: initialDueAt,
        status: initialStatus,
        paymentStatus
      },
      financialSummary,
      0,
      0
    );

    // 6. Generate Unique Order Number and Persist Transactionally
    let order;
    let attempts = 0;
    while (attempts < 5) {
      attempts++;
      const orderNumber = await this.generateOrderNumber(businessId);

      try {
        order = await prisma.$transaction(async (tx) => {
          const createdOrder = await tx.order.create({
            data: {
              businessId,
              customerId,
              orderNumber,
              status: initialStatus,
              source: data.source || 'MANUAL',
              subtotal,
              discount: totalDiscount,
              tax: totalTax,
              totalAmount,
              currency: data.currency || 'INR',
              dueAt: initialDueAt,
              scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
              notes: data.notes || null,
              assignedTo: data.assignedTo || null,
              idempotencyKey: data.idempotencyKey || null,
              vendorId: data.vendorId || null,

              priority: priorityEval.priority,
              priorityScore: priorityEval.priorityScore,
              priorityReason: priorityEval.priorityReason,
              priorityFactors: priorityEval.riskFlags as any,

              paymentStatus,
              amountPaid,
              outstandingAmount,
              paymentTerms: data.paymentTerms || 'NET_30',
              lineItems: lineItems as any,
              structuredData: {
                lineItems,
                paymentTerms: data.paymentTerms || 'NET_30',
                createdManually: true,
                creditWarning: financialSummary.creditBreached
              },
              statusHistory: {
                create: {
                  toStatus: initialStatus,
                  reason: data.statusReason || 'Manual order creation',
                  changedById: userId || null
                }
              }
            },
            include: {
              customer: true,
              vendor: true,
              statusHistory: true
            }
          });

          // If an initial payment occurred, record it in Payment table
          if (amountPaid > 0 && data.recordPaymentNow) {
            await tx.payment.create({
              data: {
                businessId,
                customerId,
                orderId: createdOrder.id,
                invoiceId: createdOrder.id, // linked to order
                amount: amountPaid,
                currency: data.currency || 'INR',
                status: 'SUCCEEDED',
                provider: data.paymentMethod || 'MANUAL',
                method: data.paymentMethod || 'CASH_OR_TRANSFER',
                paidAt: new Date()
              }
            });
          }

          return createdOrder;
        });

        break;
      } catch (err: any) {
        if (err.code === 'P2002') {
          // unique constraint violation on orderNumber or idempotencyKey
          if (err.meta?.target?.includes('idempotencyKey') && data.idempotencyKey) {
            return await prisma.order.findUnique({
              where: {
                businessId_idempotencyKey: {
                  businessId,
                  idempotencyKey: data.idempotencyKey
                }
              },
              include: { customer: true, vendor: true }
            });
          }
          continue; // retry with new orderNumber
        }
        throw err;
      }
    }

    if (!order) {
      throw new Error('Failed to create order due to concurrent collision');
    }

    // 7. Recalculate customer score and exposure asynchronously
    customerPaymentScoreService.calculateAndPersistScore(businessId, customerId).catch(console.error);

    // 8. Publish Event and Operational Sync
    EventBus.publish(businessId, 'ORDER_CREATED', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      totalAmount: order.totalAmount,
      priority: order.priority
    });

    operationalSyncPoller.enqueue(businessId, 'ORDER', order.id, 'CREATE').catch(console.error);

    return order;
  }

  async getOrders(businessId: string, filters: any = {}) {
    const where: any = { businessId };
    
    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.assignedTo) where.assignedTo = filters.assignedTo;
    if (filters.priority) where.priority = filters.priority;
    if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters.vendorId) where.vendorId = filters.vendorId;

    if (filters.overdueOnly === 'true' || filters.overdueOnly === true) {
      where.dueAt = { lt: new Date() };
      where.status = { notIn: ['COMPLETED', 'DELIVERED', 'CANCELLED'] };
    }

    if (filters.search) {
      const q = String(filters.search).trim();
      where.OR = [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { phone: { contains: q, mode: 'insensitive' } } },
        { customer: { email: { contains: q, mode: 'insensitive' } } }
      ];
    }
    
    return prisma.order.findMany({
      where,
      include: {
        customer: true,
        vendor: true,
        assignee: true,
        invoices: {
          select: { id: true, invoiceNumber: true, status: true, totalAmount: true, paidAmount: true, outstandingAmount: true }
        },
        Payment: {
          where: { status: 'SUCCEEDED' },
          select: { id: true, amount: true, provider: true, paidAt: true }
        }
      },
      orderBy: filters.sortBy === 'priority' 
        ? [{ priorityScore: 'desc' }, { createdAt: 'desc' }]
        : { createdAt: 'desc' }
    });
  }

  async getOrder(param1: string, param2?: string) {
    const { customerBalanceService } = await import('../finance/CustomerBalanceService');
    let order: any = null;
    let businessId = param1;
    let orderId = param2;

    if (param2) {
      order = await prisma.order.findFirst({
        where: { id: param2, businessId: param1 },
        include: {
          customer: true,
          vendor: true,
          enquiry: true,
          assignee: true,
          invoices: {
            include: { payments: true }
          },
          Payment: true,
          statusHistory: {
            include: { changedBy: true },
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!order) {
        order = await prisma.order.findFirst({
          where: { id: param1, businessId: param2 },
          include: {
            customer: true,
            vendor: true,
            enquiry: true,
            assignee: true,
            invoices: {
              include: { payments: true }
            },
            Payment: true,
            statusHistory: {
              include: { changedBy: true },
              orderBy: { createdAt: 'desc' }
            }
          }
        });
        if (order) {
          businessId = param2;
          orderId = param1;
        }
      }
    } else {
      order = await prisma.order.findUnique({
        where: { id: param1 },
        include: {
          customer: true,
          vendor: true,
          enquiry: true,
          assignee: true,
          invoices: {
            include: { payments: true }
          },
          Payment: true,
          statusHistory: {
            include: { changedBy: true },
            orderBy: { createdAt: 'desc' }
          }
        }
      });
      if (order) {
        businessId = order.businessId;
        orderId = order.id;
      }
    }

    if (!order) {
      return null;
    }

    // Attach real-time customer financial exposure
    let financialSummary: any = null;
    try {
      financialSummary = await customerBalanceService.getCustomerFinancialSummary(businessId, order.customerId, order.id);
    } catch (e) {
      // fallback
    }

    return {
      ...order,
      financialSummary
    };
  }

  async updateOrderStatus(businessId: string, orderId: string, newStatus: string, userId: string, reason?: string) {
    const updatedOrder = await LifecycleStateMachine.transitionOrder(
      businessId,
      orderId,
      newStatus as OrderState,
      userId,
      reason
    );

    // Operational Sync for the status update
    operationalSyncPoller.enqueue(businessId, 'ORDER', updatedOrder.id, 'STATUS_UPDATE').catch(console.error);

    return updatedOrder;
  }

  async approveOrder(businessId: string, orderId: string, userId: string, comment?: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId, businessId } });
    if (!order) throw new Error('Order not found');
    if (order.status !== 'PENDING_OWNER_CONFIRMATION') {
      throw new Error(`Order cannot be approved from status ${order.status}. Only PENDING_OWNER_CONFIRMATION orders can be approved.`);
    }

    const updatedOrder = await LifecycleStateMachine.transitionOrder(
      businessId,
      orderId,
      'CONFIRMED',
      userId,
      comment || 'Owner approved order',
      { requiresOwnerApproval: true, ownerApproved: true }
    );

    EventBus.publish(businessId, 'ORDER_CONFIRMED', {
      orderId: updatedOrder.id,
      orderNumber: updatedOrder.orderNumber,
      customerId: updatedOrder.customerId,
      businessId
    });

    operationalSyncPoller.enqueue(businessId, 'ORDER', updatedOrder.id, 'STATUS_UPDATE').catch(console.error);

    return updatedOrder;
  }

  async rejectOrder(businessId: string, orderId: string, userId: string, reason?: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId, businessId } });
    if (!order) throw new Error('Order not found');
    if (order.status !== 'PENDING_OWNER_CONFIRMATION') {
      throw new Error(`Order cannot be rejected from status ${order.status}. Only PENDING_OWNER_CONFIRMATION orders can be rejected.`);
    }

    const updatedOrder = await LifecycleStateMachine.transitionOrder(
      businessId,
      orderId,
      'REJECTED',
      userId,
      reason || 'Owner rejected order'
    );

    EventBus.publish(businessId, 'ORDER_REJECTED', {
      orderId: updatedOrder.id,
      orderNumber: updatedOrder.orderNumber,
      customerId: updatedOrder.customerId,
      reason: reason || 'Owner rejected order'
    });

    operationalSyncPoller.enqueue(businessId, 'ORDER', updatedOrder.id, 'STATUS_UPDATE').catch(console.error);

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
