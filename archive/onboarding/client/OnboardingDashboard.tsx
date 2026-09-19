import { useState, useEffect, useCallback } from 'react';

interface DashboardData {
  totalActive: number;
  totalComplete: number;
  totalDead: number;
  totalMrr: number;
  totalEntries: number;
  milestones: { total: number; pending: number; in_progress: number; complete: number; overdue: number };
  byStatus: Record<string, number>;
  productBreakdown: Array<{ name: string; active: number; complete: number; mrr: number }>;
  onboarderBreakdown: Array<{ name: string; active: number; complete: number; overdue: number }>;
  recentRuns: Array<{ ref: string; status: string; created_count: number; parent_key: string | null; created_at: string }>;
}

function formatCurrency(v: number): string {
  return `\u00A3${v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-3 flex flex-col">
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold truncate" style={{ color: color ?? '#f5f5f5' }}>{value}</div>
      {sub && <div className="text-[10px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export function OnboardingDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    fetch('/api/delivery/onboarding-dashboard')
      .then(r => r.json())
      .then(json => {
        if (json.ok) setData(json.data);
        else setError(json.error ?? 'Failed to load dashboard');
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Listen for manual refresh
  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener('nova-refresh', handler);
    return () => window.removeEventListener('nova-refresh', handler);
  }, [loadData]);

  if (loading) {
    return <div className="text-sm text-neutral-500 py-8 text-center">Loading dashboard...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-400 py-8 text-center">{error}</div>;
  }
  if (!data) return null;

  const msTotal = data.milestones.total || 1;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <KpiCard label="Active Deliveries" value={data.totalActive} color="#5ec1ca" />
        <KpiCard label="Completed" value={data.totalComplete} sub={`of ${data.totalEntries} total`} color="#22c55e" />
        <KpiCard label="Active MRR" value={formatCurrency(data.totalMrr)} color="#5ec1ca" />
        <KpiCard label="Milestones Overdue" value={data.milestones.overdue} color={data.milestones.overdue > 0 ? '#ef4444' : '#22c55e'} />
        <KpiCard label="Milestones In Progress" value={data.milestones.in_progress} sub={`${data.milestones.pending} pending`} color="#f59e0b" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Milestone Health */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Milestone Health</h3>
          <div className="space-y-2">
            {[
              { label: 'Complete', count: data.milestones.complete, color: '#22c55e' },
              { label: 'In Progress', count: data.milestones.in_progress, color: '#f59e0b' },
              { label: 'Pending', count: data.milestones.pending, color: '#6b7280' },
              { label: 'Overdue', count: data.milestones.overdue, color: '#ef4444' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-xs w-20" style={{ color: row.color }}>{row.label}</span>
                <div className="flex-1 bg-[#272C33] rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(row.count / msTotal) * 100}%`, backgroundColor: row.color }}
                  />
                </div>
                <span className="text-xs text-neutral-400 w-8 text-right">{row.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">By Status</h3>
          <div className="space-y-1.5">
            {Object.entries(data.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-xs">
                  <span className="text-neutral-300">{status}</span>
                  <span className="text-neutral-500 font-mono">{count}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Product Breakdown */}
      {data.productBreakdown.length > 0 && (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">By Product</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500 text-left border-b border-[#3a424d]">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium text-right">Active</th>
                  <th className="pb-2 font-medium text-right">Complete</th>
                  <th className="pb-2 font-medium text-right">Active MRR</th>
                </tr>
              </thead>
              <tbody>
                {data.productBreakdown.map(p => (
                  <tr key={p.name} className="border-b border-[#3a424d]/50 hover:bg-[#363d47]/50">
                    <td className="py-1.5 text-neutral-200 font-medium">{p.name}</td>
                    <td className="py-1.5 text-right text-[#5ec1ca] font-mono">{p.active}</td>
                    <td className="py-1.5 text-right text-neutral-400 font-mono">{p.complete}</td>
                    <td className="py-1.5 text-right text-neutral-300 font-mono">{p.mrr > 0 ? formatCurrency(p.mrr) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manager / Onboarder Breakdown */}
      {data.onboarderBreakdown.length > 0 && (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">By Manager</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500 text-left border-b border-[#3a424d]">
                  <th className="pb-2 font-medium">Manager</th>
                  <th className="pb-2 font-medium text-right">Active</th>
                  <th className="pb-2 font-medium text-right">Overdue</th>
                  <th className="pb-2 font-medium text-right">Complete</th>
                  <th className="pb-2 font-medium text-right">Load</th>
                </tr>
              </thead>
              <tbody>
                {data.onboarderBreakdown.map(m => (
                  <tr key={m.name} className="border-b border-[#3a424d]/50 hover:bg-[#363d47]/50">
                    <td className="py-1.5 text-neutral-200 font-medium">{m.name}</td>
                    <td className="py-1.5 text-right text-[#5ec1ca] font-mono">{m.active}</td>
                    <td className="py-1.5 text-right font-mono" style={{ color: m.overdue > 0 ? '#ef4444' : '#6b7280' }}>{m.overdue}</td>
                    <td className="py-1.5 text-right text-neutral-400 font-mono">{m.complete}</td>
                    <td className="py-1.5 text-right w-24">
                      <div className="bg-[#272C33] rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min((m.active / Math.max(...data.onboarderBreakdown.map(o => o.active), 1)) * 100, 100)}%`,
                            backgroundColor: m.overdue > 0 ? '#ef4444' : '#5ec1ca',
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Onboarding Runs */}
      {data.recentRuns.length > 0 && (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Recent Ticket Runs</h3>
          <div className="space-y-1.5">
            {data.recentRuns.map((r, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  r.status === 'success' ? 'bg-green-500/20 text-green-400'
                    : r.status === 'error' ? 'bg-red-500/20 text-red-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}>{r.status}</span>
                <span className="text-[#5ec1ca] font-mono">{r.ref}</span>
                {r.parent_key && <span className="text-neutral-500 font-mono">{r.parent_key}</span>}
                <span className="text-neutral-500">{r.created_count} ticket{r.created_count !== 1 ? 's' : ''}</span>
                <span className="ml-auto text-neutral-600 text-[10px]">{new Date(r.created_at).toLocaleDateString('en-GB')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
