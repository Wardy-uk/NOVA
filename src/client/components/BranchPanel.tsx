import { useState, useEffect, useCallback } from 'react';

interface Branch {
  id: number;
  delivery_id: number;
  is_default: number;
  name: string;
  sales_email: string | null;
  sales_phone: string | null;
  lettings_email: string | null;
  lettings_phone: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  town: string | null;
  post_code1: string | null;
  post_code2: string | null;
  sort_order: number;
}

interface Props {
  deliveryId: number;
}

const EMPTY_BRANCH = {
  name: '', sales_email: '', sales_phone: '', lettings_email: '', lettings_phone: '',
  address1: '', address2: '', address3: '', town: '', post_code1: '', post_code2: '',
  is_default: 0, sort_order: 0,
};

const inputCls = 'w-full bg-[#1f242b] text-neutral-300 text-[11px] rounded px-2 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] placeholder:text-neutral-600';

export function BranchPanel({ deliveryId }: Props) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string | number>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_BRANCH });
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<Array<Record<string, string>>>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const json = await res.json();
        setEnabled(json.ok && json.data?.feature_instance_setup === 'true');
      } catch { setEnabled(false); }
    })();
  }, []);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`/api/branches/delivery/${deliveryId}`);
      const json = await res.json();
      if (json.ok) setBranches(json.data);
    } catch { /* ignore */ }
  }, [deliveryId]);

  useEffect(() => {
    if (enabled) fetchBranches();
  }, [fetchBranches, enabled]);

  if (enabled === null || enabled === false) return null;

  const handleCreate = async () => {
    if (!addForm.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/branches/delivery/${deliveryId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      const json = await res.json();
      if (json.ok) { setBranches(json.data); setShowAdd(false); setAddForm({ ...EMPTY_BRANCH }); }
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleUpdate = async (id: number) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/branches/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const json = await res.json();
      if (json.ok) { setBranches(json.data); setExpandedId(null); }
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/branches/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) setBranches(json.data);
    } catch { /* ignore */ }
  };

  const handleSetDefault = async (branchId: number) => {
    try {
      const res = await fetch(`/api/branches/delivery/${deliveryId}/${branchId}/default`, { method: 'PUT' });
      const json = await res.json();
      if (json.ok) setBranches(json.data);
    } catch { /* ignore */ }
  };

  const handleExpand = (branch: Branch) => {
    if (expandedId === branch.id) { setExpandedId(null); return; }
    setExpandedId(branch.id);
    setEditForm({
      name: branch.name, sales_email: branch.sales_email || '', sales_phone: branch.sales_phone || '',
      lettings_email: branch.lettings_email || '', lettings_phone: branch.lettings_phone || '',
      address1: branch.address1 || '', address2: branch.address2 || '', address3: branch.address3 || '',
      town: branch.town || '', post_code1: branch.post_code1 || '', post_code2: branch.post_code2 || '',
      is_default: branch.is_default, sort_order: branch.sort_order,
    });
  };

  const parseImportCsv = (text: string) => {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) { setImportPreview([]); return; }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = vals[i] || ''; });
      return row;
    });
    setImportPreview(rows);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      setImportText(text);
      parseImportCsv(text);
    } else {
      const XLSX = (await import('xlsx')).default;
      const data = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const mapped = rows.map(r => {
        const get = (keys: string[]) => { for (const k of keys) { const v = r[k]; if (v != null) return String(v).trim(); } return ''; };
        return {
          name: get(['name', 'Name', 'Branch', 'branch', 'Office', 'office']),
          sales_email: get(['sales_email', 'SalesEmail', 'Sales Email']),
          sales_phone: get(['sales_phone', 'SalesPhone', 'Sales Phone']),
          lettings_email: get(['lettings_email', 'LettingsEmail', 'Lettings Email']),
          lettings_phone: get(['lettings_phone', 'LettingsPhone', 'Lettings Phone']),
          address1: get(['address1', 'Address1', 'Address 1', 'Address']),
          address2: get(['address2', 'Address2', 'Address 2']),
          address3: get(['address3', 'Address3', 'Address 3']),
          town: get(['town', 'Town', 'City']),
          post_code1: get(['post_code1', 'PostCode1', 'Postcode', 'postcode', 'Post Code']),
          post_code2: get(['post_code2', 'PostCode2']),
        };
      }).filter(r => r.name);
      setImportPreview(mapped);
    }
  };

  const submitImport = async () => {
    if (importPreview.length === 0) return;
    setSaving(true);
    try {
      const mapped = importPreview.map(r => ({
        name: r.name || '', sales_email: r.sales_email || null, sales_phone: r.sales_phone || null,
        lettings_email: r.lettings_email || null, lettings_phone: r.lettings_phone || null,
        address1: r.address1 || null, address2: r.address2 || null, address3: r.address3 || null,
        town: r.town || null, post_code1: r.post_code1 || null, post_code2: r.post_code2 || null,
      }));
      const res = await fetch(`/api/branches/delivery/${deliveryId}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branches: mapped }),
      });
      const json = await res.json();
      if (json.ok) { setBranches(json.data); setShowImport(false); setImportText(''); setImportPreview([]); }
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const BranchForm = ({ form, setForm, onSave, onCancel, saveLabel }: {
    form: Record<string, string | number>;
    setForm: (f: Record<string, string | number>) => void;
    onSave: () => void;
    onCancel: () => void;
    saveLabel: string;
  }) => (
    <div className="grid grid-cols-2 gap-1.5 mt-2">
      <div className="col-span-2">
        <input placeholder="Branch name *" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} />
      </div>
      <input placeholder="Sales email" value={form.sales_email || ''} onChange={e => setForm({ ...form, sales_email: e.target.value })} className={inputCls} />
      <input placeholder="Sales phone" value={form.sales_phone || ''} onChange={e => setForm({ ...form, sales_phone: e.target.value })} className={inputCls} />
      <input placeholder="Lettings email" value={form.lettings_email || ''} onChange={e => setForm({ ...form, lettings_email: e.target.value })} className={inputCls} />
      <input placeholder="Lettings phone" value={form.lettings_phone || ''} onChange={e => setForm({ ...form, lettings_phone: e.target.value })} className={inputCls} />
      <div className="col-span-2"><input placeholder="Address line 1" value={form.address1 || ''} onChange={e => setForm({ ...form, address1: e.target.value })} className={inputCls} /></div>
      <input placeholder="Address line 2" value={form.address2 || ''} onChange={e => setForm({ ...form, address2: e.target.value })} className={inputCls} />
      <input placeholder="Address line 3" value={form.address3 || ''} onChange={e => setForm({ ...form, address3: e.target.value })} className={inputCls} />
      <input placeholder="Town" value={form.town || ''} onChange={e => setForm({ ...form, town: e.target.value })} className={inputCls} />
      <div className="flex gap-1.5">
        <input placeholder="Postcode 1" value={form.post_code1 || ''} onChange={e => setForm({ ...form, post_code1: e.target.value })} className={inputCls} />
        <input placeholder="Postcode 2" value={form.post_code2 || ''} onChange={e => setForm({ ...form, post_code2: e.target.value })} className={inputCls} />
      </div>
      <div className="col-span-2 flex items-center gap-2 pt-1">
        <button onClick={onSave} disabled={saving || !form.name} className="px-3 py-1 text-[10px] rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : saveLabel}
        </button>
        <button onClick={onCancel} className="px-3 py-1 text-[10px] text-neutral-400 hover:text-neutral-200 transition-colors">Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-300">Branches</span>
        <span className="text-[10px] text-neutral-500">{branches.length} branch{branches.length !== 1 ? 'es' : ''}</span>
      </div>

      {/* Branch list */}
      <div className="space-y-0.5">
        {branches.map(branch => (
          <div key={branch.id}>
            <div
              className="flex items-center gap-2 px-2 py-1.5 rounded bg-neutral-800 hover:bg-[#2f353d] cursor-pointer transition-colors group"
              onClick={() => handleExpand(branch)}
            >
              <span className="text-[11px] text-neutral-200 flex-1">{branch.name}</span>
              {branch.is_default === 1 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#5ec1ca]/20 text-[#5ec1ca]">Default</span>
              )}
              {branch.town && <span className="text-[9px] text-neutral-500">{branch.town}</span>}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {branch.is_default !== 1 && (
                  <button onClick={e => { e.stopPropagation(); handleSetDefault(branch.id); }} className="text-[9px] text-neutral-500 hover:text-[#5ec1ca]" title="Set as default">
                    &#x2606;
                  </button>
                )}
                <button onClick={e => { e.stopPropagation(); handleDelete(branch.id); }} className="text-[9px] text-neutral-500 hover:text-red-400" title="Delete">
                  &#x2715;
                </button>
              </div>
            </div>
            {expandedId === branch.id && (
              <BranchForm form={editForm} setForm={setEditForm} onSave={() => handleUpdate(branch.id)} onCancel={() => setExpandedId(null)} saveLabel="Save" />
            )}
          </div>
        ))}
      </div>

      {/* Add branch form */}
      {showAdd && (
        <BranchForm form={addForm as any} setForm={f => setAddForm(f as any)} onSave={handleCreate} onCancel={() => { setShowAdd(false); setAddForm({ ...EMPTY_BRANCH }); }} saveLabel="Add Branch" />
      )}

      {/* Import panel */}
      {showImport && (
        <div className="border border-[#3a424d] rounded bg-[#1f242b] p-2 space-y-2">
          <div className="flex items-center gap-2">
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImportFile} className="text-[10px] text-neutral-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:bg-[#3a424d] file:text-neutral-300 file:cursor-pointer" />
            <span className="text-[9px] text-neutral-500">or paste CSV below</span>
          </div>
          <textarea
            placeholder="name,sales_email,sales_phone,town,post_code1&#10;Head Office,sales@example.com,01onal234567,London,SW1A"
            value={importText}
            onChange={e => { setImportText(e.target.value); parseImportCsv(e.target.value); }}
            className="w-full h-20 bg-[#272C33] text-[10px] text-neutral-400 rounded p-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] font-mono resize-none"
          />
          {importPreview.length > 0 && (
            <div className="text-[10px] text-neutral-400">
              <span className="text-neutral-300">{importPreview.length}</span> branch{importPreview.length !== 1 ? 'es' : ''} found: {importPreview.map(r => r.name).join(', ')}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={submitImport} disabled={saving || importPreview.length === 0} className="px-3 py-1 text-[10px] rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors">
              {saving ? 'Importing...' : `Import ${importPreview.length}`}
            </button>
            <button onClick={() => { setShowImport(false); setImportText(''); setImportPreview([]); }} className="px-3 py-1 text-[10px] text-neutral-400 hover:text-neutral-200 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1 border-t border-[#3a424d]">
        {!showAdd && !showImport && (
          <>
            <button onClick={() => setShowAdd(true)} className="text-[10px] text-neutral-500 hover:text-[#5ec1ca] transition-colors">+ Add Branch</button>
            <button onClick={() => setShowImport(true)} className="text-[10px] text-neutral-500 hover:text-[#5ec1ca] transition-colors">Import</button>
          </>
        )}
      </div>
    </div>
  );
}
