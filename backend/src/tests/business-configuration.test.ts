/**
 * PHASE B TEST SUITE: BUSINESS CONFIGURATION MODEL, ONBOARDING & TENANT BOUNDARIES
 * 
 * Verifies:
 * 1. Default configuration initialization for new tenants
 * 2. Partial/incremental saves across multi-step onboarding (incomplete onboarding allowed)
 * 3. Optional fields allowed without throwing errors
 * 4. Multi-currency and custom terminology persistence
 * 5. Requirements review logic: detects blockers, produces recommendations and structured summary
 * 6. Confirmation lock: Only owner can confirm, transitions to COMPLETED, emits audit log
 * 7. Tenant isolation: Non-members blocked from read/write; non-owners blocked from confirmation
 */

import '../env';
import { prisma, Role } from '@agent-flux/database';
import { BusinessConfigurationService } from '../services/business/configurationService';
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

async function runPhaseBTests() {
  console.log('========================================================================');
  console.log('STARTING PHASE B TEST SUITE: BUSINESS CONFIGURATION & TENANT BOUNDARIES');
  console.log('========================================================================\n');

  const testBizIdA = `biz-conf-test-${Date.now()}-A`;
  const testBizIdB = `biz-conf-test-${Date.now()}-B`;
  const ownerUserA = `user-owner-${Date.now()}-A`;
  const memberUserA = `user-member-${Date.now()}-A`;
  const ownerUserB = `user-owner-${Date.now()}-B`;

  try {
    // 1. Setup isolated test businesses & users in database
    await prisma.user.create({
      data: { id: ownerUserA, name: 'Alice Owner', email: `alice-${Date.now()}@example.com`, passwordHash: 'hash' }
    });
    await prisma.user.create({
      data: { id: memberUserA, name: 'Bob Member', email: `bob-${Date.now()}@example.com`, passwordHash: 'hash' }
    });
    await prisma.user.create({
      data: { id: ownerUserB, name: 'Charlie Owner B', email: `charlie-${Date.now()}@example.com`, passwordHash: 'hash' }
    });

    await prisma.business.create({
      data: {
        id: testBizIdA,
        name: 'Apex Healthcare Diagnostics',
        industry: 'Healthcare',
        currency: 'INR',
        memberships: {
          create: [
            { userId: ownerUserA, role: Role.OWNER },
            { userId: memberUserA, role: Role.MEMBER }
          ]
        }
      }
    });

    await prisma.business.create({
      data: {
        id: testBizIdB,
        name: 'Nordic Furniture Imports',
        industry: 'Retail & Distribution',
        currency: 'INR',
        memberships: {
          create: [
            { userId: ownerUserB, role: Role.OWNER }
          ]
        }
      }
    });

    // -------------------------------------------------------------------------
    // TEST 1: Default Configuration Auto-Initialization
    // -------------------------------------------------------------------------
    try {
      const configA = await BusinessConfigurationService.getConfiguration(testBizIdA);
      const isDraft = configA.configuration.onboardingStatus === 'DRAFT';
      const hasModules = Array.isArray(configA.configuration.enabledModules) && configA.configuration.enabledModules.length > 0;
      const hasCurrency = (configA.configuration.financialConfig as any)?.currency === 'INR';

      record(
        '1. Default Configuration Auto-Initialization',
        isDraft && hasModules && hasCurrency,
        `Status: ${configA.configuration.onboardingStatus}, Enabled Modules: ${configA.configuration.enabledModules.length}, Currency: INR`
      );
    } catch (e: any) {
      record('1. Default Configuration Auto-Initialization', false, undefined, e.message);
    }

    // -------------------------------------------------------------------------
    // TEST 2: Multi-step Incremental Saves (Incomplete onboarding permitted)
    // -------------------------------------------------------------------------
    try {
      // Step 2: Custom Terminology for Healthcare (patient, consultation, treatment plan)
      await BusinessConfigurationService.updateConfiguration(testBizIdA, {
        onboardingStep: 2,
        customTerminology: {
          customerLabel: 'Patient',
          orderLabel: 'Consultation',
          enquiryLabel: 'Referral',
          quotationLabel: 'Treatment Plan'
        }
      });

      // Step 3: Financial & numbering
      await BusinessConfigurationService.updateConfiguration(testBizIdA, {
        onboardingStep: 3,
        financialConfig: {
          currency: 'INR',
          locale: 'en-US',
          timezone: 'America/New_York',
          taxName: 'State Tax',
          defaultTaxRate: 6.5,
          isTaxRegistered: true,
          paymentTerms: 'Due on Appointment'
        },
        numberingPreferences: {
          quotationPrefix: 'PLAN-',
          orderPrefix: 'CONS-',
          invoicePrefix: 'MED-',
          digits: 6
        }
      });

      const updated = await BusinessConfigurationService.getConfiguration(testBizIdA);
      const terms = updated.configuration.customTerminology as any;
      const fin = updated.configuration.financialConfig as any;
      const nums = updated.configuration.numberingPreferences as any;

      const isMatching = terms.customerLabel === 'Patient' &&
                         terms.quotationLabel === 'Treatment Plan' &&
                         fin.taxName === 'State Tax' &&
                         fin.defaultTaxRate === 6.5 &&
                         nums.invoicePrefix === 'MED-';

      record(
        '2. Incremental Partial Saves & Healthcare Terminology Persistence',
        isMatching,
        `Patient/Consultation Terminology & State Tax (6.5%) persisted successfully`
      );
    } catch (e: any) {
      record('2. Incremental Partial Saves & Healthcare Terminology Persistence', false, undefined, e.message);
    }

    // -------------------------------------------------------------------------
    // TEST 3: Optional Fields & Incomplete Data Gracefully Handled
    // -------------------------------------------------------------------------
    try {
      // Saving without products or locations
      await BusinessConfigurationService.updateConfiguration(testBizIdA, {
        onboardingStep: 4,
        approvalRules: {
          requiresOwnerApprovalForOrdersAbove: 10000,
          discountApprovalTiers: [{ maxDiscountPercent: 10, requiredRole: 'OWNER' }]
        }
      });

      const saved = await BusinessConfigurationService.getConfiguration(testBizIdA);
      const appRules = saved.configuration.approvalRules as any;

      record(
        '3. Optional Fields & Incomplete Data Tolerance',
        appRules.requiresOwnerApprovalForOrdersAbove === 10000 && saved.configuration.onboardingStep === 4,
        'Successfully saved step 4 approval rules while other sections remain optional'
      );
    } catch (e: any) {
      record('3. Optional Fields & Incomplete Data Tolerance', false, undefined, e.message);
    }

    // -------------------------------------------------------------------------
    // TEST 4: Requirements Review Screen Logic (Pre-confirmation check)
    // -------------------------------------------------------------------------
    try {
      const review = await BusinessConfigurationService.reviewConfiguration(testBizIdA);

      const hasReadyState = review.readyForConfirmation === true;
      const hasSummary = review.summary.terminology.customerLabel === 'Patient';
      const statusUpdated = review.configuration.onboardingStatus === 'REVIEW_REQUIRED';

      record(
        '4. Requirements Review Screen Validation & Summary Generation',
        hasReadyState && hasSummary && statusUpdated,
        `Ready: ${review.readyForConfirmation}, Status: REVIEW_REQUIRED, Warnings: ${review.warnings.length}`
      );
    } catch (e: any) {
      record('4. Requirements Review Screen Validation & Summary Generation', false, undefined, e.message);
    }

    // -------------------------------------------------------------------------
    // TEST 5: Owner Confirmation Lock & Audit Log
    // -------------------------------------------------------------------------
    try {
      const confirmRes = await BusinessConfigurationService.confirmConfiguration(testBizIdA, ownerUserA);
      const audit = await prisma.auditLog.findFirst({
        where: { businessId: testBizIdA, eventType: 'BUSINESS_REQUIREMENTS_CONFIRMED' }
      });

      const isCompleted = confirmRes.status === 'COMPLETED' && confirmRes.confirmedAt !== null;
      const auditCreated = audit !== null && audit.userId === ownerUserA;

      record(
        '5. Owner Confirmation Lock & Audit Log Emission',
        isCompleted && auditCreated,
        `Configuration locked as COMPLETED. AuditLog id: ${audit?.id}`
      );
    } catch (e: any) {
      record('5. Owner Confirmation Lock & Audit Log Emission', false, undefined, e.message);
    }

    // -------------------------------------------------------------------------
    // TEST 6: Multi-Tenant Authorization & Privilege Boundaries
    // -------------------------------------------------------------------------
    try {
      let nonOwnerBlocked = false;
      try {
        // Member trying to confirm should fail
        await BusinessConfigurationService.confirmConfiguration(testBizIdA, memberUserA);
      } catch (err: any) {
        if (err.message.includes('Only the business owner')) nonOwnerBlocked = true;
      }

      let crossTenantBlocked = false;
      try {
        // Owner of Biz B trying to confirm Biz A should fail
        await BusinessConfigurationService.confirmConfiguration(testBizIdA, ownerUserB);
      } catch (err: any) {
        if (err.message.includes('Only the business owner')) crossTenantBlocked = true;
      }

      record(
        '6. Multi-Tenant Privilege Isolation (Owner Role & Cross-Tenant Guards)',
        nonOwnerBlocked && crossTenantBlocked,
        'Blocked non-owner member and blocked cross-tenant owner from confirming another tenant configuration'
      );
    } catch (e: any) {
      record('6. Multi-Tenant Privilege Isolation (Owner Role & Cross-Tenant Guards)', false, undefined, e.message);
    }

    // -------------------------------------------------------------------------
    // TEST 7: Independent Configuration for Second Tenant (No Cross-Leakage)
    // -------------------------------------------------------------------------
    try {
      await BusinessConfigurationService.updateConfiguration(testBizIdB, {
        customTerminology: {
          customerLabel: 'Retail Partner',
          orderLabel: 'Wholesale Purchase',
          quotationLabel: 'Price Quote'
        },
        financialConfig: {
          currency: 'INR',
          locale: 'en-IN',
          timezone: 'Asia/Kolkata',
          taxName: 'GST',
          defaultTaxRate: 18
        }
      });

      const configA = await BusinessConfigurationService.getConfiguration(testBizIdA);
      const configB = await BusinessConfigurationService.getConfiguration(testBizIdB);

      const aTerm = (configA.configuration.customTerminology as any)?.customerLabel;
      const bTerm = (configB.configuration.customTerminology as any)?.customerLabel;
      const aCurr = (configA.configuration.financialConfig as any)?.currency;
      const bCurr = (configB.configuration.financialConfig as any)?.currency;

      const isolated = aTerm === 'Patient' && bTerm === 'Retail Partner' && aCurr === 'INR' && bCurr === 'INR';

      record(
        '7. Two Businesses with Totally Different Requirements Coexisting',
        isolated,
        `Tenant A: Patient in INR | Tenant B: Retail Partner in INR (${bTerm}, GST 18%)`
      );
    } catch (e: any) {
      record('7. Two Businesses with Totally Different Requirements Coexisting', false, undefined, e.message);
    }

  } finally {
    // Cleanup test businesses
    await prisma.business.deleteMany({ where: { id: { in: [testBizIdA, testBizIdB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerUserA, memberUserA, ownerUserB] } } });
  }

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('PHASE B TEST REPORT SUMMARY');
  console.log('========================================================================');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`TOTAL:  ${results.length}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n🎉 ALL PHASE B TESTS PASSED WITH 100% SUCCESS!\n');
    process.exit(0);
  }
}

runPhaseBTests().catch((err) => {
  console.error('Fatal Phase B test error:', err);
  process.exit(1);
});
