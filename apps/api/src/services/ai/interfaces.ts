import { AIConfiguration } from '../../config/ai';

export interface GenerateTextRequest {
  prompt: string;
}

export interface GenerateTextResponse {
  text: string;
}

export interface GenerateStructuredRequest {
  prompt: string;
  schema: any;
}

export interface EmbeddingRequest {
  text: string;
}

export interface AIHealthStatus {
  provider: string;
  model: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  error?: string;
}

export interface AIProvider {
  generateText(request: GenerateTextRequest): Promise<GenerateTextResponse>;
  generateStructured<T>(request: GenerateStructuredRequest): Promise<T>;
  embed(request: EmbeddingRequest): Promise<number[]>;
  healthCheck(): Promise<AIHealthStatus>;
}
