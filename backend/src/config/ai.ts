export const AIConfiguration = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    generationModel: process.env.GEMINI_MODEL || 'gemini-3.7-flash',
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    embeddingDimensions: parseInt(process.env.GEMINI_EMBEDDING_DIMENSIONS || '3072', 10),
    timeout: 30000,
    maxRetries: 3,
    temperature: 0.2
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    fallbackModel: process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-120b',
    enabled: !!process.env.GROQ_API_KEY
  }
};

export function validateAIConfiguration() {
  const missing = [];
  if (!AIConfiguration.gemini.apiKey) missing.push('GEMINI_API_KEY');
  if (!AIConfiguration.gemini.generationModel) missing.push('GEMINI_MODEL');
  if (!AIConfiguration.gemini.embeddingModel) missing.push('GEMINI_EMBEDDING_MODEL');
  if (!AIConfiguration.groq.apiKey) missing.push('GROQ_API_KEY');

  if (missing.length > 0) {
    throw new Error(`Missing required AI configuration environment variables: ${missing.join(', ')}`);
  }

  // Prevent obsolete defaults
  const obsoleteModels = ['gemini-pro'];
  if (obsoleteModels.includes(AIConfiguration.gemini.generationModel)) {
    throw new Error(`Configured Gemini model is obsolete or unavailable. Set GEMINI_MODEL to a currently supported model. Found: ${AIConfiguration.gemini.generationModel}`);
  }
  
  const obsoleteEmbeddingModels = ['gemini-embedding-2', 'text-embedding-004'];
  if (obsoleteEmbeddingModels.includes(AIConfiguration.gemini.embeddingModel)) {
    console.warn(`Warning: Configured Gemini embedding model ${AIConfiguration.gemini.embeddingModel} might be obsolete.`);
  }

  console.log(`AI Provider Configuration\nGemini generation model: ${AIConfiguration.gemini.generationModel}\nGroq fallback: ${AIConfiguration.groq.enabled ? 'configured' : 'not configured'}`);
}
