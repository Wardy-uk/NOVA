import { useState, useEffect, useCallback } from 'react';

interface KpiData {
  avgTimeToAction: number | null;
  hygieneCompliance: number;
  autoCloseBackstops: number;
  commitmentsMet: number;
  kbGapsLogged: number;
  customersOverdue: number;
}

interface AgentRow {
  agentId: string;
  agentName: string;
  pool: string;
  actionsTaken: number;
  avgTimeToAction: number | null;
  deferrals: number;
  hygienePassCount: number;
  hygieneExpected: number;
  hygieneCompliance: number;
  autoCloseBackstops: number;
  commitmentsSet: number;
  commitmentsMet: number;
  commitmentsMissed: number;
  stretchCommitments: number;
  rankOverrides: number;
}

interface ActionBreakdown { actionType: string; count: number }
interface DeferBreakdown { reason: string; count: number }
interface HourlyActivity { hour: number; day: string; eventCount: number }

interface OverviewData {
  period: string;
  pool: string;
  kpis: KpiData;
  agents: AgentRow[];
  actionBreakdown: ActionBreakdown[];
  deferBreakdown: DeferBreakdown[];
  hourlyActivity: HourlyActivity[];
}

interface AgentDetailData {
  agentId: string;
  agentName: string;
  period: string;
  recentEvents: Array<{ eventType: string; ticketKey: string | null; payload: Record<string, unknown>; createdAt: string }>;
  commitments: Array<{ ticketKey: string; committedAt: string; dueAt: string; workingDaysOut: number; status: 'met' | 'missed' | 'pending'; isStretch: boolean }>;
  hygienePasses: Array<{ hourBlock: string; ticketCount: number; fails: number; durationMs: number; createdAt: string }>;
  qualitySignals: { autoCloseBackstops: Array<{ ticketKey: string; daysInState: number; createdAt: string }>; declinedEscalations: number; rankOverrides: number };
}

type Period = 'today' | 'week' | 'month';
type Pool = 'all' | 'cc' | 't2' | 'tpj' | 'digital';
type SortKey = 'agentName' | 'actionsTaken' | 'avgTimeToAction' | 'deferrals' | 'hygieneCompliance' | 'autoCloseBackstops' | 'commitmentsMet' | 'stretchCommitments' | 'rankOverrides';

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}` };
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function kpiColor(value: number, target: number, higherIsBetter: boolean): string {
  if (higherIsBetter) {
    if (value >= target) return 'text-emerald-400';
    if (value >= target * 0.9) return 'text-amber-400';
    return 'text-red-400';
  }
  if (value <= target) return 'text-emerald-400';
  if (value <= target * 1.2) return 'text-amber-400';
  return 'text-red-400';
}

function BarChart({ items, maxCount, color }: { items: Array<{ label: string; count: number }>; maxCount: number; color: string }) {
  if (items.length === 0) return <div className="text-xs text-neutral-600 py-4 text-center">No data</div>;
  return (
    <div className="space-y-1.5">
      {items.slice(0, 10).map(item => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-400 w-28 truncate text-right">{item.label}</span>
          <div className="flex-1 h-4 bg-[#141820] rounded overflow-hidden">
            <div
              className="h-full rounded transition-all"
              style={{ width: `${maxCount > 0 ? (item.count / maxCount) * 100 : 0}%`, background: color }}
            />
          </div>
          <span className="text-[10px] text-neutral-500 w-8 text-right">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

export function ManagerDashboardView() {
  const [period, setPeriod] = useState<Period>('today');
  const [pool, setPool] = useState<Pool>('all');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('actionsTaken');
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<AgentDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/manager/overview?period=${period}&pool=${pool}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.ok) setData(json.data);
      else setError(json.error ?? 'Failed to load');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, [period, pool]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const fetchAgentDetail = async (agentId: string) => {
    setSelectedAgent(agentId);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/agent/manager/agent/${encodeURIComponent(agentId)}?period=${period}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.ok) setAgentDetail(json.data);
    } catch { /* ignore */ }
    finally { setDetailLoading(false); }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(true); }
  };

  const sortedAgents = data?.agents ? [...data.agents].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    if (typeof av === 'string' && typeof bv === 'string') return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  }) : [];

  const kpis = data?.kpis;

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold text-neutral-100">Manager Dashboard</h2>
        <div className="flex items-center gap-2">
          {(['today', 'week', 'month'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-[11px] rounded-lg transition-colors ${period === p ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
            >{p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}</button>
          ))}
          <span className="text-neutral-600 text-[10px]">|</span>
          {(['all', 'cc', 't2', 'tpj', 'digital'] as Pool[]).map(p => (
            <button key={p} onClick={() => setPool(p)}
              className={`px-2 py-1 text-[11px] rounded-lg transition-colors ${pool === p ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
            >{p === 'all' ? 'All' : p.toUpperCase()}</button>
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
            <KpiCard label="Avg Time to Action" value={fmtMs(kpis.avgTimeToAction)} target="< 2:00"
              color={kpis.avgTimeToAction != null ? kpiColor(kpis.avgTimeToAction, 120000, false) : 'text-neutral-500'} />
            <KpiCard label="Hygiene Compliance" value={`${kpis.hygieneCompliance}%`} target=">= 95%"
              color={kpiColor(kpis.hygieneCompliance, 95, true)} />
            <KpiCard label="Auto-Close Backstops" value={String(kpis.autoCloseBackstops)} target="0"
              color={kpiColor(kpis.autoCloseBackstops, 0, false)} />
            <KpiCard label="Commitments Met" value={`${kpis.commitmentsMet}%`} target=">= 95%"
              color={kpiColor(kpis.commitmentsMet, 95, true)} />
            <KpiCard label="Customers Overdue" value={String(kpis.customersOverdue)} target="< 5"
              color={kpiColor(kpis.customersOverdue, 5, false)} />
            <KpiCard label="KB Gaps Logged" value={String(kpis.kbGapsLogged)} target=">= 10/wk"
              color={period === 'week' ? kpiColor(kpis.kbGapsLogged, 10, true) : 'text-neutral-300'} />
          </div>

          {/* Agent breakdown table */}
          <div className="bg-[#2f353d] border border-[#3a424d] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-[#3a424d] text-neutral-500">
                    {([
                      ['agentName', 'Agent'],
                      ['actionsTaken', 'Actions'],
                      ['avgTimeToAction', 'Avg TTA'],
                      ['deferrals', 'Deferrals'],
                      ['hygieneCompliance', 'Hygiene'],
                      ['autoCloseBackstops', 'Backstops'],
                      ['commitmentsMet', 'Commitments'],
                      ['stretchCommitments', 'Stretch'],
                      ['rankOverrides', 'Overrides'],
                    ] as [SortKey, string][]).map(([key, label]) => (
                      <th key={key} onClick={() => handleSort(key)}
                        className="px-3 py-2 text-left font-medium cursor-pointer hover:text-neutral-300 select-none whitespace-nowrap">
                        {label} {sortKey === key ? (sortDesc ? '▼' : '▲') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedAgents.map(agent => (
                    <tr key={agent.agentId} className="border-b border-[#3a424d]/50 hover:bg-[#353b44] transition-colors">
                      <td className="px-3 py-2">
                        <button onClick={() => fetchAgentDetail(agent.agentId)} className="text-[#5ec1ca] hover:underline font-medium">
                          {agent.agentName}
                        </button>
                        <span className="ml-1.5 text-[9px] text-neutral-600 uppercase">{agent.pool}</span>
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{agent.actionsTaken}</td>
                      <td className={`px-3 py-2 ${agent.avgTimeToAction != null && agent.avgTimeToAction > 120000 ? 'text-red-400' : 'text-neutral-300'}`}>
                        {fmtMs(agent.avgTimeToAction)}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{agent.deferrals}</td>
                      <td className={`px-3 py-2 ${agent.hygieneCompliance < 95 ? 'text-red-400' : 'text-neutral-300'}`}>
                        {agent.hygienePassCount}/{agent.hygieneExpected} ({agent.hygieneCompliance}%)
                      </td>
                      <td className={`px-3 py-2 ${agent.autoCloseBackstops > 0 ? 'text-red-400' : 'text-neutral-300'}`}>
                        {agent.autoCloseBackstops}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">
                        Met {agent.commitmentsMet}/{agent.commitmentsSet}
                        {agent.commitmentsSet > 0 && (
                          <span className={agent.commitmentsMet / agent.commitmentsSet < 0.95 ? ' text-amber-400' : ''}>
                            {' '}({Math.round((agent.commitmentsMet / agent.commitmentsSet) * 100)}%)
                          </span>
                        )}
                      </td>
                      <td className={`px-3 py-2 ${agent.commitmentsSet > 0 && agent.stretchCommitments / agent.commitmentsSet > 0.1 ? 'text-amber-400' : 'text-neutral-300'}`}>
                        {agent.stretchCommitments}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{agent.rankOverrides}</td>
                    </tr>
                  ))}
                  {sortedAgents.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-6 text-center text-neutral-600">No agent activity for this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-xl p-4">
              <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-3">Action Breakdown</h3>
              <BarChart
                items={data!.actionBreakdown.map(a => ({ label: a.actionType, count: a.count }))}
                maxCount={data!.actionBreakdown[0]?.count ?? 1}
                color="#5ec1ca"
              />
            </div>
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-xl p-4">
              <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-3">Defer Reasons</h3>
              <BarChart
                items={data!.deferBreakdown.map(d => ({ label: d.reason, count: d.count }))}
                maxCount={data!.deferBreakdown[0]?.count ?? 1}
                color="#f59e0b"
              />
            </div>
          </div>
        </>
      )}

      {/* Agent detail slide-out */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => { setSelectedAgent(null); setAgentDetail(null); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-xl bg-[#1A1F26] border-l border-[#2A2F38] shadow-2xl overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-4 pb-3 border-b border-[#2A2F38] flex items-center justify-between sticky top-0 bg-[#1A1F26] z-10">
              <div>
                <h2 className="text-sm font-semibold text-neutral-100">{agentDetail?.agentName ?? selectedAgent}</h2>
                <span className="text-[10px] text-neutral-500">Agent Detail — {period}</span>
              </div>
              <button onClick={() => { setSelectedAgent(null); setAgentDetail(null); }} className="text-neutral-500 hover:text-neutral-300 text-lg">&times;</button>
            </div>

            {detailLoading && <div className="p-8 text-center text-neutral-500 text-xs">Loading...</div>}

            {agentDetail && !detailLoading && (
              <div className="p-5 space-y-5">
                {/* Commitments */}
                <div>
                  <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-2">Commitment Audit</h3>
                  {agentDetail.commitments.length === 0 ? (
                    <div className="text-xs text-neutral-600">No commitments in this period</div>
                  ) : (
                    <div className="space-y-1">
                      {agentDetail.commitments.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px] py-1 border-b border-[#2A2F38]/50">
                          <span className={`w-2 h-2 rounded-full ${c.status === 'met' ? 'bg-emerald-400' : c.status === 'missed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                          <span className="text-[#5ec1ca] font-mono">{c.ticketKey}</span>
                          <span className="text-neutral-500">due {new Date(c.dueAt).toLocaleDateString()}</span>
                          <span className={`ml-auto text-[10px] font-medium ${c.status === 'met' ? 'text-emerald-400' : c.status === 'missed' ? 'text-red-400' : 'text-amber-400'}`}>
                            {c.status.toUpperCase()}
                          </span>
                          {c.isStretch && <span className="text-[9px] bg-amber-500/10 text-amber-400 px-1 rounded">STRETCH</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Hygiene passes */}
                <div>
                  <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-2">Hygiene Passes</h3>
                  {agentDetail.hygienePasses.length === 0 ? (
                    <div className="text-xs text-neutral-600">No hygiene passes in this period</div>
                  ) : (
                    <div className="space-y-1">
                      {agentDetail.hygienePasses.slice(0, 20).map((h, i) => (
                        <div key={i} className="flex items-center gap-3 text-[11px] py-1 border-b border-[#2A2F38]/50">
                          <span className="text-neutral-500">{h.hourBlock}</span>
                          <span className="text-neutral-300">{h.ticketCount} tickets</span>
                          <span className={h.fails > 0 ? 'text-red-400' : 'text-emerald-400'}>{h.fails} fails</span>
                          <span className="ml-auto text-neutral-600 text-[10px]">{new Date(h.createdAt).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quality signals */}
                <div>
                  <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-2">Quality Signals</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#141820] rounded-lg p-3">
                      <div className="text-[10px] text-neutral-500 mb-1">Auto-Close Backstops</div>
                      <div className={`text-lg font-bold ${agentDetail.qualitySignals.autoCloseBackstops.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {agentDetail.qualitySignals.autoCloseBackstops.length}
                      </div>
                    </div>
                    <div className="bg-[#141820] rounded-lg p-3">
                      <div className="text-[10px] text-neutral-500 mb-1">Rank Overrides</div>
                      <div className="text-lg font-bold text-neutral-300">{agentDetail.qualitySignals.rankOverrides}</div>
                    </div>
                  </div>
                  {agentDetail.qualitySignals.autoCloseBackstops.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {agentDetail.qualitySignals.autoCloseBackstops.map((b, i) => (
                        <div key={i} className="text-[11px] text-red-400">
                          {b.ticketKey} — {b.daysInState}d in state ({new Date(b.createdAt).toLocaleDateString()})
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent events */}
                <div>
                  <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-2">Recent Events</h3>
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {agentDetail.recentEvents.length === 0 ? (
                      <div className="text-xs text-neutral-600">No events in this period</div>
                    ) : agentDetail.recentEvents.map((ev, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] py-1 border-b border-[#2A2F38]/50">
                        <span className="text-neutral-600 whitespace-nowrap text-[10px]">{new Date(ev.createdAt).toLocaleTimeString()}</span>
                        <span className="text-[#5ec1ca] font-mono">{ev.ticketKey ?? '—'}</span>
                        <span className="text-neutral-400">{ev.eventType}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, target, color }: { label: string; value: string; target: string; color: string }) {
  return (
    <div className="bg-[#2f353d] border border-[#3a424d] rounded-xl p-4">
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-neutral-600 mt-1">Target: {target}</div>
    </div>
  );
}
