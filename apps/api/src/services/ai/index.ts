export * from './interfaces';
export * from './manager';
export * from './geminiProvider';
export * from './groqProvider';

// Re-export a singleton instance of the manager to replace the old provider usages
import { AIProviderManager } from './manager';
export const aiManager = new AIProviderManager();
