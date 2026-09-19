import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { AuditHistory } from './AuditPanel.js';
import { InstanceSetupPanel } from './InstanceSetupPanel.js';
import { BranchPanel } from './BranchPanel.js';
import { BrandSettingsPanel } from './BrandSettingsPanel.js';
import { LogoPanel } from './LogoPanel.js';
import { SetupPortalPanel } from './SetupPortalPanel.js';

/** Convert DD/MM/YYYY → YYYY-MM-DD for HTML date inputs. Passes through if already ISO or empty. */
function toIsoDate(d: string | null | undefined): string {
  if (!d) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  // DD/MM/YYYY
  const m = d.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return d;
}

interface DbEntry {
  id: number;
  onboarding_id: string | null;
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
  sale_type: string | null;
  crm_customer_id: number | null;
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
  return `\u00A3${value.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const inputCls = 'bg-[#272C33] text-neutral-200 text-xs rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
const labelCls = 'text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block';

interface Props {
  entry: DbEntry | null;
  isNew: boolean;
  products: string[];
  defaultProduct: string;
  prefill?: Record<string, string> | null;
  onClose: () => void;
  onSaved: (product?: string) => void;
  onDeleted: (id: number) => void;
  onStarToggled: (id: number) => void;
  canPushGit?: boolean;
}

export function DeliveryDrawer({ entry, isNew, products, defaultProduct, prefill, onClose, onSaved, onDeleted, onStarToggled, canPushGit }: Props) {
  const [form, setForm] = useState({
    product: '', account: '', status: 'Not Started', onboarder: '',
    order_date: '', go_live_date: '', predicted_delivery: '', training_date: '',
    branches: '', mrr: '', incremental: '', licence_fee: '', sale_type: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Linked tickets state
  const [linkedTickets, setLinkedTickets] = useState<{
    relatedTasks: Array<{ id: string; source_id: string; title: string; status: string; source_url: string | null }>;
    jiraBaseUrl: string;
  } | null>(null);

  // User autocomplete for onboarder field
  const auth = useAuth();
  const [userList, setUserList] = useState<Array<{ id: number; username: string; display_name: string | null; team_id: number | null }>>([]);
  const [onboarderOpen, setOnboarderOpen] = useState(false);

  // CRM customer autocomplete for account field
  const [customerList, setCustomerList] = useState<Array<{ id: number; name: string; company: string | null; account_number: string | null }>>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [crmCustomerId, setCrmCustomerId] = useState<number | null>(null);

  // Fetch user list and CRM customers on mount
  useEffect(() => {
    fetch('/api/users/list')
      .then(r => r.json())
      .then(json => { if (json.ok) setUserList(json.data); })
      .catch(() => {});
    fetch('/api/crm/customers')
      .then(r => r.json())
      .then(json => { if (json.ok) setCustomerList(json.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (entry && !isNew) {
      setForm({
        product: entry.product,
        account: entry.account,
        status: entry.status || 'Not Started',
        onboarder: entry.onboarder ?? '',
        order_date: toIsoDate(entry.order_date),
        go_live_date: toIsoDate(entry.go_live_date),
        predicted_delivery: toIsoDate(entry.predicted_delivery),
        training_date: toIsoDate(entry.training_date),
        branches: entry.branches?.toString() ?? '',
        mrr: entry.mrr?.toString() ?? '',
        incremental: entry.incremental?.toString() ?? '',
        licence_fee: entry.licence_fee?.toString() ?? '',
        sale_type: entry.sale_type ?? '',
        notes: entry.notes ?? '',
      });
      setCrmCustomerId(entry.crm_customer_id ?? null);
    } else if (prefill) {
      const defaultOnboarder = auth.user?.display_name || auth.user?.username || '';
      setForm({
        product: defaultProduct,
        account: prefill.account ?? '',
        status: prefill.status ?? 'Not Started',
        onboarder: prefill.onboarder || defaultOnboarder,
        order_date: toIsoDate(prefill.order_date),
        go_live_date: toIsoDate(prefill.go_live_date),
        predicted_delivery: toIsoDate(prefill.predicted_delivery),
        training_date: toIsoDate(prefill.training_date),
        branches: prefill.branches ?? '',
        mrr: prefill.mrr ?? '',
        incremental: prefill.incremental ?? '',
        licence_fee: prefill.licence_fee ?? '',
        sale_type: prefill.sale_type ?? '',
        notes: prefill.notes ?? '',
      });
    } else {
      const defaultOnboarder = auth.user?.display_name || auth.user?.username || '';
      setForm({
        product: defaultProduct, account: '', status: 'Not Started', onboarder: defaultOnboarder,
        order_date: '', go_live_date: '', predicted_delivery: '', training_date: '',
        branches: '', mrr: '', incremental: '', licence_fee: '', sale_type: '', notes: '',
      });
    }
    setError(null);
    setSuccess(null);
    setConfirmDelete(false);
    setLinkedTickets(null);
    if (!entry || isNew) setCrmCustomerId(null);
  }, [entry, isNew, defaultProduct, prefill]);

  // Fetch linked tickets for existing entries
  useEffect(() => {
    if (entry && !isNew) {
      fetch(`/api/delivery/entries/${entry.id}/related-tickets`)
        .then(r => r.json())
        .then(json => { if (json.ok) setLinkedTickets(json.data); })
        .catch(() => {});
    }
  }, [entry, isNew]);

  const setField = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  const handleSave = async (): Promise<boolean> => {
    if (!form.product.trim() || !form.account.trim()) return false;
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
        sale_type: form.sale_type || null,
        crm_customer_id: crmCustomerId,
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
      onSaved(form.product.trim());
      setTimeout(() => setSuccess(null), 1500);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndClose = async () => {
    const ok = await handleSave();
    if (ok) onClose();
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
                {entry && !isNew ? entry.product : prefill ? 'From Spreadsheet' : 'New Entry'}
              </span>
              {entry?.onboarding_id && (
                <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-[#272C33] text-[#5ec1ca] border border-[#3a424d]">
                  {entry.onboarding_id}
                </span>
              )}
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
            <div className="text-sm text-neutral-100 font-semibold truncate flex items-center gap-2">
              <span>{entry && !isNew ? entry.account : prefill?.account || 'New Delivery Entry'}</span>
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

          {/* Account + Sale Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className={labelCls}>Account *</label>
              <input
                className={inputCls}
                value={form.account}
                onChange={(e) => { setField('account', e.target.value); setAccountOpen(true); setCrmCustomerId(null); }}
                onFocus={() => setAccountOpen(true)}
                onBlur={() => setTimeout(() => setAccountOpen(false), 150)}
                placeholder="Customer name"
                autoComplete="off"
              />
              {accountOpen && form.account.trim() && (() => {
                const q = form.account.toLowerCase();
                const matches = customerList
                  .filter(c => (c.name.toLowerCase().includes(q) || (c.company ?? '').toLowerCase().includes(q) || (c.account_number ?? '').toLowerCase().includes(q)) && c.name.toLowerCase() !== q)
                  .slice(0, 8);
                if (matches.length === 0) return null;
                return (
                  <div className="absolute z-10 top-full mt-1 w-full bg-[#272C33] border border-[#3a424d] rounded shadow-lg max-h-40 overflow-auto">
                    {matches.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setField('account', c.name); setAccountOpen(false); setCrmCustomerId(c.id); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-neutral-200 hover:bg-[#5ec1ca]/20 transition-colors"
                      >
                        {c.name}{c.account_number ? <span className="text-neutral-500 font-mono ml-1">{c.account_number}</span> : null}{c.company ? <span className="text-neutral-500 ml-1">({c.company})</span> : null}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {crmCustomerId && (
                <div className="mt-1 text-[10px] text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  Linked to CRM
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>Sale Type</label>
              <input
                className={inputCls}
                value={form.sale_type}
                onChange={(e) => setField('sale_type', e.target.value)}
                placeholder="e.g. New Business"
              />
            </div>
          </div>

          {/* Onboarder */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className={labelCls}>Onboarder</label>
              <input
                className={inputCls}
                value={form.onboarder}
                onChange={(e) => { setField('onboarder', e.target.value); setOnboarderOpen(true); }}
                onFocus={() => setOnboarderOpen(true)}
                onBlur={() => setTimeout(() => setOnboarderOpen(false), 150)}
                placeholder="Name"
                autoComplete="off"
              />
              {onboarderOpen && form.onboarder.trim() && (() => {
                const q = form.onboarder.toLowerCase();
                const matches = userList
                  .filter(u => (u.display_name || u.username).toLowerCase().includes(q) && (u.display_name || u.username).toLowerCase() !== q)
                  .slice(0, 8);
                if (matches.length === 0) return null;
                return (
                  <div className="absolute z-10 top-full mt-1 w-full bg-[#272C33] border border-[#3a424d] rounded shadow-lg max-h-40 overflow-auto">
                    {matches.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setField('onboarder', u.display_name || u.username); setOnboarderOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-neutral-200 hover:bg-[#5ec1ca]/20 transition-colors"
                      >
                        {u.display_name || u.username}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div />
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

          {/* ── Linked Tickets ── */}
          {entry && !isNew && linkedTickets && linkedTickets.relatedTasks.length > 0 && (
            <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3 space-y-2">
              <span className="text-xs font-semibold text-neutral-300">Linked Tickets</span>

              {/* Related SD tickets by account name */}
              {linkedTickets.relatedTasks.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-[#3a424d]">
                  <span className="text-[10px] text-neutral-500">Related SD Tickets</span>
                  {linkedTickets.relatedTasks.map(t => (
                    <div key={t.id} className="flex items-center gap-2 text-[11px]">
                      <a
                        href={t.source_url ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#5ec1ca] hover:underline font-mono shrink-0"
                      >
                        {t.source_id}
                      </a>
                      <span className="text-neutral-300 truncate">{t.title}</span>
                      <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        t.status === 'done' ? 'bg-green-900/40 text-green-400' :
                        t.status === 'open' ? 'bg-blue-900/40 text-blue-400' :
                        'bg-neutral-800 text-neutral-400'
                      }`}>{t.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Instance Setup Checklist ── */}
          {entry && !isNew && (
            <InstanceSetupPanel deliveryId={entry.id} product={form.product || entry.product} azdoPrUrl={(entry as any).azdo_pr_url} canPushGit={canPushGit} />
          )}

          {/* ── Branches ── */}
          {entry && !isNew && <BranchPanel deliveryId={entry.id} />}

          {/* ── Brand Settings ── */}
          {entry && !isNew && <BrandSettingsPanel deliveryId={entry.id} />}

          {/* ── Logos & Images ── */}
          {entry && !isNew && <LogoPanel deliveryId={entry.id} />}

          {/* ── Customer Setup Portal ── */}
          {entry && !isNew && <SetupPortalPanel deliveryId={entry.id} account={entry.account} />}

          {/* Metadata (edit mode only) */}
          {entry && !isNew && (
            <div className="text-[10px] text-neutral-600 space-y-0.5 pt-2 border-t border-[#3a424d]">
              <div>Created: {new Date(entry.created_at).toLocaleDateString('en-GB')} {new Date(entry.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
              <div>Updated: {new Date(entry.updated_at).toLocaleDateString('en-GB')} {new Date(entry.updated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
              {entry.mrr != null && <div>MRR: {formatCurrency(entry.mrr)}</div>}
            </div>
          )}

          {/* Audit History */}
          {entry && !isNew && (
            <AuditHistory entityType="delivery" entityId={String(entry.id)} />
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
            onClick={handleSaveAndClose}
            disabled={saving || !form.product.trim() || !form.account.trim()}
            className="px-4 py-2 text-sm text-[#5ec1ca] font-semibold rounded hover:bg-[#5ec1ca]/20 border border-[#5ec1ca]/40 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Close'}
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
