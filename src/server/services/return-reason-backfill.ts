import { z } from 'zod';
import { query, execute } from './database.js';
import type { LlmService } from './llm-service.js';
import { REJECTION_REASON_OPTIONS, rejectionReasonOutcome } from './tier-move-classifier.js';

/**
 * Give the rejection trend a history.
 *
 * From 27 Apr 2026 the Dev Review return modal has demanded a written reason —
 * 518 of them, every one populated, averaging 219 characters. It is the richest
 * account of why work comes back that exists anywhere in the system, and none of
 * it reaches the escalation log: the reason went into `dev_review_thread`, the
 * reporting reads `escalation_log`, and nothing joined the two. Meanwhile the
 * classifier, watching a Jira field nobody filled in, wrote `jira_unclassified`
 * against 206 handbacks a month.
 *
 * The picker added in v1.1.567 fixes that going forward. This fixes it backwards,
 * so the first month of honest rejection data does not read as the moment
 * rejections started happening.
 *
 * What it will NOT do:
 *
 * - Overwrite evidence. A reason a human actually chose is never touched; only
 *   NULL and `jira_unclassified` rows are eligible.
 * - Pass itself off as evidence. Everything it writes is stamped
 *   `reason_source = 'llm_backfill'`, because a model reading free text months
 *   later is a weaker claim than someone picking an option at the time, and that
 *   difference has to survive into the reporting.
 * - Guess. A return whose text does not clearly match an option comes back
 *   `unclear` and is left alone. The unexplained bucket shrinking honestly is the
 *   goal; it emptying is not.
 */

/** Batched so 518 returns cost ~52 calls rather than 518. Small enough that one
 *  confusing note cannot drag the rest, large enough to be worth batching. */
const BATCH_SIZE = 10;

const ClassificationSchema = z.object({
  results: z.array(z.object({
    id: z.number(),
    reason: z.string(),
  })),
});

export interface BackfillResult {
  examined: number;
  classified: number;
  unclear: number;
  escalationRowsUpdated: number;
  byReason: Record<string, number>;
  errors: string[];
  dryRun: boolean;
}

interface ReturnRow {
  id: number;
  jira_key: string;
  body: string;
  created_at: string;
}

function buildSystemPrompt(): string {
  const rejection = REJECTION_REASON_OPTIONS.filter(o => o.outcome === 'rejection').map(o => o.value);
  const returned = REJECTION_REASON_OPTIONS.filter(o => o.outcome === 'return').map(o => o.value);
  return [
    'You classify handback notes written by senior support and development staff',
    'returning a ticket to a lower support tier. Each note is the "Next steps" text',
    'the engineer wrote at the time.',
    '',
    'Choose EXACTLY ONE label per note, from this list:',
    '',
    'The escalation should not have been made, or arrived unusable:',
    ...rejection.map(v => '  - ' + v),
    '',
    'The senior tier did the work and is handing it back — the process working:',
    ...returned.map(v => '  - ' + v),
    '',
    '  - unclear',
    '',
    'Rules:',
    '- "unclear" is a correct and expected answer. Use it whenever the note does not',
    '  clearly indicate one label. A wrong label is far worse than "unclear", because',
    '  these feed a report on how well each tier escalates.',
    '- A note describing a fix, a configuration change, an explanation for the',
    '  customer, or a request to verify something now working, is the senior tier',
    '  having done the work. It is NOT a rejection.',
    '- A note asking for information, saying the customer never replied, saying the',
    '  work belongs to another team, or saying it could have been handled without',
    '  escalating, IS a rejection.',
    '- Reply with one entry per input id. Use the label text exactly as written above.',
  ].join('\n');
}

/**
 * Locate the tier move a written return belongs to.
 *
 * Time-bounded rather than joined on the ticket alone, because a ticket that has
 * bounced four times has four downward moves, and attaching the reason to the
 * wrong one is worse than attaching it to none. The sync notices a move up to
 * several minutes after it happens, hence the asymmetric window; the 15-minute
 * lead absorbs clock skew between Jira and the log.
 */
const MATCHING_MOVE = `
  SELECT TOP 1 id FROM escalation_log
   WHERE ticket_key = ?
     AND from_tier IS NOT NULL AND to_tier IS NOT NULL AND from_tier <> to_tier
     AND created_at BETWEEN DATEADD(minute, -15, ?) AND DATEADD(hour, 2, ?)
     AND (reason_code IS NULL OR reason_code = 'jira_unclassified')
     AND (reason_source IS NULL OR reason_source = 'llm_backfill')
   ORDER BY ABS(DATEDIFF(second, created_at, ?))`;

export async function backfillReturnReasons(
  llm: LlmService,
  opts: { limit?: number; dryRun?: boolean } = {},
): Promise<BackfillResult> {
  const dryRun = opts.dryRun !== false;   // writes only when explicitly asked for
  const limit = Math.min(Math.max(opts.limit ?? 600, 1), 2000);

  const rows = await query<ReturnRow>(
    `SELECT TOP (?) id, jira_key, ISNULL(body, '') AS body,
            CONVERT(varchar(33), created_at, 126) AS created_at
       FROM dev_review_thread
      WHERE kind = 'return'
        AND body IS NOT NULL AND LEN(LTRIM(RTRIM(body))) > 0
        AND (meta_json IS NULL OR JSON_VALUE(meta_json, '$.reason') IS NULL)
      ORDER BY created_at DESC`,
    [limit],
  );

  const result: BackfillResult = {
    examined: rows.length, classified: 0, unclear: 0,
    escalationRowsUpdated: 0, byReason: {}, errors: [], dryRun,
  };

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // Loosely typed on purpose: this is model output, so every field is treated
    // as possibly missing and checked below rather than trusted by the type.
    let classified: Array<{ id?: number; reason?: string }>;
    try {
      const res = await llm.call<z.infer<typeof ClassificationSchema>>(
        buildSystemPrompt(),
        JSON.stringify(batch.map(r => ({ id: r.id, note: r.body.slice(0, 1500) }))),
        ClassificationSchema,
        { callType: 'return_reason_backfill', tier: 'cheap', maxTokens: 1500 },
      );
      classified = res.data.results;
    } catch (err) {
      // One bad batch must not abandon the other fifty. Recorded and skipped.
      result.errors.push(`batch at ${i}: ${err instanceof Error ? err.message : 'unknown'}`);
      continue;
    }

    for (const row of batch) {
      const raw = classified.find(c => c.id === row.id)?.reason;
      const outcome = rejectionReasonOutcome(raw);
      if (!raw || !outcome) {
        // 'unclear', a label the model invented, or a row it silently dropped.
        // All three mean the same thing here: we still do not know.
        result.unclear++;
        continue;
      }
      // Canonical spelling, not whatever casing came back.
      const label = REJECTION_REASON_OPTIONS.find(
        o => o.value.toLowerCase() === raw.trim().toLowerCase(),
      )!.value;
      result.classified++;
      result.byReason[label] = (result.byReason[label] ?? 0) + 1;
      if (dryRun) continue;

      await execute(
        `UPDATE dev_review_thread
            SET meta_json = JSON_MODIFY(JSON_MODIFY(ISNULL(meta_json, '{}'),
                              '$.reason', ?), '$.reason_source', 'llm_backfill')
          WHERE id = ?`,
        [label, row.id],
      );

      const match = await query<{ id: number }>(
        MATCHING_MOVE,
        [row.jira_key, row.created_at, row.created_at, row.created_at],
      );
      const moveId = match[0]?.id;
      if (!moveId) continue;

      await execute(
        `UPDATE escalation_log
            SET escalation_type = ?, reason_code = ?, reason_label = ?, reason_source = 'llm_backfill'
          WHERE id = ?`,
        [
          outcome === 'rejection' ? 'rejection' : 'jira_transition',
          // The codes downstream already understands. flow-signals excludes
          // jira_return_after_fix from the friction numbers, and a new code here
          // would quietly stop that working.
          outcome === 'rejection' ? 'jira_rejection' : 'jira_return_after_fix',
          label,
          moveId,
        ],
      );
      result.escalationRowsUpdated++;
    }
  }

  return result;
}
