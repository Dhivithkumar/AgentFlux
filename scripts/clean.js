const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 
async function run() { 
  await prisma.invoice.deleteMany(); 
  await prisma.quotation.deleteMany(); 
  await prisma.order.deleteMany(); 
  await prisma.documentSequence.deleteMany(); 
  console.log("DB CLEANED");
} 
run().catch(console.error).finally(()=>prisma.$disconnect());
