import { prisma, Prisma } from '@agent-flux/database';
import { accountService } from '../src/services/finance/AccountService';
import { ledgerService } from '../src/services/finance/LedgerService';
import { ledgerSyncService } from '../src/services/finance/LedgerSyncService';
import { bankReconciliationService } from '../src/services/finance/BankReconciliationService';
import crypto from 'crypto';

interface SeedResult {
  businessId: string;
  businessName: string;
  accountsCreated: number;
  invoicesCreated: number;
  paymentsCreated: number;
  journalsCreated: number;
  reconciledTxCount: number;
  trialBalanceDiff: string;
  isBalanced: boolean;
}

async function seedBusinessFinance(businessId: string): Promise<SeedResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      orders: { include: { customer: true } },
      enquiries: { include: { customer: true } },
      configuration: true
    }
  });

  if (!business) {
    throw new Error(`Business ${businessId} not found`);
  }

  console.log(`\n========================================================================`);
  console.log(`SEEDING FINANCE CENTRE FOR: ${business.name} (${business.id})`);
  console.log(`========================================================================`);

  // 1. Ensure business configuration and financial identity exist
  if (!business.configuration) {
    await prisma.businessConfiguration.create({
      data: {
        businessId,
        financialConfig: {
          legalBusinessName: `${business.name} Pvt Ltd`,
          taxId: '33AABCA1234F1Z5',
          gstin: '33AABCA1234F1Z5',
          currency: 'INR',
          locale: 'en-IN',
          timezone: 'Asia/Kolkata',
          defaultTaxRate: 18,
          isTaxRegistered: true
        }
      }
    });
    console.log('✓ Initialized business configuration with Indian GST & INR settings');
  }

  // 2. Seed Standard Chart of Accounts
  const seedAccountsRes = await accountService.seedStandardAccounts(businessId);
  console.log(`✓ Seeded Chart of Accounts: ${seedAccountsRes.created} new (${seedAccountsRes.existing} existing)`);

  const bankGlAcc = await accountService.getSystemAccount(businessId, 'CASH_AND_BANK');
  const equityGlAcc = await accountService.getSystemAccount(businessId, 'OWNERS_EQUITY');
  const apGlAcc = await accountService.getSystemAccount(businessId, 'ACCOUNTS_PAYABLE');
  const cogsGlAcc = await accountService.getSystemAccount(businessId, 'COST_OF_GOODS_SOLD');
  const expGlAcc = await accountService.getSystemAccount(businessId, 'OPERATING_EXPENSE');

  // 3. Initial Capital / Equity Infusion (₹10,00,000)
  const initialCapIdempotency = `init-capital-${businessId}`;
  const existingCap = await prisma.journalEntry.findUnique({
    where: {
      businessId_idempotencyKey: {
        businessId,
        idempotencyKey: initialCapIdempotency
      }
    }
  });

  if (!existingCap) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    await ledgerService.createJournalEntry(
      businessId,
      {
        postingDate: thirtyDaysAgo,
        memo: 'Promoter equity capital infusion into Operating Bank Account',
        sourceType: 'MANUAL_JOURNAL',
        idempotencyKey: initialCapIdempotency,
        lines: [
          {
            accountId: bankGlAcc.id,
            debit: 1000000,
            credit: 0,
            description: 'Capital deposit into HDFC Operating Bank A/C'
          },
          {
            accountId: equityGlAcc.id,
            debit: 0,
            credit: 1000000,
            description: "Promoter Owner's Equity Capital"
          }
        ],
        autoPost: true
      }
    );
    console.log('✓ Posted Initial Equity Capital: ₹10,00,000 (Bank Debit / Equity Credit)');
  }

  // 4. Invoices & Payments based on Existing Orders
  const orders = business.orders;
  console.log(`Found ${orders.length} orders in business`);

  let invoicesCreated = 0;
  let paymentsCreated = 0;

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const customer = order.customer;
    if (!customer) continue;

    const invoiceNumber = `INV-${order.orderNumber.replace(/^AF-ORD-/, '')}`;
    const totalAmount = Number(order.totalAmount) || 50000;
    const taxAmount = Math.round((totalAmount * 0.18 / 1.18) * 100) / 100;
    const subtotal = Math.round((totalAmount - taxAmount) * 100) / 100;

    // Distribution:
    // Orders 0-5 (6 orders): PAID in full
    // Orders 6-7 (2 orders): PARTIALLY_PAID (50% paid)
    // Order 8 (1 order): ISSUED (unpaid, due in 15 days)
    // Order 9 (1 order): OVERDUE (unpaid, due 10 days ago)
    let status: 'PAID' | 'PARTIALLY_PAID' | 'ISSUED' | 'OVERDUE' = 'PAID';
    let paidAmount = totalAmount;
    let daysAgo = 20 - i;
    let dueDate = new Date(Date.now() + 15 * 86400000);

    if (i === 6 || i === 7) {
      status = 'PARTIALLY_PAID';
      paidAmount = Math.round(totalAmount * 0.5);
    } else if (i === 8) {
      status = 'ISSUED';
      paidAmount = 0;
    } else if (i === 9) {
      status = 'OVERDUE';
      paidAmount = 0;
      daysAgo = 40;
      dueDate = new Date(Date.now() - 10 * 86400000);
    }

    const outstandingAmount = totalAmount - paidAmount;
    const invoiceDate = new Date(Date.now() - daysAgo * 86400000);

    // Upsert Invoice
    let invoice = await prisma.invoice.findUnique({
      where: {
        businessId_invoiceNumber: {
          businessId,
          invoiceNumber
        }
      }
    });

    if (!invoice) {
      invoice = await prisma.invoice.create({
        data: {
          businessId,
          customerId: customer.id,
          orderId: order.id,
          invoiceNumber,
          status,
          currency: 'INR',
          invoiceDate,
          dueDate,
          subtotal,
          taxAmount,
          discountAmount: 0,
          totalAmount,
          paidAmount,
          outstandingAmount,
          lineItems: [
            {
              description: `Handcrafted Teak Wood Furniture Batch for Order ${order.orderNumber}`,
              quantity: 1,
              unitPrice: subtotal,
              amount: subtotal
            }
          ]
        }
      });
      invoicesCreated++;
    }

    // Create Payment if paidAmount > 0
    if (paidAmount > 0) {
      const existingPay = await prisma.payment.findFirst({
        where: { invoiceId: invoice.id, businessId }
      });

      if (!existingPay) {
        const paymentDate = new Date(invoiceDate.getTime() + 86400000); // 1 day after invoice
        await prisma.payment.create({
          data: {
            businessId,
            invoiceId: invoice.id,
            customerId: customer.id,
            orderId: order.id,
            provider: i % 2 === 0 ? 'RAZORPAY' : 'BANK_TRANSFER',
            providerPaymentId: `pay_rzp_${crypto.randomBytes(6).toString('hex')}`,
            amount: paidAmount,
            currency: 'INR',
            status: 'SUCCEEDED',
            paidAt: paymentDate,
            metadata: {
              fee: i % 2 === 0 ? Math.round(paidAmount * 0.02) : 0 // 2% gateway fee for Razorpay
            }
          }
        });
        paymentsCreated++;
      }
    }
  }

  // 5. Create 2 Custom Booking Invoices from Enquiries
  const sampleCustomer = business.orders[0]?.customer || (await prisma.customer.findFirst({ where: { businessId } }));
  if (sampleCustomer) {
    const booking1Num = 'INV-BOOKING-001';
    let bInv1 = await prisma.invoice.findUnique({
      where: { businessId_invoiceNumber: { businessId, invoiceNumber: booking1Num } }
    });

    if (!bInv1) {
      const bTotal = 145000;
      const bTax = Math.round((bTotal * 0.18 / 1.18) * 100) / 100;
      const bSub = bTotal - bTax;
      bInv1 = await prisma.invoice.create({
        data: {
          businessId,
          customerId: sampleCustomer.id,
          invoiceNumber: booking1Num,
          status: 'PAID',
          currency: 'INR',
          invoiceDate: new Date(Date.now() - 14 * 86400000),
          dueDate: new Date(Date.now() + 10 * 86400000),
          subtotal: bSub,
          taxAmount: bTax,
          discountAmount: 0,
          totalAmount: bTotal,
          paidAmount: bTotal,
          outstandingAmount: 0,
          lineItems: [
            {
              description: 'Custom Handcrafted Solid Oak 10-Seater Dining Suite Booking',
              quantity: 1,
              unitPrice: bSub,
              amount: bSub
            }
          ]
        }
      });
      invoicesCreated++;

      await prisma.payment.create({
        data: {
          businessId,
          invoiceId: bInv1.id,
          customerId: sampleCustomer.id,
          provider: 'RAZORPAY',
          providerPaymentId: `pay_rzp_${crypto.randomBytes(6).toString('hex')}`,
          amount: bTotal,
          currency: 'INR',
          status: 'SUCCEEDED',
          paidAt: new Date(Date.now() - 13 * 86400000),
          metadata: { fee: Math.round(bTotal * 0.02) }
        }
      });
      paymentsCreated++;
    }

    const booking2Num = 'INV-BOOKING-002';
    let bInv2 = await prisma.invoice.findUnique({
      where: { businessId_invoiceNumber: { businessId, invoiceNumber: booking2Num } }
    });

    if (!bInv2) {
      const bTotal = 95000;
      const bTax = Math.round((bTotal * 0.18 / 1.18) * 100) / 100;
      const bSub = bTotal - bTax;
      bInv2 = await prisma.invoice.create({
        data: {
          businessId,
          customerId: sampleCustomer.id,
          invoiceNumber: booking2Num,
          status: 'PARTIALLY_PAID',
          currency: 'INR',
          invoiceDate: new Date(Date.now() - 6 * 86400000),
          dueDate: new Date(Date.now() + 20 * 86400000),
          subtotal: bSub,
          taxAmount: bTax,
          discountAmount: 0,
          totalAmount: bTotal,
          paidAmount: 45000,
          outstandingAmount: 50000,
          lineItems: [
            {
              description: 'Executive Rosewood Workstation & Credenza Custom Booking Deposit',
              quantity: 1,
              unitPrice: bSub,
              amount: bSub
            }
          ]
        }
      });
      invoicesCreated++;

      await prisma.payment.create({
        data: {
          businessId,
          invoiceId: bInv2.id,
          customerId: sampleCustomer.id,
          provider: 'BANK_TRANSFER',
          providerPaymentId: `pay_bank_${crypto.randomBytes(6).toString('hex')}`,
          amount: 45000,
          currency: 'INR',
          status: 'SUCCEEDED',
          paidAt: new Date(Date.now() - 5 * 86400000)
        }
      });
      paymentsCreated++;
    }
  }

  // 6. Synchronize Subledgers (Invoices & Payments) to General Ledger
  console.log('Synchronizing invoices and payments to General Ledger...');
  const syncResult = await ledgerSyncService.batchSyncOperationalRecords(businessId);
  console.log(`✓ Ledger sync: ${syncResult.invoicesSynced} invoices synced, ${syncResult.paymentsSynced} payments synced`);

  // 7. Seed Vendor Bills and Operational Expenses
  // A. Timber Raw Materials Vendor Bill (₹2,10,000)
  const timberBillIdemp = `vendor-timber-${businessId}`;
  const existingTimber = await prisma.journalEntry.findUnique({
    where: { businessId_idempotencyKey: { businessId, idempotencyKey: timberBillIdemp } }
  });
  if (!existingTimber) {
    await ledgerService.createJournalEntry(
      businessId,
      {
        postingDate: new Date(Date.now() - 22 * 86400000),
        memo: 'Vendor Bill: Century Ply & Timber Mills (Teak Hardwood Logs Batch)',
        sourceType: 'MANUAL_JOURNAL',
        idempotencyKey: timberBillIdemp,
        lines: [
          {
            accountId: cogsGlAcc.id,
            debit: 210000,
            credit: 0,
            description: 'Direct Material & Teak Lumber Procurement (COGS)'
          },
          {
            accountId: apGlAcc.id,
            debit: 0,
            credit: 210000,
            description: 'Accounts Payable: Century Ply & Timber Mills'
          }
        ],
        autoPost: true
      }
    );
    console.log('✓ Posted Supplier Bill: ₹2,10,000 (COGS Debit / AP Credit)');
  }

  // B. Partial Payment to Supplier (₹1,50,000)
  const timberPayIdemp = `vendor-timber-pay-${businessId}`;
  const existingTimberPay = await prisma.journalEntry.findUnique({
    where: { businessId_idempotencyKey: { businessId, idempotencyKey: timberPayIdemp } }
  });
  if (!existingTimberPay) {
    await ledgerService.createJournalEntry(
      businessId,
      {
        postingDate: new Date(Date.now() - 12 * 86400000),
        memo: 'Payment to Century Ply & Timber Mills via Bank Transfer (Partial Bill Settlement)',
        sourceType: 'MANUAL_JOURNAL',
        idempotencyKey: timberPayIdemp,
        lines: [
          {
            accountId: apGlAcc.id,
            debit: 150000,
            credit: 0,
            description: 'Settlement of Vendor Bill - Century Ply'
          },
          {
            accountId: bankGlAcc.id,
            debit: 0,
            credit: 150000,
            description: 'Bank Transfer from Operating Bank A/C'
          }
        ],
        autoPost: true
      }
    );
    console.log('✓ Posted Vendor Payment: ₹1,50,000 (AP Debit / Bank Credit, leaving ₹60,000 AP)');
  }

  // C. Showroom & Workshop Monthly Lease (₹45,000)
  const rentIdemp = `exp-rent-${businessId}`;
  const existingRent = await prisma.journalEntry.findUnique({
    where: { businessId_idempotencyKey: { businessId, idempotencyKey: rentIdemp } }
  });
  if (!existingRent) {
    await ledgerService.createJournalEntry(
      businessId,
      {
        postingDate: new Date(Date.now() - 15 * 86400000),
        memo: 'Factory Workshop & Showroom Monthly Rent Payment',
        sourceType: 'MANUAL_JOURNAL',
        idempotencyKey: rentIdemp,
        lines: [
          {
            accountId: expGlAcc.id,
            debit: 45000,
            credit: 0,
            description: 'Workshop & Showroom Lease Rent'
          },
          {
            accountId: bankGlAcc.id,
            debit: 0,
            credit: 45000,
            description: 'Direct Debit from Operating Bank A/C'
          }
        ],
        autoPost: true
      }
    );
    console.log('✓ Posted Operating Expense: Workshop Lease ₹45,000');
  }

  // D. Factory Electricity & Power Bill (₹19,250)
  const powerIdemp = `exp-power-${businessId}`;
  const existingPower = await prisma.journalEntry.findUnique({
    where: { businessId_idempotencyKey: { businessId, idempotencyKey: powerIdemp } }
  });
  if (!existingPower) {
    await ledgerService.createJournalEntry(
      businessId,
      {
        postingDate: new Date(Date.now() - 7 * 86400000),
        memo: 'Factory Industrial Electricity & Generator Diesel Consumables',
        sourceType: 'MANUAL_JOURNAL',
        idempotencyKey: powerIdemp,
        lines: [
          {
            accountId: expGlAcc.id,
            debit: 19250,
            credit: 0,
            description: 'Industrial Power Bill (TNEB)'
          },
          {
            accountId: bankGlAcc.id,
            debit: 0,
            credit: 19250,
            description: 'Direct Bank NEFT Debit'
          }
        ],
        autoPost: true
      }
    );
    console.log('✓ Posted Operating Expense: Factory Power ₹19,250');
  }

  // 8. Bank Feed Account & Bank Transactions (For Bank Feeds & Automated Reconciliation)
  let bankFeed = await prisma.bankFeedAccount.findUnique({
    where: { accountId: bankGlAcc.id }
  });

  if (!bankFeed) {
    bankFeed = await bankReconciliationService.createBankFeedAccount(businessId, {
      accountId: bankGlAcc.id,
      institutionName: 'HDFC Bank Corporate Current A/C',
      accountNumberMask: '•••• 7824',
      currency: 'INR'
    });
    console.log('✓ Created Bank Feed Account: HDFC Bank Corporate Current A/C (•••• 7824)');
  }

  // Prepare statement transactions corresponding to ledger events
  const bankStatementLines = [
    {
      transactionDate: new Date(Date.now() - 30 * 86400000),
      amount: '1000000.00',
      description: 'CHQ/DEP/PROMOTER CAPITAL INFUSION/00192',
      referenceNumber: 'CAP-001'
    },
    {
      transactionDate: new Date(Date.now() - 21 * 86400000),
      amount: '37240.00', // 38,000 minus ₹760 gateway fee
      description: 'RAZORPAY PAYOUT BATCH 88219 - INV-000001',
      referenceNumber: 'AF-ORD-000001'
    },
    {
      transactionDate: new Date(Date.now() - 20 * 86400000),
      amount: '74480.00', // 76,000 minus ₹1520 gateway fee
      description: 'RAZORPAY PAYOUT BATCH 88220 - INV-000002',
      referenceNumber: 'AF-ORD-000002'
    },
    {
      transactionDate: new Date(Date.now() - 19 * 86400000),
      amount: '76000.00',
      description: 'NEFT CR-KARTHIK-FURNITURE PAYMENT INV-000003',
      referenceNumber: 'AF-ORD-000003'
    },
    {
      transactionDate: new Date(Date.now() - 14 * 86400000),
      amount: '142100.00', // 1,45,000 minus ₹2900 fee
      description: 'RAZORPAY PAYOUT - CUSTOM OAK SUITE INV-BOOKING-001',
      referenceNumber: 'INV-BOOKING-001'
    },
    {
      transactionDate: new Date(Date.now() - 12 * 86400000),
      amount: '-150000.00',
      description: 'RTGS DR/CENTURY PLY & TIMBER/RAW MATERIALS',
      referenceNumber: 'RTGS-CP-9901'
    },
    {
      transactionDate: new Date(Date.now() - 15 * 86400000),
      amount: '-45000.00',
      description: 'NEFT DR/SRI KRISHNA PROPERTIES/SHOWROOM LEASE',
      referenceNumber: 'LEASE-OCT-26'
    },
    {
      transactionDate: new Date(Date.now() - 7 * 86400000),
      amount: '-19250.00',
      description: 'AUTODEBIT/TNEB POWER DISTRIB/OCT BILL',
      referenceNumber: 'TNEB-84920'
    },
    // Add 2 candidates waiting in queue for the user to test Auto-Reconcile!
    {
      transactionDate: new Date(Date.now() - 5 * 86400000),
      amount: '45000.00',
      description: 'IMPS CR-NIRMAL S-ROSEWOOD DESK ADVANCE INV-BOOKING-002',
      referenceNumber: 'INV-BOOKING-002'
    },
    {
      transactionDate: new Date(Date.now() - 2 * 86400000),
      amount: '56560.00',
      description: 'NEFT CR-DHIVITH-ORDER BALANCE AF-ORD-000004',
      referenceNumber: 'AF-ORD-000004'
    }
  ];

  const ingestRes = await bankReconciliationService.ingestTransactions(
    businessId,
    bankFeed.id,
    bankStatementLines
  );
  console.log(`✓ Ingested ${ingestRes.inserted} bank statement lines into HDFC Feed`);

  // Run auto-reconciliation on high-confidence matches (85% threshold)
  const autoReconcileRes = await bankReconciliationService.autoReconcile(
    businessId,
    bankFeed.id,
    85
  );
  console.log(`✓ Auto-reconciliation executed: ${autoReconcileRes.matchedCount} transactions matched, ${autoReconcileRes.unmatchedCount} pending in queue for interactive test`);

  // 9. Verify General Ledger Health & Trial Balance Equilibrium
  const trialBalance = await ledgerService.getTrialBalance(businessId);
  const totalJournals = await prisma.journalEntry.count({ where: { businessId } });

  console.log(`\n--- GENERAL LEDGER HEALTH SUMMARY ---`);
  console.log(`Total Debits:  ₹${Number(trialBalance.totalDebit).toLocaleString('en-IN')}`);
  console.log(`Total Credits: ₹${Number(trialBalance.totalCredit).toLocaleString('en-IN')}`);
  console.log(`Discrepancy:   ₹${Number(trialBalance.difference).toLocaleString('en-IN')}`);
  console.log(`Is Balanced:   ${trialBalance.isBalanced ? '✓ YES (PERFECT EQUILIBRIUM)' : '✗ NO'}`);
  console.log(`Total Journal Entries: ${totalJournals}`);

  return {
    businessId,
    businessName: business.name,
    accountsCreated: seedAccountsRes.created,
    invoicesCreated,
    paymentsCreated,
    journalsCreated: totalJournals,
    reconciledTxCount: autoReconcileRes.matchedCount,
    trialBalanceDiff: trialBalance.difference.toString(),
    isBalanced: trialBalance.isBalanced
  };
}

async function main() {
  const targetBusinesses = [
    '1379ce47-39e9-4742-9034-dfe218b6c0fc', // Aasha Furniture (Primary with 60 enquiries + 10 orders)
    '0fbcebfa-e371-41b9-9eb1-68158e4437b2'  // Aasha Furniture (Secondary with configuration)
  ];

  const results: SeedResult[] = [];

  for (const bId of targetBusinesses) {
    try {
      const res = await seedBusinessFinance(bId);
      results.push(res);
    } catch (err: any) {
      console.error(`Failed to seed finance for ${bId}:`, err);
    }
  }

  console.log('\n========================================================================');
  console.log('FINAL SEEDING COMPLETED FOR ALL TARGET BUSINESSES:');
  console.log(JSON.stringify(results, null, 2));
  console.log('========================================================================\n');
}

main()
  .catch((e) => {
    console.error('Fatal execution error:', e);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
