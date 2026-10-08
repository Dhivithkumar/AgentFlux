import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Phone, Mail, FileText, Check, X, AlertTriangle, Save, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';

export default function EnquiryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [enquiry, setEnquiry] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingFields, setEditingFields] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadEnquiry();
  }, [id]);

  const [opsStatus, setOpsStatus] = useState<any>(null);

  const loadEnquiry = async () => {
    try {
      const response = await fetch(`/api/enquiries/${id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (response.ok) {
        setEnquiry(data);
        setEditingFields(data.structuredData || {});
        
        // Also fetch ops sync status
        if (data.businessId) {
          const opsRes = await fetch(`/api/operations/sheets/status?businessId=${data.businessId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
          });
          const opsText = await opsRes.text();
          const opsData = opsText ? JSON.parse(opsText) : null;
          if (opsRes.ok && opsData.status) {
            setOpsStatus(opsData.status);
          }
        }
      } else {
        navigate('/dashboard/enquiries');
      }
    } catch (error) {
      console.error('Failed to load enquiry', error);
      navigate('/dashboard/enquiries');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (key: string, value: any) => {
    setEditingFields(prev => ({ ...prev, [key]: value }));
  };

  const saveCorrections = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/enquiries/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          structuredData: editingFields,
          status: enquiry.status === 'NEEDS_INFORMATION' ? 'PROCESSING' : enquiry.status // If they manually fixed it, move it forward
        })
      });
      
      if (response.ok) {
        const updatedText = await response.text();
        const updated = updatedText ? JSON.parse(updatedText) : null;
        setEnquiry((prev: any) => ({ ...prev, structuredData: updated.structuredData, status: updated.status }));
      }
    } catch (error) {
      console.error('Failed to save corrections', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading || !enquiry) {
    return <div className="p-8 text-center text-gray-500">Loading details...</div>;
  }

  const { customer, rawMessage, summary, structuredData, status, confidence, nextAction, createdAt } = enquiry;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4 mb-4">
        <button onClick={() => navigate('/dashboard/enquiries')} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Enquiry Details</h1>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
          status === 'NEEDS_INFORMATION' ? 'bg-red-100 text-red-800' :
          status === 'READY' ? 'bg-green-100 text-green-800' :
          'bg-blue-100 text-blue-800'
        }`}>
          {status.replace('_', ' ')}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Customer & Message */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center">
              <User className="w-4 h-4 mr-2" /> Customer Info
            </h2>
            <div className="space-y-3">
              <div>
                <div className="text-sm text-gray-500">Name</div>
                <div className="font-medium text-gray-900">{customer.name || 'Unknown'}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Phone</div>
                <div className="font-medium text-gray-900 flex items-center">
                  <Phone className="w-4 h-4 mr-1 text-gray-400" /> {customer.phone || 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Email</div>
                <div className="font-medium text-gray-900 flex items-center break-all">
                  <Mail className="w-4 h-4 mr-1 text-gray-400" /> {customer.email || 'N/A'}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-5">
             <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center">
              <MessageSquare className="w-4 h-4 mr-2" /> Original Request
            </h2>
            <div className="bg-gray-50 rounded-lg p-4 text-gray-800 whitespace-pre-wrap text-sm border">
              {rawMessage}
            </div>
            <div className="text-xs text-gray-400 mt-3 text-right">
              Received via {enquiry.source} on {format(new Date(createdAt), 'MMM d, yyyy HH:mm')}
            </div>
          </div>

          {opsStatus && (
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center">
                Operational Sync
              </h2>
              <div className="flex flex-col gap-2">
                {opsStatus.status === 'SYNCED' ? (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-2 rounded border border-green-200">
                    <Check className="w-4 h-4" /> Synced to Google Sheets
                  </div>
                ) : opsStatus.status === 'FAILED' ? (
                  <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 p-2 rounded border border-red-200">
                    <AlertTriangle className="w-4 h-4" /> Sync Failed
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 p-2 rounded border border-blue-200">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div> Syncing...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: AI Extraction & Action */}
        <div className="lg:col-span-2 space-y-6">
          {status === 'NEEDS_INFORMATION' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start">
              <AlertTriangle className="w-6 h-6 text-red-500 mr-3 mt-0.5" />
              <div>
                <h3 className="text-red-800 font-medium">Missing Information Detected</h3>
                <p className="text-red-600 text-sm mt-1">
                  The AI could not confidently extract all required fields from the message. 
                  Please review the message and manually input the missing fields below, or request more info.
                </p>
                <div className="mt-3">
                  <button className="bg-red-100 text-red-700 hover:bg-red-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                    Request Information from Customer
                  </button>
                </div>
              </div>
            </div>
          )}

          {status === 'READY' || status === 'RESOLVED' || status === 'PROCESSING' ? (
            <div className="bg-primary-50 border border-primary-200 rounded-xl p-5 flex items-center justify-between">
              <div>
                <h3 className="text-primary-800 font-medium">Ready for Conversion</h3>
                <p className="text-primary-600 text-sm mt-1">
                  This enquiry can be converted into an active Order/Booking.
                </p>
              </div>
              <button 
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/enquiries/${id}/convert-to-order`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                    });
                    if (res.ok) {
                      const textData = await res.text();
                      const data = textData ? JSON.parse(textData) : null;
                      navigate(`/dashboard/orders/${data.id}`);
                    } else {
                      const errText = await res.text();
                      const err = errText ? JSON.parse(errText) : null;
                      alert('Failed to convert: ' + err.error);
                    }
                  } catch (e) {
                    alert('Failed to convert');
                  }
                }}
                className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
              >
                Convert to Order
              </button>
            </div>
          ) : null}

          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="border-b px-5 py-4 flex justify-between items-center bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center">
                <FileText className="w-4 h-4 mr-2 text-blue-600" /> Extracted Data
              </h2>
              <div className="flex items-center space-x-4">
                <div className="text-xs text-gray-500 flex items-center">
                  Confidence: 
                  <span className={`ml-1 font-medium ${
                    confidence === 'HIGH' ? 'text-green-600' :
                    confidence === 'LOW' ? 'text-red-600' : 'text-yellow-600'
                  }`}>{confidence}</span>
                </div>
                <button 
                  onClick={saveCorrections}
                  disabled={isSaving}
                  className="flex items-center text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4 mr-1.5" /> {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
            
            <div className="p-5">
              <div className="mb-6">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">AI Summary</label>
                <p className="text-gray-900 font-medium">{summary}</p>
              </div>

              <div className="space-y-4">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Dynamic Fields</label>
                
                {Object.keys(editingFields).length === 0 && status !== 'NEEDS_INFORMATION' ? (
                  <div className="text-sm text-gray-500 italic">No structured fields extracted.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Render all keys in the structured payload */}
                    {Object.entries(editingFields).map(([key, value]) => (
                      <div key={key}>
                        <label className="block text-sm text-gray-700 capitalize mb-1">{key.replace(/([A-Z])/g, ' $1').trim()}</label>
                        <input
                          type="text"
                          value={value || ''}
                          onChange={(e) => handleFieldChange(key, e.target.value)}
                          className="w-full border-gray-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2.5 border"
                          placeholder={`Enter ${key}...`}
                        />
                      </div>
                    ))}
                    {/* Optionally we could render missing required fields explicitly as red inputs, but in Phase 2 we just map what's available. If it's missing, the admin can just use a blank box if we seed it, or we rely on them adding it. To keep it generic, we are mapping the struct. */}
                  </div>
                )}
              </div>
            </div>
            <div className="bg-gray-50 p-4 border-t text-sm flex justify-between items-center">
              <span className="text-gray-500">Suggested Next Action:</span>
              <span className="font-medium text-gray-900">{nextAction || 'None'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
