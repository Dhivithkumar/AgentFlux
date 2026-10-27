import React, { useState, useEffect } from 'react';
import { apiCall } from '../../lib/api';
import { formatCurrency } from '../../lib/currency';
import {
  X,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Building2,
  UserCheck,
  CreditCard,
  Calendar,
  DollarSign
} from 'lucide-react';

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated: (newOrder: any) => void;
  businessId: string;
  currency?: string;
}

interface OrderItem {
  productName: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  lineTotal: number;
}

export default function CreateOrderModal({
  isOpen,
  onClose,
  onOrderCreated,
  businessId,
  currency = 'INR'
}: CreateOrderModalProps) {
  // Mode: select existing or create inline
  const [customerMode, setCustomerMode] = useState<'SELECT' | 'NEW'>('SELECT');
  const [searchQuery, setSearchQuery] = useState('');
  const [customerOptions, setCustomerOptions] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);

  // New customer inline inputs
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerCreditLimit, setNewCustomerCreditLimit] = useState<number>(0);
  const [newCustomerAddress, setNewCustomerAddress] = useState('');

  // Customer Financial Context (loaded when customer selected)
  const [financialSummary, setFinancialSummary] = useState<any | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Vendors list for assignment
  const [vendors, setVendors] = useState<any[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');

  // Order Fields
  const [items, setItems] = useState<OrderItem[]>([
    { productName: '', description: '', quantity: 1, unitPrice: 0, discount: 0, taxRate: 18, lineTotal: 0 }
  ]);
  const [orderDate, setOrderDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dueAt, setDueAt] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [paymentTerms, setPaymentTerms] = useState<string>('NET_30');
  const [orderStatus, setOrderStatus] = useState<string>('CONFIRMED');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [recordPaymentNow, setRecordPaymentNow] = useState<boolean>(false);
  const [paymentMethod, setPaymentMethod] = useState<string>('BANK_TRANSFER');

  // Submission state & Idempotency
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize idempotency key and vendors when modal opens
  useEffect(() => {
    if (isOpen) {
      setIdempotencyKey(`ord-create-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
      setErrorMessage(null);
      loadVendors();
      searchCustomers('');
    }
  }, [isOpen, businessId]);

  const loadVendors = async () => {
    try {
      const res = await apiCall(`/businesses/${businessId}/vendors`);
      if (res?.data) {
        setVendors(res.data);
      }
    } catch (e) {
      console.warn('Failed to load vendors', e);
    }
  };

  const searchCustomers = async (q: string) => {
    setCustomerLoading(true);
    try {
      const res = await apiCall(`/businesses/${businessId}/customers?search=${encodeURIComponent(q)}&limit=10`);
      if (res?.data) {
        setCustomerOptions(res.data);
      }
    } catch (e) {
      console.warn('Failed to search customers', e);
    } finally {
      setCustomerLoading(false);
    }
  };

  const handleSelectCustomer = async (cust: any) => {
    setSelectedCustomer(cust);
    setLoadingSummary(true);
    try {
      const res = await apiCall(`/businesses/${businessId}/customers/${cust.id}/financial-summary`);
      if (res?.data) {
        setFinancialSummary(res.data);
      }
    } catch (e) {
      console.warn('Failed to load customer summary', e);
    } finally {
      setLoadingSummary(false);
    }
  };

  // Line item manipulation & auto-calculation
  const updateItem = (index: number, field: keyof OrderItem, val: any) => {
    const updated = [...items];
    const item = { ...updated[index], [field]: val };

    const qty = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const discount = Number(item.discount || 0);
    const taxRate = Number(item.taxRate || 0);

    const sub = qty * unitPrice;
    const taxable = Math.max(0, sub - discount);
    const tax = (taxable * taxRate) / 100;
    item.lineTotal = Math.round((taxable + tax) * 100) / 100;

    updated[index] = item;
    setItems(updated);
  };

  const addItem = () => {
    setItems([
      ...items,
      { productName: '', description: '', quantity: 1, unitPrice: 0, discount: 0, taxRate: 18, lineTotal: 0 }
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  // Aggregate totals
  const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitPrice || 0)), 0);
  const totalDiscount = items.reduce((sum, item) => sum + Number(item.discount || 0), 0);
  const totalTax = items.reduce((sum, item) => {
    const sub = Number(item.quantity || 0) * Number(item.unitPrice || 0);
    const taxable = Math.max(0, sub - Number(item.discount || 0));
    return sum + ((taxable * Number(item.taxRate || 0)) / 100);
  }, 0);
  const totalAmount = Math.max(0, subtotal - totalDiscount + totalTax);
  const outstandingAmount = Math.max(0, totalAmount - paidAmount);

  // Submit Order
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (customerMode === 'SELECT' && !selectedCustomer) {
      setErrorMessage('Please select a customer or switch to "New Customer".');
      return;
    }

    if (customerMode === 'NEW' && !newCustomerName.trim()) {
      setErrorMessage('Please enter a customer name.');
      return;
    }

    const validItems = items.filter(i => i.productName.trim().length > 0 && i.quantity > 0);
    if (validItems.length === 0) {
      setErrorMessage('Please add at least one line item with a name and quantity.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        idempotencyKey,
        currency,
        items: validItems,
        orderDate,
        dueAt: dueAt || null,
        notes,
        paymentTerms,
        status: orderStatus,
        paidAmount,
        recordPaymentNow,
        paymentMethod: recordPaymentNow ? paymentMethod : undefined,
        vendorId: selectedVendorId || null
      };

      if (customerMode === 'SELECT') {
        payload.customerId = selectedCustomer.id;
      } else {
        payload.customerName = newCustomerName.trim();
        payload.customerEmail = newCustomerEmail.trim() || undefined;
        payload.customerPhone = newCustomerPhone.trim() || undefined;
        payload.creditLimit = newCustomerCreditLimit || 0;
        payload.customerAddress = newCustomerAddress.trim() || undefined;
      }

      const res = await apiCall(`/businesses/${businessId}/orders`, {
        method: 'POST',
        headers: {
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      if (res?.error) {
        throw new Error(res.error);
      }

      onOrderCreated(res);
      onClose();
    } catch (err: any) {
      console.error('Order creation failed:', err);
      setErrorMessage(err.message || 'Failed to create order. Please review your entries.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center font-bold text-lg border border-primary-100 shadow-sm">
              +
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Create Manual Order</h2>
              <p className="text-xs text-slate-500">Order management, items calculation & credit risk verification</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {errorMessage && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start space-x-3 text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Creation Error</p>
                <p className="text-xs mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Section 1: Customer Selection & Credit Risk */}
          <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-primary-600" />
                Customer Details & Exposure
              </label>
              <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setCustomerMode('SELECT')}
                  className={`px-3 py-1 rounded-md transition-all ${customerMode === 'SELECT' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Existing Customer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomerMode('NEW');
                    setSelectedCustomer(null);
                    setFinancialSummary(null);
                  }}
                  className={`px-3 py-1 rounded-md transition-all ${customerMode === 'NEW' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  New Customer
                </button>
              </div>
            </div>

            {customerMode === 'SELECT' ? (
              <div className="space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      searchCustomers(e.target.value);
                    }}
                    placeholder="Search customer by name, email, phone, or ID..."
                    className="w-full px-3.5 py-2.5 text-sm bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                  {customerLoading && (
                    <span className="absolute right-3 top-3 text-xs text-slate-400">Searching...</span>
                  )}
                </div>

                {customerOptions.length > 0 && !selectedCustomer && (
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 bg-white rounded-lg border border-slate-200 shadow-sm">
                    {customerOptions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectCustomer(c)}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-primary-50/60 transition-colors flex items-center justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">{c.name || 'Unnamed'}</p>
                          <p className="text-xs text-slate-500">{c.phone || c.email || c.id}</p>
                        </div>
                        <div className="text-right">
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                            c.paymentScoreCategory === 'STRONG' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            c.paymentScoreCategory === 'GOOD' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                            c.paymentScoreCategory === 'CAUTION' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                            c.paymentScoreCategory === 'HIGH_RISK' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {c.paymentScore !== null ? `Score: ${c.paymentScore}/100` : 'Insufficient History'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Selected Customer Card with Financial Exposure */}
                {selectedCustomer && (
                  <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-slate-400">Selected Customer:</span>
                        <p className="text-sm font-bold text-slate-900">{selectedCustomer.name}</p>
                        <p className="text-xs text-slate-500">{selectedCustomer.phone} • {selectedCustomer.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(null);
                          setFinancialSummary(null);
                        }}
                        className="text-xs text-primary-600 hover:underline font-medium"
                      >
                        Change
                      </button>
                    </div>

                    {loadingSummary ? (
                      <div className="text-xs text-slate-400">Loading customer financial exposure...</div>
                    ) : financialSummary ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
                        <div className="p-2 rounded-md bg-slate-50 border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Payment Score</span>
                          <span className={`text-xs font-bold ${
                            financialSummary.paymentScore >= 80 ? 'text-emerald-700' :
                            financialSummary.paymentScore >= 60 ? 'text-blue-700' :
                            financialSummary.paymentScore >= 40 ? 'text-amber-700' : 'text-rose-700'
                          }`}>
                            {financialSummary.paymentScore !== null ? `${financialSummary.paymentScore}/100` : 'Insufficient History'}
                          </span>
                        </div>
                        <div className="p-2 rounded-md bg-slate-50 border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Outstanding</span>
                          <span className="text-xs font-bold text-slate-900">
                            {formatCurrency(financialSummary.totalOutstanding, currency)}
                          </span>
                        </div>
                        <div className={`p-2 rounded-md border ${financialSummary.overdueBalance > 0 ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-100'}`}>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Overdue Balance</span>
                          <span className={`text-xs font-bold ${financialSummary.overdueBalance > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                            {formatCurrency(financialSummary.overdueBalance, currency)}
                          </span>
                        </div>
                        <div className={`p-2 rounded-md border ${financialSummary.creditBreached ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Available Credit</span>
                          <span className={`text-xs font-bold ${financialSummary.creditBreached ? 'text-amber-700' : 'text-emerald-700'}`}>
                            {formatCurrency(financialSummary.availableCredit, currency)}
                          </span>
                        </div>
                      </div>
                    ) : null}

                    {financialSummary?.overdueBalance > 0 && (
                      <div className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Caution: Customer has {formatCurrency(financialSummary.overdueBalance, currency)} in overdue invoices across previous orders.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700">Customer Name *</label>
                  <input
                    type="text"
                    required
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="e.g. Acme Industries Ltd"
                    className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Phone Number</label>
                  <input
                    type="text"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Email Address</label>
                  <input
                    type="email"
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    placeholder="billing@acme.com"
                    className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Credit Limit ({currency})</label>
                  <input
                    type="number"
                    min="0"
                    value={newCustomerCreditLimit || ''}
                    onChange={(e) => setNewCustomerCreditLimit(Number(e.target.value))}
                    placeholder="0 for standard / no limit"
                    className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Billing / Delivery Address</label>
                  <input
                    type="text"
                    value={newCustomerAddress}
                    onChange={(e) => setNewCustomerAddress(e.target.value)}
                    placeholder="Warehouse 4, Industrial Zone, Phase II"
                    className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Line Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Order Items & Pricing
              </label>
              <button
                type="button"
                onClick={addItem}
                className="text-xs font-semibold text-primary-600 hover:text-primary-800 flex items-center gap-1 bg-primary-50 px-2.5 py-1 rounded-md border border-primary-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Item / Description</th>
                    <th className="px-2 py-2 text-right w-20">Qty</th>
                    <th className="px-2 py-2 text-right w-28">Unit Price</th>
                    <th className="px-2 py-2 text-right w-24">Discount</th>
                    <th className="px-2 py-2 text-right w-24">Tax %</th>
                    <th className="px-3 py-2 text-right w-28">Total</th>
                    <th className="px-2 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, index) => (
                    <tr key={index} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          required
                          value={item.productName}
                          onChange={(e) => updateItem(index, 'productName', e.target.value)}
                          placeholder="e.g. Ergonomic Office Chair"
                          className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min="1"
                          required
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                          className="w-full px-2 py-1 text-right bg-white border border-slate-200 rounded text-xs focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={item.unitPrice || ''}
                          onChange={(e) => updateItem(index, 'unitPrice', Number(e.target.value))}
                          className="w-full px-2 py-1 text-right bg-white border border-slate-200 rounded text-xs focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.discount || ''}
                          onChange={(e) => updateItem(index, 'discount', Number(e.target.value))}
                          className="w-full px-2 py-1 text-right bg-white border border-slate-200 rounded text-xs focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={item.taxRate}
                          onChange={(e) => updateItem(index, 'taxRate', Number(e.target.value))}
                          className="w-full px-2 py-1 text-right bg-white border border-slate-200 rounded text-xs focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {formatCurrency(item.lineTotal, currency)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="text-slate-400 hover:text-rose-600 transition-colors p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Calculations Breakdown */}
            <div className="flex justify-end">
              <div className="w-72 bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-medium">{formatCurrency(subtotal, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Discount:</span>
                  <span className="font-medium text-rose-600">-{formatCurrency(totalDiscount, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tax Amount:</span>
                  <span className="font-medium">+{formatCurrency(totalTax, currency)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Order Total:</span>
                  <span className="text-primary-700">{formatCurrency(totalAmount, currency)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Operational Dates & Vendor Assignment */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" /> Order Date
              </label>
              <input
                type="date"
                required
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" /> Expected Delivery / Due
              </label>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-slate-500" /> Assign Vendor (Optional)
              </label>
              <select
                value={selectedVendorId}
                onChange={(e) => setSelectedVendorId(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">No vendor assigned</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.verificationStatus})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 4: Terms, Status & Partial Payment */}
          <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/80 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Payment Terms</label>
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:ring-2 focus:ring-primary-500"
                >
                  <option value="NET_30">Net 30 Days</option>
                  <option value="NET_15">Net 15 Days</option>
                  <option value="DUE_ON_RECEIPT">Due on Receipt</option>
                  <option value="ADVANCE_50">50% Advance / Balance on Delivery</option>
                  <option value="CASH_ON_DELIVERY">Cash on Delivery (COD)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Order Status</label>
                <select
                  value={orderStatus}
                  onChange={(e) => setOrderStatus(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:ring-2 focus:ring-primary-500"
                >
                  <option value="CONFIRMED">CONFIRMED (Ready for fulfillment)</option>
                  <option value="DRAFT">DRAFT (Estimate / Review)</option>
                  <option value="IN_PROGRESS">IN_PROGRESS (Production active)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Advance / Paid Amount ({currency})</label>
                <input
                  type="number"
                  min="0"
                  max={totalAmount}
                  step="0.01"
                  value={paidAmount || ''}
                  onChange={(e) => setPaidAmount(Number(e.target.value))}
                  placeholder="0.00"
                  className="w-full mt-1 px-3 py-2 text-sm bg-white rounded-lg border border-slate-300 focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            {/* Initial Payment options */}
            {paidAmount > 0 && (
              <div className="p-3 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="recordPaymentNow"
                    checked={recordPaymentNow}
                    onChange={(e) => setRecordPaymentNow(e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded border-slate-300 focus:ring-primary-500"
                  />
                  <label htmlFor="recordPaymentNow" className="text-xs text-slate-700 font-medium">
                    Record {formatCurrency(paidAmount, currency)} payment immediately in accounting records
                  </label>
                </div>
                {recordPaymentNow && (
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="text-xs px-2.5 py-1 bg-slate-50 border border-slate-200 rounded"
                  >
                    <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                    <option value="CASH">Cash Settlement</option>
                    <option value="RAZORPAY">Razorpay / Online</option>
                    <option value="CHEQUE">Cheque / Demand Draft</option>
                  </select>
                )}
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-slate-700">Internal Order Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special delivery instructions, packaging requirements, or credit notes..."
                className="w-full mt-1 px-3 py-2 text-xs bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="text-xs text-slate-500">
            <span>Outstanding Balance for this order: </span>
            <span className="font-bold text-slate-900">{formatCurrency(outstandingAmount, currency)}</span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg shadow-sm shadow-primary-600/30 transition-all flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Creating Order...</span>
                </>
              ) : (
                <span>Confirm & Create Order</span>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
