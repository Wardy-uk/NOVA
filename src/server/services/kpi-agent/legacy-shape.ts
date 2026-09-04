// The legacy dbo.jira_agent_kpi_daily column shape, produced from Rebuild rows.
//
// Several consumers were written against that table's column names — the agent-kpis
// endpoint, the 1-2-1 prep signals, the 1-2-1 session summary. Rather than rewrite
// each of them, they now read the Rebuild store and map through here, so the source
// swap is one change in one place and the shape is defined once.

import type { AgentKpiRow } from './compute.js';

/** YYYY-MM-DD for N days before today (UK). */
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/**
 * Map a Rebuild agent row into the legacy jira_agent_kpi_daily column shape that
 * this endpoint has always returned. Keeping the shape is what lets the source
 * swap underneath every consumer at once.
 *
 * AvailableHours and FrtCompliancePercent are null: the Rebuild engine does not
 * compute them. Neither did anything else — nothing has written FrtCompliancePercent
 * for the whole life of the legacy table, which is why that card reads "—".
 */
export function toLegacyAgentRow(a: AgentKpiRow, date: string) {
  const rag = (r: string | null | undefined) => (r == null ? null : r.charAt(0).toUpperCase() + r.slice(1));
  return {
    ReportDate: date,
    AgentName: a.agentName,
    TierCode: a.tierCode,
    Team: a.team,
    OpenTickets_Total: a.open,
    OpenTickets_Over2Hours: a.overSla,
    OpenTickets_NoUpdateToday: a.noReply,
    SolvedTickets_Today: a.solvedToday,
    SolvedTickets_ThisWeek: a.solvedWeek,
    OldestTicketDays: a.oldestDays,
    OldestTicketKey: a.oldestKey,
    AvailableHours: null,
    TicketsPerHour: a.ticketsPerHour,
    SLAResolvedCount: a.slaResolved,
    SLABreachedCount: a.slaBreached,
    SLACompliancePct: a.slaCompliancePct,
    CSATCount: a.csatCount,
    CSATAverage: a.csatAvg,
    QATicketsScored: a.qaScored,
    QAOverallAvg: a.qaOverall,
    QAAccuracyAvg: a.qaAccuracy,
    QAClarityAvg: a.qaClarity,
    QAToneAvg: a.qaTone,
    QAGreenCount: a.qaGreen,
    QAAmberCount: a.qaAmber,
    QARedCount: a.qaRed,
    QAConcerningCount: a.qaConcerning,
    GoldenRulesScored: a.grScored,
    GoldenRulesAvg: a.grOverall,
    OwnershipAvg: a.grOwnership,
    NextActionAvg: a.grNextAction,
    TimeframeAvg: a.grTimeframe,
    FrtCompliancePercent: null,
    FrtAvgMinutes: null,
    ragProductivity: rag(a.rag?.productivity), ragCSAT: rag(a.rag?.csat), ragQA: rag(a.rag?.qa),
    ragGoldenRules: rag(a.rag?.goldenRules), ragOver2h: rag(a.rag?.over2h), ragStale: rag(a.rag?.stale),
    ragSLA: rag(a.rag?.sla), ragOldestTicket: rag(a.rag?.oldest),
    // Rebuild-only extras. Additive, so existing consumers are unaffected.
    OldestSupportDays: a.oldestSupportDays,
    OldestSupportKey: a.oldestSupportKey,
    WithDevelopment: a.withDevelopment,
  };
}
