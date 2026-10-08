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

export default router;
