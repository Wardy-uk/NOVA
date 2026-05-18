import { useState, useEffect, useCallback } from 'react';
import type { ContractTerm } from '../../shared/types.js';

const inputCls = 'bg-[#272C33] text-neutral-200 text-[11px] rounded px-2.5 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
const labelCls = 'text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block';
const btnPrimary = 'text-[11px] px-4 py-2 rounded bg-[#5ec1ca] text-[#272C33] font-medium hover:bg-[#4db0b9] transition-colors disabled:opacity-40';
const btnSecondary = 'text-[11px] px-4 py-2 rounded bg-[#2f353d] text-neutral-300 hover:bg-[#3a424d] transition-colors';

export function AdminContractTermsView() {
  const [terms, setTerms] = useState<ContractTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContractTerm | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [prefix, setPrefix] = useState('contract terms');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/contract-terms?activeOnly=0');
      const json = await res.json();
      if (json.ok) setTerms(json.data ?? []);
      else setError(json.error ?? 'Failed to load contract terms');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contract terms');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    fetch('/api/adobe-sign/terms-prefix')
      .then(r => r.json())
      .then(j => { if (j.ok && typeof j.data?.prefix === 'string') setPrefix(j.data.prefix); })
      .catch(() => { /* default */ });
  }, [fetchAll]);

  const handleSave = async (form: { id?: number; label: string; body: string; active: boolean; sort_order: number }) => {
    const url = form.id ? `/api/contract-terms/${form.id}` : '/api/contract-terms';
    const method = form.id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: form.label,
        body: form.body,
        active: form.active,
        sort_order: form.sort_order,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setShowForm(false);
      setEditing(null);
      fetchAll();
    } else {
      alert(json.error ?? 'Save failed');
    }
  };

  const handleDelete = async (id: number, label: string) => {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/contract-terms/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) fetchAll();
    else alert(json.error ?? 'Delete failed');
  };

  const handleToggleActive = async (term: ContractTerm) => {
    const res = await fetch(`/api/contract-terms/${term.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !term.active }),
    });
    const json = await res.json();
    if (json.ok) fetchAll();
    else alert(json.error ?? 'Toggle failed');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-[#3a424d] flex items-center justify-between">
        <div>
          <h1 className="text-[14px] font-semibold text-neutral-100">Contract Terms</h1>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Pre-approved terms that senders can tick to include in Adobe Sign agreements. Inserted into any template field whose name starts with <code className="text-neutral-300">{prefix}</code>.
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className={btnPrimary}>
          + Add Term
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-neutral-500 text-[12px] py-8 text-center">Loading...</div>
        ) : error ? (
          <div className="text-amber-400 text-[12px] py-8 text-center">{error}</div>
        ) : terms.length === 0 ? (
          <div className="text-neutral-500 text-[12px] py-8 text-center">
            No contract terms configured yet. Click "+ Add Term" to create one.
          </div>
        ) : (
          <div className="space-y-2">
            {terms.map((t) => (
              <div key={t.id} className={`rounded-lg border p-4 transition-colors ${
                t.active ? 'bg-[#1e2228] border-[#3a424d]' : 'bg-[#1e2228]/60 border-[#3a424d]/50 opacity-60'
              }`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-medium text-neutral-200">{t.label}</span>
                      {!t.active && <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-500 uppercase">Inactive</span>}
                      <span className="text-[9px] text-neutral-600">order {t.sort_order}</span>
                    </div>
                    <pre className="text-[10px] text-neutral-400 whitespace-pre-wrap font-sans line-clamp-4">{t.body}</pre>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => { setEditing(t); setShowForm(true); }}
                      className="text-[10px] px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:bg-[#3a424d]"
                    >Edit</button>
                    <button
                      onClick={() => handleToggleActive(t)}
                      className="text-[10px] px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:bg-[#3a424d]"
                    >{t.active ? 'Deactivate' : 'Activate'}</button>
                    <button
                      onClick={() => handleDelete(t.id, t.label)}
                      className="text-[10px] px-2 py-1 rounded bg-[#2f353d] text-red-400 hover:bg-red-900/30"
                    >Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <TermFormModal
          term={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function TermFormModal({
  term,
  onClose,
  onSave,
}: {
  term: ContractTerm | null;
  onClose: () => void;
  onSave: (form: { id?: number; label: string; body: string; active: boolean; sort_order: number }) => void;
}) {
  const [label, setLabel] = useState(term?.label ?? '');
  const [body, setBody] = useState(term?.body ?? '');
  const [active, setActive] = useState(term ? Boolean(term.active) : true);
  const [sortOrder, setSortOrder] = useState(term?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!label.trim() || !body.trim()) return;
    setSaving(true);
    await onSave({
      id: term?.id,
      label: label.trim(),
      body: body.trim(),
      active,
      sort_order: sortOrder,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[#1e2228] rounded-xl border border-[#3a424d] w-[640px] max-h-[85vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3a424d]">
          <h3 className="text-[14px] font-semibold text-neutral-100">
            {term ? 'Edit Contract Term' : 'New Contract Term'}
          </h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Label *</label>
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Short label shown next to the checkbox" />
          </div>

          <div>
            <label className={labelCls}>Body *</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="The actual term text that will be inserted into the contract field"
            />
            <div className="text-[10px] text-neutral-600 mt-1">
              This text will be concatenated with other selected terms (blank line between each).
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Sort Order</label>
              <input
                className={inputCls}
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
              />
              <div className="text-[10px] text-neutral-600 mt-1">Lower = shown first</div>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <label className="flex items-center gap-2 text-[11px] text-neutral-300 mt-1.5">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="accent-[#5ec1ca]"
                />
                Active (visible in wizard)
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#3a424d]">
          <button onClick={onClose} className={btnSecondary}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!label.trim() || !body.trim() || saving}
            className={btnPrimary}
          >
            {saving ? 'Saving...' : (term ? 'Save Changes' : 'Create Term')}
          </button>
        </div>
      </div>
    </div>
  );
}
