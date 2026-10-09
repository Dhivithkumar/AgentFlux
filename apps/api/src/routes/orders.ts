import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { orderService } from '../services/order/OrderService';

const router = Router({ mergeParams: true });

// Ensure all routes require authentication and business membership
router.use(authenticate);
router.use(requireBusinessMembership);

router.get('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const { status, customerId, assignedTo } = req.query;
    
    const orders = await orderService.getOrders(businessId, { status, customerId, assignedTo });
    res.json(orders);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req: any, res) => {
  try {
    // Creating directly without enquiry conversion is possible but we mainly rely on convert.
    // Assuming generic creation is handled via Enquiry -> Order.
    res.status(501).json({ error: 'Direct order creation not implemented. Use /api/businesses/:businessId/enquiries/:enquiryId/convert-to-order' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const order = await orderService.getOrder(businessId, id);
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
    
    // Send Invoice to customer automatically
    await invoiceService.sendInvoice(businessId, invoiceId);
    
    res.json({ success: true, invoiceId });
  } catch (error: any) {
    console.error('[Invoice Generation Error]:', error);
    res.status(500).json({ error: error?.message || error?.toString() || 'Unknown error' });
  }
});

export default router;
