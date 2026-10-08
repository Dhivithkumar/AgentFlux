export interface AIProviderConfig {
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredContent {
  text?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: any;
  }>;
}

export interface AIProvider {
  name: string;
  generateResponse(
    systemInstructions: string,
    history: any[],
    tools: any[],
    config: AIProviderConfig
  ): Promise<{ content: StructuredContent; usage: any; latency: number }>;
}

export class AIProviderFactory {
  static getProvider(name: string): AIProvider {
    const normalized = name.toLowerCase();
    if (normalized.startsWith('gemini')) {
      const { GeminiAgentProvider } = require('./GeminiAgentProvider');
      return new GeminiAgentProvider();
    }
    
    throw new Error(`Unsupported AI Provider: ${name}`);
  }
}
