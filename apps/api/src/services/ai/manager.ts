import { AIConfiguration } from '../../config/ai';
import { AIProvider, GenerateStructuredRequest, GenerateTextRequest, GenerateTextResponse, EmbeddingRequest, AIHealthStatus } from './interfaces';
import { GeminiProvider } from './geminiProvider';
import { GroqProvider } from './groqProvider';

export class AIProviderManager {
  private primary: AIProvider;
  private fallback?: AIProvider;

  constructor() {
    this.primary = new GeminiProvider();
    if (AIConfiguration.groq.enabled) {
      this.fallback = new GroqProvider();
    }
  }

  private isRetryableError(error: any): boolean {
    const errorMsg = error.message?.toLowerCase() || '';
    
    // Non-retryable
    if (errorMsg.includes('400') || 
        errorMsg.includes('401') || 
        errorMsg.includes('403') || 
        errorMsg.includes('404') ||
        errorMsg.includes('invalid api key') ||
        errorMsg.includes('invalid model') ||
        errorMsg.includes('model_decommissioned') ||
        errorMsg.includes('invalid request')) {
      return false;
    }

    // Retryable
    if (errorMsg.includes('429') || 
        errorMsg.includes('500') || 
        errorMsg.includes('502') || 
        errorMsg.includes('503') || 
        errorMsg.includes('504') || 
        errorMsg.includes('timeout') ||
        errorMsg.includes('fetch failed')) {
      return true;
    }

    return false; // Default to no retry for unknown errors
  }

  private async executeWithRetryAndFallback<T>(
    operation: string,
    executeFn: (provider: AIProvider) => Promise<T>,
    fallbackAllowed: boolean = true
  ): Promise<T> {
    let attempts = 0;
    const maxRetries = AIConfiguration.gemini.maxRetries;
    const primaryModel = AIConfiguration.gemini.generationModel;

    while (attempts < maxRetries) {
      const startTime = Date.now();
      try {
        attempts++;
        const result = await executeFn(this.primary);
        
        console.log(`AI Telemetry | provider=GEMINI | model=${primaryModel} | operation=${operation} | status=SUCCESS | latency=${Date.now() - startTime}ms | retryCount=${attempts - 1} | fallbackUsed=false`);
        return result;
        
      } catch (e: any) {
        const errorMsg = e.message || 'Unknown error';
        const isRetryable = this.isRetryableError(e);
        
        if (isRetryable && attempts < maxRetries) {
          // Exponential backoff with jitter
          const baseDelay = attempts === 1 ? 500 : attempts === 2 ? 1000 : 2000;
          const jitter = Math.floor(Math.random() * 200);
          const delay = baseDelay + jitter;
          
          console.warn(`Gemini API retryable error (${errorMsg}), retrying in ${delay}ms (attempt ${attempts + 1})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.log(`AI Telemetry | provider=GEMINI | model=${primaryModel} | operation=${operation} | status=FAILED | errorCode=${isRetryable ? 'RETRY_EXHAUSTED' : 'NON_RETRYABLE_ERROR'} | latency=${Date.now() - startTime}ms | message=${errorMsg}`);
        
        if (fallbackAllowed && this.fallback) {
          console.warn('Gemini generation failed permanently or non-retryable. Falling back to Groq API...');
          const fallbackStartTime = Date.now();
          const fallbackModel = AIConfiguration.groq.fallbackModel;
          
          try {
            const fallbackResult = await executeFn(this.fallback);
            console.log(`AI Telemetry | provider=GROQ | model=${fallbackModel} | operation=${operation} | status=SUCCESS | latency=${Date.now() - fallbackStartTime}ms | fallbackUsed=true`);
            return fallbackResult;
          } catch (fallbackError: any) {
            console.log(`AI Telemetry | provider=GROQ | model=${fallbackModel} | operation=${operation} | status=FAILED | message=${fallbackError.message}`);
            throw new Error(`AI Generation failed (Gemini + Groq fallback failed): ${fallbackError.message}`);
          }
        }
        
        throw new Error(`AI Generation failed with Gemini (No fallback configured or allowed): ${errorMsg}`);
      }
    }
    
    throw new Error('Unreachable code reached in AIProviderManager');
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
    return this.executeWithRetryAndFallback('generateText', provider => provider.generateText(request));
  }

  async generateStructured<T>(request: GenerateStructuredRequest): Promise<T> {
    if (process.env.NODE_ENV !== 'production' && (process.env.NODE_ENV === 'test' || process.env.MOCK_AI === 'true')) {
      console.warn("Using mock AI generation for test/development");
      return {
        summary: "Mock AI summary",
        confidence: "HIGH",
        nextAction: "MOCK_ACTION",
        fields: { product: "mock table", quantity: 6, pickup: "Tiruppur", destination: "Chennai" }
      } as any;
    }
    return this.executeWithRetryAndFallback('generateStructured', provider => provider.generateStructured<T>(request));
  }

  async embed(request: EmbeddingRequest): Promise<number[]> {
    // Embeddings don't fallback to Groq since Groq doesn't support them easily here
    return this.executeWithRetryAndFallback('embed', provider => provider.embed(request), false);
  }

  async healthCheck(): Promise<any> {
    const primaryHealth = await this.primary.healthCheck();
    const result: any = { primary: primaryHealth };
    
    if (this.fallback) {
      result.fallback = await this.fallback.healthCheck();
    }
    
    return result;
  }
}
