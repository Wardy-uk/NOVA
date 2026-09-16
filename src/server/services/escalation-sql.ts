import { TIER_RANK } from './tier-rank.js';

/**
 * SQL predicates that decide what an `escalation_log` row MEANS.
 *
 * These exist because the classification was being thrown away. `jira-sync`
 * runs `classifyTierMove()` on every tier change and records the verdict in
 * `escalation_type` / `reason_code` — precisely so a released fix coming back
 * to be verified is never counted as a rejection. The KPI layer then filtered
 * on `from_tier` / `to_tier` alone and read neither column, which reinstated
 * the exact error the classifier was written to prevent: "Tickets rejected by
 * Development" counted every Development → Tier 3 move, most of which are
 * completed work returning for test.
 *
 * Expressed as SQL rather than filtered in TypeScript because the counts are
 * aggregates — pulling every row back to classify it in memory would mean
 * reading the whole log to produce one integer.
 *
 * The rank CASE is GENERATED from `TIER_RANK` rather than retyped, for the
 * reason tier-rank.ts already gives: a divergent copy is how two callers
 * quietly stop agreeing. Adding a queue there fixes it here too.
 */

/** Seniority of a tier column as a SQL expression. NULL for queues off the
 *  ladder (Escalations, Production) — the same "cannot say" that tierRank()
 *  returns, and it must stay NULL so off-ladder moves fail the comparisons
 *  below rather than being guessed at. */
export function tierRankSql(col: string): string {
  const whens = Object.entries(TIER_RANK)
    .map(([name, rank]) => `WHEN '${name}' THEN ${rank}`)
    .join(' ');
  return `(CASE LOWER(LTRIM(RTRIM(${col}))) ${whens} ELSE NULL END)`;
}

/** Event types that ARE an escalation by intent, whatever the tier columns say.
 *  A manual "this needs to jump the queue" does not necessarily move tier, so
 *  requiring an upward tier move would drop it. */
const ESCALATING_TYPES = ['manual', 'ai_agent', 'sla_risk', 'complaint_portal'];

/**
 * A row that is genuinely an escalation.
 *
 * NOT simply `escalation_type <> 'rejection'`. That was the old denominator and
 * it swept in lateral moves, returns-after-fix, unclassified downward moves and
 * disputes — none of which are escalations. Every one of them inflated the
 * denominator of Escalation Accuracy and so flattered the result.
 */
export const GENUINE_ESCALATION = `(
  escalation_type IN (${ESCALATING_TYPES.map(t => `'${t}'`).join(', ')})
  OR (${tierRankSql('to_tier')} > ${tierRankSql('from_tier')})
)`;

/**
 * A row that is genuinely a rejection — a higher tier formally handing work
 * back as not good enough.
 *
 * `escalation_type = 'rejection'` and nothing looser. The sync sets it only
 * when the Rejection Reason field CHANGED on the same pass, which proves the
 * "Submit for Rejection to ..." screen was used. Inferring from direction
 * instead is what produced 217 phantom handbacks.
 */
export const GENUINE_REJECTION = `(escalation_type = 'rejection')`;
