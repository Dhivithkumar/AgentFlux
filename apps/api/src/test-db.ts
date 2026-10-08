import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.integration.findMany().then(res => console.log(JSON.stringify(res, null, 2))).finally(() => prisma.$disconnect());











