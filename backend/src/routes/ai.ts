import { Router } from 'express';
import { aiManager } from '../services/ai';
import { AIConfiguration } from '../config/ai';

const router = Router();

router.get('/health', async (req, res) => {
  try {
    const health = await aiManager.healthCheck();
    res.json({
      ...health,
      embedding: {
        configured: !!AIConfiguration.gemini.apiKey,
        model: AIConfiguration.gemini.embeddingModel
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'AI Health Check Failed', message: error.message });
  }
});

export default router;
