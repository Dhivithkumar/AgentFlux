import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: '70448525-d092-4845-a5a6-1855ede31aae' }
  });

  if (execution) {
    console.log(`Status: ${execution.status}`);
    console.log(JSON.stringify(execution.context, null, 2));
  } else {
    console.log('Execution not found');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
