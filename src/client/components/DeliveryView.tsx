import { useState, useEffect } from 'react';

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

const STATUS_COLORS: Record<string, string> = {
  complete: '#22c55e',
  wip: '#f59e0b',
  'in progress': '#f59e0b',
  'not started': '#6b7280',
  dead: '#ef4444',
  'back to sales': '#ef4444',
  live: '#22c55e',
  'on hold': '#a855f7',
  pending: '#3b82f6',
};

function getStatusColor(status: string): string {
  const lower = status.toLowerCase().trim();
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

export function DeliveryView() {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch('/api/delivery')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setData(json.data);
          if (json.data.summary.products.length > 0 && !activeTab) {
            setActiveTab(json.data.summary.products[0]);
          }
        } else {
          setError(json.error ?? 'Failed to load delivery data');
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500">
        Loading delivery sheet...
      </div>
    );
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

  // Get unique statuses from current sheet for filter chips
  const sheetStatuses = currentSheet
    ? [...new Set(currentSheet.rows.map((r) => r.status.toLowerCase().trim()))].filter(Boolean).sort()
    : [];

  // Filter rows
  const filteredRows = currentSheet
    ? currentSheet.rows.filter((r) => {
        if (statusFilter && r.status.toLowerCase().trim() !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          return (
            r.account.toLowerCase().includes(q) ||
            (r.onboarder ?? '').toLowerCase().includes(q) ||
            (r.notes ?? '').toLowerCase().includes(q)
          );
        }
        return true;
      })
    : [];

  const lastMod = new Date(summary.lastModified);

  return (
    <div>
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard label="Products" value={summary.products.length} />
        <KpiCard label="Total Customers" value={summary.totalCustomers} />
        <KpiCard
          label="Total MRR"
          value={formatCurrency(summary.totalMrr)}
        />
        <KpiCard label="WIP" value={summary.totalWip} sub="Active deliveries" />
        <KpiCard label="Complete" value={summary.totalComplete} />
        <KpiCard label="Dead" value={summary.totalDead} />
      </div>

      {/* Last modified */}
      <div className="text-[10px] text-neutral-600 mb-4">
        Sheet last modified: {lastMod.toLocaleDateString('en-GB')} {lastMod.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </div>

      {/* Product tabs */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {summary.products.map((product) => {
          const sheet = sheets[product];
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
              {sheet && (
                <span className={`ml-1.5 ${isActive ? 'text-[#272C33]/70' : 'text-neutral-600'}`}>
                  {sheet.totals.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sheet content */}
      {currentSheet && activeTab && (
        <>
          {/* Sheet summary bar */}
          <div className="flex items-center gap-4 mb-3 text-[11px] text-neutral-500">
            <span>{currentSheet.totals.count} customers</span>
            <span>MRR: {formatCurrency(currentSheet.totals.mrr)}</span>
            <span className="text-amber-400">{currentSheet.totals.wip} WIP</span>
            <span className="text-green-400">{currentSheet.totals.complete} Complete</span>
          </div>

          {/* Filters row */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {/* Status filter chips */}
            <button
              onClick={() => setStatusFilter(null)}
              className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                statusFilter === null
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
              }`}
            >
              All
            </button>
            {sheetStatuses.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
                className={`px-2 py-0.5 text-[10px] rounded-full transition-colors flex items-center gap-1 ${
                  statusFilter === status
                    ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                    : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                }`}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: statusFilter === status ? '#272C33' : getStatusColor(status) }}
                />
                {status}
              </button>
            ))}

            {/* Search */}
            <div className="ml-auto">
              <input
                type="text"
                placeholder="Search accounts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[#2f353d] text-neutral-300 text-[11px] rounded px-2.5 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-48 placeholder:text-neutral-600"
              />
            </div>
          </div>

          {/* Showing count when filtered */}
          {(statusFilter || search) && (
            <div className="text-[10px] text-neutral-600 mb-2">
              Showing {filteredRows.length} of {currentSheet.rows.length}
            </div>
          )}

          {/* Table */}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-[#3a424d]">
                {filteredRows.map((row, i) => (
                  <tr
                    key={`${row.account}-${i}`}
                    className="hover:bg-[#363d47]/50 transition-colors"
                  >
                    <td className="px-3 py-2 text-neutral-200 font-medium whitespace-nowrap">
                      {row.account}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
                        style={{
                          backgroundColor: getStatusColor(row.status) + '20',
                          color: getStatusColor(row.status),
                        }}
                      >
                        <div
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: getStatusColor(row.status) }}
                        />
                        {row.status || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-400">{row.onboarder ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.orderDate ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.goLiveDate ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{row.predictedDelivery ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-400 text-right">{row.branches ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-200 text-right font-medium">
                      {formatCurrency(row.mrr)}
                    </td>
                    <td className="px-3 py-2 text-neutral-400 text-right">
                      {formatCurrency(row.incremental)}
                    </td>
                    <td className="px-3 py-2 text-neutral-500 max-w-[200px] truncate" title={row.notes ?? ''}>
                      {row.notes ?? '-'}
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-neutral-600">
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
