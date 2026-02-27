/**
 * Jira SLA & Attention Evaluation
 *
 * Pure functions that evaluate whether a Jira issue needs attention,
 * replicating the logic from the existing n8n automation script.
 *
 * Custom fields:
 *   customfield_14081 — Agent Last Updated
 *   customfield_14185 — Agent Next Update
 *   customfield_14048 — SLA Resolution (array of SLA cycle objects)
 */

export type AttentionReason = 'overdue_update' | 'sla_breached';

export interface AttentionResult {
  needsAttention: boolean;
  reasons: AttentionReason[];
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

// ── Helpers ──

/** Parse a date value; return null if falsy or invalid. */
function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(v as string | number);
  return isNaN(d.getTime()) ? null : d;
}

/** Read a field from a Jira issue, checking both flat and nested (fields.*) shapes.
 *  Also unwraps the {value: ...} wrapper that the MCP Jira tool returns for custom fields. */
function field(issue: Record<string, unknown>, key: string): unknown {
  let val = issue[key];
  if (val === undefined) {
    const fields = issue.fields as Record<string, unknown> | undefined;
    val = fields?.[key];
  }
  // Unwrap {value: X} wrapper from MCP Jira custom fields
  if (val && typeof val === 'object' && !Array.isArray(val) && 'value' in (val as Record<string, unknown>)) {
    val = (val as Record<string, unknown>).value;
  }
  return val ?? undefined;
}

/** Extract and normalise the Jira status name string. */
function getStatusName(issue: Record<string, unknown>): string {
  const raw = field(issue, 'status');
  const name = typeof raw === 'string'
    ? raw
    : (raw as Record<string, unknown> | null)?.name as string | undefined;
  return (name || '').toString().trim().toLowerCase();
}

// ── Core evaluation functions ──

/**
 * Determine if a ticket is overdue for an agent update.
 *
 * Returns true ONLY when ALL conditions hold:
 * 1. Status is NOT "waiting on requestor"
 * 2. Ticket created >= 4 hours ago (if created missing/invalid, treat as old enough)
 * 3. Agent Next Update (customfield_14185) is NOT in the future (> now)
 * 4. Agent Last Updated (customfield_14081) is NOT within today
 * If all pass → overdue.
 *
 * @example Test cases:
 * - status "waiting on requestor" → false (excluded status)
 * - created 2 hours ago → false (too new, < 4h)
 * - Agent Next Update = tomorrow → false (scheduled future update)
 * - Agent Last Updated = today 9am (now is today 3pm) → false (updated today)
 * - created yesterday, no next update, last updated yesterday → true
 * - created missing entirely → passes too-new check (treated as old)
 */
export function isOverdueUpdate(issue: Record<string, unknown>, now: Date = new Date()): boolean {
  // 1. Status exclusion
  const status = getStatusName(issue);
  if (status === 'waiting on requestor') return false;

  // 2. Too-new check: skip if created < 4 hours ago
  const created = toDate(field(issue, 'created'));
  if (created && (now.getTime() - created.getTime()) < FOUR_HOURS_MS) return false;

  // 3. Agent Next Update — if present and in the future, not overdue
  const nextUpdate = toDate(field(issue, 'customfield_14185'));
  if (nextUpdate && nextUpdate.getTime() > now.getTime()) return false;

  // 4. Agent Last Updated — if updated today, not overdue
  const lastUpdated = toDate(field(issue, 'customfield_14081'));
  if (lastUpdated) {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (lastUpdated.getTime() >= startOfToday.getTime() && lastUpdated.getTime() < startOfTomorrow.getTime()) {
      return false;
    }
  }

  // All conditions passed — overdue
  return true;
}

/**
 * Determine if the resolution SLA has breached.
 *
 * Reads customfield_14048 which may be an object or array of SLA cycle objects.
 * Each SLA object may have:
 *   ongoingCycle?: { breached: boolean, remainingTime: { millis: number } }
 *   completedCycles?: Array<{ breached: boolean, remainingTime: { millis: number } }>
 *
 * @example Test cases:
 * - customfield_14048 missing → false
 * - ongoingCycle.breached = true → true
 * - ongoingCycle.remainingTime.millis = -3600000 → true (negative = breached)
 * - completedCycles[0].breached = true → true
 * - completedCycles[0].remainingTime.millis = -1000 → true
 * - ongoingCycle.breached = false, remainingTime.millis = 5000 → false
 * - empty array → false
 */
export function isResolutionSlaBreached(issue: Record<string, unknown>): boolean {
  const raw = field(issue, 'customfield_14048');
  if (!raw) return false;

  // Normalise to array
  const slaList: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : [raw];

  for (const sla of slaList) {
    if (!sla || typeof sla !== 'object') continue;

    // Check ongoingCycle
    const ongoing = sla.ongoingCycle as Record<string, unknown> | undefined;
    if (ongoing) {
      if (ongoing.breached === true) return true;
      const remaining = ongoing.remainingTime as Record<string, unknown> | undefined;
      if (remaining && typeof remaining.millis === 'number' && remaining.millis < 0) return true;
    }

    // Check completedCycles
    const completed = sla.completedCycles as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(completed)) {
      for (const cycle of completed) {
        if (!cycle || typeof cycle !== 'object') continue;
        if (cycle.breached === true) return true;
        const remaining = cycle.remainingTime as Record<string, unknown> | undefined;
        if (remaining && typeof remaining.millis === 'number' && remaining.millis < 0) return true;
      }
    }
  }

  return false;
}

/**
 * Check if the due date is acceptable (not past end of today).
 *
 * @example Test cases:
 * - duedate null → true (no due date is ok)
 * - duedate = tomorrow → true (within boundary)
 * - duedate = today → true (endOfDay is exclusive startOfTomorrow)
 * - duedate = yesterday → false (overdue)
 */
export function dueIsOk(issue: Record<string, unknown>, now: Date = new Date()): boolean {
  const due = toDate(field(issue, 'duedate'));
  if (!due) return true;
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return due.getTime() <= startOfTomorrow.getTime();
}

/**
 * Evaluate a Jira issue for all attention reasons.
 * Returns composite result with all triggered reasons.
 */
export function evaluateAttention(issue: Record<string, unknown>, now: Date = new Date()): AttentionResult {
  const reasons: AttentionReason[] = [];

  if (isOverdueUpdate(issue, now)) reasons.push('overdue_update');
  if (isResolutionSlaBreached(issue)) reasons.push('sla_breached');

  return {
    needsAttention: reasons.length > 0,
    reasons,
  };
}
