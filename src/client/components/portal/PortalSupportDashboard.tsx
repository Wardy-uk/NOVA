import React, { useEffect, useState, useCallback, useMemo } from 'react';
import type { SupportDashboardResponse, SupportDashboardRow } from '../../../shared/portal-types.js';
import { portalPriorityOptions } from '../../../shared/portal-types.js';

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

type Filter = 'all' | 'stale' | 'sla' | 'critical' | 'escalation' | 'awaiting' | 'support' | 't3' | 'development';

interface KpiDef {
  key: Filter; label: string; value: (s: SupportDashboardResponse['summary']) => number;
  color: string; ring: string; icon: React.ReactNode;
}

// One palette shared by the tier/type cards and the "by ticket type" bar so a
// category is the same colour everywhere (e.g. Development is green in both).
const CATEGORY_COLORS: Record<string, string> = {
  development: '#16a34a',      // green
  'customer care': '#0d9488',  // teal
  'tier 2': '#0891b2',         // cyan
  'tier 3': '#6366f1',         // indigo
  escalations: '#db2777',      // pink
  production: '#64748b',       // slate
};
const FALLBACK_COLOR = '#94a3b8';
const colorForType = (t: string) => CATEGORY_COLORS[t.toLowerCase()] ?? FALLBACK_COLOR;

const icon = (d: string) => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const TOP_KPIS: KpiDef[] = [
  { key: 'all', label: 'Open tickets', value: s => s.total, color: '#334155', ring: 'ring-slate-300',
    icon: icon('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2') },
  { key: 'stale', label: 'No update 3+ days', value: s => s.stale, color: '#d97706', ring: 'ring-amber-400',
    icon: icon('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z') },
  { key: 'sla', label: 'Over SLA', value: s => s.overSla, color: '#e11d48', ring: 'ring-rose-400',
    icon: icon('M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z') },
  { key: 'critical', label: 'Business critical', value: s => s.businessCritical, color: '#dc2626', ring: 'ring-red-500',
    icon: icon('M13 10V3L4 14h7v7l9-11h-7z') },
  { key: 'escalation', label: 'Escalations', value: s => s.escalations, color: CATEGORY_COLORS.escalations, ring: 'ring-pink-400',
    icon: icon('M13 7h8m0 0v8m0-8l-8 8-4-4-6 6') },
];

const TIER_KPIS: KpiDef[] = [
  { key: 'support', label: 'Support (CC + Tier 2)', value: s => s.tierSupport, color: CATEGORY_COLORS['customer care'], ring: 'ring-teal-400',
    icon: icon('M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656M12 12h.01') },
  { key: 't3', label: 'Tier 3', value: s => s.tierT3, color: CATEGORY_COLORS['tier 3'], ring: 'ring-indigo-400',
    icon: icon('M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z') },
  { key: 'development', label: 'Development', value: s => s.tierDevelopment, color: CATEGORY_COLORS.development, ring: 'ring-green-400',
    icon: icon('M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4') },
  { key: 'awaiting', label: 'Awaiting sprint', value: s => s.awaitingSprint, color: '#7c3aed', ring: 'ring-violet-400',
    icon: icon('M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z') },
];

const ALL_KPIS = [...TOP_KPIS, ...TIER_KPIS];

const TYPE_COLORS = ['#0d9488', '#6366f1', '#f59e0b', '#ec4899', '#64748b', '#0ea5e9'];

export default function PortalSupportDashboard() {
  const [data, setData] = useState<SupportDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [priority, setPriority] = useState('all');
  const [expanded, setExpanded] = useState(false);

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

  const priorityOptions = useMemo(() => portalPriorityOptions((data?.rows ?? []).map(r => r.priority)), [data]);

  const rows = useMemo(() => {
    let all = data?.rows ?? [];
    if (priority !== 'all') all = all.filter(r => r.priority === priority);
    switch (filter) {
      case 'stale': return all.filter(r => r.stale);
      case 'sla': return all.filter(r => r.overSla);
      case 'critical': return all.filter(r => r.businessCritical);
      case 'escalation': return all.filter(r => r.escalation);
      case 'awaiting': return all.filter(r => r.sprintState === 'awaiting');
      case 'support': return all.filter(r => r.tierGroup === 'support');
      case 't3': return all.filter(r => r.tierGroup === 't3');
      case 'development': return all.filter(r => r.tierGroup === 'development');
      default: return all;
    }
  }, [data, filter, priority]);

  const typeBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.rows ?? []) m.set(r.type, (m.get(r.type) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const sprintBadge = (state: SupportDashboardRow['sprintState']) => {
    if (state === 'allocated') return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">In sprint</span>;
    if (state === 'awaiting') return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">Awaiting</span>;
    return <span className="text-xs text-gray-400">—</span>;
  };

  const total = s?.total || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.bcAccountNumber ? <>Account <span className="font-mono">{data.bcAccountNumber}</span> · </> : null}
            Open tickets across all projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={priority}
            onChange={e => { setPriority(e.target.value); if (e.target.value !== 'all') setExpanded(true); }}
            aria-label="Filter by priority"
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-600 focus-visible:ring-2 focus-visible:ring-brand outline-none"
          >
            <option value="all">All priorities</option>
            {priorityOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={load} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand outline-none">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* KPI cards — row 1: health (5), row 2: tier breakdown (4) */}
      {[
        { cards: TOP_KPIS, cls: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' },
        { cards: TIER_KPIS, cls: 'grid-cols-2 sm:grid-cols-4' },
      ].map((group, gi) => (
        <div key={gi} className={`grid gap-3 ${group.cls}`}>
          {group.cards.map(k => {
            const active = filter === k.key;
            return (
              <button
                key={k.key}
                onClick={() => { setFilter(k.key); setExpanded(true); }}
                aria-pressed={active}
                className={`group relative text-left bg-white rounded-2xl border border-gray-200 p-4 transition-all hover:shadow-md hover:-translate-y-0.5 outline-none focus-visible:ring-2 focus-visible:ring-brand ${active ? `ring-2 ${k.ring} shadow-sm` : ''}`}
              >
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gray-50 mb-3" style={{ color: k.color }}>{k.icon}</div>
                <div className="text-3xl font-bold tabular-nums" style={{ color: k.color }}>{loading ? '—' : k.value(s ?? {} as any)}</div>
                <div className="text-xs text-gray-500 mt-1">{k.label}</div>
              </button>
            );
          })}
        </div>
      ))}

      {/* Type distribution bar */}
      {!loading && total > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">By ticket type</span>
            <span className="text-xs text-gray-400">{total} open</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
            {typeBreakdown.map(([type, count]) => (
              <div key={type} style={{ width: `${(count / total) * 100}%`, background: colorForType(type) }}
                title={`${type}: ${count}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {typeBreakdown.map(([type, count]) => (
              <span key={type} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colorForType(type) }} />
                {type} <span className="text-gray-400 tabular-nums">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible ticket list */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" aria-live="polite">
        <button
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="text-sm font-semibold text-gray-700">
            Ticket list <span className="text-gray-400 font-normal">({rows.length}{filter !== 'all' ? ` ${ALL_KPIS.find(k => k.key === filter)?.label.toLowerCase()}` : ''})</span>
          </span>
          <svg className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expanded && (<div className="border-t border-gray-100">
        {filter !== 'all' && (
          <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-600">Filtered: <span className="font-medium">{ALL_KPIS.find(k => k.key === filter)?.label}</span> ({rows.length})</span>
            <button onClick={() => setFilter('all')} className="text-brand hover:underline text-xs">Clear</button>
          </div>
        )}
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="px-5 py-4 animate-pulse flex items-center gap-4">
                <div className="h-4 w-16 bg-gray-200 rounded" /><div className="h-4 flex-1 bg-gray-100 rounded" /><div className="h-5 w-20 bg-gray-200 rounded-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center text-rose-600">{error}</div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <p className="text-lg mb-1">No tickets</p>
            <p className="text-sm">{filter === 'all' && priority === 'all' ? 'No open tickets for your account.' : 'Nothing matches this filter.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500">
                  <th scope="col" className="text-left px-5 py-3 font-medium">Ticket</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium">Tier</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium">Priority</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium">Owner</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium">Sprint</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium">Age</th>
                  <th scope="col" className="text-right px-5 py-3 font-medium">Last update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.key} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-500 text-xs">{r.key}</span>
                        {r.businessCritical && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white font-semibold uppercase tracking-wide">Critical</span>}
                        {r.overSla && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold uppercase tracking-wide">SLA</span>}
                      </div>
                      <div className="text-gray-900 max-w-sm truncate">{r.summary}</div>
                    </td>
                    <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">{r.type}</span></td>
                    <td className="px-4 py-3 text-gray-600">{r.priority}</td>
                    <td className="px-4 py-3 text-gray-600">{r.owner || <span className="text-gray-400">Unassigned</span>}</td>
                    <td className="px-4 py-3 text-gray-700">{r.status}</td>
                    <td className="px-4 py-3">{sprintBadge(r.sprintState)}</td>
                    <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{r.ageDays}d</td>
                    <td className={`px-5 py-3 text-right tabular-nums ${r.stale ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>{r.daysSinceUpdate}d ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>)}
      </div>
    </div>
  );
}
