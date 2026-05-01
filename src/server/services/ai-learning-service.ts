import { query, queryOne, executeAndGetId, execute } from './database.js';

export interface AiLearning {
  id: number;
  ticket_key: string;
  category: string | null;
  organisation: string | null;
  ai_draft: string | null;
  learning: string;
  tags: string | null;
  submitted_by: string;
  active: boolean;
  created_at: string;
}

export interface SubmitLearningInput {
  ticket_key: string;
  ai_draft?: string;
  learning: string;
  category?: string;
  organisation?: string;
  tags?: string[];
  submitted_by: string;
}

export class AiLearningService {
  async submit(input: SubmitLearningInput): Promise<number> {
    const tags = input.tags?.length ? input.tags.join(',') : null;
    return executeAndGetId(
      `INSERT INTO ai_learnings (ticket_key, category, organisation, ai_draft, learning, tags, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.ticket_key, input.category ?? null, input.organisation ?? null, input.ai_draft ?? null, input.learning, tags, input.submitted_by],
    );
  }

  async list(opts: { active?: boolean; category?: string; limit?: number; offset?: number } = {}): Promise<{ learnings: AiLearning[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.active !== undefined) {
      conditions.push('active = ?');
      params.push(opts.active);
    }
    if (opts.category) {
      conditions.push('category = ?');
      params.push(opts.category);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const [rows, countRow] = await Promise.all([
      query<AiLearning>(
        `SELECT * FROM ai_learnings ${where} ORDER BY created_at DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
        [...params, offset, limit],
      ),
      queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ai_learnings ${where}`, params),
    ]);

    return { learnings: rows, total: countRow?.cnt ?? 0 };
  }

  async getById(id: number): Promise<AiLearning | undefined> {
    return queryOne<AiLearning>('SELECT * FROM ai_learnings WHERE id = ?', [id]);
  }

  async toggleActive(id: number, active: boolean): Promise<void> {
    await execute('UPDATE ai_learnings SET active = ? WHERE id = ?', [active, id]);
  }

  async update(id: number, fields: { learning?: string; category?: string; tags?: string[]; organisation?: string }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.learning !== undefined) { sets.push('learning = ?'); params.push(fields.learning); }
    if (fields.category !== undefined) { sets.push('category = ?'); params.push(fields.category); }
    if (fields.organisation !== undefined) { sets.push('organisation = ?'); params.push(fields.organisation); }
    if (fields.tags !== undefined) { sets.push('tags = ?'); params.push(fields.tags.join(',')); }

    if (sets.length === 0) return;
    params.push(id);
    await execute(`UPDATE ai_learnings SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async delete(id: number): Promise<void> {
    await execute('DELETE FROM ai_learnings WHERE id = ?', [id]);
  }

  async getRelevantLearnings(category?: string, organisation?: string): Promise<AiLearning[]> {
    const conditions = ['active = 1'];
    const params: unknown[] = [];

    if (category) {
      conditions.push('(category = ? OR category IS NULL)');
      params.push(category);
    }
    if (organisation) {
      conditions.push('(organisation = ? OR organisation IS NULL)');
      params.push(organisation);
    }

    return query<AiLearning>(
      `SELECT * FROM ai_learnings WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params,
    );
  }

  formatForPrompt(learnings: AiLearning[]): string {
    if (learnings.length === 0) return 'No prior learnings available.';

    return learnings
      .map((l, i) => {
        const parts = [`${i + 1}. [${l.ticket_key}]`];
        if (l.category) parts[0] += ` (${l.category})`;
        if (l.organisation) parts[0] += ` — ${l.organisation}`;
        parts.push(`   Learning: ${l.learning}`);
        if (l.tags) parts.push(`   Tags: ${l.tags}`);
        return parts.join('\n');
      })
      .join('\n\n');
  }
}
