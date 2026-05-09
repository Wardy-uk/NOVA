import { query, execute } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';

export interface NoveltyCheck {
  is_novel: boolean;
  prior_count: number;
  similar_tickets: string[];
}

export interface LearningVelocity {
  novel_encountered: number;
  learning_acquired: number;
  avg_days_to_learn: number | null;
  autonomy_suggestions: number;
}

export class SelfDirectedLearning {
  constructor(private settings: SettingsQueries) {}

  async checkNovelty(requestType: string | null, component: string | null): Promise<NoveltyCheck> {
    if (!requestType && !component) {
      return { is_novel: false, prior_count: 999, similar_tickets: [] };
    }

    let sql = `SELECT TOP 5 ticket_id FROM agent_decisions WHERE 1=1`;
    const params: unknown[] = [];

    if (requestType && component) {
      sql += ` AND reasoning LIKE ? AND reasoning LIKE ?`;
      params.push(`%${requestType}%`, `%${component}%`);
    } else if (requestType) {
      sql += ` AND reasoning LIKE ?`;
      params.push(`%${requestType}%`);
    } else {
      sql += ` AND reasoning LIKE ?`;
      params.push(`%${component}%`);
    }

    sql += ` AND created_at >= DATEADD(day, -90, GETUTCDATE()) ORDER BY created_at DESC`;

    const prior = await query<{ ticket_id: string }>(sql, params);

    return {
      is_novel: prior.length < 3,
      prior_count: prior.length,
      similar_tickets: prior.map(p => p.ticket_id),
    };
  }

  async markNovel(ticketId: string): Promise<void> {
    await execute(
      `UPDATE agent_decisions SET is_novel_type = 1 WHERE ticket_id = ? AND is_novel_type = 0`,
      [ticketId],
    );
  }

  async recordLearning(ticketKey: string): Promise<void> {
    await execute(
      `UPDATE agent_decisions
       SET learning_acquired_at = GETUTCDATE()
       WHERE ticket_id = ? AND is_novel_type = 1 AND learning_acquired_at IS NULL`,
      [ticketKey],
    );
  }

  async checkAutonomyExpansion(requestType: string, component: string | null): Promise<{
    suggest_expansion: boolean;
    successful_count: number;
    detail: string;
  }> {
    const threshold = parseInt(this.settings.get('agent_learning_autonomy_threshold') ?? '5', 10);

    let sql = `SELECT COUNT(*) AS cnt FROM agent_decisions
      WHERE is_novel_type = 1 AND learning_acquired_at IS NOT NULL
        AND outcome IN ('executed', 'approved')
        AND reasoning LIKE ?`;
    const params: unknown[] = [`%${requestType}%`];

    if (component) {
      sql += ` AND reasoning LIKE ?`;
      params.push(`%${component}%`);
    }

    const result = await query<{ cnt: number }>(sql, params);
    const count = result[0]?.cnt ?? 0;

    return {
      suggest_expansion: count >= threshold,
      successful_count: count,
      detail: count >= threshold
        ? `NOVA has ${count} successful resolutions of ${requestType}${component ? ` / ${component}` : ''}. Consider adding autonomy rule.`
        : `${count}/${threshold} successful resolutions needed before autonomy expansion.`,
    };
  }

  async getLearningVelocity(days: number = 30): Promise<LearningVelocity> {
    const novel = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM agent_decisions
       WHERE is_novel_type = 1 AND created_at >= DATEADD(day, -?, GETUTCDATE())`,
      [days],
    );

    const acquired = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM agent_decisions
       WHERE is_novel_type = 1 AND learning_acquired_at IS NOT NULL
         AND created_at >= DATEADD(day, -?, GETUTCDATE())`,
      [days],
    );

    const avgDays = await query<{ avg_days: number | null }>(
      `SELECT AVG(CAST(DATEDIFF(HOUR, created_at, learning_acquired_at) AS FLOAT) / 24) AS avg_days
       FROM agent_decisions
       WHERE is_novel_type = 1 AND learning_acquired_at IS NOT NULL
         AND created_at >= DATEADD(day, -?, GETUTCDATE())`,
      [days],
    );

    const suggestions = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM agent_autonomy
       WHERE category LIKE '%novel%' AND created_at >= DATEADD(day, -?, GETUTCDATE())`,
      [days],
    );

    return {
      novel_encountered: novel[0]?.cnt ?? 0,
      learning_acquired: acquired[0]?.cnt ?? 0,
      avg_days_to_learn: avgDays[0]?.avg_days ?? null,
      autonomy_suggestions: suggestions[0]?.cnt ?? 0,
    };
  }

  async getNovelTickets(limit: number = 20): Promise<Array<{
    ticket_id: string;
    created_at: string;
    learning_acquired_at: string | null;
    action: string;
    outcome: string;
  }>> {
    return query(
      `SELECT TOP (?) ticket_id, created_at, learning_acquired_at, action, outcome
       FROM agent_decisions
       WHERE is_novel_type = 1
       ORDER BY created_at DESC`,
      [limit],
    );
  }
}
