import { useState, useEffect, useCallback } from 'react';

interface KpiData {
  actionsTaken: number;
  autonomous: number;
  humanApproved: number;
  pendingApproval: number;
  reverted: number;
  minutesSaved: number;
}

interface ActionBreakdown { action: string; count: number }
interface FunnelItem { label: string; count: number }
interface RecentAction {
  ticketKey: string;
  action: string;
  confidence: number | null;
  quickWinType: string | null;
  mode: 'auto' | 'approved';
  approvedBy: string | null;
  createdAt: string;
}

interface OverviewData {
  period: string;
  kpis: KpiData;
  actionBreakdown: ActionBreakdown[];
  funnel: FunnelItem[];
  recentActions: RecentAction[];
}

type Period = 'today' | 'week' | 'month';

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}` };
}

function fmtMinutes(min: number): string {
  if (!min) return '0m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function prettyAction(a: string): string {
  return a.replace(/^auto_rule_/, '').replace(/[_-]/g, ' ');
}

function BarChart({ items, color }: { items: Array<{ label: string; count: number }>; color: string }) {
  if (items.length === 0) return <div className="text-xs text-neutral-600 py-4 text-center">No data</div>;
  const maxCount = items[0]?.count ?? 1;
  return (
    <div className="space-y-1.5">
      {items.slice(0, 12).map(item => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-400 w-32 truncate text-right">{item.label}</span>
          <div className="flex-1 h-4 bg-[#141820] rounded overflow-hidden">
            <div className="h-full rounded transition-all"
              style={{ width: `${maxCount > 0 ? (item.count / maxCount) * 100 : 0}%`, background: color }} />
          </div>
          <span className="text-[10px] text-neutral-500 w-8 text-right">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

export function ManagerDashboardView() {
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/manager/overview?period=${period}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.ok) setData(json.data);
      else setError(json.error ?? 'Failed to load');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const kpis = data?.kpis;

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-bold text-neutral-100">Manager Dashboard</h2>
          <p className="text-[10px] text-neutral-500">AI actions that actually happened — autonomous executes + approved decisions. Excludes shadow, pending and declined.</p>
        </div>
        <div className="flex items-center gap-2">
          {(['today', 'week', 'month'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-[11px] rounded-lg transition-colors ${period === p ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
            >{p === 'today' ? 'Today' : p === 'week' ? 'Last 7 days' : 'Last 30 days'}</button>
          ))}
          <button onClick={fetchOverview} className="px-2 py-1 text-[11px] text-neutral-500 hover:text-neutral-300 border border-[#3a424d] rounded-lg">Refresh</button>
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 bg-[#2f353d] rounded-xl animate-pulse" />)}
        </div>
      )}

      {error && <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">{error}</div>}

      {kpis && !loading && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Actions Taken" value={String(kpis.actionsTaken)} sub="autonomous + approved" color="text-neutral-100" />
            <KpiCard label="Autonomous" value={String(kpis.autonomous)} sub="NOVA acted alone" color="text-[#5ec1ca]" />
            <KpiCard label="Human-Approved" value={String(kpis.humanApproved)} sub="you approved it" color="text-emerald-400" />
            <KpiCard label="Pending Approval" value={String(kpis.pendingApproval)} sub="awaiting a human — not yet acted"
              color={kpis.pendingApproval > 0 ? 'text-amber-400' : 'text-neutral-500'} />
            <KpiCard label="Reverted" value={String(kpis.reverted)} sub="auto-action undone"
              color={kpis.reverted > 0 ? 'text-red-400' : 'text-emerald-400'} />
            <KpiCard label="Est. Time Saved" value={fmtMinutes(kpis.minutesSaved)} sub="from actioned tickets" color="text-neutral-100" />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-xl p-4">
              <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-3">Action Breakdown</h3>
              <BarChart items={data!.actionBreakdown.map(a => ({ label: prettyAction(a.action), count: a.count }))} color="#5ec1ca" />
            </div>
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-xl p-4">
              <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-3">Decision Funnel</h3>
              <BarChart items={data!.funnel.map(f => ({ label: f.label, count: f.count }))} color="#f59e0b" />
              <p className="text-[9px] text-neutral-600 mt-3">Only Autonomous + Human-Approved count as actions taken. Pending, Declined and Shadow are decisions that did not act on a ticket.</p>
            </div>
          </div>

          {/* Recent actions */}
          <div className="bg-[#2f353d] border border-[#3a424d] rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-[#3a424d]">
              <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Recent Actions</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-[#3a424d] text-neutral-500">
                    <th className="px-3 py-2 text-left font-medium">Time</th>
                    <th className="px-3 py-2 text-left font-medium">Ticket</th>
                    <th className="px-3 py-2 text-left font-medium">Action</th>
                    <th className="px-3 py-2 text-left font-medium">Mode</th>
                    <th className="px-3 py-2 text-left font-medium">Confidence</th>
                    <th className="px-3 py-2 text-left font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.recentActions.map((a, i) => (
                    <tr key={i} className="border-b border-[#3a424d]/50 hover:bg-[#353b44] transition-colors">
                      <td className="px-3 py-2 text-neutral-500 whitespace-nowrap text-[10px]">{new Date(a.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-[#5ec1ca] font-mono">{a.ticketKey}</td>
                      <td className="px-3 py-2 text-neutral-300">
                        {prettyAction(a.action)}
                        {a.quickWinType && <span className="ml-1.5 text-[9px] text-neutral-600">{a.quickWinType}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${a.mode === 'auto' ? 'bg-[#5ec1ca]/10 text-[#5ec1ca]' : 'bg-emerald-500/10 text-emerald-400'}`}>
                          {a.mode === 'auto' ? 'AUTO' : 'APPROVED'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-neutral-400">{a.confidence != null ? `${Math.round(a.confidence * 100)}%` : '—'}</td>
                      <td className="px-3 py-2 text-neutral-500">{a.approvedBy ?? (a.mode === 'auto' ? 'NOVA' : '—')}</td>
                    </tr>
                  ))}
                  {data!.recentActions.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-neutral-600">No actions taken in this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-[#2f353d] border border-[#3a424d] rounded-xl p-4">
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-neutral-600 mt-1">{sub}</div>
    </div>
  );
}
