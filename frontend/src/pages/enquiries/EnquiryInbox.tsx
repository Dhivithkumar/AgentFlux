import React, { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Inbox, Filter, ChevronRight, User, AlertCircle, Clock, CheckCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function EnquiryInbox() {
  const [enquiries, setEnquiries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { business: currentBusiness } = useOutletContext<{ business: any }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (currentBusiness) {
      loadEnquiries();
    }
  }, [currentBusiness]);

  const loadEnquiries = async () => {
    try {
      const response = await fetch(`/api/enquiries?businessId=${currentBusiness?.id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (response.ok) {
        setEnquiries(data);
      }
    } catch (error) {
      console.error('Failed to load enquiries', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'NEW': return 'bg-blue-100 text-blue-800';
      case 'PROCESSING': return 'bg-yellow-100 text-yellow-800';
      case 'NEEDS_INFORMATION': return 'bg-red-100 text-red-800';
      case 'READY': return 'bg-green-100 text-green-800';
      case 'IN_PROGRESS': return 'bg-purple-100 text-purple-800';
      case 'RESOLVED': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getConfidenceIcon = (confidence: string) => {
    switch (confidence) {
      case 'HIGH': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'MEDIUM': return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'LOW': return <AlertCircle className="w-4 h-4 text-red-500" />;
      default: return null;
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Inbox className="w-6 h-6 mr-2 text-blue-600" />
            Enquiry Inbox
          </h1>
          <p className="text-gray-500 text-sm mt-1">Manage incoming customer requests dynamically mapped to your workflow.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button className="flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
            <Filter className="w-4 h-4 mr-2" />
            Filter
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b text-gray-500 uppercase text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Customer</th>
                <th className="px-6 py-4 font-medium">Summary</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">AI Confidence</th>
                <th className="px-6 py-4 font-medium">Received</th>
                <th className="px-6 py-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading enquiries...</td>
                </tr>
              ) : enquiries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <Inbox className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <h3 className="text-lg font-medium text-gray-900">No Enquiries Yet</h3>
                    <p className="text-gray-500 mt-1">When customers submit requests, they will appear here.</p>
                  </td>
                </tr>
              ) : (
                enquiries.map((enquiry) => (
                  <tr 
                    key={enquiry.id} 
                    className="border-b hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/dashboard/enquiries/${enquiry.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mr-3 flex-shrink-0">
                          {enquiry.customer.name ? enquiry.customer.name.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{enquiry.customer.name || 'Unknown User'}</div>
                          <div className="text-xs text-gray-500">{enquiry.source}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-gray-900 truncate max-w-xs">{enquiry.summary || 'No summary generated'}</div>
                      <div className="text-xs text-gray-500 mt-1 truncate max-w-xs">{enquiry.nextAction || 'Pending review'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(enquiry.status)}`}>
                        {enquiry.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        {getConfidenceIcon(enquiry.confidence)}
                        <span className="text-gray-700 capitalize">{enquiry.confidence?.toLowerCase() || 'N/A'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                      {formatDistanceToNow(new Date(enquiry.createdAt), { addSuffix: true })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <ChevronRight className="w-5 h-5 text-gray-400 inline" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
