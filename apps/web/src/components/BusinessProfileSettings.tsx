import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import { useToast } from './ui/Toast';
import {
  Loader2,
  Save,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Building,
  Mail,
  MapPin,
  Receipt,
  FileText,
  CreditCard,
  PenTool,
  Lock,
  Eye,
  EyeOff
} from 'lucide-react';

interface BusinessProfileSettingsProps {
  businessId: string;
}

export default function BusinessProfileSettings({ businessId }: BusinessProfileSettingsProps) {
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>('BASIC');
  const [showAccountInput, setShowAccountInput] = useState(false);

  const [formData, setFormData] = useState<any>({
    name: '',
    industry: '',
    businessType: '',
    country: 'India',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    website: '',
    description: '',
    legalBusinessName: '',
    displayName: '',
    email: '',
    phone: '',
    alternatePhone: '',
    supportEmail: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    taxRegistrationStatus: 'NOT_REGISTERED',
    gstin: '',
    pan: '',
    defaultTaxRate: 18,
    invoicePrefix: 'AF-INV-',
    quotationPrefix: 'AF-QTN-',
    orderPrefix: 'AF-ORD-',
    defaultPaymentTerms: 'Net 15 Days',
    defaultInvoiceDueDays: 15,
    invoiceNotes: '',
    invoiceFooter: '',
    quotationFooter: '',
    bankName: '',
    bankAccountName: '',
    bankAccountNumber: '',
    isBankAccountConfigured: false,
    bankIfsc: '',
    bankBranch: '',
    upiId: '',
    paymentInstructions: '',
    authorizedSignatoryName: '',
    authorizedSignatoryDesignation: '',
    authorizedSignatoryEmail: '',
    authorizedSignatoryPhone: ''
  });

  const [readiness, setReadiness] = useState<any>({
    quotation: { ready: false, missingItems: [] },
    invoice: { ready: false, missingItems: [] },
    payment: { ready: false, missingItems: [] }
  });

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadProfile = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiCall(`/businesses/profile?businessId=${businessId}`);
      if (res.data) {
        setFormData((prev: any) => ({
          ...prev,
          ...res.data,
          defaultTaxRate: res.data.defaultTaxRate !== null && res.data.defaultTaxRate !== undefined ? res.data.defaultTaxRate : '',
          defaultInvoiceDueDays: res.data.defaultInvoiceDueDays !== null && res.data.defaultInvoiceDueDays !== undefined ? res.data.defaultInvoiceDueDays : 15
        }));
        if (res.readiness) {
          setReadiness(res.readiness);
        }
      } else {
        setErrorMsg('Failed to load profile details.');
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Unknown error occurred during fetch');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (businessId) {
      loadProfile();
    }
  }, [businessId]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const res = await apiCall(`/businesses/profile`, {
        method: 'PATCH',
        body: JSON.stringify({ businessId, ...formData })
      });

      addToast({
        type: 'success',
        title: 'Business Profile Updated',
        message: 'All settings and document templates saved successfully.'
      });

      if (res.data) {
        setFormData((prev: any) => ({
          ...prev,
          ...res.data,
          defaultTaxRate: res.data.defaultTaxRate !== null && res.data.defaultTaxRate !== undefined ? res.data.defaultTaxRate : '',
          defaultInvoiceDueDays: res.data.defaultInvoiceDueDays !== null && res.data.defaultInvoiceDueDays !== undefined ? res.data.defaultInvoiceDueDays : 15
        }));
      }
      if (res.readiness) {
        setReadiness(res.readiness);
      }
      setShowAccountInput(false);
    } catch (e: any) {
      console.error(e);
      addToast({
        type: 'error',
        title: 'Update Failed',
        message: e.message || 'Failed to update Business Profile.'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64 gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
        <span className="text-sm font-medium">Loading profile configuration...</span>
      </div>
    );
  }

  const SectionHeader = ({
    id,
    title,
    description,
    icon
  }: {
    id: string;
    title: string;
    description: string;
    icon: React.ReactNode;
  }) => (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') toggleSection(id);
      }}
      className="flex items-center justify-between cursor-pointer py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-lg select-none"
      onClick={() => toggleSection(id)}
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">{icon}</div>
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="text-slate-400">
        {expandedSection === id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-300">
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Business Profile &amp; Governance</h2>
        <p className="text-slate-500 mt-1 text-sm">
          Authoritative business configuration consumed directly by quotation generation, order creation, and tax invoice workflows.
        </p>

        {errorMsg && (
          <div className="mt-4 p-4 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs font-medium">
            <strong>Error:</strong> {errorMsg}
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        {/* 1. BASIC IDENTITY */}
        <div className="border border-slate-200 rounded-2xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader
            id="BASIC"
            title="Basic Business Identity"
            description="Core trading and display information."
            icon={<Building size={18} />}
          />
          {expandedSection === 'BASIC' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-3 border-t border-slate-100 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Business Name *</label>
                <input
                  required
                  name="name"
                  value={formData.name || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Legal Registered Name</label>
                <input
                  name="legalBusinessName"
                  value={formData.legalBusinessName || ''}
                  onChange={handleChange}
                  placeholder="e.g. Acme Private Limited"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Display / Brand Name</label>
                <input
                  name="displayName"
                  value={formData.displayName || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Industry</label>
                <input
                  name="industry"
                  value={formData.industry || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Operating Currency</label>
                <select
                  name="currency"
                  value="INR"
                  disabled
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-700 text-sm cursor-not-allowed"
                >
                  <option value="INR">INR (₹ - Indian Rupee)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Timezone</label>
                <input
                  name="timezone"
                  value={formData.timezone || 'Asia/Kolkata'}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  name="description"
                  value={formData.description || ''}
                  onChange={handleChange}
                  rows={2}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* 2. CONTACT INFORMATION */}
        <div className="border border-slate-200 rounded-2xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader
            id="CONTACT"
            title="Communication Channels"
            description="Used in email threads, notifications, and quotation headers."
            icon={<Mail size={18} />}
          />
          {expandedSection === 'CONTACT' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-3 border-t border-slate-100 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Primary Email *</label>
                <input
                  type="email"
                  required
                  name="email"
                  value={formData.email || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Support Email</label>
                <input
                  type="email"
                  name="supportEmail"
                  value={formData.supportEmail || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Primary Phone</label>
                <input
                  name="phone"
                  value={formData.phone || ''}
                  onChange={handleChange}
                  placeholder="+91 "
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Website URL</label>
                <input
                  type="url"
                  name="website"
                  value={formData.website || ''}
                  onChange={handleChange}
                  placeholder="https://"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* 3. BUSINESS ADDRESS */}
        <div className="border border-slate-200 rounded-2xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader
            id="ADDRESS"
            title="Physical / Registered Address"
            description="Mandatory for compliant quotation and tax invoice output."
            icon={<MapPin size={18} />}
          />
          {expandedSection === 'ADDRESS' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-3 border-t border-slate-100 text-xs">
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address Line 1 *</label>
                <input
                  name="addressLine1"
                  value={formData.addressLine1 || ''}
                  onChange={handleChange}
                  placeholder="Building No, Street, Landmark"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address Line 2</label>
                <input
                  name="addressLine2"
                  value={formData.addressLine2 || ''}
                  onChange={handleChange}
                  placeholder="Suite, Floor, Area (Optional)"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">City *</label>
                <input
                  name="city"
                  value={formData.city || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">State / Province *</label>
                <input
                  name="state"
                  value={formData.state || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">PIN / Postal Code *</label>
                <input
                  name="postalCode"
                  value={formData.postalCode || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Country</label>
                <input
                  name="country"
                  value={formData.country || 'India'}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* 4. TAX & REGISTRATION */}
        <div className="border border-slate-200 rounded-2xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader
            id="TAX"
            title="Tax & GSTIN Compliance"
            description="GST, PAN, and applicable tax rates."
            icon={<Receipt size={18} />}
          />
          {expandedSection === 'TAX' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-3 border-t border-slate-100 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tax Registration Status</label>
                <select
                  name="taxRegistrationStatus"
                  value={formData.taxRegistrationStatus || 'NOT_REGISTERED'}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm bg-white"
                >
                  <option value="REGISTERED">GST Registered (Regular)</option>
                  <option value="NOT_REGISTERED">Not Registered (Unregistered Entity)</option>
                  <option value="COMPOSITION">Composition Scheme</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Businesses marked 'Not Registered' are not blocked from invoicing for missing GSTIN.
                </p>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  GSTIN {formData.taxRegistrationStatus === 'REGISTERED' && '*'}
                </label>
                <input
                  name="gstin"
                  value={formData.gstin || ''}
                  onChange={handleChange}
                  placeholder="29ABCDE1234F1Z5"
                  maxLength={15}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm uppercase font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">PAN Number</label>
                <input
                  name="pan"
                  value={formData.pan || ''}
                  onChange={handleChange}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm uppercase font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Default Tax Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  name="defaultTaxRate"
                  value={formData.defaultTaxRate}
                  onChange={handleChange}
                  placeholder="18"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* 5. INVOICE & DOCUMENT SETTINGS */}
        <div className="border border-slate-200 rounded-2xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader
            id="DOCS"
            title="Document Sequences & Default Terms"
            description="Numbering schemes, payment due windows, and terms."
            icon={<FileText size={18} />}
          />
          {expandedSection === 'DOCS' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-3 border-t border-slate-100 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Quotation Prefix</label>
                <input
                  name="quotationPrefix"
                  value={formData.quotationPrefix || 'AF-QTN-'}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Invoice Prefix</label>
                <input
                  name="invoicePrefix"
                  value={formData.invoicePrefix || 'AF-INV-'}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Order Prefix</label>
                <input
                  name="orderPrefix"
                  value={formData.orderPrefix || 'AF-ORD-'}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Invoice Due Days</label>
                <input
                  type="number"
                  name="defaultInvoiceDueDays"
                  value={formData.defaultInvoiceDueDays}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Default Payment Terms</label>
                <input
                  name="defaultPaymentTerms"
                  value={formData.defaultPaymentTerms || ''}
                  onChange={handleChange}
                  placeholder="e.g. Net 15 Days, 50% Advance"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Invoice Footer / Legal Notice</label>
                <textarea
                  name="invoiceFooter"
                  value={formData.invoiceFooter || ''}
                  onChange={handleChange}
                  rows={2}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* 6. SETTLEMENT & BANK INFORMATION (MASKED) */}
        <div className="border border-slate-200 rounded-2xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader
            id="PAYMENT"
            title="Settlement & Bank Details"
            description="Masked customer payment instructions for invoice PDFs."
            icon={<CreditCard size={18} />}
          />
          {expandedSection === 'PAYMENT' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-3 border-t border-slate-100 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bank Name</label>
                <input
                  name="bankName"
                  value={formData.bankName || ''}
                  onChange={handleChange}
                  placeholder="e.g. HDFC Bank, ICICI Bank"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Account Beneficiary Name</label>
                <input
                  name="bankAccountName"
                  value={formData.bankAccountName || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-semibold text-slate-700">Bank Account Number</label>
                  {formData.isBankAccountConfigured && !showAccountInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAccountInput(true);
                        setFormData((prev: any) => ({ ...prev, bankAccountNumber: '' }));
                      }}
                      className="text-xs text-primary-600 hover:underline font-semibold"
                    >
                      Update Account
                    </button>
                  )}
                </div>
                {formData.isBankAccountConfigured && !showAccountInput ? (
                  <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono text-slate-700">
                    <span className="flex items-center gap-2">
                      <Lock size={14} className="text-slate-400" />
                      {formData.bankAccountNumber || '••••••••'}
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">
                      CONFIGURED
                    </span>
                  </div>
                ) : (
                  <input
                    type="text"
                    name="bankAccountNumber"
                    value={formData.bankAccountNumber || ''}
                    onChange={handleChange}
                    placeholder="Enter full account number"
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm font-mono"
                  />
                )}
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bank IFSC Code</label>
                <input
                  name="bankIfsc"
                  value={formData.bankIfsc || ''}
                  onChange={handleChange}
                  placeholder="HDFC0001234"
                  maxLength={11}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm uppercase font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">UPI ID (VPA)</label>
                <input
                  name="upiId"
                  value={formData.upiId || ''}
                  onChange={handleChange}
                  placeholder="business@upi"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Branch Name</label>
                <input
                  name="bankBranch"
                  value={formData.bankBranch || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Custom Payment Instructions</label>
                <textarea
                  name="paymentInstructions"
                  value={formData.paymentInstructions || ''}
                  onChange={handleChange}
                  rows={2}
                  placeholder="Instructions printed on invoices regarding payment references..."
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* 7. AUTHORISED SIGNATORY */}
        <div className="border border-slate-200 rounded-2xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader
            id="SIGNATORY"
            title="Authorised Signatory"
            description="Authorized representative for contracts, quotations and invoices."
            icon={<PenTool size={18} />}
          />
          {expandedSection === 'SIGNATORY' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-3 border-t border-slate-100 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Signatory Full Name *</label>
                <input
                  required
                  name="authorizedSignatoryName"
                  value={formData.authorizedSignatoryName || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Designation</label>
                <input
                  name="authorizedSignatoryDesignation"
                  value={formData.authorizedSignatoryDesignation || 'Managing Director'}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Signatory Email</label>
                <input
                  type="email"
                  name="authorizedSignatoryEmail"
                  value={formData.authorizedSignatoryEmail || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Signatory Phone</label>
                <input
                  name="authorizedSignatoryPhone"
                  value={formData.authorizedSignatoryPhone || ''}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* OPERATIONAL READINESS MATRIX */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-900 mb-1">Operational Readiness Matrix</h3>
          <p className="text-xs text-slate-500 mb-4">
            Validation checks required for each specific automated commercial operation.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Quotation Readiness */}
            <div
              className={`p-4 rounded-xl border flex flex-col justify-between ${
                readiness.quotation.ready
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-amber-50/70 border-amber-200 text-amber-950'
              }`}
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {readiness.quotation.ready ? (
                    <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                  )}
                  <h4 className="text-sm font-bold">Quotation Generation</h4>
                </div>
                {readiness.quotation.ready ? (
                  <p className="text-xs text-emerald-800">Ready to generate and distribute official quotations.</p>
                ) : (
                  <div>
                    <p className="text-xs text-amber-800 font-semibold mb-1">Missing required items:</p>
                    <ul className="list-disc ml-4 text-[11px] text-amber-700 space-y-0.5">
                      {readiness.quotation.missingItems.map((item: string, idx: number) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Invoice Readiness */}
            <div
              className={`p-4 rounded-xl border flex flex-col justify-between ${
                readiness.invoice.ready
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-amber-50/70 border-amber-200 text-amber-950'
              }`}
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {readiness.invoice.ready ? (
                    <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                  )}
                  <h4 className="text-sm font-bold">Invoice Generation</h4>
                </div>
                {readiness.invoice.ready ? (
                  <p className="text-xs text-emerald-800">
                    Compliant for legal tax invoice creation and Drive storage.
                  </p>
                ) : (
                  <div>
                    <p className="text-xs text-amber-800 font-semibold mb-1">Missing required items:</p>
                    <ul className="list-disc ml-4 text-[11px] text-amber-700 space-y-0.5">
                      {readiness.invoice.missingItems.map((item: string, idx: number) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Readiness */}
            <div
              className={`p-4 rounded-xl border flex flex-col justify-between ${
                readiness.payment.ready
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-slate-100 border-slate-200 text-slate-800'
              }`}
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {readiness.payment.ready ? (
                    <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle size={18} className="text-slate-500 shrink-0" />
                  )}
                  <h4 className="text-sm font-bold">Payment Workflows</h4>
                </div>
                {readiness.payment.ready ? (
                  <p className="text-xs text-emerald-800">
                    Bank instructions or UPI ID configured for customer remittances.
                  </p>
                ) : (
                  <div>
                    <p className="text-xs text-slate-600 font-semibold mb-1">Optional configuration:</p>
                    <ul className="list-disc ml-4 text-[11px] text-slate-500 space-y-0.5">
                      {readiness.payment.missingItems.map((item: string, idx: number) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-primary-600 hover:bg-primary-700 text-white px-8 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all disabled:opacity-50 shadow-sm text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Business Profile
          </button>
        </div>
      </form>
    </div>
  );
}
