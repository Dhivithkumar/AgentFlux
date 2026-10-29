import { aiManager } from './index';

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  async generateEmbedding(text: string): Promise<number[]> {
    return aiManager.embed({ text });
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // For now we do concurrent individual requests since AIProviderManager abstracts the raw batch API.
    // In production we would extend AIProviderManager to support batch logic if needed.
    const promises = texts.map(text => aiManager.embed({ text }));
    return Promise.all(promises);
  }
}

export const embeddingProvider = new GeminiEmbeddingProvider();
