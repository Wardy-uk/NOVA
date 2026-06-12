// TPJ Maintenance dashboard data layer (NTPJ Jira project).
//
// Scoped entirely to the NTPJ service-desk project for Lucy's team. Time-series
// data is read LIVE from Jira REST (the local jira_issue_cache purges tickets
// resolved >7 days ago, so it can't back month-long charts). The daily
// backlog-by-status chart reads the existing dbo.JiraEodTicketStatusSnapshot
// (populated nightly by kpi-pipeline.captureEodSnapshot for all projects).
//
// Field reference (discovered against NTPJ, cloudId 9357a1ba-…):
//   customfield_13413  TPJ PSP          select, option value is a Fibonacci number ("1".."55")
//   customfield_13411  TPJ Ticket Type  select (~60 values) → bucketed to 4 SLA rows
//   customfield_13421  Client Priority  select Low/Normal/High/Urgent (often null → Normal)
//   customfield_13645  First Response Time SLA  the ONLY meaningful SLA on NTPJ (24h goal);
//                       NTPJ has no resolution SLA, so "SLA met/exceeded" = FRT SLA outcome.
//   duedate            sparse; used for simple-v1 SLO (resolved within due date)

import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient, JiraIssue } from './jira-client.js';
import { getKpiPool } from './kpi-pipeline.js';

const PROJECT = 'NTPJ';
const F = {
  psp: 'customfield_13413',
  ticketType: 'customfield_13411',
  clientPriority: 'customfield_13421',
  frtSla: 'customfield_13645',
} as const;

// SLO clock pauses (and these statuses are excluded from first-reply/SLO/backlog).
// TODO: add 'SEO Scheduled' to EXEMPT once the status exists in NTPJ (not created yet).
const EXEMPT_STATUSES = ['Waiting On Requestor', 'Waiting On Partner'];
const EXEMPT_JQL = EXEMPT_STATUSES.map((s) => `"${s}"`).join(', ');

const PSP_TARGET = 180; // per agent / month
const PLUGIN_FAILED_LABEL = 'plugin-failed-update';
const FRT_GOAL_MS = 24 * 60 * 60 * 1000;

// Chart colours per spec (used verbatim).
export const COLORS = {
  purple: '#7c8cf8',
  green: '#4ade80',
  coral: '#f87171',
  amber: '#fbbf24',
};

const TICKET_TYPE_BUCKETS = ['General Response', 'Support Request', 'CMP', 'SEO'] as const;
const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'] as const;
type Bucket = (typeof TICKET_TYPE_BUCKETS)[number];
type Priority = (typeof PRIORITIES)[number];

// ── Field helpers ──

function optionValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'value' in (v as any)) return String((v as any).value ?? '') || null;
  return null;
}

/** Map the ~60 raw TPJ Ticket Type values into the 4 SLA-table buckets. */
function bucketTicketType(raw: string | null): Bucket {
  const t = (raw ?? '').toLowerCase();
  if (t.includes('cmp')) return 'CMP';
  if (t.includes('seo')) return 'SEO';
  if (t.includes('support') || t.includes('question')) return 'Support Request';
  return 'General Response';
}

/** Client Priority is frequently unset on NTPJ → treat null as the de-facto Normal. */
function priorityOf(issue: JiraIssue): Priority {
  const v = optionValue(issue.fields[F.clientPriority]);
  if (v === 'Urgent' || v === 'High' || v === 'Normal' || v === 'Low') return v;
  return 'Normal';
}

function pspPoints(issue: JiraIssue): number {
  const v = optionValue(issue.fields[F.psp]);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hasPluginFailedLabel(issue: JiraIssue): boolean {
  const labels = issue.fields.labels;
  return Array.isArray(labels) && labels.includes(PLUGIN_FAILED_LABEL);
}

function statusName(issue: JiraIssue): string {
  const s = issue.fields.status as any;
  return (s && typeof s === 'object' ? s.name : '') ?? '';
}

function isExempt(issue: JiraIssue): boolean {
  return EXEMPT_STATUSES.includes(statusName(issue));
}

function assigneeOf(issue: JiraIssue): { id: string; name: string } | null {
  const a = issue.fields.assignee as any;
  if (!a || typeof a !== 'object') return null;
  return { id: a.accountId ?? a.displayName ?? 'unknown', name: a.displayName ?? 'Unassigned' };
}

/** FRT SLA outcome. NTPJ tracks only this SLA, so it IS "the SLA" for the dashboard. */
type SlaStatus = 'met' | 'exceeded' | 'in_progress' | null;
function frtStatus(issue: JiraIssue): SlaStatus {
  const raw = issue.fields[F.frtSla];
  if (!raw) return null;
  const cycles = Array.isArray(raw) ? raw : [raw];
  let breached = false;
  let hasCompleted = false;
  let hasOngoing = false;
  for (const c of cycles as any[]) {
    for (const cc of c.completedCycles ?? []) {
      hasCompleted = true;
      if (cc.breached === true || (cc.remainingTime?.millis != null && cc.remainingTime.millis < 0)) breached = true;
    }
    if (c.ongoingCycle) {
      hasOngoing = true;
      const o = c.ongoingCycle;
      if (o.breached === true || (o.remainingTime?.millis != null && o.remainingTime.millis < 0)) breached = true;
    }
  }
  if (breached) return 'exceeded';
  if (hasCompleted) return 'met';
  if (hasOngoing) return 'in_progress';
  return null;
}

// ── Date helpers ──

const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); // YYYY-MM-DD

/** Day key (YYYY-MM-DD, Europe/London) for an ISO timestamp string. */
function dayKey(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : iso(d);
}

/** Inclusive list of YYYY-MM-DD between from and to. */
function dateRangeDays(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    out.push(iso(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Previous window of equal length immediately before [from, to]. */
function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(f); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { from: iso(prevFrom), to: iso(prevTo) };
}

function pctDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ── Jira fetch (cached briefly so the ~8 page endpoints share one round-trip) ──

const FETCH_FIELDS = [
  'created', 'resolutiondate', 'duedate', 'status', 'assignee', 'labels',
  F.psp, F.ticketType, F.clientPriority, F.frtSla,
];

interface RangeData { created: JiraIssue[]; resolved: JiraIssue[] }
const rangeCache = new Map<string, { at: number; data: RangeData }>();
const CACHE_MS = 60_000;

async function fetchRange(client: JiraRestClient, from: string, to: string): Promise<RangeData> {
  const key = `${from}|${to}`;
  const hit = rangeCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const upper = `${to} 23:59`;
  const [createdRes, resolvedRes] = await Promise.all([
    client.searchJqlAll(`project = ${PROJECT} AND created >= "${from}" AND created <= "${upper}" ORDER BY created ASC`, FETCH_FIELDS, 5000),
    client.searchJqlAll(`project = ${PROJECT} AND resolutiondate >= "${from}" AND resolutiondate <= "${upper}" ORDER BY resolutiondate ASC`, FETCH_FIELDS, 5000),
  ]);
  const data: RangeData = { created: createdRes.issues, resolved: resolvedRes.issues };
  rangeCache.set(key, { at: Date.now(), data });
  return data;
}

// ── reopen_classifications (platform-wide; created idempotently, populated by n8n later) ──

let reopenTableEnsured = false;
async function ensureReopenTable(pool: sql.ConnectionPool): Promise<void> {
  if (reopenTableEnsured) return;
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.reopen_classifications') AND type = 'U')
    BEGIN
      CREATE TABLE dbo.reopen_classifications (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        ticket_key        VARCHAR(20)  NOT NULL,
        project_key       VARCHAR(10)  NOT NULL,
        classified_at     DATETIME     NOT NULL DEFAULT GETDATE(),
        classification    VARCHAR(50)  NOT NULL,
        ai_confidence     DECIMAL(5,4) NULL,
        comment_id        VARCHAR(50)  NULL,
        auto_action_taken VARCHAR(30)  NULL,
        reviewed_by       VARCHAR(100) NULL,
        override_class    VARCHAR(50)  NULL
      );
      CREATE INDEX idx_reopen_project ON dbo.reopen_classifications (project_key, classified_at);
      CREATE INDEX idx_reopen_ticket  ON dbo.reopen_classifications (ticket_key);
    END
  `).catch(() => { /* lack of DDL rights shouldn't break reads */ });
  reopenTableEnsured = true;
}

// ── Public API ──

export interface SnapshotCard {
  created: number; createdDelta: number | null;
  resolved: number; solveRate: number;
  slaMetPct: number; slaMetDelta: number | null;
  backlogOver30: number;
}

export async function getDashboardSnapshot(client: JiraRestClient, from: string, to: string): Promise<SnapshotCard> {
  const data = await fetchRange(client, from, to);
  const prev = previousPeriod(from, to);
  const prevData = await fetchRange(client, prev.from, prev.to);

  const created = data.created.length;
  const resolved = data.resolved.length;
  const solveRate = created ? Math.round((resolved / created) * 100) : 0;

  const slaMet = (issues: JiraIssue[]) => {
    const judged = issues.map(frtStatus).filter((s) => s === 'met' || s === 'exceeded');
    const met = judged.filter((s) => s === 'met').length;
    return judged.length ? Math.round((met / judged.length) * 100) : 0;
  };
  const slaMetPct = slaMet(data.created);

  // Backlog >30d: open NTPJ tickets created >30d ago, excluding exempt statuses.
  const backlogJql = `project = ${PROJECT} AND statusCategory != Done AND created <= -30d AND status not in (${EXEMPT_JQL})`;
  let backlogOver30 = await client.jqlCount(backlogJql);
  if (backlogOver30 < 0) backlogOver30 = 0;

  return {
    created, createdDelta: pctDelta(created, prevData.created.length),
    resolved, solveRate,
    slaMetPct, slaMetDelta: pctDelta(slaMetPct, slaMet(prevData.created)),
    backlogOver30,
  };
}

export async function getRaisedVsSolvedDaily(client: JiraRestClient, from: string, to: string) {
  const data = await fetchRange(client, from, to);
  const days = dateRangeDays(from, to);
  const createdBy: Record<string, number> = {};
  const resolvedBy: Record<string, number> = {};
  for (const i of data.created) { const k = dayKey(i.fields.created as string); if (k) createdBy[k] = (createdBy[k] ?? 0) + 1; }
  for (const i of data.resolved) { const k = dayKey(i.fields.resolutiondate as string); if (k) resolvedBy[k] = (resolvedBy[k] ?? 0) + 1; }
  return days.map((d) => ({ date: d, created: createdBy[d] ?? 0, resolved: resolvedBy[d] ?? 0 }));
}

export async function getSlaStatus(client: JiraRestClient, from: string, to: string) {
  const data = await fetchRange(client, from, to);
  let met = 0, inProgress = 0, exceeded = 0;
  // Breakdown: bucket × priority → { met, total }
  const table: Record<Bucket, Record<Priority, { met: number; total: number }>> = {} as any;
  for (const b of TICKET_TYPE_BUCKETS) {
    table[b] = {} as any;
    for (const p of PRIORITIES) table[b][p] = { met: 0, total: 0 };
  }
  for (const i of data.created) {
    const s = frtStatus(i);
    if (s === 'met') met++; else if (s === 'in_progress') inProgress++; else if (s === 'exceeded') exceeded++;
    if (s === 'met' || s === 'exceeded') {
      const cell = table[bucketTicketType(optionValue(i.fields[F.ticketType]))][priorityOf(i)];
      cell.total++; if (s === 'met') cell.met++;
    }
  }
  const judged = met + exceeded;
  return {
    doughnut: { met, inProgress, exceeded },
    metPct: judged ? Math.round((met / judged) * 100) : 0,
    buckets: TICKET_TYPE_BUCKETS,
    priorities: PRIORITIES,
    table,
  };
}

export async function getSlaMetVsExceededDaily(client: JiraRestClient, from: string, to: string) {
  const data = await fetchRange(client, from, to);
  const days = dateRangeDays(from, to);
  const metBy: Record<string, number> = {};
  const excBy: Record<string, number> = {};
  // Bucket FRT outcome by the day the ticket was created (the FRT clock starts at creation).
  for (const i of data.created) {
    const s = frtStatus(i);
    const k = dayKey(i.fields.created as string);
    if (!k) continue;
    if (s === 'met') metBy[k] = (metBy[k] ?? 0) + 1;
    else if (s === 'exceeded') excBy[k] = (excBy[k] ?? 0) + 1;
  }
  return days.map((d) => ({ date: d, met: metBy[d] ?? 0, exceeded: excBy[d] ?? 0 }));
}

/** Daily backlog by status from the existing nightly EOD snapshot (NTPJ only). */
export async function getBacklogByStatusDaily(settings: SettingsQueries, from: string, to: string) {
  const pool = await getKpiPool(settings);
  const r = pool.request();
  r.input('from', sql.Date, from);
  r.input('to', sql.Date, to);
  r.input('proj', sql.NVarChar(10), PROJECT);
  // WIP + Waiting On Requestor come from the open-ticket snapshot.
  const res = await r.query(`
    SELECT CONVERT(varchar(10), SnapshotDate, 23) AS d, StatusName, SUM(TicketCount) AS cnt
    FROM dbo.JiraEodTicketStatusSnapshot
    WHERE ProjectKey = @proj AND SnapshotDate >= @from AND SnapshotDate <= @to
    GROUP BY SnapshotDate, StatusName
    ORDER BY SnapshotDate
  `);
  const byDay: Record<string, { wip: number; waiting: number }> = {};
  for (const row of res.recordset as any[]) {
    const d = row.d as string;
    byDay[d] ??= { wip: 0, waiting: 0 };
    const name = String(row.StatusName ?? '').toLowerCase();
    if (name === 'work in progress') byDay[d].wip += row.cnt;
    else if (name === 'waiting on requestor') byDay[d].waiting += row.cnt;
  }
  return { byDay };
}

export interface AgentRow {
  agentId: string; agent: string;
  psp: number; firstReplyPct: number; sloPct: number; reopenPct: number; backlogOver30: number;
}

export interface KpiMetrics {
  team: {
    pspTotal: number; pspTarget: number; agentCount: number;
    firstReplyPct: number; sloPct: number; reopenPct: number; reopenAvoidablePct: number;
  };
  agents: AgentRow[];
}

export async function getKpiMetrics(client: JiraRestClient, settings: SettingsQueries, from: string, to: string): Promise<KpiMetrics> {
  const data = await fetchRange(client, from, to);

  // Per-agent accumulators keyed by accountId.
  type Acc = { name: string; psp: number; frMet: number; frTotal: number; sloMet: number; sloTotal: number };
  const byAgent = new Map<string, Acc>();
  const acc = (id: string, name: string) => {
    let a = byAgent.get(id);
    if (!a) { a = { name, psp: 0, frMet: 0, frTotal: 0, sloMet: 0, sloTotal: 0 }; byAgent.set(id, a); }
    return a;
  };

  // First reply ≤24h — over tickets created in range, excluding exempt statuses.
  for (const i of data.created) {
    if (isExempt(i)) continue;
    const s = frtStatus(i);
    if (s !== 'met' && s !== 'exceeded') continue;
    const ag = assigneeOf(i); if (!ag) continue;
    const a = acc(ag.id, ag.name);
    a.frTotal++; if (s === 'met') a.frMet++;
  }

  // PSP (resolved in range, excluding plugin-failed-update) + SLO (duedate set, resolved within due date, not exempt).
  for (const i of data.resolved) {
    const ag = assigneeOf(i); if (!ag) continue;
    const a = acc(ag.id, ag.name);
    if (!hasPluginFailedLabel(i)) a.psp += pspPoints(i);
    const due = i.fields.duedate as string | null;
    if (due && !isExempt(i)) {
      a.sloTotal++;
      const resolvedAt = i.fields.resolutiondate as string | null;
      if (resolvedAt && new Date(resolvedAt) <= new Date(`${due}T23:59:59`)) a.sloMet++;
    }
  }

  // Backlog >30d per agent.
  const backlog = await client.searchJqlAll(
    `project = ${PROJECT} AND statusCategory != Done AND created <= -30d AND status not in (${EXEMPT_JQL})`,
    ['assignee'], 5000,
  );
  const backlogByAgent = new Map<string, number>();
  for (const i of backlog.issues) {
    const ag = assigneeOf(i); if (!ag) continue;
    backlogByAgent.set(ag.id, (backlogByAgent.get(ag.id) ?? 0) + 1);
  }

  // Reopen rate from reopen_classifications (empty until the n8n pipeline runs).
  let reopenPct = 0, reopenAvoidablePct = 0;
  try {
    const pool = await getKpiPool(settings);
    await ensureReopenTable(pool);
    const rr = pool.request();
    rr.input('proj', sql.VarChar(10), PROJECT);
    rr.input('from', sql.DateTime, new Date(`${from}T00:00:00`));
    rr.input('to', sql.DateTime, new Date(`${to}T23:59:59`));
    const res = await rr.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN classification = 'original_not_answered' THEN 1 ELSE 0 END) AS avoidable
      FROM dbo.reopen_classifications
      WHERE project_key = @proj AND classified_at >= @from AND classified_at <= @to
    `);
    const row = res.recordset[0] as any;
    const reopens = Number(row?.total ?? 0);
    const resolvedCount = data.resolved.length;
    if (resolvedCount) reopenPct = Math.round((reopens / resolvedCount) * 1000) / 10;
    if (reopens) reopenAvoidablePct = Math.round((Number(row?.avoidable ?? 0) / reopens) * 1000) / 10;
  } catch { /* table/pool unavailable → 0 */ }

  const agents: AgentRow[] = [...byAgent.entries()].map(([id, a]) => ({
    agentId: id, agent: a.name,
    psp: a.psp,
    firstReplyPct: a.frTotal ? Math.round((a.frMet / a.frTotal) * 100) : 0,
    sloPct: a.sloTotal ? Math.round((a.sloMet / a.sloTotal) * 100) : 0,
    reopenPct: 0, // per-agent reopen needs assignee on the classification row; team-level only for v1
    backlogOver30: backlogByAgent.get(id) ?? 0,
  })).sort((x, y) => y.psp - x.psp);

  // include agents that only have backlog (no created/resolved in range)
  for (const [id, cnt] of backlogByAgent) {
    if (!byAgent.has(id)) {
      const issue = backlog.issues.find((i) => assigneeOf(i)?.id === id);
      agents.push({ agentId: id, agent: assigneeOf(issue!)?.name ?? 'Unknown', psp: 0, firstReplyPct: 0, sloPct: 0, reopenPct: 0, backlogOver30: cnt });
    }
  }

  const pspTotal = agents.reduce((s, a) => s + a.psp, 0);
  const frMet = [...byAgent.values()].reduce((s, a) => s + a.frMet, 0);
  const frTotal = [...byAgent.values()].reduce((s, a) => s + a.frTotal, 0);
  const sloMet = [...byAgent.values()].reduce((s, a) => s + a.sloMet, 0);
  const sloTotal = [...byAgent.values()].reduce((s, a) => s + a.sloTotal, 0);

  return {
    team: {
      pspTotal, pspTarget: PSP_TARGET * Math.max(byAgent.size, 1), agentCount: byAgent.size,
      firstReplyPct: frTotal ? Math.round((frMet / frTotal) * 100) : 0,
      sloPct: sloTotal ? Math.round((sloMet / sloTotal) * 100) : 0,
      reopenPct, reopenAvoidablePct,
    },
    agents,
  };
}

export async function getPspMonthlyByAgent(client: JiraRestClient, from: string, to: string) {
  const data = await fetchRange(client, from, to);
  const byAgent = new Map<string, { name: string; psp: number }>();
  for (const i of data.resolved) {
    if (hasPluginFailedLabel(i)) continue;
    const ag = assigneeOf(i); if (!ag) continue;
    const cur = byAgent.get(ag.id) ?? { name: ag.name, psp: 0 };
    cur.psp += pspPoints(i);
    byAgent.set(ag.id, cur);
  }
  return {
    target: PSP_TARGET,
    agents: [...byAgent.values()].map((a) => ({ agent: a.name, psp: a.psp })).sort((x, y) => y.psp - x.psp),
  };
}

/** First-reply % and SLO % for each of the last 4 ISO weeks (independent of selected range). */
export async function getSloTrendWeekly(client: JiraRestClient) {
  const today = new Date();
  const weeks: { label: string; from: string; to: string }[] = [];
  for (let w = 3; w >= 0; w--) {
    const end = new Date(today); end.setDate(today.getDate() - w * 7);
    const start = new Date(end); start.setDate(end.getDate() - 6);
    weeks.push({ label: `${iso(start).slice(5)}`, from: iso(start), to: iso(end) });
  }
  const out = [];
  for (const wk of weeks) {
    const data = await fetchRange(client, wk.from, wk.to);
    let frMet = 0, frTotal = 0, sloMet = 0, sloTotal = 0;
    for (const i of data.created) {
      if (isExempt(i)) continue;
      const s = frtStatus(i);
      if (s === 'met' || s === 'exceeded') { frTotal++; if (s === 'met') frMet++; }
    }
    for (const i of data.resolved) {
      const due = i.fields.duedate as string | null;
      if (!due || isExempt(i)) continue;
      sloTotal++;
      const resolvedAt = i.fields.resolutiondate as string | null;
      if (resolvedAt && new Date(resolvedAt) <= new Date(`${due}T23:59:59`)) sloMet++;
    }
    out.push({
      week: wk.label,
      firstReplyPct: frTotal ? Math.round((frMet / frTotal) * 100) : 0,
      sloPct: sloTotal ? Math.round((sloMet / sloTotal) * 100) : 0,
    });
  }
  return { target: 85, weeks: out };
}
