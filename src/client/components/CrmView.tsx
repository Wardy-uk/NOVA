import { useState, useEffect, useCallback, useMemo } from 'react';

// ---- Types ----

type RagStatus = 'red' | 'amber' | 'green';

interface CrmCustomer {
  id: number;
  name: string;
  company: string | null;
  sector: string | null;
  mrr: number | null;
  owner: string | null;
  rag_status: RagStatus;
  next_review_date: string | null;
  contract_start: string | null;
  contract_end: string | null;
  dynamics_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface CrmReview {
  id: number;
  customer_id: number;
  review_date: string;
  rag_status: RagStatus;
  outcome: string | null;
  actions: string | null;
  reviewer: string | null;
  next_review_date: string | null;
  notes: string | null;
  created_at: string;
}

interface CrmSummary {
  total: number;
  red: number;
  amber: number;
  green: number;
  overdueReviews: number;
  totalMrr: number;
}

interface TimelineDeliveryEntry {
  id: number;
  onboarding_id: string | null;
  product: string;
  account: string;
  status: string;
  onboarder: string | null;
  mrr: number | null;
  sale_type: string | null;
}

interface TimelineOnboardingRun {
  id: number;
  onboarding_ref: string;
  parent_key: string;
  status: string;
  created_at: string;
}

interface TimelineData {
  customer: CrmCustomer;
  reviews: CrmReview[];
  deliveryEntries: TimelineDeliveryEntry[];
  onboardingRuns: TimelineOnboardingRun[];
}

// ---- Constants ----

const RAG: Record<RagStatus, { bg: string; text: string; label: string }> = {
  red:   { bg: '#ef4444', text: '#fca5a5', label: 'At Risk' },
  amber: { bg: '#f59e0b', text: '#fcd34d', label: 'Watch' },
  green: { bg: '#22c55e', text: '#86efac', label: 'Healthy' },
};

const inputCls = 'bg-[#272C33] text-neutral-200 text-[11px] rounded px-2.5 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
const labelCls = 'text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block';

function formatCurrency(v: number | null): string {
  if (v == null) return '-';
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return dateStr < todayStr();
}

// ---- Sub-components ----

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-3 flex flex-col">
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold truncate" title={String(value)} style={{ color: color ?? '#f5f5f5' }}>{value}</div>
      {sub && <div className="text-[10px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function RagBadge({ status }: { status: RagStatus }) {
  const r = RAG[status];
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ backgroundColor: r.bg + '20', color: r.text }}
    >
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: r.bg }} />
      {r.label}
    </span>
  );
}

// ---- Empty forms ----

const emptyCustomerForm = {
  name: '', company: '', sector: '', mrr: '', owner: '',
  rag_status: 'green' as RagStatus, next_review_date: '',
  contract_start: '', contract_end: '', notes: '',
};

const emptyReviewForm = {
  review_date: todayStr(), rag_status: 'green' as RagStatus,
  outcome: '', actions: '', reviewer: '', next_review_date: '', notes: '',
};

// ---- Main Component ----

export function CrmView({ canWrite = false }: { canWrite?: boolean }) {
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [summary, setSummary] = useState<CrmSummary | null>(null);
  const [owners, setOwners] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // D365 sync
  const [d365Status, setD365Status] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [d365Message, setD365Message] = useState('');

  // Filters
  const [ragFilter, setRagFilter] = useState<RagStatus | null>(null);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [search, setSearch] = useState('');

  // Expand / reviews
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [reviews, setReviews] = useState<Record<number, CrmReview[]>>({});

  // Timeline (Customer 360)
  const [timeline, setTimeline] = useState<Record<number, TimelineData>>({});
  const [timelineLoading, setTimelineLoading] = useState<Record<number, boolean>>({});

  // Customer form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyCustomerForm);

  // Review form
  const [reviewFormFor, setReviewFormFor] = useState<number | null>(null);
  const [reviewForm, setReviewForm] = useState(emptyReviewForm);

  // ---- Data loading ----

  const loadData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (ragFilter) params.set('rag_status', ragFilter);
    if (ownerFilter) params.set('owner', ownerFilter);
    if (search.trim()) params.set('search', search.trim());

    Promise.all([
      fetch('/api/crm/summary').then(r => r.json()),
      fetch(`/api/crm/customers?${params}`).then(r => r.json()),
      fetch('/api/crm/owners').then(r => r.json()),
    ])
      .then(([sumJson, custJson, ownJson]) => {
        if (sumJson.ok) setSummary(sumJson.data);
        if (custJson.ok) setCustomers(custJson.data);
        if (ownJson.ok) setOwners(ownJson.data);
      })
      .finally(() => setLoading(false));
  }, [ragFilter, ownerFilter, search]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadReviews = async (customerId: number) => {
    const resp = await fetch(`/api/crm/customers/${customerId}/reviews`);
    const json = await resp.json();
    if (json.ok) setReviews(prev => ({ ...prev, [customerId]: json.data }));
  };

  const loadTimeline = async (customerId: number) => {
    setTimelineLoading(prev => ({ ...prev, [customerId]: true }));
    try {
      const resp = await fetch(`/api/crm/customers/${customerId}/timeline`);
      const json = await resp.json();
      if (json.ok) setTimeline(prev => ({ ...prev, [customerId]: json.data }));
    } finally {
      setTimelineLoading(prev => ({ ...prev, [customerId]: false }));
    }
  };

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setReviewFormFor(null);
    } else {
      setExpandedId(id);
      setReviewFormFor(null);
      if (!reviews[id]) loadReviews(id);
      if (!timeline[id]) loadTimeline(id);
    }
  };

  // ---- Customer CRUD ----

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyCustomerForm);
    setShowForm(true);
  };

  const openEdit = (c: CrmCustomer) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      company: c.company ?? '',
      sector: c.sector ?? '',
      mrr: c.mrr != null ? String(c.mrr) : '',
      owner: c.owner ?? '',
      rag_status: c.rag_status,
      next_review_date: c.next_review_date ?? '',
      contract_start: c.contract_start ?? '',
      contract_end: c.contract_end ?? '',
      notes: c.notes ?? '',
    });
    setShowForm(true);
  };

  const saveCustomer = async () => {
    const body = {
      name: form.name.trim(),
      company: form.company.trim() || null,
      sector: form.sector.trim() || null,
      mrr: form.mrr ? Number(form.mrr) : null,
      owner: form.owner.trim() || null,
      rag_status: form.rag_status,
      next_review_date: form.next_review_date || null,
      contract_start: form.contract_start || null,
      contract_end: form.contract_end || null,
      notes: form.notes.trim() || null,
    };
    if (!body.name) return;

    const url = editingId ? `/api/crm/customers/${editingId}` : '/api/crm/customers';
    const method = editingId ? 'PUT' : 'POST';
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setShowForm(false);
    setEditingId(null);
    setForm(emptyCustomerForm);
    loadData();
  };

  const deleteCustomer = async (id: number) => {
    await fetch(`/api/crm/customers/${id}`, { method: 'DELETE' });
    if (expandedId === id) setExpandedId(null);
    loadData();
  };

  // ---- Review CRUD ----

  const openReviewForm = (customerId: number) => {
    setReviewFormFor(customerId);
    setReviewForm({ ...emptyReviewForm, review_date: todayStr() });
  };

  const saveReview = async (customerId: number) => {
    const body = {
      review_date: reviewForm.review_date,
      rag_status: reviewForm.rag_status,
      outcome: reviewForm.outcome.trim() || null,
      actions: reviewForm.actions.trim() || null,
      reviewer: reviewForm.reviewer.trim() || null,
      next_review_date: reviewForm.next_review_date || null,
      notes: reviewForm.notes.trim() || null,
    };
    if (!body.review_date || !body.rag_status) return;

    await fetch(`/api/crm/customers/${customerId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setReviewFormFor(null);
    setReviewForm(emptyReviewForm);
    loadReviews(customerId);
    loadData(); // refresh summary + customer RAG
  };

  const deleteReview = async (reviewId: number, customerId: number) => {
    await fetch(`/api/crm/reviews/${reviewId}`, { method: 'DELETE' });
    loadReviews(customerId);
    loadData();
  };

  // ---- D365 Sync ----

  const syncFromD365 = async () => {
    setD365Status('syncing');
    setD365Message('');
    try {
      const resp = await fetch('/api/dynamics365/sync', { method: 'POST' });
      const json = await resp.json();
      if (json.ok) {
        const { created, updated, total } = json.data;
        setD365Status('done');
        setD365Message(`Synced ${total} accounts (${created} new, ${updated} updated)`);
        loadData();
      } else {
        setD365Status('error');
        setD365Message(json.error ?? 'Sync failed');
      }
    } catch (err) {
      setD365Status('error');
      setD365Message(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const purgeAndResync = async () => {
    if (!window.confirm('This will delete ALL local CRM data and re-pull from Dynamics 365. Continue?')) return;
    setD365Status('syncing');
    setD365Message('');
    try {
      const resp = await fetch('/api/dynamics365/purge-and-sync', { method: 'POST' });
      const json = await resp.json();
      if (json.ok) {
        const { created, purged, total } = json.data;
        setD365Status('done');
        setD365Message(`Purged ${purged} old records, synced ${total} accounts (${created} new)`);
        loadData();
      } else {
        setD365Status('error');
        setD365Message(json.error ?? 'Purge & re-sync failed');
      }
    } catch (err) {
      setD365Status('error');
      setD365Message(err instanceof Error ? err.message : 'Purge & re-sync failed');
    }
  };

  // ---- Computed ----

  const filteredCount = customers.length;

  // ---- Render ----

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-neutral-100 font-[var(--font-heading)]">CRM</h2>
        <div className="flex items-center gap-2">
          {canWrite && (
            <>
              <button
                onClick={syncFromD365}
                disabled={d365Status === 'syncing'}
                className="px-3 py-1.5 text-xs rounded bg-[#363d47] text-neutral-300 font-medium hover:bg-[#3a424d] disabled:opacity-50 transition-colors"
              >
                {d365Status === 'syncing' ? 'Syncing...' : 'Sync from D365'}
              </button>
              <button
                onClick={purgeAndResync}
                disabled={d365Status === 'syncing'}
                className="px-3 py-1.5 text-xs rounded bg-[#363d47] text-red-400 font-medium hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                Purge & Re-sync
              </button>
              <button onClick={openAdd} className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors">
                + Add Customer
              </button>
            </>
          )}
        </div>
      </div>

      {/* D365 sync feedback */}
      {d365Status !== 'idle' && d365Status !== 'syncing' && (
        <div className={`text-[11px] px-3 py-2 rounded mb-4 ${
          d365Status === 'done' ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {d365Message}
          <button onClick={() => setD365Status('idle')} className="ml-2 opacity-60 hover:opacity-100">dismiss</button>
        </div>
      )}

      {/* KPI Summary */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          <KpiCard label="Total Customers" value={summary.total} />
          <KpiCard label="At Risk" value={summary.red} color="#ef4444" />
          <KpiCard label="Watch" value={summary.amber} color="#f59e0b" />
          <KpiCard label="Healthy" value={summary.green} color="#22c55e" />
          <KpiCard label="Overdue Reviews" value={summary.overdueReviews} color={summary.overdueReviews > 0 ? '#ef4444' : undefined} />
          <KpiCard label="Total MRR" value={formatCurrency(summary.totalMrr)} />
        </div>
      )}

      {/* Add/Edit Customer Form */}
      {showForm && (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4 mb-5">
          <div className="text-xs font-semibold text-neutral-300 mb-3">
            {editingId ? 'Edit Customer' : 'New Customer'}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Customer name" />
            </div>
            <div>
              <label className={labelCls}>Company</label>
              <input className={inputCls} value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Company" />
            </div>
            <div>
              <label className={labelCls}>Sector</label>
              <input className={inputCls} value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))} placeholder="e.g. Estate Agent" />
            </div>
            <div>
              <label className={labelCls}>MRR</label>
              <input className={inputCls} type="number" value={form.mrr} onChange={e => setForm(f => ({ ...f, mrr: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>Owner</label>
              <input className={inputCls} value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} placeholder="Account manager" />
            </div>
            <div>
              <label className={labelCls}>RAG Status</label>
              <select className={inputCls} value={form.rag_status} onChange={e => setForm(f => ({ ...f, rag_status: e.target.value as RagStatus }))}>
                <option value="green">Green — Healthy</option>
                <option value="amber">Amber — Watch</option>
                <option value="red">Red — At Risk</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Next Review</label>
              <input className={inputCls} type="date" value={form.next_review_date} onChange={e => setForm(f => ({ ...f, next_review_date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Contract Start</label>
              <input className={inputCls} type="date" value={form.contract_start} onChange={e => setForm(f => ({ ...f, contract_start: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Contract End</label>
              <input className={inputCls} type="date" value={form.contract_end} onChange={e => setForm(f => ({ ...f, contract_end: e.target.value }))} />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className={labelCls}>Notes</label>
              <textarea className={inputCls + ' resize-none'} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes..." />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={saveCustomer} disabled={!form.name.trim()} className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-40 transition-colors">
              {editingId ? 'Save Changes' : 'Create Customer'}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-3 py-1.5 text-xs rounded bg-[#363d47] text-neutral-400 hover:bg-[#3a424d] transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* RAG chips */}
        <button
          onClick={() => setRagFilter(null)}
          className={`px-2.5 py-1 text-[10px] rounded-full font-medium transition-colors ${
            ragFilter === null ? 'bg-[#5ec1ca] text-[#272C33]' : 'bg-[#363d47] text-neutral-400 hover:bg-[#3a424d]'
          }`}
        >All</button>
        {(['red', 'amber', 'green'] as RagStatus[]).map(r => (
          <button
            key={r}
            onClick={() => setRagFilter(ragFilter === r ? null : r)}
            className={`px-2.5 py-1 text-[10px] rounded-full font-medium transition-colors inline-flex items-center gap-1 ${
              ragFilter === r ? 'text-[#272C33]' : 'bg-[#363d47] text-neutral-400 hover:bg-[#3a424d]'
            }`}
            style={ragFilter === r ? { backgroundColor: RAG[r].bg } : undefined}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: RAG[r].bg }} />
            {RAG[r].label}
          </button>
        ))}

        {/* Owner filter */}
        {owners.length > 0 && (
          <select
            className="bg-[#363d47] text-neutral-400 text-[10px] rounded px-2 py-1 border-none outline-none"
            value={ownerFilter}
            onChange={e => setOwnerFilter(e.target.value)}
          >
            <option value="">All Owners</option>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}

        {/* Search */}
        <input
          className="bg-[#363d47] text-neutral-300 text-[11px] rounded px-2.5 py-1 border-none outline-none placeholder:text-neutral-600 ml-auto w-48"
          placeholder="Search customers..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <span className="text-[10px] text-neutral-600">{filteredCount} customers</span>
      </div>

      {/* Customer List */}
      {loading ? (
        <div className="text-neutral-500 text-sm py-10 text-center">Loading...</div>
      ) : customers.length === 0 ? (
        <div className="text-neutral-500 text-sm py-10 text-center">
          {ragFilter || ownerFilter || search ? 'No customers match filters' : 'No customers yet — add one above'}
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map(c => {
            const expanded = expandedId === c.id;
            const overdue = isOverdue(c.next_review_date);
            const custReviews = reviews[c.id] ?? [];

            return (
              <div key={c.id} className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
                {/* Card header */}
                <div
                  className="px-5 py-3.5 cursor-pointer hover:bg-[#363d47]/40 transition-colors"
                  onClick={() => toggleExpand(c.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: RAG[c.rag_status].bg }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-neutral-200 truncate">{c.name}</span>
                          {c.dynamics_id && (
                            <span className="px-1.5 py-0.5 text-[8px] font-semibold uppercase rounded bg-blue-500/15 text-blue-400 border border-blue-500/20 flex-shrink-0">
                              D365
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-neutral-500 truncate">
                          {c.company}{c.sector ? ` · ${c.sector}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] flex-shrink-0 ml-4">
                      <RagBadge status={c.rag_status} />
                      {c.mrr != null && <span className="text-neutral-300 font-medium">{formatCurrency(c.mrr)}</span>}
                      {c.owner && <span className="text-neutral-500">{c.owner}</span>}
                      <span className={overdue ? 'text-red-400' : 'text-neutral-500'}>
                        {c.next_review_date ?? 'No review set'}
                        {overdue && <span className="ml-1 text-[9px] text-red-400 uppercase font-semibold">overdue</span>}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); openEdit(c); }}
                        className="text-[10px] text-[#5ec1ca] hover:text-[#4db0b9]"
                      >Edit</button>
                      <button
                        onClick={e => { e.stopPropagation(); deleteCustomer(c.id); }}
                        className="text-[10px] text-red-400 hover:text-red-300"
                      >Del</button>
                      <span className="text-neutral-600 text-xs">{expanded ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>
                </div>

                {/* Expanded: Review History */}
                {expanded && (
                  <div className="border-t border-[#3a424d] px-5 py-4">
                    {c.notes && (
                      <div className="text-[11px] text-neutral-400 mb-3 italic">{c.notes}</div>
                    )}

                    <div className="flex items-center justify-between mb-3">
                      <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">Review History</div>
                      <button
                        onClick={() => openReviewForm(c.id)}
                        className="text-[11px] text-[#5ec1ca] hover:text-[#4db0b9] font-medium"
                      >+ Add Review</button>
                    </div>

                    {/* Review form (inline) */}
                    {reviewFormFor === c.id && (
                      <div className="border border-[#3a424d] rounded bg-[#272C33] p-3 mb-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div>
                            <label className={labelCls}>Date *</label>
                            <input className={inputCls} type="date" value={reviewForm.review_date}
                              onChange={e => setReviewForm(f => ({ ...f, review_date: e.target.value }))} />
                          </div>
                          <div>
                            <label className={labelCls}>RAG *</label>
                            <select className={inputCls} value={reviewForm.rag_status}
                              onChange={e => setReviewForm(f => ({ ...f, rag_status: e.target.value as RagStatus }))}>
                              <option value="green">Green — Healthy</option>
                              <option value="amber">Amber — Watch</option>
                              <option value="red">Red — At Risk</option>
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>Reviewer</label>
                            <input className={inputCls} value={reviewForm.reviewer}
                              onChange={e => setReviewForm(f => ({ ...f, reviewer: e.target.value }))} placeholder="Who reviewed" />
                          </div>
                          <div className="col-span-2 sm:col-span-3">
                            <label className={labelCls}>Outcome</label>
                            <input className={inputCls} value={reviewForm.outcome}
                              onChange={e => setReviewForm(f => ({ ...f, outcome: e.target.value }))} placeholder="Review outcome summary" />
                          </div>
                          <div className="col-span-2 sm:col-span-3">
                            <label className={labelCls}>Actions</label>
                            <textarea className={inputCls + ' resize-none'} rows={2} value={reviewForm.actions}
                              onChange={e => setReviewForm(f => ({ ...f, actions: e.target.value }))} placeholder="Follow-up actions" />
                          </div>
                          <div>
                            <label className={labelCls}>Next Review</label>
                            <input className={inputCls} type="date" value={reviewForm.next_review_date}
                              onChange={e => setReviewForm(f => ({ ...f, next_review_date: e.target.value }))} />
                          </div>
                          <div className="col-span-2">
                            <label className={labelCls}>Notes</label>
                            <input className={inputCls} value={reviewForm.notes}
                              onChange={e => setReviewForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes" />
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => saveReview(c.id)} className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors">
                            Save Review
                          </button>
                          <button onClick={() => setReviewFormFor(null)} className="px-3 py-1.5 text-xs rounded bg-[#363d47] text-neutral-400 hover:bg-[#3a424d] transition-colors">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Review timeline */}
                    {custReviews.length === 0 ? (
                      <div className="text-[11px] text-neutral-600 pl-3 py-2">No reviews yet</div>
                    ) : (
                      <div className="space-y-1.5">
                        {custReviews.map(rv => (
                          <div
                            key={rv.id}
                            className="flex items-start gap-3 pl-3 border-l-2 py-1.5"
                            style={{ borderColor: RAG[rv.rag_status].bg }}
                          >
                            <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: RAG[rv.rag_status].bg }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] text-neutral-300 font-medium">{rv.review_date}</span>
                                <RagBadge status={rv.rag_status} />
                                {rv.reviewer && <span className="text-[10px] text-neutral-500">{rv.reviewer}</span>}
                                <button
                                  onClick={() => deleteReview(rv.id, c.id)}
                                  className="text-[9px] text-red-400/60 hover:text-red-400 ml-auto"
                                >remove</button>
                              </div>
                              {rv.outcome && <div className="text-[11px] text-neutral-400 mt-0.5">{rv.outcome}</div>}
                              {rv.actions && <div className="text-[10px] text-neutral-500 mt-0.5">Actions: {rv.actions}</div>}
                              {rv.notes && <div className="text-[10px] text-neutral-600 mt-0.5 italic">{rv.notes}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Customer 360: Delivery & Onboarding */}
                    {timelineLoading[c.id] ? (
                      <div className="mt-4 pt-3 border-t border-[#3a424d]/50 text-[11px] text-neutral-600">Loading timeline...</div>
                    ) : timeline[c.id] && (timeline[c.id].deliveryEntries.length > 0 || timeline[c.id].onboardingRuns.length > 0) ? (
                      <div className="mt-4 pt-3 border-t border-[#3a424d]/50">
                        {/* Delivery entries */}
                        {timeline[c.id].deliveryEntries.length > 0 && (
                          <div className="mb-3">
                            <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold mb-2">
                              Delivery Entries ({timeline[c.id].deliveryEntries.length})
                            </div>
                            <div className="space-y-1.5">
                              {timeline[c.id].deliveryEntries.map(de => (
                                <div
                                  key={de.id}
                                  className="flex items-center gap-3 pl-3 py-1.5 border-l-2 border-[#5ec1ca]"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#5ec1ca]/10 text-[#5ec1ca] font-medium">{de.product}</span>
                                      <span className={`text-[10px] font-medium ${
                                        de.status === 'Complete' ? 'text-green-400' :
                                        de.status === 'WIP' || de.status === 'In Progress' ? 'text-amber-400' :
                                        de.status === 'On Hold' ? 'text-purple-400' :
                                        de.status === 'Dead' || de.status === 'Back to Sales' ? 'text-red-400' :
                                        'text-neutral-400'
                                      }`}>{de.status || 'Not Started'}</span>
                                      {de.onboarding_id && (
                                        <span className="text-[8px] font-mono text-neutral-500">{de.onboarding_id}</span>
                                      )}
                                      {de.sale_type && (
                                        <span className="text-[9px] text-neutral-600">{de.sale_type}</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-neutral-500">
                                      {de.onboarder && <span>{de.onboarder}</span>}
                                      {de.mrr != null && de.mrr > 0 && (
                                        <span className="text-neutral-400 font-medium ml-auto">{formatCurrency(de.mrr)}</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Onboarding runs */}
                        {timeline[c.id].onboardingRuns.length > 0 && (
                          <div>
                            <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold mb-2">
                              Onboarding Runs ({timeline[c.id].onboardingRuns.length})
                            </div>
                            <div className="space-y-1.5">
                              {timeline[c.id].onboardingRuns.map(run => (
                                <div
                                  key={run.id}
                                  className="flex items-center gap-3 pl-3 py-1.5 border-l-2 border-purple-500"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-[10px] font-mono text-neutral-400">{run.onboarding_ref}</span>
                                      <span className={`text-[10px] font-medium ${
                                        run.status === 'complete' ? 'text-green-400' :
                                        run.status === 'running' ? 'text-amber-400' :
                                        run.status === 'failed' ? 'text-red-400' :
                                        'text-neutral-400'
                                      }`}>{run.status}</span>
                                      <span className="text-[9px] text-neutral-600">{run.parent_key}</span>
                                    </div>
                                    <div className="text-[10px] text-neutral-600 mt-0.5">
                                      {run.created_at?.split('T')[0] ?? ''}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* Contract info */}
                    {(c.contract_start || c.contract_end) && (
                      <div className="mt-3 pt-2 border-t border-[#3a424d]/50 text-[10px] text-neutral-600">
                        Contract: {c.contract_start ?? '?'} — {c.contract_end ?? 'ongoing'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
