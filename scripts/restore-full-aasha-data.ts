import { prisma } from '@agent-flux/database';
import { accountService } from '../apps/api/src/services/finance/AccountService';
import { ledgerService } from '../apps/api/src/services/finance/LedgerService';
import { ledgerSyncService } from '../apps/api/src/services/finance/LedgerSyncService';
import { bankReconciliationService } from '../apps/api/src/services/finance/BankReconciliationService';
import { paymentSummaryService } from '../apps/api/src/services/payment/PaymentSummaryService';
import crypto from 'crypto';

const BUSINESS_ID = '1379ce47-39e9-4742-9034-dfe218b6c0fc';
const USER_EMAIL = 'dhivith.off@gmail.com';

const CUSTOMERS_DATA = [
  { name: 'Rajesh Sharma', email: 'rajesh.sharma@example.com', phone: '+91 98401 23456', city: 'Coimbatore', score: 88 },
  { name: 'Priya Sundaram', email: 'priya.sundaram@example.com', phone: '+91 98412 34567', city: 'Chennai', score: 95 },
  { name: 'Karthik Venkat', email: 'karthik@test.com', phone: '+91 98423 45678', city: 'Bangalore', score: 92 },
  { name: 'Ananya Krishnan', email: 'ananya.k@example.com', phone: '+91 98434 56789', city: 'Coimbatore', score: 85 },
  { name: 'Suresh Babu', email: 'suresh.babu@example.com', phone: '+91 98445 67890', city: 'Tiruppur', score: 78 },
  { name: 'Meera Raman', email: 'meera.raman@example.com', phone: '+91 98456 78901', city: 'Salem', score: 90 },
  { name: 'Vikramaditya Singh', email: 'vikram.singh@example.com', phone: '+91 98467 89012', city: 'Coimbatore', score: 82 },
  { name: 'Divya Nair', email: 'divya.nair@example.com', phone: '+91 98478 90123', city: 'Kochi', score: 94 },
  { name: 'Arun Prakash', email: 'arun.prakash@example.com', phone: '+91 98489 01234', city: 'Madurai', score: 75 },
  { name: 'Kavitha Mohan', email: 'kavitha.m@example.com', phone: '+91 98490 12345', city: 'Chennai', score: 89 }
];

const ENQUIRY_TEMPLATES = [
  { item: '3-Door Teak Wardrobe (WAR-001)', price: 28000, cat: 'Wardrobe', days: 9 },
  { item: 'Classic Teak 3-Seater Sofa (SOF-001)', price: 42000, cat: 'Sofa', days: 12 },
  { item: '6-Seater Solid Oak Dining Suite (DIN-001)', price: 65000, cat: 'Dining', days: 14 },
  { item: 'King Size Teak Bed with Hydraulic Storage', price: 58000, cat: 'Bedroom', days: 10 },
  { item: 'L-Shaped Modular Fabric Sectional Sofa', price: 48000, cat: 'Sofa', days: 8 },
  { item: 'Custom Ergonomic Solid Sheesham Study Desk', price: 24000, cat: 'Study', days: 6 },
  { item: 'Modern Minimalist TV Console & Wall Unit', price: 32000, cat: 'Living', days: 7 },
  { item: '4-Door Modular Engineered Wood Wardrobe with Mirror', price: 38000, cat: 'Wardrobe', days: 11 },
  { item: '8-Seater Premium Teak Dining Table with Cushioned Chairs', price: 88000, cat: 'Dining', days: 15 },
  { item: 'Luxury Accent Lounge Chair in Top-Grain Leather', price: 22000, cat: 'Living', days: 5 }
];

async function main() {
  console.log('\n========================================================================');
  console.log('   FULL RESTORATION: AASHA FURNITURE PRODUCTION DATASET');
  console.log('========================================================================\n');

  // 1. Ensure User & Business Setup
  let user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) {
    throw new Error(`User ${USER_EMAIL} not found. Please ensure account is registered.`);
  }

  console.log('[1/6] Restoring Business Profile & Configuration...');
  const business = await prisma.business.upsert({
    where: { id: BUSINESS_ID },
    create: {
      id: BUSINESS_ID,
      name: 'Aasha Furniture',
      industry: 'Furniture Manufacturing',
      country: 'India',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      website: 'https://aashafurniture.com',
      description: 'Authoritative bespoke furniture manufacturer specializing in teak, oak, and sheesham handcrafted living and dining sets.'
    },
    update: {
      name: 'Aasha Furniture',
      industry: 'Furniture Manufacturing',
      country: 'India',
      timezone: 'Asia/Kolkata',
      currency: 'INR'
    }
  });

  // Ensure Membership
  const existingMembership = await prisma.membership.findFirst({
    where: { userId: user.id, businessId: BUSINESS_ID }
  });
  if (!existingMembership) {
    await prisma.membership.create({
      data: { userId: user.id, businessId: BUSINESS_ID, role: 'OWNER' }
    });
  }

  // Ensure BusinessConfiguration
  const fullFinancialConfig = {
    legalBusinessName: 'Aasha Furniture Pvt Ltd',
    displayName: 'Aasha Furniture',
    email: USER_EMAIL,
    supportEmail: 'support@aashafurniture.com',
    phone: '+91 9876543210',
    addressLine1: '123 Industrial Estate',
    addressLine2: 'Phase 2, Cross Road 4',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    postalCode: '641001',
    country: 'India',
    taxRegistrationStatus: 'REGISTERED',
    taxId: '33AABCU9603R1ZM',
    gstin: '33AABCU9603R1ZM',
    pan: 'AABCU9603R',
    currency: 'INR',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    defaultTaxRate: 18,
    isTaxRegistered: true,
    invoicePrefix: 'AF-INV-',
    quotationPrefix: 'AF-QUO-',
    orderPrefix: 'AF-ORD-',
    bankName: 'HDFC Bank',
    bankAccountName: 'Aasha Furniture Pvt Ltd',
    bankAccountNumber: '50200012345678',
    bankIfsc: 'HDFC0001234',
    bankBranch: 'Coimbatore Main Branch',
    upiId: 'aasha@hdfc',
    authorizedSignatoryName: 'Dhivith Kumar',
    authorizedSignatoryDesignation: 'Managing Director',
    authorizedSignatoryEmail: USER_EMAIL
  };

  const existingConfig = await prisma.businessConfiguration.findUnique({
    where: { businessId: BUSINESS_ID }
  });
  if (!existingConfig) {
    await prisma.businessConfiguration.create({
      data: {
        businessId: BUSINESS_ID,
        financialConfig: fullFinancialConfig
      }
    });
  } else {
    await prisma.businessConfiguration.update({
      where: { businessId: BUSINESS_ID },
      data: { financialConfig: fullFinancialConfig }
    });
  }
  console.log('✓ Business and Configuration verified.');

  // 2. Seed Customers
  console.log('\n[2/6] Restoring 10 Core Customers...');
  const customers: any[] = [];
  for (const cData of CUSTOMERS_DATA) {
    let customer = await prisma.customer.findFirst({
      where: { businessId: BUSINESS_ID, email: cData.email }
    });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          businessId: BUSINESS_ID,
          name: cData.name,
          email: cData.email,
          phone: cData.phone,
          source: 'DIRECT',
          status: 'ACTIVE',
          paymentScore: cData.score,
          paymentScoreCategory: cData.score >= 90 ? 'EXCELLENT' : cData.score >= 80 ? 'GOOD' : 'FAIR',
          creditLimit: 150000,
          customData: { city: cData.city, state: 'Tamil Nadu' }
        }
      });
    }
    customers.push(customer);
  }
  console.log(`✓ 10 Customers restored.`);

  // 3. Seed 60 Enquiries
  console.log('\n[3/6] Restoring 60 Customer Enquiries across 60 days...');
  const existingEnquiriesCount = await prisma.enquiry.count({ where: { businessId: BUSINESS_ID } });
  if (existingEnquiriesCount < 60) {
    const toCreate = 60 - existingEnquiriesCount;
    for (let i = 0; i < toCreate; i++) {
      const cust = customers[i % customers.length];
      const tmpl = ENQUIRY_TEMPLATES[i % ENQUIRY_TEMPLATES.length];
      const daysAgo = Math.floor((i / toCreate) * 58);
      const createdAt = new Date(Date.now() - daysAgo * 86400000);

      const sources = ['GMAIL', 'WHATSAPP', 'WEB_FORM', 'DIRECT'];
      const source = sources[i % sources.length];
      const statuses: any[] = ['NEW', 'PROCESSING', 'READY', 'IN_PROGRESS', 'RESOLVED'];
      const status = statuses[i % statuses.length];

      await prisma.enquiry.create({
        data: {
          businessId: BUSINESS_ID,
          customerId: cust.id,
          source,
          status,
          subject: `Enquiry for ${tmpl.item}`,
          rawMessage: `Hi Aasha Furniture, I am interested in ordering ${tmpl.item} for my home in ${cust.customData?.city || 'Coimbatore'}. Could you provide the quotation, expected lead time, and customization options? Thanks, ${cust.name}`,
          summary: `Interested in ${tmpl.item}. Estimated budget ₹${tmpl.price.toLocaleString('en-IN')}`,
          structuredData: {
            productCategory: tmpl.cat,
            item: tmpl.item,
            estimatedPrice: tmpl.price,
            productionDays: tmpl.days
          },
          confidence: 'HIGH',
          createdAt,
          updatedAt: createdAt
        }
      });
    }
    console.log(`✓ Seeded ${toCreate} enquiries (Total in DB: 60).`);
  } else {
    console.log(`✓ 60 Enquiries already present.`);
  }

  // 4. Seed 10 Authoritative Orders & Quotations
  console.log('\n[4/6] Restoring 10 Authoritative Orders and Quotations...');
  const orders: any[] = [];
  const orderConfigs = [
    { num: 'AF-ORD-001', custIdx: 0, item: 'Classic Teak 3-Seater Sofa (SOF-001)', qty: 1, base: 42000, status: 'DELIVERED', daysAgo: 22 },
    { num: 'AF-ORD-002', custIdx: 1, item: '3-Door Teak Wardrobe (WAR-001)', qty: 2, base: 56000, status: 'DELIVERED', daysAgo: 20 },
    { num: 'AF-ORD-003', custIdx: 2, item: '6-Seater Solid Oak Dining Suite (DIN-001)', qty: 1, base: 65000, status: 'DELIVERED', daysAgo: 18 },
    { num: 'AF-ORD-004', custIdx: 3, item: 'King Size Teak Bed with Hydraulic Storage', qty: 1, base: 58000, status: 'DELIVERED', daysAgo: 16 },
    { num: 'AF-ORD-005', custIdx: 4, item: 'L-Shaped Modular Fabric Sectional Sofa', qty: 1, base: 48000, status: 'DELIVERED', daysAgo: 14 },
    { num: 'AF-ORD-006', custIdx: 5, item: 'Custom Ergonomic Solid Sheesham Study Desk', qty: 2, base: 48000, status: 'CONFIRMED', daysAgo: 12 },
    { num: 'AF-ORD-007', custIdx: 6, item: 'Modern Minimalist TV Console & Wall Unit', qty: 1, base: 32000, status: 'CONFIRMED', daysAgo: 10 },
    { num: 'AF-ORD-008', custIdx: 7, item: '8-Seater Premium Teak Dining Table', qty: 1, base: 88000, status: 'CONFIRMED', daysAgo: 8 },
    { num: 'AF-ORD-009', custIdx: 8, item: '4-Door Modular Engineered Wood Wardrobe', qty: 2, base: 76000, status: 'PROCESSING', daysAgo: 5 },
    { num: 'AF-ORD-010', custIdx: 9, item: 'Luxury Accent Lounge Chair Suite (Pair)', qty: 2, base: 44000, status: 'CONFIRMED', daysAgo: 2 }
  ];

  for (const oConf of orderConfigs) {
    const cust = customers[oConf.custIdx];
    const subtotal = oConf.base;
    const tax = Math.round(subtotal * 0.18 * 100) / 100;
    const totalAmount = subtotal + tax;
    const createdAt = new Date(Date.now() - oConf.daysAgo * 86400000);

    let order = await prisma.order.findUnique({
      where: {
        businessId_orderNumber: {
          businessId: BUSINESS_ID,
          orderNumber: oConf.num
        }
      }
    });

    if (!order) {
      order = await prisma.order.create({
        data: {
          businessId: BUSINESS_ID,
          customerId: cust.id,
          orderNumber: oConf.num,
          status: oConf.status,
          source: 'DIRECT',
          currency: 'INR',
          subtotal,
          tax,
          discount: 0,
          totalAmount,
          priority: oConf.custIdx < 3 ? 'HIGH' : 'NORMAL',
          priorityScore: oConf.custIdx < 3 ? 85 : 50,
          paymentStatus: oConf.custIdx < 6 ? 'PAID' : oConf.custIdx < 8 ? 'PARTIALLY_PAID' : 'UNPAID',
          amountPaid: oConf.custIdx < 6 ? totalAmount : oConf.custIdx < 8 ? Math.round(totalAmount * 0.5) : 0,
          outstandingAmount: oConf.custIdx < 6 ? 0 : oConf.custIdx < 8 ? Math.round(totalAmount * 0.5) : totalAmount,
          lineItems: [
            {
              description: oConf.item,
              quantity: oConf.qty,
              unitPrice: subtotal / oConf.qty,
              amount: subtotal
            }
          ],
          createdAt,
          updatedAt: createdAt
        }
      });

      // Also create quotation corresponding to order
      const quoNum = `AF-QUO-${oConf.num.replace(/^AF-ORD-/, '')}`;
      await prisma.quotation.upsert({
        where: { businessId_quotationNumber: { businessId: BUSINESS_ID, quotationNumber: quoNum } },
        create: {
          businessId: BUSINESS_ID,
          customerId: cust.id,
          orderId: order.id,
          quotationNumber: quoNum,
          status: 'ACCEPTED',
          currency: 'INR',
          subtotal,
          taxAmount: tax,
          discountAmount: 0,
          totalAmount,
          lineItems: [
            {
              description: oConf.item,
              quantity: oConf.qty,
              unitPrice: subtotal / oConf.qty,
              amount: subtotal
            }
          ],
          createdAt,
          updatedAt: createdAt
        },
        update: {}
      });
    }
    orders.push(order);
  }
  console.log(`✓ 10 Authoritative Orders & Accepted Quotations restored.`);

  // 5. Run Full Finance Centre Seeding
  console.log('\n[5/6] Restoring Invoices, Payments, Chart of Accounts, Bank Feeds, and Reconciliations...');

  // Standard accounts
  const seedAccountsRes = await accountService.seedStandardAccounts(BUSINESS_ID);
  console.log(`✓ Seeded Chart of Accounts: ${seedAccountsRes.created} new (${seedAccountsRes.existing} existing)`);

  const bankGlAcc = await accountService.getSystemAccount(BUSINESS_ID, 'CASH_AND_BANK');
  const equityGlAcc = await accountService.getSystemAccount(BUSINESS_ID, 'OWNERS_EQUITY');
  const arGlAcc = await accountService.getSystemAccount(BUSINESS_ID, 'ACCOUNTS_RECEIVABLE');
  const revGlAcc = await accountService.getSystemAccount(BUSINESS_ID, 'OPERATING_REVENUE');
  const taxGlAcc = await accountService.getSystemAccount(BUSINESS_ID, 'TAX_PAYABLE');

  // Promoter Capital Infusion ₹10,00,000
  const initialCapIdempotency = `init-capital-${BUSINESS_ID}`;
  const existingCap = await prisma.journalEntry.findUnique({
    where: { businessId_idempotencyKey: { businessId: BUSINESS_ID, idempotencyKey: initialCapIdempotency } }
  });

  if (!existingCap) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    await ledgerService.createJournalEntry(
      BUSINESS_ID,
      {
        postingDate: thirtyDaysAgo,
        memo: 'Promoter equity capital infusion into Operating Bank Account',
        sourceType: 'MANUAL_JOURNAL',
        idempotencyKey: initialCapIdempotency,
        lines: [
          { accountId: bankGlAcc.id, debit: 1000000, credit: 0, description: 'Capital deposit into HDFC Operating Bank A/C' },
          { accountId: equityGlAcc.id, debit: 0, credit: 1000000, description: "Promoter Owner's Equity Capital" }
        ],
        autoPost: true
      }
    );
    console.log('✓ Posted Initial Equity Capital: ₹10,00,000');
  }

  // Generate Invoices & Payments for the 10 orders
  let invoicesCreated = 0;
  let paymentsCreated = 0;

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const customer = customers[i % customers.length];
    const invoiceNumber = `INV-${order.orderNumber.replace(/^AF-ORD-/, '')}`;
    const totalAmount = Number(order.totalAmount);
    const subtotal = Number(order.subtotal);
    const taxAmount = Number(order.tax);

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

    let invoice = await prisma.invoice.findUnique({
      where: { businessId_invoiceNumber: { businessId: BUSINESS_ID, invoiceNumber } }
    });

    if (!invoice) {
      invoice = await prisma.invoice.create({
        data: {
          businessId: BUSINESS_ID,
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
          lineItems: order.lineItems || []
        }
      });
      invoicesCreated++;
    }

    // Create Payment if paidAmount > 0
    if (paidAmount > 0) {
      const existingPay = await prisma.payment.findFirst({
        where: { invoiceId: invoice.id, businessId: BUSINESS_ID }
      });

      if (!existingPay) {
        const paymentDate = new Date(invoiceDate.getTime() + 86400000);
        await prisma.payment.create({
          data: {
            businessId: BUSINESS_ID,
            invoiceId: invoice.id,
            customerId: customer.id,
            orderId: order.id,
            provider: i % 2 === 0 ? 'RAZORPAY' : 'BANK_TRANSFER',
            providerPaymentId: `pay_rzp_${crypto.randomBytes(6).toString('hex')}`,
            amount: paidAmount,
            currency: 'INR',
            status: 'SUCCEEDED',
            paidAt: paymentDate,
            metadata: { fee: i % 2 === 0 ? Math.round(paidAmount * 0.02) : 0 }
          }
        });
        paymentsCreated++;
      }
    }
  }

  // Two Custom Booking Invoices
  const sampleCustomer = customers[0];
  const bInv1Num = 'INV-BOOKING-001';
  let bInv1 = await prisma.invoice.findUnique({
    where: { businessId_invoiceNumber: { businessId: BUSINESS_ID, invoiceNumber: bInv1Num } }
  });
  if (!bInv1) {
    const bTotal = 145000;
    const bTax = Math.round((bTotal * 0.18 / 1.18) * 100) / 100;
    const bSub = bTotal - bTax;
    bInv1 = await prisma.invoice.create({
      data: {
        businessId: BUSINESS_ID,
        customerId: sampleCustomer.id,
        invoiceNumber: bInv1Num,
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
        lineItems: [{ description: 'Custom Handcrafted Solid Oak 10-Seater Dining Suite Booking', quantity: 1, unitPrice: bSub, amount: bSub }]
      }
    });
    await prisma.payment.create({
      data: {
        businessId: BUSINESS_ID,
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
    invoicesCreated++;
    paymentsCreated++;
  }

  console.log(`✓ Restored Invoices (${invoicesCreated} newly created) & Payments (${paymentsCreated} newly created).`);

  // Sync Subledger to General Ledger
  console.log('\n[6/6] Synchronizing Subledger to General Ledger and Bank Reconciliation...');
  const syncResult = await ledgerSyncService.batchSyncOperationalRecords(BUSINESS_ID);
  console.log(`✓ Ledger Synchronized: ${syncResult.invoicesSynced} Invoices, ${syncResult.paymentsSynced} Payments posted to GL`);

  // Bank Feed & Auto-Reconcile
  let bankFeed = await prisma.bankFeedAccount.findUnique({
    where: { accountId: bankGlAcc.id }
  });

  if (!bankFeed) {
    bankFeed = await bankReconciliationService.createBankFeedAccount(BUSINESS_ID, {
      accountId: bankGlAcc.id,
      institutionName: 'HDFC Bank Corporate Current A/C',
      accountNumberMask: '•••• 7824',
      currency: 'INR'
    });
    console.log('✓ Created Bank Feed Account: HDFC Bank Corporate Current A/C (•••• 7824)');
  }

  const bankStatementLines = [
    {
      transactionDate: new Date(Date.now() - 30 * 86400000),
      amount: '1000000.00',
      description: 'CHQ/DEP/PROMOTER CAPITAL INFUSION/00192',
      referenceNumber: 'CAP-001'
    },
    {
      transactionDate: new Date(Date.now() - 21 * 86400000),
      amount: '41160.00',
      description: 'RAZORPAY PAYOUT BATCH 88219 - INV-001',
      referenceNumber: 'AF-ORD-001'
    },
    {
      transactionDate: new Date(Date.now() - 20 * 86400000),
      amount: '54880.00',
      description: 'RAZORPAY PAYOUT BATCH 88220 - INV-002',
      referenceNumber: 'AF-ORD-002'
    },
    {
      transactionDate: new Date(Date.now() - 19 * 86400000),
      amount: '76700.00',
      description: 'NEFT CR-DINING SUITE PAYMENT INV-003',
      referenceNumber: 'AF-ORD-003'
    },
    {
      transactionDate: new Date(Date.now() - 14 * 86400000),
      amount: '142100.00',
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
    {
      transactionDate: new Date(Date.now() - 5 * 86400000),
      amount: '45000.00',
      description: 'IMPS CR-ADVANCE BOOKING INV-BOOKING-002',
      referenceNumber: 'INV-BOOKING-002'
    }
  ];

  const ingestRes = await bankReconciliationService.ingestTransactions(
    BUSINESS_ID,
    bankFeed.id,
    bankStatementLines
  );
  console.log(`✓ Ingested ${ingestRes.inserted} bank statement lines into HDFC Feed`);

  const autoReconcileRes = await bankReconciliationService.autoReconcile(
    BUSINESS_ID,
    bankFeed.id,
    85
  );
  console.log(`✓ Auto-reconciliation executed: ${autoReconcileRes.matchedCount} transactions matched, ${autoReconcileRes.unmatchedCount} pending in queue`);

  const trialBalance = await ledgerService.getTrialBalance(BUSINESS_ID);
  console.log(`✓ Trial Balance Status: IsBalanced = ${trialBalance.isBalanced}, Total Debit = ₹${trialBalance.totalDebit.toLocaleString('en-IN')}, Total Credit = ₹${trialBalance.totalCredit.toLocaleString('en-IN')}`);

  console.log('\n========================================================================');
  console.log('   FULL RESTORATION COMPLETED SUCCESSFULLY!');
  console.log('========================================================================\n');
}

main()
  .catch((e) => {
    console.error('Fatal restoration error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
