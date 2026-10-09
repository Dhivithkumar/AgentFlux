import { GoogleGenerativeAI, Schema } from '@google/generative-ai';
import { AIConfiguration } from '../../config/ai';
import { AIProvider, GenerateStructuredRequest, GenerateTextRequest, GenerateTextResponse, EmbeddingRequest, AIHealthStatus } from './interfaces';

export class GeminiProvider implements AIProvider {
  private genAI: GoogleGenerativeAI;

  constructor() {
    const apiKey = AIConfiguration.gemini.apiKey;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
    const model = this.genAI.getGenerativeModel({ model: AIConfiguration.gemini.generationModel });
    const result = await model.generateContent(request.prompt);
    return { text: result.response.text() };
  }

  async generateStructured<T>(request: GenerateStructuredRequest): Promise<T> {
    const model = this.genAI.getGenerativeModel({
      model: AIConfiguration.gemini.generationModel,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: this.convertToGeminiSchema(request.schema)
      }
    });

    const result = await model.generateContent(request.prompt);
    const text = result.response.text();
    return JSON.parse(text) as T;
  }

  async embed(request: EmbeddingRequest): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({ model: AIConfiguration.gemini.embeddingModel });
    const result = await model.embedContent({
      content: { role: 'user', parts: [{ text: request.text }] },
      outputDimensionality: AIConfiguration.gemini.embeddingDimensions
    } as any);
    return result.embedding.values;
  }

  async healthCheck(): Promise<AIHealthStatus> {
    try {
      const model = this.genAI.getGenerativeModel({ model: AIConfiguration.gemini.generationModel });
      await model.generateContent("ping");
      return { provider: 'GEMINI', model: AIConfiguration.gemini.generationModel, status: 'AVAILABLE' };
    } catch (e: any) {
      return { provider: 'GEMINI', model: AIConfiguration.gemini.generationModel, status: 'UNAVAILABLE', error: e.message };
    }
  }

  async generateResponse(request: import('./interfaces').GenerateResponseRequest): Promise<import('./interfaces').GenerateResponseResult> {
    const start = Date.now();
    
    const geminiTools = request.tools && request.tools.length > 0 ? [{
      functionDeclarations: request.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'OBJECT',
          properties: t.inputSchema?.properties || {},
          required: t.inputSchema?.required || []
        }
      }))
    }] : undefined;

    const modelName = request.config?.model || AIConfiguration.gemini.generationModel;
    const model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: request.systemInstructions,
      tools: geminiTools as any,
    });

    const formattedHistory = request.history.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: Array.isArray(m.parts) ? m.parts : [{ text: m.content || '' }]
    }));

    try {
      const lastMessage = formattedHistory.pop();
      const chat = model.startChat({
        history: formattedHistory,
      });

      const result = await chat.sendMessage(lastMessage?.parts || [{ text: '' }]);
      const response = result.response;
      
      const functionCalls = response.functionCalls();
      const text = response.text();

      const structuredContent: import('./interfaces').StructuredContent = {
        text: text,
      };

      if (functionCalls && functionCalls.length > 0) {
        structuredContent.toolCalls = functionCalls.map(fc => ({
          id: Math.random().toString(36).substring(7),
          name: fc.name,
          arguments: fc.args
        }));
      }

      const usage = {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0
      };

      return {
        content: structuredContent,
        usage,
        latency: Date.now() - start
      };
    } catch (error) {
      console.error('Gemini Provider Error (generateResponse):', error);
      throw error;
    }
  }

  private convertToGeminiSchema(jsonSchema: any): Schema {
    const parseType = (type: string) => {
      switch (type?.toLowerCase()) {
        case 'string': return 'STRING';
        case 'number': return 'NUMBER';
        case 'integer': return 'INTEGER';
        case 'boolean': return 'BOOLEAN';
        case 'array': return 'ARRAY';
        case 'object': return 'OBJECT';
        default: return 'STRING';
      }
    };

    const convert = (schema: any): any => {
      const result: any = { type: parseType(schema.type || 'string') };
      if (schema.description) result.description = schema.description;
      
      if (schema.type === 'object' && schema.properties) {
        result.properties = {};
        for (const key in schema.properties) {
          result.properties[key] = convert(schema.properties[key]);
        }
        if (schema.required) result.required = schema.required;
      }
      
      if (schema.type === 'array' && schema.items) {
        result.items = convert(schema.items);
      }
      return result;
    };

    return convert(jsonSchema);
  }
}
