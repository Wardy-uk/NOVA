import { useState, useEffect } from 'react';

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
  is_starred: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface SaleType {
  id: number;
  name: string;
  active: number;
}

interface TicketResult {
  parentKey: string;
  childKeys: string[];
  createdCount: number;
  linkedCount: number;
  existing: boolean;
  dryRun: boolean;
  details?: { parentSummary: string; childSummaries: string[] };
}

interface Milestone {
  id: number;
  delivery_id: number;
  template_id: number;
  template_name: string;
  target_date: string | null;
  actual_date: string | null;
  status: string;
  checklist_state_json: string;
  notes: string | null;
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
  onSaved: () => void;
  onDeleted: (id: number) => void;
  onStarToggled: (id: number) => void;
}

export function DeliveryDrawer({ entry, isNew, products, defaultProduct, prefill, onClose, onSaved, onDeleted, onStarToggled }: Props) {
  const [form, setForm] = useState({
    product: '', account: '', status: 'Not Started', onboarder: '',
    order_date: '', go_live_date: '', predicted_delivery: '', training_date: '',
    branches: '', mrr: '', incremental: '', licence_fee: '', sale_type: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sale types for dropdown
  const [saleTypes, setSaleTypes] = useState<SaleType[]>([]);

  // Milestone state
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [milestonesLoading, setMilestonesLoading] = useState(false);
  const [milestoneError, setMilestoneError] = useState<string | null>(null);
  const [expandedMilestone, setExpandedMilestone] = useState<number | null>(null);

  // Ticket creation state
  const [ticketPreview, setTicketPreview] = useState<TicketResult | null>(null);
  const [ticketCreating, setTicketCreating] = useState(false);
  const [ticketResult, setTicketResult] = useState<TicketResult | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);

  // Fetch sale types on mount
  useEffect(() => {
    fetch('/api/onboarding/config/sale-types')
      .then(r => r.json())
      .then(json => { if (json.ok) setSaleTypes(json.data.filter((st: SaleType) => st.active)); })
      .catch(() => {});
  }, []);

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
        sale_type: entry.sale_type ?? '',
        notes: entry.notes ?? '',
      });
    } else if (prefill) {
      setForm({
        product: defaultProduct,
        account: prefill.account ?? '',
        status: prefill.status ?? 'Not Started',
        onboarder: prefill.onboarder ?? '',
        order_date: prefill.order_date ?? '',
        go_live_date: prefill.go_live_date ?? '',
        predicted_delivery: prefill.predicted_delivery ?? '',
        training_date: prefill.training_date ?? '',
        branches: prefill.branches ?? '',
        mrr: prefill.mrr ?? '',
        incremental: prefill.incremental ?? '',
        licence_fee: prefill.licence_fee ?? '',
        sale_type: prefill.sale_type ?? '',
        notes: prefill.notes ?? '',
      });
    } else {
      setForm({
        product: defaultProduct, account: '', status: 'Not Started', onboarder: '',
        order_date: '', go_live_date: '', predicted_delivery: '', training_date: '',
        branches: '', mrr: '', incremental: '', licence_fee: '', sale_type: '', notes: '',
      });
    }
    setError(null);
    setSuccess(null);
    setConfirmDelete(false);
    setTicketPreview(null);
    setTicketResult(null);
    setTicketError(null);
    setMilestones([]);
    setMilestoneError(null);
    setExpandedMilestone(null);
  }, [entry, isNew, defaultProduct, prefill]);

  // Fetch milestones for existing entries
  useEffect(() => {
    if (entry && !isNew) {
      fetch(`/api/milestones/delivery/${entry.id}`)
        .then(r => r.json())
        .then(json => { if (json.ok) setMilestones(json.data); })
        .catch(() => {});
    }
  }, [entry, isNew]);

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
        sale_type: form.sale_type || null,
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

  // ── Ticket creation ──

  const canCreateTickets = !!(form.sale_type && form.account.trim() && (entry?.onboarding_id || isNew));

  const handleDryRun = async () => {
    if (!canCreateTickets) return;
    setTicketCreating(true);
    setTicketError(null);
    setTicketPreview(null);
    try {
      const onboardingRef = entry?.onboarding_id || 'PREVIEW';
      const payload = {
        schemaVersion: 1,
        onboardingRef,
        saleType: form.sale_type,
        customer: { name: form.account.trim() },
        targetDueDate: form.go_live_date || new Date().toISOString().split('T')[0],
        config: {},
      };
      const resp = await fetch('/api/onboarding/create-tickets?dryRun=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error ?? 'Dry run failed');
      setTicketPreview(json.data);
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : 'Dry run failed');
    } finally {
      setTicketCreating(false);
    }
  };

  const handleCreateTickets = async () => {
    if (!canCreateTickets || !entry?.onboarding_id) return;
    setTicketCreating(true);
    setTicketError(null);
    try {
      const payload = {
        schemaVersion: 1,
        onboardingRef: entry.onboarding_id,
        saleType: form.sale_type,
        customer: { name: form.account.trim() },
        targetDueDate: form.go_live_date || new Date().toISOString().split('T')[0],
        config: {},
      };
      const resp = await fetch('/api/onboarding/create-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error ?? 'Ticket creation failed');
      setTicketResult(json.data);
      setTicketPreview(null);
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : 'Ticket creation failed');
    } finally {
      setTicketCreating(false);
    }
  };

  const handleCreateMilestones = async () => {
    if (!entry) return;
    setMilestonesLoading(true);
    setMilestoneError(null);
    try {
      const resp = await fetch(`/api/milestones/delivery/${entry.id}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error ?? 'Failed to create milestones');
      setMilestones(json.data);
    } catch (err) {
      setMilestoneError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setMilestonesLoading(false);
    }
  };

  const handleMilestoneStatusChange = async (milestoneId: number, newStatus: string) => {
    try {
      const resp = await fetch(`/api/milestones/${milestoneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await resp.json();
      if (json.ok) {
        setMilestones(prev => prev.map(m => m.id === milestoneId ? json.data : m));
      }
    } catch { /* ignore */ }
  };

  const handleChecklistToggle = async (milestoneId: number, checkIndex: number) => {
    const milestone = milestones.find(m => m.id === milestoneId);
    if (!milestone) return;
    try {
      const items = JSON.parse(milestone.checklist_state_json || '[]');
      if (Array.isArray(items) && items[checkIndex] && typeof items[checkIndex] === 'object') {
        items[checkIndex].checked = !items[checkIndex].checked;
      }
      const resp = await fetch(`/api/milestones/${milestoneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklist_state_json: JSON.stringify(items) }),
      });
      const json = await resp.json();
      if (json.ok) {
        setMilestones(prev => prev.map(m => m.id === milestoneId ? json.data : m));
      }
    } catch { /* ignore */ }
  };

  const handleDeleteMilestones = async () => {
    if (!entry || !confirm('Delete all milestones for this delivery?')) return;
    try {
      await fetch(`/api/milestones/delivery/${entry.id}`, { method: 'DELETE' });
      setMilestones([]);
    } catch { /* ignore */ }
  };

  const completedCount = milestones.filter(m => m.status === 'complete').length;
  const milestoneProgress = milestones.length > 0 ? Math.round((completedCount / milestones.length) * 100) : 0;

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
            <div className="text-sm text-neutral-100 font-semibold truncate">
              {entry && !isNew ? entry.account : prefill?.account || 'New Delivery Entry'}
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
            <div>
              <label className={labelCls}>Account *</label>
              <input className={inputCls} value={form.account} onChange={(e) => setField('account', e.target.value)} placeholder="Customer name" />
            </div>
            <div>
              <label className={labelCls}>Sale Type</label>
              <select value={form.sale_type} onChange={(e) => setField('sale_type', e.target.value)} className={inputCls}>
                <option value="">Select...</option>
                {saleTypes.map((st) => <option key={st.id} value={st.name}>{st.name}</option>)}
              </select>
            </div>
          </div>

          {/* Onboarder */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Onboarder</label>
              <input className={inputCls} value={form.onboarder} onChange={(e) => setField('onboarder', e.target.value)} placeholder="Name" />
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

          {/* ── Delivery Milestones ── */}
          {entry && !isNew && (
            <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-300">Delivery Milestones</span>
                {milestones.length > 0 && (
                  <span className="text-[10px] text-neutral-500">
                    {completedCount}/{milestones.length} complete ({milestoneProgress}%)
                  </span>
                )}
              </div>

              {/* Progress bar */}
              {milestones.length > 0 && (
                <div className="h-1.5 bg-[#1f242b] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${milestoneProgress}%`,
                      backgroundColor: milestoneProgress === 100 ? '#22c55e' : milestoneProgress > 50 ? '#5ec1ca' : '#f59e0b',
                    }}
                  />
                </div>
              )}

              {milestoneError && (
                <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-[11px]">{milestoneError}</div>
              )}

              {/* Timeline */}
              {milestones.length > 0 ? (
                <div className="space-y-0">
                  {milestones.map((m, idx) => {
                    const isOverdue = m.status !== 'complete' && m.target_date && new Date(m.target_date) < new Date();
                    const nodeColor = m.status === 'complete'
                      ? '#22c55e'
                      : m.status === 'in_progress'
                        ? '#f59e0b'
                        : isOverdue
                          ? '#ef4444'
                          : '#4b5563';

                    return (
                      <div key={m.id} className="flex gap-3 group">
                        {/* Timeline line + node */}
                        <div className="flex flex-col items-center w-4 shrink-0">
                          <div
                            className="w-3 h-3 rounded-full border-2 shrink-0 mt-1 cursor-pointer transition-colors"
                            style={{ borderColor: nodeColor, backgroundColor: m.status === 'complete' ? nodeColor : 'transparent' }}
                            onClick={() => {
                              const next = m.status === 'pending' ? 'in_progress' : m.status === 'in_progress' ? 'complete' : 'pending';
                              handleMilestoneStatusChange(m.id, next);
                            }}
                            title={`Click to cycle: ${m.status} → ${m.status === 'pending' ? 'in_progress' : m.status === 'in_progress' ? 'complete' : 'pending'}`}
                          />
                          {idx < milestones.length - 1 && (
                            <div className="w-px flex-1 min-h-[16px]" style={{ backgroundColor: '#3a424d' }} />
                          )}
                        </div>
                        {/* Content */}
                        <div className="flex-1 pb-3 min-w-0">
                          <button
                            className="flex items-center gap-2 w-full text-left"
                            onClick={() => setExpandedMilestone(expandedMilestone === m.id ? null : m.id)}
                          >
                            <span className={`text-[11px] font-medium ${m.status === 'complete' ? 'text-green-400 line-through' : isOverdue ? 'text-red-400' : 'text-neutral-200'}`}>
                              {m.template_name}
                            </span>
                            {(() => {
                              try {
                                const items = JSON.parse(m.checklist_state_json || '[]');
                                if (Array.isArray(items) && items.length > 0) {
                                  return (
                                    <span className="text-[9px] text-neutral-600">
                                      {expandedMilestone === m.id ? '\u25B2' : '\u25BC'}
                                    </span>
                                  );
                                }
                              } catch { /* ignore */ }
                              return null;
                            })()}
                          </button>
                          <div className="flex items-center gap-2 mt-0.5">
                            {m.target_date && (
                              <span className={`text-[10px] ${isOverdue ? 'text-red-400' : 'text-neutral-500'}`}>
                                Target: {new Date(m.target_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                            {m.actual_date && (
                              <span className="text-[10px] text-green-400">
                                Done: {new Date(m.actual_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                          </div>

                          {/* Expandable checklist */}
                          {expandedMilestone === m.id && (() => {
                            try {
                              const items = JSON.parse(m.checklist_state_json || '[]');
                              if (!Array.isArray(items) || items.length === 0) return null;

                              // Handle both formats: [{text, checked}] and legacy string[]
                              const isStateful = typeof items[0] === 'object' && items[0].text;

                              if (isStateful) {
                                return (
                                  <div className="mt-1.5 space-y-1">
                                    {items.map((item: { text: string; checked: boolean }, ci: number) => (
                                      <label key={ci} className="flex items-start gap-1.5 cursor-pointer group/check">
                                        <input
                                          type="checkbox"
                                          checked={item.checked}
                                          onChange={() => handleChecklistToggle(m.id, ci)}
                                          className="mt-0.5 accent-[#5ec1ca]"
                                        />
                                        <span className={`text-[10px] ${item.checked ? 'text-neutral-600 line-through' : 'text-neutral-400'}`}>
                                          {item.text}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                );
                              }

                              // Legacy: plain string array
                              return (
                                <div className="mt-1.5 space-y-1">
                                  {items.map((item: string, ci: number) => (
                                    <div key={ci} className="flex items-start gap-1.5">
                                      <span className="text-[10px] text-neutral-500">-</span>
                                      <span className="text-[10px] text-neutral-400">{item}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            } catch { return null; }
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <button
                  onClick={handleCreateMilestones}
                  disabled={milestonesLoading}
                  className="w-full px-3 py-2 text-xs rounded bg-[#5ec1ca]/20 text-[#5ec1ca] hover:bg-[#5ec1ca]/30 disabled:opacity-50 transition-colors font-semibold border border-[#5ec1ca]/30"
                >
                  {milestonesLoading ? 'Creating...' : 'Create Milestones'}
                </button>
              )}

              {milestones.length > 0 && (
                <button
                  onClick={handleDeleteMilestones}
                  className="text-[10px] text-neutral-600 hover:text-red-400 transition-colors"
                >
                  Reset milestones
                </button>
              )}
            </div>
          )}

          {/* ── Jira Ticket Creation ── */}
          {form.sale_type && (
            <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-300">Jira Onboarding Tickets</span>
                <span className="text-[10px] text-neutral-500">
                  Sale: {form.sale_type} {entry?.onboarding_id ? `\u00B7 Ref: ${entry.onboarding_id}` : ''}
                </span>
              </div>

              {/* Dry run preview */}
              {ticketPreview && ticketPreview.details && (
                <div className="space-y-2">
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Preview — tickets to create:</div>
                  <div className="text-[11px] text-purple-300 bg-purple-950/30 border border-purple-900/40 rounded px-2 py-1.5">
                    {ticketPreview.details.parentSummary}
                  </div>
                  {ticketPreview.details.childSummaries.map((s, i) => (
                    <div key={i} className="text-[11px] text-[#5ec1ca] bg-[#5ec1ca]/10 border border-[#5ec1ca]/20 rounded px-2 py-1.5">
                      {s}
                    </div>
                  ))}
                  {entry?.onboarding_id && (
                    <button
                      onClick={handleCreateTickets}
                      disabled={ticketCreating}
                      className="w-full px-3 py-2 text-xs rounded bg-green-700 text-white hover:bg-green-600 disabled:opacity-50 transition-colors font-semibold"
                    >
                      {ticketCreating ? 'Creating...' : `Create ${ticketPreview.details.childSummaries.length + 1} Tickets in Jira`}
                    </button>
                  )}
                  {!entry?.onboarding_id && (
                    <div className="text-[10px] text-amber-400">Save entry first to get an onboarding ref before creating tickets.</div>
                  )}
                </div>
              )}

              {/* Live result */}
              {ticketResult && (
                <div className="space-y-2">
                  <div className="text-[10px] text-green-400 uppercase tracking-wider">
                    {ticketResult.existing ? 'Tickets already exist' : `Created ${ticketResult.createdCount} tickets, ${ticketResult.linkedCount} links`}
                  </div>
                  <div className="text-[11px] text-neutral-200">
                    Parent: <span className="font-mono text-purple-300">{ticketResult.parentKey}</span>
                  </div>
                  {ticketResult.childKeys.map((key, i) => (
                    <div key={i} className="text-[11px] text-neutral-200">
                      Child: <span className="font-mono text-[#5ec1ca]">{key}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Error */}
              {ticketError && (
                <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-[11px]">{ticketError}</div>
              )}

              {/* Buttons */}
              {!ticketPreview && !ticketResult && (
                <button
                  onClick={handleDryRun}
                  disabled={ticketCreating || !canCreateTickets}
                  className="w-full px-3 py-2 text-xs rounded bg-purple-700 text-white hover:bg-purple-600 disabled:opacity-50 transition-colors font-semibold"
                >
                  {ticketCreating ? 'Loading...' : 'Preview Tickets'}
                </button>
              )}

              {(ticketPreview || ticketResult) && (
                <button
                  onClick={() => { setTicketPreview(null); setTicketResult(null); setTicketError(null); }}
                  className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
          )}

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
