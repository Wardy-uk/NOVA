import { query, execute, executeAndGetId } from './database.js';

interface TuningSignal {
  id: number;
  category: string;
  signal_type: string;
  bias_instruction: string;
  strength: number;
  sample_size: number;
  active: boolean;
  generated_at: string;
}

export class TriageTuningFeedback {

  async getSignalsForCategory(categoryHint: string): Promise<string> {
    if (!categoryHint) return '';

    try {
      const signals = await query<TuningSignal>(
        `SELECT * FROM agent_tuning_signals
         WHERE active = 1 AND category = ? AND sample_size >= 5`,
        [categoryHint],
      );

      if (signals.length === 0) return '';

      return signals.map(s =>
        `[${s.signal_type}] (strength: ${(s.strength * 100).toFixed(0)}%, based on ${s.sample_size} decisions): ${s.bias_instruction}`
      ).join('\n');
    } catch {
      return '';
    }
  }

  async getActiveSignals(): Promise<TuningSignal[]> {
    return query<TuningSignal>(
      `SELECT * FROM agent_tuning_signals WHERE active = 1 ORDER BY strength DESC`,
    );
  }

  async refresh(): Promise<{ deactivated: number; created: number }> {
    // Deactivate old signals
    await execute(`UPDATE agent_tuning_signals SET active = 0 WHERE active = 1`);
    let deactivated = 0;
    let created = 0;

    // Compute over-escalation bias per category
    const overEsc = await query<{ category: string; total: number; over_escalated: number }>(
      `SELECT
         JSON_VALUE(inputs, '$.classification.category') AS category,
         COUNT(*) AS total,
         SUM(CASE WHEN ad.action = 'escalate'
              AND jic.last_n8n_comment IS NOT NULL
              AND (LOWER(jic.last_n8n_comment) LIKE '%responded%' OR LOWER(jic.last_n8n_comment) LIKE '%comment added%')
              THEN 1 ELSE 0 END) AS over_escalated
       FROM agent_decisions ad
       LEFT JOIN jira_issue_cache jic ON jic.issue_key = ad.ticket_key
       WHERE ad.created_at >= DATEADD(DAY, -30, GETUTCDATE())
         AND JSON_VALUE(inputs, '$.classification.category') IS NOT NULL
       GROUP BY JSON_VALUE(inputs, '$.classification.category')
       HAVING COUNT(*) >= 10`,
    );

    for (const row of overEsc) {
      if (!row.category) continue;
      const rate = row.over_escalated / row.total;
      if (rate > 0.4) {
        await executeAndGetId(
          `INSERT INTO agent_tuning_signals (category, signal_type, bias_instruction, strength, sample_size)
           VALUES (?, 'over_escalation_bias', ?, ?, ?)`,
          [
            row.category,
            `Historical data shows this category is frequently over-escalated (${(rate * 100).toFixed(0)}% rate). Consider whether a respond or gather_context action would be more appropriate.`,
            rate,
            row.total,
          ],
        );
        created++;
      }
    }

    // Compute false-no-action bias per category
    const falseNoAction = await query<{ category: string; total: number; missed: number }>(
      `SELECT
         JSON_VALUE(inputs, '$.classification.category') AS category,
         COUNT(*) AS total,
         SUM(CASE WHEN ad.action = 'no_action'
              AND jic.last_n8n_comment IS NOT NULL
              AND (LOWER(jic.last_n8n_comment) LIKE '%responded%' OR LOWER(jic.last_n8n_comment) LIKE '%comment added%')
              THEN 1 ELSE 0 END) AS missed
       FROM agent_decisions ad
       LEFT JOIN jira_issue_cache jic ON jic.issue_key = ad.ticket_key
       WHERE ad.created_at >= DATEADD(DAY, -30, GETUTCDATE())
         AND JSON_VALUE(inputs, '$.classification.category') IS NOT NULL
       GROUP BY JSON_VALUE(inputs, '$.classification.category')
       HAVING COUNT(*) >= 10`,
    );

    for (const row of falseNoAction) {
      if (!row.category) continue;
      const rate = row.missed / row.total;
      if (rate > 0.3) {
        await executeAndGetId(
          `INSERT INTO agent_tuning_signals (category, signal_type, bias_instruction, strength, sample_size)
           VALUES (?, 'false_no_action_bias', ?, ?, ?)`,
          [
            row.category,
            `Historical data shows this category often requires action that was missed (${(rate * 100).toFixed(0)}% rate). Default to respond or gather_context rather than no_action.`,
            rate,
            row.total,
          ],
        );
        created++;
      }
    }

    return { deactivated, created };
  }
}
