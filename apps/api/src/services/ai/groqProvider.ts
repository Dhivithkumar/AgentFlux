import { Groq } from 'groq-sdk';
import { AIConfiguration } from '../../config/ai';
import { AIProvider, GenerateStructuredRequest, GenerateTextRequest, GenerateTextResponse, EmbeddingRequest, AIHealthStatus } from './interfaces';

export class GroqProvider implements AIProvider {
  private groq: Groq;

  constructor() {
    const apiKey = AIConfiguration.groq.apiKey;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set');
    }
    this.groq = new Groq({ apiKey });
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
    const completion = await this.groq.chat.completions.create({
      messages: [{ role: 'user', content: request.prompt }],
      model: AIConfiguration.groq.fallbackModel,
    });
    return { text: completion.choices[0]?.message?.content || '' };
  }

  async generateStructured<T>(request: GenerateStructuredRequest): Promise<T> {
    const systemPrompt = `You are a helpful assistant. Output ONLY valid JSON matching this schema:\n${JSON.stringify(request.schema, null, 2)}`;
    
    const completion = await this.groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.prompt }
      ],
      model: AIConfiguration.groq.fallbackModel,
      response_format: { type: 'json_object' }
    });
    
    const text = completion.choices[0]?.message?.content || '{}';
    return JSON.parse(text) as T;
  }

  async embed(request: EmbeddingRequest): Promise<number[]> {
    throw new Error('Groq does not natively support embeddings in this configuration.');
  }

  async healthCheck(): Promise<AIHealthStatus> {
    try {
      // Groq does not have a /ping, we just do a cheap completion
      await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: 'ping' }],
        model: AIConfiguration.groq.fallbackModel,
        max_tokens: 1
      });
      return { provider: 'GROQ', model: AIConfiguration.groq.fallbackModel, status: 'AVAILABLE' };
    } catch (e: any) {
      return { provider: 'GROQ', model: AIConfiguration.groq.fallbackModel, status: 'UNAVAILABLE', error: e.message };
    }
  }
}
