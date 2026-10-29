import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: '70448525-d092-4845-a5a6-1855ede31aae' }
  });

  if (execution && execution.context) {
    const ctx = execution.context as any;
    console.log(`Status: ${execution.status}`);
    console.log(JSON.stringify(ctx.steps, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
