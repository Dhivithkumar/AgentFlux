import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateCurrency() {
  console.log('Starting explicit currency migration...');
  try {
    const indiaBusinesses = await prisma.business.findMany({
      where: { country: 'India' }
    });

    console.log(`Found ${indiaBusinesses.length} businesses configured for India.`);

    for (const business of indiaBusinesses) {
      if (!business.currency || business.currency !== 'INR') {
        console.log(`Updating business ${business.id} currency to INR`);
        await prisma.business.update({
          where: { id: business.id },
          data: { currency: 'INR' }
        });
      }

      const orders = await prisma.order.updateMany({
        where: { businessId: business.id, currency: null },
        data: { currency: 'INR' }
      });
      console.log(`Updated ${orders.count} orders to INR for business ${business.id}`);
      
      const quotations = await prisma.quotation.updateMany({
        where: { businessId: business.id, currency: { in: ['USD', ''] } },
        data: { currency: 'INR' }
      });
      console.log(`Updated ${quotations.count} quotations to INR for business ${business.id}`);

      const invoices = await prisma.invoice.updateMany({
        where: { businessId: business.id, currency: { in: ['USD', ''] } },
        data: { currency: 'INR' }
      });
      console.log(`Updated ${invoices.count} invoices to INR for business ${business.id}`);
    }

    console.log('Currency migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrateCurrency();
