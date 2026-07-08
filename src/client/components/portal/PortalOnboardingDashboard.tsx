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

function StatTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs mt-0.5">{label}</div>
    </div>
  );
}

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Onboarding Dashboard</h1>
          <p className="text-sm text-gray-500">Open onboarding requests and their current stage.</p>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand outline-none"
        >
          Refresh
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Open requests" value={s?.total ?? 0} tone="bg-white border-gray-200 text-gray-900" />
        <StatTile label="Over 7 days" value={s?.over7 ?? 0} tone="bg-amber-50 border-amber-200 text-amber-900" />
        <StatTile label="Over 14 days" value={s?.over14 ?? 0} tone="bg-orange-50 border-orange-200 text-orange-900" />
        <StatTile label="Over 21 days (escalate)" value={s?.over21 ?? 0} tone="bg-red-50 border-red-200 text-red-900" />
        <StatTile label="Breaching SLA (30+)" value={s?.breach ?? 0} tone="bg-red-100 border-red-300 text-red-900" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" aria-live="polite">
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4 animate-pulse flex items-center gap-4">
                <div className="h-4 w-16 bg-gray-200 rounded" />
                <div className="h-4 flex-1 bg-gray-100 rounded" />
                <div className="h-5 w-20 bg-gray-200 rounded-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center text-red-600">{error}</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-600">
            <p className="text-lg mb-2">No open onboarding requests</p>
            <p className="text-sm">Nothing in progress for your account right now.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Onboarding requests">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th scope="col" className="text-left px-6 py-3 font-medium text-gray-600">Request</th>
                  <th scope="col" className="text-left px-6 py-3 font-medium text-gray-600">Stage</th>
                  <th scope="col" className="text-left px-6 py-3 font-medium text-gray-600">Owner</th>
                  <th scope="col" className="text-right px-6 py-3 font-medium text-gray-600">Days open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.rows.map(r => (
                  <tr key={r.key} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <div className="font-mono text-gray-500 text-xs">{r.key}</div>
                      <div className="text-gray-900 max-w-md truncate">{r.summary}</div>
                    </td>
                    <td className="px-6 py-3 text-gray-700">{r.stage}</td>
                    <td className="px-6 py-3 text-gray-600">{r.owner || 'Unassigned'}</td>
                    <td className="px-6 py-3 text-right">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium tabular-nums ${BUCKET_STYLE[r.ageBucket]}`}>
                        {r.ageDays}d
                      </span>
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
