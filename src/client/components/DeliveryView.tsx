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
  star_scope: 'me' | 'all';
  starred_by: number | null;
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

function XlsxStarButton({ row, activeTab, dbEntries, starring, onToggleStar, onStarXlsx }: {
  row: DeliveryRow;
  activeTab: string | null;
  dbEntries: DbEntry[];
  starring: boolean;
  onToggleStar: (id: number) => void;
  onStarXlsx: (row: DeliveryRow) => void;
}) {
  const existing = dbEntries.find((e) => e.product === activeTab && e.account === row.account);
  if (existing) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleStar(existing.id); }}
        className={`p-1 text-sm transition-colors ${existing.is_starred ? 'text-amber-400' : 'text-neutral-600 hover:text-amber-400'}`}
        title={existing.is_starred ? 'Unstar' : 'Star'}
      >
        {existing.is_starred ? '\u2605' : '\u2606'}
      </button>
    );
  }
  if (starring) {
    return <span className="p-1 text-sm text-amber-400 animate-pulse">{'\u2606'}</span>;
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onStarXlsx(row); }}
      className="p-1 text-sm text-neutral-600 hover:text-amber-400 transition-colors"
      title="Star (creates a NOVA entry)"
    >
      {'\u2606'}
    </button>
  );
}

export function DeliveryView() {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [dbEntries, setDbEntries] = useState<DbEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [drawerEntryId, setDrawerEntryId] = useState<number | null>(null);
  const [drawerIsNew, setDrawerIsNew] = useState(false);
  const [xlsxPrefill, setXlsxPrefill] = useState<Record<string, string> | null>(null);
  const [dashFilter, setDashFilter] = useState<Set<string>>(new Set());
  const [starringAccount, setStarringAccount] = useState<string | null>(null);
  const [starView, setStarView] = useState<'mine' | 'team'>('mine');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);

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
    const entry = dbEntries.find((e) => e.id === id);
    if (!entry) return;
    const newStarred = entry.is_starred ? 0 : 1;
    // Optimistic update
    setDbEntries((prev) => prev.map((e) => e.id === id ? { ...e, is_starred: newStarred } : e));
    try {
      const resp = await fetch(`/api/delivery/entries/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_starred: newStarred }),
      });
      const json = await resp.json();
      if (json.ok && json.data) {
        setDbEntries((prev) => prev.map((e) => e.id === id ? json.data : e));
      } else {
        setDbEntries((prev) => prev.map((e) => e.id === id ? { ...e, is_starred: entry.is_starred } : e));
      }
    } catch {
      setDbEntries((prev) => prev.map((e) => e.id === id ? { ...e, is_starred: entry.is_starred } : e));
    }
  };

  const handleToggleStarScope = async (id: number) => {
    const entry = dbEntries.find((e) => e.id === id);
    if (!entry || !entry.is_starred) return;
    const newScope = entry.star_scope === 'all' ? 'me' : 'all';
    setDbEntries((prev) => prev.map((e) => e.id === id ? { ...e, star_scope: newScope } : e));
    try {
      const resp = await fetch(`/api/delivery/entries/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ star_scope: newScope }),
      });
      const json = await resp.json();
      if (json.ok && json.data) {
        setDbEntries((prev) => prev.map((e) => e.id === id ? json.data : e));
      } else {
        setDbEntries((prev) => prev.map((e) => e.id === id ? { ...e, star_scope: entry.star_scope } : e));
      }
    } catch {
      setDbEntries((prev) => prev.map((e) => e.id === id ? { ...e, star_scope: entry.star_scope } : e));
    }
  };

  // Star an xlsx row: create a DB entry from it (already starred)
  const handleStarXlsxRow = async (row: DeliveryRow) => {
    const product = activeTab ?? '';
    if (!product || !row.account) return;
    // Prevent duplicates — if a DB entry already exists for this product+account, just star it
    const existing = dbEntries.find((e) => e.product === product && e.account === row.account);
    if (existing) {
      handleToggleStar(existing.id);
      return;
    }
    setStarringAccount(row.account);
    try {
      const body = {
        product,
        account: row.account,
        status: row.status || 'Not Started',
        onboarder: row.onboarder || null,
        order_date: row.orderDate || null,
        go_live_date: row.goLiveDate || null,
        predicted_delivery: row.predictedDelivery || null,
        training_date: null,
        branches: row.branches ?? null,
        mrr: row.mrr ?? null,
        incremental: row.incremental ?? null,
        licence_fee: row.licenceFee ?? null,
        notes: row.notes || null,
        is_starred: 1,
      };
      const createResp = await fetch('/api/delivery/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const createJson = await createResp.json();
      if (!createJson.ok || !createJson.data) {
        console.error('[DeliveryView] Create entry failed:', createJson);
        return;
      }
      setDbEntries((prev) => [...prev, createJson.data]);
    } catch (err) {
      console.error('[DeliveryView] Star xlsx row failed:', err);
    } finally {
      setStarringAccount(null);
    }
  };

  const handleSyncPull = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const resp = await fetch('/api/delivery/sync/pull', { method: 'POST' });
      const json = await resp.json();
      if (json.ok) {
        const d = json.data;
        setSyncResult({
          ok: true,
          message: `Pulled ${d.entriesCreated} new entries from ${d.sheetsProcessed} sheets (${d.entriesSkipped} already tracked)`,
        });
        refreshDbEntries();
      } else {
        setSyncResult({ ok: false, message: json.data?.errors?.join(', ') || json.error || 'Sync failed' });
      }
    } catch (err) {
      setSyncResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setSyncing(false);
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
  // Build a set of accounts that already have DB entries for the active tab — hide those xlsx rows
  const dbAccountsForTab = new Set(
    dbEntries.filter((e) => e.product === activeTab).map((e) => e.account)
  );
  const filteredRows = currentSheet
    ? currentSheet.rows.filter((r) => {
        // Hide xlsx row if a DB entry exists for same product+account
        if (dbAccountsForTab.has(r.account)) return false;
        if (statusFilter.size > 0 && !statusFilter.has((r.status || '').toLowerCase().trim())) return false;
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
  // Starred entries across all products — filtered by star view
  const allStarred = dbEntries.filter((e) => e.is_starred);
  const starredEntries = starView === 'team'
    ? allStarred.filter((e) => e.star_scope === 'all')
    : allStarred;

  const allProducts = [...summary.products, ...dbExtraProducts];
  const lastMod = new Date(summary.lastModified);

  // All unique statuses across all sheets + DB entries for dashboard filter
  const allStatuses = [
    ...new Set([
      ...Object.values(sheets).flatMap((s) => s.rows.map((r) => (r.status || '').toLowerCase().trim())),
      ...dbEntries.map((e) => (e.status || '').toLowerCase().trim()),
    ]),
  ].filter(Boolean).sort();

  // Compute KPI figures — either from summary (no filter) or recomputed from raw data (filtered)
  const kpi = (() => {
    if (dashFilter.size === 0) {
      return {
        totalCustomers: summary.totalCustomers + dbEntries.length,
        totalMrr: summary.totalMrr + dbEntries.reduce((sum, e) => sum + (e.mrr ?? 0), 0),
        totalWip: summary.totalWip,
        totalComplete: summary.totalComplete,
        novaEntries: dbEntries.length,
      };
    }
    const matchStatus = (s: string) => dashFilter.has((s || '').toLowerCase().trim());
    const allXlsxRows = Object.values(sheets).flatMap((s) => s.rows).filter((r) => matchStatus(r.status));
    const filteredDb = dbEntries.filter((e) => matchStatus(e.status));
    return {
      totalCustomers: allXlsxRows.length + filteredDb.length,
      totalMrr: allXlsxRows.reduce((s, r) => s + (r.mrr ?? 0), 0) + filteredDb.reduce((s, e) => s + (e.mrr ?? 0), 0),
      totalWip: allXlsxRows.filter((r) => {
        const l = (r.status || '').toLowerCase();
        return l.includes('wip') || l.includes('in progress');
      }).length,
      totalComplete: allXlsxRows.filter((r) => (r.status || '').toLowerCase().includes('complete')).length,
      novaEntries: filteredDb.length,
    };
  })();

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
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncPull}
            disabled={syncing}
            className="px-3 py-2 text-xs rounded bg-[#2f353d] text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 border border-[#3a424d] transition-colors disabled:opacity-50"
            title="Pull latest data from SharePoint"
          >
            {syncing ? 'Syncing...' : 'Sync from SharePoint'}
          </button>
          <button
            onClick={() => { setXlsxPrefill(null); setDrawerEntryId(null); setDrawerIsNew(true); }}
            className="px-4 py-2 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors"
          >
            + Add Entry
          </button>
        </div>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div className={`mb-4 px-4 py-2 rounded text-xs border ${
          syncResult.ok
            ? 'bg-green-950/50 border-green-900 text-green-400'
            : 'bg-red-950/50 border-red-900 text-red-400'
        }`}>
          {syncResult.message}
          <button onClick={() => setSyncResult(null)} className="ml-3 text-neutral-500 hover:text-neutral-300">x</button>
        </div>
      )}

      {/* Dashboard status filter */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span className="text-[10px] text-neutral-600 uppercase tracking-wider mr-1">Filter:</span>
        <button
          onClick={() => setDashFilter(new Set())}
          className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
            dashFilter.size === 0 ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
          }`}
        >
          All
        </button>
        {allStatuses.map((status) => {
          const isActive = dashFilter.has(status);
          return (
            <button
              key={`dash-${status}`}
              onClick={() => {
                setDashFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(status)) next.delete(status);
                  else next.add(status);
                  return next;
                });
              }}
              className={`px-2 py-0.5 text-[10px] rounded-full transition-colors flex items-center gap-1 ${
                isActive ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
              }`}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isActive ? '#272C33' : getStatusColor(status) }} />
              {status}
            </button>
          );
        })}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <KpiCard label="Total Customers" value={kpi.totalCustomers} />
        <KpiCard label="Total MRR" value={formatCurrency(kpi.totalMrr)} />
        <KpiCard label="WIP" value={kpi.totalWip} sub="Active deliveries" />
        <KpiCard label="Complete" value={kpi.totalComplete} />
        <KpiCard label="NOVA Entries" value={kpi.novaEntries} sub="Local additions" />
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
              onClick={() => { setActiveTab(product); setStatusFilter(new Set()); setSearch(''); }}
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
      {allStarred.length > 0 && (
        <div className="mb-5 border border-amber-400/30 rounded-lg bg-amber-400/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-amber-400 text-sm">{'\u2605'}</span>
            <span className="text-xs text-amber-400 uppercase tracking-widest font-semibold">
              Starred Deliveries
            </span>
            <span className="text-[10px] text-neutral-500">{starredEntries.length}</span>
            <div className="ml-auto flex items-center bg-[#272C33] rounded border border-[#3a424d]">
              <button
                onClick={() => setStarView('mine')}
                className={`px-2.5 py-1 text-[10px] rounded-l transition-colors ${
                  starView === 'mine' ? 'bg-amber-400/20 text-amber-400 font-semibold' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                My Stars
              </button>
              <button
                onClick={() => setStarView('team')}
                className={`px-2.5 py-1 text-[10px] rounded-r transition-colors ${
                  starView === 'team' ? 'bg-amber-400/20 text-amber-400 font-semibold' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                Team Stars
              </button>
            </div>
          </div>
          {starredEntries.length > 0 ? (
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
                    <div className="text-[10px] text-neutral-400 font-medium shrink-0 mr-1">{formatCurrency(entry.mrr)}</div>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleStarScope(entry.id); }}
                    className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors shrink-0 ${
                      entry.star_scope === 'all'
                        ? 'border-amber-400/40 bg-amber-400/10 text-amber-400'
                        : 'border-[#3a424d] text-neutral-600 hover:text-neutral-400'
                    }`}
                    title={entry.star_scope === 'all' ? 'Starred for all — click to make private' : 'Starred for me — click to share with team'}
                  >
                    {entry.star_scope === 'all' ? 'All' : 'Me'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-neutral-600">No team-starred deliveries</div>
          )}
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
              onClick={() => setStatusFilter(new Set())}
              className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                statusFilter.size === 0 ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
              }`}
            >
              All
            </button>
            {sheetStatuses.map((status) => {
              const isActive = statusFilter.has(status);
              return (
                <button
                  key={status}
                  onClick={() => {
                    setStatusFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(status)) next.delete(status);
                      else next.add(status);
                      return next;
                    });
                  }}
                  className={`px-2 py-0.5 text-[10px] rounded-full transition-colors flex items-center gap-1 ${
                    isActive ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                  }`}
                >
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isActive ? '#272C33' : getStatusColor(status) }} />
                  {status}
                </button>
              );
            })}
            <div className="ml-auto">
              <input
                type="text" placeholder="Search accounts..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[#2f353d] text-neutral-300 text-[11px] rounded px-2.5 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-48 placeholder:text-neutral-600"
              />
            </div>
          </div>

          {(statusFilter.size > 0 || search) && (
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
                  <th className="px-3 py-2 font-medium text-right">MRR</th>
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
                    <td className="px-3 py-2 text-neutral-200 text-right font-medium">{formatCurrency(entry.mrr)}</td>
                    <td className="px-3 py-2 text-neutral-500 max-w-[200px] truncate" title={entry.notes ?? ''}>{entry.notes ?? '-'}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] text-[#5ec1ca]">Edit</span>
                    </td>
                  </tr>
                ))}
                {/* xlsx rows */}
                {filteredRows.map((row, i) => (
                  <tr
                    key={`xlsx-${row.account}-${i}`}
                    className="hover:bg-[#363d47]/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setXlsxPrefill({
                        account: row.account,
                        status: row.status || 'Not Started',
                        onboarder: row.onboarder ?? '',
                        order_date: row.orderDate ?? '',
                        go_live_date: row.goLiveDate ?? '',
                        predicted_delivery: row.predictedDelivery ?? '',
                        branches: row.branches?.toString() ?? '',
                        mrr: row.mrr?.toString() ?? '',
                        incremental: row.incremental?.toString() ?? '',
                        licence_fee: row.licenceFee?.toString() ?? '',
                        notes: row.notes ?? '',
                      });
                      setDrawerEntryId(null);
                      setDrawerIsNew(true);
                    }}
                  >
                    <td className="px-3 py-2 text-center">
                      <XlsxStarButton
                        row={row}
                        activeTab={activeTab}
                        dbEntries={dbEntries}
                        starring={starringAccount === row.account}
                        onToggleStar={handleToggleStar}
                        onStarXlsx={handleStarXlsxRow}
                      />
                    </td>
                    <td className="px-3 py-2 text-neutral-200 font-medium whitespace-nowrap">{row.account}</td>
                    <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                    <td className="px-3 py-2 text-neutral-400">{row.onboarder ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.orderDate ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.goLiveDate ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.predictedDelivery ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400">-</td>
                    <td className="px-3 py-2 text-neutral-200 text-right font-medium">{formatCurrency(row.mrr)}</td>
                    <td className="px-3 py-2 text-neutral-500 max-w-[200px] truncate" title={row.notes ?? ''}>{row.notes ?? '-'}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] text-neutral-500">Edit</span>
                    </td>
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

      {/* Delivery Drawer */}
      {(drawerIsNew || drawerEntry) && (
        <DeliveryDrawer
          entry={drawerEntry}
          isNew={drawerIsNew}
          products={allProducts}
          defaultProduct={activeTab ?? ''}
          prefill={xlsxPrefill}
          onClose={() => { setDrawerEntryId(null); setDrawerIsNew(false); setXlsxPrefill(null); }}
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
