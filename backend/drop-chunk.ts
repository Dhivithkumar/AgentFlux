import { prisma } from '@agent-flux/database';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

async function run() {
  await prisma.$executeRawUnsafe('DROP TABLE "KnowledgeChunk" CASCADE;');
  console.log("Dropped table");
}
run().finally(() => prisma.$disconnect());
