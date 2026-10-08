import { prisma } from '@agent-flux/database';
import { SourceType, SourceStatus, DocumentStatus } from '@prisma/client';
import { KnowledgeSourceAdapter } from './adapters/adapter';
import { GoogleDriveKnowledgeAdapter } from './adapters/googleDrive';
import { GoogleSheetsKnowledgeAdapter } from './adapters/googleSheets';
import { knowledgeQueue } from '../queue/knowledgeQueue';
import { storageService } from '../storage';

export function getAdapterForSource(type: SourceType): KnowledgeSourceAdapter {
  switch (type) {
    case SourceType.GOOGLE_DRIVE: return new GoogleDriveKnowledgeAdapter();
    case SourceType.GOOGLE_SHEETS: return new GoogleSheetsKnowledgeAdapter();
    default: throw new Error(`Adapter for source type ${type} is not implemented.`);
  }
}

export async function syncKnowledgeSource(sourceId: string) {
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error('Source not found');

  if (source.status === SourceStatus.DISCONNECTED || source.status === SourceStatus.PAUSED) {
    return; // Don't sync if disconnected/paused
  }

  // Update status to SYNCING
  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: { status: SourceStatus.SYNCING }
  });

  try {
    const adapter = getAdapterForSource(source.type);
    const items = await adapter.sync(source);

    // Create KnowledgeDocuments for each item
    for (const item of items) {
      // Check if document already exists
      let doc = await prisma.knowledgeDocument.findFirst({
        where: {
          sourceId: source.id,
          externalId: item.externalId
        }
      });

      // Simple hash to detect changes
      const contentHash = Buffer.from(item.content).toString('base64').substring(0, 50);

      if (doc) {
        if (doc.contentHash === contentHash) {
          // No changes, skip
          continue;
        }
        // Ensure content is stored locally
        const buffer = Buffer.from(item.content, 'utf-8');
        const storagePath = await storageService.storeDocument(
          source.businessId, 
          source.knowledgeBaseId, 
          doc.id, 
          buffer, 
          'txt'
        );

        // Exists but changed, we should reprocess
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: {
            contentHash,
            storagePath,
            status: DocumentStatus.UPLOADED, // Reset status so processor picks it up
            updatedAt: new Date()
          }
        });
        
        // Push to processing queue
        await knowledgeQueue.add('process-document', {
          documentId: doc.id,
          action: 'process'
        });

      } else {
        // Create new document
        doc = await prisma.knowledgeDocument.create({
          data: {
            knowledgeBaseId: source.knowledgeBaseId,
            businessId: source.businessId,
            sourceId: source.id,
            filename: item.title,
            mimeType: 'text/plain', // We normalized everything to text in the adapter
            fileSize: item.content.length,
            contentHash,
            externalId: item.externalId,
            externalUrl: item.url,
            externalModifiedAt: item.modifiedAt,
            status: DocumentStatus.UPLOADED,
            metadata: item.metadata
          }
        });

        // Store content
        const buffer = Buffer.from(item.content, 'utf-8');
        const storagePath = await storageService.storeDocument(
          source.businessId, 
          source.knowledgeBaseId, 
          doc.id, 
          buffer, 
          'txt'
        );

        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: { storagePath }
        });
        
        // Push to processing queue
        await knowledgeQueue.add('process-document', {
          documentId: doc.id,
          action: 'process'
        });
      }
    }

    // Update source status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: SourceStatus.INDEXED,
        lastSyncedAt: new Date()
      }
    });

  } catch (error: any) {
    console.error('Source Sync Failed:', error);
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: SourceStatus.FAILED }
    });
  }
}
