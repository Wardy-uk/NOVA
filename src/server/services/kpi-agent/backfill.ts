// Agent KPI backfill — hybrid choice: pull historic per-agent daily rows straight
// from the legacy dbo.jira_agent_kpi_daily snapshot (its ~40 columns map directly
// onto our AgentKpiRow). Stocks therefore carry over as LEGACY-definition; flows
// (Solved) are the legacy daily counts. Joined to dbo.Agent for AccountId.

import sql from 'mssql';
import type { SettingsQueries } from '../../db/settings-store.js';
import { getKpiPool } from '../kpi-pipeline.js';
import type { AgentKpiRow } from './compute.js';
import { saveDay } from './store.js';

const ragLow = (v: unknown): 'green' | 'amber' | 'red' | null => {
  const s = (v == null ? '' : String(v)).toLowerCase();
  return s === 'green' || s === 'amber' || s === 'red' ? s : null;
};
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export async function backfillAgentFromLegacy(settings: SettingsQueries, fromDay: string, toDay: string): Promise<{ days: number; rows: number }> {
  const pool = await getKpiPool(settings);
  const req = pool.request();
  req.input('from', sql.Date, fromDay);
  req.input('to', sql.Date, toDay);
  const result = await req.query(`
    SELECT CONVERT(varchar(10), d.ReportDate, 23) AS d, a.AccountId, d.AgentId, d.AgentName, d.TierCode, d.Team,
           d.OpenTickets_Total, d.OpenTickets_Over2Hours, d.OpenTickets_NoUpdateToday,
           d.SolvedTickets_Today, d.SolvedTickets_ThisWeek, d.OldestTicketDays,
           d.SLACompliancePct, d.SLAResolvedCount, d.SLABreachedCount,
           d.TicketsPerHour, d.CSATAverage, d.CSATCount,
           d.QATicketsScored, d.QAOverallAvg, d.QAAccuracyAvg, d.QAClarityAvg, d.QAToneAvg,
           d.QAGreenCount, d.QAAmberCount, d.QARedCount, d.QAConcerningCount,
           d.GoldenRulesScored, d.GoldenRulesAvg, d.OwnershipAvg, d.NextActionAvg, d.TimeframeAvg,
           d.ragProductivity, d.ragCSAT, d.ragQA, d.ragGoldenRules, d.ragOver2h, d.ragStale, d.ragSLA, d.ragOldestTicket
    FROM dbo.jira_agent_kpi_daily d
    LEFT JOIN dbo.Agent a ON a.AgentId = d.AgentId
    WHERE d.ReportDate >= @from AND d.ReportDate <= @to AND a.AccountId IS NOT NULL
  `);

  const byDay = new Map<string, AgentKpiRow[]>();
  for (const r of result.recordset as any[]) {
    const row: AgentKpiRow = {
      accountId: r.AccountId, agentId: r.AgentId ?? null, agentName: r.AgentName, tierCode: r.TierCode || '', team: r.Team || '',
      open: n(r.OpenTickets_Total), overSla: n(r.OpenTickets_Over2Hours), noReply: n(r.OpenTickets_NoUpdateToday),
      oldestDays: n(r.OldestTicketDays), oldestKey: null,
      oldestSupportDays: 0, oldestSupportKey: null, // not in legacy snapshot
      withDevelopment: 0,                            // not in legacy snapshot
      slaResolved: n(r.SLAResolvedCount), slaBreached: n(r.SLABreachedCount),

      solvedToday: n(r.SolvedTickets_Today), solvedWeek: n(r.SolvedTickets_ThisWeek),
      qaScored: n(r.QATicketsScored), qaOverall: nOrNull(r.QAOverallAvg), qaAccuracy: nOrNull(r.QAAccuracyAvg),
      qaClarity: nOrNull(r.QAClarityAvg), qaTone: nOrNull(r.QAToneAvg),
      qaGreen: n(r.QAGreenCount), qaAmber: n(r.QAAmberCount), qaRed: n(r.QARedCount), qaConcerning: n(r.QAConcerningCount),
      // The legacy daily snapshot has no rolling window; fall back to the day's own
      // figures. The RAG for backfilled days comes from the stored ragQA/ragGoldenRules
      // below, not from these.
      qaScored7d: n(r.QATicketsScored), qaOverall7d: nOrNull(r.QAOverallAvg),
      grScored7d: n(r.GoldenRulesScored), grOverall7d: nOrNull(r.GoldenRulesAvg),
      grScored: n(r.GoldenRulesScored), grOverall: nOrNull(r.GoldenRulesAvg), grOwnership: nOrNull(r.OwnershipAvg),
      grNextAction: nOrNull(r.NextActionAvg), grTimeframe: nOrNull(r.TimeframeAvg),
      csatAvg: nOrNull(r.CSATAverage), csatCount: n(r.CSATCount),
      slaCompliancePct: nOrNull(r.SLACompliancePct), ticketsPerHour: nOrNull(r.TicketsPerHour),
      rag: {
        productivity: ragLow(r.ragProductivity), csat: ragLow(r.ragCSAT), qa: ragLow(r.ragQA),
        goldenRules: ragLow(r.ragGoldenRules), sla: ragLow(r.ragSLA),
        over2h: ragLow(r.ragOver2h), stale: ragLow(r.ragStale), oldest: ragLow(r.ragOldestTicket),
      },
    };
    if (!byDay.has(r.d)) byDay.set(r.d, []);
    byDay.get(r.d)!.push(row);
  }

  let rows = 0;
  for (const [day, agentRows] of byDay) { await saveDay(day, agentRows); rows += agentRows.length; }
  console.log(`[kpi-agent] backfill ${fromDay}→${toDay}: ${byDay.size} days, ${rows} agent-rows from legacy`);
  return { days: byDay.size, rows };
}
