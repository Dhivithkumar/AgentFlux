import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { orderService } from '../services/order/OrderService';
import { prisma } from '@agent-flux/database';

const router = Router({ mergeParams: true });

// Ensure all routes require authentication and business membership
router.use(authenticate);
router.use(requireBusinessMembership);

router.get('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const orders = await orderService.getOrders(businessId, req.query);
    res.json(orders);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.user?.id;
    
    // Support idempotencyKey via header or body
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
    const payload = {
      ...req.body,
      idempotencyKey
    };

    const order = await orderService.createManualOrder(businessId, payload, userId);
    res.status(201).json(order);
  } catch (error: any) {
    console.error('Order creation error:', error);
    res.status(400).json({ error: error.message || 'Failed to create order' });
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const order = await orderService.getOrder(businessId, id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

router.patch('/:id', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const userId = (req as any).user.id;
    
    const order = await orderService.updateOrder(businessId, id, req.body, userId);
    res.json(order);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch('/:id/customer', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { billingAddress, phone } = req.body;
    
    // Find order to get customerId
    const { orderService } = require('../services/order/OrderService');
    const order = await orderService.getOrder(businessId, id);
    if (!order || !order.customerId) {
      return res.status(404).json({ error: 'Order or Customer not found' });
    }

    const { prisma } = require('@agent-flux/database');
    const customer = await prisma.customer.findUnique({ where: { id: order.customerId } });
    const customData = customer.customData || {};
    
    if (billingAddress) customData.billingAddress = billingAddress;
    
    const updatedCustomer = await prisma.customer.update({
      where: { id: order.customerId },
      data: { 
        phone: phone || customer.phone,
        customData 
      }
    });

    res.json({ success: true, customer: updatedCustomer });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});
router.post('/:id/approve', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { comment } = req.body;
    const userId = (req as any).user.id;
    const order = await orderService.approveOrder(businessId, id, userId, comment);
    res.json(order);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/reject', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user.id;
    const order = await orderService.rejectOrder(businessId, id, userId, reason);
    res.json(order);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/status', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { status, reason } = req.body;
    const userId = (req as any).user.id;
    
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const order = await orderService.updateOrderStatus(businessId, id, status, userId, reason);
    res.json(order);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/generate-invoice', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { invoiceService } = require('../services/invoice/InvoiceService');
    
    // Generate Invoice (PDF generation included)
    const invoiceId = await invoiceService.generateInvoice(businessId, id);
    
    // Attempt auto-emailing customer if Gmail is connected
    let emailed = false;
    let emailMessage = '';
    try {
      await invoiceService.sendInvoice(businessId, invoiceId);
      emailed = true;
    } catch (sendErr: any) {
      console.warn('[GenerateInvoice] Auto-emailing customer skipped or not connected:', sendErr.message);
      emailMessage = sendErr.message?.includes('Gmail integration not connected')
        ? 'Connect Gmail in Integrations to email invoices directly to customers.'
        : sendErr.message;
    }
    
    res.json({
      success: true,
      invoiceId,
      emailed,
      message: emailed 
        ? 'Invoice generated and emailed to customer!' 
        : `Invoice generated successfully! ${emailMessage}`
    });
  } catch (error: any) {
    console.error('[Invoice Generation Error]:', error);
    res.status(500).json({ error: error?.message || error?.toString() || 'Unknown error' });
  }
});

router.get('/:id/invoice-pdf', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { invoiceService } = require('../services/invoice/InvoiceService');
    const { documentGenerationService } = require('../services/documents/DocumentGenerationService');
    const path = require('path');
    const fs = require('fs');

    const order = await orderService.getOrder(businessId, id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    let invoice = order.invoices?.[0];
    if (!invoice) {
      const invoiceId = await invoiceService.generateInvoice(businessId, id);
      invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    }

    if (!invoice) return res.status(404).json({ error: 'Invoice could not be located' });

    let doc = invoice.generatedDocumentId ? await prisma.knowledgeDocument.findUnique({ where: { id: invoice.generatedDocumentId } }) : null;
    let pdfPath = doc?.storagePath;

    if (!pdfPath || !fs.existsSync(pdfPath)) {
      console.log(`[InvoicePDF] Generating/regenerating PDF for invoice ${invoice.id}...`);
      await documentGenerationService.generateDocument(businessId, 'INVOICE', invoice.id);
      invoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
      doc = invoice?.generatedDocumentId ? await prisma.knowledgeDocument.findUnique({ where: { id: invoice.generatedDocumentId } }) : null;
      pdfPath = doc?.storagePath;
    }

    if (!pdfPath || !fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'Invoice PDF file not found' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice?.invoiceNumber || 'Invoice'}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (error: any) {
    console.error('Invoice PDF error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/priority/recalculate', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { orderPriorityService } = require('../services/order/OrderPriorityService');
    const result = await orderPriorityService.updateOrderPriority(businessId, id);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/:id/financial-summary', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { customerBalanceService } = require('../services/finance/CustomerBalanceService');
    const order = await orderService.getOrder(businessId, id);
    const summary = await customerBalanceService.getCustomerFinancialSummary(businessId, order.customerId, id);
    res.json(summary);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
