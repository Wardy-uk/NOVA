import React, { useEffect, useState, useCallback } from 'react';
import type { OnboardingDashboardResponse, OnboardingDashboardRow } from '../../../shared/portal-types.js';

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

const BUCKET_STYLE: Record<OnboardingDashboardRow['ageBucket'], string> = {
  ok: 'bg-gray-100 text-gray-700',
  over7: 'bg-amber-100 text-amber-800',
  over14: 'bg-orange-100 text-orange-800',
  over21: 'bg-red-100 text-red-800',
  breach: 'bg-red-600 text-white',
};

const icon = (d: string) => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

export default function PortalOnboardingDashboard() {
  const [data, setData] = useState<OnboardingDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await pf('/api/portal/dashboards/onboarding');
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
  const total = s?.total || 0;

  const cards = [
    { label: 'Open requests', value: s?.total ?? 0, accent: 'text-slate-700', bg: 'bg-gray-50',
      icon: icon('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z') },
    { label: 'Over 7 days', value: s?.over7 ?? 0, accent: 'text-amber-600', bg: 'bg-amber-50',
      icon: icon('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z') },
    { label: 'Over 14 days', value: s?.over14 ?? 0, accent: 'text-orange-600', bg: 'bg-orange-50',
      icon: icon('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z') },
    { label: 'Over 21 — escalate', value: s?.over21 ?? 0, accent: 'text-red-600', bg: 'bg-red-50',
      icon: icon('M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.19 16a2 2 0 001.74 3z') },
    { label: 'Breaching SLA (30+)', value: s?.breach ?? 0, accent: 'text-red-700', bg: 'bg-red-100',
      icon: icon('M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z') },
  ];

  // Age-band distribution (mutually exclusive bands for the bar)
  const bands = data ? (() => {
    const b = { ok: 0, over7: 0, over14: 0, over21: 0, breach: 0 };
    for (const r of data.rows) b[r.ageBucket]++;
    return b;
  })() : null;

  const bandDefs: Array<{ key: keyof NonNullable<typeof bands>; label: string; color: string }> = [
    { key: 'ok', label: '0–7 days', color: '#94a3b8' },
    { key: 'over7', label: '7–14', color: '#f59e0b' },
    { key: 'over14', label: '14–21', color: '#f97316' },
    { key: 'over21', label: '21–30', color: '#ef4444' },
    { key: 'breach', label: '30+', color: '#b91c1c' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Onboarding</h1>
          <p className="text-sm text-gray-500 mt-0.5">Open onboarding requests &amp; their current stage</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand outline-none">↻ Refresh</button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${c.bg} ${c.accent} mb-3`}>{c.icon}</div>
            <div className={`text-3xl font-bold tabular-nums ${c.accent}`}>{loading ? '—' : c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Age distribution */}
      {!loading && total > 0 && bands && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Age distribution</span>
            <span className="text-xs text-gray-400">{total} open</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
            {bandDefs.map(d => bands[d.key] > 0 && (
              <div key={d.key} style={{ width: `${(bands[d.key] / total) * 100}%`, background: d.color }} title={`${d.label}: ${bands[d.key]}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {bandDefs.map(d => (
              <span key={d.key} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                {d.label} <span className="text-gray-400 tabular-nums">{bands[d.key]}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" aria-live="polite">
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-5 py-4 animate-pulse flex items-center gap-4">
                <div className="h-4 w-16 bg-gray-200 rounded" /><div className="h-4 flex-1 bg-gray-100 rounded" /><div className="h-5 w-16 bg-gray-200 rounded-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center text-rose-600">{error}</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <p className="text-lg mb-1">No open onboarding requests</p>
            <p className="text-sm">Nothing in progress for your account right now.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500">
                  <th scope="col" className="text-left px-5 py-3 font-medium">Request</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium">Stage</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium">Owner</th>
                  <th scope="col" className="text-right px-5 py-3 font-medium">Days open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.rows.map(r => (
                  <tr key={r.key} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-mono text-gray-500 text-xs">{r.key}</div>
                      <div className="text-gray-900 max-w-md truncate">{r.summary}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.stage}</td>
                    <td className="px-4 py-3 text-gray-600">{r.owner || <span className="text-gray-400">Unassigned</span>}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium tabular-nums ${BUCKET_STYLE[r.ageBucket]}`}>{r.ageDays}d</span>
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
