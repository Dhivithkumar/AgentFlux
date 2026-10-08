export interface ProductDefinition {
  sku: string;
  productName: string;
  category: string;
  material: string;
  basePrice: number;
  currency: string;
  productionDays: number;
  warranty: string;
  description: string;
  sourceDocument: string;
  section: string;
  aliases: string[];
  normalizedProductName?: string;
  normalizedAliases?: string[];
}

export interface CustomizationDefinition {
  id: string;
  option: string;
  standardCharge: number | null; // null if quote separately
  chargeDescription: string;
  leadTimeImpact: string;
  approvalRequired: string;
  category: 'WARDROBE' | 'DINING' | 'SOFA' | 'GENERAL';
  sourceDocument: string;
  aliases: string[];
}

export interface PricingChargeDefinition {
  chargeName: string;
  rule: string;
  amount: number | null;
  sourceDocument: string;
}

export interface ApprovalTier {
  category: string;
  condition: string;
  requiredApprover: string;
  minVal?: number;
  maxVal?: number;
}

export const AASHA_BUSINESS_ID = '1379ce47-39e9-4742-9034-dfe218b6c0fc';

export const AASHA_TAX_CONFIG = {
  taxName: 'GST',
  configuredTestTaxRate: 0.12, // 12% test rate
  taxRatePercentage: 12,
  isAuthoritative: true,
  sourceDocument: '11_Invoice_Tax_Policy.pdf'
};

export const AASHA_PRODUCTS: ProductDefinition[] = [
  {
    sku: 'SOF-001',
    productName: 'Classic Teak 3-Seater Sofa',
    category: 'Sofa',
    material: 'Teak frame + upholstery',
    basePrice: 45000,
    currency: 'INR',
    productionDays: 10,
    warranty: '3 years',
    description: 'Solid teak-frame sofa intended for premium residential living rooms. Standard upholstery is included; fabric upgrades are charged separately.',
    sourceDocument: '02_Product_Catalogue.pdf',
    section: 'Catalogue',
    aliases: ['classic teak sofa', 'classic teak 3 seater sofa', 'classic 3 seater sofa', 'teak sofa', 'sof-001', 'classic teak']
  },
  {
    sku: 'SOF-002',
    productName: 'Modern 3-Seater Sofa',
    category: 'Sofa',
    material: 'Engineered wood + upholstery',
    basePrice: 38000,
    currency: 'INR',
    productionDays: 7,
    warranty: '2 years',
    description: 'Modern 3-seater sofa with engineered wood frame and contemporary upholstery.',
    sourceDocument: '02_Product_Catalogue.pdf',
    section: 'Catalogue',
    aliases: ['modern sofa', 'modern 3 seater sofa', 'modern 3-seater', 'sof-002']
  },
  {
    sku: 'BED-001',
    productName: 'King Size Teak Bed',
    category: 'Bedroom',
    material: 'Teak wood',
    basePrice: 52000,
    currency: 'INR',
    productionDays: 12,
    warranty: '5 years',
    description: 'King-size teak bed with standard headboard and polish. Mattress is not included.',
    sourceDocument: '02_Product_Catalogue.pdf',
    section: 'Catalogue',
    aliases: ['king size bed', 'king bed', 'king size teak bed', 'teak king bed', 'bed-001']
  },
  {
    sku: 'BED-002',
    productName: 'Queen Size Teak Bed',
    category: 'Bedroom',
    material: 'Teak wood',
    basePrice: 42000,
    currency: 'INR',
    productionDays: 10,
    warranty: '5 years',
    description: 'Queen-size teak bed with standard headboard and polish. Mattress is not included.',
    sourceDocument: '02_Product_Catalogue.pdf',
    section: 'Catalogue',
    aliases: ['queen size bed', 'queen bed', 'queen size teak bed', 'teak queen bed', 'bed-002']
  },
  {
    sku: 'DIN-001',
    productName: '6-Seater Dining Table',
    category: 'Dining',
    material: 'Teak wood',
    basePrice: 32000,
    currency: 'INR',
    productionDays: 8,
    warranty: '3 years',
    description: 'Six-seater rectangular teak dining table. Standard dimensions are 1800 mm × 900 mm × 760 mm.',
    sourceDocument: '02_Product_Catalogue.pdf',
    section: 'Catalogue',
    aliases: ['6-seater dining table', '6 seater dining table', 'six seater dining table', '6 seater table', 'six-seater dining table', 'din-001']
  },
  {
    sku: 'DIN-002',
    productName: 'Dining Chair',
    category: 'Dining',
    material: 'Teak wood + upholstery',
    basePrice: 5500,
    currency: 'INR',
    productionDays: 5,
    warranty: '2 years',
    description: 'Dining chair with teak wood frame and standard upholstery.',
    sourceDocument: '02_Product_Catalogue.pdf',
    section: 'Catalogue',
    aliases: ['dining chair', 'teak dining chair', 'din-002', 'teak chair']

  },
  {
    sku: 'WAR-001',
    productName: '3-Door Wardrobe',
    category: 'Storage',
    material: 'Engineered wood',
    basePrice: 28000,
    currency: 'INR',
    productionDays: 9,
    warranty: '2 years',
    description: 'Three-door wardrobe with standard shelves and hanging section. Internal accessories are optional.',
    sourceDocument: '02_Product_Catalogue.pdf',
    section: 'Catalogue',
    aliases: ['3 door wardrobe', '3-door wardrobe', 'three door wardrobe', 'wardrobe 3 door', '3door wardrobe', 'war-001', 'three-door wardrobe']
  },
  {
    sku: 'OFF-001',
    productName: 'Executive Office Table',
    category: 'Office',
    material: 'Engineered wood + laminate',
    basePrice: 18000,
    currency: 'INR',
    productionDays: 6,
    warranty: '2 years',
    description: 'Executive office table with engineered wood and premium laminate finish.',
    sourceDocument: '02_Product_Catalogue.pdf',
    section: 'Catalogue',
    aliases: ['office table', 'executive table', 'executive office table', 'off-001']
  }
];

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10'
};

const SYNONYMS: Record<string, string> = {
  almirah: 'wardrobe',
  cupboard: 'wardrobe',
  closet: 'wardrobe',
  doors: 'door'
};

export function normalizeEntityText(text: string): string {
  let normalized = text.toLowerCase();
  
  // 1. Number normalization
  for (const [word, num] of Object.entries(NUMBER_WORDS)) {
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    normalized = normalized.replace(regex, num);
  }
  
  // 2. Punctuation normalization (replace hyphens and punctuation with spaces)
  normalized = normalized.replace(/[^a-z0-9]/g, ' ');
  
  // 3. Separate numbers from words (e.g. "3door" -> "3 door")
  normalized = normalized.replace(/(\d)([a-z])/g, '$1 $2');
  normalized = normalized.replace(/([a-z])(\d)/g, '$1 $2');
  
  // 4. Synonym/Alias normalization
  for (const [synonym, standard] of Object.entries(SYNONYMS)) {
    const regex = new RegExp(`\\b${synonym}\\b`, 'g');
    normalized = normalized.replace(regex, standard);
  }
  
  // 5. Condense spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

// Generate normalized representations for every product during module load (simulated ingestion)
AASHA_PRODUCTS.forEach(p => {
  p.normalizedProductName = normalizeEntityText(p.productName);
  p.normalizedAliases = p.aliases.map(a => normalizeEntityText(a));
});

export const AASHA_CUSTOMIZATIONS: CustomizationDefinition[] = [
  {
    id: 'premium_teak_polish',
    option: 'Premium teak polish',
    standardCharge: 4500,
    chargeDescription: '₹4,500 per item',
    leadTimeImpact: '0–2 days',
    approvalRequired: 'Sales',
    category: 'GENERAL',
    sourceDocument: '03_Product_Customization_Guide.pdf',
    aliases: ['premium polish', 'premium teak polish', 'teak polish', 'extra polish']
  },
  {
    id: 'premium_upholstery_fabric',
    option: 'Premium upholstery fabric',
    standardCharge: 6000,
    chargeDescription: '₹6,000 per sofa',
    leadTimeImpact: '1–2 days',
    approvalRequired: 'Sales',
    category: 'SOFA',
    sourceDocument: '03_Product_Customization_Guide.pdf',
    aliases: ['premium upholstery', 'premium fabric', 'upholstery upgrade', 'fabric upgrade']
  },
  {
    id: 'custom_table_size_up_to_2100x1000',
    option: 'Custom table size up to 2100×1000 mm',
    standardCharge: 8000,
    chargeDescription: '₹8,000',
    leadTimeImpact: '2 days',
    approvalRequired: 'Operations',
    category: 'DINING',
    sourceDocument: '03_Product_Customization_Guide.pdf',
    aliases: ['2100x1000', '2100×1000', 'custom size 2100x1000', 'custom size up to 2100x1000 mm', 'custom size 2100*1000']
  },
  {
    id: 'custom_table_size_above_2100x1000',
    option: 'Custom table size above 2100×1000 mm',
    standardCharge: null,
    chargeDescription: 'Quote separately',
    leadTimeImpact: '3+ days',
    approvalRequired: 'Operations + Manager',
    category: 'DINING',
    sourceDocument: '03_Product_Customization_Guide.pdf',
    aliases: ['custom table size above 2100x1000', 'larger table size', 'above 2100x1000']
  },
  {
    id: 'soft_close_wardrobe_hardware',
    option: 'Soft-close wardrobe hardware',
    standardCharge: 3500,
    chargeDescription: '₹3,500',
    leadTimeImpact: '1 day',
    approvalRequired: 'Sales',
    category: 'WARDROBE',
    sourceDocument: '03_Product_Customization_Guide.pdf',
    aliases: ['soft close', 'soft-close', 'soft-close hardware', 'soft close wardrobe hardware']
  },
  {
    id: 'additional_wardrobe_drawer',
    option: 'Additional wardrobe drawer',
    standardCharge: 1800,
    chargeDescription: '₹1,800 each',
    leadTimeImpact: '1 day',
    approvalRequired: 'Sales',
    category: 'WARDROBE',
    sourceDocument: '03_Product_Customization_Guide.pdf',
    aliases: ['additional drawer', 'extra drawer', 'additional wardrobe drawer', 'extra wardrobe drawer']
  },
  {
    id: 'custom_colour_finish',
    option: 'Custom colour/finish not in catalogue',
    standardCharge: null,
    chargeDescription: 'Quote separately',
    leadTimeImpact: '2+ days',
    approvalRequired: 'Operations',
    category: 'GENERAL',
    sourceDocument: '03_Product_Customization_Guide.pdf',
    aliases: ['custom colour', 'custom color', 'custom finish', 'unlisted colour']
  }
];

export const AASHA_RATE_CARD: PricingChargeDefinition[] = [
  {
    chargeName: 'Delivery within Coimbatore city',
    rule: '₹1,500 per order up to 3 standard items; larger/custom loads quoted separately',
    amount: 1500,
    sourceDocument: '04_Pricing_Rate_Card.pdf'
  },
  {
    chargeName: 'Installation',
    rule: '₹750 per standard furniture item; complex installation quoted separately',
    amount: 750,
    sourceDocument: '04_Pricing_Rate_Card.pdf'
  },
  {
    chargeName: 'Site measurement',
    rule: '₹500; waived if an order is confirmed within 7 days',
    amount: 500,
    sourceDocument: '04_Pricing_Rate_Card.pdf'
  },
  {
    chargeName: 'Express production',
    rule: 'Not automatically available; Operations must confirm capacity and quote surcharge',
    amount: null,
    sourceDocument: '04_Pricing_Rate_Card.pdf'
  }
];

export const AASHA_DISCOUNT_RULES: ApprovalTier[] = [
  { category: 'Discount', condition: '0%–5%', requiredApprover: 'Sales Executive', minVal: 0, maxVal: 5 },
  { category: 'Discount', condition: '>5%–10%', requiredApprover: 'Sales Manager', minVal: 5.001, maxVal: 10 },
  { category: 'Discount', condition: '>10%–15%', requiredApprover: 'Owner', minVal: 10.001, maxVal: 15 },
  { category: 'Discount', condition: '>15%', requiredApprover: 'Owner exception', minVal: 15.001, maxVal: 100 }
];

export const AASHA_ORDER_VALUE_RULES: ApprovalTier[] = [
  { category: 'Order Value', condition: 'Up to ₹1,00,000', requiredApprover: 'Sales authority', minVal: 0, maxVal: 100000 },
  { category: 'Order Value', condition: '>₹1,00,000–₹3,00,000', requiredApprover: 'Manager', minVal: 100000.01, maxVal: 300000 },
  { category: 'Order Value', condition: '>₹3,00,000', requiredApprover: 'Owner', minVal: 300000.01, maxVal: Infinity }
];

export const AASHA_REFUND_RULES: ApprovalTier[] = [
  { category: 'Refund', condition: 'Up to ₹10,000', requiredApprover: 'Finance', minVal: 0, maxVal: 10000 },
  { category: 'Refund', condition: '>₹10,000', requiredApprover: 'Owner', minVal: 10000.01, maxVal: Infinity }
];

export const AASHA_POLICY_DOCUMENTS = [
  { code: '01', name: '01_Company_Profile.pdf', title: 'Company Profile & Business Context' },
  { code: '02', name: '02_Product_Catalogue.pdf', title: 'Product Catalogue & Master Product Data' },
  { code: '03', name: '03_Product_Customization_Guide.pdf', title: 'Product Customization & Configuration Guide' },
  { code: '04', name: '04_Pricing_Rate_Card.pdf', title: 'Pricing, Charges & Rate Card' },
  { code: '05', name: '05_Discount_Policy.pdf', title: 'Discount & Price Override Policy' },
  { code: '06', name: '06_Quotation_Policy.pdf', title: 'Quotation Policy & Procedure' },
  { code: '07', name: '07_Order_Booking_Policy.pdf', title: 'Order & Booking Management Policy' },
  { code: '08', name: '08_Production_Policy.pdf', title: 'Production & Quality Control Policy' },
  { code: '09', name: '09_Delivery_Installation_Policy.pdf', title: 'Delivery & Installation Policy' },
  { code: '10', name: '10_Payment_Policy.pdf', title: 'Payment, Credit & Reconciliation Policy' },
  { code: '11', name: '11_Invoice_Tax_Policy.pdf', title: 'Invoice, Billing & Tax Policy' },
  { code: '12', name: '12_Payment_Reminder_Collections_Policy.pdf', title: 'Payment Due, Reminder & Collections Policy' },
  { code: '13', name: '13_Approval_Governance_Matrix.pdf', title: 'Approval, Risk & Governance Matrix' },
  { code: '15', name: '15_Return_Cancellation_Refund_Policy.pdf', title: 'Returns, Cancellation & Refund Policy' },
  { code: 'INV_TPL', name: 'Aasha_Furniture_Invoice_Template.docx', title: 'Aasha Furniture Invoice Template' },
  { code: 'QUO_TPL', name: 'Aasha_Furniture_Quotation_Template.docx', title: 'Aasha Furniture Quotation Template' }
];
