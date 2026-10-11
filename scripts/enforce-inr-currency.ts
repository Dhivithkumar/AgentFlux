import { prisma } from '@agent-flux/database';

async function enforceInrCurrency() {
  console.log('========================================================================');
  console.log('ENFORCING INR (RUPEES) ACROSS ENTIRE DATABASE');
  console.log('========================================================================\n');

  try {
    // 1. Update all businesses
    const bizRes = await prisma.business.updateMany({
      where: {
        OR: [
          { currency: { not: 'INR' } },
          { currency: null }
        ]
      },
      data: { currency: 'INR' }
    });
    console.log(`Updated ${bizRes.count} businesses to currency: INR`);

    // 2. Update all quotations
    const quoteRes = await prisma.quotation.updateMany({
      where: { currency: { not: 'INR' } },
      data: { currency: 'INR' }
    });
    console.log(`Updated ${quoteRes.count} quotations to currency: INR`);

    // 3. Update all orders
    const orderRes = await prisma.order.updateMany({
      where: { currency: { not: 'INR' } },
      data: { currency: 'INR' }
    });
    console.log(`Updated ${orderRes.count} orders to currency: INR`);

    // 4. Update all invoices
    const invRes = await prisma.invoice.updateMany({
      where: { currency: { not: 'INR' } },
      data: { currency: 'INR' }
    });
    console.log(`Updated ${invRes.count} invoices to currency: INR`);

    // 5. Update all payments
    const payRes = await prisma.payment.updateMany({
      where: { currency: { not: 'INR' } },
      data: { currency: 'INR' }
    });
    console.log(`Updated ${payRes.count} payments to currency: INR`);

    // 6. Update all Chart of Accounts
    const accRes = await prisma.account.updateMany({
      where: { currency: { not: 'INR' } },
      data: { currency: 'INR' }
    });
    console.log(`Updated ${accRes.count} GL accounts to currency: INR`);

    // 7. Update all Journal lines
    const lineRes = await prisma.journalLine.updateMany({
      where: { currency: { not: 'INR' } },
      data: { currency: 'INR' }
    });
    console.log(`Updated ${lineRes.count} journal lines to currency: INR`);

    // 8. Update all Bank Feed accounts
    const feedRes = await prisma.bankFeedAccount.updateMany({
      where: { currency: { not: 'INR' } },
      data: { currency: 'INR' }
    });
    console.log(`Updated ${feedRes.count} bank feed accounts to currency: INR`);

    // 9. Update all Bank Transactions
    const txRes = await prisma.bankTransaction.updateMany({
      where: { currency: { not: 'INR' } },
      data: { currency: 'INR' }
    });
    console.log(`Updated ${txRes.count} bank transactions to currency: INR`);

    // 10. Update BusinessConfiguration financialConfig
    const configs = await prisma.businessConfiguration.findMany();
    let updatedConfigs = 0;
    for (const c of configs) {
      const finConfig = (c.financialConfig as any) || {};
      if (finConfig.currency !== 'INR') {
        finConfig.currency = 'INR';
        await prisma.businessConfiguration.update({
          where: { id: c.id },
          data: { financialConfig: finConfig }
        });
        updatedConfigs++;
      }
    }
    console.log(`Updated ${updatedConfigs} business configurations to currency: INR`);

    console.log('\n✅ ALL DATABASE MODELS AND CONFIGURATIONS SUCCESSFULLY ENFORCED TO INR!');
  } catch (err: any) {
    console.error('Error enforcing INR:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

enforceInrCurrency();
