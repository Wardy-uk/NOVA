// TODO: Remove — duplicated by unified scorecard in QA dashboard (GET /api/kpi-data/agent-scorecard/:name)
// This view's QA/GR agent-level scores overlap with QAView Overview tab and AgentCoachingView.
// Consider replacing the QA/GR score columns with a link to the unified scorecard.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { isNovaAi } from '../utils/agentFilters.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentDailyRow {
  Id: number;
  ReportDate: string;
  AgentId: number;
  AgentName: string;
  TierCode: string | null;
  Team: string | null;
  OpenTickets_Total: number | null;
  OpenTickets_Over2Hours: number | null;
  OpenTickets_NoUpdateToday: number | null;
  SolvedTickets_Today: number | null;
  SolvedTickets_ThisWeek: number | null;
  AvailableHours: number | null;
  TicketsPerHour: number | null;
  OldestTicketDays: number | null;
  QATicketsScored: number | null;
  QAOverallAvg: number | null;
  QAAccuracyAvg: number | null;
  QAClarityAvg: number | null;
  QAToneAvg: number | null;
  QARedCount: number | null;
  QAAmberCount: number | null;
  QAGreenCount: number | null;
  QAConcerningCount: number | null;
  GoldenRulesScored: number | null;
  GoldenRulesAvg: number | null;
  OwnershipAvg: number | null;
  NextActionAvg: number | null;
  TimeframeAvg: number | null;
  SLAResolvedCount: number | null;
  SLABreachedCount: number | null;
  SLACompliancePct: number | null;
  CSATCount: number | null;
  CSATAverage: number | null;
  CreatedAt: string | null;
}

interface AgentSummary {
  agentName: string;
  tierCode: string;
  team: string;
  daysInRange: number;
  // Performance
  solvedTotal: number;
  solvedAvgPerDay: number;
  ticketsPerHourAvg: number | null;
  openTicketsAvg: number;
  openOver2hAvg: number;
  openNoUpdateAvg: number;
  oldestTicketMax: number;
  // Quality
  qaScored: number;
  qaOverallAvg: number | null;
  qaAccuracyAvg: number | null;
  qaClarityAvg: number | null;
  qaToneAvg: number | null;
  qaGreen: number;
  qaAmber: number;
  qaRed: number;
  qaConcerning: number;
  // Golden Rules
  goldenRulesScored: number;
  goldenRulesAvg: number | null;
  ownershipAvg: number | null;
  nextActionAvg: number | null;
  timeframeAvg: number | null;
  // SLA
  slaResolved: number;
  slaBreached: number;
  slaCompliancePct: number | null;
  // CSAT
  csatCount: number;
  csatAvg: number | null;
  // Trends (week-on-week % change)
  trendSolved: number | null;
  trendQA: number | null;
  trendSLA: number | null;
  trendCSAT: number | null;
}

type DateRange = '7' | '30' | '90' | 'custom';
type SortField = 'agentName' | 'solvedTotal' | 'ticketsPerHourAvg' | 'qaOverallAvg' | 'slaCompliancePct' | 'csatAvg' | 'openOver2hAvg' | 'goldenRulesAvg';
type SortDir = 'asc' | 'desc';

/* ------------------------------------------------------------------ */
/*  Theme                                                              */
/* ------------------------------------------------------------------ */

const C = {
  bg0: '#1e2228',
  bg1: '#272C33',
  bg2: '#2f353d',
  glass: 'rgba(255,255,255,0.03)',
  glassHover: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.06)',
  teal: '#5ec1ca',
  purple: '#7c3aed',
  green: '#059669',
  amber: '#d97706',
  red: '#ef4444',
  text1: '#e2e8f0',
  text2: '#94a3b8',
  text3: '#64748b',
} as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function avg(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((a, b) => a + (b ?? 0), 0);
}

function fmt(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined) return '—';
  return Number.isFinite(v) ? v.toFixed(dp) : '—';
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${Number.isFinite(v) ? v.toFixed(1) : '—'}%`;
}

function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return Math.round(v).toString();
}

function trendArrow(v: number | null, invertDirection = false): { text: string; color: string } {
  if (v === null || !Number.isFinite(v)) return { text: '', color: C.text3 };
  const isPositive = invertDirection ? v < 0 : v > 0;
  const isNegative = invertDirection ? v > 0 : v < 0;
  const arrow = v > 0 ? '↑' : v < 0 ? '↓' : '→';
  const color = isPositive ? C.green : isNegative ? C.red : C.text3;
  return { text: `${arrow}${Math.abs(v).toFixed(0)}%`, color };
}

function slaColor(pct: number | null): string {
  if (pct === null) return C.text3;
  if (pct >= 95) return C.green;
  if (pct >= 90) return C.amber;
  return C.red;
}

function qaColor(score: number | null): string {
  if (score === null) return C.text3;
  if (score >= 8) return C.green;
  if (score >= 6) return C.amber;
  return C.red;
}

function grColor(score: number | null): string {
  if (score === null) return C.text3;
  if (score >= 2.5) return C.green;
  if (score >= 2.0) return C.amber;
  return C.red;
}

/** Compute standard deviation */
function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/* ------------------------------------------------------------------ */
/*  Data Aggregation                                                   */
/* ------------------------------------------------------------------ */

function aggregateAgents(rows: AgentDailyRow[]): AgentSummary[] {
  // Group by AgentName. NOVA AI is excluded: it is not a person, it works round the
  // clock, and leaving it in skews every team average on this page as well as the
  // ranking.
  const byAgent = new Map<string, AgentDailyRow[]>();
  for (const row of rows) {
    const name = row.AgentName;
    if (isNovaAi(name)) continue;
    if (!byAgent.has(name)) byAgent.set(name, []);
    byAgent.get(name)!.push(row);
  }

  const summaries: AgentSummary[] = [];
  for (const [agentName, agentRows] of byAgent) {
    // Sort by date ascending for trend calculation
    const sorted = [...agentRows].sort((a, b) => a.ReportDate.localeCompare(b.ReportDate));
    const latest = sorted[sorted.length - 1];

    // Split into two halves for week-on-week trend
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);

    const solvedTotal = sum(sorted.map(r => r.SolvedTickets_Today));
    const solvedFirstHalf = sum(firstHalf.map(r => r.SolvedTickets_Today));
    const solvedSecondHalf = sum(secondHalf.map(r => r.SolvedTickets_Today));

    // Trend: % change from first half to second half
    function pctChange(first: number | null, second: number | null): number | null {
      if (first === null || second === null) return null;
      if (first === 0) return second === 0 ? 0 : 100;
      return ((second - first) / Math.abs(first)) * 100;
    }

    const qaFirst = avg(firstHalf.map(r => r.QAOverallAvg));
    const qaSecond = avg(secondHalf.map(r => r.QAOverallAvg));

    const slaFirst = avg(firstHalf.map(r => r.SLACompliancePct));
    const slaSecond = avg(secondHalf.map(r => r.SLACompliancePct));

    const csatFirst = avg(firstHalf.map(r => r.CSATAverage));
    const csatSecond = avg(secondHalf.map(r => r.CSATAverage));

    // Tickets per hour — only count rows where TicketsPerHour is not null and > 0
    const tphValues = sorted.map(r => r.TicketsPerHour).filter((v): v is number => v !== null && v > 0);

    summaries.push({
      agentName,
      tierCode: latest.TierCode ?? '',
      team: latest.Team ?? '',
      daysInRange: sorted.length,
      // Performance
      solvedTotal,
      solvedAvgPerDay: sorted.length > 0 ? solvedTotal / sorted.length : 0,
      ticketsPerHourAvg: tphValues.length > 0 ? tphValues.reduce((a, b) => a + b, 0) / tphValues.length : null,
      openTicketsAvg: avg(sorted.map(r => r.OpenTickets_Total)) ?? 0,
      openOver2hAvg: avg(sorted.map(r => r.OpenTickets_Over2Hours)) ?? 0,
      openNoUpdateAvg: avg(sorted.map(r => r.OpenTickets_NoUpdateToday)) ?? 0,
      // Latest day, not the max across the range — a max only ever ratchets up, so it
      // reported the worst day the range had ever seen as if it were the current oldest.
      oldestTicketMax: latest.OldestTicketDays ?? 0,
      // Quality
      qaScored: sum(sorted.map(r => r.QATicketsScored)),
      qaOverallAvg: avg(sorted.map(r => r.QAOverallAvg)),
      qaAccuracyAvg: avg(sorted.map(r => r.QAAccuracyAvg)),
      qaClarityAvg: avg(sorted.map(r => r.QAClarityAvg)),
      qaToneAvg: avg(sorted.map(r => r.QAToneAvg)),
      qaGreen: sum(sorted.map(r => r.QAGreenCount)),
      qaAmber: sum(sorted.map(r => r.QAAmberCount)),
      qaRed: sum(sorted.map(r => r.QARedCount)),
      qaConcerning: sum(sorted.map(r => r.QAConcerningCount)),
      // Golden Rules
      goldenRulesScored: sum(sorted.map(r => r.GoldenRulesScored)),
      goldenRulesAvg: avg(sorted.map(r => r.GoldenRulesAvg)),
      ownershipAvg: avg(sorted.map(r => r.OwnershipAvg)),
      nextActionAvg: avg(sorted.map(r => r.NextActionAvg)),
      timeframeAvg: avg(sorted.map(r => r.TimeframeAvg)),
      // SLA
      slaResolved: solvedTotal,
      slaBreached: sum(sorted.map(r => r.SLABreachedCount)),
      slaCompliancePct: solvedTotal === 0 ? null : ((solvedTotal - sum(sorted.map(r => r.SLABreachedCount))) / solvedTotal) * 100,
      // CSAT
      csatCount: sum(sorted.map(r => r.CSATCount)),
      csatAvg: avg(sorted.map(r => r.CSATAverage)),
      // Trends
      trendSolved: pctChange(solvedFirstHalf, solvedSecondHalf),
      trendQA: pctChange(qaFirst, qaSecond),
      trendSLA: pctChange(slaFirst, slaSecond),
      trendCSAT: pctChange(csatFirst, csatSecond),
    });
  }

  return summaries;
}

function computeTeamAverage(summaries: AgentSummary[]): AgentSummary | null {
  if (summaries.length === 0) return null;
  return {
    agentName: 'Team Average',
    tierCode: '',
    team: '',
    daysInRange: Math.round(avg(summaries.map(s => s.daysInRange)) ?? 0),
    solvedTotal: Math.round(avg(summaries.map(s => s.solvedTotal)) ?? 0),
    solvedAvgPerDay: avg(summaries.map(s => s.solvedAvgPerDay)) ?? 0,
    ticketsPerHourAvg: avg(summaries.map(s => s.ticketsPerHourAvg)),
    openTicketsAvg: avg(summaries.map(s => s.openTicketsAvg)) ?? 0,
    openOver2hAvg: avg(summaries.map(s => s.openOver2hAvg)) ?? 0,
    openNoUpdateAvg: avg(summaries.map(s => s.openNoUpdateAvg)) ?? 0,
    oldestTicketMax: Math.round(avg(summaries.map(s => s.oldestTicketMax)) ?? 0),
    qaScored: Math.round(avg(summaries.map(s => s.qaScored)) ?? 0),
    qaOverallAvg: avg(summaries.map(s => s.qaOverallAvg)),
    qaAccuracyAvg: avg(summaries.map(s => s.qaAccuracyAvg)),
    qaClarityAvg: avg(summaries.map(s => s.qaClarityAvg)),
    qaToneAvg: avg(summaries.map(s => s.qaToneAvg)),
    qaGreen: Math.round(avg(summaries.map(s => s.qaGreen)) ?? 0),
    qaAmber: Math.round(avg(summaries.map(s => s.qaAmber)) ?? 0),
    qaRed: Math.round(avg(summaries.map(s => s.qaRed)) ?? 0),
    qaConcerning: Math.round(avg(summaries.map(s => s.qaConcerning)) ?? 0),
    goldenRulesScored: Math.round(avg(summaries.map(s => s.goldenRulesScored)) ?? 0),
    goldenRulesAvg: avg(summaries.map(s => s.goldenRulesAvg)),
    ownershipAvg: avg(summaries.map(s => s.ownershipAvg)),
    nextActionAvg: avg(summaries.map(s => s.nextActionAvg)),
    timeframeAvg: avg(summaries.map(s => s.timeframeAvg)),
    slaResolved: Math.round(avg(summaries.map(s => s.slaResolved)) ?? 0),
    slaBreached: Math.round(avg(summaries.map(s => s.slaBreached)) ?? 0),
    slaCompliancePct: avg(summaries.map(s => s.slaCompliancePct)),
    csatCount: Math.round(avg(summaries.map(s => s.csatCount)) ?? 0),
    csatAvg: avg(summaries.map(s => s.csatAvg)),
    trendSolved: null,
    trendQA: null,
    trendSLA: null,
    trendCSAT: null,
  };
}

/* ------------------------------------------------------------------ */
/*  Sub-Components                                                     */
/* ------------------------------------------------------------------ */

function MetricCard({ label, value, subtitle, color, trend, invertTrend }: {
  label: string; value: string; subtitle?: string; color?: string;
  trend?: number | null; invertTrend?: boolean;
}) {
  const t = trend !== undefined ? trendArrow(trend ?? null, invertTrend) : null;
  return (
    <div style={{
      background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '16px 20px', borderLeft: `3px solid ${color || C.teal}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: color || C.text1 }}>{value}</span>
        {t && t.text && (
          <span style={{ fontSize: 12, fontWeight: 600, color: t.color }}>{t.text}</span>
        )}
      </div>
      {subtitle && <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.8px', color: C.teal, margin: 0,
      }}>{title}</h3>
      {subtitle && <p style={{ fontSize: 10, color: C.text3, margin: '2px 0 0' }}>{subtitle}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin Table View                                                   */
/* ------------------------------------------------------------------ */

function AdminTableView({ summaries, teamAvg }: { summaries: AgentSummary[]; teamAvg: AgentSummary | null }) {
  const [sortField, setSortField] = useState<SortField>('solvedTotal');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [filterTier, setFilterTier] = useState<string>('all');
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const teams = useMemo(() => [...new Set(summaries.map(s => s.team).filter(Boolean))].sort(), [summaries]);
  const tiers = useMemo(() => [...new Set(summaries.map(s => s.tierCode).filter(Boolean))].sort(), [summaries]);

  // Compute outlier thresholds per metric
  const outliers = useMemo(() => {
    const fields: (keyof AgentSummary)[] = ['solvedTotal', 'qaOverallAvg', 'slaCompliancePct', 'openOver2hAvg'];
    const result: Record<string, { mean: number; sd: number }> = {};
    for (const f of fields) {
      const vals = summaries.map(s => s[f] as number | null).filter((v): v is number => v !== null);
      const mean = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      result[f] = { mean, sd: stddev(vals) };
    }
    return result;
  }, [summaries]);

  function isOutlier(agent: AgentSummary, field: keyof AgentSummary): boolean {
    const val = agent[field] as number | null;
    if (val === null || !outliers[field]) return false;
    return Math.abs(val - outliers[field].mean) > outliers[field].sd;
  }

  const filtered = useMemo(() => {
    let list = summaries;
    if (filterTeam !== 'all') list = list.filter(s => s.team === filterTeam);
    if (filterTier !== 'all') list = list.filter(s => s.tierCode === filterTier);
    return list;
  }, [summaries, filterTeam, filterTier]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortField] ?? -Infinity;
      const bv = b[sortField] ?? -Infinity;
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filtered, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const thStyle = (field: SortField, align: 'left' | 'center' = 'center'): React.CSSProperties => ({
    padding: '12px 10px', textAlign: align,
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.4px', color: sortField === field ? C.teal : C.text3,
    background: C.bg1, borderBottom: `1px solid ${C.border}`,
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
  });

  const tdStyle: React.CSSProperties = {
    padding: '10px 10px', borderBottom: `1px solid ${C.border}`,
    fontSize: 13, textAlign: 'center',
  };

  function renderAgentRow(agent: AgentSummary, isTeamAvg = false) {
    const rowBg = isTeamAvg
      ? `${C.teal}08`
      : expandedAgent === agent.agentName ? C.glassHover : 'transparent';

    return (
      <tr
        key={agent.agentName}
        onClick={() => !isTeamAvg && setExpandedAgent(expandedAgent === agent.agentName ? null : agent.agentName)}
        style={{
          background: rowBg, cursor: isTeamAvg ? 'default' : 'pointer',
          transition: 'background 0.15s',
        }}
      >
        {/* Agent */}
        <td style={{ ...tdStyle, textAlign: 'left', fontWeight: isTeamAvg ? 700 : 500, color: isTeamAvg ? C.teal : C.text1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {agent.agentName}
            {!isTeamAvg && agent.tierCode && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: C.purple,
                padding: '1px 6px', borderRadius: 6, background: `${C.purple}15`,
              }}>{agent.tierCode}</span>
            )}
          </div>
          {!isTeamAvg && (
            <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>{agent.team}</div>
          )}
        </td>

        {/* Solved */}
        <td style={{ ...tdStyle, fontWeight: 700, color: agent.solvedTotal > 0 ? C.text1 : C.text3 }}>
          <div>{agent.solvedTotal}</div>
          {!isTeamAvg && (
            <div style={{ fontSize: 10, color: C.text3 }}>{fmt(agent.solvedAvgPerDay)}/day</div>
          )}
          {!isTeamAvg && agent.trendSolved !== null && (() => {
            const t = trendArrow(agent.trendSolved);
            return t.text ? <div style={{ fontSize: 10, color: t.color }}>{t.text}</div> : null;
          })()}
        </td>

        {/* TPH */}
        <td style={{
          ...tdStyle, fontWeight: 600,
          color: agent.ticketsPerHourAvg !== null ? C.text1 : C.text3,
          ...(isOutlier(agent, 'solvedTotal') && !isTeamAvg ? { background: `${C.amber}10` } : {}),
        }}>
          {fmt(agent.ticketsPerHourAvg, 2)}
        </td>

        {/* Open >2h */}
        <td style={{
          ...tdStyle, fontWeight: 600,
          color: agent.openOver2hAvg > 0 ? C.red : C.text3,
          ...(isOutlier(agent, 'openOver2hAvg') && !isTeamAvg ? { background: `${C.red}10` } : {}),
        }}>
          {fmt(agent.openOver2hAvg)}
        </td>

        {/* QA Score */}
        <td style={{
          ...tdStyle, fontWeight: 700,
          color: qaColor(agent.qaOverallAvg),
          ...(isOutlier(agent, 'qaOverallAvg') && !isTeamAvg ? { background: `${qaColor(agent.qaOverallAvg)}10` } : {}),
        }}>
          {agent.qaOverallAvg !== null ? (
            <>
              <div>{fmt(agent.qaOverallAvg)}</div>
              {!isTeamAvg && agent.trendQA !== null && (() => {
                const t = trendArrow(agent.trendQA);
                return t.text ? <div style={{ fontSize: 10, color: t.color }}>{t.text}</div> : null;
              })()}
            </>
          ) : '—'}
        </td>

        {/* QA RAG */}
        <td style={tdStyle}>
          {(agent.qaGreen > 0 || agent.qaAmber > 0 || agent.qaRed > 0) ? (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: C.green, padding: '1px 5px', borderRadius: 4, background: `${C.green}15` }}>{agent.qaGreen}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: C.amber, padding: '1px 5px', borderRadius: 4, background: `${C.amber}15` }}>{agent.qaAmber}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: C.red, padding: '1px 5px', borderRadius: 4, background: `${C.red}15` }}>{agent.qaRed}</span>
            </div>
          ) : '—'}
        </td>

        {/* Golden Rules */}
        <td style={{ ...tdStyle, fontWeight: 600, color: grColor(agent.goldenRulesAvg) }}>
          {fmt(agent.goldenRulesAvg)}
        </td>

        {/* SLA */}
        <td style={{
          ...tdStyle, fontWeight: 700,
          color: slaColor(agent.slaCompliancePct),
          ...(isOutlier(agent, 'slaCompliancePct') && !isTeamAvg ? { background: `${slaColor(agent.slaCompliancePct)}10` } : {}),
        }}>
          {agent.slaCompliancePct !== null ? (
            <>
              <div>{fmtPct(agent.slaCompliancePct)}</div>
              <div style={{ fontSize: 10, color: C.text3 }}>{agent.slaResolved}R / {agent.slaBreached}B</div>
              {!isTeamAvg && agent.trendSLA !== null && (() => {
                const t = trendArrow(agent.trendSLA);
                return t.text ? <div style={{ fontSize: 10, color: t.color }}>{t.text}</div> : null;
              })()}
            </>
          ) : '—'}
        </td>

        {/* CSAT */}
        <td style={{ ...tdStyle, fontWeight: 600, color: agent.csatAvg !== null ? C.text1 : C.text3 }}>
          {agent.csatAvg !== null ? (
            <>
              <div>{fmt(agent.csatAvg)}</div>
              <div style={{ fontSize: 10, color: C.text3 }}>{agent.csatCount} responses</div>
              {agent.csatCount > 0 && agent.csatCount < 5 && (
                <div style={{ fontSize: 9, color: C.amber, fontStyle: 'italic' }}>Low sample</div>
              )}
            </>
          ) : '—'}
        </td>
      </tr>
    );
  }

  function renderExpandedRow(agent: AgentSummary) {
    return (
      <tr key={`${agent.agentName}-detail`}>
        <td colSpan={9} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}>
          <div style={{
            padding: '16px 24px', background: `${C.teal}04`,
            borderTop: `1px solid ${C.teal}15`,
          }}>
            <SingleAgentDashboard summary={agent} />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={filterTeam}
          onChange={e => setFilterTeam(e.target.value)}
          style={{
            padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.bg2, color: C.text1, fontSize: 12,
          }}
        >
          <option value="all">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterTier}
          onChange={e => setFilterTier(e.target.value)}
          style={{
            padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.bg2, color: C.text1, fontSize: 12,
          }}
        >
          <option value="all">All Tiers</option>
          {tiers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div style={{
          padding: '6px 12px', borderRadius: 8, background: `${C.teal}15`,
          border: `1px solid ${C.teal}30`, fontSize: 11, fontWeight: 600, color: C.teal,
          display: 'flex', alignItems: 'center',
        }}>
          {filtered.length} agents
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        overflow: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              <th onClick={() => toggleSort('agentName')} style={thStyle('agentName', 'left')}>
                Agent{sortIcon('agentName')}
              </th>
              <th onClick={() => toggleSort('solvedTotal')} style={thStyle('solvedTotal')}>
                Solved{sortIcon('solvedTotal')}
              </th>
              <th onClick={() => toggleSort('ticketsPerHourAvg')} style={thStyle('ticketsPerHourAvg')}>
                TPH{sortIcon('ticketsPerHourAvg')}
              </th>
              <th onClick={() => toggleSort('openOver2hAvg')} style={thStyle('openOver2hAvg')}>
                &gt;2h Avg{sortIcon('openOver2hAvg')}
              </th>
              <th onClick={() => toggleSort('qaOverallAvg')} style={thStyle('qaOverallAvg')}>
                QA Score{sortIcon('qaOverallAvg')}
              </th>
              <th style={{
                ...thStyle('qaOverallAvg'),
                cursor: 'default',
                color: C.text3,
              }}>
                QA RAG
              </th>
              <th onClick={() => toggleSort('goldenRulesAvg')} style={thStyle('goldenRulesAvg')}>
                Golden Rules{sortIcon('goldenRulesAvg')}
              </th>
              <th onClick={() => toggleSort('slaCompliancePct')} style={thStyle('slaCompliancePct')}>
                SLA %{sortIcon('slaCompliancePct')}
              </th>
              <th onClick={() => toggleSort('csatAvg')} style={thStyle('csatAvg')}>
                CSAT{sortIcon('csatAvg')}
              </th>
            </tr>
          </thead>
          <tbody>
            {teamAvg && renderAgentRow(teamAvg, true)}
            {sorted.map(agent => (
              <>
                {renderAgentRow(agent)}
                {expandedAgent === agent.agentName && renderExpandedRow(agent)}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Single Agent Dashboard (non-admin view + expanded row detail)      */
/* ------------------------------------------------------------------ */

function SingleAgentDashboard({ summary }: { summary: AgentSummary }) {
  const s = summary;
  const qaTotal = s.qaGreen + s.qaAmber + s.qaRed;
  const qaGreenPct = qaTotal > 0 ? (s.qaGreen / qaTotal) * 100 : 0;
  const qaAmberPct = qaTotal > 0 ? (s.qaAmber / qaTotal) * 100 : 0;
  const qaRedPct = qaTotal > 0 ? (s.qaRed / qaTotal) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Performance */}
      <div>
        <SectionTitle title="Performance" subtitle={`${s.daysInRange} days in range`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <MetricCard label="Tickets Resolved" value={fmtInt(s.solvedTotal)} subtitle={`${fmt(s.solvedAvgPerDay)} avg/day`} trend={s.trendSolved} />
          <MetricCard label="Tickets Per Hour" value={fmt(s.ticketsPerHourAvg, 2)} subtitle="Target: ≥1.5 TPH" color={s.ticketsPerHourAvg !== null && s.ticketsPerHourAvg >= 1.5 ? C.green : s.ticketsPerHourAvg !== null && s.ticketsPerHourAvg >= 1.0 ? C.amber : C.teal} />
          <MetricCard label="Avg Open Tickets" value={fmt(s.openTicketsAvg)} subtitle="Lower is better" />
          <MetricCard label="Avg >2h Overdue" value={fmt(s.openOver2hAvg)} subtitle="Target: 0" color={s.openOver2hAvg > 0 ? C.red : C.green} invertTrend />
          <MetricCard label="Avg No Update" value={fmt(s.openNoUpdateAvg)} subtitle="Same-day; 7d for Dev/T3" color={s.openNoUpdateAvg > 1 ? C.amber : s.openNoUpdateAvg === 0 ? C.green : C.text3} invertTrend />
          <MetricCard label="Oldest Ticket (days)" value={fmtInt(s.oldestTicketMax)} subtitle="Target: ≤3 days" color={s.oldestTicketMax <= 3 ? C.green : s.oldestTicketMax <= 7 ? C.amber : C.red} />
        </div>
      </div>

      {/* Quality */}
      <div>
        <SectionTitle title="Quality" subtitle={`${s.qaScored} tickets scored`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <MetricCard label="QA Score Overall" value={fmt(s.qaOverallAvg)} subtitle="Target: ≥8.0 by Day 90" color={qaColor(s.qaOverallAvg)} trend={s.trendQA} />
          <MetricCard label="Accuracy" value={fmt(s.qaAccuracyAvg)} subtitle="Target: ≥8.0" color={qaColor(s.qaAccuracyAvg)} />
          <MetricCard label="Clarity" value={fmt(s.qaClarityAvg)} subtitle="Target: ≥8.0" color={qaColor(s.qaClarityAvg)} />
          <MetricCard label="Tone" value={fmt(s.qaToneAvg)} subtitle="Target: ≥8.0" color={qaColor(s.qaToneAvg)} />
          <div style={{
            background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: '16px 20px', borderLeft: `3px solid ${C.purple}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 8 }}>QA Traffic Light</div>
            {qaTotal > 0 ? (
              <>
                {/* Stacked bar */}
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                  {qaGreenPct > 0 && <div style={{ width: `${qaGreenPct}%`, background: C.green }} />}
                  {qaAmberPct > 0 && <div style={{ width: `${qaAmberPct}%`, background: C.amber }} />}
                  {qaRedPct > 0 && <div style={{ width: `${qaRedPct}%`, background: C.red }} />}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{s.qaGreen}G ({qaGreenPct.toFixed(0)}%)</span>
                  <span style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>{s.qaAmber}A ({qaAmberPct.toFixed(0)}%)</span>
                  <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>{s.qaRed}R ({qaRedPct.toFixed(0)}%)</span>
                </div>
              </>
            ) : <span style={{ fontSize: 13, color: C.text3 }}>No scored tickets</span>}
          </div>
          <MetricCard label="Concerning Tickets" value={fmtInt(s.qaConcerning)} subtitle="Target: 0" color={s.qaConcerning > 0 ? C.red : C.green} />
        </div>
      </div>

      {/* Golden Rules */}
      <div>
        <SectionTitle title="Golden Rules" subtitle={`${s.goldenRulesScored} tickets scored`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <MetricCard label="Overall Score" value={fmt(s.goldenRulesAvg)} subtitle="Target: ≥2.5 / 3" color={grColor(s.goldenRulesAvg)} />
          <MetricCard label="Ownership" value={fmt(s.ownershipAvg)} subtitle="Target: ≥2.5 / 3" color={grColor(s.ownershipAvg)} />
          <MetricCard label="Next Action" value={fmt(s.nextActionAvg)} subtitle="Target: ≥2.5 / 3" color={grColor(s.nextActionAvg)} />
          <MetricCard label="Timeframe" value={fmt(s.timeframeAvg)} subtitle="Target: ≥2.5 / 3" color={grColor(s.timeframeAvg)} />
        </div>
      </div>

      {/* SLA */}
      <div>
        <SectionTitle title="SLA Compliance" subtitle="Target: ≥95%" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <MetricCard label="SLA Compliance" value={fmtPct(s.slaCompliancePct)} subtitle="Target: ≥95%" color={slaColor(s.slaCompliancePct)} trend={s.trendSLA} />
          <MetricCard label="Resolved" value={fmtInt(s.slaResolved)} subtitle="Within SLA" color={C.green} />
          <MetricCard label="Breached" value={fmtInt(s.slaBreached)} subtitle="Target: 0" color={s.slaBreached > 0 ? C.red : C.green} />
        </div>
      </div>

      {/* CSAT */}
      <div>
        <SectionTitle title="CSAT" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <MetricCard
            label="CSAT Average"
            value={s.csatAvg !== null ? fmt(s.csatAvg) : '—'}
            subtitle={s.csatCount > 0 && s.csatCount < 5 ? 'Target: ≥4.0 / Low sample — treat with caution' : `Target: ≥4.0 / ${s.csatCount} responses`}
            color={s.csatAvg !== null ? (s.csatAvg >= 4.0 ? C.green : s.csatAvg >= 3.0 ? C.amber : C.red) : C.text3}
            trend={s.trendCSAT}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function AgentKpisView() {
  const [rawData, setRawData] = useState<AgentDailyRow[]>([]);
  const [scopedAgent, setScopedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [viewMode, setViewMode] = useState<'team' | 'my'>('team');
  const env = 'live' as const;

  const fetchData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      let url = `/api/kpi-data/agent-kpis?env=${env}`;
      if (dateRange === 'custom' && customFrom && customTo) {
        url += `&from=${customFrom}&to=${customTo}`;
      } else {
        url += `&days=${dateRange}`;
      }
      if (viewMode === 'my') url += '&scope=self';
      const res = await fetch(url);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to load data');
      setRawData(json.data || []);
      setScopedAgent(json.scopedAgent ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [dateRange, customFrom, customTo, viewMode, env]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Inject keyframes
  useEffect(() => {
    const id = 'agent-kpis-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes akFadeIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes akGradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById(id)?.remove(); };
  }, []);

  const summaries = useMemo(() => aggregateAgents(rawData), [rawData]);
  const teamAvg = useMemo(() => computeTeamAverage(summaries), [summaries]);
  const isAdmin = scopedAgent === null && viewMode === 'team';

  if (loading) {
    return (
      <div style={{ padding: 32, background: C.bg0, minHeight: '100vh' }}>
        <div style={{
          height: 56, background: C.glass, border: `1px solid ${C.border}`,
          borderRadius: 12, marginBottom: 32,
          animation: 'akFadeIn 1.5s ease-in-out infinite alternate',
        }} />
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12,
        }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: 20, height: 100, opacity: 0.3 + (i * 0.1),
            }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: 32, background: C.bg0, minHeight: '100vh',
      fontFamily: "'Figtree', 'Plus Jakarta Sans', system-ui, sans-serif",
      color: C.text1,
    }}>
      {/* Top Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', marginBottom: 24,
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Animated gradient top border */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${C.teal}, ${C.purple}, ${C.teal})`,
          backgroundSize: '200% 100%',
          animation: 'akGradient 4s ease-in-out infinite',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.teal}, ${C.purple})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
            boxShadow: `0 0 20px ${C.teal}40`,
          }}>A</div>
          <div>
            <h1 style={{
              fontSize: 20, fontWeight: 800, margin: 0, color: C.text1,
              letterSpacing: '-0.3px',
            }}>
              Agent KPIs
              {scopedAgent && (
                <span style={{ fontSize: 14, fontWeight: 500, color: C.teal, marginLeft: 10 }}>
                  — {scopedAgent}
                </span>
              )}
            </h1>
            <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>
              {isAdmin ? 'All agents • admin view' : 'Personal performance metrics'}
            </p>
          </div>

          {/* My KPIs / Team KPIs toggle — only shown when user has admin access */}
          {(viewMode === 'team' && scopedAgent === null) || viewMode === 'my' ? (
            <div style={{
              display: 'flex', borderRadius: 20, overflow: 'hidden',
              border: `1px solid ${C.border}`, marginLeft: 16,
            }}>
              {([
                { id: 'my' as const, label: 'My KPIs' },
                { id: 'team' as const, label: 'Team KPIs' },
              ]).map(m => (
                <button
                  key={m.id}
                  onClick={() => setViewMode(m.id)}
                  style={{
                    padding: '6px 16px', border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, transition: 'all 0.2s',
                    background: viewMode === m.id ? `${C.teal}20` : 'transparent',
                    color: viewMode === m.id ? C.teal : C.text3,
                  }}
                >{m.label}</button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Date range selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(['7', '30', '90'] as DateRange[]).map(d => (
            <button
              key={d}
              onClick={() => setDateRange(d)}
              style={{
                padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, transition: 'all 0.2s',
                background: dateRange === d ? `${C.teal}20` : 'transparent',
                color: dateRange === d ? C.teal : C.text3,
              }}
            >{d}d</button>
          ))}
          <button
            onClick={() => setDateRange('custom')}
            style={{
              padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, transition: 'all 0.2s',
              background: dateRange === 'custom' ? `${C.teal}20` : 'transparent',
              color: dateRange === 'custom' ? C.teal : C.text3,
            }}
          >Custom</button>

          {dateRange === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                style={{
                  padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
                  background: C.bg2, color: C.text1, fontSize: 11,
                }}
              />
              <span style={{ color: C.text3, fontSize: 11 }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                style={{
                  padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
                  background: C.bg2, color: C.text1, fontSize: 11,
                }}
              />
            </>
          )}

          <button
            onClick={fetchData}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`,
              background: C.glass, cursor: 'pointer', color: C.text2,
              fontSize: 16, transition: 'all 0.2s',
            }}
            title="Refresh"
          >&#x21bb;</button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 20px', marginBottom: 20, borderRadius: 10,
          background: `${C.red}15`, border: `1px solid ${C.red}30`,
          color: C.red, fontSize: 13, fontWeight: 500,
        }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {summaries.length === 0 && !error && (
        <div style={{
          padding: '40px 20px', textAlign: 'center',
          background: C.glass, border: `1px dashed ${C.border}`, borderRadius: 12,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text2, marginBottom: 8 }}>
            No agent KPI data found
          </div>
          <div style={{ fontSize: 12, color: C.text3 }}>
            Try expanding the date range or check that the KPI workflow is running.
          </div>
        </div>
      )}

      {/* Content */}
      {summaries.length > 0 && (
        <div style={{ animation: 'akFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) forwards' }}>
          {isAdmin ? (
            <AdminTableView summaries={summaries} teamAvg={teamAvg} />
          ) : (
            <SingleAgentDashboard summary={summaries[0]} />
          )}
        </div>
      )}
    </div>
  );
}
