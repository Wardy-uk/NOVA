import type { SettingsQueries } from '../../db/settings-store.js';

/**
 * The Jira custom fields carrying SLA cycles on this instance.
 *
 * `customfield_10010` is Jira's DEFAULT "Time to resolution" id and does not exist here — NT
 * uses 14046 (First Reply Time) and 14048 (Resolution), as flow-signals.ts and
 * frt-safety-net.ts both already knew. Two separate features read the default id and so read
 * undefined on every issue, silently:
 *
 *  - queue-monitor recorded `sla_at_risk = 0` on all 4,006 agent_queue_snapshots rows, which
 *    the health page flagged as a constant column;
 *  - sla-manager produced no breach projections at all, so agent_sla_interventions has never
 *    held a single row and proactive SLA management has never run.
 *
 * Neither failed loudly. A missing field reads as "nothing at risk", which looks like a quiet
 * queue rather than a broken one — the same shape as every other fault found this week.
 *
 * One list, one setting, so the next renumbering cannot silently zero them again.
 */
export const DEFAULT_SLA_FIELD_IDS = ['customfield_14046', 'customfield_14048'];

export function slaFieldIds(settings: SettingsQueries): string[] {
  const raw = settings.get('jira_sla_field_ids') || settings.get('queue_monitor_sla_fields');
  const parsed = (raw ?? '').split(',').map(f => f.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_SLA_FIELD_IDS;
}

/** Every SLA cycle object across the configured fields on one issue. */
export function slaFieldValues(settings: SettingsQueries, fields: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  for (const id of slaFieldIds(settings)) {
    const v = fields[id];
    if (!v) continue;
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}
