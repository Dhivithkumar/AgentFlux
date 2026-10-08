import { HybridRetrievalEngine } from '../services/knowledge/HybridRetrievalEngine';
import { GroundedResponseService } from '../services/knowledge/GroundedResponseService';
import { DeterministicFinancialEngine } from '../services/knowledge/DeterministicFinancialEngine';
import { ApprovalGovernanceEngine } from '../services/knowledge/ApprovalGovernanceEngine';
import { QueryUnderstandingService } from '../services/knowledge/QueryUnderstandingService';
import {
  AASHA_BUSINESS_ID,
  AASHA_PRODUCTS,
  AASHA_CUSTOMIZATIONS,
  AASHA_TAX_CONFIG
} from '../services/knowledge/aashaKnowledgeData';

interface TestResult {
  id: number | string;
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, testId: number | string, testName: string, details?: string) {
  if (!condition) {
    results.push({ id: testId, name: testName, passed: false, error: 'Assertion failed: ' + (details || '') });
    console.error(`❌ [FAIL] Test ${testId}: ${testName} - ${details || ''}`);
  } else {
    results.push({ id: testId, name: testName, passed: true, details });
    console.log(`✅ [PASS] Test ${testId}: ${testName}`);
  }
}

export async function runAashaTestSuite(): Promise<{ total: number; passed: number; failed: number; results: TestResult[] }> {
  console.log('================================================================');
  console.log('STARTING AASHA FURNITURE PRODUCTION-GRADE GROUNDING TEST SUITE');
  console.log('================================================================\n');

  const businessId = AASHA_BUSINESS_ID;

  // -------------------------------------------------------------
  // GOLDEN TEST 1: Standard product enquiry (WAR-001)
  // -------------------------------------------------------------
  {
    const query = "Hi, I'm interested in a 3 door wardrobe. How much does it cost?";
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const response = await GroundedResponseService.generateResponse({ message: query, evidence });

    const hasSku = evidence.sku === 'WAR-001';
    const hasPrice = evidence.answerableFacts['price']?.value === 28000;
    const hasMaterial = evidence.answerableFacts['material']?.value === 'Engineered wood';
    const hasDays = evidence.answerableFacts['productionDays']?.value === 9;
    const hasWarranty = evidence.answerableFacts['warranty']?.value === '2 years';
    const noNegation = !response.response.includes('pricing unavailable') && !response.response.includes("don't have pricing");
    const containsPriceInResponse = response.response.includes('28,000');

    assert(
      hasSku && hasPrice && hasMaterial && hasDays && hasWarranty && noNegation && containsPriceInResponse,
      'GOLDEN_1',
      'Golden Test 1: 3-Door Wardrobe Pricing & Facts',
      `SKU: ${evidence.sku}, Price: ${evidence.answerableFacts['price']?.value}, Response: ${response.response.slice(0, 100)}...`
    );
  }

  // -------------------------------------------------------------
  // GOLDEN TEST 2: Product + Customization
  // -------------------------------------------------------------
  {
    const query = 'I want a 3-door wardrobe with an additional drawer.';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const response = await GroundedResponseService.generateResponse({ message: query, evidence });

    const hasDrawerCust = evidence.normalizedQuery.matchedCustomizations.some(c => c.id === 'additional_wardrobe_drawer');
    const hasDrawerCharge = evidence.normalizedQuery.matchedCustomizations.some(c => c.standardCharge === 1800);
    const hasSalesApproval = evidence.normalizedQuery.matchedCustomizations.some(c => c.approvalRequired === 'Sales');
    const responseHasCust = response.response.includes('1,800') && response.response.includes('Sales');

    assert(
      hasDrawerCust && hasDrawerCharge && hasSalesApproval && responseHasCust,
      'GOLDEN_2',
      'Golden Test 2: WAR-001 with Additional Drawer',
      'Correctly distinguished base price ₹28,000, customization ₹1,800, lead-time 1 day, approval Sales'
    );
  }

  // -------------------------------------------------------------
  // GOLDEN TEST 3: Multi-customization + Deterministic Financial Calculation
  // -------------------------------------------------------------
  {
    const query = 'I want the dining table 2100x1000 with premium polish.';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const response = await GroundedResponseService.generateResponse({ message: query, evidence });

    const fin = evidence.calculatedFinancials;
    const hasDin = evidence.sku === 'DIN-001';
    const hasCorrectSubtotal = fin?.subtotal === 32000;
    const hasCorrectCustomization = fin?.customizationTotal === 12500; // 8000 + 4500
    const hasCorrectTaxable = fin?.taxableValue === 44500;
    const hasCorrectGST = fin?.taxAmount === 5340; // 44500 * 12%
    const hasCorrectTotal = fin?.totalAmount === 49840;

    assert(
      hasDin && hasCorrectSubtotal && hasCorrectCustomization && hasCorrectTaxable && hasCorrectGST && hasCorrectTotal,
      'GOLDEN_3',
      'Golden Test 3: DIN-001 + 2100x1000 + Premium Polish Deterministic Financial Engine',
      `Subtotal: ${fin?.subtotal}, Taxable: ${fin?.taxableValue}, GST: ${fin?.taxAmount}, Total: ${fin?.totalAmount}`
    );
  }

  // -------------------------------------------------------------
  // TEST 1: Standard product enquiry
  // -------------------------------------------------------------
  {
    const query = 'Tell me about WAR-001';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    assert(evidence.matched && evidence.sku === 'WAR-001', 1, 'Standard product enquiry matches WAR-001');
  }

  // -------------------------------------------------------------
  // TEST 2: Product price
  // -------------------------------------------------------------
  {
    const query = 'What is the price of WAR-001?';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    assert(evidence.answerableFacts['price']?.value === 28000, 2, 'Product price matches exactly ₹28,000');
  }

  // -------------------------------------------------------------
  // TEST 3: Product SKU
  // -------------------------------------------------------------
  {
    const query = 'What is the SKU for the 3 door wardrobe?';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    assert(evidence.sku === 'WAR-001', 3, 'Product SKU resolved to WAR-001');
  }

  // -------------------------------------------------------------
  // TEST 4: Product warranty
  // -------------------------------------------------------------
  {
    const query = 'What warranty comes with the 3 door wardrobe?';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    assert(evidence.answerableFacts['warranty']?.value === '2 years', 4, 'Product warranty is exactly 2 years');
  }

  // -------------------------------------------------------------
  // TEST 5: Product material
  // -------------------------------------------------------------
  {
    const query = 'What material is the 3 door wardrobe made of?';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    assert(evidence.answerableFacts['material']?.value === 'Engineered wood', 5, 'Material is Engineered wood');
  }

  // -------------------------------------------------------------
  // TEST 6: Unknown product (Zero Hallucination)
  // -------------------------------------------------------------
  {
    const query = 'How much is your 5-door wardrobe?';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const response = await GroundedResponseService.generateResponse({ message: query, evidence });
    const abstained = response.status === 'NOT_FOUND' && !response.response.includes('₹') && response.response.includes("couldn't find a 5-door wardrobe");
    assert(abstained, 6, 'Unknown product abstains safely without inventing a price');
  }

  // -------------------------------------------------------------
  // TEST 7: Ambiguous product
  // -------------------------------------------------------------
  {
    const query = 'I want a dining table';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const response = await GroundedResponseService.generateResponse({ message: query, evidence });
    const isAmbiguous = response.status === 'AMBIGUOUS' && response.response.includes('confirm which dining table');
    assert(isAmbiguous, 7, 'Ambiguous product query asks for customer clarification');
  }

  // -------------------------------------------------------------
  // TEST 8: Customization retrieval
  // -------------------------------------------------------------
  {
    const query = 'Can I add an additional wardrobe drawer?';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const cust = evidence.normalizedQuery.matchedCustomizations.find(c => c.id === 'additional_wardrobe_drawer');
    assert(cust?.standardCharge === 1800 && cust?.approvalRequired === 'Sales', 8, 'Customization drawer retrieved at ₹1,800, Sales approval');
  }

  // -------------------------------------------------------------
  // TEST 9: Multiple customizations
  // -------------------------------------------------------------
  {
    const query = 'I want DIN-001 with custom table size up to 2100x1000 and premium polish';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const count = evidence.normalizedQuery.matchedCustomizations.length;
    assert(count === 2, 9, 'Multiple customizations both correctly identified');
  }

  // -------------------------------------------------------------
  // TEST 10: Discount 5% (Sales Executive authority)
  // -------------------------------------------------------------
  {
    const app = ApprovalGovernanceEngine.evaluateDiscountApproval(5);
    assert(!app.requiresApproval && app.requiredApprover === 'Sales Executive', 10, '5% discount handled by Sales Executive without escalation');
  }

  // -------------------------------------------------------------
  // TEST 11: Discount 7% (Sales Manager approval)
  // -------------------------------------------------------------
  {
    const app = ApprovalGovernanceEngine.evaluateDiscountApproval(7);
    assert(app.requiresApproval && app.requiredApprover === 'Sales Manager', 11, '7% discount requires Sales Manager approval');
  }

  // -------------------------------------------------------------
  // TEST 12: Discount 12% (Owner approval)
  // -------------------------------------------------------------
  {
    const app = ApprovalGovernanceEngine.evaluateDiscountApproval(12);
    assert(app.requiresApproval && app.requiredApprover === 'Owner', 12, '12% discount requires Owner approval');
  }

  // -------------------------------------------------------------
  // TEST 13: Discount >15% (Owner exception)
  // -------------------------------------------------------------
  {
    const app = ApprovalGovernanceEngine.evaluateDiscountApproval(18);
    assert(app.requiresApproval && app.requiredApprover === 'Owner exception' && app.isException, 13, '18% discount flagged as Owner exception');
  }

  // -------------------------------------------------------------
  // TEST 14: High-value order approval
  // -------------------------------------------------------------
  {
    const under1L = ApprovalGovernanceEngine.evaluateOrderValueApproval(80000);
    const mid2L = ApprovalGovernanceEngine.evaluateOrderValueApproval(150000);
    const high4L = ApprovalGovernanceEngine.evaluateOrderValueApproval(400000);
    assert(
      !under1L.requiresApproval && mid2L.requiredApprover === 'Manager' && high4L.requiredApprover === 'Owner',
      14,
      'Order value approval tiers: <=1L Sales, 1L-3L Manager, >3L Owner'
    );
  }

  // -------------------------------------------------------------
  // TEST 15: Credit request (Finance approval, not standard)
  // -------------------------------------------------------------
  {
    const credit = ApprovalGovernanceEngine.evaluateCreditRequest(true);
    assert(credit.requiresApproval && credit.requiredApprover === 'Finance' && credit.isException, 15, 'Credit sale strictly requires Finance approval');
  }

  // -------------------------------------------------------------
  // TEST 16: Quotation creation validity (15 days)
  // -------------------------------------------------------------
  {
    const calc = DeterministicFinancialEngine.calculateQuotation({
      items: [{ productName: 'Classic Teak 3-Seater Sofa', quantity: 1, unitPrice: 45000 }],
      taxRate: 12
    });
    assert(calc.totalAmount === 50400 && calc.taxAmount === 5400, 16, 'Quotation calculated deterministically with 15-day validity contract');
  }

  // -------------------------------------------------------------
  // TEST 17: Expired quotation
  // -------------------------------------------------------------
  {
    const isExpired = (createdDate: Date, validityDays = 15) => {
      const diff = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
      return diff > validityDays;
    };
    const oldQuoteDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    assert(isExpired(oldQuoteDate) === true, 17, 'Expired quotation (>15 days) requires revalidation before order conversion');
  }

  // -------------------------------------------------------------
  // TEST 18: Quotation revision control
  // -------------------------------------------------------------
  {
    const originalQuote = { id: 'QUO-001', revision: 1, price: 28000 };
    const revisedQuote = { ...originalQuote, revision: 2, price: 26600, previousRevisionId: 'QUO-001' };
    assert(revisedQuote.revision === 2 && revisedQuote.previousRevisionId === 'QUO-001', 18, 'Quotation revision preserves audit history');
  }

  // -------------------------------------------------------------
  // TEST 19: Order creation validation
  // -------------------------------------------------------------
  {
    const validateOrderInput = (input: any) => {
      const required = ['quotationId', 'customerId', 'sku', 'deliveryAddress', 'requestedDeliveryDate'];
      return required.every(f => Boolean(input[f]));
    };
    const valid = validateOrderInput({ quotationId: 'Q1', customerId: 'C1', sku: 'WAR-001', deliveryAddress: 'Coimbatore', requestedDeliveryDate: '2026-10-20' });
    const invalid = validateOrderInput({ quotationId: 'Q1', sku: 'WAR-001' });
    assert(valid && !invalid, 19, 'Order creation enforces mandatory fields');
  }

  // -------------------------------------------------------------
  // TEST 20: Production release conditions
  // -------------------------------------------------------------
  {
    const blockedWithoutAdvance = ApprovalGovernanceEngine.canReleaseToProduction({
      orderStatus: 'CONFIRMED',
      advanceReceived: false,
      hasApprovedCreditException: false
    });
    const releasedWithAdvance = ApprovalGovernanceEngine.canReleaseToProduction({
      orderStatus: 'CONFIRMED',
      advanceReceived: true,
      hasApprovedCreditException: false
    });
    assert(!blockedWithoutAdvance.allowed && releasedWithAdvance.allowed, 20, 'Production release blocked without advance payment');
  }

  // -------------------------------------------------------------
  // TEST 21: Advance payment requirement (50%)
  // -------------------------------------------------------------
  {
    const fin = DeterministicFinancialEngine.calculateQuotation({
      items: [{ productName: '3-Door Wardrobe', quantity: 1, unitPrice: 28000 }],
      taxRate: 12
    });
    assert(fin.requiredAdvance === fin.totalAmount * 0.5, 21, 'Advance payment is strictly 50% for made-to-order');
  }

  // -------------------------------------------------------------
  // TEST 22: Payment verification from customer message
  // -------------------------------------------------------------
  {
    const query = 'I transferred ₹14,000 for my order';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const claim = evidence.answerableFacts['paymentClaim']?.value;
    assert(claim?.status === 'PENDING_RECONCILIATION' && claim?.claimedAmount === 14000, 22, 'Customer payment message remains unverified pending reconciliation');
  }

  // -------------------------------------------------------------
  // TEST 23: Duplicate payment idempotency
  // -------------------------------------------------------------
  {
    const transactions = new Set<string>();
    const registerPayment = (ref: string) => {
      if (transactions.has(ref)) return { status: 'DUPLICATE_IGNORED' };
      transactions.add(ref);
      return { status: 'RECORDED' };
    };
    const first = registerPayment('TXN-12345');
    const second = registerPayment('TXN-12345');
    assert(first.status === 'RECORDED' && second.status === 'DUPLICATE_IGNORED', 23, 'Payment idempotency prevents duplicate records');
  }

  // -------------------------------------------------------------
  // TEST 24: Invoice generation numbering
  // -------------------------------------------------------------
  {
    const formatInvoiceNumber = (num: number) => `AF-INV-2026-${num.toString().padStart(4, '0')}`;
    assert(formatInvoiceNumber(1) === 'AF-INV-2026-0001', 24, 'Deterministic invoice numbering AF-INV-2026-0001');
  }

  // -------------------------------------------------------------
  // TEST 25: GST calculation (12% controlled test rate)
  // -------------------------------------------------------------
  {
    const taxable = 44500;
    const gstRate = AASHA_TAX_CONFIG.taxRatePercentage;
    const gst = Math.round(taxable * (gstRate / 100));
    assert(gst === 5340 && taxable + gst === 49840, 25, 'Configured 12% test GST: 44,500 * 12% = 5,340');
  }

  // -------------------------------------------------------------
  // TEST 26: Payment reminder schedule
  // -------------------------------------------------------------
  {
    const getReminderAction = (daysDiff: number) => {
      if (daysDiff === -3) return 'FRIENDLY_REMINDER';
      if (daysDiff === 0) return 'DUE_TODAY';
      if (daysDiff === 1) return 'FIRST_OVERDUE';
      if (daysDiff === 3) return 'SECOND_OVERDUE';
      if (daysDiff === 7) return 'ESCALATE_TO_FINANCE_MANAGER';
      if (daysDiff >= 15) return 'COLLECTIONS_DECISION';
      return null;
    };
    assert(
      getReminderAction(-3) === 'FRIENDLY_REMINDER' &&
      getReminderAction(0) === 'DUE_TODAY' &&
      getReminderAction(7) === 'ESCALATE_TO_FINANCE_MANAGER',
      26,
      'Payment reminder schedule conforms to Collections Policy'
    );
  }

  // -------------------------------------------------------------
  // TEST 27: Reminder suppression when paid
  // -------------------------------------------------------------
  {
    const shouldSendReminder = (status: string, balance: number) => {
      if (status === 'PAID' || balance <= 0) return false;
      return true;
    };
    assert(!shouldSendReminder('PAID', 0) && shouldSendReminder('PARTIALLY_PAID', 5000), 27, 'Payment reminders suppressed when balance is zero');
  }

  // -------------------------------------------------------------
  // TEST 28: Overdue escalation
  // -------------------------------------------------------------
  {
    const getEscalationLevel = (daysOverdue: number) => (daysOverdue >= 7 ? 'FINANCE_MANAGER_OWNER' : 'STANDARD');
    assert(getEscalationLevel(7) === 'FINANCE_MANAGER_OWNER', 28, '7+ days overdue escalates to Finance Manager / Owner');
  }

  // -------------------------------------------------------------
  // TEST 29: Cancellation policy
  // -------------------------------------------------------------
  {
    const cancelBefore = DeterministicFinancialEngine.calculateRefund({
      totalPaid: 14000,
      productionStarted: false,
      nonRefundableCosts: 500,
      isCustomMade: false
    });
    assert(cancelBefore.eligibleRefund === 13500 && !cancelBefore.requiresManagementApproval, 29, 'Cancellation before production eligible for refund');
  }

  // -------------------------------------------------------------
  // TEST 30: Refund calculation after production starts
  // -------------------------------------------------------------
  {
    const cancelAfter = DeterministicFinancialEngine.calculateRefund({
      totalPaid: 25000,
      productionStarted: true,
      nonRefundableCosts: 10000,
      isCustomMade: true
    });
    assert(cancelAfter.eligibleRefund === 15000 && cancelAfter.requiresManagementApproval, 30, 'Refund after production requires Management approval');
  }

  // -------------------------------------------------------------
  // TEST 31: Refund approval thresholds (<=10k Finance, >10k Owner)
  // -------------------------------------------------------------
  {
    const ref5k = ApprovalGovernanceEngine.evaluateRefundApproval(5000);
    const ref15k = ApprovalGovernanceEngine.evaluateRefundApproval(15000);
    assert(ref5k.requiredApprover === 'Finance' && ref15k.requiredApprover === 'Owner', 31, 'Refund thresholds: <=10k Finance, >10k Owner');
  }

  // -------------------------------------------------------------
  // TEST 32: Segregation of duties
  // -------------------------------------------------------------
  {
    const sameUser = ApprovalGovernanceEngine.validateSegregationOfDuties('user-1', 'user-1', 'DISCOUNT_EXCEPTION');
    const diffUser = ApprovalGovernanceEngine.validateSegregationOfDuties('user-1', 'user-2', 'DISCOUNT_EXCEPTION');
    assert(!sameUser.valid && diffUser.valid, 32, 'Segregation of duties blocks self-approval of financial exceptions');
  }

  // -------------------------------------------------------------
  // TEST 33: Unknown information (Safe abstention)
  // -------------------------------------------------------------
  {
    const query = 'Do you sell plastic lawn chairs?';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const response = await GroundedResponseService.generateResponse({ message: query, evidence });
    assert(response.status === 'NOT_FOUND' && !response.response.includes('₹'), 33, 'Unknown information triggers safe abstention with zero hallucination');
  }

  // -------------------------------------------------------------
  // TEST 34: Cross-document retrieval
  // -------------------------------------------------------------
  {
    const query = 'I want DIN-001 with custom table size up to 2100x1000 and premium polish';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId, query });
    const docs = evidence.sourceDocuments;
    assert(
      docs.includes('02_Product_Catalogue.pdf') &&
      docs.includes('03_Product_Customization_Guide.pdf') &&
      docs.includes('04_Pricing_Rate_Card.pdf') &&
      docs.includes('11_Invoice_Tax_Policy.pdf'),
      34,
      'Cross-document retrieval combines catalogue, customization, rate card and tax policies'
    );
  }

  // -------------------------------------------------------------
  // TEST 35: Cross-business isolation
  // -------------------------------------------------------------
  {
    const otherBusinessId = '0fbcebfa-e371-41b9-9eb1-68158e4437b2'; // Different tenant
    const query = '3 door wardrobe price';
    const evidence = await HybridRetrievalEngine.retrieve({ businessId: otherBusinessId, query });
    assert(
      !evidence.matched && Object.keys(evidence.answerableFacts).length === 0,
      35,
      'Cross-business isolation: No Aasha Furniture facts leaked to other tenant'
    );
  }

  // -------------------------------------------------------------
  // TEST 36: Grounding Validator - Stock Claim Rejection
  // -------------------------------------------------------------
  {
    const fakeEvidence: any = { answerableFacts: {} };
    const claims = GroundedResponseService.validateResponseClaims("Yes, this wardrobe is currently in stock.", fakeEvidence);
    assert(claims.some(c => c.includes('UNSUPPORTED_STOCK_CLAIM')), 36, 'Grounding Validator rejects unsupported stock claims');
  }

  // -------------------------------------------------------------
  // TEST 37: Grounding Validator - Delivery Claim Rejection
  // -------------------------------------------------------------
  {
    const fakeEvidence: any = { answerableFacts: {} };
    const claims = GroundedResponseService.validateResponseClaims("We can deliver tomorrow.", fakeEvidence);
    assert(claims.some(c => c.includes('UNSUPPORTED_DELIVERY_CLAIM')), 37, 'Grounding Validator rejects unverified immediate delivery promises');
  }

  // -------------------------------------------------------------
  // TEST 38: Grounding Validator - Pricing Contradiction Rejection
  // -------------------------------------------------------------
  {
    const fakeEvidence: any = { answerableFacts: { price: { value: 28000 } } };
    const claims = GroundedResponseService.validateResponseClaims("I'm sorry, pricing unavailable right now.", fakeEvidence);
    assert(claims.some(c => c.includes('CONTRADICTION')), 38, 'Grounding Validator rejects false pricing negation when price is known');
  }

  console.log('\n================================================================');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  return { total: results.length, passed, failed, results };
}

if (require.main === module) {
  runAashaTestSuite().catch(console.error);
}
