import { useState, useEffect, useCallback } from 'react';
import { DeliveryDrawer } from './DeliveryDrawer.js';

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
      <div className="text-xl font-bold text-neutral-100 truncate min-w-0">{value}</div>
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

export function DeliveryView() {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [dbEntries, setDbEntries] = useState<DbEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [drawerEntryId, setDrawerEntryId] = useState<number | null>(null);
  const [drawerIsNew, setDrawerIsNew] = useState(false);

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

  const refreshDbEntries = async () => {
    const dbResp = await fetch('/api/delivery/entries');
    const dbJson = await dbResp.json();
    if (dbJson.ok) setDbEntries(dbJson.data);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/delivery/entries/${id}`, { method: 'DELETE' });
    setDbEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleToggleStar = async (id: number) => {
    const resp = await fetch(`/api/delivery/entries/${id}/star`, { method: 'PATCH' });
    const json = await resp.json();
    if (json.ok && json.data) {
      setDbEntries((prev) => prev.map((e) => e.id === id ? json.data : e));
    }
  };

  const drawerEntry = drawerEntryId != null ? dbEntries.find((e) => e.id === drawerEntryId) ?? null : null;

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
  // Starred entries across all products
  const starredEntries = dbEntries.filter((e) => e.is_starred);

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
          onClick={() => { setDrawerEntryId(null); setDrawerIsNew(true); }}
          className="px-4 py-2 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors"
        >
          + Add Entry
        </button>
      </div>

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

      {/* Starred panel */}
      {starredEntries.length > 0 && (
        <div className="mb-5 border border-amber-400/30 rounded-lg bg-amber-400/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-amber-400 text-sm">{'\u2605'}</span>
            <span className="text-xs text-amber-400 uppercase tracking-widest font-semibold">
              Starred Deliveries
            </span>
            <span className="text-[10px] text-neutral-500">{starredEntries.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {starredEntries.map((entry) => (
              <div
                key={`star-${entry.id}`}
                className="flex items-center gap-3 bg-[#2f353d] rounded px-3 py-2 border border-[#3a424d] cursor-pointer hover:border-amber-400/50 transition-colors"
                onClick={() => { setActiveTab(entry.product); }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggleStar(entry.id); }}
                  className="text-amber-400 text-sm shrink-0"
                >
                  {'\u2605'}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-neutral-200 font-medium truncate">{entry.account}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] text-neutral-500">{entry.product}</span>
                    <StatusBadge status={entry.status} />
                    {entry.training_date && (
                      <span className="text-[9px] text-neutral-500">Train: {entry.training_date}</span>
                    )}
                  </div>
                </div>
                {entry.mrr != null && (
                  <div className="text-[10px] text-neutral-400 font-medium shrink-0">{formatCurrency(entry.mrr)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <th className="px-3 py-2 font-medium w-8"></th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Onboarder</th>
                  <th className="px-3 py-2 font-medium">Order Date</th>
                  <th className="px-3 py-2 font-medium">Go Live</th>
                  <th className="px-3 py-2 font-medium">Predicted</th>
                  <th className="px-3 py-2 font-medium">Training</th>
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
                  <tr
                    key={`db-${entry.id}`}
                    className="hover:bg-[#363d47]/50 transition-colors bg-[#5ec1ca]/5 cursor-pointer"
                    onClick={() => { setDrawerEntryId(entry.id); setDrawerIsNew(false); }}
                  >
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleStar(entry.id); }}
                        className={`text-sm transition-colors ${entry.is_starred ? 'text-amber-400' : 'text-neutral-600 hover:text-amber-400'}`}
                        title={entry.is_starred ? 'Unstar' : 'Star'}
                      >
                        {entry.is_starred ? '\u2605' : '\u2606'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-neutral-200 font-medium whitespace-nowrap">
                      {entry.account}
                      <span className="ml-1.5 text-[9px] text-[#5ec1ca] uppercase">nova</span>
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={entry.status} /></td>
                    <td className="px-3 py-2 text-neutral-400">{entry.onboarder ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{entry.order_date ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{entry.go_live_date ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{entry.predicted_delivery ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{entry.training_date ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 text-right">{entry.branches ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-200 text-right font-medium">{formatCurrency(entry.mrr)}</td>
                    <td className="px-3 py-2 text-neutral-400 text-right">{formatCurrency(entry.incremental)}</td>
                    <td className="px-3 py-2 text-neutral-500 max-w-[200px] truncate" title={entry.notes ?? ''}>{entry.notes ?? '-'}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] text-[#5ec1ca]">Edit</span>
                    </td>
                  </tr>
                ))}
                {/* xlsx rows */}
                {filteredRows.map((row, i) => (
                  <tr key={`xlsx-${row.account}-${i}`} className="hover:bg-[#363d47]/50 transition-colors">
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-neutral-200 font-medium whitespace-nowrap">{row.account}</td>
                    <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                    <td className="px-3 py-2 text-neutral-400">{row.onboarder ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.orderDate ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.goLiveDate ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.predictedDelivery ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400">-</td>
                    <td className="px-3 py-2 text-neutral-400 text-right">{row.branches ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-200 text-right font-medium">{formatCurrency(row.mrr)}</td>
                    <td className="px-3 py-2 text-neutral-400 text-right">{formatCurrency(row.incremental)}</td>
                    <td className="px-3 py-2 text-neutral-500 max-w-[200px] truncate" title={row.notes ?? ''}>{row.notes ?? '-'}</td>
                    <td className="px-3 py-2"></td>
                  </tr>
                ))}
                {filteredRows.length === 0 && dbForTab.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-3 py-8 text-center text-neutral-600">
                      No rows match your filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Delivery Drawer */}
      {(drawerIsNew || drawerEntry) && (
        <DeliveryDrawer
          entry={drawerEntry}
          isNew={drawerIsNew}
          products={allProducts}
          defaultProduct={activeTab ?? ''}
          onClose={() => { setDrawerEntryId(null); setDrawerIsNew(false); }}
          onSaved={() => refreshDbEntries()}
          onDeleted={(id) => {
            setDbEntries((prev) => prev.filter((e) => e.id !== id));
            setDrawerEntryId(null);
            setDrawerIsNew(false);
          }}
          onStarToggled={(id) => handleToggleStar(id)}
        />
      )}
    </div>
  );
}
