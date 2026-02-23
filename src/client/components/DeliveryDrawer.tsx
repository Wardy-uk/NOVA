import { useState, useEffect } from 'react';

interface DbEntry {
  id: number;
  product: string;
  account: string;
  status: string;
  onboarder: string | null;
  order_date: string | null;
  go_live_date: string | null;
  predicted_delivery: string | null;
  training_date: string | null;
  branches: number | null;
  mrr: number | null;
  incremental: number | null;
  licence_fee: number | null;
  is_starred: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const STATUSES = ['Not Started', 'WIP', 'In Progress', 'On Hold', 'Complete', 'Dead', 'Back to Sales'];

const STATUS_COLORS: Record<string, string> = {
  complete: '#22c55e', wip: '#f59e0b', 'in progress': '#f59e0b',
  'not started': '#6b7280', dead: '#ef4444', 'back to sales': '#ef4444',
  live: '#22c55e', 'on hold': '#a855f7', pending: '#3b82f6',
};

function getStatusColor(status: string): string {
  const lower = (status || '').toLowerCase().trim();
  for (const [key, color] of Object.entries(STATUS_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return '#6b7280';
}

function formatCurrency(value: number | null): string {
  if (value == null) return '-';
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const inputCls = 'bg-[#272C33] text-neutral-200 text-xs rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
const labelCls = 'text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block';

interface Props {
  entry: DbEntry | null;
  isNew: boolean;
  products: string[];
  defaultProduct: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (id: number) => void;
  onStarToggled: (id: number) => void;
}

export function DeliveryDrawer({ entry, isNew, products, defaultProduct, onClose, onSaved, onDeleted, onStarToggled }: Props) {
  const [form, setForm] = useState({
    product: '', account: '', status: 'Not Started', onboarder: '',
    order_date: '', go_live_date: '', predicted_delivery: '', training_date: '',
    branches: '', mrr: '', incremental: '', licence_fee: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (entry && !isNew) {
      setForm({
        product: entry.product,
        account: entry.account,
        status: entry.status || 'Not Started',
        onboarder: entry.onboarder ?? '',
        order_date: entry.order_date ?? '',
        go_live_date: entry.go_live_date ?? '',
        predicted_delivery: entry.predicted_delivery ?? '',
        training_date: entry.training_date ?? '',
        branches: entry.branches?.toString() ?? '',
        mrr: entry.mrr?.toString() ?? '',
        incremental: entry.incremental?.toString() ?? '',
        licence_fee: entry.licence_fee?.toString() ?? '',
        notes: entry.notes ?? '',
      });
    } else {
      setForm({
        product: defaultProduct, account: '', status: 'Not Started', onboarder: '',
        order_date: '', go_live_date: '', predicted_delivery: '', training_date: '',
        branches: '', mrr: '', incremental: '', licence_fee: '', notes: '',
      });
    }
    setError(null);
    setSuccess(null);
    setConfirmDelete(false);
  }, [entry, isNew, defaultProduct]);

  const setField = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  const handleSave = async () => {
    if (!form.product.trim() || !form.account.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        product: form.product.trim(),
        account: form.account.trim(),
        status: form.status,
        onboarder: form.onboarder.trim() || null,
        order_date: form.order_date || null,
        go_live_date: form.go_live_date || null,
        predicted_delivery: form.predicted_delivery || null,
        training_date: form.training_date || null,
        branches: form.branches ? parseInt(form.branches, 10) : null,
        mrr: form.mrr ? parseFloat(form.mrr) : null,
        incremental: form.incremental ? parseFloat(form.incremental) : null,
        licence_fee: form.licence_fee ? parseFloat(form.licence_fee) : null,
        notes: form.notes.trim() || null,
      };

      const url = entry && !isNew ? `/api/delivery/entries/${entry.id}` : '/api/delivery/entries';
      const method = entry && !isNew ? 'PUT' : 'POST';
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error ?? 'Save failed');
      setSuccess(isNew ? 'Created' : 'Updated');
      onSaved();
      setTimeout(() => setSuccess(null), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!entry) return;
    await fetch(`/api/delivery/entries/${entry.id}`, { method: 'DELETE' });
    onDeleted(entry.id);
  };

  const statusColor = getStatusColor(form.status);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-[#1f242b] border-l border-[#3a424d] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#3a424d] flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-[#5ec1ca]/20 text-[#5ec1ca]">
                {entry && !isNew ? entry.product : 'New Entry'}
              </span>
              {entry && !isNew && (
                <button
                  onClick={() => onStarToggled(entry.id)}
                  className={`text-sm transition-colors ${entry.is_starred ? 'text-amber-400' : 'text-neutral-600 hover:text-amber-400'}`}
                  title={entry.is_starred ? 'Unstar' : 'Star'}
                >
                  {entry.is_starred ? '\u2605' : '\u2606'}
                </button>
              )}
            </div>
            <div className="text-sm text-neutral-100 font-semibold truncate">
              {entry && !isNew ? entry.account : 'New Delivery Entry'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:text-neutral-100 transition-colors shrink-0"
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {error && (
            <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-xs">{error}</div>
          )}
          {success && (
            <div className="p-2 bg-green-950/50 border border-green-900 rounded text-green-400 text-xs">{success}</div>
          )}

          {/* Status + Product row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Product *</label>
              <select value={form.product} onChange={(e) => setField('product', e.target.value)} className={inputCls}>
                <option value="">Select...</option>
                {products.map((p) => <option key={p} value={p}>{p}</option>)}
                <option value="__custom">Other...</option>
              </select>
              {form.product === '__custom' && (
                <input className={`${inputCls} mt-1`} placeholder="Product name" value="" onChange={(e) => setField('product', e.target.value)} />
              )}
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={(e) => setField('status', e.target.value)} className={inputCls}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="mt-1 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
                <span className="text-[10px]" style={{ color: statusColor }}>{form.status}</span>
              </div>
            </div>
          </div>

          {/* Account + Onboarder */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Account *</label>
              <input className={inputCls} value={form.account} onChange={(e) => setField('account', e.target.value)} placeholder="Customer name" />
            </div>
            <div>
              <label className={labelCls}>Onboarder</label>
              <input className={inputCls} value={form.onboarder} onChange={(e) => setField('onboarder', e.target.value)} placeholder="Name" />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Order Date</label>
              <input type="date" className={inputCls} value={form.order_date} onChange={(e) => setField('order_date', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Go Live Date</label>
              <input type="date" className={inputCls} value={form.go_live_date} onChange={(e) => setField('go_live_date', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Predicted Delivery</label>
              <input type="date" className={inputCls} value={form.predicted_delivery} onChange={(e) => setField('predicted_delivery', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Training Date</label>
              <input type="date" className={inputCls} value={form.training_date} onChange={(e) => setField('training_date', e.target.value)} />
            </div>
          </div>

          {/* Financials */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Branches</label>
              <input type="number" className={inputCls} value={form.branches} onChange={(e) => setField('branches', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>MRR ({'\u00A3'})</label>
              <input type="number" step="0.01" className={inputCls} value={form.mrr} onChange={(e) => setField('mrr', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls}>Incremental ({'\u00A3'})</label>
              <input type="number" step="0.01" className={inputCls} value={form.incremental} onChange={(e) => setField('incremental', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls}>Licence Fee ({'\u00A3'})</label>
              <input type="number" step="0.01" className={inputCls} value={form.licence_fee} onChange={(e) => setField('licence_fee', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              rows={3}
              placeholder="Details..."
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Metadata (edit mode only) */}
          {entry && !isNew && (
            <div className="text-[10px] text-neutral-600 space-y-0.5 pt-2 border-t border-[#3a424d]">
              <div>Created: {new Date(entry.created_at).toLocaleDateString('en-GB')} {new Date(entry.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
              <div>Updated: {new Date(entry.updated_at).toLocaleDateString('en-GB')} {new Date(entry.updated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
              {entry.mrr != null && <div>MRR: {formatCurrency(entry.mrr)}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#3a424d] flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !form.product.trim() || !form.account.trim()}
            className="px-4 py-2 text-sm bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4db0b9] transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : isNew ? 'Create' : 'Update'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-[#2f353d] text-neutral-400 rounded hover:bg-[#363d47] border border-[#3a424d] transition-colors"
          >
            Cancel
          </button>
          {entry && !isNew && (
            <div className="ml-auto">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-400">Delete this entry?</span>
                  <button
                    onClick={handleDelete}
                    className="px-3 py-1.5 text-xs bg-red-900/50 text-red-400 rounded hover:bg-red-900/80 border border-red-900 transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
