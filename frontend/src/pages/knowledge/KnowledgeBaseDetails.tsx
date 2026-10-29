import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link, useOutletContext } from 'react-router-dom';
import { apiCall } from '../../lib/api';
import { ArrowLeft, Upload, Trash2, RefreshCw, Search, FileText, Database } from 'lucide-react';

export default function KnowledgeBaseDetails() {
  const { id } = useParams();
  const { business } = useOutletContext<{ business: any }>();
  const [kb, setKb] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [knowledgeType, setKnowledgeType] = useState('OTHER');

  // Source configuration state
  const [selectedSourceType, setSelectedSourceType] = useState('GOOGLE_DRIVE');
  const [selectedConnectorId, setSelectedConnectorId] = useState('');
  const [sourceName, setSourceName] = useState('');
  
  // Drive specific
  const [driveFolderId, setDriveFolderId] = useState('');
  
  // Sheets specific
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetNames, setSheetNames] = useState(''); // Comma separated

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    try {
      const [kbRes, docsRes, sourcesRes, intRes] = await Promise.all([
        apiCall(`/knowledge/${id}?businessId=${business.id}`),
        apiCall(`/knowledge/${id}/documents?businessId=${business.id}`),
        apiCall(`/knowledge/${id}/sources?businessId=${business.id}`),
        apiCall(`/integrations?businessId=${business.id}`) // Use actual business context
      ]);
      setKb(kbRes);
      setDocs(docsRes);
      setSources(sourcesRes);
      setIntegrations(intRes?.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
    // Poll for status updates
    const interval = setInterval(() => {
      loadData();
    }, 5000);
    return () => clearInterval(interval);
  }, [id]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const uploadPromises = Array.from(files).map(file => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('knowledgeType', knowledgeType);

        return fetch(`http://localhost:3001/api/knowledge/${id}/documents?businessId=${business.id}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: formData
        });
      });

      await Promise.all(uploadPromises);
      loadData();
    } catch (err) {
      alert('Upload failed for one or more files');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    let configuration: any = {};
    if (selectedSourceType === 'GOOGLE_DRIVE' && driveFolderId.trim()) {
      configuration = { folders: [driveFolderId.trim()] };
    } else if (selectedSourceType === 'GOOGLE_SHEETS' && spreadsheetId.trim()) {
      configuration = { 
        spreadsheets: [{ 
          spreadsheetId: spreadsheetId.trim(), 
          sheets: sheetNames.split(',').map(s => s.trim()).filter(s => s) 
        }] 
      };
    }

    await apiCall(`/knowledge/${id}/sources`, {
      method: 'POST',
      body: JSON.stringify({
        type: selectedSourceType,
        name: sourceName,
        connectorId: selectedConnectorId,
        configuration,
        businessId: business.id
      })
    });
    setShowSourceModal(false);
    setSourceName('');
    setDriveFolderId('');
    setSpreadsheetId('');
    setSheetNames('');
    loadData();
  };

  const handleSyncSource = async (sourceId: string) => {
    await apiCall(`/knowledge/sources/${sourceId}/sync`, { method: 'POST', body: JSON.stringify({ businessId: business.id }) });
    loadData();
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!confirm('Are you sure you want to remove this source and all its documents?')) return;
    await apiCall(`/knowledge/sources/${sourceId}?businessId=${business.id}`, { method: 'DELETE' });
    loadData();
  };

  const handleReprocess = async (docId: string) => {
    await apiCall(`/knowledge/documents/${docId}/reprocess`, { method: 'POST', body: JSON.stringify({ businessId: business.id }) });
    loadData();
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    await apiCall(`/knowledge/documents/${docId}?businessId=${business.id}`, { method: 'DELETE' });
    loadData();
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    const res = await apiCall(`/knowledge/${id}/search`, {
      method: 'POST',
      body: JSON.stringify({ query: searchQuery, businessId: business.id })
    });
    setSearchResults(res);
  };

  if (!kb) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-2">
        <Link to="/dashboard/knowledge" className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{kb.name}</h2>
          <p className="text-slate-500">{kb.description}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-slate-900">Connected Sources</h3>
          <button 
            onClick={() => setShowSourceModal(true)}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700"
          >
            <Upload size={18} /> Add Source
          </button>
        </div>
        
        {showSourceModal && (
          <div className="p-6 border-b border-slate-200 bg-slate-50">
            <h4 className="font-medium mb-4">Connect New Source</h4>
            <form onSubmit={handleAddSource} className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium mb-1">Source Name</label>
                <input required type="text" value={sourceName} onChange={e => setSourceName(e.target.value)} className="w-full p-2 border rounded" placeholder="e.g. Employee Handbook Drive" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Source Type</label>
                <select value={selectedSourceType} onChange={e => setSelectedSourceType(e.target.value)} className="w-full p-2 border rounded">
                  <option value="GOOGLE_DRIVE">Google Drive</option>
                  <option value="GOOGLE_SHEETS">Google Sheets</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Select Connected Account</label>
                <select required value={selectedConnectorId} onChange={e => setSelectedConnectorId(e.target.value)} className="w-full p-2 border rounded">
                  <option value="">-- Select Integration --</option>
                  {integrations.filter(i => i.provider === selectedSourceType).map(i => (
                    <option key={i.id} value={i.id}>{i.accountEmail || i.accountId}</option>
                  ))}
                </select>
                {integrations.filter(i => i.provider === selectedSourceType).length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No integrations found for this type. Please connect one in settings.</p>
                )}
              </div>
              
              {selectedSourceType === 'GOOGLE_DRIVE' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Target Folder ID (Optional)</label>
                  <input type="text" value={driveFolderId} onChange={e => setDriveFolderId(e.target.value)} className="w-full p-2 border rounded" placeholder="e.g. 1a2B3c4D... (Leave blank for all files)" />
                  <p className="text-xs text-slate-500 mt-1">Leave empty to sync recent accessible files.</p>
                </div>
              )}

              {selectedSourceType === 'GOOGLE_SHEETS' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Spreadsheet ID</label>
                    <input required type="text" value={spreadsheetId} onChange={e => setSpreadsheetId(e.target.value)} className="w-full p-2 border rounded" placeholder="e.g. 1a2B3c4D..." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Sheet Names (Comma separated)</label>
                    <input required type="text" value={sheetNames} onChange={e => setSheetNames(e.target.value)} className="w-full p-2 border rounded" placeholder="e.g. Sheet1, Pricing" />
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <button type="submit" className="bg-primary-600 text-white px-4 py-2 rounded">Connect</button>
                <button type="button" onClick={() => setShowSourceModal(false)} className="bg-slate-200 px-4 py-2 rounded">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {sources.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No sources connected yet.</div>
          ) : (
            sources.map(source => (
              <div key={source.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded">
                    <Database size={20} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{source.name}</p>
                    <div className="flex gap-4 text-xs text-slate-500 mt-1">
                      <span>{source.type}</span>
                      <span className={`font-semibold ${
                        source.status === 'INDEXED' ? 'text-emerald-600' :
                        source.status === 'FAILED' ? 'text-red-600' : 'text-amber-600'
                      }`}>
                        {source.status}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleSyncSource(source.id)} className="p-2 text-slate-400 hover:text-primary-600 rounded hover:bg-primary-50" title="Sync">
                    <RefreshCw size={18} />
                  </button>
                  <button onClick={() => handleDeleteSource(source.id)} className="p-2 text-slate-400 hover:text-red-600 rounded hover:bg-red-50" title="Delete Source">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-slate-900">Direct Documents</h3>
          <div className="flex items-center gap-4">
            <select 
              value={knowledgeType} 
              onChange={e => setKnowledgeType(e.target.value)}
              className="p-2 border border-slate-300 rounded text-sm"
            >
              <option value="BUSINESS">BUSINESS</option>
              <option value="PRODUCT">PRODUCT</option>
              <option value="SERVICE">SERVICE</option>
              <option value="PRICING">PRICING</option>
              <option value="POLICY">POLICY</option>
              <option value="PROCESS">PROCESS</option>
              <option value="FAQ">FAQ</option>
              <option value="CUSTOMER">CUSTOMER</option>
              <option value="OTHER">OTHER</option>
            </select>
            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept=".pdf,.txt,.csv,.docx" multiple />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-slate-100 text-slate-700 px-4 py-2 rounded hover:bg-slate-200"
            >
              <Upload size={18} /> Upload File
            </button>
          </div>
        </div>
        
        <div className="divide-y divide-slate-100">
          {docs.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No documents.</div>
          ) : (
            docs.map(doc => (
              <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <FileText className="text-slate-400" />
                  <div>
                    <p className="font-medium text-slate-900">{doc.filename}</p>
                    <div className="flex gap-4 text-xs text-slate-500 mt-1">
                      <span>{(doc.fileSize / 1024).toFixed(1)} KB</span>
                      <span className="font-semibold text-slate-700">{doc.knowledgeType}</span>
                      {doc.sourceId && <span className="text-primary-600">From Source</span>}
                      <span className={`font-semibold ${
                        doc.status === 'INDEXED' ? 'text-emerald-600' :
                        doc.status === 'FAILED' ? 'text-red-600' : 'text-amber-600'
                      }`}>
                        {doc.status}
                      </span>
                    </div>
                    {doc.errorMessage && <p className="text-xs text-red-500 mt-1">{doc.errorMessage}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleReprocess(doc.id)} className="p-2 text-slate-400 hover:text-primary-600 rounded hover:bg-primary-50" title="Reprocess">
                    <RefreshCw size={18} />
                  </button>
                  <button onClick={() => handleDelete(doc.id)} className="p-2 text-slate-400 hover:text-red-600 rounded hover:bg-red-50" title="Delete">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-8">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Test Knowledge Retrieval</h3>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input 
              type="text" 
              placeholder="e.g., What is the refund policy?" 
              className="flex-1 p-2 border border-slate-300 rounded"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <button type="submit" className="bg-slate-900 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-slate-800">
              <Search size={18} /> Search
            </button>
          </form>
        </div>
        
        {searchResults.length > 0 && (
          <div className="p-6 bg-slate-50">
            <h4 className="font-medium text-slate-700 mb-4">Top Results ({searchResults.length})</h4>
            <div className="space-y-4">
              {searchResults.map((res, i) => (
                <div key={i} className="bg-white p-4 rounded border border-slate-200">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-semibold text-primary-600 bg-primary-50 px-2 py-1 rounded">
                      Score: {res.score.toFixed(3)}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">Source: {res.filename}</span>
                  </div>
                  <p className="text-sm text-slate-800">{res.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
