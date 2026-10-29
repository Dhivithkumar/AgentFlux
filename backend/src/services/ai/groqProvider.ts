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

  async generateResponse(request: import('./interfaces').GenerateResponseRequest): Promise<import('./interfaces').GenerateResponseResult> {
    const start = Date.now();
    
    let groqTools = undefined;
    if (request.tools && request.tools.length > 0) {
      groqTools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: t.inputSchema?.properties || {},
            required: t.inputSchema?.required || []
          }
        }
      }));
    }

    const messages: any[] = [];
    if (request.systemInstructions) {
      messages.push({ role: 'system', content: request.systemInstructions });
    }

    const formattedHistory = request.history.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content || (Array.isArray(m.parts) ? m.parts[0]?.text : '')
    }));
    messages.push(...formattedHistory);

    try {
      const completion = await this.groq.chat.completions.create({
        messages: messages,
        model: request.config?.model || AIConfiguration.groq.fallbackModel,
        tools: groqTools as any,
        tool_choice: groqTools ? 'auto' : 'none'
      });

      const responseMessage = completion.choices[0]?.message;
      
      const structuredContent: import('./interfaces').StructuredContent = {
        text: responseMessage?.content || undefined,
      };

      if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
        structuredContent.toolCalls = responseMessage.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}')
        }));
      }

      const usage = {
        inputTokens: completion.usage?.prompt_tokens || 0,
        outputTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0
      };

      return {
        content: structuredContent,
        usage,
        latency: Date.now() - start
      };
    } catch (error) {
      console.error('Groq Provider Error (generateResponse):', error);
      throw error;
    }
  }
}
