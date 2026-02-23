import { useState, useEffect, useCallback } from 'react';

interface DeliveryRow {
  orderDate: string | null;
  goLiveDate: string | null;
  onboarder: string | null;
  account: string;
  predictedDelivery: string | null;
  status: string;
  branches: number | null;
  mrr: number | null;
  incremental: number | null;
  licenceFee: number | null;
  notes: string | null;
  daysToDeliver: number | null;
}

interface SheetData {
  rows: DeliveryRow[];
  totals: { count: number; mrr: number; wip: number; complete: number; dead: number };
}

interface Summary {
  totalCustomers: number;
  totalMrr: number;
  totalWip: number;
  totalComplete: number;
  totalDead: number;
  products: string[];
  lastModified: string;
}

interface DeliveryData {
  summary: Summary;
  sheets: Record<string, SheetData>;
}

interface DbEntry {
  id: number;
  product: string;
  account: string;
  status: string;
  onboarder: string | null;
  order_date: string | null;
  go_live_date: string | null;
  predicted_delivery: string | null;
  branches: number | null;
  mrr: number | null;
  incremental: number | null;
  licence_fee: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  complete: '#22c55e', wip: '#f59e0b', 'in progress': '#f59e0b',
  'not started': '#6b7280', dead: '#ef4444', 'back to sales': '#ef4444',
  live: '#22c55e', 'on hold': '#a855f7', pending: '#3b82f6',
};

const STATUSES = ['Not Started', 'WIP', 'In Progress', 'On Hold', 'Complete', 'Dead', 'Back to Sales'];

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

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-3 flex flex-col">
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-neutral-100">{value}</div>
      {sub && <div className="text-[10px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = getStatusColor(status);
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
      style={{ backgroundColor: color + '20', color }}
    >
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {status || '-'}
    </span>
  );
}

// ---- Form field helpers ----
const inputCls = 'bg-[#272C33] text-neutral-200 text-[11px] rounded px-2.5 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
const labelCls = 'text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block';

const emptyForm = {
  product: '', account: '', status: 'Not Started', onboarder: '',
  order_date: '', go_live_date: '', predicted_delivery: '',
  branches: '', mrr: '', incremental: '', licence_fee: '', notes: '',
};

export function DeliveryView() {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [dbEntries, setDbEntries] = useState<DbEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/delivery').then((r) => r.json()),
      fetch('/api/delivery/entries').then((r) => r.json()),
    ])
      .then(([xlsxJson, dbJson]) => {
        if (xlsxJson.ok) {
          setData(xlsxJson.data);
          if (xlsxJson.data.summary.products.length > 0 && !activeTab) {
            setActiveTab(xlsxJson.data.summary.products[0]);
          }
        } else {
          setError(xlsxJson.error ?? 'Failed to load delivery data');
        }
        if (dbJson.ok) setDbEntries(dbJson.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    if (!form.product.trim() || !form.account.trim()) return;
    setSaving(true);
    try {
      const body = {
        product: form.product.trim(),
        account: form.account.trim(),
        status: form.status,
        onboarder: form.onboarder.trim() || null,
        order_date: form.order_date || null,
        go_live_date: form.go_live_date || null,
        predicted_delivery: form.predicted_delivery || null,
        branches: form.branches ? parseInt(form.branches, 10) : null,
        mrr: form.mrr ? parseFloat(form.mrr) : null,
        incremental: form.incremental ? parseFloat(form.incremental) : null,
        licence_fee: form.licence_fee ? parseFloat(form.licence_fee) : null,
        notes: form.notes.trim() || null,
      };

      const url = editingId ? `/api/delivery/entries/${editingId}` : '/api/delivery/entries';
      const method = editingId ? 'PUT' : 'POST';
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (json.ok) {
        setForm(emptyForm);
        setShowForm(false);
        setEditingId(null);
        // Refresh DB entries
        const dbResp = await fetch('/api/delivery/entries');
        const dbJson = await dbResp.json();
        if (dbJson.ok) setDbEntries(dbJson.data);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (entry: DbEntry) => {
    setForm({
      product: entry.product,
      account: entry.account,
      status: entry.status || 'Not Started',
      onboarder: entry.onboarder ?? '',
      order_date: entry.order_date ?? '',
      go_live_date: entry.go_live_date ?? '',
      predicted_delivery: entry.predicted_delivery ?? '',
      branches: entry.branches?.toString() ?? '',
      mrr: entry.mrr?.toString() ?? '',
      incremental: entry.incremental?.toString() ?? '',
      licence_fee: entry.licence_fee?.toString() ?? '',
      notes: entry.notes ?? '',
    });
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/delivery/entries/${id}`, { method: 'DELETE' });
    setDbEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const setField = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-neutral-500">Loading delivery sheet...</div>;
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="bg-red-950/50 border border-red-900 rounded-lg p-6 max-w-md text-center">
          <div className="text-red-400 font-semibold mb-2">Cannot load delivery sheet</div>
          <div className="text-sm text-neutral-400">{error}</div>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { summary, sheets } = data;
  const currentSheet = activeTab ? sheets[activeTab] : null;
  const sheetStatuses = currentSheet
    ? [...new Set(currentSheet.rows.map((r) => (r.status || '').toLowerCase().trim()))].filter(Boolean).sort()
    : [];
  const filteredRows = currentSheet
    ? currentSheet.rows.filter((r) => {
        if (statusFilter && (r.status || '').toLowerCase().trim() !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          return r.account.toLowerCase().includes(q) || (r.onboarder ?? '').toLowerCase().includes(q) || (r.notes ?? '').toLowerCase().includes(q);
        }
        return true;
      })
    : [];

  // DB entries for the active product tab
  const dbForTab = activeTab ? dbEntries.filter((e) => e.product === activeTab) : [];
  // DB entries for products not in xlsx
  const dbExtraProducts = [...new Set(dbEntries.map((e) => e.product))].filter((p) => !summary.products.includes(p));

  const allProducts = [...summary.products, ...dbExtraProducts];
  const lastMod = new Date(summary.lastModified);

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">Delivery Sheet</h2>
          <div className="text-[10px] text-neutral-600 mt-0.5">
            xlsx last modified: {lastMod.toLocaleDateString('en-GB')} {lastMod.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ ...emptyForm, product: activeTab ?? '' }); }}
          className="px-4 py-2 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add Entry'}
        </button>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4 mb-6">
          <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-3">
            {editingId ? 'Edit Entry' : 'New Delivery Entry'}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Product *</label>
              <select value={form.product} onChange={(e) => setField('product', e.target.value)} className={inputCls}>
                <option value="">Select...</option>
                {allProducts.map((p) => <option key={p} value={p}>{p}</option>)}
                <option value="__custom">Other...</option>
              </select>
              {form.product === '__custom' && (
                <input className={`${inputCls} mt-1`} placeholder="Product name" value="" onChange={(e) => setField('product', e.target.value)} />
              )}
            </div>
            <div>
              <label className={labelCls}>Account *</label>
              <input className={inputCls} value={form.account} onChange={(e) => setField('account', e.target.value)} placeholder="Customer name" />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={(e) => setField('status', e.target.value)} className={inputCls}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Onboarder</label>
              <input className={inputCls} value={form.onboarder} onChange={(e) => setField('onboarder', e.target.value)} placeholder="Name" />
            </div>
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
              <label className={labelCls}>Branches</label>
              <input type="number" className={inputCls} value={form.branches} onChange={(e) => setField('branches', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>MRR (£)</label>
              <input type="number" step="0.01" className={inputCls} value={form.mrr} onChange={(e) => setField('mrr', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls}>Incremental (£)</label>
              <input type="number" step="0.01" className={inputCls} value={form.incremental} onChange={(e) => setField('incremental', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls}>Licence Fee (£)</label>
              <input type="number" step="0.01" className={inputCls} value={form.licence_fee} onChange={(e) => setField('licence_fee', e.target.value)} placeholder="0.00" />
            </div>
            <div className="col-span-2 sm:col-span-3 md:col-span-1">
              <label className={labelCls}>Notes</label>
              <input className={inputCls} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Details..." />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={handleSave}
              disabled={saving || !form.product.trim() || !form.account.trim()}
              className="px-4 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingId ? 'Update' : 'Save'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}
              className="px-4 py-1.5 text-xs rounded bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] border border-[#3a424d] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard label="Products" value={summary.products.length} />
        <KpiCard label="Total Customers" value={summary.totalCustomers} />
        <KpiCard label="Total MRR" value={formatCurrency(summary.totalMrr)} />
        <KpiCard label="WIP" value={summary.totalWip} sub="Active deliveries" />
        <KpiCard label="Complete" value={summary.totalComplete} />
        <KpiCard label="NOVA Entries" value={dbEntries.length} sub="Local additions" />
      </div>

      {/* Product tabs */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {allProducts.map((product) => {
          const sheet = sheets[product];
          const dbCount = dbEntries.filter((e) => e.product === product).length;
          const isActive = activeTab === product;
          return (
            <button
              key={product}
              onClick={() => { setActiveTab(product); setStatusFilter(null); setSearch(''); }}
              className={`px-3 py-1.5 text-[11px] rounded transition-colors ${
                isActive
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
              }`}
            >
              {product}
              <span className={`ml-1.5 ${isActive ? 'text-[#272C33]/70' : 'text-neutral-600'}`}>
                {(sheet?.totals.count ?? 0) + dbCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sheet content */}
      {activeTab && (
        <>
          {/* Sheet summary bar */}
          {currentSheet && (
            <div className="flex items-center gap-4 mb-3 text-[11px] text-neutral-500">
              <span>{currentSheet.totals.count} from xlsx</span>
              <span>MRR: {formatCurrency(currentSheet.totals.mrr)}</span>
              <span className="text-amber-400">{currentSheet.totals.wip} WIP</span>
              <span className="text-green-400">{currentSheet.totals.complete} Complete</span>
              {dbForTab.length > 0 && (
                <span className="text-[#5ec1ca]">{dbForTab.length} NOVA entries</span>
              )}
            </div>
          )}

          {/* Filters row */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <button
              onClick={() => setStatusFilter(null)}
              className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                statusFilter === null ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
              }`}
            >
              All
            </button>
            {sheetStatuses.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
                className={`px-2 py-0.5 text-[10px] rounded-full transition-colors flex items-center gap-1 ${
                  statusFilter === status ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                }`}
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusFilter === status ? '#272C33' : getStatusColor(status) }} />
                {status}
              </button>
            ))}
            <div className="ml-auto">
              <input
                type="text" placeholder="Search accounts..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[#2f353d] text-neutral-300 text-[11px] rounded px-2.5 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-48 placeholder:text-neutral-600"
              />
            </div>
          </div>

          {(statusFilter || search) && (
            <div className="text-[10px] text-neutral-600 mb-2">
              Showing {filteredRows.length} of {currentSheet?.rows.length ?? 0}
            </div>
          )}

          {/* Table — xlsx rows + DB rows merged */}
          <div className="overflow-x-auto rounded-lg border border-[#3a424d]">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-[#2f353d] text-neutral-500 uppercase tracking-wider text-left">
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Onboarder</th>
                  <th className="px-3 py-2 font-medium">Order Date</th>
                  <th className="px-3 py-2 font-medium">Go Live</th>
                  <th className="px-3 py-2 font-medium">Predicted</th>
                  <th className="px-3 py-2 font-medium text-right">Branches</th>
                  <th className="px-3 py-2 font-medium text-right">MRR</th>
                  <th className="px-3 py-2 font-medium text-right">Incr.</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                  <th className="px-3 py-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#3a424d]">
                {/* DB entries for this tab (shown first, highlighted) */}
                {dbForTab.map((entry) => (
                  <tr key={`db-${entry.id}`} className="hover:bg-[#363d47]/50 transition-colors bg-[#5ec1ca]/5">
                    <td className="px-3 py-2 text-neutral-200 font-medium whitespace-nowrap">
                      {entry.account}
                      <span className="ml-1.5 text-[9px] text-[#5ec1ca] uppercase">nova</span>
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={entry.status} /></td>
                    <td className="px-3 py-2 text-neutral-400">{entry.onboarder ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{entry.order_date ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{entry.go_live_date ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{entry.predicted_delivery ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 text-right">{entry.branches ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-200 text-right font-medium">{formatCurrency(entry.mrr)}</td>
                    <td className="px-3 py-2 text-neutral-400 text-right">{formatCurrency(entry.incremental)}</td>
                    <td className="px-3 py-2 text-neutral-500 max-w-[200px] truncate" title={entry.notes ?? ''}>{entry.notes ?? '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleEdit(entry)} className="text-[10px] text-[#5ec1ca] hover:text-[#4db0b9]">Edit</button>
                        <button onClick={() => handleDelete(entry.id)} className="text-[10px] text-red-400 hover:text-red-300">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {/* xlsx rows */}
                {filteredRows.map((row, i) => (
                  <tr key={`xlsx-${row.account}-${i}`} className="hover:bg-[#363d47]/50 transition-colors">
                    <td className="px-3 py-2 text-neutral-200 font-medium whitespace-nowrap">{row.account}</td>
                    <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                    <td className="px-3 py-2 text-neutral-400">{row.onboarder ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.orderDate ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.goLiveDate ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.predictedDelivery ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 text-right">{row.branches ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-200 text-right font-medium">{formatCurrency(row.mrr)}</td>
                    <td className="px-3 py-2 text-neutral-400 text-right">{formatCurrency(row.incremental)}</td>
                    <td className="px-3 py-2 text-neutral-500 max-w-[200px] truncate" title={row.notes ?? ''}>{row.notes ?? '-'}</td>
                    <td className="px-3 py-2"></td>
                  </tr>
                ))}
                {filteredRows.length === 0 && dbForTab.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-neutral-600">
                      No rows match your filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
