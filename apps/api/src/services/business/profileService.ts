import { prisma } from '@agent-flux/database';

export interface BusinessProfileData {
  id: string;
  name: string;
  industry: string;
  businessType: string;
  country: string;
  timezone: string;
  currency: string;
  website: string;
  description: string;
  legalBusinessName: string;
  displayName: string;
  email: string;
  phone: string;
  alternatePhone: string;
  supportEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  taxRegistrationStatus: 'REGISTERED' | 'NOT_REGISTERED' | 'COMPOSITION';
  gstin: string;
  pan: string;
  defaultTaxRate: number | null;
  invoicePrefix: string;
  quotationPrefix: string;
  orderPrefix: string;
  defaultPaymentTerms: string;
  defaultInvoiceDueDays: number;
  invoiceNotes: string;
  invoiceFooter: string;
  quotationFooter: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string; // Masked when returned
  isBankAccountConfigured: boolean;
  bankIfsc: string;
  bankBranch: string;
  upiId: string;
  paymentInstructions: string;
  authorizedSignatoryName: string;
  authorizedSignatoryDesignation: string;
  authorizedSignatoryEmail: string;
  authorizedSignatoryPhone: string;
  authorizedSignatorySignatureUrl: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OperationReadiness {
  quotation: {
    ready: boolean;
    missingItems: string[];
  };
  invoice: {
    ready: boolean;
    missingItems: string[];
  };
  payment: {
    ready: boolean;
    missingItems: string[];
  };
}

export class BusinessProfileService {
  /**
   * Masks a bank account number showing only the last 4 digits
   */
  static maskBankAccount(accountNumber?: string | null): string {
    if (!accountNumber) return '';
    const clean = accountNumber.trim();
    if (clean.length <= 4) return '****';
    return `${'*'.repeat(clean.length - 4)}${clean.slice(-4)}`;
  }

  /**
   * Flattens the top-level Business entity and its JSON contactInfo/preferences fields
   * into a typed, single-level BusinessProfileData structure.
   */
  static flattenProfile(business: any, maskBankDetails = true): BusinessProfileData {
    const contact = (business.contactInfo as any) || {};
    const prefs = (business.preferences as any) || {};

    const rawBankAccount = prefs.bankAccountNumber || contact.bankAccountNumber || '';
    const maskedAccount = maskBankDetails ? this.maskBankAccount(rawBankAccount) : rawBankAccount;

    return {
      id: business.id,
      name: business.name || '',
      industry: business.industry || '',
      businessType: business.businessType || prefs.businessType || '',
      country: business.country || prefs.country || 'India',
      timezone: business.timezone || prefs.timezone || 'Asia/Kolkata',
      currency: (business.currency || prefs.currency || 'INR').toUpperCase(),
      website: business.website || contact.website || '',
      description: business.description || '',

      legalBusinessName: prefs.legalBusinessName || business.name || '',
      displayName: prefs.displayName || business.name || '',

      email: contact.email || '',
      phone: contact.phone || '',
      alternatePhone: contact.alternatePhone || '',
      supportEmail: contact.supportEmail || contact.email || '',

      addressLine1: contact.addressLine1 || contact.address || '',
      addressLine2: contact.addressLine2 || '',
      city: contact.city || '',
      state: contact.state || '',
      postalCode: contact.postalCode || contact.pincode || '',

      taxRegistrationStatus: prefs.taxRegistrationStatus || (prefs.gstin ? 'REGISTERED' : 'NOT_REGISTERED'),
      gstin: prefs.gstin || '',
      pan: prefs.pan || '',
      defaultTaxRate: prefs.defaultTaxRate !== undefined && prefs.defaultTaxRate !== null ? Number(prefs.defaultTaxRate) : 18,

      invoicePrefix: prefs.invoicePrefix || 'AF-INV-',
      quotationPrefix: prefs.quotationPrefix || 'AF-QTN-',
      orderPrefix: prefs.orderPrefix || 'AF-ORD-',
      defaultPaymentTerms: prefs.defaultPaymentTerms || 'Net 15 Days',
      defaultInvoiceDueDays: prefs.defaultInvoiceDueDays !== undefined && prefs.defaultInvoiceDueDays !== null ? Number(prefs.defaultInvoiceDueDays) : 15,
      invoiceNotes: prefs.invoiceNotes || '',
      invoiceFooter: prefs.invoiceFooter || 'Thank you for your business.',
      quotationFooter: prefs.quotationFooter || 'This quotation is valid for 30 days from date of issue.',

      bankName: prefs.bankName || '',
      bankAccountName: prefs.bankAccountName || prefs.legalBusinessName || business.name || '',
      bankAccountNumber: maskedAccount,
      isBankAccountConfigured: !!rawBankAccount,
      bankIfsc: prefs.bankIfsc || '',
      bankBranch: prefs.bankBranch || '',
      upiId: prefs.upiId || '',
      paymentInstructions: prefs.paymentInstructions || '',

      authorizedSignatoryName: prefs.authorizedSignatoryName || '',
      authorizedSignatoryDesignation: prefs.authorizedSignatoryDesignation || '',
      authorizedSignatoryEmail: prefs.authorizedSignatoryEmail || '',
      authorizedSignatoryPhone: prefs.authorizedSignatoryPhone || '',
      authorizedSignatorySignatureUrl: prefs.authorizedSignatorySignatureUrl || '',

      createdAt: business.createdAt,
      updatedAt: business.updatedAt
    };
  }

  /**
   * Calculates readiness strictly per operation rather than a generic completion percentage.
   */
  static calculateReadiness(profile: BusinessProfileData): OperationReadiness {
    // 1. Quotation Generation Readiness
    const missingQuotation: string[] = [];
    if (!profile.name?.trim()) missingQuotation.push('Business Name');
    if (!profile.email?.trim()) missingQuotation.push('Contact Email');
    if (!profile.quotationPrefix?.trim()) missingQuotation.push('Quotation Prefix');
    if (!profile.currency?.trim()) missingQuotation.push('Operating Currency');
    if (!profile.authorizedSignatoryName?.trim()) missingQuotation.push('Authorised Signatory Name');

    // 2. Invoice Generation Readiness
    const missingInvoice: string[] = [];
    if (!profile.name?.trim()) missingInvoice.push('Business Name');
    if (!profile.email?.trim()) missingInvoice.push('Contact Email');
    if (!profile.addressLine1?.trim()) missingInvoice.push('Address Line 1');
    if (!profile.city?.trim()) missingInvoice.push('City');
    if (!profile.state?.trim()) missingInvoice.push('State');
    if (!profile.postalCode?.trim()) missingInvoice.push('Postal / PIN Code');
    if (!profile.invoicePrefix?.trim()) missingInvoice.push('Invoice Prefix');
    if (profile.defaultInvoiceDueDays === undefined || profile.defaultInvoiceDueDays === null) {
      missingInvoice.push('Default Due Days');
    }

    // Tax validation: Do NOT require GSTIN for a business explicitly marked NOT_REGISTERED
    if (profile.taxRegistrationStatus === 'REGISTERED') {
      if (!profile.gstin?.trim()) {
        missingInvoice.push('GSTIN (Required for registered tax status)');
      } else {
        const cleanGstin = profile.gstin.trim().toUpperCase();
        // Indian GSTIN format check: 2 digits + 10 PAN chars + 1 entity num + 'Z' + 1 checksum
        const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        if (!gstinRegex.test(cleanGstin)) {
          missingInvoice.push('Valid 15-character GSTIN format (e.g. 29ABCDE1234F1Z5)');
        }
      }
    }

    if (!profile.authorizedSignatoryName?.trim()) {
      missingInvoice.push('Authorised Signatory Name');
    }

    // 3. Payment Acceptance Readiness
    const missingPayment: string[] = [];
    const hasBank = profile.isBankAccountConfigured && profile.bankIfsc?.trim();
    const hasUpi = !!profile.upiId?.trim();
    if (!hasBank && !hasUpi) {
      missingPayment.push('Bank Account details (Account Number & IFSC) or UPI ID');
    }

    return {
      quotation: {
        ready: missingQuotation.length === 0,
        missingItems: missingQuotation
      },
      invoice: {
        ready: missingInvoice.length === 0,
        missingItems: missingInvoice
      },
      payment: {
        ready: missingPayment.length === 0,
        missingItems: missingPayment
      }
    };
  }

  /**
   * Persists business profile changes by properly distributing fields across
   * top-level columns, contactInfo JSON, and preferences JSON.
   */
  static async updateProfile(businessId: string, payload: Partial<BusinessProfileData>): Promise<BusinessProfileData> {
    const existing = await prisma.business.findUnique({
      where: { id: businessId }
    });

    if (!existing) {
      throw new Error(`Business ${businessId} not found`);
    }

    const currentContact = (existing.contactInfo as any) || {};
    const currentPrefs = (existing.preferences as any) || {};

    // Determine updated bank account number:
    // If payload contains asterisks (masked value), keep the current raw value.
    let updatedBankAccount = currentPrefs.bankAccountNumber;
    if (payload.bankAccountNumber !== undefined) {
      const incoming = payload.bankAccountNumber.trim();
      if (!incoming.includes('*') && incoming.length > 0) {
        updatedBankAccount = incoming;
      }
    }

    // Merge Contact Info JSON
    const mergedContact = {
      ...currentContact,
      ...(payload.email !== undefined && { email: payload.email }),
      ...(payload.phone !== undefined && { phone: payload.phone }),
      ...(payload.alternatePhone !== undefined && { alternatePhone: payload.alternatePhone }),
      ...(payload.supportEmail !== undefined && { supportEmail: payload.supportEmail }),
      ...(payload.addressLine1 !== undefined && { addressLine1: payload.addressLine1 }),
      ...(payload.addressLine2 !== undefined && { addressLine2: payload.addressLine2 }),
      ...(payload.city !== undefined && { city: payload.city }),
      ...(payload.state !== undefined && { state: payload.state }),
      ...(payload.postalCode !== undefined && { postalCode: payload.postalCode }),
      ...(payload.website !== undefined && { website: payload.website }),
      // Computed canonical address
      address: [payload.addressLine1 ?? currentContact.addressLine1, payload.addressLine2 ?? currentContact.addressLine2, payload.city ?? currentContact.city, payload.state ?? currentContact.state, payload.postalCode ?? currentContact.postalCode]
        .filter(Boolean)
        .join(', ')
    };

    // Merge Preferences JSON
    const mergedPrefs = {
      ...currentPrefs,
      ...(payload.legalBusinessName !== undefined && { legalBusinessName: payload.legalBusinessName }),
      ...(payload.displayName !== undefined && { displayName: payload.displayName }),
      ...(payload.taxRegistrationStatus !== undefined && { taxRegistrationStatus: payload.taxRegistrationStatus }),
      ...(payload.gstin !== undefined && { gstin: payload.gstin ? payload.gstin.trim().toUpperCase() : '' }),
      ...(payload.pan !== undefined && { pan: payload.pan ? payload.pan.trim().toUpperCase() : '' }),
      ...(payload.defaultTaxRate !== undefined && {
        defaultTaxRate: payload.defaultTaxRate !== null && !isNaN(Number(payload.defaultTaxRate))
          ? Number(payload.defaultTaxRate)
          : null
      }),
      ...(payload.invoicePrefix !== undefined && { invoicePrefix: payload.invoicePrefix }),
      ...(payload.quotationPrefix !== undefined && { quotationPrefix: payload.quotationPrefix }),
      ...(payload.orderPrefix !== undefined && { orderPrefix: payload.orderPrefix }),
      ...(payload.defaultPaymentTerms !== undefined && { defaultPaymentTerms: payload.defaultPaymentTerms }),
      ...(payload.defaultInvoiceDueDays !== undefined && {
        defaultInvoiceDueDays: payload.defaultInvoiceDueDays !== null && !isNaN(Number(payload.defaultInvoiceDueDays))
          ? Number(payload.defaultInvoiceDueDays)
          : 15
      }),
      ...(payload.invoiceNotes !== undefined && { invoiceNotes: payload.invoiceNotes }),
      ...(payload.invoiceFooter !== undefined && { invoiceFooter: payload.invoiceFooter }),
      ...(payload.quotationFooter !== undefined && { quotationFooter: payload.quotationFooter }),

      ...(payload.bankName !== undefined && { bankName: payload.bankName }),
      ...(payload.bankAccountName !== undefined && { bankAccountName: payload.bankAccountName }),
      bankAccountNumber: updatedBankAccount,
      ...(payload.bankIfsc !== undefined && { bankIfsc: payload.bankIfsc ? payload.bankIfsc.trim().toUpperCase() : '' }),
      ...(payload.bankBranch !== undefined && { bankBranch: payload.bankBranch }),
      ...(payload.upiId !== undefined && { upiId: payload.upiId }),
      ...(payload.paymentInstructions !== undefined && { paymentInstructions: payload.paymentInstructions }),

      ...(payload.authorizedSignatoryName !== undefined && { authorizedSignatoryName: payload.authorizedSignatoryName }),
      ...(payload.authorizedSignatoryDesignation !== undefined && { authorizedSignatoryDesignation: payload.authorizedSignatoryDesignation }),
      ...(payload.authorizedSignatoryEmail !== undefined && { authorizedSignatoryEmail: payload.authorizedSignatoryEmail }),
      ...(payload.authorizedSignatoryPhone !== undefined && { authorizedSignatoryPhone: payload.authorizedSignatoryPhone }),
      ...(payload.authorizedSignatorySignatureUrl !== undefined && { authorizedSignatorySignatureUrl: payload.authorizedSignatorySignatureUrl }),
    };

    // Build valid Prisma columns only
    const updateData: any = {
      ...(payload.name !== undefined && { name: payload.name }),
      ...(payload.industry !== undefined && { industry: payload.industry }),
      ...(payload.businessType !== undefined && { businessType: payload.businessType }),
      ...(payload.country !== undefined && { country: payload.country }),
      ...(payload.timezone !== undefined && { timezone: payload.timezone }),
      ...(payload.currency !== undefined && { currency: payload.currency ? payload.currency.toUpperCase() : 'INR' }),
      ...(payload.website !== undefined && { website: payload.website }),
      ...(payload.description !== undefined && { description: payload.description }),
      contactInfo: mergedContact,
      preferences: mergedPrefs
    };

    const updated = await prisma.business.update({
      where: { id: businessId },
      data: updateData
    });

    return this.flattenProfile(updated, true);
  }
}
