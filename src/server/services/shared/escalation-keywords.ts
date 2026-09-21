import { query, execute } from '../database.js';

/**
 * Escalation language in ticket comments, matched once per comment instead of once per sweep.
 *
 * The risk scorer used to ask SQL the question directly: fifteen `body_text LIKE '%...%'`
 * predicates, grouped by issue_key, across every public comment on every open ticket. On
 * 21 Sep 2026 that query took between 126 and 204 seconds against a sweep with a 30s request
 * timeout, which is why `agent_flagged_tickets` had not gained a row since 25 Aug.
 *
 * The cost is not the matching — the same 4,443 comments match in JavaScript in 16ms, over
 * 2.7MB of text. The cost is reading `body_text` at all. It lives only in the clustered index
 * of `jira_comment_cache`, which is 991MB across 204,085 rows, so fetching it for a set of
 * issue_keys is that many random lookups into a LOB table on a database already pegged at 100%
 * data IO. Measured at 4.6s once and 188s twenty minutes later, purely on what was in buffer.
 * No rewrite of that query is reliable, because the query is not what is wrong.
 *
 * So each comment is read once, matched in JS, and the two flags kept here. Thereafter a sweep
 * reads two TINYINTs per comment off a narrow table and never touches the LOB.
 *
 * The first population is deliberately incremental rather than a migration backfill: each call
 * tops up at most `limit` comments, so no single sweep pays an unbounded bill and a sweep that
 * starts with a cold cache still completes and still writes its rows — with fewer escalation
 * factors known, which `escalationCoverage()` reports rather than letting it pass for "no
 * escalations found". Absent is not zero. New comments are picked up by the same path, so
 * there is no separate ingest hook to keep in step with the Jira sync.
 */

/** Legal / formal escalation. Scores 35. */
const STRONG = /formal complaint|lawyer|solicitor|legal action|trading standards|ombudsman|ICO|GDPR breach|data protection/i;

/** Customer frustration. Scores 15. */
const MODERATE = /escalat|unacceptable|disgraceful|ridiculous|appalling|threatening/i;

/**
 * Only the head of each comment is matched. Escalation language is how a customer opens, not
 * something buried 4,000 characters into a reply, and capping the read keeps one pathological
 * comment from dominating a batch.
 */
const BODY_CHARS = 4000;

/**
 * Comments to read and classify per call. 400 measured at 17s against prod on 21 Sep 2026 —
 * inside the 30s budget, but not by enough on a database whose IO is already saturated, so
 * 300. At about 4,400 public comments across the open NT queue, a cold cache warms in roughly
 * fifteen sweeps.
 */
const DEFAULT_BATCH = 300;

export interface EscalationFlags {
  hasStrong: boolean;
  hasModerate: boolean;
}

export function matchEscalation(bodyText: string | null | undefined): EscalationFlags {
  if (!bodyText) return { hasStrong: false, hasModerate: false };
  return { hasStrong: STRONG.test(bodyText), hasModerate: MODERATE.test(bodyText) };
}

/**
 * Classify up to `limit` public comments on `issueKeys` that have not been classified yet.
 * Returns how many it did, so a caller can tell a cold cache from a warm one.
 */
export async function topUpEscalationFlags(issueKeys: string[], limit = DEFAULT_BATCH): Promise<number> {
  if (issueKeys.length === 0) return 0;
  const placeholders = issueKeys.map(() => '?').join(',');

  const rows = await query<{ jira_comment_id: string; issue_key: string; body_text: string | null }>(
    `SELECT TOP (${limit}) c.jira_comment_id, c.issue_key, LEFT(c.body_text, ${BODY_CHARS}) AS body_text
     FROM jira_comment_cache c
     LEFT JOIN jira_comment_escalation e ON e.jira_comment_id = c.jira_comment_id
     WHERE c.issue_key IN (${placeholders}) AND c.is_public = 1 AND e.jira_comment_id IS NULL`,
    issueKeys,
  );
  if (rows.length === 0) return 0;

  // One statement per comment rather than a multi-row VALUES list: the batch is capped at a
  // few hundred, and the positional-parameter binder has a 2,100-parameter ceiling that a
  // VALUES list would reach at 700 rows. Not worth the chunking arithmetic to save a second.
  for (const row of rows) {
    const { hasStrong, hasModerate } = matchEscalation(row.body_text);
    await execute(
      `INSERT INTO jira_comment_escalation (jira_comment_id, issue_key, has_strong, has_moderate)
       VALUES (?, ?, ?, ?)`,
      [row.jira_comment_id, row.issue_key, hasStrong ? 1 : 0, hasModerate ? 1 : 0],
    );
  }
  return rows.length;
}

/** Per-issue escalation flags, read off the narrow table. No LOB. */
export async function getEscalationFlags(issueKeys: string[]): Promise<Map<string, EscalationFlags>> {
  const out = new Map<string, EscalationFlags>();
  if (issueKeys.length === 0) return out;
  const placeholders = issueKeys.map(() => '?').join(',');

  const rows = await query<{ issue_key: string; has_strong: number; has_moderate: number }>(
    `SELECT issue_key, MAX(has_strong) AS has_strong, MAX(has_moderate) AS has_moderate
     FROM jira_comment_escalation WHERE issue_key IN (${placeholders}) GROUP BY issue_key`,
    issueKeys,
  );
  for (const r of rows) out.set(r.issue_key, { hasStrong: r.has_strong === 1, hasModerate: r.has_moderate === 1 });
  return out;
}

/**
 * How many of the public comments on these issues have been classified, against how many
 * exist. A sweep reports this so a run made on a half-populated cache is visibly that, rather
 * than looking like a run that found no escalations.
 */
export async function escalationCoverage(issueKeys: string[]): Promise<{ classified: number; total: number }> {
  if (issueKeys.length === 0) return { classified: 0, total: 0 };
  const placeholders = issueKeys.map(() => '?').join(',');

  const rows = await query<{ total: number; classified: number }>(
    `SELECT COUNT(*) AS total, COUNT(e.jira_comment_id) AS classified
     FROM jira_comment_cache c
     LEFT JOIN jira_comment_escalation e ON e.jira_comment_id = c.jira_comment_id
     WHERE c.issue_key IN (${placeholders}) AND c.is_public = 1`,
    issueKeys,
  );
  return { classified: rows[0]?.classified ?? 0, total: rows[0]?.total ?? 0 };
}
