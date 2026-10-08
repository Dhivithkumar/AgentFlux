import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import { Loader2, Save, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

interface BusinessProfileSettingsProps {
  businessId: string;
}

export default function BusinessProfileSettings({ businessId }: BusinessProfileSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>('BASIC');

  const [formData, setFormData] = useState<any>({
    name: '', industry: '', website: '', description: '',
    legalBusinessName: '', displayName: '', email: '', phone: '', alternatePhone: '', supportEmail: '',
    addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '',
    taxRegistrationStatus: 'NOT_REGISTERED', gstin: '', pan: '', defaultTaxRate: '',
    invoicePrefix: '', quotationPrefix: '', orderPrefix: '', defaultPaymentTerms: '', defaultInvoiceDueDays: '', invoiceNotes: '', invoiceFooter: '', quotationFooter: '',
    bankName: '', bankAccountName: '', bankAccountNumber: '', bankIfsc: '', bankBranch: '', upiId: '', paymentInstructions: '',
    authorizedSignatoryName: '', authorizedSignatoryDesignation: '', authorizedSignatoryEmail: '', authorizedSignatoryPhone: '',
  });

  useEffect(() => {
    loadProfile();
  }, [businessId]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadProfile = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiCall(`/businesses/profile?businessId=${businessId}`);
      if (res.data) {
        setFormData({
          ...formData,
          ...res.data,
          defaultTaxRate: res.data.defaultTaxRate ?? '',
          defaultInvoiceDueDays: res.data.defaultInvoiceDueDays ?? '',
        });
      } else {
        setErrorMsg("API returned success but res.data is null. Full response: " + JSON.stringify(res));
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Unknown error occurred during fetch');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      await apiCall(`/businesses/profile`, {
        method: 'PATCH',
        body: JSON.stringify({ businessId, ...formData })
      });
      alert('Business Profile updated successfully');
      loadProfile(); // refresh state for readiness
    } catch (e) {
      console.error(e);
      alert('Failed to update Business Profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const toggleSection = (section: string) => {
    if (expandedSection === section) setExpandedSection(null);
    else setExpandedSection(section);
  };

  // Readiness Checks
  const isQuotationReady = formData.name && formData.email && formData.quotationPrefix;
  const isInvoiceReady = isQuotationReady && formData.addressLine1 && formData.invoicePrefix && formData.gstin;
  const isPaymentReady = formData.bankAccountNumber && formData.bankIfsc;

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 text-slate-500 animate-spin" /></div>;
  }

  const SectionHeader = ({ id, title, description }: { id: string, title: string, description: string }) => (
    <div 
      className="flex items-center justify-between cursor-pointer py-4"
      onClick={() => toggleSection(id)}
    >
      <div>
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <div className="text-slate-400">
        {expandedSection === id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold text-slate-900">Business Profile</h2>
        <p className="text-slate-500 mt-1">Manage the information Agent Flux uses when representing your business in documents, emails, invoices and automated workflows.</p>
        
        {/* DEBUG PANEL */}
        {errorMsg && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg whitespace-pre-wrap">
            <strong>Error loading profile:</strong> {errorMsg}
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        
        {/* BASIC INFORMATION */}
        <div className="border border-slate-200 rounded-xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader id="BASIC" title="Basic Information" description="Your core business identity." />
          {expandedSection === 'BASIC' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-2 border-t border-slate-100">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Business Name *</label><input required name="name" value={formData.name || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Legal Business Name</label><input name="legalBusinessName" value={formData.legalBusinessName || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label><input name="displayName" value={formData.displayName || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Industry</label><input name="industry" value={formData.industry || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">Description</label><textarea name="description" value={formData.description || ''} onChange={handleChange} rows={3} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
            </div>
          )}
        </div>

        {/* CONTACT INFORMATION */}
        <div className="border border-slate-200 rounded-xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader id="CONTACT" title="Contact Information" description="How customers can reach you." />
          {expandedSection === 'CONTACT' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-2 border-t border-slate-100">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Business Email</label><input type="email" name="email" value={formData.email || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Support Email</label><input type="email" name="supportEmail" value={formData.supportEmail || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Business Phone</label><input name="phone" value={formData.phone || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Alternate Phone</label><input name="alternatePhone" value={formData.alternatePhone || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">Website</label><input type="url" name="website" value={formData.website || ''} onChange={handleChange} placeholder="https://" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
            </div>
          )}
        </div>

        {/* BUSINESS ADDRESS */}
        <div className="border border-slate-200 rounded-xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader id="ADDRESS" title="Business Address" description="Used on invoices and formal documents." />
          {expandedSection === 'ADDRESS' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-2 border-t border-slate-100">
              <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">Address Line 1</label><input name="addressLine1" value={formData.addressLine1 || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">Address Line 2</label><input name="addressLine2" value={formData.addressLine2 || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">City</label><input name="city" value={formData.city || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">State / Province</label><input name="state" value={formData.state || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">PIN / ZIP Code</label><input name="postalCode" value={formData.postalCode || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
            </div>
          )}
        </div>

        {/* TAX & REGISTRATION */}
        <div className="border border-slate-200 rounded-xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader id="TAX" title="Tax & Registration" description="GSTIN, PAN and tax configurations." />
          {expandedSection === 'TAX' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tax Registration Status</label>
                <select name="taxRegistrationStatus" value={formData.taxRegistrationStatus || 'NOT_REGISTERED'} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white">
                  <option value="REGISTERED">Registered</option>
                  <option value="NOT_REGISTERED">Not Registered</option>
                </select>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">GSTIN</label><input name="gstin" value={formData.gstin || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">PAN</label><input name="pan" value={formData.pan || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Default Tax Rate (%)</label><input type="number" step="0.01" name="defaultTaxRate" value={formData.defaultTaxRate} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
            </div>
          )}
        </div>

        {/* INVOICE & DOCUMENTS */}
        <div className="border border-slate-200 rounded-xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader id="DOCS" title="Invoice & Document Settings" description="Prefixes and default terms." />
          {expandedSection === 'DOCS' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-2 border-t border-slate-100">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Quotation Prefix (e.g. QUO-)</label><input name="quotationPrefix" value={formData.quotationPrefix || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Order Prefix (e.g. ORD-)</label><input name="orderPrefix" value={formData.orderPrefix || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Invoice Prefix (e.g. INV-)</label><input name="invoicePrefix" value={formData.invoicePrefix || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Default Due Days</label><input type="number" name="defaultInvoiceDueDays" value={formData.defaultInvoiceDueDays} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">Default Payment Terms</label><input name="defaultPaymentTerms" value={formData.defaultPaymentTerms || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">Invoice Footer / Notes</label><textarea name="invoiceFooter" value={formData.invoiceFooter || ''} onChange={handleChange} rows={2} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
            </div>
          )}
        </div>

        {/* PAYMENT DETAILS */}
        <div className="border border-slate-200 rounded-xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader id="PAYMENT" title="Payment Details" description="Bank accounts and UPI information." />
          {expandedSection === 'PAYMENT' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-2 border-t border-slate-100">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Bank Name</label><input name="bankName" value={formData.bankName || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Account Name</label><input name="bankAccountName" value={formData.bankAccountName || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Account Number</label><input type="password" name="bankAccountNumber" value={formData.bankAccountNumber || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="••••••••" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">IFSC Code</label><input name="bankIfsc" value={formData.bankIfsc || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Branch Name</label><input name="bankBranch" value={formData.bankBranch || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">UPI ID</label><input name="upiId" value={formData.upiId || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">Payment Instructions (for customers)</label><textarea name="paymentInstructions" value={formData.paymentInstructions || ''} onChange={handleChange} rows={2} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
            </div>
          )}
        </div>

        {/* AUTHORIZED SIGNATORY */}
        <div className="border border-slate-200 rounded-xl px-6 bg-white shadow-sm overflow-hidden transition-all">
          <SectionHeader id="SIGNATORY" title="Authorized Signatory" description="Appears on formal documents." />
          {expandedSection === 'SIGNATORY' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 pt-2 border-t border-slate-100">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label><input name="authorizedSignatoryName" value={formData.authorizedSignatoryName || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Designation</label><input name="authorizedSignatoryDesignation" value={formData.authorizedSignatoryDesignation || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Email</label><input type="email" name="authorizedSignatoryEmail" value={formData.authorizedSignatoryEmail || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Phone</label><input name="authorizedSignatoryPhone" value={formData.authorizedSignatoryPhone || ''} onChange={handleChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500" /></div>
            </div>
          )}
        </div>

        {/* CONFIGURATION READINESS */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Configuration Readiness</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {isQuotationReady ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
              <span className={`font-medium ${isQuotationReady ? 'text-slate-700' : 'text-amber-700'}`}>Quotation Generation</span>
              {!isQuotationReady && <span className="text-sm text-slate-500 ml-auto">Requires Basic Info & Prefix</span>}
            </div>
            <div className="flex items-center gap-3">
              {isInvoiceReady ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
              <span className={`font-medium ${isInvoiceReady ? 'text-slate-700' : 'text-amber-700'}`}>Invoice Generation</span>
              {!isInvoiceReady && <span className="text-sm text-slate-500 ml-auto">Requires Address, GSTIN & Prefix</span>}
            </div>
            <div className="flex items-center gap-3">
              {isPaymentReady ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
              <span className={`font-medium ${isPaymentReady ? 'text-slate-700' : 'text-amber-700'}`}>Payment Workflows</span>
              {!isPaymentReady && <span className="text-sm text-slate-500 ml-auto">Requires Bank Details</span>}
            </div>
          </div>
        </div>

        <div className="pt-6 pb-12 flex justify-end">
          <button 
            type="submit"
            disabled={saving}
            className="bg-primary-600 hover:bg-primary-700 text-white px-8 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all disabled:opacity-50 shadow-sm"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Save Business Profile
          </button>
        </div>
      </form>
    </div>
  );
}
