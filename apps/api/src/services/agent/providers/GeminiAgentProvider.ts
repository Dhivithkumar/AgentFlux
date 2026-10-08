import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, AIProviderConfig, StructuredContent } from './AIProvider';

export class GeminiAgentProvider implements AIProvider {
  name = 'gemini';

  async generateResponse(
    systemInstructions: string,
    history: any[],
    tools: any[],
    config: AIProviderConfig
  ): Promise<{ content: StructuredContent; usage: any; latency: number }> {
    const start = Date.now();
    const genAI = new GoogleGenerativeAI(config.apiKey || process.env.GEMINI_API_KEY || '');
    
    // Map abstract tools to Gemini format
    const geminiTools = tools.length > 0 ? [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'OBJECT',
          properties: t.inputSchema?.properties || {},
          required: t.inputSchema?.required || []
        }
      }))
    }] : undefined;

    const { AIConfiguration } = require('../../../config/ai');
    const modelName = config.model || AIConfiguration.gemini.generationModel;
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemInstructions,
      tools: geminiTools as any,
    });

    const formattedHistory = history.map(m => ({
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

      const structuredContent: StructuredContent = {
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
      console.error('Gemini Provider Error:', error);
      throw error;
    }
  }
}
