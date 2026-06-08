// Weekly / monthly rollups for per-agent KPIs. Aggregates the stored daily JSON
// rows (kpi_agent_daily): Solved = sum over the window; operational stocks +
// quality scores = average; RAG recomputed from the averaged values using the
// configurable thresholds.

import type { SettingsQueries } from '../../db/settings-store.js';
import { getAllInRange } from './store.js';
import type { AgentKpiRow } from './compute.js';
import { getRagThresholds, ragHigher, ragLower, type Rag } from './rag.js';

export type Period = 'week' | 'month';

function startOf(period: Period, anchor: string): string {
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
  open: number | null; overSla: number | null; noReply: number | null; oldestDays: number | null;
  qaOverall: number | null; csatAvg: number | null; slaCompliancePct: number | null; ticketsPerHour: number | null;
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

export async function getAgentPeriod(settings: SettingsQueries, period: Period, anchor: string): Promise<{ period: Period; from: string; to: string; agents: AgentPeriodRow[] }> {
  const from = startOf(period, anchor);
  const rows = await getAllInRange(from, anchor);
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
    const csatAvg = avg(nn(days.map(d => d.csatAvg)));
    const slaCompliancePct = avg(nn(days.map(d => d.slaCompliancePct)));
    const ticketsPerHour = avg(nn(days.map(d => d.ticketsPerHour)));
    agents.push({
      accountId, agentName: last.agentName, tierCode: last.tierCode, team: last.team, days: days.length,
      solved: sum(days.map(d => d.solvedToday)),
      open, overSla, noReply, oldestDays, qaOverall, csatAvg, slaCompliancePct, ticketsPerHour,
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
  agents.sort((a, b) => b.solved - a.solved);
  return { period, from, to: anchor, agents };
}
