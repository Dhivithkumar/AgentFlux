/**
 * PRODUCTION-GRADE TEST SUITE:
 * ORDERS INTELLIGENCE & VENDOR VERIFICATION SYSTEM
 *
 * Verifies against live PostgreSQL:
 * 1. Manual Order Creation with Line Items, Taxes, and Idempotency
 * 2. Duplicate Submission Prevention (Idempotency Key)
 * 3. Priority Scoring & Explainability (High Value != Trust, Overdue Prioritization)
 * 4. Customer Payment Score 0-100 Algorithm & Insufficient History Handling
 * 5. Customer Balance Calculation & Subledger-to-GL AR 1200 Reconciliation
 * 6. Automated Vendor Verification Suite (SSRF Protection & Tax Syntax)
 * 7. Vendor Manual Compliance Review Override & Audit Logging
 * 8. Strict Multi-Tenant Isolation
 */

import '../env';
import { prisma } from '@agent-flux/database';
import { orderService } from '../services/order/OrderService';
import { orderPriorityService } from '../services/order/OrderPriorityService';
import { customerPaymentScoreService } from '../services/customer/CustomerPaymentScoreService';
import { customerBalanceService } from '../services/finance/CustomerBalanceService';
import { vendorVerificationService } from '../services/vendor/VendorVerificationService';
import assert from 'assert';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details?: string, error?: string) {
  results.push({ name, passed, details, error });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (details) console.log(`   Details: ${details}`);
  if (error) console.error(`   Error: ${error}`);
}

async function runTestSuite() {
  console.log('========================================================================');
  console.log('AGENT FLUX V2 — ORDERS INTELLIGENCE & VENDOR VERIFICATION TEST SUITE');
  console.log('========================================================================\n');

  const timestamp = Date.now();
  const testBiz1Id = `biz-intel-1-${timestamp}`;
  const testBiz2Id = `biz-intel-2-${timestamp}`;
  const testUserId = `user-intel-${timestamp}`;

  try {
    // -------------------------------------------------------------
    // SETUP: Create isolated test tenants
    // -------------------------------------------------------------
    await prisma.user.create({
      data: {
        id: testUserId,
        name: 'Enterprise Test Admin',
        email: `admin-${timestamp}@example.com`,
        passwordHash: 'hashed_pw_test'
      }
    });

    await prisma.business.create({
      data: {
        id: testBiz1Id,
        name: 'Nexus Industrial Corp',
        industry: 'MANUFACTURING',
        currency: 'INR'
      }
    });

    await prisma.membership.create({
      data: {
        userId: testUserId,
        businessId: testBiz1Id,
        role: 'OWNER'
      }
    });

    await prisma.business.create({
      data: {
        id: testBiz2Id,
        name: 'Competitor Corp (Tenant 2)',
        industry: 'RETAIL',
        currency: 'INR'
      }
    });

    await prisma.membership.create({
      data: {
        userId: testUserId,
        businessId: testBiz2Id,
        role: 'OWNER'
      }
    });

    // Create a customer with credit limit in Tenant 1
    const customerA = await prisma.customer.create({
      data: {
        businessId: testBiz1Id,
        name: 'Alpha Fabrications Ltd',
        email: `alpha-${timestamp}@fabrications.com`,
        phone: '+91 98765 00001',
        creditLimit: 100000 // 1 Lakh credit limit
      }
    });

    // -------------------------------------------------------------
    // TEST 1: Manual Order Creation with Line Items and Math
    // -------------------------------------------------------------
    try {
      const order = await orderService.createManualOrder({
        businessId: testBiz1Id,
        customerId: customerA.id,
        items: [
          { productName: 'Precision Steel Rod', quantity: 10, unitPrice: 2000, discount: 500, taxRate: 18 },
          { productName: 'Hydraulic Coupler', quantity: 5, unitPrice: 4000, discount: 0, taxRate: 18 }
        ],
        amountPaid: 10000, // ₹10,000 advance partial payment
        paymentTerms: 'NET_30',
        notes: 'Priority industrial delivery'
      });

      // Item 1: (10 * 2000) - 500 = 19500; Tax 18% = 3510; Total = 23010
      // Item 2: (5 * 4000) = 20000; Tax 18% = 3600; Total = 23600
      // Total Amount = 46610; Paid = 10000; Outstanding = 36610
      assert.strictEqual(order.totalAmount, 46610, 'Order total must match item subtotal + tax');
      assert.strictEqual(order.amountPaid, 10000, 'Paid amount must match advance payment');
      assert.strictEqual(order.outstandingAmount, 36610, 'Outstanding must be total minus paid');
      assert.strictEqual(order.paymentStatus, 'PARTIALLY_PAID', 'Payment status must be PARTIALLY_PAID');
      assert.ok(order.orderNumber.startsWith('ORD-'), 'Order number must be auto-generated with ORD- prefix');
      assert.ok(order.priority, 'Order must have calculated priority');

      record('1. Manual Order Creation with Line Items & Math', true,
        `Order ${order.orderNumber}: Total ₹${order.totalAmount}, Paid ₹${order.amountPaid}, Outstanding ₹${order.outstandingAmount}, Status: ${order.paymentStatus}`);
    } catch (e: any) {
      record('1. Manual Order Creation with Line Items & Math', false, undefined, e.message);
    }

    // -------------------------------------------------------------
    // TEST 2: Idempotency & Duplicate Submission Prevention
    // -------------------------------------------------------------
    try {
      const idempotencyKey = `idemp-key-${timestamp}-unique`;

      const orderFirst = await orderService.createManualOrder({
        businessId: testBiz1Id,
        customerId: customerA.id,
        items: [{ productName: 'Titanium Fasteners', quantity: 100, unitPrice: 150 }],
        idempotencyKey
      });

      const orderDuplicate = await orderService.createManualOrder({
        businessId: testBiz1Id,
        customerId: customerA.id,
        items: [{ productName: 'Titanium Fasteners', quantity: 100, unitPrice: 150 }],
        idempotencyKey
      });

      assert.strictEqual(orderFirst.id, orderDuplicate.id, 'Idempotent call must return existing order ID');
      assert.strictEqual(orderFirst.orderNumber, orderDuplicate.orderNumber, 'Order numbers must match');

      const count = await prisma.order.count({ where: { businessId: testBiz1Id, idempotencyKey } });
      assert.strictEqual(count, 1, 'Only exactly 1 order record must exist in database');

      record('2. Idempotency & Duplicate Submission Prevention', true,
        `Duplicate submission safely deduplicated. Returned Order ID: ${orderFirst.id}`);
    } catch (e: any) {
      record('2. Idempotency & Duplicate Submission Prevention', false, undefined, e.message);
    }

    // -------------------------------------------------------------
    // TEST 3: Customer Payment Scoring (Insufficient History vs Strong)
    // -------------------------------------------------------------
    try {
      // Step 3a: New customer with 0 invoices must be INSUFFICIENT_HISTORY
      const scoreNew = await customerPaymentScoreService.calculateAndSave(customerA.id, testBiz1Id);
      assert.strictEqual(scoreNew.category, 'INSUFFICIENT_HISTORY', 'New customer with <2 invoices must be INSUFFICIENT_HISTORY');
      assert.strictEqual(scoreNew.score, null, 'Score must be null when history is insufficient');

      // Step 3b: Seed 3 on-time fully paid invoices for a seasoned customer
      const customerSeasoned = await prisma.customer.create({
        data: {
          businessId: testBiz1Id,
          name: 'Apex Precision Engineering',
          email: `apex-${timestamp}@example.com`,
          phone: '+91 98765 00002',
          creditLimit: 500000
        }
      });

      const pastDate1 = new Date(Date.now() - 40 * 86400000);
      const pastDate2 = new Date(Date.now() - 20 * 86400000);

      // Invoice 1: Fully paid on time
      await prisma.invoice.create({
        data: {
          businessId: testBiz1Id,
          customerId: customerSeasoned.id,
          invoiceNumber: `INV-TEST-1-${timestamp}`,
          totalAmount: 50000,
          paidAmount: 50000,
          outstandingAmount: 0,
          status: 'PAID',
          lineItems: [{ description: 'Test Item', amount: 50000 }],
          invoiceDate: pastDate1,
          dueDate: new Date(pastDate1.getTime() + 15 * 86400000)
        }
      });

      // Invoice 2: Fully paid on time
      await prisma.invoice.create({
        data: {
          businessId: testBiz1Id,
          customerId: customerSeasoned.id,
          invoiceNumber: `INV-TEST-2-${timestamp}`,
          totalAmount: 75000,
          paidAmount: 75000,
          outstandingAmount: 0,
          status: 'PAID',
          lineItems: [{ description: 'Test Item 2', amount: 75000 }],
          invoiceDate: pastDate2,
          dueDate: new Date(pastDate2.getTime() + 15 * 86400000)
        }
      });

      const scoreSeasoned = await customerPaymentScoreService.calculateAndSave(customerSeasoned.id, testBiz1Id);
      assert.ok(scoreSeasoned.score !== null && scoreSeasoned.score >= 80, `Seasoned customer score should be >= 80, got ${scoreSeasoned.score}`);
      assert.strictEqual(scoreSeasoned.category, 'STRONG', 'Category must be STRONG');

      record('3. Customer Payment Scoring Algorithm & Insufficient History', true,
        `New customer: ${scoreNew.category}. Seasoned customer: ${scoreSeasoned.score}/100 (${scoreSeasoned.category})`);
    } catch (e: any) {
      record('3. Customer Payment Scoring Algorithm & Insufficient History', false, undefined, e.message);
    }

    // -------------------------------------------------------------
    // TEST 4: Priority Scoring (High Value != Trust, Overdue Prioritized)
    // -------------------------------------------------------------
    try {
      // Step 4a: Create a high-value order for a customer with heavy overdue balance
      const customerOverdue = await prisma.customer.create({
        data: {
          businessId: testBiz1Id,
          name: 'Risky Debtor Corp',
          email: `risk-${timestamp}@debt.com`,
          creditLimit: 50000,
          overdueBalance: 80000 // Overdue exceeds limit
        }
      });

      // Also create an overdue invoice for them
      await prisma.invoice.create({
        data: {
          businessId: testBiz1Id,
          customerId: customerOverdue.id,
          invoiceNumber: `INV-OVERDUE-${timestamp}`,
          totalAmount: 80000,
          paidAmount: 0,
          outstandingAmount: 80000,
          status: 'OVERDUE',
          lineItems: [{ description: 'Overdue Goods', amount: 80000 }],
          invoiceDate: new Date(Date.now() - 60 * 86400000),
          dueDate: new Date(Date.now() - 30 * 86400000) // 30 days overdue
        }
      });

      // Even a small ₹2,000 order must be flagged as CRITICAL due to overdue debt exposure
      const smallOrderRisky = await orderService.createManualOrder({
        businessId: testBiz1Id,
        customerId: customerOverdue.id,
        items: [{ productName: 'Minor Consumable', quantity: 2, unitPrice: 1000 }]
      });

      assert.strictEqual(smallOrderRisky.priority, 'CRITICAL', 'Order for customer with severe overdue must be CRITICAL even if small');
      assert.ok(smallOrderRisky.priorityReason.includes('Overdue') || smallOrderRisky.priorityReason.includes('debt'),
        `Priority reason must explain overdue factor. Got: "${smallOrderRisky.priorityReason}"`);

      // Step 4b: New customer with a huge order (e.g. ₹6,00,000) should be HIGH or CRITICAL, but NOT marked as trusted
      const bigOrderNewCust = await orderService.createManualOrder({
        businessId: testBiz1Id,
        customerId: customerA.id,
        items: [{ productName: 'Heavy Machinery Unit', quantity: 1, unitPrice: 500000, taxRate: 18 }]
      });

      assert.ok(bigOrderNewCust.priority === 'HIGH' || bigOrderNewCust.priority === 'CRITICAL',
        `Big order must receive elevated priority (${bigOrderNewCust.priority})`);
      assert.ok(!(bigOrderNewCust.priorityFactors as any)?.includes('TRUSTED_CUSTOMER_HISTORY'),
        'High order value alone must NEVER grant TRUSTED_CUSTOMER_HISTORY factor');

      record('4. Priority Intelligence (High Value != Trust, Overdue Escalated)', true,
        `Risky customer order priority: ${smallOrderRisky.priority} ("${smallOrderRisky.priorityReason}"). Big order priority: ${bigOrderNewCust.priority}`);
    } catch (e: any) {
      record('4. Priority Intelligence (High Value != Trust, Overdue Escalated)', false, undefined, e.message);
    }

    // -------------------------------------------------------------
    // TEST 5: Customer Outstanding Balance & Subledger Reconciliation
    // -------------------------------------------------------------
    try {
      const summary = await customerBalanceService.getCustomerFinancialSummary(customerA.id, testBiz1Id);

      assert.ok(summary.totalOutstanding >= 0, 'Total outstanding must be non-negative');
      assert.ok(summary.availableCredit !== undefined, 'Available credit must be calculated');
      assert.strictEqual(summary.tenantId, testBiz1Id, 'Tenant boundary must match');
      assert.ok(summary.reconciliationStatus === 'RECONCILED' || summary.reconciliationStatus === 'SUBLEDGER_VERIFIED',
        `Reconciliation must be verified, got ${summary.reconciliationStatus}`);

      record('5. Customer Balance & Financial Reconciliation', true,
        `Total Outstanding: ₹${summary.totalOutstanding}, Overdue: ₹${summary.overdueBalance}, Status: ${summary.reconciliationStatus}`);
    } catch (e: any) {
      record('5. Customer Balance & Financial Reconciliation', false, undefined, e.message);
    }

    // -------------------------------------------------------------
    // TEST 6: Automated Vendor Verification Suite & SSRF Protection
    // -------------------------------------------------------------
    try {
      // Step 6a: Statutory GSTIN Validation
      const validGstinResult = vendorVerificationService.validateTaxId('29ABCDE1234F1Z5', 'GSTIN');
      assert.strictEqual(validGstinResult.valid, true, 'Valid Indian GSTIN must pass regex check');

      const invalidGstinResult = vendorVerificationService.validateTaxId('INVALID_GSTIN_123', 'GSTIN');
      assert.strictEqual(invalidGstinResult.valid, false, 'Malformed GSTIN must be rejected');

      // Step 6b: SSRF URL Protection
      // Loopback IP
      const loopbackCheck = await vendorVerificationService.verifyWebsite('http://127.0.0.1:8080/admin');
      assert.strictEqual(loopbackCheck.reachable, false, '127.0.0.1 must be blocked by SSRF protection');
      assert.ok(loopbackCheck.details.includes('SSRF blocked'), 'Must report SSRF blocked for loopback');

      // AWS link-local metadata
      const awsMetaCheck = await vendorVerificationService.verifyWebsite('http://169.254.169.254/latest/meta-data');
      assert.strictEqual(awsMetaCheck.reachable, false, '169.254.169.254 must be blocked by SSRF protection');

      // Private 10.x.x.x
      const privateCheck = await vendorVerificationService.verifyWebsite('http://10.0.0.1/internal');
      assert.strictEqual(privateCheck.reachable, false, '10.0.0.1 must be blocked by SSRF protection');

      // Localhost
      const localhostCheck = await vendorVerificationService.verifyWebsite('http://localhost:3000');
      assert.strictEqual(localhostCheck.reachable, false, 'Localhost domain must be blocked by SSRF protection');

      // Step 6c: End-to-end Vendor Verification Pipeline Run
      const testVendor = await prisma.vendor.create({
        data: {
          businessId: testBiz1Id,
          name: 'Pinnacle Industrial Valves',
          legalName: 'Pinnacle Valves Private Limited',
          taxId: '29ABCDE1234F1Z5', // Valid GSTIN
          website: 'https://example.com',
          email: 'sales@example.com',
          verificationStatus: 'PENDING_VERIFICATION'
        }
      });

      const verificationOutcome = await vendorVerificationService.verifyVendor(testVendor.id, testBiz1Id);
      assert.ok(['VERIFIED', 'PARTIALLY_VERIFIED'].includes(verificationOutcome.status),
        `Status must be VERIFIED or PARTIALLY_VERIFIED, got ${verificationOutcome.status}`);

      // Verify log was persisted
      const logs = await prisma.vendorVerificationLog.findMany({
        where: { vendorId: testVendor.id, businessId: testBiz1Id }
      });
      assert.ok(logs.length >= 1, 'Audit log must be recorded in VendorVerificationLog');

      record('6. Automated Vendor Verification & SSRF Protections', true,
        `SSRF checks verified (127.0.0.1, 169.254.169.254, 10.0.0.1 blocked). Vendor outcome: ${verificationOutcome.status}`);
    } catch (e: any) {
      record('6. Automated Vendor Verification & SSRF Protections', false, undefined, e.message);
    }

    // -------------------------------------------------------------
    // TEST 7: Vendor Manual Compliance Review Override
    // -------------------------------------------------------------
    try {
      const vendorForReview = await prisma.vendor.create({
        data: {
          businessId: testBiz1Id,
          name: 'Global Metals Trading',
          verificationStatus: 'MANUAL_REVIEW_REQUIRED',
          failureReason: 'Pending offline registration certificate inspection'
        }
      });

      const updated = await vendorVerificationService.manualReview(
        vendorForReview.id,
        testBiz1Id,
        testUserId,
        'VERIFIED',
        'Physical GST certificate inspected and verified against MCA registry offline.'
      );

      assert.strictEqual(updated.verificationStatus, 'VERIFIED', 'Manual review must transition status to VERIFIED');
      assert.strictEqual(updated.verificationMethod, 'MANUAL_REVIEW', 'Method must be MANUAL_REVIEW');

      // Verify audit log
      const logs = await prisma.vendorVerificationLog.findMany({
        where: { vendorId: vendorForReview.id, method: 'MANUAL_REVIEW' }
      });
      assert.strictEqual(logs.length, 1, 'Manual review audit log must be created');
      assert.strictEqual(logs[0].performedById, testUserId, 'Auditor user ID must match reviewer');

      record('7. Vendor Manual Compliance Review Override & Audit Trail', true,
        `Status successfully transitioned to ${updated.verificationStatus} with audit entry by user ${testUserId}`);
    } catch (e: any) {
      record('7. Vendor Manual Compliance Review Override & Audit Trail', false, undefined, e.message);
    }

    // -------------------------------------------------------------
    // TEST 8: Strict Multi-Tenant Isolation
    // -------------------------------------------------------------
    try {
      // Create order in Tenant 1
      const orderTenant1 = await orderService.createManualOrder({
        businessId: testBiz1Id,
        customerId: customerA.id,
        items: [{ productName: 'Secure Asset', quantity: 1, unitPrice: 5000 }]
      });

      // Tenant 2 attempts to query Tenant 1 order
      const tenant2Orders = await orderService.getOrders(testBiz2Id);
      const leakedOrder = tenant2Orders.find(o => o.id === orderTenant1.id);
      assert.strictEqual(leakedOrder, undefined, 'Tenant 2 MUST NOT see Tenant 1 order in list');

      // Tenant 2 attempts to get order by ID
      const directFetch = await orderService.getOrder(orderTenant1.id, testBiz2Id);
      assert.strictEqual(directFetch, null, 'Tenant 2 MUST NOT be able to fetch Tenant 1 order by ID');

      // Tenant 2 attempts to recalculate priority on Tenant 1 order
      let crossTenantRecalcFailed = false;
      try {
        await orderPriorityService.evaluateAndSave(orderTenant1.id, testBiz2Id);
      } catch (err: any) {
        crossTenantRecalcFailed = true;
      }
      assert.strictEqual(crossTenantRecalcFailed, true, 'Cross-tenant priority recalculation must throw authorization error');

      record('8. Strict Multi-Tenant Isolation', true,
        'Tenant boundary strictly enforced across queries, direct fetches, and mutations.');
    } catch (e: any) {
      record('8. Strict Multi-Tenant Isolation', false, undefined, e.message);
    }

  } catch (globalErr: any) {
    console.error('Fatal Test Suite Error:', globalErr);
  } finally {
    // -------------------------------------------------------------
    // CLEANUP: Clean up test records
    // -------------------------------------------------------------
    try {
      await prisma.vendorVerificationLog.deleteMany({ where: { businessId: { in: [testBiz1Id, testBiz2Id] } } });
      await prisma.vendor.deleteMany({ where: { businessId: { in: [testBiz1Id, testBiz2Id] } } });
      await prisma.order.deleteMany({ where: { businessId: { in: [testBiz1Id, testBiz2Id] } } });
      await prisma.invoice.deleteMany({ where: { businessId: { in: [testBiz1Id, testBiz2Id] } } });
      await prisma.customer.deleteMany({ where: { businessId: { in: [testBiz1Id, testBiz2Id] } } });
      await prisma.membership.deleteMany({ where: { businessId: { in: [testBiz1Id, testBiz2Id] } } });
      await prisma.business.deleteMany({ where: { id: { in: [testBiz1Id, testBiz2Id] } } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }

    console.log('\n========================================================================');
    console.log('TEST SUMMARY');
    console.log('========================================================================');
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;
    console.log(`Total Tests : ${total}`);
    console.log(`Passed      : ${passed} ✅`);
    console.log(`Failed      : ${failed} ${failed > 0 ? '❌' : ''}`);

    if (failed > 0) {
      console.error('\nFAILED TESTS:');
      results.filter(r => !r.passed).forEach(r => {
        console.error(`- ${r.name}: ${r.error}`);
      });
      process.exit(1);
    } else {
      console.log('\nALL TESTS PASSED WITH ZERO ERRORS.\n');
      process.exit(0);
    }
  }
}

runTestSuite();
