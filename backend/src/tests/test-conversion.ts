import '../env';
import { prisma } from '@agent-flux/database';

async function main() {
  try {
    const docs = await prisma.knowledgeDocument.findMany({
      where: {
        mimeType: { contains: 'wordprocessingml.document' }
      },
      select: { id: true, filename: true, storagePath: true }
    });
    console.log('Templates found:', docs);
  } catch (e: any) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main().catch(console.error);
