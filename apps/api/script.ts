import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const execution = await prisma.workflowExecution.findFirst({
    where: { status: 'FAILED' },
    orderBy: { startedAt: 'desc' }
  });
  console.log(JSON.stringify(execution, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
