// Compute a single org KPI's value for a given day.
// Jira-backed KPIs use the validated JQL from the registry via the REST client;
// flows read NOVA's escalation_log. Manual KPIs return null (value comes from
// a manual-entry row). Mirrors the agreed definitions in org-kpis-spec.md.

import type { JiraRestClient } from '../jira-client.js';
import { query } from '../database.js';
import type { OrgKpi, DayCtx } from './registry.js';
import { NOT_ACTIONABLE_STATUSES } from './registry.js';

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const FIFTY_TWO_WEEKS_MS = 52 * 7 * 24 * 60 * 60 * 1000;

/** Port of kpi-pipeline.ts isNoReply, working off raw Jira issue fields. */
function isNoReply(
  statusName: string | null,
  created: Date | null,
  agentLastUpdated: Date | null,
  agentNextUpdate: Date | null,
  now: Date,
): boolean {
  if ((statusName || '').toLowerCase() === 'waiting on requestor') return false;
  if (!created || now.getTime() - created.getTime() < FOUR_HOURS_MS) return false;
  if (agentNextUpdate && agentNextUpdate > now) return false;
  if (!agentLastUpdated) return false;
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  if (agentLastUpdated >= startOfToday) return false;
  if (agentLastUpdated < new Date(now.getTime() - FIFTY_TWO_WEEKS_MS)) return false;
  return true;
}

function parseDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

const NOT_ACTIONABLE_LIST = NOT_ACTIONABLE_STATUSES.map(s => `"${s}"`).join(', ');

export interface ComputeResult {
  value: number | null;
  /** True when the compute path failed (vs a legitimate zero/null). */
  failed: boolean;
}

/**
 * Compute one KPI for `ctx.day`. `now` is the freeze instant (≈18:00 UK on the day).
 * Returns { value, failed }. Manual KPIs return { value: null, failed: false }.
 */
export async function computeNtKpi(
  kpi: OrgKpi,
  jira: JiraRestClient,
  ctx: DayCtx,
  now: Date,
): Promise<ComputeResult> {
  const c = kpi.compute;

  switch (c.kind) {
    case 'manual':
      return { value: null, failed: false };

    case 'jql_count': {
      const n = await jira.jqlCount(c.jql(ctx));
      return n < 0 ? { value: null, failed: true } : { value: n, failed: false };
    }

    case 'escalation_log': {
      const rows = await query<{ n: number }>(
        `SELECT COUNT(DISTINCT ticket_key) AS n FROM escalation_log
         WHERE ticket_key LIKE 'NT-%'
           AND escalation_type ${c.rejection ? '=' : '<>'} 'rejection'
           AND created_at >= ? AND created_at < ?`,
        [`${ctx.day}T00:00:00.000Z`, `${ctx.nextDay}T00:00:00.000Z`],
      );
      return { value: rows[0]?.n ?? 0, failed: false };
    }

    case 'no_reply': {
      const res = await jira.searchJqlAll(
        c.bucketJql,
        ['status', 'created', 'customfield_14081', 'customfield_14185'],
        2000,
      );
      let count = 0;
      for (const issue of res.issues) {
        const f = issue.fields as Record<string, unknown>;
        const status = (f.status as { name?: string } | undefined)?.name ?? null;
        if (isNoReply(
          status,
          parseDate(f.created),
          parseDate(f.customfield_14081),
          parseDate(f.customfield_14185),
          now,
        )) count++;
      }
      return { value: count, failed: false };
    }

    case 'oldest_actionable': {
      const jql = `${c.bucketJql} AND status not in (${NOT_ACTIONABLE_LIST}) ORDER BY created ASC`;
      const res = await jira.searchJql(jql, ['created'], 1);
      const oldest = res.issues[0];
      if (!oldest) return { value: 0, failed: false };
      const created = parseDate((oldest.fields as Record<string, unknown>).created);
      if (!created) return { value: 0, failed: false };
      const days = Math.floor((now.getTime() - created.getTime()) / 86_400_000);
      return { value: Math.max(0, days), failed: false };
    }
  }
}
