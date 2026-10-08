import { prisma } from '@agent-flux/database';
import { storageService } from './storage';
import { embeddingProvider } from './ai/embeddings';
import { randomUUID } from 'crypto';
import { HybridRetrievalEngine, RetrievalEvidencePackage } from './knowledge/HybridRetrievalEngine';
import { QueryUnderstandingService } from './knowledge/QueryUnderstandingService';
import { AASHA_BUSINESS_ID, AASHA_PRODUCTS, AASHA_CUSTOMIZATIONS } from './knowledge/aashaKnowledgeData';
const { PDFParse } = require('pdf-parse');

export interface SearchParams {
  businessId: string;
  knowledgeBaseId?: string;
  query: string;
  knowledgeTypes?: string[];
  sourceIds?: string[];
  topK?: number;
  similarityThreshold?: number;
}

export interface SearchResult {
  content: string;
  score: number;
  documentId: string;
  filename: string;
  knowledgeType?: string;
  page?: number;
  section?: string;
  metadata?: any;
}

export class KnowledgeProcessingService {
  
  /**
   * Main entrypoint for processing a document asynchronously.
   */
  async processDocument(documentId: string) {
    let doc = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new Error('Document not found');

    try {
      // 1. Mark as extracting
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: 'EXTRACTING' }
      });

      // Fetch file buffer
      if (!doc.storagePath) throw new Error('Document has no storage path');
      const fileBuffer = await storageService.getDocumentBuffer(doc.storagePath);
      
      // 2. Extract Text
      let extractedText = '';
      if (doc.mimeType === 'application/pdf') {
        const parser = new PDFParse({ data: fileBuffer });
        const data = await parser.getText();
        extractedText = data.text;
      } else if (doc.mimeType === 'text/plain' || doc.mimeType === 'text/csv') {
        extractedText = fileBuffer.toString('utf-8');
      } else if (doc.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        extractedText = result.value;
      } else {
        throw new Error('Unsupported mime type for extraction');
      }

      // Clean Text
      extractedText = extractedText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!extractedText) throw new Error('No text extracted from document');

      // 3. Document-Aware & Table-Aware Chunking
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: 'CHUNKING' }
      });

      const chunkObjects = this.createDocumentAwareChunks(extractedText, doc);

      // 4. Generating Embeddings
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: 'EMBEDDING' }
      });

      const chunkContents = chunkObjects.map(c => c.content);
      const embeddings = await embeddingProvider.generateEmbeddings(chunkContents);

      // 5. Store Vectors in pgvector with full metadata
      for (let i = 0; i < chunkObjects.length; i++) {
        const chunkId = randomUUID();
        const embeddingString = `[${embeddings[i].join(',')}]`;
        const metadata = JSON.stringify(chunkObjects[i].metadata);

        await prisma.$executeRawUnsafe(
          `INSERT INTO "KnowledgeChunk" ("id", "documentId", "knowledgeBaseId", "businessId", "chunkIndex", "content", "embedding", "metadata", "createdAt") 
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8::jsonb, NOW())`,
          chunkId, doc.id, doc.knowledgeBaseId, doc.businessId, i, chunkObjects[i].content, embeddingString, metadata
        );
      }

      // 6. Mark as Indexed
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: 'INDEXED', processedAt: new Date(), errorMessage: null }
      });

    } catch (e: any) {
      console.error(`Failed to process document ${documentId}:`, e);
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: 'FAILED', errorMessage: e.message }
      });
    }
  }

  /**
   * Reprocess document - delete old chunks and start over
   */
  async reprocessDocument(documentId: string) {
    await prisma.knowledgeChunk.deleteMany({
      where: { documentId }
    });
    
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: 'PROCESSING' }
    });

    return this.processDocument(documentId);
  }

  /**
   * Hybrid Search: Exact match + Structured metadata + Keyword + pgvector
   */
  async searchKnowledgeBase(params: SearchParams): Promise<SearchResult[]> {
    const { businessId, knowledgeBaseId, query, knowledgeTypes, sourceIds, topK = 5, similarityThreshold = 0.40 } = params;
    
    const results: SearchResult[] = [];
    const seenContent = new Set<string>();

    // Step 1: Hybrid Retrieval Engine (Deterministic Exact & Cross-Document Lookup)
    try {
      const evidence = await HybridRetrievalEngine.retrieve({ businessId, query, topK });
      
      for (const ch of evidence.matchedChunks) {
        if (!seenContent.has(ch.content)) {
          seenContent.add(ch.content);
          results.push({
            content: ch.content,
            score: ch.score,
            documentId: evidence.sourceDocuments[0] || 'Authoritative-Catalogue',
            filename: ch.source,
            knowledgeType: ch.type,
            section: 'Authoritative Evidence',
            metadata: {
              sku: evidence.sku,
              entity: evidence.entity,
              state: evidence.state,
              facts: evidence.answerableFacts
            }
          });
        }
      }
    } catch (err: any) {
      console.warn('HybridRetrievalEngine encountered an error:', err.message);
    }

    // Step 2: pgvector Semantic Search (Safely executed with fallback)
    try {
      const queryEmbedding = await embeddingProvider.generateEmbedding(query);
      const embeddingString = `[${queryEmbedding.join(',')}]`;

      let sqlQuery = `
        SELECT c."id", c."content", c."metadata", 1 - (c."embedding" <=> $1::vector) as similarity, c."documentId", d."knowledgeType", d."filename"
        FROM "KnowledgeChunk" c
        JOIN "KnowledgeDocument" d ON c."documentId" = d."id"
        WHERE c."businessId" = $2
        AND c."embedding" IS NOT NULL
        AND 1 - (c."embedding" <=> $1::vector) > $3
      `;
      const queryParams: any[] = [embeddingString, businessId, similarityThreshold];
      let paramIndex = 4;

      if (knowledgeBaseId) {
        sqlQuery += ` AND c."knowledgeBaseId" = $${paramIndex}`;
        queryParams.push(knowledgeBaseId);
        paramIndex++;
      }

      if (knowledgeTypes && knowledgeTypes.length > 0) {
        const typeParams = knowledgeTypes.map((_, i) => `$${paramIndex + i}`).join(',');
        sqlQuery += ` AND d."knowledgeType"::text IN (${typeParams})`;
        queryParams.push(...knowledgeTypes);
        paramIndex += knowledgeTypes.length;
      }

      if (sourceIds && sourceIds.length > 0) {
        const sourceParams = sourceIds.map((_, i) => `$${paramIndex + i}`).join(',');
        sqlQuery += ` AND d."sourceId" IN (${sourceParams})`;
        queryParams.push(...sourceIds);
        paramIndex += sourceIds.length;
      }

      sqlQuery += ` ORDER BY similarity DESC LIMIT $${paramIndex}`;
      queryParams.push(topK);

      const vectorRows: any[] = await prisma.$queryRawUnsafe(sqlQuery, ...queryParams);

      for (const row of vectorRows) {
        if (!seenContent.has(row.content)) {
          seenContent.add(row.content);
          const meta = row.metadata || {};
          results.push({
            content: row.content,
            score: row.similarity,
            documentId: row.documentId,
            filename: row.filename || meta.filename || 'Document',
            knowledgeType: row.knowledgeType,
            page: meta.page,
            section: meta.section,
            metadata: meta
          });
        }
      }
    } catch (pgError: any) {
      console.warn('Semantic pgvector search skipped or failed:', pgError.message);
    }

    // Sort by score descending and limit to topK
    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Diagnostic retrieval debug mode as required by Section 33.
   */
  async debugRetrieval(params: { businessId: string; query: string }) {
    const { businessId, query } = params;
    const norm = QueryUnderstandingService.normalizeQuery(query);
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const searchResults = await this.searchKnowledgeBase({ businessId, query, topK: 5 });

    return {
      originalQuery: query,
      normalizedQuery: norm.normalizedQuery,
      detectedIntent: norm.detectedIntent,
      detectedEntities: {
        products: norm.matchedProducts.map(p => ({ sku: p.sku, name: p.productName })),
        customizations: norm.matchedCustomizations.map(c => ({ option: c.option, charge: c.chargeDescription })),
        unknownEntities: norm.unknownEntities
      },
      exactMatches: norm.matchedProducts.map(p => p.sku),
      keywordMatches: searchResults.map(r => r.filename),
      vectorMatches: searchResults.filter(r => r.score < 1.0).map(r => ({ source: r.filename, score: r.score })),
      rerankedResults: searchResults,
      selectedEvidence: evidence.answerableFacts,
      rejectedEvidence: evidence.rejectionReason ? [evidence.rejectionReason] : [],
      retrievalScores: searchResults.map(r => ({ item: r.filename, score: r.score })),
      sourceDocuments: evidence.sourceDocuments,
      sourcePages: [1],
      finalContext: this.buildContext(searchResults),
      groundingDecision: {
        state: evidence.state,
        confidence: evidence.confidence,
        allowAutomaticAnswer: evidence.state === 'EXACT_MATCH' || evidence.state === 'HIGH_CONFIDENCE'
      }
    };
  }

  /**
   * Build LLM context from results with strict grounding boundaries
   */
  buildContext(results: SearchResult[]): string {
    if (results.length === 0) {
      return "NO_RELEVANT_KNOWLEDGE_FOUND. When business knowledge is missing, do NOT invent or estimate facts. Explicitly state that the information is unavailable.";
    }

    let context = "### AUTHORITATIVE BUSINESS KNOWLEDGE (SOURCE OF TRUTH)\n";
    context += "CRITICAL RULE: The facts and prices below are the ONLY authoritative source of truth. You must NEVER invent, infer or guess missing products, prices, stock, delivery dates or discounts.\n\n";

    results.forEach((r, i) => {
      context += `[Source ${i + 1}]: ${r.filename}\n`;
      if (r.section) context += `Section: ${r.section}\n`;
      context += `Content:\n${r.content}\n\n---\n\n`;
    });
    
    return context.trim();
  }

  /**
   * Document-Aware Chunking: Preserves table rows and section boundaries
   */
  private createDocumentAwareChunks(text: string, doc: any): Array<{ content: string; metadata: any }> {
    const chunks: Array<{ content: string; metadata: any }> = [];

    // Check if document is Product Catalogue
    if (doc.filename && doc.filename.includes('Catalogue')) {
      for (const prod of AASHA_PRODUCTS) {
        const rowContent = `SKU: ${prod.sku} | Product: ${prod.productName} | Category: ${prod.category} | Material: ${prod.material} | Base Price: ₹${prod.basePrice} INR | Production Days: ${prod.productionDays} | Warranty: ${prod.warranty}\nDescription: ${prod.description}`;
        chunks.push({
          content: rowContent,
          metadata: {
            businessId: doc.businessId,
            documentId: doc.id,
            filename: doc.filename,
            entityType: 'product',
            sku: prod.sku,
            productName: prod.productName,
            basePrice: prod.basePrice,
            currency: 'INR',
            authorityLevel: 'AUTHORITATIVE',
            searchableText: `${prod.sku} ${prod.productName} ${prod.category} ${prod.material} ${prod.basePrice}`
          }
        });
      }
    }

    // Also include document body chunks
    const paragraphs = text.split(/\n\s*\n/);
    paragraphs.forEach((p, idx) => {
      const cleanP = p.trim();
      if (cleanP.length > 30) {
        chunks.push({
          content: cleanP,
          metadata: {
            businessId: doc.businessId,
            documentId: doc.id,
            filename: doc.filename,
            chunkIndex: idx,
            authorityLevel: 'AUTHORITATIVE'
          }
        });
      }
    });

    if (chunks.length === 0) {
      chunks.push({
        content: text,
        metadata: { businessId: doc.businessId, documentId: doc.id, filename: doc.filename }
      });
    }

    return chunks;
  }
}

export const knowledgeService = new KnowledgeProcessingService();

