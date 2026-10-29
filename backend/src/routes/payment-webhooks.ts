import { Router } from 'express';
import { paymentService } from '../services/payment/PaymentService';
import crypto from 'crypto'; // For real webhook signature validation

const router = Router();

/**
 * POST /api/webhooks/payments/:provider
 */
router.post('/:provider', async (req, res) => {
  try {
    const provider = req.params.provider;
    
    // In production, validate req.headers['x-razorpay-signature'] etc here.
    // We just pass it to the service for mock Phase 6 handling.
    const eventId = req.headers['x-razorpay-event-id'] as string || `evt_${Date.now()}_${Math.random()}`;

    // Optionally extract businessId if provider can send it via webhook metadata
    const businessId = req.body?.payload?.payment?.entity?.notes?.businessId || undefined;

    await paymentService.processWebhook(provider, eventId, req.body, businessId);
    
    // Always return 200 to acknowledge receipt and avoid provider retries
    res.status(200).json({ status: 'ok' });
  } catch (error: any) {
    console.error(`Webhook error for ${req.params.provider}:`, error);
    // If it's a real failure, maybe return 500 depending on provider logic
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export { router as paymentWebhooksRouter };
