const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 
async function run() { 
  const businessId = 'test-bus-123'; 
  let seq = await prisma.documentSequence.upsert({ 
    where: { businessId_type: { businessId, type: 'QUOTATION' } }, 
    update: { lastValue: { increment: 1 } }, 
    create: { businessId, type: 'QUOTATION', lastValue: 1 } 
  }); 
  console.log('first:', seq.lastValue); 
  seq = await prisma.documentSequence.upsert({ 
    where: { businessId_type: { businessId, type: 'QUOTATION' } }, 
    update: { lastValue: { increment: 1 } }, 
    create: { businessId, type: 'QUOTATION', lastValue: 1 } 
  }); 
  console.log('second:', seq.lastValue); 
} 
run().catch(console.error).finally(()=>prisma.$disconnect());
