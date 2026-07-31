// Resolves a wallboard tile to the JQL that defines its tickets — the SAME JQL
// the rebuilt engine counts with — so the drill-down list always matches the
// tile number. Covers both the tier boards (CC/TS/KA/CS, via bucket+stat+cohort)
// and the KPI Breach board (via the org-KPI registry, by key or label).

import { ORG_KPIS, NOT_ACTIONABLE_STATUSES, type DayCtx } from './registry.js';
import { tierTileJql, type Cohort, type TierStatKind } from './wallboard-tiers.js';

const NOT_ACTIONABLE_LIST = NOT_ACTIONABLE_STATUSES.map(s => `"${s}"`).join(', ');

/** A resolved drill: run `jql`, then (if `applyNoReply`) keep only isNoReply issues. */
export interface DrillJql { jql: string; applyNoReply: boolean }
/** No ticket list is meaningful for this tile (manual / escalation-log KPIs). */
export interface DrillMessage { message: string }

export function resolveTierDrill(bucket: string, stat: TierStatKind, cohort: Cohort): DrillJql | null {
  const jql = tierTileJql(bucket, stat, cohort);
  if (!jql) return null;
  return { jql, applyNoReply: stat === 'noReply' };
}

/** UK-ish calendar-day context for registry JQL date ranges. */
function dayCtx(now: Date): DayCtx {
  const day = now.toISOString().slice(0, 10);
  const next = new Date(now); next.setUTCDate(next.getUTCDate() + 1);
  return { day, nextDay: next.toISOString().slice(0, 10) };
}

export function resolveKpiDrill(kpiKeyOrLabel: string, now: Date): DrillJql | DrillMessage | null {
  const needle = kpiKeyOrLabel.trim().toLowerCase();
  const kpi = ORG_KPIS.find(k => k.key.toLowerCase() === needle || k.label.toLowerCase() === needle);
  if (!kpi) return null;
  const c = kpi.compute;
  switch (c.kind) {
    case 'jql_count':
      return { jql: c.jql(dayCtx(now)), applyNoReply: false };
    case 'no_reply':
      return { jql: c.bucketJql, applyNoReply: true };
    case 'oldest_actionable':
      return { jql: `${c.bucketJql} AND status not in (${NOT_ACTIONABLE_LIST}) ORDER BY created ASC`, applyNoReply: false };
    case 'escalation_log':
    case 'escalation_tier':
      return { message: 'Escalations are tracked in the escalation log — no ticket drill-down.' };
    case 'resolved_outcome':
    case 'fcr': {
      const ctx = dayCtx(now);
      return { jql: `project = NT AND statusCategory = Done AND status CHANGED TO ("Resolved", "Closed", "Done") DURING ("${ctx.day} 00:00", "${ctx.nextDay} 00:00")`, applyNoReply: false };
    }
    case 'first_line_rate': {
      const ctx = dayCtx(now);
      return { jql: `project = NT AND statusCategory = Done AND status CHANGED TO ("Resolved", "Closed", "Done") DURING ("${ctx.day} 00:00", "${ctx.nextDay} 00:00")`, applyNoReply: false };
    }
    case 'bug_ack': {
      const ctx = dayCtx(now);
      return { jql: `project = NT AND statusCategory = Done AND status CHANGED TO ("Resolved", "Closed", "Done") DURING ("${ctx.day} 00:00", "${ctx.nextDay} 00:00") AND cf[12981] in ("Tier 3", "Development")`, applyNoReply: false };
    }
    case 'ai_metric':
      return { message: 'AI agent throughput is tracked in the approval queue — no ticket drill-down.' };
    case 'wtd_rag':
      return { message: 'Week-to-date KPI RAG summary — no ticket drill-down.' };
    case 'resolved_sla': {
      const ctx = dayCtx(now);
      const tierClause = c.tier ? ` AND cf[12981] = "${c.tier}"` : '';
      return { jql: `project = NT AND statusCategory = Done AND status CHANGED TO ("Resolved", "Closed", "Done") DURING ("${ctx.day} 00:00", "${ctx.nextDay} 00:00")${tierClause}`, applyNoReply: false };
    }
    case 'escalation_accuracy':
      return { message: 'Escalation accuracy is derived from the escalation log — no ticket drill-down.' };
    case 'manual':
      return { message: 'Manually-entered KPI — no ticket drill-down.' };
  }
}
