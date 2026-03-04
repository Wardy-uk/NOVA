import type { Task } from '../../shared/types.js';

export interface ActionSuggestion {
  task_id: string;
  reason: string;
}

interface DebugEntry {
  ts: string;
  text: string;
}

const debugLog: DebugEntry[] = [];

export function recordAiActionsDebug(text: string): void {
  debugLog.push({ ts: new Date().toISOString(), text });
  if (debugLog.length > 50) debugLog.splice(0, debugLog.length - 50);
}

export function getAiActionsDebugLog(): DebugEntry[] {
  return [...debugLog];
}

// ── Scoring weights ──

const W = {
  SLA_BREACH:   200,   // SLA already breached
  SLA_IMMINENT: 120,   // SLA breaches within 4 hours
  OVERDUE:      150,   // Past due date
  OVERDUE_DAYS:  10,   // Per day overdue (compounds)
  DUE_TODAY:     80,
  DUE_TOMORROW:  60,
  DUE_THIS_WEEK: 40,
  DUE_NEXT_WEEK: 15,
  PRIORITY_1:    50,   // Urgent / Highest
  PRIORITY_2:    35,   // High
  PRIORITY_3:    15,   // Medium
  MILESTONE:     25,   // Onboarding milestones get a boost
  PINNED:        30,   // User explicitly pinned
  RECENTLY_UPDATED: 5, // Updated in last 24h — slight freshness boost
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

interface ScoredTask {
  task: Task;
  score: number;
  reasons: string[];
}

function scoreTask(t: Task, now: Date, todayStart: Date): ScoredTask {
  let score = 0;
  const reasons: string[] = [];

  const due = t.due_date ? new Date(t.due_date) : null;
  const validDue = due && !isNaN(due.getTime());
  const sla = t.sla_breach_at ? new Date(t.sla_breach_at) : null;
  const validSla = sla && !isNaN(sla.getTime());

  // ── SLA breach ──
  if (validSla) {
    if (sla <= now) {
      score += W.SLA_BREACH;
      reasons.push('SLA breached');
    } else if (sla.getTime() - now.getTime() < 4 * MS_PER_HOUR) {
      score += W.SLA_IMMINENT;
      const mins = Math.round((sla.getTime() - now.getTime()) / 60000);
      reasons.push(`SLA breaches in ${mins < 60 ? mins + 'm' : Math.round(mins / 60) + 'h'}`);
    }
  }

  // ── Due date ──
  if (validDue) {
    const daysUntilDue = Math.floor((due.getTime() - todayStart.getTime()) / MS_PER_DAY);

    if (daysUntilDue < 0) {
      const daysOverdue = Math.abs(daysUntilDue);
      score += W.OVERDUE + Math.min(daysOverdue, 30) * W.OVERDUE_DAYS;
      reasons.push(`Overdue by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`);
    } else if (daysUntilDue === 0) {
      score += W.DUE_TODAY;
      reasons.push('Due today');
    } else if (daysUntilDue === 1) {
      score += W.DUE_TOMORROW;
      reasons.push('Due tomorrow');
    } else if (daysUntilDue <= 7) {
      score += W.DUE_THIS_WEEK;
      reasons.push(`Due in ${daysUntilDue} days`);
    } else if (daysUntilDue <= 14) {
      score += W.DUE_NEXT_WEEK;
      reasons.push(`Due in ${daysUntilDue} days`);
    }
  }

  // ── Priority (lower number = higher priority) ──
  const p = t.priority ?? 50;
  if (p <= 1) { score += W.PRIORITY_1; reasons.push('Urgent priority'); }
  else if (p <= 2) { score += W.PRIORITY_2; reasons.push('High priority'); }
  else if (p <= 3) { score += W.PRIORITY_3; }

  // ── Source bonuses ──
  if (t.source === 'milestone') {
    score += W.MILESTONE;
    if (!reasons.length) reasons.push('Onboarding milestone');
  }

  // ── Pinned ──
  if (t.is_pinned) {
    score += W.PINNED;
    reasons.push('Pinned');
  }

  // ── Freshness: recently updated tasks get a small nudge ──
  if (t.updated_at) {
    const updatedAgo = now.getTime() - new Date(t.updated_at).getTime();
    if (updatedAgo < MS_PER_DAY) score += W.RECENTLY_UPDATED;
  }

  // Default reason if nothing specific triggered
  if (reasons.length === 0) {
    if (t.due_date) reasons.push('Has a due date');
    else reasons.push('Open task');
  }

  return { task: t, score, reasons };
}

/**
 * Build a human-readable reason string from scored reasons.
 */
function buildReason(reasons: string[]): string {
  if (reasons.length === 0) return 'Open task.';
  // Capitalize first, join with " — "
  const main = reasons[0].charAt(0).toUpperCase() + reasons[0].slice(1);
  if (reasons.length === 1) return main + '.';
  return main + ' — ' + reasons.slice(1).join(', ') + '.';
}

/**
 * Source-diverse selection: after scoring, pick top tasks but avoid
 * flooding results from a single source.
 */
function diverseSelect(scored: ScoredTask[], count: number): ScoredTask[] {
  if (scored.length <= count) return scored;

  const result: ScoredTask[] = [];
  const sourceCount: Record<string, number> = {};
  // How many of the same source before we start skipping
  const maxPerSource = Math.max(2, Math.ceil(count * 0.4));

  for (const item of scored) {
    if (result.length >= count) break;
    const src = item.task.source;
    const cnt = sourceCount[src] ?? 0;
    if (cnt < maxPerSource) {
      result.push(item);
      sourceCount[src] = cnt + 1;
    }
  }

  // If we didn't fill up (because of diversity limits), backfill from remaining
  if (result.length < count) {
    const picked = new Set(result.map(r => r.task.id));
    for (const item of scored) {
      if (result.length >= count) break;
      if (!picked.has(item.task.id)) {
        result.push(item);
      }
    }
  }

  return result;
}

/**
 * Rules-based task prioritization — no API key required.
 * Scores tasks by: overdue, SLA breach, due date proximity,
 * priority level, source type, pinned status, and freshness.
 * Returns a diverse mix across sources.
 */
export function getNextActions(
  tasks: Task[],
  count: number,
): ActionSuggestion[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  recordAiActionsDebug(`[score] Scoring ${tasks.length} tasks, selecting top ${count}`);

  const scored = tasks.map(t => scoreTask(t, now, todayStart));
  scored.sort((a, b) => b.score - a.score);

  const selected = diverseSelect(scored, count);

  const suggestions = selected.map(s => ({
    task_id: s.task.id,
    reason: buildReason(s.reasons),
  }));

  recordAiActionsDebug(
    `[score] Top scores: ${selected.slice(0, 5).map(s => `${s.task.id}=${s.score}`).join(', ')}`
  );

  return suggestions;
}
