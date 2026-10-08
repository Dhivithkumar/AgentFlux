import { AASHA_TAX_CONFIG } from './aashaKnowledgeData';

export interface FinancialCalculationItem {
  sku?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  customizationCharges?: number;
}

export interface QuotationCalculationInput {
  items: FinancialCalculationItem[];
  discountPercentage?: number;
  fixedDiscountAmount?: number;
  deliveryCharge?: number;
  installationCharge?: number;
  taxRate?: number; // Configurable tax rate (defaults to 12% test GST)
}

export interface QuotationCalculationOutput {
  subtotal: number;
  customizationTotal: number;
  grossAmount: number;
  discountPercentage: number;
  discountAmount: number;
  taxableValue: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  requiredAdvance: number; // 50%
  balanceDue: number; // 50%
  isDeterministic: true;
}

export class DeterministicFinancialEngine {
  /**
   * Deterministic financial calculation.
   * LLM must never calculate or mutate these values.
   */
  public static calculateQuotation(input: QuotationCalculationInput): QuotationCalculationOutput {
    let subtotal = 0;
    let customizationTotal = 0;

    for (const item of input.items) {
      const q = Math.max(1, Number(item.quantity) || 1);
      const p = Math.max(0, Number(item.unitPrice) || 0);
      const c = Math.max(0, Number(item.customizationCharges) || 0);

      subtotal += q * p;
      customizationTotal += q * c;
    }

    const delivery = Math.max(0, Number(input.deliveryCharge) || 0);
    const installation = Math.max(0, Number(input.installationCharge) || 0);
    const grossAmount = subtotal + customizationTotal + delivery + installation;

    // Evaluate discount on eligible product/customization taxable value
    let discountAmount = 0;
    let discountPct = Math.max(0, Number(input.discountPercentage) || 0);

    if (discountPct > 0) {
      discountAmount = Math.round((grossAmount * (discountPct / 100)) * 100) / 100;
    } else if (input.fixedDiscountAmount && input.fixedDiscountAmount > 0) {
      discountAmount = Math.min(grossAmount, input.fixedDiscountAmount);
      discountPct = grossAmount > 0 ? (discountAmount / grossAmount) * 100 : 0;
    }

    const taxableValue = Math.max(0, grossAmount - discountAmount);

    // Controlled configurable test GST rate
    const taxRate = input.taxRate !== undefined ? input.taxRate : AASHA_TAX_CONFIG.taxRatePercentage;
    const taxAmount = Math.round((taxableValue * (taxRate / 100)) * 100) / 100;
    const totalAmount = Math.round((taxableValue + taxAmount) * 100) / 100;

    // Made-to-order payment policy: 50% advance, 50% balance
    const requiredAdvance = Math.round((totalAmount * 0.50) * 100) / 100;
    const balanceDue = Math.round((totalAmount - requiredAdvance) * 100) / 100;

    return {
      subtotal,
      customizationTotal,
      grossAmount,
      discountPercentage: discountPct,
      discountAmount,
      taxableValue,
      taxRate,
      taxAmount,
      totalAmount,
      requiredAdvance,
      balanceDue,
      isDeterministic: true
    };
  }

  /**
   * Deterministic refund calculation based on Cancellation & Refund Policy
   */
  public static calculateRefund(params: {
    totalPaid: number;
    productionStarted: boolean;
    nonRefundableCosts?: number;
    isCustomMade: boolean;
  }): { eligibleRefund: number; requiresManagementApproval: boolean; rule: string } {
    const { totalPaid, productionStarted, nonRefundableCosts = 0, isCustomMade } = params;

    if (!productionStarted) {
      // Cancellation before production: refundable minus documented non-refundable charges
      const eligibleRefund = Math.max(0, totalPaid - nonRefundableCosts);
      return {
        eligibleRefund,
        requiresManagementApproval: false,
        rule: 'Cancellation before production: Eligible for refund minus non-refundable charges.'
      };
    }

    // Cancellation after production starts:
    // Custom orders require Operations review & Management exception
    const costsIncurred = Math.max(0, nonRefundableCosts);
    const eligibleRefund = Math.max(0, totalPaid - costsIncurred);
    return {
      eligibleRefund,
      requiresManagementApproval: isCustomMade || productionStarted,
      rule: 'Cancellation after production starts: Custom manufacturing costs incurred; Management approval required.'
    };
  }
}
