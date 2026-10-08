import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const latestExecution = await prisma.workflowExecution.findFirst({
    orderBy: { startedAt: 'desc' },
    include: { workflow: true }
  });

  if (latestExecution) {
    console.log(`Execution ID: ${latestExecution.id}`);
    console.log(`Status: ${latestExecution.status}`);
    console.log(`Context:`);
    console.log(JSON.stringify(latestExecution.context, null, 2));
  } else {
    console.log('No execution found');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
