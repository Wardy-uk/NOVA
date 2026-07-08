import React, { useEffect, useState, useCallback, useMemo } from 'react';
import type { SupportDashboardResponse, SupportDashboardRow } from '../../../shared/portal-types.js';

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

function StatTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs mt-0.5">{label}</div>
    </div>
  );
}

type Filter = 'all' | 'stale' | 'sla' | 'critical' | 'awaiting';

export default function PortalSupportDashboard() {
  const [data, setData] = useState<SupportDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await pf('/api/portal/dashboards/support');
      const body = await res.json();
      if (body.ok) setData(body.data);
      else setError(body.error || 'Failed to load');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = data?.summary;

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    switch (filter) {
      case 'stale': return all.filter(r => r.stale);
      case 'sla': return all.filter(r => r.overSla);
      case 'critical': return all.filter(r => r.businessCritical);
      case 'awaiting': return all.filter(r => r.sprintState === 'awaiting');
      default: return all;
    }
  }, [data, filter]);

  const sprintBadge = (state: SupportDashboardRow['sprintState']) => {
    if (state === 'allocated') return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">In sprint</span>;
    if (state === 'awaiting') return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">Awaiting sprint</span>;
    return <span className="text-xs text-gray-400">—</span>;
  };

  const tiles: Array<{ key: Filter; label: string; value: number; tone: string }> = [
    { key: 'all', label: 'Open tickets', value: s?.total ?? 0, tone: 'bg-white border-gray-200 text-gray-900' },
    { key: 'stale', label: 'No update 3+ days', value: s?.stale ?? 0, tone: 'bg-amber-50 border-amber-200 text-amber-900' },
    { key: 'sla', label: 'Over SLA', value: s?.overSla ?? 0, tone: 'bg-red-50 border-red-200 text-red-900' },
    { key: 'critical', label: 'Business critical', value: s?.businessCritical ?? 0, tone: 'bg-red-100 border-red-300 text-red-900' },
    { key: 'awaiting', label: 'Awaiting sprint', value: s?.awaitingSprint ?? 0, tone: 'bg-purple-50 border-purple-200 text-purple-900' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Support Ticket Dashboard</h1>
          <p className="text-sm text-gray-500">Open tickets for your account. Click a tile to filter.</p>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand outline-none"
        >
          Refresh
        </button>
      </div>

      {/* Summary tiles (clickable filters) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            aria-pressed={filter === t.key}
            className={`text-left transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xl ${filter === t.key ? 'ring-2 ring-brand' : ''}`}
          >
            <StatTile label={t.label} value={t.value} tone={t.tone} />
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" aria-live="polite">
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="px-6 py-4 animate-pulse flex items-center gap-4">
                <div className="h-4 w-16 bg-gray-200 rounded" />
                <div className="h-4 flex-1 bg-gray-100 rounded" />
                <div className="h-5 w-20 bg-gray-200 rounded-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center text-red-600">{error}</div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-600">
            <p className="text-lg mb-2">No tickets</p>
            <p className="text-sm">{filter === 'all' ? 'No open tickets for your account.' : 'No tickets match this filter.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Support tickets">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">Ticket</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">Owner</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">Sprint</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-gray-600">Age</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-gray-600">Last update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.key} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-500 text-xs">{r.key}</span>
                        {r.businessCritical && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white font-semibold uppercase tracking-wide">Critical</span>
                        )}
                        {r.overSla && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold uppercase tracking-wide">SLA</span>
                        )}
                      </div>
                      <div className="text-gray-900 max-w-sm truncate">{r.summary}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">{r.type}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.owner || 'Unassigned'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.status}</td>
                    <td className="px-4 py-3">{sprintBadge(r.sprintState)}</td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{r.ageDays}d</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${r.stale ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>
                      {r.daysSinceUpdate}d ago
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
