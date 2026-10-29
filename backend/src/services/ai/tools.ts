import { knowledgeService } from '../knowledge';

/**
 * Definition of the search_knowledge tool for AI Agents.
 * This specifies how the agent should structure its request when it wants to query business knowledge.
 */
export const searchKnowledgeToolDef = {
  name: 'search_knowledge',
  description: 'Searches the current business authorized knowledge bases for relevant documents, policies, FAQs, or historical context. Use this whenever you need to look up business rules, standard operating procedures, policies, or product information.',
  parameters: {
    type: 'OBJECT',
    properties: {
      knowledgeBaseId: {
        type: 'STRING',
        description: 'Optional. The specific knowledge base ID to search within. If omitted, searches all knowledge bases for the business.'
      },
      query: {
        type: 'STRING',
        description: 'The natural language search query or question.'
      }
    },
    required: ['query']
  }
};

/**
 * Executes the search_knowledge tool securely within the current business context.
 * The AI MUST NOT supply the businessId; the server injects it from the authenticated execution context.
 */
export async function executeSearchKnowledgeTool(businessId: string, args: { knowledgeBaseId?: string; query: string }) {
  if (!businessId) {
    throw new Error('Unauthorized: businessId context is missing for tool execution.');
  }

  try {
    const results = await knowledgeService.searchKnowledgeBase({
      businessId,
      knowledgeBaseId: args.knowledgeBaseId || '',
      query: args.query,
      topK: 5,
      similarityThreshold: 0.65
    });

    if (!results || results.length === 0) {
      return {
        status: 'SUCCESS_NO_RESULTS',
        message: 'No relevant knowledge found.',
        results: []
      };
    }

    // Format the results into a dense context block for the agent
    const context = knowledgeService.buildContext(results);

    return {
      status: 'SUCCESS_WITH_RESULTS',
      context,
      sources: results.map((r: any) => ({ 
        documentId: r.documentId, 
        filename: r.filename, 
        page: r.page, 
        similarity: r.score 
      }))
    };
  } catch (error: any) {
    return {
      status: 'RETRIEVAL_FAILED',
      errorCode: error.code || 'UNKNOWN_ERROR',
      message: error.message
    };
  }
}
