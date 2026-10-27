import { useState, useEffect, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';
import {
  Building2,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Clock,
  RefreshCw,
  Plus,
  Search,
  ExternalLink,
  FileText,
  CheckCircle2,
  XCircle,
  Eye,
  Filter,
  Globe,
  Mail,
  Hash,
  AlertCircle
} from 'lucide-react';

interface Vendor {
  id: string;
  name: string;
  legalName?: string;
  taxId?: string;
  website?: string;
  email?: string;
  phone?: string;
  category?: string;
  verificationStatus: 'PENDING_VERIFICATION' | 'IN_PROGRESS' | 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'VERIFICATION_FAILED' | 'MANUAL_REVIEW_REQUIRED' | 'EXPIRED_VERIFICATION';
  verificationMethod?: string;
  verifiedAt?: string;
  verificationNotes?: string;
  verificationExpiry?: string;
  failureReason?: string;
  createdAt: string;
  orders?: any[];
  verificationLogs?: any[];
}

export default function VendorCenter() {
  const { business } = useOutletContext<any>();
  const { addToast } = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // Add Vendor Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    legalName: '',
    taxId: '',
    website: '',
    email: '',
    phone: '',
    category: 'SUPPLIER'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Audit Logs Drawer
  const [selectedVendorForLogs, setSelectedVendorForLogs] = useState<Vendor | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Manual Review Modal
  const [manualReviewVendor, setManualReviewVendor] = useState<Vendor | null>(null);
  const [manualReviewStatus, setManualReviewStatus] = useState<'VERIFIED' | 'PARTIALLY_VERIFIED' | 'VERIFICATION_FAILED'>('VERIFIED');
  const [manualReviewNotes, setManualReviewNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const fetchVendors = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await apiCall(`/businesses/${business.id}/vendors`);
      const list = Array.isArray(res) ? res : (res?.data || []);
      setVendors(list);
    } catch (err: any) {
      console.error('Failed to load vendors:', err);
      addToast({
        type: 'error',
        title: 'Fetch Error',
        message: err.message || 'Unable to load vendors'
      });
    } finally {
      setLoading(false);
    }
  }, [business?.id, addToast]);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  const handleRunVerification = async (vendorId: string, vendorName: string) => {
    setVerifyingId(vendorId);
    try {
      const res = await apiCall(`/businesses/${business.id}/vendors/${vendorId}/verify`, {
        method: 'POST'
      });
      const data = res?.data || res;
      addToast({
        type: data.status === 'VERIFIED' ? 'success' : data.status === 'PARTIALLY_VERIFIED' ? 'info' : 'warning',
        title: 'Verification Completed',
        message: `${vendorName}: Resulted in ${data.status.replace(/_/g, ' ')}`
      });
      await fetchVendors();
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Verification Failed',
        message: err.message || 'Error executing vendor verification'
      });
    } finally {
      setVerifyingId(null);
    }
  };

  const handleCreateVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) return;

    setIsSubmitting(true);
    try {
      await apiCall(`/businesses/${business.id}/vendors`, {
        method: 'POST',
        body: JSON.stringify(addForm)
      });
      addToast({
        type: 'success',
        title: 'Vendor Created',
        message: `Vendor ${addForm.name} added successfully.`
      });
      setIsAddModalOpen(false);
      setAddForm({
        name: '',
        legalName: '',
        taxId: '',
        website: '',
        email: '',
        phone: '',
        category: 'SUPPLIER'
      });
      await fetchVendors();
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Creation Failed',
        message: err.message || 'Failed to create vendor'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenLogs = async (vendor: Vendor) => {
    setSelectedVendorForLogs(vendor);
    setLoadingLogs(true);
    try {
      const res = await apiCall(`/businesses/${business.id}/vendors/${vendor.id}/logs`);
      const list = Array.isArray(res) ? res : (res?.data || []);
      setLogs(list);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Log Error',
        message: err.message || 'Unable to load verification audit logs'
      });
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleSaveManualReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualReviewVendor) return;

    setSubmittingReview(true);
    try {
      await apiCall(`/businesses/${business.id}/vendors/${manualReviewVendor.id}/manual-review`, {
        method: 'POST',
        body: JSON.stringify({
          status: manualReviewStatus,
          notes: manualReviewNotes
        })
      });
      addToast({
        type: 'success',
        title: 'Review Saved',
        message: `Manual verification review saved for ${manualReviewVendor.name}`
      });
      setManualReviewVendor(null);
      setManualReviewNotes('');
      await fetchVendors();
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Review Failed',
        message: err.message || 'Failed to submit manual review'
      });
    } finally {
      setSubmittingReview(false);
    }
  };

  // Metrics
  const totalCount = vendors.length;
  const verifiedCount = vendors.filter(v => v.verificationStatus === 'VERIFIED').length;
  const partialCount = vendors.filter(v => v.verificationStatus === 'PARTIALLY_VERIFIED').length;
  const pendingCount = vendors.filter(v => ['PENDING_VERIFICATION', 'IN_PROGRESS'].includes(v.verificationStatus)).length;
  const failedCount = vendors.filter(v => ['VERIFICATION_FAILED', 'MANUAL_REVIEW_REQUIRED'].includes(v.verificationStatus)).length;

  const filteredVendors = vendors.filter(v => {
    const matchesSearch =
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      (v.taxId && v.taxId.toLowerCase().includes(search.toLowerCase())) ||
      (v.email && v.email.toLowerCase().includes(search.toLowerCase())) ||
      (v.website && v.website.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = statusFilter === 'ALL' || v.verificationStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: Vendor['verificationStatus']) => {
    switch (status) {
      case 'VERIFIED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 size={13} className="text-emerald-600" />
            Verified
          </span>
        );
      case 'PARTIALLY_VERIFIED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock size={13} className="text-amber-600" />
            Partially Verified
          </span>
        );
      case 'PENDING_VERIFICATION':
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
            <RefreshCw size={13} className="text-blue-600 animate-spin" />
            Verification Pending
          </span>
        );
      case 'MANUAL_REVIEW_REQUIRED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
            <AlertTriangle size={13} className="text-purple-600" />
            Review Required
          </span>
        );
      case 'VERIFICATION_FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
            <XCircle size={13} className="text-rose-600" />
            Failed
          </span>
        );
      case 'EXPIRED_VERIFICATION':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
            <Clock size={13} className="text-slate-500" />
            Expired
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldCheck className="text-primary-600" size={28} />
            Vendor Centre & Verification Pipeline
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Automated statutory tax validation, SSRF-protected domain reachability, and vendor risk intelligence.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchVendors()}
            disabled={loading}
            className="p-2.5 hover:bg-slate-100 active:bg-slate-200 rounded-xl transition border border-slate-200 text-slate-600"
            title="Refresh Vendors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            id="add-vendor-btn"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white rounded-xl shadow-sm hover:shadow transition font-semibold text-sm"
          >
            <Plus size={16} />
            Add Vendor
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl border bg-white shadow-sm border-slate-200">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Vendors</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1.5">{totalCount}</p>
          <p className="text-xs text-slate-500 mt-1">Active business suppliers</p>
        </div>

        <div className="p-5 rounded-2xl border bg-emerald-50/70 shadow-sm border-emerald-100">
          <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Fully Verified</p>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1.5">{verifiedCount}</p>
          <p className="text-xs text-emerald-600 mt-1">Tax & domain validated</p>
        </div>

        <div className="p-5 rounded-2xl border bg-amber-50/70 shadow-sm border-amber-100">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Partial / Pending</p>
          <p className="text-2xl font-extrabold text-amber-700 mt-1.5">{partialCount + pendingCount}</p>
          <p className="text-xs text-amber-600 mt-1">{partialCount} partial, {pendingCount} in pipeline</p>
        </div>

        <div className="p-5 rounded-2xl border bg-rose-50/70 shadow-sm border-rose-100">
          <p className="text-xs font-bold text-rose-800 uppercase tracking-wider">Review / Failed</p>
          <p className="text-2xl font-extrabold text-rose-700 mt-1.5">{failedCount}</p>
          <p className="text-xs text-rose-600 mt-1">Requires manual compliance</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative w-full md:w-80">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, GSTIN/EIN, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <Filter size={15} className="text-slate-500" />
          <span className="text-xs font-medium text-slate-500">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="ALL">All Statuses ({totalCount})</option>
            <option value="VERIFIED">Verified ({verifiedCount})</option>
            <option value="PARTIALLY_VERIFIED">Partially Verified ({partialCount})</option>
            <option value="PENDING_VERIFICATION">Pending Verification</option>
            <option value="MANUAL_REVIEW_REQUIRED">Manual Review Required</option>
            <option value="VERIFICATION_FAILED">Failed ({failedCount})</option>
          </select>
        </div>
      </div>

      {/* Vendors Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="animate-spin text-primary-600" size={28} />
            <p className="text-sm">Loading vendor portfolio and verification statuses...</p>
          </div>
        ) : filteredVendors.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Building2 className="mx-auto text-slate-300 mb-3" size={40} />
            <p className="font-semibold text-slate-700">No vendors found</p>
            <p className="text-sm text-slate-500 mt-1">
              {search || statusFilter !== 'ALL'
                ? 'Try adjusting your search criteria or status filter.'
                : 'Click "Add Vendor" to register your first supplier.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-medium">
                <tr>
                  <th className="px-6 py-3.5">Vendor</th>
                  <th className="px-6 py-3.5">Tax / Identity</th>
                  <th className="px-6 py-3.5">Verification Status</th>
                  <th className="px-6 py-3.5">Method & Date</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredVendors.map((vendor) => (
                  <tr key={vendor.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* Name & Contact */}
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900 flex items-center gap-2">
                        {vendor.name}
                        {vendor.category && (
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                            {vendor.category}
                          </span>
                        )}
                      </div>
                      {vendor.legalName && (
                        <div className="text-xs text-slate-500">{vendor.legalName}</div>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        {vendor.website && (
                          <a
                            href={vendor.website.startsWith('http') ? vendor.website : `https://${vendor.website}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-primary-600 hover:underline"
                          >
                            <Globe size={12} />
                            {vendor.website.replace(/^https?:\/\//, '')}
                          </a>
                        )}
                        {vendor.email && (
                          <span className="flex items-center gap-1">
                            <Mail size={12} />
                            {vendor.email}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Tax ID */}
                    <td className="px-6 py-4">
                      {vendor.taxId ? (
                        <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-800 bg-slate-100 px-2 py-1 rounded w-fit">
                          <Hash size={12} className="text-slate-400" />
                          {vendor.taxId}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No Tax ID / GSTIN</span>
                      )}
                      {vendor.failureReason && (
                        <div className="text-xs text-rose-600 mt-1 max-w-xs truncate" title={vendor.failureReason}>
                          Reason: {vendor.failureReason}
                        </div>
                      )}
                    </td>

                    {/* Verification Status */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(vendor.verificationStatus)}
                      {vendor.verificationNotes && (
                        <div className="text-xs text-slate-500 mt-1 max-w-xs truncate" title={vendor.verificationNotes}>
                          {vendor.verificationNotes}
                        </div>
                      )}
                    </td>

                    {/* Method & Date */}
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                      <div>
                        {vendor.verificationMethod ? (
                          <span className="font-medium text-slate-700">
                            {vendor.verificationMethod.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          'Not verified yet'
                        )}
                      </div>
                      <div className="text-slate-400 mt-0.5">
                        {vendor.verifiedAt
                          ? `Verified: ${new Date(vendor.verifiedAt).toLocaleDateString()}`
                          : `Created: ${new Date(vendor.createdAt).toLocaleDateString()}`}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                      <button
                        onClick={() => handleRunVerification(vendor.id, vendor.name)}
                        disabled={verifyingId === vendor.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition disabled:opacity-50 border border-emerald-200"
                        title="Run Automated Verification Suite"
                      >
                        <RefreshCw size={12} className={verifyingId === vendor.id ? 'animate-spin' : ''} />
                        {verifyingId === vendor.id ? 'Verifying...' : 'Verify'}
                      </button>

                      <button
                        onClick={() => {
                          setManualReviewVendor(vendor);
                          setManualReviewStatus(
                            vendor.verificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PARTIALLY_VERIFIED'
                          );
                          setManualReviewNotes(vendor.verificationNotes || '');
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition border border-slate-200"
                        title="Manual Compliance Override"
                      >
                        Review
                      </button>

                      <button
                        onClick={() => handleOpenLogs(vendor)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-white text-slate-600 hover:bg-slate-100 rounded-lg transition border border-slate-200"
                        title="View Audit Evidence & Logs"
                      >
                        <Eye size={12} />
                        Logs
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ADD VENDOR MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="text-primary-600" size={20} />
                Add New Vendor
              </h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateVendor} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Vendor Trading Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Industrial Supplies"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Legal Registered Name</label>
                <input
                  type="text"
                  placeholder="e.g. Apex Industrial Private Limited"
                  value={addForm.legalName}
                  onChange={(e) => setAddForm({ ...addForm, legalName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Tax ID / GSTIN / EIN
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 29ABCDE1234F1Z5"
                    value={addForm.taxId}
                    onChange={(e) => setAddForm({ ...addForm, taxId: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                  <select
                    value={addForm.category}
                    onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="SUPPLIER">Supplier</option>
                    <option value="CONTRACTOR">Contractor</option>
                    <option value="SERVICE_PROVIDER">Service Provider</option>
                    <option value="DISTRIBUTOR">Distributor</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Official Website</label>
                <input
                  type="text"
                  placeholder="e.g. https://apexsupplies.com"
                  value={addForm.website}
                  onChange={(e) => setAddForm({ ...addForm, website: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Verified with SSRF safety checks (private ranges and malicious redirects blocked).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Business Email</label>
                  <input
                    type="email"
                    placeholder="contact@apexsupplies.com"
                    value={addForm.email}
                    onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="text"
                    placeholder="+91 98765 43210"
                    value={addForm.phone}
                    onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Add & Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MANUAL REVIEW MODAL */}
      {manualReviewVendor && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="text-amber-500" size={20} />
              Manual Verification Override
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Override verification state for <span className="font-semibold text-slate-800">{manualReviewVendor.name}</span> based on external offline statutory verification documents.
            </p>

            <form onSubmit={handleSaveManualReview} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Verification Status Decision</label>
                <select
                  value={manualReviewStatus}
                  onChange={(e: any) => setManualReviewStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="VERIFIED">Verified (Full Statutory Compliance Verified)</option>
                  <option value="PARTIALLY_VERIFIED">Partially Verified (Limited Offline Evidence)</option>
                  <option value="VERIFICATION_FAILED">Verification Failed (Non-compliant)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Compliance Notes / Evidence Citation *</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Cite offline document reference, GST portal certificate #, or compliance notes..."
                  value={manualReviewNotes}
                  onChange={(e) => setManualReviewNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setManualReviewVendor(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReview}
                  className="px-5 py-2 text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow transition disabled:opacity-50"
                >
                  {submittingReview ? 'Saving...' : 'Submit Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUDIT LOGS DRAWER */}
      {selectedVendorForLogs && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex justify-end">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl p-6 overflow-y-auto flex flex-col justify-between animate-in slide-in-from-right duration-200">
            <div>
              <div className="flex justify-between items-center pb-4 border-b border-slate-200">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Verification Audit Evidence</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Audit trail for <span className="font-semibold text-slate-800">{selectedVendorForLogs.name}</span>
                  </p>
                </div>
                <button
                  onClick={() => setSelectedVendorForLogs(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>

              <div className="mt-6 space-y-4">
                {loadingLogs ? (
                  <div className="p-8 text-center text-slate-500 flex flex-col items-center gap-2">
                    <RefreshCw className="animate-spin text-primary-600" size={24} />
                    <p className="text-sm">Loading audit logs...</p>
                  </div>
                ) : logs.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 border border-dashed rounded-xl">
                    <FileText size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-semibold text-slate-700">No verification attempts logged yet</p>
                    <p className="text-xs text-slate-500 mt-1">Run verification to generate immutable audit evidence.</p>
                  </div>
                ) : (
                  logs.map((log: any) => (
                    <div
                      key={log.id}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2 text-xs"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-800 uppercase tracking-wider">
                          {log.verificationMethod?.replace(/_/g, ' ') || 'VERIFICATION'}
                        </span>
                        <span className="font-mono text-slate-500">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-600">Status Result:</span>
                        {getStatusBadge(log.status)}
                      </div>

                      {log.performedBy && (
                        <div className="text-slate-600">
                          <span className="font-medium">Auditor:</span> {log.performedBy.name || log.performedBy.email}
                        </div>
                      )}

                      {log.notes && (
                        <div className="p-2.5 bg-white rounded border border-slate-200 text-slate-700">
                          <span className="font-semibold">Notes:</span> {log.notes}
                        </div>
                      )}

                      {log.evidenceData && (
                        <div className="mt-2">
                          <span className="font-semibold text-slate-600 block mb-1">Raw Evidence Checks:</span>
                          <pre className="p-2.5 bg-slate-900 text-emerald-400 rounded-lg font-mono text-[11px] overflow-x-auto max-h-48">
                            {JSON.stringify(log.evidenceData, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 mt-6">
              <button
                onClick={() => setSelectedVendorForLogs(null)}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition"
              >
                Close Audit View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
