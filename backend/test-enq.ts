import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const enquiries = await prisma.enquiry.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3
  });
  console.log(JSON.stringify(enquiries, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
