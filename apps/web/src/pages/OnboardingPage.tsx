import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../lib/api';
import {
  Building2,
  Tag,
  DollarSign,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Save,
  AlertTriangle,
  Plus,
  Trash2,
  Sparkles,
  FileText,
  Mail,
  Layers,
  HelpCircle,
  Lock
} from 'lucide-react';

interface LocationItem {
  id?: string;
  name: string;
  address?: string;
  isPrimary?: boolean;
}

interface ProductItem {
  id?: string;
  sku?: string;
  name: string;
  category?: string;
  basePrice?: number;
  description?: string;
  leadTimeDays?: number;
}

interface DiscountTier {
  maxDiscountPercent: number;
  requiredRole: string;
}

const INDUSTRY_PRESETS: Record<string, any> = {
  'Custom Furniture & Woodworking': {
    terminology: { customerLabel: 'Customer', orderLabel: 'Order', enquiryLabel: 'Enquiry', quotationLabel: 'Quotation', invoiceLabel: 'Invoice', productLabel: 'Furniture Piece' },
    modules: ['LEAD_INTAKE', 'QUOTATIONS', 'ORDERS', 'INVOICING', 'PAYMENTS', 'DOCUMENTS'],
    terms: '50% advance before production, 50% balance before delivery',
    prefixes: { quotationPrefix: 'QTN-', orderPrefix: 'ORD-', invoicePrefix: 'INV-' }
  },
  'Medical & Healthcare Clinic': {
    terminology: { customerLabel: 'Patient', orderLabel: 'Consultation', enquiryLabel: 'Appointment Request', quotationLabel: 'Treatment Plan', invoiceLabel: 'Fee Statement', productLabel: 'Treatment' },
    modules: ['LEAD_INTAKE', 'APPOINTMENTS', 'INVOICING', 'PAYMENTS', 'DOCUMENTS', 'CUSTOM_RECORDS'],
    terms: 'Payment due on receipt of treatment or service',
    prefixes: { quotationPrefix: 'PLAN-', orderPrefix: 'CONS-', invoicePrefix: 'MED-' }
  },
  'Professional Consulting & Legal': {
    terminology: { customerLabel: 'Client', orderLabel: 'Engagement', enquiryLabel: 'Consultation Request', quotationLabel: 'Proposal', invoiceLabel: 'Invoice', productLabel: 'Service Offering' },
    modules: ['LEAD_INTAKE', 'QUOTATIONS', 'ORDERS', 'INVOICING', 'PAYMENTS', 'DOCUMENTS'],
    terms: 'Net 30 days from invoice issue date',
    prefixes: { quotationPrefix: 'PROP-', orderPrefix: 'ENG-', invoicePrefix: 'INV-' }
  },
  'E-Commerce & Retail Distribution': {
    terminology: { customerLabel: 'Buyer', orderLabel: 'Order', enquiryLabel: 'Product Enquiry', quotationLabel: 'Price Quote', invoiceLabel: 'Receipt', productLabel: 'Product' },
    modules: ['LEAD_INTAKE', 'ORDERS', 'INVOICING', 'PAYMENTS', 'CUSTOM_RECORDS'],
    terms: '100% upfront digital payment prior to dispatch',
    prefixes: { quotationPrefix: 'QUO-', orderPrefix: 'ORD-', invoicePrefix: 'RCP-' }
  }
};

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<any>(null);

  // Form State
  const [businessInfo, setBusinessInfo] = useState({
    name: '',
    industry: 'Custom Furniture & Woodworking',
    businessType: 'Private Company',
    website: '',
    description: ''
  });

  const [locations, setLocations] = useState<LocationItem[]>([
    { name: 'Main Facility', address: '', isPrimary: true }
  ]);

  const [products, setProducts] = useState<ProductItem[]>([]);

  const [terminology, setTerminology] = useState({
    customerLabel: 'Customer',
    orderLabel: 'Order',
    enquiryLabel: 'Enquiry',
    quotationLabel: 'Quotation',
    invoiceLabel: 'Invoice',
    productLabel: 'Product'
  });

  const [financials, setFinancials] = useState({
    currency: 'INR',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    taxName: 'GST',
    defaultTaxRate: 18,
    taxRegistrationNumber: '',
    isTaxRegistered: false,
    paymentTerms: 'Due on Receipt'
  });

  const [numbering, setNumbering] = useState({
    quotationPrefix: 'QTN-',
    orderPrefix: 'ORD-',
    invoicePrefix: 'INV-',
    digits: 5
  });

  const [enabledModules, setEnabledModules] = useState<string[]>([
    'LEAD_INTAKE',
    'QUOTATIONS',
    'ORDERS',
    'INVOICING',
    'PAYMENTS',
    'DOCUMENTS'
  ]);

  const [approvalRules, setApprovalRules] = useState({
    requiresOwnerApprovalForOrdersAbove: 50000,
    creditSalesRequireApproval: true,
    refundsRequireApproval: true,
    discountTiers: [
      { maxDiscountPercent: 5, requiredRole: 'MEMBER' },
      { maxDiscountPercent: 15, requiredRole: 'OWNER' }
    ] as DiscountTier[]
  });

  const [communications, setCommunications] = useState({
    primaryEmail: '',
    supportEmail: '',
    phone: '',
    sendCustomerAutoReplies: true
  });

  const [documentPreferences, setDocumentPreferences] = useState({
    primaryColor: '#2563eb',
    termsAndConditions: 'Standard commercial warranty terms apply.',
    requiredDocumentTypes: ['QUOTATION', 'INVOICE']
  });

  // Load existing business or initialize
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const res = await apiCall('/businesses');
        const businesses = res.data || [];

        let activeBizId = businesses.length > 0 ? businesses[0].id : null;

        if (activeBizId) {
          setBusinessId(activeBizId);
          // Fetch existing configuration
          const confRes = await apiCall(`/businesses/${activeBizId}/configuration`);
          if (confRes.data) {
            const biz = confRes.data.business;
            const conf = confRes.data.configuration;

            setBusinessInfo({
              name: biz.name || '',
              industry: biz.industry || 'Custom Furniture & Woodworking',
              businessType: biz.businessType || 'Private Company',
              website: biz.website || '',
              description: biz.description || ''
            });

            if (conf.locations && conf.locations.length > 0) setLocations(conf.locations);
            if (conf.productsAndServices) setProducts(conf.productsAndServices);
            if (conf.customTerminology) setTerminology(prev => ({ ...prev, ...conf.customTerminology }));
            if (conf.financialConfig) setFinancials(prev => ({ ...prev, ...conf.financialConfig }));
            if (conf.numberingPreferences) setNumbering(prev => ({ ...prev, ...conf.numberingPreferences }));
            if (conf.enabledModules) setEnabledModules(conf.enabledModules);
            if (conf.approvalRules) {
              setApprovalRules({
                requiresOwnerApprovalForOrdersAbove: conf.approvalRules.requiresOwnerApprovalForOrdersAbove ?? 50000,
                creditSalesRequireApproval: conf.approvalRules.creditSalesRequireApproval ?? true,
                refundsRequireApproval: conf.approvalRules.refundsRequireApproval ?? true,
                discountTiers: conf.approvalRules.discountApprovalTiers || [
                  { maxDiscountPercent: 5, requiredRole: 'MEMBER' },
                  { maxDiscountPercent: 15, requiredRole: 'OWNER' }
                ]
              });
            }
            if (conf.communicationChannels) setCommunications(prev => ({ ...prev, ...conf.communicationChannels }));
            if (conf.documentPreferences) setDocumentPreferences(prev => ({ ...prev, ...conf.documentPreferences }));
            if (conf.onboardingStep) setCurrentStep(conf.onboardingStep);

            // If already completed, user can still inspect or re-confirm
            if (conf.onboardingStatus === 'COMPLETED') {
              setCurrentStep(7); // Review step
            }
          }
        }
      } catch (e: any) {
        console.error('Initialization error:', e);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const applyIndustryPreset = (presetName: string) => {
    const preset = INDUSTRY_PRESETS[presetName];
    if (!preset) return;
    setBusinessInfo(prev => ({ ...prev, industry: presetName }));
    setTerminology(prev => ({ ...prev, ...preset.terminology }));
    setEnabledModules(preset.modules);
    setFinancials(prev => ({ ...prev, paymentTerms: preset.terms }));
    setNumbering(prev => ({ ...prev, ...preset.prefixes }));
  };

  const handleSaveStep = async (nextStep?: number) => {
    setError(null);
    setSaving(true);
    try {
      let currentBizId = businessId;

      // Create business if not yet created
      if (!currentBizId) {
        if (!businessInfo.name) {
          throw new Error('Business name is required to begin.');
        }
        const createRes = await apiCall('/businesses', {
          method: 'POST',
          body: JSON.stringify({
            name: businessInfo.name,
            industry: businessInfo.industry,
            businessType: businessInfo.businessType,
            website: businessInfo.website,
            description: businessInfo.description
          })
        });
        currentBizId = createRes.data.id;
        setBusinessId(currentBizId);
      } else {
        // Update top-level business fields
        await apiCall(`/businesses/${currentBizId}/profile`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: businessInfo.name,
            industry: businessInfo.industry,
            businessType: businessInfo.businessType,
            website: businessInfo.website,
            description: businessInfo.description
          })
        });
      }

      const targetStep = nextStep !== undefined ? nextStep : currentStep;

      // Save configuration payload
      await apiCall(`/businesses/${currentBizId}/configuration`, {
        method: 'PATCH',
        body: JSON.stringify({
          onboardingStep: targetStep,
          locations,
          productsAndServices: products,
          customTerminology: terminology,
          financialConfig: financials,
          numberingPreferences: numbering,
          enabledModules,
          approvalRules: {
            requiresOwnerApprovalForOrdersAbove: approvalRules.requiresOwnerApprovalForOrdersAbove,
            creditSalesRequireApproval: approvalRules.creditSalesRequireApproval,
            refundsRequireApproval: approvalRules.refundsRequireApproval,
            discountApprovalTiers: approvalRules.discountTiers
          },
          communicationChannels: communications,
          documentPreferences
        })
      });

      if (nextStep !== undefined) {
        if (nextStep === 7) {
          // Fetch review
          const rev = await apiCall(`/businesses/${currentBizId}/configuration/review`, { method: 'POST' });
          setReviewData(rev.data);
        }
        setCurrentStep(nextStep);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAndActivate = async () => {
    if (!businessId) return;
    setError(null);
    setSaving(true);
    try {
      await apiCall(`/businesses/${businessId}/configuration/confirm`, {
        method: 'POST'
      });
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to confirm configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-600 font-medium">Loading Business Configuration...</p>
        </div>
      </div>
    );
  }

  const STEPS = [
    { num: 1, label: 'Identity & Locations', icon: Building2 },
    { num: 2, label: 'Products & Terminology', icon: Tag },
    { num: 3, label: 'Financial & Numbering', icon: DollarSign },
    { num: 4, label: 'Departments & Approvals', icon: ShieldCheck },
    { num: 5, label: 'Modules & Outcomes', icon: Layers },
    { num: 6, label: 'Communications & Docs', icon: Mail },
    { num: 7, label: 'Review & Activate', icon: CheckCircle2 }
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Top Banner */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              AF
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900">Agent Flux V2</h1>
              <p className="text-xs text-slate-500">Business Automation Requirements Setup</p>
            </div>
          </div>
          {businessId && (
            <button
              onClick={() => handleSaveStep()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? 'Saving Draft...' : 'Save Draft'}
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-8">
        {/* Step Indicator Tabs */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm mb-8 overflow-x-auto">
          <div className="flex items-center justify-between min-w-[760px]">
            {STEPS.map((s, idx) => {
              const Icon = s.icon;
              const isActive = currentStep === s.num;
              const isPast = currentStep > s.num;
              return (
                <button
                  key={s.num}
                  onClick={() => handleSaveStep(s.num)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-primary-50 text-primary-700 font-semibold shadow-xs border border-primary-200'
                      : isPast
                      ? 'text-emerald-700 hover:bg-slate-50'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                      isActive
                        ? 'bg-primary-600 text-white'
                        : isPast
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-600 border border-slate-300'
                    }`}
                  >
                    {isPast ? '✓' : s.num}
                  </span>
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-2 text-sm">
            <AlertTriangle size={18} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: IDENTITY & LOCATIONS */}
        {currentStep === 1 && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm space-y-8 animate-in fade-in duration-300">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Step 1: Business Identity & Locations</h2>
              <p className="text-sm text-slate-500 mt-1">Tell us who you are and optionally select an industry starting preset.</p>
            </div>

            {/* Presets */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 mb-2">
                Industry Starting Presets (Optional)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.keys(INDUSTRY_PRESETS).map(presetName => (
                  <button
                    key={presetName}
                    type="button"
                    onClick={() => applyIndustryPreset(presetName)}
                    className={`p-3 text-left rounded-lg border text-xs transition-all ${
                      businessInfo.industry === presetName
                        ? 'border-primary-500 bg-primary-50 text-primary-900 ring-2 ring-primary-500/20'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <Sparkles size={13} className="text-primary-600" />
                      {presetName}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Business Legal / Operating Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Healthcare Solutions"
                  value={businessInfo.name}
                  onChange={e => setBusinessInfo({ ...businessInfo, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Industry Category</label>
                <input
                  type="text"
                  value={businessInfo.industry}
                  onChange={e => setBusinessInfo({ ...businessInfo, industry: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Business Type</label>
                <select
                  value={businessInfo.businessType}
                  onChange={e => setBusinessInfo({ ...businessInfo, businessType: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:outline-hidden bg-white"
                >
                  <option value="Private Company">Private Company / LLC</option>
                  <option value="Sole Proprietorship">Sole Proprietorship</option>
                  <option value="Partnership">Partnership</option>
                  <option value="Corporation">Corporation</option>
                  <option value="Non-Profit">Non-Profit / Institution</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Website URL (Optional)</label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={businessInfo.website}
                  onChange={e => setBusinessInfo({ ...businessInfo, website: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:outline-hidden"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Business Description</label>
                <textarea
                  rows={2}
                  placeholder="Provide an overview of your operations, services, or specialty."
                  value={businessInfo.description}
                  onChange={e => setBusinessInfo({ ...businessInfo, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:outline-hidden"
                />
              </div>
            </div>

            {/* Locations */}
            <div className="pt-4 border-t border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900">Locations & Branches (Optional)</h3>
                <button
                  type="button"
                  onClick={() => setLocations([...locations, { name: '', address: '', isPrimary: false }])}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  <Plus size={14} /> Add Location
                </button>
              </div>
              <div className="space-y-3">
                {locations.map((loc, idx) => (
                  <div key={idx} className="flex gap-3 items-center">
                    <input
                      type="text"
                      placeholder="Location name (e.g. West Campus, Downtown Studio)"
                      value={loc.name}
                      onChange={e => {
                        const copy = [...locations];
                        copy[idx].name = e.target.value;
                        setLocations(copy);
                      }}
                      className="w-1/3 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Address or City"
                      value={loc.address || ''}
                      onChange={e => {
                        const copy = [...locations];
                        copy[idx].address = e.target.value;
                        setLocations(copy);
                      }}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    {locations.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLocations(locations.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-rose-500"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-slate-200">
              <button
                type="button"
                onClick={() => handleSaveStep(2)}
                disabled={saving || !businessInfo.name}
                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium text-sm rounded-lg shadow-sm inline-flex items-center gap-2 disabled:opacity-50"
              >
                Continue to Products & Terminology <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: PRODUCTS, SERVICES & TERMINOLOGY */}
        {currentStep === 2 && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm space-y-8 animate-in fade-in duration-300">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Step 2: Products, Services & Custom Terminology</h2>
              <p className="text-sm text-slate-500 mt-1">Configure business-specific terminology so the platform speaks your industry's language.</p>
            </div>

            {/* Terminology Grid */}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Custom Business Terminology</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Customer / Client Label</label>
                  <input
                    type="text"
                    value={terminology.customerLabel}
                    onChange={e => setTerminology({ ...terminology, customerLabel: e.target.value })}
                    placeholder="e.g. Patient, Client, Member"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Order / Booking Label</label>
                  <input
                    type="text"
                    value={terminology.orderLabel}
                    onChange={e => setTerminology({ ...terminology, orderLabel: e.target.value })}
                    placeholder="e.g. Consultation, Booking, Engagement"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Enquiry / Lead Label</label>
                  <input
                    type="text"
                    value={terminology.enquiryLabel}
                    onChange={e => setTerminology({ ...terminology, enquiryLabel: e.target.value })}
                    placeholder="e.g. Referral, Consultation Request, Lead"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Quotation / Proposal Label</label>
                  <input
                    type="text"
                    value={terminology.quotationLabel}
                    onChange={e => setTerminology({ ...terminology, quotationLabel: e.target.value })}
                    placeholder="e.g. Treatment Plan, Proposal, Estimate"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Invoice / Statement Label</label>
                  <input
                    type="text"
                    value={terminology.invoiceLabel}
                    onChange={e => setTerminology({ ...terminology, invoiceLabel: e.target.value })}
                    placeholder="e.g. Bill, Fee Statement, Receipt"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product / Item Label</label>
                  <input
                    type="text"
                    value={terminology.productLabel}
                    onChange={e => setTerminology({ ...terminology, productLabel: e.target.value })}
                    placeholder="e.g. Service, Package, Treatment"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Products / Offerings */}
            <div className="pt-4 border-t border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Products & Services Catalog (Optional)</h3>
                  <p className="text-xs text-slate-500">Define initial items or upload them via Knowledge Centre documents later.</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setProducts([
                      ...products,
                      { name: '', sku: `ITM-${products.length + 1}`, basePrice: 0, leadTimeDays: 1 }
                    ])
                  }
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  <Plus size={14} /> Add Item
                </button>
              </div>

              {products.length === 0 ? (
                <div className="p-6 rounded-lg bg-slate-50 border border-dashed border-slate-300 text-center text-xs text-slate-500">
                  No products added yet. You can click &quot;Add Item&quot; or proceed with an empty catalog.
                </div>
              ) : (
                <div className="space-y-3">
                  {products.map((item, idx) => (
                    <div key={idx} className="flex gap-3 items-center">
                      <input
                        type="text"
                        placeholder="SKU / Code"
                        value={item.sku || ''}
                        onChange={e => {
                          const copy = [...products];
                          copy[idx].sku = e.target.value;
                          setProducts(copy);
                        }}
                        className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Name / Description"
                        value={item.name}
                        onChange={e => {
                          const copy = [...products];
                          copy[idx].name = e.target.value;
                          setProducts(copy);
                        }}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs"
                      />
                      <input
                        type="number"
                        placeholder="Price"
                        value={item.basePrice || ''}
                        onChange={e => {
                          const copy = [...products];
                          copy[idx].basePrice = parseFloat(e.target.value) || 0;
                          setProducts(copy);
                        }}
                        className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setProducts(products.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-rose-500"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm inline-flex items-center gap-1.5"
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button
                type="button"
                onClick={() => handleSaveStep(3)}
                disabled={saving}
                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium text-sm rounded-lg shadow-sm inline-flex items-center gap-2"
              >
                Continue to Financial & Numbering <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: FINANCIAL & NUMBERING */}
        {currentStep === 3 && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm space-y-8 animate-in fade-in duration-300">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Step 3: Currency, Locale, Tax & Numbering</h2>
              <p className="text-sm text-slate-500 mt-1">Set your operating currency, tax structure, and sequential document prefixes.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Operating Currency</label>
                <select
                  value="INR"
                  disabled
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50 text-slate-700 cursor-not-allowed"
                >
                  <option value="INR">INR (₹ - Indian Rupee)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Locale Formatting</label>
                <select
                  value="en-IN"
                  disabled
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50 text-slate-700 cursor-not-allowed"
                >
                  <option value="en-IN">en-IN (1,00,000.00 Lakh/Crore)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
                <select
                  value={financials.timezone}
                  onChange={e => setFinancials({ ...financials, timezone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="America/New_York">America/New_York (EST/EDT)</option>
                  <option value="America/Chicago">America/Chicago (CST/CDT)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                  <option value="Europe/London">Europe/London (GMT/BST)</option>
                  <option value="Europe/Berlin">Europe/Berlin (CET)</option>
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                  <option value="UTC">UTC (Universal Coordinated Time)</option>
                </select>
              </div>
            </div>

            {/* Tax Settings */}
            <div className="pt-4 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Tax Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tax Label / Type</label>
                  <input
                    type="text"
                    value={financials.taxName}
                    onChange={e => setFinancials({ ...financials, taxName: e.target.value })}
                    placeholder="e.g. Sales Tax, VAT, GST, None"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Default Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={financials.defaultTaxRate}
                    onChange={e => setFinancials({ ...financials, defaultTaxRate: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 0, 18, 20"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tax ID / Registration # (Optional)</label>
                  <input
                    type="text"
                    value={financials.taxRegistrationNumber}
                    onChange={e => setFinancials({ ...financials, taxRegistrationNumber: e.target.value })}
                    placeholder="e.g. VAT123456 or GSTIN"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Document Numbering */}
            <div className="pt-4 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Document Sequential Numbering</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Quotation Prefix</label>
                  <input
                    type="text"
                    value={numbering.quotationPrefix}
                    onChange={e => setNumbering({ ...numbering, quotationPrefix: e.target.value })}
                    placeholder="QTN-"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Order Prefix</label>
                  <input
                    type="text"
                    value={numbering.orderPrefix}
                    onChange={e => setNumbering({ ...numbering, orderPrefix: e.target.value })}
                    placeholder="ORD-"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Invoice Prefix</label>
                  <input
                    type="text"
                    value={numbering.invoicePrefix}
                    onChange={e => setNumbering({ ...numbering, invoicePrefix: e.target.value })}
                    placeholder="INV-"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm inline-flex items-center gap-1.5"
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button
                type="button"
                onClick={() => handleSaveStep(4)}
                disabled={saving}
                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium text-sm rounded-lg shadow-sm inline-flex items-center gap-2"
              >
                Continue to Departments & Approvals <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: DEPARTMENTS & APPROVAL RULES */}
        {currentStep === 4 && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm space-y-8 animate-in fade-in duration-300">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Step 4: Governance & Approval Rules</h2>
              <p className="text-sm text-slate-500 mt-1">Configure threshold safeguards so critical commercial actions require explicit review.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  High-Value Order Threshold ({financials.currency})
                </label>
                <input
                  type="number"
                  value={approvalRules.requiresOwnerApprovalForOrdersAbove}
                  onChange={e =>
                    setApprovalRules({
                      ...approvalRules,
                      requiresOwnerApprovalForOrdersAbove: parseFloat(e.target.value) || 0
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">Orders exceeding this amount trigger an owner approval step.</p>
              </div>

              <div className="space-y-4">
                <label className="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={approvalRules.creditSalesRequireApproval}
                    onChange={e =>
                      setApprovalRules({ ...approvalRules, creditSalesRequireApproval: e.target.checked })
                    }
                    className="w-4 h-4 text-primary-600 rounded-sm"
                  />
                  <span>Require Management Approval for Credit Sales</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={approvalRules.refundsRequireApproval}
                    onChange={e =>
                      setApprovalRules({ ...approvalRules, refundsRequireApproval: e.target.checked })
                    }
                    className="w-4 h-4 text-primary-600 rounded-sm"
                  />
                  <span>Require Owner Approval for Order Cancellations & Refunds</span>
                </label>
              </div>
            </div>

            {/* Discount Authorization Tiers */}
            <div className="pt-4 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Discount Authorization Thresholds</h3>
              <div className="space-y-3">
                {approvalRules.discountTiers.map((tier, idx) => (
                  <div key={idx} className="flex gap-4 items-center">
                    <span className="text-sm text-slate-600 w-36">Discounts up to:</span>
                    <input
                      type="number"
                      value={tier.maxDiscountPercent}
                      onChange={e => {
                        const copy = [...approvalRules.discountTiers];
                        copy[idx].maxDiscountPercent = parseFloat(e.target.value) || 0;
                        setApprovalRules({ ...approvalRules, discountTiers: copy });
                      }}
                      className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <span className="text-sm text-slate-600">% require:</span>
                    <select
                      value={tier.requiredRole}
                      onChange={e => {
                        const copy = [...approvalRules.discountTiers];
                        copy[idx].requiredRole = e.target.value;
                        setApprovalRules({ ...approvalRules, discountTiers: copy });
                      }}
                      className="w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      <option value="MEMBER">Standard Staff (Member)</option>
                      <option value="OWNER">Owner / Executive</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm inline-flex items-center gap-1.5"
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button
                type="button"
                onClick={() => handleSaveStep(5)}
                disabled={saving}
                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium text-sm rounded-lg shadow-sm inline-flex items-center gap-2"
              >
                Continue to Modules & Outcomes <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: MODULES & DESIRED OUTCOMES */}
        {currentStep === 5 && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm space-y-8 animate-in fade-in duration-300">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Step 5: Enabled Modules & Automation Outcomes</h2>
              <p className="text-sm text-slate-500 mt-1">Select only the features relevant to your business process.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { id: 'LEAD_INTAKE', title: 'Lead & Enquiry Intake', desc: 'Captures and analyzes incoming inquiries automatically via email or forms.' },
                { id: 'QUOTATIONS', title: 'Quotation Generation', desc: 'Prepares structured commercial estimates or proposals with approved pricing.' },
                { id: 'ORDERS', title: 'Order & Booking Tracking', desc: 'Manages confirmation lifecycle, scheduling, and billing verification.' },
                { id: 'INVOICING', title: 'Invoice Automation', desc: 'Generates formal invoices with verifiable tax and billing snapshots.' },
                { id: 'PAYMENTS', title: 'Payment Collection & Rec', desc: 'Tracks payment statuses, payment links, and reconciliation.' },
                { id: 'APPOINTMENTS', title: 'Appointments & Scheduling', desc: 'Syncs with Google Calendar to manage slots and staff bookings.' },
                { id: 'DOCUMENTS', title: 'Document Center', desc: 'Generates branded DOCX/PDF contracts, forms, and service records.' },
                { id: 'CUSTOM_RECORDS', title: 'Custom Business Records', desc: 'Stores flexible industry entities (e.g. Patients, Shipments, Assets).' }
              ].map(mod => {
                const isSelected = enabledModules.includes(mod.id);
                return (
                  <div
                    key={mod.id}
                    onClick={() => {
                      if (isSelected) {
                        setEnabledModules(enabledModules.filter(m => m !== mod.id));
                      } else {
                        setEnabledModules([...enabledModules, mod.id]);
                      }
                    }}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-primary-500 bg-primary-50/50 ring-2 ring-primary-500/20'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-sm text-slate-900">{mod.title}</span>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="w-4 h-4 text-primary-600 rounded-sm"
                      />
                    </div>
                    <p className="text-xs text-slate-500">{mod.desc}</p>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCurrentStep(4)}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm inline-flex items-center gap-1.5"
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button
                type="button"
                onClick={() => handleSaveStep(6)}
                disabled={saving}
                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium text-sm rounded-lg shadow-sm inline-flex items-center gap-2"
              >
                Continue to Communications & Docs <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: COMMUNICATIONS & DOCUMENTS */}
        {currentStep === 6 && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm space-y-8 animate-in fade-in duration-300">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Step 6: Communication Channels & Document Branding</h2>
              <p className="text-sm text-slate-500 mt-1">Configure your primary contact details and document styling preferences.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Primary Communication Email</label>
                <input
                  type="email"
                  placeholder="contact@yourbusiness.com"
                  value={communications.primaryEmail}
                  onChange={e => setCommunications({ ...communications, primaryEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Support / Escalation Phone</label>
                <input
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={communications.phone}
                  onChange={e => setCommunications({ ...communications, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="md:col-span-2">
                <label className="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={communications.sendCustomerAutoReplies}
                    onChange={e => setCommunications({ ...communications, sendCustomerAutoReplies: e.target.checked })}
                    className="w-4 h-4 text-primary-600 rounded-sm"
                  />
                  <span>Send automated confirmation receipts to incoming customer emails</span>
                </label>
              </div>

              <div className="md:col-span-2 pt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Standard Terms & Document Footer</h3>
                <textarea
                  rows={3}
                  placeholder="Standard contractual terms to embed at the bottom of generated documents."
                  value={documentPreferences.termsAndConditions}
                  onChange={e => setDocumentPreferences({ ...documentPreferences, termsAndConditions: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCurrentStep(5)}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm inline-flex items-center gap-1.5"
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button
                type="button"
                onClick={() => handleSaveStep(7)}
                disabled={saving}
                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium text-sm rounded-lg shadow-sm inline-flex items-center gap-2"
              >
                Review Proposed Requirements <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 7: REQUIREMENTS REVIEW & CONFIRMATION */}
        {currentStep === 7 && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm space-y-8 animate-in fade-in duration-300">
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Step 7: Requirements Review & Activation</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Carefully inspect the proposed business configuration before locking and enabling automation.
                  </p>
                </div>
                {reviewData?.summary?.onboardingStatus === 'COMPLETED' && (
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                    <Lock size={12} /> Confirmed & Active
                  </span>
                )}
              </div>
            </div>

            {/* Blockers & Warnings */}
            {reviewData?.blockers && reviewData.blockers.length > 0 && (
              <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm">
                <div className="font-semibold flex items-center gap-1.5 mb-1 text-rose-900">
                  <AlertTriangle size={16} /> Missing Requirements (Blockers)
                </div>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  {reviewData.blockers.map((b: string, i: number) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            {reviewData?.warnings && reviewData.warnings.length > 0 && (
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <div className="font-semibold flex items-center gap-1.5 mb-1 text-amber-900">
                  <HelpCircle size={16} /> Recommendations
                </div>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  {reviewData.warnings.map((w: string, i: number) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Configuration Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Card 1: Identity & Terminology */}
              <div className="p-5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-900">Identity & Terminology</h3>
                  <button onClick={() => setCurrentStep(2)} className="text-xs text-primary-600 hover:underline">
                    Edit
                  </button>
                </div>
                <dl className="text-xs space-y-1.5 text-slate-600">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Business Name:</dt>
                    <dd className="font-semibold text-slate-900">{businessInfo.name}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Industry Category:</dt>
                    <dd className="font-semibold text-slate-900">{businessInfo.industry}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Customer Term:</dt>
                    <dd className="font-semibold text-slate-900">{terminology.customerLabel}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Order/Booking Term:</dt>
                    <dd className="font-semibold text-slate-900">{terminology.orderLabel}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Quotation/Proposal:</dt>
                    <dd className="font-semibold text-slate-900">{terminology.quotationLabel}</dd>
                  </div>
                </dl>
              </div>

              {/* Card 2: Financial & Tax */}
              <div className="p-5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-900">Financials & Numbering</h3>
                  <button onClick={() => setCurrentStep(3)} className="text-xs text-primary-600 hover:underline">
                    Edit
                  </button>
                </div>
                <dl className="text-xs space-y-1.5 text-slate-600">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Currency & Locale:</dt>
                    <dd className="font-semibold text-slate-900">{financials.currency} ({financials.locale})</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Tax Type & Rate:</dt>
                    <dd className="font-semibold text-slate-900">{financials.taxName} ({financials.defaultTaxRate}%)</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Payment Terms:</dt>
                    <dd className="font-semibold text-slate-900">{financials.paymentTerms}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Document Prefixes:</dt>
                    <dd className="font-mono text-slate-900">{numbering.quotationPrefix}, {numbering.orderPrefix}, {numbering.invoicePrefix}</dd>
                  </div>
                </dl>
              </div>

              {/* Card 3: Modules & Automation */}
              <div className="p-5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-900">Enabled Capabilities</h3>
                  <button onClick={() => setCurrentStep(5)} className="text-xs text-primary-600 hover:underline">
                    Edit
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {enabledModules.map(m => (
                    <span key={m} className="px-2 py-0.5 bg-white border border-slate-300 rounded-md text-[11px] font-medium text-slate-700">
                      {m.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              </div>

              {/* Card 4: Governance & Approvals */}
              <div className="p-5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-900">Governance & Approval Rules</h3>
                  <button onClick={() => setCurrentStep(4)} className="text-xs text-primary-600 hover:underline">
                    Edit
                  </button>
                </div>
                <dl className="text-xs space-y-1.5 text-slate-600">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Order Approval Limit:</dt>
                    <dd className="font-semibold text-slate-900">{financials.currency} {approvalRules.requiresOwnerApprovalForOrdersAbove.toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Credit Sales Review:</dt>
                    <dd className="font-semibold text-slate-900">{approvalRules.creditSalesRequireApproval ? 'Enforced' : 'Disabled'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Cancellation/Refund Review:</dt>
                    <dd className="font-semibold text-slate-900">{approvalRules.refundsRequireApproval ? 'Enforced' : 'Disabled'}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCurrentStep(6)}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm inline-flex items-center gap-1.5"
              >
                <ArrowLeft size={16} /> Back to Communications
              </button>

              <button
                type="button"
                onClick={handleConfirmAndActivate}
                disabled={saving || (reviewData?.blockers && reviewData.blockers.length > 0)}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-lg shadow-sm inline-flex items-center gap-2 disabled:opacity-50"
              >
                <CheckCircle2 size={18} />
                {saving ? 'Activating...' : 'Confirm Requirements & Enable Automation'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
