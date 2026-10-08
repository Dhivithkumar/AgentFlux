import { PrismaClient } from '@prisma/client';
import { knowledgeService } from '../apps/api/src/services/knowledge';

const prisma = new PrismaClient();

async function runMigration() {
  console.log('Starting safe embedding dimension migration...');
  
  try {
    // 1. Find all documents that are currently indexed
    const documents = await prisma.knowledgeDocument.findMany({
      where: {
        status: {
          in: ['INDEXED', 'PARTIALLY_INDEXED', 'EMBEDDING']
        }
      }
    });

    console.log(`Found ${documents.length} documents requiring re-indexing.`);

    for (const doc of documents) {
      console.log(`Processing document: ${doc.id} (${doc.filename})`);
      
      // We rely on reprocessDocument which deletes old chunks and re-processes them
      // This will use the new vector(3072) size as defined in the schema.
      await knowledgeService.reprocessDocument(doc.id);
      console.log(`Successfully queued/re-processed document: ${doc.id}`);
    }

    console.log('Migration completed.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
