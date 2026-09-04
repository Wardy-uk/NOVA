// Per-agent KPI computation (Layer 3). Roster from dbo.Agent (KPI pool); tier-1
// operational stocks from a single pass over jira_issue_cache bucketed by assignee
// (with the agreed corrected definitions); Solved via the status-transition JQL;
// tier-2 quality read & aggregated from the existing QA/GR/CSAT pipelines; tier-3
// derived + configurable RAG. Mirrors kpi-pipeline's proven SQL.

import type { JiraRestClient, JiraIssue } from '../jira-client.js';
import type { SettingsQueries } from '../../db/settings-store.js';
import { query } from '../database.js';
import { getKpiPool } from '../kpi-pipeline.js';
import { NOVA_JIRA_ACCOUNT_ID } from '../kpi-org/registry.js';
import { getRagThresholds, ragHigher, ragHigherWithSample, ragLower, type Rag } from './rag.js';
import { noReplyCutoff } from '../shared/no-reply.js';

const NOT_ACTIONABLE = new Set(['waiting on requestor', 'waiting on partner', 'waiting on development']);
const FOUR_HOURS = 4 * 60 * 60 * 1000;
const FIFTY_TWO_WEEKS = 52 * 7 * 24 * 60 * 60 * 1000;

export interface AgentKpiRow {
  accountId: string;
  agentId: number | null;
  agentName: string;
  tierCode: string;
  team: string;
  // tier 1
  open: number;
  overSla: number;
  noReply: number;
  oldestDays: number;
  oldestKey: string | null;
  oldestSupportDays: number;   // oldest actionable ticket at tier CC / Tier 2
  oldestSupportKey: string | null;
  withDevelopment: number;     // open tickets parked at tier Development — excluded from the stocks above
  solvedToday: number;
  solvedWeek: number;
  // tier 2
  qaScored: number; qaOverall: number | null; qaAccuracy: number | null; qaClarity: number | null; qaTone: number | null;
  // Rolling 7-day QA / GR — the window the RAG rating is computed on.
  qaScored7d: number; qaOverall7d: number | null;
  grScored7d: number; grOverall7d: number | null;
  qaGreen: number; qaAmber: number; qaRed: number; qaConcerning: number;
  grScored: number; grOverall: number | null; grOwnership: number | null; grNextAction: number | null; grTimeframe: number | null;
  csatAvg: number | null; csatCount: number;
  // tier 3
  slaCompliancePct: number | null;
  // Numerators behind slaCompliancePct. Stored because the agent scorecard shows
  // "Resolved / within SLA / Breached" as counts, not just the percentage.
  slaResolved: number;
  slaBreached: number;
  ticketsPerHour: number | null;
  rag: Record<string, Rag | null>;
}

export function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

// ongoingOnly=true matches Jira's `breached()` JQL: a ticket counts as breached
// only if its CURRENT (ongoing) SLA cycle is breaching. Used for the live "Over
// SLA" stock on open tickets — without it, a completed cycle that breached months
// ago resurrects as a phantom breach. ongoingOnly=false (default) keeps the
// completed-cycle read for resolved tickets, where the final cycle is the answer.
export function slaBreached(fieldsJson: string | null, field: string, ongoingOnly = false): boolean | null {
  if (!fieldsJson) return null;
  let sla: any;
  try { sla = JSON.parse(fieldsJson)?.[field]; } catch { return null; }
  if (!sla) return null;
  const oc = sla.ongoingCycle;
  if (oc) {
    if (oc.breached === true) return true;
    if (oc.remainingTime?.millis != null) return oc.remainingTime.millis < 0;
  }
  // No ongoing breach → not breaching right now.
  if (ongoingOnly) return false;
  const completed = sla.completedCycles;
  if (Array.isArray(completed) && completed.length) {
    const last = completed[completed.length - 1];
    if (last?.breached != null) return last.breached === true;
  }
  return null;
}

function parseCsat(fieldsJson: string | null): number | null {
  if (!fieldsJson) return null;
  try {
    const rating = JSON.parse(fieldsJson)?.customfield_12802?.rating;
    return typeof rating === 'number' && rating >= 1 && rating <= 5 ? rating : null;
  } catch { return null; }
}

export function isNoReply(status: string | null, created: Date | null, lastUpd: Date | null, nextUpd: Date | null, now: Date, currentTier?: string | null): boolean {
  if ((status || '').toLowerCase() === 'waiting on requestor') return false;
  if (!created || now.getTime() - created.getTime() < FOUR_HOURS) return false;
  if (nextUpd && nextUpd > now) return false;
  if (!lastUpd) return false;
  if (lastUpd >= noReplyCutoff(currentTier, now)) return false;
  if (lastUpd < new Date(now.getTime() - FIFTY_TWO_WEEKS)) return false;
  return true;
}

const SUPPORT_TIERS = new Set(['customer care', 'tier 2']);
interface Stat1 { open: number; overSla: number; noReply: number; oldestDays: number; oldestKey: string | null; oldestSupportDays: number; oldestSupportKey: string | null; withDevelopment: number; }

function ukWeekStart(now: Date): string {
  // Monday of the current week (UTC-ish; close enough for the EOD capture).
  const d = new Date(now); const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow); d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function ukDay(now: Date): string { return now.toISOString().slice(0, 10); }
function addDay(day: string): string { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

// Cap on per-ticket changelog fetches for resolver attribution — protects the capture
// runtime + Jira from a huge window. Above it, fall back to current-assignee.
const RESOLVER_FETCH_CAP = 500;

/** Bucket tickets solved during the window by agent. Counts a ticket once if it entered
 *  Resolved/Done that day (excludes the archival "Closed" step). When attributeResolver
 *  is set (daily capture only — too slow for the live path), credit goes to the agent who
 *  performed the resolve transition (from the changelog), not the current assignee. */
async function solvedByAssignee(
  jira: JiraRestClient, fromDay: string, toDay: string, attributeResolver = false,
): Promise<Map<string, number>> {
  // Explicit times on both bounds — a date-only end bound rounds up to 23:59 of that day,
  // which silently added a whole extra day to the window (see TX_DURING_DAY in registry.ts).
  const jql = `project = NT AND status CHANGED TO ("Resolved","Done") DURING ("${fromDay} 00:00","${toDay} 00:00")`;
  const res = await jira.searchJqlAll(jql, ['assignee'], 3000);
  const map = new Map<string, number>();
  const assigneeOf = (issue: JiraIssue) =>
    ((issue.fields as Record<string, unknown>)?.assignee as { accountId?: string } | undefined)?.accountId ?? null;

  if (!attributeResolver || res.issues.length > RESOLVER_FETCH_CAP) {
    for (const issue of res.issues) { const a = assigneeOf(issue); if (a) map.set(a, (map.get(a) || 0) + 1); }
    return map;
  }

  const DONE = new Set(['Resolved', 'Done']);
  const fromMs = Date.parse(`${fromDay}T00:00:00Z`), toMs = Date.parse(`${toDay}T00:00:00Z`);
  for (const issue of res.issues) {
    let resolver: string | null = null;
    try {
      const full = await jira.getIssue(issue.key, ['assignee'], { expand: ['changelog'] });
      const histories = ((full as { changelog?: { histories?: Array<{ created: string; author?: { accountId?: string }; items?: Array<{ field?: string; toString?: string }> }> } } | null)?.changelog?.histories) ?? [];
      for (const h of histories) {
        const t = Date.parse(h.created);
        if (isNaN(t) || t < fromMs || t >= toMs) continue;
        if ((h.items ?? []).some(it => it.field === 'status' && it.toString && DONE.has(it.toString))) {
          resolver = h.author?.accountId ?? resolver; // last resolve in window wins
        }
      }
    } catch { /* fall back to assignee below */ }
    const acc = resolver ?? assigneeOf(issue);
    if (acc) map.set(acc, (map.get(acc) || 0) + 1);
  }
  return map;
}

export async function computeAgentKpis(
  settings: SettingsQueries, jira: JiraRestClient, now: Date = new Date(),
  opts: { attributeResolver?: boolean } = {},
): Promise<AgentKpiRow[]> {
  const pool = await getKpiPool(settings);
  const thresholds = getRagThresholds(settings);
  const day = ukDay(now);
  const tomorrow = addDay(day);
  const weekStart = ukWeekStart(now);

  // 1. Roster (dbo.Agent) — NT space only (Department IN NT/NOVA_AI), matching the legacy breach board.
  const hasDept = (await pool.request().query(
    `SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'Department'`,
  )).recordset.length > 0;
  const deptFilter = hasDept ? "AND Department IN ('NT', 'NOVA_AI')" : '';
  const roster = (await pool.request().query(`
    SELECT AgentId, AccountId,
           RTRIM(LTRIM(ISNULL(AgentName,'') + ' ' + ISNULL(AgentSurname,''))) AS AgentName,
           ISNULL(TierCode,'') AS TierCode, ISNULL(Team,'') AS Team, ISNULL(IsAvailable,0) AS IsAvailable
    FROM dbo.Agent WHERE IsActive = 1 AND AccountId IS NOT NULL ${deptFilter}
  `)).recordset as Array<{ AgentId: number; AccountId: string; AgentName: string; TierCode: string; Team: string; IsAvailable: number }>;

  // 2. Tier-1 stocks from jira_issue_cache (one pass, bucket by assignee). ALL tiers, project NT.
  const openRows = await query<{
    issue_key: string; assignee_account_id: string | null; status_name: string | null; current_tier: string | null;
    jira_created: Date | null; agent_last_updated: Date | null; agent_next_update: Date | null;
    due_date: Date | null; fields_json: string | null;
  }>(`
    SELECT issue_key, assignee_account_id, status_name, current_tier, jira_created, agent_last_updated, agent_next_update, due_date, fields_json
    FROM jira_issue_cache
    WHERE project_key = 'NT' AND status_category <> 'Done' AND assignee_account_id IS NOT NULL
  `);
  const stats1 = new Map<string, Stat1>();
  for (const t of openRows) {
    const acc = t.assignee_account_id!;
    const s = stats1.get(acc) ?? { open: 0, overSla: 0, noReply: 0, oldestDays: 0, oldestKey: null, oldestSupportDays: 0, oldestSupportKey: null, withDevelopment: 0 };

    // Tickets parked at tier Development are not the agent's to progress — Dev owns the
    // fix. Counting them made every stock below a measure of Dev's backlog rather than
    // the agent's actionable queue (30% of the open board, and the source of 200+ day
    // "oldest ticket" figures in 1-2-1s). They are counted separately, not hidden, so a
    // growing dev pile stays visible and cannot be used to park work out of sight.
    if ((t.current_tier || '').toLowerCase() === 'development') {
      s.withDevelopment++;
      stats1.set(acc, s);
      continue;
    }

    s.open++;
    const status = (t.status_name || '').toLowerCase();
    const actionable = !NOT_ACTIONABLE.has(status);
    // over-SLA (actionable): resolution SLA breached + actionable.
    // Due date no longer suppresses the breach — the SLA is authoritative.
    if (actionable && slaBreached(t.fields_json, 'customfield_14048', true) === true) {
      s.overSla++;
    }
    if (isNoReply(t.status_name, parseDate(t.jira_created), parseDate(t.agent_last_updated), parseDate(t.agent_next_update), now, t.current_tier)) s.noReply++;
    if (actionable && t.jira_created) {
      const days = Math.floor((now.getTime() - new Date(t.jira_created).getTime()) / 86_400_000);
      if (days > s.oldestDays) { s.oldestDays = days; s.oldestKey = t.issue_key; }
      if (SUPPORT_TIERS.has((t.current_tier || '').toLowerCase()) && days > s.oldestSupportDays) {
        s.oldestSupportDays = days; s.oldestSupportKey = t.issue_key;
      }
    }
    stats1.set(acc, s);
  }

  // 3. Solved (entered Resolved/Done), credited to the resolver (capture) or assignee (live)
  const [solvedToday, solvedWeek] = await Promise.all([
    solvedByAssignee(jira, day, tomorrow, opts.attributeResolver),
    solvedByAssignee(jira, weekStart, tomorrow, opts.attributeResolver),
  ]);

  // 4a. QA + Golden Rules (by agent name) — read existing pipelines.
  // Two windows in one pass: TODAY for the daily figures, and a rolling 7 DAYS for the
  // RAG rating. A single day's post-exclusion sample is 1-3 tickets for most of the team,
  // too few to rate on; the rolling window is what the rating actually means.
  const qaByName = new Map<string, any>();
  try {
    const r = await pool.request().query(`
      SELECT assigneeName,
             SUM(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS scored,
             AVG(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN CAST(overallScore AS FLOAT) END) AS overall,
             AVG(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN CAST(accuracyScore AS FLOAT) END) AS accuracy,
             AVG(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN CAST(clarityScore AS FLOAT) END) AS clarity,
             AVG(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN CAST(toneScore AS FLOAT) END) AS tone,
             SUM(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) AND grade='RED' THEN 1 ELSE 0 END) AS red,
             SUM(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) AND grade='AMBER' THEN 1 ELSE 0 END) AS amber,
             SUM(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) AND grade='GREEN' THEN 1 ELSE 0 END) AS green,
             SUM(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN CAST(ISNULL(isConcerning,0) AS INT) ELSE 0 END) AS concerning,
             COUNT(*) AS scored7d,
             AVG(CAST(overallScore AS FLOAT)) AS overall7d
      FROM dbo.jira_qa_results
      WHERE CAST(CreatedAt AS DATE) > DATEADD(day, -7, CAST(GETDATE() AS DATE))
        AND ISNULL(qaType, '') <> 'excluded'   -- excluded rows score 0; they'd sink the average
      GROUP BY assigneeName
    `);
    for (const x of r.recordset) qaByName.set((x.assigneeName || '').trim().toLowerCase(), x);
  } catch { /* table may not exist */ }

  const grByName = new Map<string, any>();
  try {
    const r = await pool.request().query(`
      -- Updater, not Assignee — the comment's author owns the score.
      SELECT Updater AS Assignee,
             SUM(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS scored,
             AVG(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN CAST(OverallScore AS FLOAT) END) AS overall,
             AVG(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN CAST(Rule1Score AS FLOAT) END) AS ownership,
             AVG(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN CAST(Rule2Score AS FLOAT) END) AS nextAction,
             AVG(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN CAST(Rule3Score AS FLOAT) END) AS timeframe,
             COUNT(*) AS scored7d,
             AVG(CAST(OverallScore AS FLOAT)) AS overall7d
      FROM dbo.Jira_QA_GoldenRules
      WHERE CAST(CreatedAt AS DATE) > DATEADD(day, -7, CAST(GETDATE() AS DATE))
      GROUP BY Updater
    `);
    for (const x of r.recordset) grByName.set((x.Assignee || '').trim().toLowerCase(), x);
  } catch { /* table may not exist */ }

  // 4b. CSAT + SLA compliance from resolved-today tickets (cache), by accountId
  const csatByAcc = new Map<string, { count: number; sum: number }>();
  const slaByAcc = new Map<string, { resolved: number; breached: number }>();
  const resolvedRows = await query<{ assignee_account_id: string; fields_json: string | null }>(`
    SELECT assignee_account_id, fields_json FROM jira_issue_cache
    WHERE project_key = 'NT' AND status_category = 'Done'
      AND CAST(jira_updated AS DATE) = CAST(GETUTCDATE() AS DATE) AND assignee_account_id IS NOT NULL
  `);
  for (const r of resolvedRows) {
    const rating = parseCsat(r.fields_json);
    if (rating != null) {
      const c = csatByAcc.get(r.assignee_account_id) ?? { count: 0, sum: 0 };
      c.count++; c.sum += rating; csatByAcc.set(r.assignee_account_id, c);
    }
    const breached = slaBreached(r.fields_json, 'customfield_14048');
    if (breached != null) {
      const s = slaByAcc.get(r.assignee_account_id) ?? { resolved: 0, breached: 0 };
      s.resolved++; if (breached) s.breached++; slaByAcc.set(r.assignee_account_id, s);
    }
  }

  // 5. Assemble per agent
  const round = (n: number) => Math.round(n * 100) / 100;
  return roster.map(a => {
    const s1 = stats1.get(a.AccountId) ?? { open: 0, overSla: 0, noReply: 0, oldestDays: 0, oldestKey: null, oldestSupportDays: 0, oldestSupportKey: null, withDevelopment: 0 };
    const nameLower = (a.AgentName || '').trim().toLowerCase();
    const qa = qaByName.get(nameLower);
    const gr = grByName.get(nameLower);
    const csat = csatByAcc.get(a.AccountId);
    const sla = slaByAcc.get(a.AccountId);
    const solvedT = solvedToday.get(a.AccountId) || 0;

    const ticketsPerHour = a.IsAvailable ? round(solvedT / 7.5) : null;
    const slaCompliancePct = sla && sla.resolved > 0 ? round(((sla.resolved - sla.breached) / sla.resolved) * 100) : null;
    const csatAvg = csat && csat.count > 0 ? round(csat.sum / csat.count) : null;
    const qaOverall = qa?.overall != null ? round(qa.overall) : null;
    const grOverall = gr?.overall != null ? round(gr.overall) : null;
    // Rolling 7-day — what the QA / Golden Rules RAG is rated on.
    const qaOverall7d = qa?.overall7d != null ? round(qa.overall7d) : null;
    const grOverall7d = gr?.overall7d != null ? round(gr.overall7d) : null;

    const rag: Record<string, Rag | null> = {
      productivity: ragHigher(ticketsPerHour, thresholds.productivity),
      csat: ragHigher(csatAvg, thresholds.csat),
      qa: ragHigherWithSample(qaOverall7d, thresholds.qa, qa?.scored7d || 0, thresholds.minSample.qa),
      goldenRules: ragHigherWithSample(grOverall7d, thresholds.goldenRules, gr?.scored7d || 0, thresholds.minSample.goldenRules),
      sla: ragHigher(slaCompliancePct, thresholds.sla),
      over2h: ragLower(s1.overSla, thresholds.over2h),
      stale: ragLower(s1.noReply, thresholds.stale),
      oldest: ragLower(s1.oldestDays, thresholds.oldest),
      oldestSupport: ragLower(s1.oldestSupportDays, thresholds.oldest),
    };

    return {
      accountId: a.AccountId, agentId: a.AgentId ?? null, agentName: a.AgentName, tierCode: a.TierCode, team: a.Team,
      open: s1.open, overSla: s1.overSla, noReply: s1.noReply, oldestDays: s1.oldestDays, oldestKey: s1.oldestKey,
      oldestSupportDays: s1.oldestSupportDays, oldestSupportKey: s1.oldestSupportKey,
      withDevelopment: s1.withDevelopment,
      solvedToday: solvedT, solvedWeek: solvedWeek.get(a.AccountId) || 0,
      qaScored: qa?.scored || 0, qaOverall, qaAccuracy: qa?.accuracy != null ? round(qa.accuracy) : null,
      qaClarity: qa?.clarity != null ? round(qa.clarity) : null, qaTone: qa?.tone != null ? round(qa.tone) : null,
      qaGreen: qa?.green || 0, qaAmber: qa?.amber || 0, qaRed: qa?.red || 0, qaConcerning: qa?.concerning || 0,
      qaScored7d: qa?.scored7d || 0, qaOverall7d,
      grScored: gr?.scored || 0, grOverall, grOwnership: gr?.ownership != null ? round(gr.ownership) : null,
      grNextAction: gr?.nextAction != null ? round(gr.nextAction) : null, grTimeframe: gr?.timeframe != null ? round(gr.timeframe) : null,
      grScored7d: gr?.scored7d || 0, grOverall7d,
      csatAvg, csatCount: csat?.count || 0,
      slaCompliancePct, slaResolved: sla?.resolved ?? 0, slaBreached: sla?.breached ?? 0,
      ticketsPerHour, rag,
    };
  });
}

export { NOVA_JIRA_ACCOUNT_ID };
