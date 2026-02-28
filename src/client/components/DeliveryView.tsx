import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { DeliveryDrawer } from './DeliveryDrawer.js';
import { DeliveryKanban } from './DeliveryKanban.js';

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

function getMonthRange(offset: number): [string, string] {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return [first.toISOString().split('T')[0], last.toISOString().split('T')[0]];
}

function isInDateRange(dateStr: string | null, from: string, to: string): boolean {
  if (!dateStr) return false;
  return dateStr >= from && dateStr <= to;
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

export function DeliveryView({ canWrite = false }: { canWrite?: boolean }) {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [dbEntries, setDbEntries] = useState<DbEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [excludeStatuses, setExcludeStatuses] = useState<Set<string>>(new Set(['complete']));
  const [search, setSearch] = useState('');
  const [drawerEntryId, setDrawerEntryId] = useState<number | null>(null);
  const [drawerIsNew, setDrawerIsNew] = useState(false);
  const [xlsxPrefill, setXlsxPrefill] = useState<Record<string, string> | null>(null);
  const [starringAccount, setStarringAccount] = useState<string | null>(null);
  const [starView, setStarView] = useState<'mine' | 'team'>('team');
  const [syncing, setSyncing] = useState<'pull' | 'push' | false>(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingCell, setEditingCell] = useState<{ id: number; column: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [novaOnly, setNovaOnly] = useState(false);
  const [myOnly, setMyOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [dateFilter, setDateFilter] = useState<'all' | 'this-month' | 'next-month' | 'custom'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const auth = useAuth();

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
        }
        if (dbJson.ok) {
          setDbEntries(dbJson.data);
          // Set active tab from DB entries when xlsx isn't available
          if (!xlsxJson.ok && dbJson.data?.length > 0 && !activeTab) {
            const products = [...new Set(dbJson.data.map((e: DbEntry) => e.product))];
            if (products.length > 0) setActiveTab(products[0]);
          }
        }
        // Only show error if both xlsx AND DB entries failed
        if (!xlsxJson.ok && (!dbJson.ok || dbJson.data?.length === 0)) {
          setError(xlsxJson.error ?? 'Failed to load delivery data');
        }
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
    setSyncing('pull');
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

  const handleSyncPush = async () => {
    setSyncing('push');
    setSyncResult(null);
    try {
      const resp = await fetch('/api/delivery/sync/push', { method: 'POST' });
      const json = await resp.json();
      if (json.ok) {
        const d = json.data;
        setSyncResult({
          ok: true,
          message: `Pushed ${d.entriesUpdated} entries across ${d.sheetsProcessed} sheets to SharePoint`,
        });
      } else {
        setSyncResult({ ok: false, message: json.data?.errors?.join(', ') || json.error || 'Push failed' });
      }
    } catch (err) {
      setSyncResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleImportXlsx = async () => {
    setSyncing('pull');
    setSyncResult(null);
    try {
      const resp = await fetch('/api/delivery/entries/import-xlsx', { method: 'POST' });
      const json = await resp.json();
      if (json.ok) {
        const { created, skipped, sheetsProcessed } = json.data;
        setSyncResult({
          ok: true,
          message: `Imported ${created} entries from ${sheetsProcessed} sheets (${skipped} already in DB). Onboarding IDs auto-assigned.`,
        });
        refreshDbEntries();
      } else {
        setSyncResult({ ok: false, message: json.error || 'Import failed' });
      }
    } catch (err) {
      setSyncResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleKanbanStatusChange = async (id: number, newStatus: string) => {
    const entry = dbEntries.find(e => e.id === id);
    if (!entry) return;
    setDbEntries(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e));
    try {
      const resp = await fetch(`/api/delivery/entries/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await resp.json();
      if (json.ok && json.data) {
        setDbEntries(prev => prev.map(e => e.id === id ? json.data : e));
      } else {
        setDbEntries(prev => prev.map(e => e.id === id ? entry : e));
      }
    } catch {
      setDbEntries(prev => prev.map(e => e.id === id ? entry : e));
    }
  };

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDir('asc');
    }
  };

  const sortIndicator = (col: string) =>
    sortColumn === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  const sortFn = <T,>(items: T[], getter: (item: T, col: string) => string | number | null): T[] => {
    if (!sortColumn) return items;
    return [...items].sort((a, b) => {
      const av = getter(a, sortColumn);
      const bv = getter(b, sortColumn);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  };

  const dbColumnGetter = (entry: DbEntry, col: string): string | number | null => {
    switch (col) {
      case 'account': return entry.account;
      case 'status': return entry.status;
      case 'onboarder': return entry.onboarder;
      case 'order_date': return entry.order_date;
      case 'go_live': return entry.go_live_date;
      case 'predicted': return entry.predicted_delivery;
      case 'training': return entry.training_date;
      case 'mrr': return entry.mrr;
      case 'notes': return entry.notes;
      case 'id': return entry.onboarding_id;
      default: return null;
    }
  };

  const xlsxColumnGetter = (row: DeliveryRow, col: string): string | number | null => {
    switch (col) {
      case 'account': return row.account;
      case 'status': return row.status;
      case 'onboarder': return row.onboarder;
      case 'order_date': return row.orderDate;
      case 'go_live': return row.goLiveDate;
      case 'predicted': return row.predictedDelivery;
      case 'mrr': return row.mrr;
      case 'notes': return row.notes;
      default: return null;
    }
  };

  const startEdit = (id: number, column: string, currentValue: string) => {
    setEditingCell({ id, column });
    setEditValue(currentValue);
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { id, column } = editingCell;
    const entry = dbEntries.find((e) => e.id === id);
    if (!entry) { setEditingCell(null); return; }

    // Map column name to DB field
    const fieldMap: Record<string, string> = {
      account: 'account', status: 'status', onboarder: 'onboarder',
      order_date: 'order_date', go_live: 'go_live_date', predicted: 'predicted_delivery',
      training: 'training_date', mrr: 'mrr', notes: 'notes',
    };
    const dbField = fieldMap[column];
    if (!dbField) { setEditingCell(null); return; }

    const val = column === 'mrr' ? (editValue ? parseFloat(editValue) : null) : (editValue || null);

    // Optimistic update
    setDbEntries((prev) => prev.map((e) => e.id === id ? { ...e, [dbField]: val } : e));
    setEditingCell(null);

    try {
      const resp = await fetch(`/api/delivery/entries/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [dbField]: val }),
      });
      const json = await resp.json();
      if (json.ok && json.data) {
        setDbEntries((prev) => prev.map((e) => e.id === id ? json.data : e));
      }
    } catch {
      // Revert on failure
      setDbEntries((prev) => prev.map((e) => e.id === id ? entry : e));
    }
  };

  const cancelEdit = () => setEditingCell(null);

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
  // When no local xlsx is available but DB entries exist, build a fallback summary from DB
  const summary: Summary = data?.summary ?? {
    totalCustomers: dbEntries.length,
    totalMrr: dbEntries.reduce((s, e) => s + (e.mrr ?? 0), 0),
    totalWip: dbEntries.filter((e) => !['complete', 'dead', 'back to sales'].includes((e.status || '').toLowerCase())).length,
    totalComplete: dbEntries.filter((e) => (e.status || '').toLowerCase() === 'complete').length,
    totalDead: dbEntries.filter((e) => (e.status || '').toLowerCase() === 'dead').length,
    products: [...new Set(dbEntries.map((e) => e.product))],
    lastModified: dbEntries.length > 0 ? dbEntries[0].updated_at : '',
  };
  const sheets = data?.sheets ?? {};
  const currentSheet = activeTab ? sheets[activeTab] : null;
  // Build a set of accounts that already have DB entries for the active tab — hide those xlsx rows
  const dbAccountsForTab = new Set(
    dbEntries.filter((e) => e.product === activeTab).map((e) => e.account)
  );
  const myName = (auth.user?.display_name || auth.user?.username || '').toLowerCase();
  const effectiveDateRange: [string, string] | null = (() => {
    if (dateFilter === 'all') return null;
    if (dateFilter === 'this-month') return getMonthRange(0);
    if (dateFilter === 'next-month') return getMonthRange(1);
    return dateFrom && dateTo ? [dateFrom, dateTo] : null;
  })();
  const filteredRows = currentSheet
    ? currentSheet.rows.filter((r) => {
        // Hide xlsx row if a DB entry exists for same product+account
        if (dbAccountsForTab.has(r.account)) return false;
        // Hide all xlsx rows when NOVA-only filter is active
        if (novaOnly) return false;
        const rowStatus = (r.status || '').toLowerCase().trim();
        if (excludeStatuses.has(rowStatus)) return false;
        if (myOnly && myName && !(r.onboarder ?? '').toLowerCase().includes(myName)) return false;
        if (effectiveDateRange && !isInDateRange(r.goLiveDate, effectiveDateRange[0], effectiveDateRange[1]) && !isInDateRange(r.predictedDelivery, effectiveDateRange[0], effectiveDateRange[1])) return false;
        if (search) {
          const q = search.toLowerCase();
          return r.account.toLowerCase().includes(q) || (r.onboarder ?? '').toLowerCase().includes(q) || (r.notes ?? '').toLowerCase().includes(q);
        }
        return true;
      })
    : [];

  // DB entries for the active product tab
  const dbForTab = activeTab ? dbEntries.filter((e) => {
    if (e.product !== activeTab) return false;
    const s = (e.status || '').toLowerCase().trim();
    if (excludeStatuses.size > 0 && excludeStatuses.has(s)) return false;
    if (myOnly && myName && !(e.onboarder ?? '').toLowerCase().includes(myName)) return false;
    if (effectiveDateRange && !isInDateRange(e.go_live_date, effectiveDateRange[0], effectiveDateRange[1]) && !isInDateRange(e.predicted_delivery, effectiveDateRange[0], effectiveDateRange[1])) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.account.toLowerCase().includes(q) && !(e.onboarder ?? '').toLowerCase().includes(q) && !(e.notes ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  }) : [];
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

  // Compute KPI figures — respects excludeStatuses
  const kpi = (() => {
    const isExcluded = (s: string) => excludeStatuses.has((s || '').toLowerCase().trim());
    const allXlsxRows = Object.values(sheets).flatMap((s) => s.rows).filter((r) => !isExcluded(r.status));
    const filteredDb = dbEntries.filter((e) => !isExcluded(e.status));
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
          {summary.lastModified && (
            <div className="text-[10px] text-neutral-600 mt-0.5">
              {data ? 'xlsx' : 'data'} last modified: {lastMod.toLocaleDateString('en-GB')} {lastMod.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <>
              <button
                onClick={handleSyncPull}
                disabled={!!syncing}
                className="px-3 py-2 text-xs rounded bg-[#2f353d] text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 border border-[#3a424d] transition-colors disabled:opacity-50"
                title="Pull latest data from SharePoint"
              >
                {syncing === 'pull' ? 'Pulling...' : 'Pull from SP'}
              </button>
              <button
                onClick={handleSyncPush}
                disabled={!!syncing}
                className="px-3 py-2 text-xs rounded bg-[#2f353d] text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 border border-[#3a424d] transition-colors disabled:opacity-50"
                title="Push local DB entries to SharePoint"
              >
                {syncing === 'push' ? 'Pushing...' : 'Push to SP'}
              </button>
              <button
                onClick={handleImportXlsx}
                disabled={!!syncing}
                className="px-3 py-2 text-xs rounded bg-[#2f353d] text-amber-400 hover:bg-[#363d47] hover:text-amber-300 border border-amber-500/30 transition-colors disabled:opacity-50"
                title="Import all xlsx rows to DB with auto-generated onboarding IDs"
              >
                {syncing === 'pull' ? 'Importing...' : 'Import xlsx to DB'}
              </button>
              <button
                onClick={() => { setXlsxPrefill(null); setDrawerEntryId(null); setDrawerIsNew(true); }}
                className="px-4 py-2 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors"
              >
                + Add Entry
              </button>
            </>
          )}
          <div className="flex items-center bg-[#272C33] rounded border border-[#3a424d]">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-2 text-xs rounded-l transition-colors ${
                viewMode === 'table' ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-2 text-xs rounded-r transition-colors ${
                viewMode === 'kanban' ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Kanban
            </button>
          </div>
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

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <KpiCard label="Total Customers" value={kpi.totalCustomers} />
        <KpiCard label="Total MRR" value={formatCurrency(kpi.totalMrr)} />
        <KpiCard label="WIP" value={kpi.totalWip} sub="Active deliveries" />
        <KpiCard label="Complete" value={kpi.totalComplete} />
        <KpiCard label="NOVA Entries" value={kpi.novaEntries} sub="Local additions" />
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-2">
        {/* Brand filter */}
        <div>
          <div className="text-[10px] text-neutral-600 uppercase tracking-wider mb-1.5">Brand Filter</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {allProducts.map((product) => {
              const sheet = sheets[product];
              const dbCount = dbEntries.filter((e) => e.product === product).length;
              const isActive = activeTab === product;
              return (
                <button
                  key={product}
                  onClick={() => { setActiveTab(product); setSearch(''); }}
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
        </div>
        {/* Status filter */}
        <div>
          <div className="text-[10px] text-neutral-600 uppercase tracking-wider mb-1.5">Status Filter</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setExcludeStatuses(new Set())}
              className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                excludeStatuses.size === 0 ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
              }`}
            >
              All
            </button>
            {allStatuses.map((status) => {
              const isHidden = excludeStatuses.has(status);
              return (
                <button
                  key={`filter-${status}`}
                  onClick={() => {
                    setExcludeStatuses((prev) => {
                      const next = new Set(prev);
                      if (next.has(status)) next.delete(status);
                      else next.add(status);
                      return next;
                    });
                  }}
                  className={`px-2 py-0.5 text-[10px] rounded-full transition-colors flex items-center gap-1 ${
                    isHidden ? 'bg-[#2f353d] text-neutral-600 line-through' : 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  }`}
                >
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isHidden ? '#4b5563' : getStatusColor(status) }} />
                  {status}
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setMyOnly(!myOnly)}
                className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                  myOnly
                    ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                    : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                }`}
                title="Show only deliveries assigned to me"
              >
                My Deliveries
              </button>
              <button
                onClick={() => setNovaOnly(!novaOnly)}
                className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                  novaOnly
                    ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                    : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                }`}
                title="Show only NOVA database entries (hide spreadsheet rows)"
              >
                NOVA Only
              </button>
              <input
                type="text" placeholder="Search accounts..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[#2f353d] text-neutral-300 text-[11px] rounded px-2.5 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-48 placeholder:text-neutral-600"
              />
            </div>
          </div>
        </div>
        {/* Date filter */}
        <div>
          <div className="text-[10px] text-neutral-600 uppercase tracking-wider mb-1.5">Date Filter</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['all', 'this-month', 'next-month', 'custom'] as const).map((mode) => {
              const label = mode === 'all' ? 'All Dates' : mode === 'this-month' ? 'This Month' : mode === 'next-month' ? 'Next Month' : 'Custom';
              return (
                <button
                  key={mode}
                  onClick={() => setDateFilter(mode)}
                  className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                    dateFilter === mode
                      ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                      : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
            {dateFilter === 'custom' && (
              <div className="flex items-center gap-1.5 ml-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-[#2f353d] text-neutral-300 text-[10px] rounded px-2 py-0.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors"
                />
                <span className="text-neutral-600 text-[10px]">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-[#2f353d] text-neutral-300 text-[10px] rounded px-2 py-0.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors"
                />
              </div>
            )}
            {effectiveDateRange && (
              <span className="text-[10px] text-neutral-500 ml-2">
                {effectiveDateRange[0]} &mdash; {effectiveDateRange[1]}
              </span>
            )}
          </div>
        </div>
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
                      {entry.onboarding_id && (
                        <span className="text-[9px] text-[#5ec1ca] font-mono">{entry.onboarding_id}</span>
                      )}
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
      {activeTab && viewMode === 'kanban' && (
        <DeliveryKanban
          entries={dbForTab}
          onStatusChange={handleKanbanStatusChange}
          onCardClick={(id) => { setDrawerEntryId(id); setDrawerIsNew(false); }}
          onToggleStar={handleToggleStar}
          canWrite={canWrite}
        />
      )}

      {activeTab && viewMode === 'table' && (
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

          {(excludeStatuses.size > 0 || search) && (
            <div className="text-[10px] text-neutral-600 mb-2">
              Showing {filteredRows.length + dbForTab.length} of {(currentSheet?.rows.length ?? 0) + dbEntries.filter((e) => e.product === activeTab).length}
            </div>
          )}

          {/* Table — xlsx rows + DB rows merged */}
          <div className="overflow-x-auto rounded-lg border border-[#3a424d]">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-[#2f353d] text-neutral-500 uppercase tracking-wider text-left">
                  <th className="px-3 py-2 font-medium w-8"></th>
                  <th className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('id')}>ID{sortIndicator('id')}</th>
                  <th className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('account')}>Account{sortIndicator('account')}</th>
                  <th className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('status')}>Status{sortIndicator('status')}</th>
                  <th className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('onboarder')}>Onboarder{sortIndicator('onboarder')}</th>
                  <th className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('order_date')}>Order Date{sortIndicator('order_date')}</th>
                  <th className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('go_live')}>Go Live{sortIndicator('go_live')}</th>
                  <th className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('predicted')}>Predicted{sortIndicator('predicted')}</th>
                  <th className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('training')}>Training{sortIndicator('training')}</th>
                  <th className="px-3 py-2 font-medium text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('mrr')}>MRR{sortIndicator('mrr')}</th>
                  <th className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 select-none" onClick={() => handleSort('notes')}>Notes{sortIndicator('notes')}</th>
                  <th className="px-3 py-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#3a424d]">
                {/* DB entries for this tab (shown first, highlighted, sorted) */}
                {sortFn(dbForTab, dbColumnGetter).map((entry) => {
                  const isEditing = (col: string) => editingCell?.id === entry.id && editingCell?.column === col;
                  const editableCell = (col: string, value: string | null, type: 'text' | 'date' | 'number' = 'text') => {
                    if (isEditing(col)) {
                      return col === 'status' ? (
                        <select
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
                          className="bg-[#272C33] text-neutral-200 text-[11px] rounded px-1 py-0.5 border border-[#5ec1ca] outline-none w-full"
                          autoFocus
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <input
                          type={type}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          className="bg-[#272C33] text-neutral-200 text-[11px] rounded px-1 py-0.5 border border-[#5ec1ca] outline-none w-full"
                          autoFocus
                        />
                      );
                    }
                    return (
                      <span
                        className="cursor-text hover:bg-[#363d47] rounded px-0.5 -mx-0.5"
                        onClick={(e) => { e.stopPropagation(); startEdit(entry.id, col, value ?? ''); }}
                      >
                        {col === 'status' ? <StatusBadge status={value ?? ''} /> : (col === 'mrr' ? formatCurrency(entry.mrr) : (value ?? '-'))}
                      </span>
                    );
                  };

                  return (
                    <tr
                      key={`db-${entry.id}`}
                      className="hover:bg-[#363d47]/50 transition-colors bg-[#5ec1ca]/5 cursor-pointer"
                      onClick={() => { if (!editingCell) { setDrawerEntryId(entry.id); setDrawerIsNew(false); } }}
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
                      <td className="px-3 py-2 text-[10px] text-[#5ec1ca] font-mono whitespace-nowrap">{entry.onboarding_id ?? '-'}</td>
                      <td className="px-3 py-2 text-neutral-200 font-medium whitespace-nowrap">
                        {editableCell('account', entry.account)}
                        <span className="ml-1.5 text-[9px] text-[#5ec1ca] uppercase">nova</span>
                      </td>
                      <td className="px-3 py-2">{editableCell('status', entry.status)}</td>
                      <td className="px-3 py-2 text-neutral-400">{editableCell('onboarder', entry.onboarder)}</td>
                      <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{editableCell('order_date', entry.order_date, 'date')}</td>
                      <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{editableCell('go_live', entry.go_live_date, 'date')}</td>
                      <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{editableCell('predicted', entry.predicted_delivery, 'date')}</td>
                      <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{editableCell('training', entry.training_date, 'date')}</td>
                      <td className="px-3 py-2 text-neutral-200 text-right font-medium">{editableCell('mrr', entry.mrr?.toString() ?? '', 'number')}</td>
                      <td className="px-3 py-2 text-neutral-500 max-w-[200px] truncate" title={entry.notes ?? ''}>{editableCell('notes', entry.notes)}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] text-[#5ec1ca]">Edit</span>
                      </td>
                    </tr>
                  );
                })}
                {/* xlsx rows (sorted) */}
                {sortFn(filteredRows, xlsxColumnGetter).map((row, i) => (
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
                    <td className="px-3 py-2 text-[10px] text-neutral-600 font-mono">-</td>
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
                    <td colSpan={12} className="px-3 py-8 text-center text-neutral-600">
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
          onSaved={(product) => {
            refreshDbEntries();
            if (product) setActiveTab(product);
          }}
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
