/**
 * Single definition of the no-reply staleness cutoff.
 *
 * The rule is tier-dependent. Development and Tier 3 work runs over days, so a
 * ticket only counts as no-reply after a 7-day silence. Every other tier is
 * customer-facing and the bar is a same-day update.
 *
 * There are four copies of the isNoReply predicate (kpi-pipeline, kpi-agent
 * compute, kpi-org nt-compute, jira-sync-service). They differ in what shape of
 * input they take, so they have not been merged — but they must not diverge on
 * the threshold, which is why that part lives here.
 */

/** Tiers where a same-day update is not the expectation. */
const GRACE_TIERS = new Set(['development', 'tier 3']);

/** Silence allowed on a grace tier before a ticket counts as no-reply. */
export const NO_REPLY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * An agent update at or after this instant means the ticket is NOT no-reply.
 * Same-day tiers anchor on UTC midnight — never local midnight, which is what
 * made the sync-service copy disagree with the other three.
 */
export function noReplyCutoff(currentTier: string | null | undefined, now: Date): Date {
  if (GRACE_TIERS.has((currentTier ?? '').trim().toLowerCase())) {
    return new Date(now.getTime() - NO_REPLY_GRACE_MS);
  }
  const midnightUtc = new Date(now);
  midnightUtc.setUTCHours(0, 0, 0, 0);
  return midnightUtc;
}
