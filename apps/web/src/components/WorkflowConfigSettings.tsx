import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import { Loader2, Plus, Edit2, Trash2, GripVertical } from 'lucide-react';

interface FieldDefinition {
  id: string;
  fieldKey: string;
  label: string;
  type: string;
  required: boolean;
  options?: any;
  displayOrder: number;
}

export default function WorkflowConfigSettings({ businessId }: { businessId: string }) {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [workflowType] = useState('ENQUIRY_INTAKE'); // Phase 0 default
  
  const [editingField, setEditingField] = useState<Partial<FieldDefinition> | null>(null);

  useEffect(() => {
    loadFields();
  }, [businessId]);

  const loadFields = async () => {
    setLoading(true);
    try {
      const res = await apiCall(`/workflows/${workflowType}/fields?businessId=${businessId}`);
      if (res.data) setFields(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveField = async () => {
    if (!editingField || !editingField.fieldKey || !editingField.label) return;
    
    try {
      if (editingField.id) {
        await apiCall(`/workflows/${workflowType}/fields/${editingField.id}?businessId=${businessId}`, {
          method: 'PATCH',
          body: JSON.stringify(editingField)
        });
      } else {
        await apiCall(`/workflows/${workflowType}/fields?businessId=${businessId}`, {
          method: 'POST',
          body: JSON.stringify(editingField)
        });
      }
      setEditingField(null);
      loadFields();
    } catch (e) {
      console.error(e);
      alert('Failed to save field');
    }
  };

  const handleDeleteField = async (id: string) => {
    if (!confirm('Are you sure?')) return;
    try {
      await apiCall(`/workflows/${workflowType}/fields/${id}?businessId=${businessId}`, {
        method: 'DELETE'
      });
      loadFields();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="border-b border-slate-200 pb-4 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Enquiry Fields</h2>
          <p className="text-slate-500 mt-1">Configure data fields for {workflowType}</p>
        </div>
        <button 
          onClick={() => setEditingField({ type: 'TEXT', required: false, displayOrder: fields.length })}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add Field
        </button>
      </div>

      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field.id} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="flex items-center gap-3">
              <GripVertical className="text-slate-400 w-5 h-5 cursor-move" />
              <div>
                <p className="font-medium text-slate-900">{field.label} <span className="text-slate-400 text-sm font-normal">({field.fieldKey})</span></p>
                <p className="text-sm text-slate-500">{field.type} • {field.required ? 'Required' : 'Optional'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setEditingField(field)} className="p-2 text-slate-400 hover:text-slate-700">
                <Edit2 className="w-4 h-4" />
              </button>
              <button onClick={() => handleDeleteField(field.id)} className="p-2 text-slate-400 hover:text-red-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {fields.length === 0 && (
          <div className="text-center py-10 text-slate-500">
            No fields configured yet.
          </div>
        )}
      </div>

      {editingField && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">{editingField.id ? 'Edit Field' : 'Add Field'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Field Key</label>
                <input 
                  type="text" 
                  value={editingField.fieldKey || ''} 
                  onChange={e => setEditingField({...editingField, fieldKey: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={!!editingField.id}
                  placeholder="e.g. product_name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Label</label>
                <input 
                  type="text" 
                  value={editingField.label || ''} 
                  onChange={e => setEditingField({...editingField, label: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select 
                  value={editingField.type || 'TEXT'} 
                  onChange={e => setEditingField({...editingField, type: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="TEXT">Text</option>
                  <option value="LONG_TEXT">Long Text</option>
                  <option value="NUMBER">Number</option>
                  <option value="CURRENCY">Currency</option>
                  <option value="BOOLEAN">Boolean</option>
                  <option value="DATE">Date</option>
                  <option value="SELECT">Select</option>
                  <option value="MULTI_SELECT">Multi Select</option>
                </select>
              </div>
              {(editingField.type === 'SELECT' || editingField.type === 'MULTI_SELECT') && (
                <div>
                  <label className="block text-sm font-medium mb-1">Options (comma separated)</label>
                  <input 
                    type="text" 
                    value={Array.isArray(editingField.options) ? editingField.options.join(',') : ''} 
                    onChange={e => setEditingField({...editingField, options: e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Option 1, Option 2"
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="required"
                  checked={editingField.required || false} 
                  onChange={e => setEditingField({...editingField, required: e.target.checked})}
                />
                <label htmlFor="required" className="text-sm font-medium">Required field</label>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setEditingField(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleSaveField} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
