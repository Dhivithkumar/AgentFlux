import { Router } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { invoiceService } from '../services/invoice/InvoiceService';
import { documentGenerationService } from '../services/documents/DocumentGenerationService';
import { prisma } from '@agent-flux/database';

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use(requireBusinessMembership);

router.get('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const invoices = await prisma.invoice.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(invoices);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req: any, res) => {
  try {
    const { businessId } = req.params;
    const data = req.body;
    const invoice = await invoiceService.createInvoice(businessId, data);
    res.status(201).json(invoice);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const invoice = await invoiceService.getInvoice(businessId, id);
    if (!invoice) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(invoice);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/generate', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const generated = await documentGenerationService.generateDocument(businessId, 'INVOICE', id);
    res.json(generated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/status', async (req: any, res) => {
  try {
    const { businessId, id } = req.params;
    const { status } = req.body;
    const invoice = await invoiceService.updateStatus(businessId, id, status);
    res.json(invoice);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
