import { prisma, Role } from '@agent-flux/database';

export interface BusinessConfigurationPayload {
  enabledModules?: string[];
  locations?: Array<{ id?: string; name: string; address?: string; isPrimary?: boolean }>;
  productsAndServices?: Array<{
    id?: string;
    sku?: string;
    name: string;
    category?: string;
    basePrice?: number;
    description?: string;
    leadTimeDays?: number;
  }>;
  customTerminology?: {
    customerLabel?: string;     // e.g. "Client", "Patient", "Customer", "Buyer"
    orderLabel?: string;        // e.g. "Order", "Booking", "Project", "Consultation"
    enquiryLabel?: string;      // e.g. "Enquiry", "Lead", "Ticket", "Referral"
    quotationLabel?: string;    // e.g. "Quotation", "Proposal", "Estimate", "Treatment Plan"
    invoiceLabel?: string;      // e.g. "Invoice", "Bill", "Fee Statement"
    productLabel?: string;      // e.g. "Product", "Service", "Package", "Treatment"
  };
  financialConfig?: {
    currency?: string;          // strictly "INR" (Rupees)
    locale?: string;            // strictly "en-IN"
    timezone?: string;          // e.g. "America/New_York", "Asia/Kolkata", "UTC"
    taxName?: string;           // e.g. "GST", "VAT", "Sales Tax", "None"
    defaultTaxRate?: number;    // e.g. 18, 20, 8.5, 0
    taxRegistrationNumber?: string; // e.g. GSTIN, VAT ID
    isTaxRegistered?: boolean;
    paymentTerms?: string;      // e.g. "50% Advance, 50% on Delivery", "Net 30", "100% Upfront"
  };
  numberingPreferences?: {
    quotationPrefix?: string;   // e.g. "QTN-", "PROP-"
    orderPrefix?: string;       // e.g. "ORD-", "BKG-"
    invoicePrefix?: string;     // e.g. "INV-", "BIL-"
    digits?: number;            // e.g. 4 or 5
  };
  departmentsAndRoles?: Array<{
    name: string;
    roles: string[];
    approvalAuthorities?: string[];
  }>;
  desiredOutcomes?: {
    primaryGoals?: string[];    // e.g. "Automate lead intake", "Faster quote generation", "Payment reminders"
    operationalPainPoints?: string[];
    targetTurnaroundHours?: number;
  };
  communicationChannels?: {
    primaryEmail?: string;
    supportEmail?: string;
    phone?: string;
    whatsappNumber?: string;
    sendCustomerAutoReplies?: boolean;
    customerNotificationChannels?: string[]; // ["EMAIL", "SMS", "WHATSAPP"]
  };
  documentPreferences?: {
    primaryColor?: string;
    secondaryColor?: string;
    logoUrl?: string;
    headerText?: string;
    footerText?: string;
    termsAndConditions?: string;
    requiredDocumentTypes?: string[]; // ["QUOTATION", "INVOICE", "CONTRACT", "RECEIPT"]
  };
  approvalRules?: {
    requiresOwnerApprovalForOrdersAbove?: number;
    discountApprovalTiers?: Array<{ maxDiscountPercent: number; requiredRole: string }>;
    creditSalesRequireApproval?: boolean;
    refundsRequireApproval?: boolean;
  };
  dashboardPreferences?: {
    visibleKpiCards?: string[];
    visibleActionZoneAlerts?: string[];
    defaultDateRange?: string;
  };
  onboardingStep?: number;
  onboardingStatus?: string;
}

export class BusinessConfigurationService {
  /**
   * Get or initialize business configuration
   */
  static async getConfiguration(businessId: string) {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { configuration: true, memberships: { include: { user: true } } }
    });

    if (!business) {
      throw new Error(`Business ${businessId} not found`);
    }

    if (business.configuration) {
      return {
        business: {
          id: business.id,
          name: business.name,
          industry: business.industry,
          businessType: business.businessType,
          currency: 'INR',
          timezone: business.timezone || 'Asia/Kolkata',
          website: business.website,
          description: business.description
        },
        configuration: business.configuration
      };
    }

    // Auto-create default configuration if absent
    const defaultConfig = await prisma.businessConfiguration.create({
      data: {
        businessId,
        enabledModules: [
          'LEAD_INTAKE',
          'QUOTATIONS',
          'ORDERS',
          'INVOICING',
          'PAYMENTS',
          'DOCUMENTS'
        ],
        locations: [
          { name: 'Headquarters', isPrimary: true }
        ],
        productsAndServices: [],
        customTerminology: {
          customerLabel: 'Customer',
          orderLabel: 'Order',
          enquiryLabel: 'Enquiry',
          quotationLabel: 'Quotation',
          invoiceLabel: 'Invoice',
          productLabel: 'Product'
        },
        financialConfig: {
          currency: 'INR',
          locale: 'en-IN',
          timezone: 'Asia/Kolkata',
          taxName: 'GST',
          defaultTaxRate: 18,
          isTaxRegistered: false,
          paymentTerms: 'Due on Receipt'
        },
        numberingPreferences: {
          quotationPrefix: 'QTN-',
          orderPrefix: 'ORD-',
          invoicePrefix: 'INV-',
          digits: 5
        },
        departmentsAndRoles: [
          { name: 'Management', roles: ['OWNER'], approvalAuthorities: ['ALL'] },
          { name: 'Operations', roles: ['MEMBER'], approvalAuthorities: ['STANDARD_OPERATIONS'] }
        ],
        desiredOutcomes: {
          primaryGoals: ['Fast Customer Responses', 'Automated Record Keeping'],
          targetTurnaroundHours: 24
        },
        communicationChannels: {
          sendCustomerAutoReplies: true,
          customerNotificationChannels: ['EMAIL']
        },
        documentPreferences: {
          requiredDocumentTypes: ['QUOTATION', 'INVOICE']
        },
        approvalRules: {
          requiresOwnerApprovalForOrdersAbove: 50000,
          discountApprovalTiers: [
            { maxDiscountPercent: 5, requiredRole: 'MEMBER' },
            { maxDiscountPercent: 15, requiredRole: 'OWNER' }
          ],
          creditSalesRequireApproval: true,
          refundsRequireApproval: true
        },
        dashboardPreferences: {
          visibleKpiCards: ['REVENUE', 'PENDING_ACTIONS', 'ACTIVE_WORKFLOWS', 'RECENT_ACTIVITY'],
          visibleActionZoneAlerts: ['PENDING_APPROVALS', 'FAILED_RUNS', 'INTEGRATION_HEALTH']
        },
        onboardingStep: 1,
        onboardingStatus: 'DRAFT'
      }
    });

    return {
      business: {
        id: business.id,
        name: business.name,
        industry: business.industry,
        businessType: business.businessType,
        currency: 'INR',
        timezone: business.timezone || 'Asia/Kolkata',
        website: business.website,
        description: business.description
      },
      configuration: defaultConfig
    };
  }

  /**
   * Save draft or partial updates during any onboarding step
   */
  static async updateConfiguration(businessId: string, payload: BusinessConfigurationPayload) {
    const existing = await this.getConfiguration(businessId);
    const currentConfig = existing.configuration;

    // Merge JSON sections safely without overwriting unspecified subfields
    const updatedData: any = {
      updatedAt: new Date()
    };

    if (payload.enabledModules !== undefined) {
      updatedData.enabledModules = payload.enabledModules;
    }
    if (payload.locations !== undefined) {
      updatedData.locations = payload.locations;
    }
    if (payload.productsAndServices !== undefined) {
      updatedData.productsAndServices = payload.productsAndServices;
    }
    if (payload.customTerminology !== undefined) {
      updatedData.customTerminology = {
        ...((currentConfig.customTerminology as any) || {}),
        ...payload.customTerminology
      };
    }
    if (payload.financialConfig !== undefined) {
      updatedData.financialConfig = {
        ...((currentConfig.financialConfig as any) || {}),
        ...payload.financialConfig
      };

      // Keep top-level business currency and timezone in sync
      const bizUpdates: any = {};
      if (payload.financialConfig.currency) bizUpdates.currency = payload.financialConfig.currency;
      if (payload.financialConfig.timezone) bizUpdates.timezone = payload.financialConfig.timezone;
      if (Object.keys(bizUpdates).length > 0) {
        await prisma.business.update({
          where: { id: businessId },
          data: bizUpdates
        });
      }
    }
    if (payload.numberingPreferences !== undefined) {
      updatedData.numberingPreferences = {
        ...((currentConfig.numberingPreferences as any) || {}),
        ...payload.numberingPreferences
      };
    }
    if (payload.departmentsAndRoles !== undefined) {
      updatedData.departmentsAndRoles = payload.departmentsAndRoles;
    }
    if (payload.desiredOutcomes !== undefined) {
      updatedData.desiredOutcomes = {
        ...((currentConfig.desiredOutcomes as any) || {}),
        ...payload.desiredOutcomes
      };
    }
    if (payload.communicationChannels !== undefined) {
      updatedData.communicationChannels = {
        ...((currentConfig.communicationChannels as any) || {}),
        ...payload.communicationChannels
      };
    }
    if (payload.documentPreferences !== undefined) {
      updatedData.documentPreferences = {
        ...((currentConfig.documentPreferences as any) || {}),
        ...payload.documentPreferences
      };
    }
    if (payload.approvalRules !== undefined) {
      updatedData.approvalRules = {
        ...((currentConfig.approvalRules as any) || {}),
        ...payload.approvalRules
      };
    }
    if (payload.dashboardPreferences !== undefined) {
      updatedData.dashboardPreferences = {
        ...((currentConfig.dashboardPreferences as any) || {}),
        ...payload.dashboardPreferences
      };
    }
    if (payload.onboardingStep !== undefined) {
      updatedData.onboardingStep = payload.onboardingStep;
    }
    if (payload.onboardingStatus !== undefined) {
      updatedData.onboardingStatus = payload.onboardingStatus;
    }

    const saved = await prisma.businessConfiguration.update({
      where: { businessId },
      data: updatedData
    });

    return {
      businessId,
      configuration: saved
    };
  }

  /**
   * Evaluate readiness and produce a comprehensive requirements review payload
   */
  static async reviewConfiguration(businessId: string) {
    const { business, configuration } = await this.getConfiguration(businessId);

    const blockers: string[] = [];
    const warnings: string[] = [];

    // Check mandatory essentials
    if (!business.name || business.name.trim().length === 0) {
      blockers.push('Business name is required.');
    }
    if (!business.industry || business.industry.trim().length === 0) {
      blockers.push('Industry category is required.');
    }

    const fin = (configuration.financialConfig as any) || {};
    if (!fin.currency) {
      blockers.push('Operating currency must be specified.');
    }

    // Optional recommendations
    const terms = (configuration.customTerminology as any) || {};
    if (!terms.customerLabel) {
      warnings.push('Customer terminology not set (defaulting to "Customer").');
    }

    const prods = (configuration.productsAndServices as any[]) || [];
    if (prods.length === 0) {
      warnings.push('No products or services defined. You can add them later or upload a knowledge base document.');
    }

    const channels = (configuration.communicationChannels as any) || {};
    if (!channels.primaryEmail) {
      warnings.push('Primary communication email is not set.');
    }

    const docPref = (configuration.documentPreferences as any) || {};
    if (!docPref.requiredDocumentTypes || docPref.requiredDocumentTypes.length === 0) {
      warnings.push('No document types selected (defaulting to Quotations & Invoices).');
    }

    const isReady = blockers.length === 0;

    // Transition status to REVIEW_REQUIRED if currently DRAFT
    if (isReady && configuration.onboardingStatus === 'DRAFT') {
      const updated = await prisma.businessConfiguration.update({
        where: { businessId },
        data: { onboardingStatus: 'REVIEW_REQUIRED' }
      });
      configuration.onboardingStatus = updated.onboardingStatus;
    }

    return {
      readyForConfirmation: isReady,
      blockers,
      warnings,
      business,
      configuration,
      summary: {
        businessName: business.name,
        industry: business.industry,
        currency: fin.currency || 'INR',
        locale: fin.locale || 'en-IN',
        taxName: fin.taxName || 'GST',
        defaultTaxRate: fin.defaultTaxRate ?? 18,
        enabledModules: configuration.enabledModules || [],
        productsCount: prods.length,
        terminology: terms,
        onboardingStatus: isReady ? 'REVIEW_REQUIRED' : configuration.onboardingStatus
      }
    };
  }

  /**
   * Explicit confirmation and lock by business owner before enabling automation
   */
  static async confirmConfiguration(businessId: string, userId: string) {
    // 1. Verify user is owner
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId, businessId } }
    });

    if (!membership || membership.role !== Role.OWNER) {
      throw new Error('Only the business owner can confirm and activate configuration.');
    }

    // 2. Validate review requirements
    const review = await this.reviewConfiguration(businessId);
    if (!review.readyForConfirmation) {
      throw new Error(`Cannot confirm configuration due to blockers: ${review.blockers.join(', ')}`);
    }

    // 3. Lock configuration
    const confirmed = await prisma.businessConfiguration.update({
      where: { businessId },
      data: {
        onboardingStatus: 'COMPLETED',
        reviewedAndConfirmedAt: new Date()
      }
    });

    // 4. Record audit log
    await prisma.auditLog.create({
      data: {
        businessId,
        userId,
        eventType: 'BUSINESS_REQUIREMENTS_CONFIRMED'
      }
    });

    return {
      success: true,
      businessId,
      status: 'COMPLETED',
      confirmedAt: confirmed.reviewedAndConfirmedAt,
      enabledModules: confirmed.enabledModules,
      message: 'Business requirements successfully reviewed, confirmed, and locked.'
    };
  }
}
