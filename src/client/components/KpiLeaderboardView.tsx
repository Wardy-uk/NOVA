import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Agent {
  AgentName: string;
  AgentSurname: string;
  TierCode: string;
  Team: string;
  IsAvailable: boolean;
  OpenTickets_Total: number;
  OpenTickets_Over2Hours: number;
  OpenTickets_NoUpdateToday: number;
  SolvedTickets_Today: number;
  SolvedTickets_ThisWeek: number;
  TicketsSnapshotAt: string;
}

interface AgentDaily {
  AgentName: string;
  TierCode: string;
  ReportDate: string;
  OpenTickets_Total: number;
  OpenTickets_Over2Hours: number;
  SolvedTickets_Today: number;
  SolvedTickets_ThisWeek: number;
  TicketsPerHour: number | null;
  CSATAverage: number | null;
  QAOverallAvg: number | null;
  GoldenRulesAvg: number | null;
  SLACompliancePct: number | null;
}

type LeaderboardTab = 'combined' | 'productivity' | 'sla' | 'quality';

interface RankedAgent {
  name: string;
  team: string;
  tier: string;
  available: boolean;
  solvedToday: number;
  solvedWeek: number;
  openTotal: number;
  over2h: number;
  stale: number;
  ticketsPerHour: number | null;
  slaPercent: number | null;
  qaScore: number | null;
  csatScore: number | null;
  goldenRulesScore: number | null;
  compositeScore: number;
}

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/* ------------------------------------------------------------------ */

const C = {
  bg0: '#1e2228',
  bg1: '#272C33',
  bg2: '#2f353d',
  bg3: '#343a42',
  teal: '#5ec1ca',
  purple: '#7c3aed',
  green: '#059669',
  amber: '#d97706',
  red: '#ef4444',
  text1: '#e2e8f0',
  text2: '#94a3b8',
  text3: '#64748b',
  border: 'rgba(255,255,255,0.06)',
  glass: 'rgba(255,255,255,0.03)',
} as const;

const GOLD = '#fbbf24';
const SILVER = '#9ca3af';
const BRONZE = '#d97706';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function rankSuffix(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

function rankColor(n: number): string {
  if (n === 1) return GOLD;
  if (n === 2) return SILVER;
  if (n === 3) return BRONZE;
  return C.text3;
}

function pct(v: number | null): string {
  if (v == null) return '-';
  return `${Math.round(v)}%`;
}

function fmt1(v: number | null): string {
  if (v == null) return '-';
  return v.toFixed(1);
}

function scoreColor(v: number | null, thresholds: [number, number]): string {
  if (v == null) return C.text3;
  if (v >= thresholds[0]) return C.green;
  if (v >= thresholds[1]) return C.amber;
  return C.red;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Pulse({ color }: { color: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      backgroundColor: color,
      boxShadow: `0 0 6px ${color}`,
      animation: 'kpiLbPulse 2s ease-in-out infinite',
    }} />
  );
}

function StatPill({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
      padding: '12px 20px', borderRadius: 12,
      background: `${color}10`, border: `1px solid ${color}25`,
      minWidth: 100, flex: 1,
    }}>
      <span style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 9, fontWeight: 600, color: C.text3, marginTop: 4, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
        {label}
      </span>
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{
      width: 60, height: 4, borderRadius: 2,
      background: `${C.text3}30`, overflow: 'hidden',
      display: 'inline-block', verticalAlign: 'middle', marginLeft: 6,
    }}>
      <div style={{
        width: `${w}%`, height: '100%', borderRadius: 2,
        background: color, transition: 'width 0.4s ease',
      }} />
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 16px', cursor: 'pointer',
        fontSize: 11, fontWeight: 600, borderRadius: 20,
        letterSpacing: '0.3px', transition: 'all 0.2s',
        background: active ? `${C.teal}20` : 'transparent',
        color: active ? C.teal : C.text3,
        border: active ? `1px solid ${C.teal}30` : '1px solid transparent',
      }}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Rank Badge                                                         */
/* ------------------------------------------------------------------ */

function RankBadge({ rank }: { rank: number }) {
  const isTop3 = rank <= 3;
  const color = rankColor(rank);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 28, borderRadius: '50%',
      background: isTop3 ? `${color}20` : 'transparent',
      border: isTop3 ? `1px solid ${color}40` : 'none',
      fontSize: 12, fontWeight: 800,
      color: isTop3 ? color : C.text3,
    }}>
      {rank}{rankSuffix(rank)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function KpiLeaderboardView() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentDaily, setAgentDaily] = useState<AgentDaily[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [env, setEnv] = useState<'live' | 'uat'>('live');
  const [tab, setTab] = useState<LeaderboardTab>('combined');
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily');

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [agentsRes, dailyRes] = await Promise.all([
        fetch(`/api/kpi-data/agents?env=${env}`),
        fetch(`/api/kpi-data/agent-daily?env=${env}&days=7`),
      ]);

      const [agentsData, dailyData] = await Promise.all([
        agentsRes.json(),
        dailyRes.json(),
      ]);

      if (!agentsData.ok) throw new Error(agentsData.error || 'Failed to load agents');

      setAgents(agentsData.data || []);
      setAgentDaily(dailyData.ok ? (dailyData.data || []) : []);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [env]);

  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchData]);

  /* ---- Keyframe injection ---- */
  useEffect(() => {
    const id = 'kpi-leaderboard-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes kpiLbPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.85); }
      }
      @keyframes kpiLbShimmer {
        0% { opacity: 0.3; }
        100% { opacity: 0.6; }
      }
      @keyframes kpiLbFadeIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes kpiLbGradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById(id)?.remove(); };
  }, []);

  /* ---- Merge agent + daily data ---- */
  const merged: RankedAgent[] = (() => {
    // Build a map of latest daily data per agent
    const dailyMap = new Map<string, AgentDaily>();
    for (const d of agentDaily) {
      const existing = dailyMap.get(d.AgentName);
      if (!existing || d.ReportDate > existing.ReportDate) {
        dailyMap.set(d.AgentName, d);
      }
    }

    return agents.map(a => {
      const daily = dailyMap.get(`${a.AgentName} ${a.AgentSurname}`.trim());
      const slaPercent = daily?.SLACompliancePct ?? null;

      const tph = daily?.TicketsPerHour ?? null;
      const qa = daily?.QAOverallAvg ?? null;
      const csat = daily?.CSATAverage ?? null;
      const gr = daily?.GoldenRulesAvg ?? null;

      // Composite: normalise each metric to 0-100, average available ones
      const scores: number[] = [];
      if (tph != null) scores.push(Math.min(tph * 20, 100)); // 5 tix/hr = 100
      if (slaPercent != null) scores.push(slaPercent);
      if (qa != null) scores.push(qa * 20); // assume 0-5 scale → 0-100
      if (csat != null) scores.push(csat * 20); // 1-5 scale → 0-100
      if (gr != null) scores.push(gr * 20); // 1-5 scale → 0-100

      const compositeScore = scores.length > 0
        ? scores.reduce((s, v) => s + v, 0) / scores.length
        : 0;

      return {
        name: `${a.AgentName} ${a.AgentSurname}`,
        team: a.Team,
        tier: a.TierCode,
        available: a.IsAvailable,
        solvedToday: a.SolvedTickets_Today,
        solvedWeek: a.SolvedTickets_ThisWeek,
        openTotal: a.OpenTickets_Total,
        over2h: a.OpenTickets_Over2Hours,
        stale: a.OpenTickets_NoUpdateToday,
        ticketsPerHour: tph,
        slaPercent,
        qaScore: qa,
        csatScore: csat,
        goldenRulesScore: gr,
        compositeScore,
      };
    });
  })();

  /* ---- Sort by selected tab ---- */
  const sorted = [...merged].sort((a, b) => {
    switch (tab) {
      case 'productivity': {
        if (period === 'weekly') {
          const diff = b.solvedWeek - a.solvedWeek;
          return diff !== 0 ? diff : b.solvedToday - a.solvedToday;
        }
        const diff = b.solvedToday - a.solvedToday;
        return diff !== 0 ? diff : b.solvedWeek - a.solvedWeek;
      }
      case 'sla':
        return (b.slaPercent ?? -1) - (a.slaPercent ?? -1);
      case 'quality':
        return (b.qaScore ?? -1) - (a.qaScore ?? -1);
      case 'combined':
      default: {
        const cDiff = b.compositeScore - a.compositeScore;
        if (cDiff !== 0) return cDiff;
        return period === 'weekly'
          ? b.solvedWeek - a.solvedWeek
          : b.solvedToday - a.solvedToday;
      }
    }
  });

  /* ---- Stats ---- */
  const totalAgents = agents.length;
  const availableCount = agents.filter(a => a.IsAvailable).length;
  const totalSolvedToday = agents.reduce((s, a) => s + a.SolvedTickets_Today, 0);
  const totalSolvedWeek = agents.reduce((s, a) => s + a.SolvedTickets_ThisWeek, 0);
  const avgTph = (() => {
    const vals = merged.filter(m => m.ticketsPerHour != null);
    return vals.length > 0 ? (vals.reduce((s, v) => s + v.ticketsPerHour!, 0) / vals.length).toFixed(1) : '-';
  })();
  const avgSla = (() => {
    const vals = merged.filter(m => m.slaPercent != null);
    return vals.length > 0 ? Math.round(vals.reduce((s, v) => s + v.slaPercent!, 0) / vals.length) + '%' : '-';
  })();
  const avgQa = (() => {
    const vals = merged.filter(m => m.qaScore != null);
    return vals.length > 0 ? (vals.reduce((s, v) => s + v.qaScore!, 0) / vals.length).toFixed(1) : '-';
  })();

  /* ---- Max values for mini bars ---- */
  const maxTph = Math.max(...merged.map(m => m.ticketsPerHour ?? 0), 1);
  const maxQa = Math.max(...merged.map(m => m.qaScore ?? 0), 1);

  /* ---- Column headers per tab (dynamic based on period) ---- */
  const solvedLabel = period === 'weekly' ? 'Solved Week' : 'Solved Today';
  const columnHeaders: Record<LeaderboardTab, string[]> = {
    combined: ['Rank', 'Agent', 'Team', 'Tier', 'Tix/Hr', 'SLA %', 'QA Score', 'CSAT', 'Composite', solvedLabel],
    productivity: ['Rank', 'Agent', 'Team', 'Tier', 'Tix/Hr', 'Solved Today', 'Solved Week', 'Open', '>2h'],
    sla: ['Rank', 'Agent', 'Team', 'Tier', 'SLA %', 'Open', '>2h Overdue', 'Stale', solvedLabel],
    quality: ['Rank', 'Agent', 'Team', 'Tier', 'QA Score', 'CSAT', 'Golden Rules', 'Tix/Hr', solvedLabel],
  };

  const isLeftAligned = (h: string) => ['Agent', 'Team', 'Tier'].includes(h);

  /* ---- Loading ---- */
  if (loading) {
    return (
      <div style={{ padding: 32, background: C.bg0, minHeight: '100vh' }}>
        <div style={{
          height: 56, background: C.glass, border: `1px solid ${C.border}`,
          borderRadius: 12, marginBottom: 32,
          animation: 'kpiLbShimmer 1.5s ease-in-out infinite alternate',
        }} />
        <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 72, background: C.glass, border: `1px solid ${C.border}`,
              borderRadius: 12, animation: 'kpiLbShimmer 1.5s ease-in-out infinite alternate',
            }} />
          ))}
        </div>
        <div style={{
          height: 400, background: C.glass, border: `1px solid ${C.border}`,
          borderRadius: 12, animation: 'kpiLbShimmer 1.5s ease-in-out infinite alternate',
        }} />
      </div>
    );
  }

  /* ---- Render cell value for current tab ---- */
  function renderCell(agent: RankedAgent, header: string) {
    const cellStyle = (align: 'left' | 'center' = 'center'): React.CSSProperties => ({
      padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
      textAlign: align, fontSize: 13,
    });

    switch (header) {
      case 'Agent':
        return (
          <td key={header} style={cellStyle('left')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: agent.available ? C.green : '#4b5563',
                boxShadow: agent.available ? `0 0 6px ${C.green}` : 'none',
                flexShrink: 0,
              }} />
              <span style={{ fontWeight: 500, color: C.text1 }}>{agent.name}</span>
            </div>
          </td>
        );
      case 'Team':
        return <td key={header} style={{ ...cellStyle('left'), color: C.text2, fontSize: 12 }}>{agent.team}</td>;
      case 'Tier':
        return (
          <td key={header} style={cellStyle('left')}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: C.purple,
              padding: '2px 8px', borderRadius: 8, background: `${C.purple}15`,
            }}>{agent.tier}</span>
          </td>
        );
      case 'Tix/Hr':
        return (
          <td key={header} style={cellStyle()}>
            <span style={{ fontWeight: 700, color: scoreColor(agent.ticketsPerHour, [3, 1.5]) }}>
              {fmt1(agent.ticketsPerHour)}
            </span>
            {agent.ticketsPerHour != null && (
              <MiniBar value={agent.ticketsPerHour} max={maxTph} color={scoreColor(agent.ticketsPerHour, [3, 1.5])} />
            )}
          </td>
        );
      case 'SLA %':
        return (
          <td key={header} style={cellStyle()}>
            <span style={{ fontWeight: 700, color: scoreColor(agent.slaPercent, [90, 70]) }}>
              {pct(agent.slaPercent)}
            </span>
            {agent.slaPercent != null && (
              <MiniBar value={agent.slaPercent} max={100} color={scoreColor(agent.slaPercent, [90, 70])} />
            )}
          </td>
        );
      case 'QA Score':
        return (
          <td key={header} style={cellStyle()}>
            <span style={{ fontWeight: 700, color: scoreColor(agent.qaScore, [4, 3]) }}>
              {fmt1(agent.qaScore)}
            </span>
            {agent.qaScore != null && (
              <MiniBar value={agent.qaScore} max={maxQa} color={scoreColor(agent.qaScore, [4, 3])} />
            )}
          </td>
        );
      case 'CSAT':
        return (
          <td key={header} style={cellStyle()}>
            <span style={{ fontWeight: 700, color: scoreColor(agent.csatScore, [4, 3]) }}>
              {fmt1(agent.csatScore)}
            </span>
            {agent.csatScore != null && (
              <MiniBar value={agent.csatScore} max={5} color={scoreColor(agent.csatScore, [4, 3])} />
            )}
          </td>
        );
      case 'Golden Rules':
        return (
          <td key={header} style={cellStyle()}>
            <span style={{ fontWeight: 700, color: scoreColor(agent.goldenRulesScore, [4, 3]) }}>
              {fmt1(agent.goldenRulesScore)}
            </span>
          </td>
        );
      case 'Composite':
        return (
          <td key={header} style={cellStyle()}>
            <span style={{
              fontWeight: 800, fontSize: 16,
              color: scoreColor(agent.compositeScore, [75, 50]),
            }}>
              {Math.round(agent.compositeScore)}
            </span>
            <MiniBar value={agent.compositeScore} max={100} color={scoreColor(agent.compositeScore, [75, 50])} />
          </td>
        );
      case 'Solved Today': {
        const isPrimary = period === 'daily';
        return (
          <td key={header} style={cellStyle()}>
            <span style={{
              fontSize: isPrimary ? 16 : 13,
              fontWeight: isPrimary ? 800 : 600,
              color: isPrimary
                ? (agent.solvedToday > 0 ? C.teal : C.text3)
                : C.text2,
            }}>{agent.solvedToday}</span>
          </td>
        );
      }
      case 'Solved Week': {
        const isPrimary = period === 'weekly';
        return (
          <td key={header} style={cellStyle()}>
            <span style={{
              fontSize: isPrimary ? 16 : 13,
              fontWeight: isPrimary ? 800 : 600,
              color: isPrimary
                ? (agent.solvedWeek > 0 ? C.teal : C.text3)
                : C.text2,
            }}>{agent.solvedWeek}</span>
          </td>
        );
      }
      case 'Open':
        return <td key={header} style={{ ...cellStyle(), color: C.text2 }}>{agent.openTotal}</td>;
      case '>2h':
      case '>2h Overdue':
        return (
          <td key={header} style={cellStyle()}>
            <span style={{ fontWeight: 600, color: agent.over2h > 0 ? C.red : C.text3 }}>
              {agent.over2h}
            </span>
          </td>
        );
      case 'Stale':
        return (
          <td key={header} style={cellStyle()}>
            <span style={{ fontWeight: 600, color: agent.stale > 0 ? C.amber : C.text3 }}>
              {agent.stale}
            </span>
          </td>
        );
      default:
        return <td key={header} style={cellStyle()}>-</td>;
    }
  }

  const headers = columnHeaders[tab];

  return (
    <div style={{
      padding: 32, background: C.bg0, minHeight: '100vh',
      fontFamily: "'Figtree', 'Plus Jakarta Sans', system-ui, sans-serif",
      color: C.text1,
    }}>
      {/* ---- Top Bar ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', marginBottom: 24,
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        position: 'relative' as const, overflow: 'hidden' as const,
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${C.teal}, ${C.purple}, ${C.teal})`,
          backgroundSize: '200% 100%',
          animation: 'kpiLbGradient 4s ease-in-out infinite',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.teal}, ${C.purple})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
            boxShadow: `0 0 20px ${C.teal}40`,
          }}>L</div>
          <div>
            <h1 style={{
              fontSize: 20, fontWeight: 800, margin: 0, color: C.text1,
              letterSpacing: '-0.3px',
            }}>Agent Leaderboard</h1>
            <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>
              {env === 'live' ? 'Live' : 'UAT'} performance rankings
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {lastRefresh && (
            <span style={{ fontSize: 11, color: C.text3 }}>
              Updated {lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}

          <div style={{
            display: 'flex', borderRadius: 20, overflow: 'hidden',
            border: `1px solid ${C.border}`,
          }}>
            {(['live', 'uat'] as const).map(e => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                style={{
                  padding: '6px 14px', border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.5px', transition: 'all 0.2s',
                  background: env === e
                    ? e === 'live' ? `${C.red}25` : `${C.teal}20`
                    : 'transparent',
                  color: env === e
                    ? e === 'live' ? C.red : C.teal
                    : C.text3,
                }}
              >
                {e}
              </button>
            ))}
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: autoRefresh ? `${C.teal}20` : `rgba(255,255,255,0.05)`,
              color: autoRefresh ? C.teal : C.text3,
              transition: 'all 0.2s',
            }}
          >
            <Pulse color={autoRefresh ? C.teal : C.text3} />
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>

          <button
            onClick={fetchData}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.border}`,
              background: C.glass, cursor: 'pointer', color: C.text2,
              fontSize: 16, transition: 'all 0.2s',
            }}
            title="Refresh now"
          >
            &#x21bb;
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 20px', marginBottom: 24, borderRadius: 10,
          background: `${C.red}15`, border: `1px solid ${C.red}30`,
          color: C.red, fontSize: 13, fontWeight: 500,
        }}>
          {error}
        </div>
      )}

      {/* ---- Summary Stats ---- */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 24,
        animation: 'kpiLbFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
      }}>
        <StatPill value={totalAgents} label="Agents" color={C.teal} />
        <StatPill value={availableCount} label="Available" color={C.green} />
        <StatPill value={period === 'daily' ? totalSolvedToday : totalSolvedWeek} label={period === 'daily' ? 'Solved Today' : 'Solved This Week'} color={C.purple} />
        <StatPill value={avgTph} label="Avg Tix/Hr" color={C.teal} />
        <StatPill value={avgSla} label="Avg SLA" color={C.green} />
        <StatPill value={avgQa} label="Avg QA" color={C.amber} />
        <StatPill value={(() => {
          const vals = merged.filter(m => m.csatScore != null);
          return vals.length > 0 ? (vals.reduce((s, v) => s + v.csatScore!, 0) / vals.length).toFixed(1) : '-';
        })()} label="Avg CSAT" color={C.amber} />
      </div>

      {/* ---- Tab Selector + Period Toggle ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20,
        animation: 'kpiLbFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s forwards',
        opacity: 0,
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <TabButton active={tab === 'combined'} label="Combined" onClick={() => setTab('combined')} />
          <TabButton active={tab === 'productivity'} label="Productivity" onClick={() => setTab('productivity')} />
          <TabButton active={tab === 'sla'} label="SLA Achievement" onClick={() => setTab('sla')} />
          <TabButton active={tab === 'quality'} label="Quality" onClick={() => setTab('quality')} />
        </div>
        <div style={{
          display: 'flex', borderRadius: 20, overflow: 'hidden',
          border: `1px solid ${C.border}`,
        }}>
          {([
            { id: 'daily' as const, label: 'Daily' },
            { id: 'weekly' as const, label: 'Weekly' },
          ]).map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              style={{
                padding: '5px 14px', border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 600, transition: 'all 0.2s',
                background: period === p.id ? `${C.teal}20` : 'transparent',
                color: period === p.id ? C.teal : C.text3,
              }}
            >{p.label}</button>
          ))}
        </div>
      </div>

      {/* ---- Leaderboard Table ---- */}
      <div style={{
        animation: 'kpiLbFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s forwards',
        opacity: 0,
      }}>
        <div style={{
          background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {headers.map(h => (
                  <th key={h} style={{
                    padding: '12px 16px',
                    textAlign: isLeftAligned(h) ? 'left' : 'center',
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.5px', color: C.text3,
                    background: C.bg1, borderBottom: `1px solid ${C.border}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={headers.length} style={{
                    padding: '40px 16px', textAlign: 'center',
                    color: C.text3, fontSize: 13, fontWeight: 500,
                  }}>
                    No agent data available
                  </td>
                </tr>
              )}
              {sorted.map((agent, i) => {
                const rank = i + 1;
                const isTop3 = rank <= 3;
                const hasNoData = agent.compositeScore === 0 && tab === 'combined';

                return (
                  <tr key={i} style={{
                    background: isTop3 ? `${rankColor(rank)}08` : 'transparent',
                    opacity: hasNoData ? 0.5 : 1,
                    transition: 'background 0.15s',
                  }}>
                    {headers.map(h => {
                      if (h === 'Rank') {
                        return (
                          <td key={h} style={{
                            padding: '10px 16px', textAlign: 'center',
                            borderBottom: `1px solid ${C.border}`,
                          }}>
                            <RankBadge rank={rank} />
                          </td>
                        );
                      }
                      return renderCell(agent, h);
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {agents.length > 0 && agents[0].TicketsSnapshotAt && (
          <div style={{
            marginTop: 12, fontSize: 11, color: C.text3, textAlign: 'right',
          }}>
            Ticket data as of {(() => {
              try {
                return new Date(agents[0].TicketsSnapshotAt).toLocaleString('en-GB', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                });
              } catch { return agents[0].TicketsSnapshotAt; }
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
