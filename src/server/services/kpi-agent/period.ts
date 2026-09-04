// Weekly / monthly rollups for per-agent KPIs. Aggregates the stored daily JSON
// rows (kpi_agent_daily): Solved = sum over the window; operational stocks +
// quality scores = average; RAG recomputed from the averaged values using the
// configurable thresholds.

import type { SettingsQueries } from '../../db/settings-store.js';
import { getAllInRange } from './store.js';
import type { AgentKpiRow } from './compute.js';
import { getRagThresholds, ragHigher, ragLower, type Rag } from './rag.js';

export type Period = 'day' | 'week' | 'month';

/** Resolved tickets an agent needs in the window before their SLA % is ranked on. */
const MIN_SLA_SAMPLE = 5;

function startOf(period: Period, anchor: string): string {
  if (period === 'day') return anchor;
  const d = new Date(`${anchor}T00:00:00Z`);
  if (period === 'month') { d.setUTCDate(1); return d.toISOString().slice(0, 10); }
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 100) / 100 : null);
const sum = (xs: number[]): number => xs.reduce((s, v) => s + v, 0);
const nn = (xs: Array<number | null>): number[] => xs.filter((v): v is number => v != null);

export interface AgentPeriodRow {
  accountId: string; agentName: string; tierCode: string; team: string; days: number;
  solved: number;                       // sum over period
  /** Did this agent do any measurable work in the window? Absence leaves productivity
   *  and SLA null, and a mean over "available metrics" then scores someone on leave
   *  purely on QA carried over from tickets scored earlier — which ranked agents who
   *  were on holiday all week above agents who worked it. */
  hasActivity: boolean;
  open: number | null; overSla: number | null; noReply: number | null; oldestDays: number | null;
  qaOverall: number | null; goldenRulesAvg: number | null; csatAvg: number | null; slaCompliancePct: number | null; ticketsPerHour: number | null;
  // Leaderboard scoring (P3): each metric normalised to 0–100; composite = mean of available.
  productivityScore: number | null; slaScore: number | null; qualityScore: number | null;
  compositeScore: number; points: number;
  rag: Record<string, Rag | null>;
}

// Daily-history grid: agent rows × date columns for one selected metric.
const METRIC_RAG: Record<string, string | null> = {
  solvedToday: null, solvedWeek: null, open: null, overSla: 'over2h', noReply: 'stale',
  oldestDays: 'oldest', qaOverall: 'qa', csatAvg: 'csat', slaCompliancePct: 'sla', ticketsPerHour: 'productivity',
};
export interface AgentGridRow { accountId: string; agentName: string; tierCode: string; cells: Record<string, { value: number | null; rag: string | null }>; }

export async function getAgentHistoryGrid(from: string, to: string, metric: string): Promise<{ dates: string[]; metric: string; rows: AgentGridRow[] }> {
  const m = metric in METRIC_RAG ? metric : 'solvedToday';
  const ragKey = METRIC_RAG[m];
  const rows = await getAllInRange(from, to);
  const dateSet = new Set<string>();
  const byAgent = new Map<string, AgentGridRow>();
  for (const r of rows) {
    dateSet.add(r.date);
    if (!byAgent.has(r.accountId)) byAgent.set(r.accountId, { accountId: r.accountId, agentName: r.agentName, tierCode: r.tierCode, cells: {} });
    const v = (r as unknown as Record<string, unknown>)[m];
    byAgent.get(r.accountId)!.cells[r.date] = { value: typeof v === 'number' ? v : null, rag: ragKey ? (r.rag?.[ragKey] ?? null) : null };
  }
  const dates = [...dateSet].sort();
  const out = [...byAgent.values()].sort((a, b) => a.agentName.localeCompare(b.agentName));
  return { dates, metric: m, rows: out };
}

/**
 * Roll up a period. `liveRows` (the 60s-cached recompute) stands in for today.
 *
 * The stored day is only written at the 18:00 freeze, so for most of the working
 * day there IS no row for today and a "Daily" view silently fell back to the last
 * stored day — yesterday. Agents who were in yesterday and off today still appeared,
 * with yesterday's solves, under a column headed "Solved Today".
 */
export async function getAgentPeriod(
  settings: SettingsQueries, period: Period, anchor: string, liveRows?: AgentKpiRow[],
): Promise<{ period: Period; from: string; to: string; agents: AgentPeriodRow[]; liveToday: boolean }> {
  const from = startOf(period, anchor);
  const todayUk = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const stored = await getAllInRange(from, anchor);
  const useLive = liveRows != null && liveRows.length > 0 && anchor >= todayUk;
  const rows = useLive
    ? [...stored.filter(r => r.date !== todayUk), ...liveRows.map(r => ({ ...r, date: todayUk }))]
    : stored;
  const t = getRagThresholds(settings);

  const byAgent = new Map<string, Array<AgentKpiRow & { date: string }>>();
  for (const r of rows) {
    if (!byAgent.has(r.accountId)) byAgent.set(r.accountId, []);
    byAgent.get(r.accountId)!.push(r);
  }

  const agents: AgentPeriodRow[] = [];
  for (const [accountId, days] of byAgent) {
    const last = days[days.length - 1];
    const open = avg(days.map(d => d.open));
    const overSla = avg(days.map(d => d.overSla));
    const noReply = avg(days.map(d => d.noReply));
    const oldestDays = avg(days.map(d => d.oldestDays));
    const qaOverall = avg(nn(days.map(d => d.qaOverall)));
    const goldenRulesAvg = avg(nn(days.map(d => d.grOverall)));
    const csatAvg = avg(nn(days.map(d => d.csatAvg)));
    const slaCompliancePct = avg(nn(days.map(d => d.slaCompliancePct)));
    const ticketsPerHour = avg(nn(days.map(d => d.ticketsPerHour)));
    const solved = sum(days.map(d => d.solvedToday));

    // Per-category scores, kept for the Productivity / SLA / Quality tab sorts.
    const productivityScore = ticketsPerHour != null ? Math.min(ticketsPerHour * 20, 100) : null; // 5 tix/hr = 100
    const slaScore = slaCompliancePct;                                                             // already 0–100
    // QA is scored 0-10, not 0-5. The old x20 doubled every agent's quality
    // contribution and let the composite exceed its own maximum.
    const qualityScore = qaOverall != null ? qaOverall * 10 : null;                                 // 0–10 → 0–100
    const compositeScore = 0; // Model A, filled in below once the cohort max is known.
    const points = solved
      + (slaCompliancePct != null && slaCompliancePct >= 95 ? 2 * days.length : 0)
      + (qaOverall != null && qaOverall >= 4 ? 3 : 0);

    agents.push({
      accountId, agentName: last.agentName, tierCode: last.tierCode, team: last.team, days: days.length,
      solved,
      hasActivity: solved > 0 || (ticketsPerHour != null && ticketsPerHour > 0),
      open, overSla, noReply, oldestDays, qaOverall, goldenRulesAvg, csatAvg, slaCompliancePct, ticketsPerHour,
      productivityScore, slaScore, qualityScore, compositeScore, points,
      rag: {
        productivity: ragHigher(ticketsPerHour, t.productivity),
        csat: ragHigher(csatAvg, t.csat),
        qa: ragHigher(qaOverall, t.qa),
        sla: ragHigher(slaCompliancePct, t.sla),
        over2h: ragLower(overSla, t.over2h),
        stale: ragLower(noReply, t.stale),
        oldest: ragLower(oldestDays, t.oldest),
      },
    });
  }
  // ── Model A composite (2026-07) — the same scheme the SLT board ranks on, so the
  // two boards agree by construction instead of by coincidence.
  //
  // SLA 50 / throughput 30 / tickets-per-hour 20, redistributed over whichever
  // dimensions are present. QA and CSAT are deliberately NOT scored: QA sampling is
  // not comparable across agents and CSAT coverage is a fraction of a percent, so
  // both are context, shown but not ranked on.
  //
  // Replaces a plain mean of normalised metrics, which gave a near-idle agent the
  // same billing for a perfect SLA as a busy one: 1 ticket solved at 0.1/hr with
  // 100% SLA and a good QA came second on the board.
  const maxSolved = Math.max(1, ...agents.map(a => a.solved));
  for (const a of agents) {
    const parts: Array<[number, number]> = [];
    // A percentage off one or two tickets is noise, not performance. Below the
    // floor SLA simply does not count and its weight goes to the dimensions that
    // do — which is what stops "100% of 1" outranking real throughput.
    if (a.slaCompliancePct != null && a.solved >= MIN_SLA_SAMPLE) parts.push([50, a.slaCompliancePct]);
    parts.push([30, (a.solved / maxSolved) * 100]);
    if (a.ticketsPerHour != null) parts.push([20, Math.min(a.ticketsPerHour * 20, 100)]);
    let sv = 0, sw = 0;
    for (const [w, v] of parts) { sv += w * v; sw += w; }
    a.compositeScore = sw > 0 ? Math.round((sv / sw) * 100) / 100 : 0;
  }

  agents.sort((a, b) => b.solved - a.solved);
  return { period, from, to: anchor, agents, liveToday: useLive };
}
