import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { paymentService } from '../services/payment/PaymentService';

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use(requireBusinessMembership);

/**
 * POST /api/businesses/:businessId/invoices/:invoiceId/payments
 * Request body: { provider: 'RAZORPAY', amount?: number }
 */
router.post('/invoices/:invoiceId/payments', async (req: any, res) => {
  try {
    const { businessId, invoiceId } = req.params;
    const { provider, amount } = req.body;
    
    if (!provider) return res.status(400).json({ error: 'Provider is required' });

    const result = await paymentService.createPaymentRequest(businessId, invoiceId, provider, amount);
    res.json(result);
  } catch (error: any) {
    console.error('Create payment error:', error);
    res.status(400).json({ error: error.message || 'Failed to create payment' });
  }
});

/**
 * POST /api/businesses/:businessId/payments/:paymentId/confirm
 * Request body: { providerPaymentId: string, signature?: string }
 */
router.post('/payments/:paymentId/confirm', async (req: any, res) => {
  try {
    const { businessId, paymentId } = req.params;
    const { providerPaymentId, signature } = req.body;
    
    if (!providerPaymentId) return res.status(400).json({ error: 'providerPaymentId is required' });

    const payment = await paymentService.confirmPayment(businessId, paymentId, providerPaymentId, signature);
    res.json(payment);
  } catch (error: any) {
    console.error('Confirm payment error:', error);
    res.status(400).json({ error: error.message || 'Failed to confirm payment' });
  }
});

router.post('/payments/:paymentId/refund', async (req: any, res) => {
  try {
    const { businessId, paymentId } = req.params;
    const { amount } = req.body;
    
    if (!amount) return res.status(400).json({ error: 'amount is required' });

    const refund = await paymentService.refundPayment(businessId, paymentId, amount, req.user!.id);
    res.json(refund);
  } catch (error: any) {
    console.error('Refund payment error:', error);
    res.status(400).json({ error: error.message || 'Failed to refund payment' });
  }
});

export { router as paymentsRouter };
