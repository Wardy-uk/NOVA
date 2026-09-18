/**
 * Priority gate between deadline-bound work and bulk work.
 *
 * NOVA runs ~60 background jobs against three shared, finite resources: one Jira API rate
 * limit, one S0 database and one set of LLM circuits. Nothing arbitrated between them, so on
 * 18 Sep 2026 the golden-rules backfill, a 436-issue comment backfill and backfill triage all
 * competed with the agent's live triage. Agent ticks went from ~3s to 15-21 minutes, and NT
 * tickets breached a 30-minute First Reply Time SLA while the box was busy scoring tickets
 * that had been resolved for weeks.
 *
 * Every restart made it worse, because all of that work starts at once on boot.
 *
 * The fix is not more workers — it is letting work with no deadline stand aside for work with
 * one. Bulk jobs call `shouldYieldToCriticalWork()` and skip a cycle while the agent holds
 * SLA-bound tickets. They lose a few minutes; a customer does not lose their first reply.
 *
 * Deliberately in-process and advisory: a counter, not a lock. Nothing blocks, nothing can
 * deadlock, and a job that ignores it still works exactly as before.
 */

/** Depth rather than a boolean so nested or overlapping critical sections cannot have the
 *  inner one's exit re-open the gate while the outer is still running. */
let criticalDepth = 0;

/** Consecutive yields per job, so deferring can never become never running. */
const yieldStreak = new Map<string, number>();

/** Above this many consecutive yields a job runs regardless. Bulk work is not optional — it
 *  is just less urgent — and a permanently busy agent must not starve it forever. */
const MAX_CONSECUTIVE_YIELDS = 5;

/** Mark the start of deadline-bound work. Pair with `endCriticalWork()` in a `finally`. */
export function beginCriticalWork(): void {
  criticalDepth++;
}

export function endCriticalWork(): void {
  criticalDepth = Math.max(0, criticalDepth - 1);
}

export function isCriticalWorkInFlight(): boolean {
  return criticalDepth > 0;
}

/**
 * True when the caller should skip this cycle and try again on its next tick.
 *
 * Call once at the top of a bulk job. Returning false resets the job's streak, so the
 * starvation guard measures consecutive yields rather than lifetime ones.
 */
export function shouldYieldToCriticalWork(jobName: string): boolean {
  if (!isCriticalWorkInFlight()) {
    yieldStreak.delete(jobName);
    return false;
  }

  const streak = (yieldStreak.get(jobName) ?? 0) + 1;
  if (streak > MAX_CONSECUTIVE_YIELDS) {
    console.warn(
      `[work-priority] ${jobName} has yielded ${streak - 1} times in a row — running anyway.`
      + ' The agent has been holding critical work continuously, which is itself worth investigating.',
    );
    yieldStreak.delete(jobName);
    return false;
  }

  yieldStreak.set(jobName, streak);
  console.log(`[work-priority] ${jobName} deferring — live SLA-bound triage in flight (${streak}/${MAX_CONSECUTIVE_YIELDS})`);
  return true;
}
