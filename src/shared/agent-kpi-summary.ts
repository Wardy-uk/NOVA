/**
 * Agent KPI aggregation — the numbers behind the My Performance cards.
 *
 * Shared because the 1-2-1 prep email quotes these figures back at the agent and then asks
 * them what they are proud of and what they want to improve. If the email aggregated the
 * same daily rows its own way, the two would disagree the first time either definition
 * changed, and the person would be answering about numbers nobody else can see.
 *
 * Input rows come from the Rebuild store (`kpi_agent_daily` via `toLegacyAgentRow`),
 * whether read here on the server or fetched by the client from /api/kpi-data/agent-kpis.
 */

export interface AgentDailyRow {
  AgentName: string;
  TierCode: string | null;
  Team: string | null;
  OpenTickets_Total: number | null;
  OpenTickets_Over2Hours: number | null;
  OpenTickets_NoUpdateToday: number | null;
  SolvedTickets_Today: number | null;
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
  FrtCompliancePercent: number | null;
  FrtAvgMinutes: number | null;
  ReportDate: string;
}

export interface AgentSummary {
  agentName: string;
  tierCode: string;
  team: string;
  daysInRange: number;
  solvedTotal: number;
  solvedAvgPerDay: number;
  ticketsPerHourAvg: number | null;
  openTicketsAvg: number;
  openOver2hAvg: number;
  openNoUpdateAvg: number;
  oldestTicketMax: number;
  qaScored: number;
  qaOverallAvg: number | null;
  qaAccuracyAvg: number | null;
  qaClarityAvg: number | null;
  qaToneAvg: number | null;
  qaGreen: number;
  qaAmber: number;
  qaRed: number;
  qaConcerning: number;
  goldenRulesScored: number;
  goldenRulesAvg: number | null;
  ownershipAvg: number | null;
  nextActionAvg: number | null;
  timeframeAvg: number | null;
  slaResolved: number;
  slaBreached: number;
  slaCompliancePct: number | null;
  csatCount: number;
  csatAvg: number | null;
  resolvedTrendPct: number | null;
  frtCompliancePct: number | null;
}

export function avg(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function sum(values: (number | null)[]): number {
  return values.reduce<number>((a, b) => a + (b ?? 0), 0);
}

export function aggregateAgent(rows: AgentDailyRow[]): AgentSummary | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.ReportDate.localeCompare(b.ReportDate));
  const latest = sorted[sorted.length - 1];
  const solvedTotal = sum(sorted.map(r => r.SolvedTickets_Today));
  const tphValues = sorted.map(r => r.TicketsPerHour).filter((v): v is number => v !== null && v > 0);
  const slaBreached = sum(sorted.map(r => r.SLABreachedCount));

  return {
    agentName: latest.AgentName,
    tierCode: latest.TierCode ?? '',
    team: latest.Team ?? '',
    daysInRange: new Set(sorted.map(r => r.ReportDate.slice(0, 10))).size,
    solvedTotal,
    solvedAvgPerDay: sorted.length > 0 ? solvedTotal / sorted.length : 0,
    ticketsPerHourAvg: tphValues.length > 0 ? tphValues.reduce((a, b) => a + b, 0) / tphValues.length : null,
    openTicketsAvg: avg(sorted.map(r => r.OpenTickets_Total)) ?? 0,
    openOver2hAvg: avg(sorted.map(r => r.OpenTickets_Over2Hours)) ?? 0,
    openNoUpdateAvg: avg(sorted.map(r => r.OpenTickets_NoUpdateToday)) ?? 0,
    // The LATEST day's value, not the max across the range. A max can only ever go up:
    // it kept reporting the worst single day the range had ever seen (253 days from a
    // long-gone Development ticket) as if it were today's oldest ticket.
    oldestTicketMax: latest.OldestTicketDays ?? 0,
    qaScored: sum(sorted.map(r => r.QATicketsScored)),
    qaOverallAvg: avg(sorted.map(r => r.QAOverallAvg)),
    qaAccuracyAvg: avg(sorted.map(r => r.QAAccuracyAvg)),
    qaClarityAvg: avg(sorted.map(r => r.QAClarityAvg)),
    qaToneAvg: avg(sorted.map(r => r.QAToneAvg)),
    qaGreen: sum(sorted.map(r => r.QAGreenCount)),
    qaAmber: sum(sorted.map(r => r.QAAmberCount)),
    qaRed: sum(sorted.map(r => r.QARedCount)),
    qaConcerning: sum(sorted.map(r => r.QAConcerningCount)),
    goldenRulesScored: sum(sorted.map(r => r.GoldenRulesScored)),
    goldenRulesAvg: avg(sorted.map(r => r.GoldenRulesAvg)),
    ownershipAvg: avg(sorted.map(r => r.OwnershipAvg)),
    nextActionAvg: avg(sorted.map(r => r.NextActionAvg)),
    timeframeAvg: avg(sorted.map(r => r.TimeframeAvg)),
    slaResolved: solvedTotal,
    slaBreached,
    slaCompliancePct: solvedTotal === 0 ? null : ((solvedTotal - slaBreached) / solvedTotal) * 100,
    csatCount: sum(sorted.map(r => r.CSATCount)),
    csatAvg: avg(sorted.map(r => r.CSATAverage)),
    resolvedTrendPct: (() => {
      if (sorted.length < 4) return null;
      const mid = Math.floor(sorted.length / 2);
      const olderAvg = sum(sorted.slice(0, mid).map(r => r.SolvedTickets_Today)) / mid;
      const recentAvg = sum(sorted.slice(mid).map(r => r.SolvedTickets_Today)) / (sorted.length - mid);
      if (olderAvg === 0) return recentAvg > 0 ? 100 : null;
      return ((recentAvg - olderAvg) / olderAvg) * 100;
    })(),
    frtCompliancePct: avg(sorted.map(r => r.FrtCompliancePercent)),
  };
}
