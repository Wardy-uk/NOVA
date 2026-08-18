/**
 * Seniority of a support queue, for deciding whether a tier move was an
 * escalation or a handback.
 *
 * Shared because two places need the same answer and a divergent copy is how one
 * of them quietly stops agreeing: the Jira sync classifies moves as they happen,
 * and flow-signals classifies the history retrospectively. If those two ever
 * disagree, the weekly report contradicts the escalation log.
 *
 * TWO VOCABULARIES have to be normalised here or the classification silently
 * matches nothing. `TIER_PATTERNS` in escalation-log-service emits short forms
 * (`T1`, `T2`, `Dev`); the live sync writes Jira's raw `customfield_12981`
 * values (`Customer Care`, `Tier 2`, `Development`). Both are already in the
 * table.
 *
 * Production and Escalations are deliberately absent. They are not rungs on this
 * ladder — a move into Escalations is not "one level up" from Tier 3 — and
 * inventing a rank for them would manufacture handbacks that never happened.
 * Moves involving them return null and are counted separately.
 */
const TIER_RANK: Record<string, number> = {
  't1': 1, 'tier 1': 1, 'customer care': 1, 'first line': 1, 'cc': 1,
  't2': 2, 'tier 2': 2, 'second line': 2,
  't3': 3, 'tier 3': 3, 'third line': 3,
  'dev': 4, 'development': 4, 'with development': 4,
};

export function tierRank(tier: string | null | undefined): number | null {
  if (!tier) return null;
  return TIER_RANK[tier.trim().toLowerCase()] ?? null;
}

/**
 * Is this move a handback — a return to a LESS senior queue?
 *
 * `null` means "cannot say", not "no": either queue may be off the ladder. The
 * caller must not collapse that into false, because the difference between
 * "this was not a handback" and "this could not be classified" is the whole
 * reason off-ladder moves are reported separately.
 */
export function isHandback(fromTier: string | null | undefined, toTier: string | null | undefined): boolean | null {
  const from = tierRank(fromTier);
  const to = tierRank(toTier);
  if (from === null || to === null) return null;
  return to < from;
}
