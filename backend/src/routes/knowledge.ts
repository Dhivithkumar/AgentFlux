
import { Router } from 'express';
import { prisma } from '@agent-flux/database';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import multer from 'multer';
import crypto from 'crypto';
import { storageService } from '../services/storage';
import { knowledgeQueue } from '../services/queue/knowledgeQueue';
import { knowledgeService } from '../services/knowledge';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();
router.use(authenticate);
router.use(requireBusinessMembership);

// Multer memory storage (we'll save it to disk ourselves or Supabase)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// GET /api/knowledge-bases
router.get('/', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const kbs = await prisma.knowledgeBase.findMany({
    where: { businessId },
    include: {
      _count: {
        select: { documents: true }
      }
    }
  });
  res.json(kbs);
}));

// POST /api/knowledge-bases
router.post('/', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const { name, description } = req.body;
  const kb = await prisma.knowledgeBase.create({
    data: {
      name,
      description,
      businessId
    }
  });
  res.json(kb);
}));

// GET /api/knowledge-bases/:id
router.get('/:id', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.id, businessId }
  });
  if (!kb) return res.status(404).json({ error: 'Not found' });
  res.json(kb);
}));

// GET /api/knowledge-bases/:id/documents
router.get('/:id/documents', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const docs = await prisma.knowledgeDocument.findMany({
    where: { knowledgeBaseId: req.params.id, businessId },
    orderBy: { createdAt: 'desc' }
  });
  res.json(docs);
}));

// POST /api/knowledge-bases/:id/documents (Upload)
router.post('/:id/documents', upload.single('file'), asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const knowledgeBaseId = req.params.id;
  
  // Verify ownership
  const kb = await prisma.knowledgeBase.findFirst({ where: { id: knowledgeBaseId, businessId } });
  if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
  
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  
  const ext = file.originalname.split('.').pop() || 'bin';
  const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  
  // Check duplicate
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { knowledgeBaseId, businessId, contentHash }
  });
  if (existing) {
    return res.status(409).json({ error: 'Document with identical content already exists', document: existing });
  }

  // Create record
  const knowledgeType = req.body.knowledgeType || 'OTHER';
  const doc = await prisma.knowledgeDocument.create({
    data: {
      knowledgeBaseId,
      businessId,
      uploadedBy: req.user.userId,
      filename: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storagePath: '',
      status: 'UPLOADED',
      knowledgeType
    }
  });

  // Store file
  const storagePath = await storageService.storeDocument(businessId, knowledgeBaseId, doc.id, file.buffer, ext);
  
  await prisma.knowledgeDocument.update({
    where: { id: doc.id },
    data: { storagePath }
  });

  // Queue processing
  await knowledgeQueue.add('process-document', { documentId: doc.id, action: 'process' });

  res.json(doc);
}));

// POST /api/knowledge/documents/:docId/reprocess
router.post('/documents/:docId/reprocess', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const docId = req.params.docId;
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id: docId, businessId } });
  if (!doc) return res.status(404).json({ error: 'Not found' });

  await knowledgeQueue.add('process-document', { documentId: doc.id, action: 'reprocess' });
  res.json({ success: true, status: 'QUEUED' });
}));

// DELETE /api/knowledge/documents/:docId
router.delete('/documents/:docId', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const docId = req.params.docId;
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id: docId, businessId } });
  if (!doc) return res.status(404).json({ error: 'Not found' });

  // Delete from storage
  if (doc.storagePath) {
    await storageService.deleteDocument(doc.storagePath);
  }
  
  // Delete from DB (cascade drops chunks)
  await prisma.knowledgeDocument.delete({ where: { id: docId } });
  
  res.json({ success: true });
}));

// POST /api/knowledge-bases/:id/search (Debug UI)
router.post('/:id/search', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const knowledgeBaseId = req.params.id;
  const { query, topK = 5, similarityThreshold = 0.5 } = req.body;

  try {
    const results = await knowledgeService.searchKnowledgeBase({
      businessId,
      knowledgeBaseId,
      query,
      topK,
      similarityThreshold
    });
    res.json(results);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}));

// POST /api/knowledge-bases/:id/debug-retrieval (Diagnostics endpoint)
router.post('/:id/debug-retrieval', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  try {
    const debug = await knowledgeService.debugRetrieval({ businessId, query });
    res.json(debug);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}));

// POST /api/knowledge/debug-retrieval
router.post('/debug-retrieval', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  try {
    const debug = await knowledgeService.debugRetrieval({ businessId, query });
    res.json(debug);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}));


// POST /api/knowledge/context
router.post('/context', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const { workflowType, task, query, customerId, entityId } = req.body;

  if (!workflowType || !task) {
    return res.status(400).json({ error: 'workflowType and task are required' });
  }

  const { contextBuilder } = require('../services/knowledge/ContextBuilder');
  try {
    const context = await contextBuilder.buildAgentContext({
      businessId,
      workflowType,
      task,
      query,
      customerId,
      entityId
    });
    res.json(context);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}));

// --- KNOWLEDGE SOURCES ---

// GET /api/knowledge-bases/:id/sources
router.get('/:id/sources', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const sources = await prisma.knowledgeSource.findMany({
    where: { knowledgeBaseId: req.params.id, businessId },
    orderBy: { createdAt: 'desc' }
  });
  res.json(sources);
}));

// POST /api/knowledge-bases/:id/sources
router.post('/:id/sources', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const knowledgeBaseId = req.params.id;
  const { type, name, connectorId, configuration } = req.body;
  
  const kb = await prisma.knowledgeBase.findFirst({ where: { id: knowledgeBaseId, businessId } });
  if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
  
  const source = await prisma.knowledgeSource.create({
    data: {
      businessId,
      knowledgeBaseId,
      type,
      name,
      connectorId,
      configuration
    }
  });
  
  // Optionally auto-sync immediately
  const { syncKnowledgeSource } = require('../services/knowledge/sourceSync');
  syncKnowledgeSource(source.id).catch(console.error);

  res.json(source);
}));

// POST /api/knowledge/sources/:sourceId/sync
router.post('/sources/:sourceId/sync', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const sourceId = req.params.sourceId;
  
  const source = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, businessId } });
  if (!source) return res.status(404).json({ error: 'Source not found' });
  
  const { syncKnowledgeSource } = require('../services/knowledge/sourceSync');
  syncKnowledgeSource(source.id).catch(console.error);
  
  res.json({ success: true, status: 'SYNCING' });
}));

// DELETE /api/knowledge/sources/:sourceId
router.delete('/sources/:sourceId', asyncHandler(async (req: any, res: any) => {
  const businessId = (req as any).businessId;
  const sourceId = req.params.sourceId;
  
  const source = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, businessId } });
  if (!source) return res.status(404).json({ error: 'Source not found' });
  
  const docs = await prisma.knowledgeDocument.findMany({ where: { sourceId } });
  for (const doc of docs) {
    if (doc.storagePath) {
      await storageService.deleteDocument(doc.storagePath);
    }
  }
  await prisma.knowledgeDocument.deleteMany({ where: { sourceId } });
  
  await prisma.knowledgeSource.delete({ where: { id: sourceId } });
  
  res.json({ success: true });
}));

export default router;
