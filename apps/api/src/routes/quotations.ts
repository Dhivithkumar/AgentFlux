import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { quotationService } from '../services/quotation/QuotationService';
import { documentGenerationService } from '../services/documents/DocumentGenerationService';
import { invoiceService } from '../services/invoice/InvoiceService';
import { prisma } from '@agent-flux/database';

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use(requireBusinessMembership);

router.get('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const quotations = await prisma.quotation.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(quotations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const data = req.body;
    const quotation = await quotationService.createQuotation(businessId, data);
    res.status(201).json(quotation);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const quotation = await quotationService.getQuotation(businessId, id);
    if (!quotation) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(quotation);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/generate', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const generated = await documentGenerationService.generateDocument(businessId, 'QUOTATION', id);
    res.json(generated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/status', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { status } = req.body;
    const quotation = await quotationService.updateStatus(businessId, id, status, req.user!.id);
    res.json(quotation);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/convert-to-invoice', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const invoice = await invoiceService.convertFromQuotation(businessId, id);
    res.status(201).json(invoice);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
