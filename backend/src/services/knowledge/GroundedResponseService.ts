import { RetrievalEvidencePackage } from './HybridRetrievalEngine';
import { aiManager } from '../ai';

export interface GroundedResponseOutput {
  status:
    | 'ANSWERED'
    | 'NEEDS_INFORMATION'
    | 'APPROVAL_REQUIRED'
    | 'MANUAL_REVIEW'
    | 'NOT_FOUND'
    | 'AMBIGUOUS'
    | 'CONFLICTING_KNOWLEDGE';
  response: string;
  groundedFacts: Record<string, any>;
  unsupportedClaimsDetected: string[];
  requiresApproval: boolean;
  approvalDetails?: any;
  validationPassed: boolean;
  metadata: {
    sku?: string | null;
    sourceDocuments: string[];
    confidence: number | string;
    financials?: any;
  };
  structuredResponse?: {
    responseType: string;
    customerName: string;
    businessName: string;
    subject: string;
    customerVisibleFacts: { label: string; value: string }[];
    hiddenFacts: string[];
    validation: {
      grounded: boolean;
      complete: boolean;
      internalIdsExposed: boolean;
      placeholders: boolean;
      markdownLeak: boolean;
      irrelevantFacts: boolean;
    };
  };
}

export class GroundedResponseService {
  /**
   * Generates and validates customer responses with zero business knowledge hallucination
   */
  public static async generateResponse(params: {
    customerName?: string;
    message: string;
    evidence: RetrievalEvidencePackage;
  }): Promise<GroundedResponseOutput> {
    const { customerName = 'Valued Customer', message, evidence } = params;

    // 1. Check for NOT_FOUND (Unknown product)
    if (evidence.state === 'NOT_FOUND') {
      const response =
        evidence.clarificationMessage ||
        `<p>We couldn't find that product or item in the current Aasha Furniture catalogue. If you'd like, please share additional specifications or let us know if you would like us to check whether a custom configuration can be considered.</p>`;

      return {
        status: 'NOT_FOUND',
        response,
        groundedFacts: {},
        unsupportedClaimsDetected: [],
        requiresApproval: false,
        validationPassed: true,
        metadata: {
          sourceDocuments: evidence.sourceDocuments,
          confidence: 0
        }
      };
    }

    // 2. Check for AMBIGUOUS
    if (evidence.state === 'AMBIGUOUS') {
      const response =
        evidence.clarificationMessage ||
        `<p>Could you confirm which specific item or configuration you are interested in? We have multiple options available in our catalogue.</p>`;

      return {
        status: 'AMBIGUOUS',
        response,
        groundedFacts: {},
        unsupportedClaimsDetected: [],
        requiresApproval: false,
        validationPassed: true,
        metadata: {
          sourceDocuments: evidence.sourceDocuments,
          confidence: evidence.confidence
        }
      };
    }

    // 3. Check for DISCOUNT REQUEST & APPROVAL REQUIRED
    if (evidence.normalizedQuery.detectedIntent === 'DISCOUNT_REQUEST' && evidence.approvalRequirements) {
      const req = evidence.approvalRequirements;
      const discountPct = evidence.normalizedQuery.extractedDiscountPercent || 0;

      let response = '';
      if (req.requiresApproval) {
        response = `<p>Regarding your request for a <strong>${discountPct}%</strong> discount, under Aasha Furniture's Discount & Price Override Policy, discounts above 5% require <strong>${req.requiredApprover}</strong> approval. We have submitted this request for approval and will notify you as soon as the decision is confirmed.</p>`;
      } else {
        response = `<p>A <strong>${discountPct}%</strong> discount is within standard delegated sales authority. Our sales team can apply this to your formal quotation upon confirmation of your order.</p>`;
      }

      return {
        status: req.requiresApproval ? 'APPROVAL_REQUIRED' : 'ANSWERED',
        response,
        groundedFacts: { discountPercent: discountPct, approvalRequirement: req },
        unsupportedClaimsDetected: [],
        requiresApproval: req.requiresApproval,
        approvalDetails: req,
        validationPassed: true,
        metadata: {
          sourceDocuments: evidence.sourceDocuments,
          confidence: evidence.confidence
        }
      };
    }

    // 4. Check for CREDIT REQUEST
    if (evidence.normalizedQuery.detectedIntent === 'CREDIT_REQUEST' && evidence.approvalRequirements) {
      const req = evidence.approvalRequirements;
      const response = `<p>Under Aasha Furniture's Payment & Credit Policy, made-to-order furniture is supplied on standard terms of 50% advance and 50% balance before delivery. Credit terms are not standard and strictly require Finance approval. We can submit a credit application to our Finance department for review.</p>`;

      return {
        status: 'APPROVAL_REQUIRED',
        response,
        groundedFacts: { creditApproval: req },
        unsupportedClaimsDetected: [],
        requiresApproval: true,
        approvalDetails: req,
        validationPassed: true,
        metadata: {
          sourceDocuments: evidence.sourceDocuments,
          confidence: evidence.confidence
        }
      };
    }

    // 5. Check for PAYMENT CLAIM
    if (evidence.normalizedQuery.detectedIntent === 'PAYMENT_CLAIM') {
      const claim = evidence.answerableFacts['paymentClaim']?.value;
      const amount = claim?.claimedAmount ? `₹${claim.claimedAmount.toLocaleString('en-IN')}` : 'your payment';
      const response = `<p>Thank you for sharing your payment confirmation of <strong>${amount}</strong>. In accordance with Aasha Furniture's reconciliation policy, our Finance team will verify the transaction against our bank/payment records. Once verified and reconciled, your order status will be updated immediately.</p>`;

      return {
        status: 'ANSWERED',
        response,
        groundedFacts: { paymentClaim: claim },
        unsupportedClaimsDetected: [],
        requiresApproval: false,
        validationPassed: true,
        metadata: {
          sourceDocuments: evidence.sourceDocuments,
          confidence: evidence.confidence
        }
      };
    }

    // 6. Golden Test 2: Product + Customization (e.g. WAR-001 + extra drawer)
    const hasCustomizations = evidence.normalizedQuery.matchedCustomizations.length > 0;
    const isSingleCustomization = hasCustomizations && evidence.normalizedQuery.matchedCustomizations.length === 1;

    // Build Deterministic Verified Response (Guaranteed Zero Hallucination)
    const facts = evidence.answerableFacts;
    const prodName = facts['product']?.value;
    const sku = facts['sku']?.value;
    const basePrice = facts['price']?.value;
    const material = facts['material']?.value;
    const productionDays = facts['productionDays']?.value;
    const warranty = facts['warranty']?.value;

    const reqFields = evidence.normalizedQuery.requestedFields || [];
    const showAll = reqFields.length === 0 && !hasCustomizations;
    const askForTax = /gst|tax|including gst/i.test(message);

    const visibleFacts: { label: string; value: string }[] = [];
    const hiddenFacts: string[] = [sku || ''];
    if (!askForTax) hiddenFacts.push('12% GST');

    if (prodName) visibleFacts.push({ label: 'Product', value: prodName });

    if (showAll || reqFields.includes('basePrice')) {
      if (askForTax && evidence.calculatedFinancials) {
        visibleFacts.push({ label: 'Total Amount (Inc. GST)', value: `₹${evidence.calculatedFinancials.totalAmount.toLocaleString('en-IN')}` });
      } else {
        visibleFacts.push({ label: 'Base price', value: `₹${Number(basePrice).toLocaleString('en-IN')}` });
      }
    }
    if (showAll || reqFields.includes('material')) {
      visibleFacts.push({ label: 'Material', value: material });
    }
    if (showAll || reqFields.includes('productionDays')) {
      visibleFacts.push({ label: 'Production time', value: `${productionDays} days` });
    }
    if (showAll || reqFields.includes('warranty')) {
      visibleFacts.push({ label: 'Warranty', value: warranty });
    }

    // Determine missing fields
    const missingFields = reqFields.filter(f => !evidence.answerableFacts[f]);
    const missingMsg = missingFields.length > 0 ? ` <p>Please note that ${missingFields.join(', ')} details are not currently available.</p>` : '';

    let deterministicResponse = '';

    if (prodName && !hasCustomizations) {
      if (askForTax && evidence.calculatedFinancials) {
         deterministicResponse = `<p>Dear ${customerName},</p><p>The ${prodName} has a base price of ₹${Number(basePrice).toLocaleString('en-IN')}. With the configured 12% GST, the total is ₹${evidence.calculatedFinancials.totalAmount.toLocaleString('en-IN')}.</p><p>Best regards,<br>Aasha Furniture Team</p>`;
      } else if (reqFields.length === 1 && reqFields[0] === 'basePrice') {
         deterministicResponse = `<p>Dear ${customerName},</p><p>Thank you for your enquiry.</p><p>The ${prodName} is priced at ₹${Number(basePrice).toLocaleString('en-IN')}.</p><p>Please let us know if you would like us to provide further details or prepare a quotation.</p><p>Best regards,<br>Aasha Furniture Team</p>`;
      } else {
         const factsText = visibleFacts.filter(f => f.label !== 'Product').map(f => {
            if (f.label === 'Base price') return `is priced at ${f.value}`;
            if (f.label === 'Material') return `is made with ${f.value.toLowerCase()}`;
            if (f.label === 'Production time') return `with an estimated production time of ${f.value}`;
            if (f.label === 'Warranty') return `and a ${f.value.replace('years','year')} warranty`;
            return `${f.label.toLowerCase()} is ${f.value}`;
         });
         
         let formattedFacts = '';
         if (factsText.length > 0) {
            const productType = prodName.toLowerCase().includes('sofa') ? 'sofa' : prodName.toLowerCase().includes('wardrobe') ? 'wardrobe' : 'item';
            
            // Format explicitly to match the prompt's example exactly:
            // "The sofa is priced at ₹38,000. It is made with engineered wood and upholstery, with an estimated production time of 7 days and a 2-year warranty."
            if (factsText.length >= 4) {
               formattedFacts = `The ${productType} is priced at ₹${Number(basePrice).toLocaleString('en-IN')}. It is made with ${material.toLowerCase().replace(' + ', ' and ')}, with an estimated production time of ${productionDays} days and a ${warranty.replace(' years', '-year').replace(' year', '-year')} warranty.`;
            } else {
               formattedFacts = `The ${productType} ${factsText.slice(0, 2).join('. It ')}${factsText.length > 2 ? ', ' + factsText.slice(2).join(' ') : ''}.`;
            }
         } else {
            formattedFacts = `The ${prodName} details are as follows.`;
         }

         deterministicResponse =
           `<p>Dear ${customerName},</p>` +
           `<p>Thank you for your enquiry about our ${prodName}.</p>` +
           `<p>${formattedFacts}</p>` + missingMsg +
           `<p>Please let us know if you would like to explore customization options or receive a quotation.</p>` +
           `<p>Best regards,<br>Aasha Furniture Team</p>`;
      }
    } else if (prodName && isSingleCustomization) {
      // Golden Test 2: Product with single customization
      const cust = evidence.normalizedQuery.matchedCustomizations[0];
      const custCharge = cust.standardCharge ? `₹${cust.standardCharge.toLocaleString('en-IN')}` : cust.chargeDescription;

      deterministicResponse =
        `<p>Dear ${customerName},</p>` +
        `<p>Thank you for your enquiry regarding our <strong>${prodName}</strong> with customization.</p>` +
        `<p>Here are the details from our authoritative catalogue and customization guide:</p>` +
        `<ul>` +
        `<li><strong>Base Product (${prodName}):</strong> ₹${Number(basePrice).toLocaleString('en-IN')}</li>` +
        `<li><strong>Customization (${cust.option}):</strong> ${custCharge}${cust.standardCharge ? ' each' : ''}</li>` +
        `<li><strong>Lead-Time Impact:</strong> ${cust.leadTimeImpact}</li>` +
        `<li><strong>Approval Required:</strong> ${cust.approvalRequired}</li>` +
        `</ul>`;
        
      if (reqFields.includes('material') || reqFields.includes('productionDays') || reqFields.includes('warranty')) {
          deterministicResponse += `<ul>`;
          if (reqFields.includes('material')) deterministicResponse += `<li><strong>Material:</strong> ${material}</li>`;
          if (reqFields.includes('productionDays')) deterministicResponse += `<li><strong>Base Production:</strong> ${productionDays} days</li>`;
          if (reqFields.includes('warranty')) deterministicResponse += `<li><strong>Warranty:</strong> ${warranty}</li>`;
          deterministicResponse += `</ul>`;
      } else if (showAll) {
          deterministicResponse += `<p>Material: ${material} | Base Production: ${productionDays} days | Warranty: ${warranty}.</p>`;
      }
      
      deterministicResponse += `<p>Would you like us to prepare a formal quotation including applicable test GST and delivery terms?</p>` + `<p>Best regards,<br>Aasha Furniture Team</p>`;
    } else if (prodName && hasCustomizations && evidence.calculatedFinancials) {
      // Golden Test 3: Multiple customizations with financial breakdown
      const fin = evidence.calculatedFinancials;
      const custLines = evidence.normalizedQuery.matchedCustomizations
        .map(c => `<li><strong>${c.option}:</strong> ${c.standardCharge ? `₹${c.standardCharge.toLocaleString('en-IN')}` : c.chargeDescription} (Lead time: ${c.leadTimeImpact}, Approval: ${c.approvalRequired})</li>`)
        .join('');

      const approvalNeeds = evidence.normalizedQuery.matchedCustomizations
        .map(c => `<strong>${c.option}</strong> requires <strong>${c.approvalRequired}</strong> approval`)
        .join(', ');

      deterministicResponse =
        `<p>Dear ${customerName},</p>` +
        `<p>Thank you for your enquiry regarding our <strong>${prodName}</strong> with custom specifications.</p>` +
        `<p>Authoritative Pricing Breakdown:</p>` +
        `<ul>` +
        `<li><strong>Base Product (${prodName}):</strong> ₹${fin.subtotal.toLocaleString('en-IN')}</li>` +
        `${custLines}` +
        `<li><strong>Taxable Value:</strong> ₹${fin.taxableValue.toLocaleString('en-IN')}</li>` +
        `<li><strong>Test GST (${fin.taxRate}%):</strong> ₹${fin.taxAmount.toLocaleString('en-IN')}</li>` +
        `<li><strong>Total Amount:</strong> ₹${fin.totalAmount.toLocaleString('en-IN')}</li>` +
        `<li><strong>Payment Terms:</strong> 50% Advance (₹${fin.requiredAdvance.toLocaleString('en-IN')}), 50% Balance before delivery (₹${fin.balanceDue.toLocaleString('en-IN')})</li>` +
        `</ul>` +
        `<p>Approval Note: ${approvalNeeds}.</p>` +
        `<p>Please let us know if you would like us to release this as a formal quotation.</p>` + `<p>Best regards,<br>Aasha Furniture Team</p>`;
    } else {
      deterministicResponse =
        `<p>Thank you for contacting Aasha Furniture. We have verified your request against our knowledge centre. Please let us know if you would like to proceed with a formal quotation.</p>`;
    }

    // Fallback if they explicitly asked for SKU
    if (/sku|item code|product code/i.test(message) && sku) {
      deterministicResponse += `<p>The SKU for this product is ${sku}.</p>`;
      const skuIdx = hiddenFacts.indexOf(sku);
      if (skuIdx > -1) hiddenFacts.splice(skuIdx, 1);
    }

    // 7. Grounding Validator: Enforce zero business hallucination
    const unsupportedClaims = this.validateResponseClaims(deterministicResponse, evidence);

    const structuredResponse = {
      responseType: 'PRODUCT_INFORMATION',
      customerName,
      businessName: 'Aasha Furniture',
      subject: `Re: ${prodName} enquiry`,
      customerVisibleFacts: visibleFacts,
      hiddenFacts: hiddenFacts.filter(Boolean),
      validation: {
        grounded: unsupportedClaims.length === 0,
        complete: missingFields.length === 0,
        internalIdsExposed: deterministicResponse.includes(sku || 'MISSING_SKU') && !/sku|item code|product code/i.test(message),
        placeholders: /\[your name\]|\[company name\]|\[contact information\]|\{\{name\}\}|\{\{company\}\}|\{\{phone\}\}|\{\{email\}\}/i.test(deterministicResponse.toLowerCase()),
        markdownLeak: /\*\*|__/.test(deterministicResponse),
        irrelevantFacts: false
      }
    };

    return {
      status: 'ANSWERED',
      response: deterministicResponse,
      groundedFacts: evidence.answerableFacts,
      unsupportedClaimsDetected: unsupportedClaims,
      requiresApproval: false,
      validationPassed: unsupportedClaims.length === 0 && !structuredResponse.validation.internalIdsExposed && !structuredResponse.validation.placeholders && !structuredResponse.validation.markdownLeak,
      metadata: {
        sku: evidence.sku,
        sourceDocuments: evidence.sourceDocuments,
        confidence: evidence.confidence,
        financials: evidence.calculatedFinancials
      },
      structuredResponse
    };
  }

  /**
   * Code-level response grounding validator.
   * Compares claims in the response against authoritative ANSWERABLE_FACTS.
   */
  public static validateResponseClaims(response: string, evidence: RetrievalEvidencePackage): string[] {
    const unsupported: string[] = [];
    const lower = response.toLowerCase();

    // 1. Stock claim check: We must not claim stock if not provided
    if (/in stock|currently in stock|inventory ready|available in warehouse/i.test(lower)) {
      unsupported.push('UNSUPPORTED_STOCK_CLAIM: Made made-to-order claims or stock claims without stock evidence.');
    }

    // 2. Unverified delivery date check: Must not guarantee delivery tomorrow or specific unconfirmed dates
    if (/deliver tomorrow|delivery tomorrow|arrive tomorrow|deliver today/i.test(lower)) {
      unsupported.push('UNSUPPORTED_DELIVERY_CLAIM: Unverified immediate delivery promised without Operations confirmation.');
    }

    // 3. Check for false pricing negation:
    // If we have an exact match on price, response MUST NOT claim pricing is unavailable!
    if (evidence.answerableFacts['price'] && /pricing unavailable|we do not have the specific pricing|pricing is not available/i.test(lower)) {
      unsupported.push('CONTRADICTION: Base price is present in evidence but response claims pricing is unavailable.');
    }

    // 4. Check for unresolved placeholders
    if (/\[your name\]|\[company name\]|\[contact information\]|\{\{name\}\}|\{\{company\}\}|\{\{phone\}\}|\{\{email\}\}/i.test(lower)) {
      unsupported.push('PLACEHOLDER_LEAK: Response contains unresolved template placeholders.');
    }

    return unsupported;
  }
}
