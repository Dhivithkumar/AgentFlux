import { prisma } from '@agent-flux/database';
import { knowledgeService, SearchParams } from '../knowledge';
import { HybridRetrievalEngine, RetrievalEvidencePackage } from './HybridRetrievalEngine';

export interface ContextBuilderParams {
  businessId: string;
  workflowType: string;
  task: string;
  query?: string;
  customerId?: string;
  entityId?: string;
}

export interface AgentContextPayload {
  business: {
    name: string;
    industry: string;
    currency: string | null;
    timezone: string | null;
    website: string | null;
    contactInfo: any | null;
  };
  workflow: {
    name: string;
    description: string | null;
    config: any;
    category: string | null;
  } | null;
  fields: Array<{
    fieldKey: string;
    label: string;
    type: string;
    required: boolean;
    options: any | null;
  }>;
  knowledge: Array<{
    content: string;
    source: string;
    metadata: any;
    relevance: number;
  }>;
  evidencePackage?: RetrievalEvidencePackage;
  task: string;
}

export class ContextBuilderService {
  async buildAgentContext(params: ContextBuilderParams): Promise<AgentContextPayload> {
    const { businessId, workflowType, task, query } = params;

    // 1. Load Business Profile
    const business = await prisma.business.findUnique({
      where: { id: businessId }
    });
    if (!business) throw new Error('Business not found');

    // 2. Load Workflow Configuration
    const workflow = await prisma.workflow.findFirst({
      where: { businessId, category: workflowType },
      include: { versions: true }
    });

    // 3. Load Dynamic Fields
    const fields = await prisma.workflowFieldDefinition.findMany({
      where: { businessId, workflowType, active: true },
      orderBy: { displayOrder: 'asc' }
    });

    // 4. Determine knowledge search query
    const searchQuery = query || task;

    // 5. Retrieve Authoritative Evidence Package (Deterministic & Hybrid)
    let evidencePackage: RetrievalEvidencePackage | undefined;
    try {
      evidencePackage = await HybridRetrievalEngine.retrieve({ businessId, query: searchQuery, topK: 5 });
    } catch (err: any) {
      console.warn('ContextBuilder: Evidence retrieval warning:', err.message);
    }

    // 6. Retrieve Relevant Knowledge Chunks
    const searchParams: SearchParams = {
      businessId,
      query: searchQuery,
      topK: 5,
      similarityThreshold: 0.40
    };
    
    if (workflow?.config && typeof workflow.config === 'object' && 'knowledgeTypes' in workflow.config) {
       searchParams.knowledgeTypes = (workflow.config as any).knowledgeTypes;
    }

    const knowledgeResults = await knowledgeService.searchKnowledgeBase(searchParams);

    // 7. Build final context object
    return {
      business: {
        name: business.name,
        industry: business.industry,
        currency: business.currency,
        timezone: business.timezone,
        website: business.website,
        contactInfo: business.contactInfo
      },
      workflow: workflow ? {
        name: workflow.name,
        description: workflow.description,
        config: workflow.config,
        category: workflow.category
      } : null,
      fields: fields.map(f => ({
        fieldKey: f.fieldKey,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options
      })),
      knowledge: knowledgeResults.map(r => ({
        content: r.content,
        source: r.filename,
        metadata: { page: r.page, section: r.section, ...r.metadata },
        relevance: r.score
      })),
      evidencePackage,
      task
    };
  }
}

export const contextBuilder = new ContextBuilderService();

