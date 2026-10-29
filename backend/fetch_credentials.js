const { PrismaClient } = require('@agent-flux/database');
const prisma = new PrismaClient();

async function main() {
  const credentials = await prisma.integrationCredential.findMany();
  console.log(credentials.map(c => c.accessTokenEncrypted));
}

main().finally(() => prisma.$disconnect());
