import { z } from 'zod';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { KbArticleService } from './kb-article-service.js';
import { query, execute, executeAndGetId } from './database.js';

export interface ArticleHealth {
  id: number;
  article_id: string;
  article_title: string | null;
  article_url: string | null;
  space_key: string | null;
  status: string;
  last_updated: string | null;
  usage_count_30d: number | null;
  usage_count_90d: number | null;
  drift_score: number | null;
  checked_at: string;
}

export interface KbHealthStats {
  total: number;
  current: number;
  stale: number;
  unused: number;
  drifted: number;
  gap_closure_rate: number;
}

const DriftAnalysisSchema = z.object({
  drift_detected: z.boolean(),
  drift_score: z.number().min(0).max(1),
  explanation: z.string(),
  suggested_update: z.string().optional(),
});

export class KbHealthService {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
    private kbArticleService: KbArticleService | null,
  ) {}

  async logUsage(articleId: string, articleTitle: string | null, ticketKey: string, usedInResponse: boolean): Promise<void> {
    await execute(
      `INSERT INTO kb_article_usage (article_id, article_title, ticket_key, used_in_response)
       VALUES (?, ?, ?, ?)`,
      [articleId, articleTitle, ticketKey, usedInResponse ? 1 : 0],
    );
  }

  async runStalenessCheck(): Promise<number> {
    const chunks = await query<{ doc_id: string; doc_title: string; doc_url: string }>(
      `SELECT DISTINCT doc_url AS doc_id, doc_title, doc_url FROM kb_chunks`,
    );
    if (chunks.length === 0) return 0;

    let processed = 0;
    for (const chunk of chunks) {
      try {
        const articleId = chunk.doc_id;

        const usage30d = await query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM kb_article_usage
           WHERE article_id = ? AND retrieved_at >= DATEADD(day, -30, GETUTCDATE())`,
          [articleId],
        );
        const usage90d = await query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM kb_article_usage
           WHERE article_id = ? AND retrieved_at >= DATEADD(day, -90, GETUTCDATE())`,
          [articleId],
        );

        const count30 = usage30d[0]?.cnt ?? 0;
        const count90 = usage90d[0]?.cnt ?? 0;

        let driftScore = 0;
        let status = 'current';

        // Check if stale: no updates in 6 months (we use synced_at as proxy)
        if (count90 < 3) {
          status = 'unused';
        } else {
          // Check drift by comparing article content with recent resolutions
          const driftResult = await this.checkDrift(articleId, chunk.doc_title);
          driftScore = driftResult.drift_score;
          if (driftScore >= 0.5) {
            status = 'drifted';
          }
        }

        // Upsert into kb_article_health
        const existing = await query<{ id: number }>(
          `SELECT id FROM kb_article_health WHERE article_id = ?`,
          [articleId],
        );
        if (existing.length > 0) {
          await execute(
            `UPDATE kb_article_health
             SET article_title = ?, status = ?, usage_count_30d = ?, usage_count_90d = ?,
                 drift_score = ?, article_url = ?, checked_at = GETUTCDATE()
             WHERE article_id = ?`,
            [chunk.doc_title, status, count30, count90, driftScore, chunk.doc_url, articleId],
          );
        } else {
          await execute(
            `INSERT INTO kb_article_health (article_id, article_title, status, usage_count_30d, usage_count_90d, drift_score, article_url, checked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, GETUTCDATE())`,
            [articleId, chunk.doc_title, status, count30, count90, driftScore, chunk.doc_url],
          );
        }
        processed++;
      } catch (err) {
        console.error(`[kb-health] Failed to process article "${chunk.doc_title}":`, err instanceof Error ? err.message : err);
      }
    }

    return processed;
  }

  private async checkDrift(articleId: string, articleTitle: string): Promise<{ drift_score: number; explanation: string }> {
    // Get recent resolutions related to this article's topic
    const recentTickets = await query<{ ticket_key: string; summary: string; resolution_type: string | null }>(
      `SELECT TOP 5 jic.issue_key AS ticket_key, jic.summary, jic.resolution_type
       FROM kb_article_usage kau
       JOIN jira_issue_cache jic ON jic.issue_key = kau.ticket_key
       WHERE kau.article_id = ? AND jic.status_category = 'Done'
         AND kau.retrieved_at >= DATEADD(day, -90, GETUTCDATE())
       ORDER BY jic.jira_updated DESC`,
      [articleId],
    );

    if (recentTickets.length < 2) {
      return { drift_score: 0, explanation: 'Insufficient resolution data for drift analysis' };
    }

    try {
      const result = await this.llm.call(
        `You are a KB health analyst. Compare this article's topic with how agents actually resolved similar tickets.
Determine if the article content is still aligned with current resolution practices.`,
        `Article: "${articleTitle}"
Recent ticket resolutions for tickets where this article was retrieved:
${recentTickets.map(t => `- ${t.ticket_key}: ${t.summary} (resolution: ${t.resolution_type ?? 'unknown'})`).join('\n')}

Are agents resolving these differently from what a KB article on "${articleTitle}" would suggest?`,
        DriftAnalysisSchema,
        { callType: 'kb_health_drift', tier: 'cheap', temperature: 0.1 },
      );
      return { drift_score: result.data.drift_score, explanation: result.data.explanation };
    } catch {
      return { drift_score: 0, explanation: 'Drift analysis failed' };
    }
  }

  async draftUpdateForArticle(articleId: string): Promise<number | null> {
    if (!this.kbArticleService) return null;

    const health = await query<ArticleHealth>(
      `SELECT * FROM kb_article_health WHERE article_id = ?`, [articleId],
    );
    if (health.length === 0) return null;

    const article = health[0];
    const recentTickets = await query<{ ticket_key: string; summary: string; resolution_type: string | null }>(
      `SELECT TOP 5 jic.issue_key AS ticket_key, jic.summary, jic.resolution_type
       FROM kb_article_usage kau
       JOIN jira_issue_cache jic ON jic.issue_key = kau.ticket_key
       WHERE kau.article_id = ? AND jic.status_category = 'Done'
       ORDER BY jic.jira_updated DESC`,
      [articleId],
    );

    const ticketKeys = recentTickets.map(t => t.ticket_key);
    const draft = await this.kbArticleService.generateFromGap(
      'update',
      `Update: ${article.article_title}`,
      `Article marked as ${article.status}. Drift score: ${article.drift_score}`,
      ticketKeys,
      0,
    );
    return draft.id;
  }

  async getHealthStats(): Promise<KbHealthStats> {
    const rows = await query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*) AS cnt FROM kb_article_health GROUP BY status`,
    );
    const stats: KbHealthStats = { total: 0, current: 0, stale: 0, unused: 0, drifted: 0, gap_closure_rate: 0 };
    for (const r of rows) {
      const count = r.cnt;
      stats.total += count;
      if (r.status === 'current') stats.current = count;
      else if (r.status === 'stale') stats.stale = count;
      else if (r.status === 'unused') stats.unused = count;
      else if (r.status === 'drifted') stats.drifted = count;
    }

    // Gap closure rate
    const gapStats = await query<{ total: number; closed: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'loop_closed' THEN 1 ELSE 0 END) AS closed
       FROM kb_gap_log
       WHERE created_at >= DATEADD(day, -90, GETUTCDATE())`,
    );
    if (gapStats[0]?.total > 0) {
      stats.gap_closure_rate = (gapStats[0].closed ?? 0) / gapStats[0].total;
    }

    return stats;
  }

  async getArticleHealth(status?: string): Promise<ArticleHealth[]> {
    if (status) {
      return query<ArticleHealth>(
        `SELECT * FROM kb_article_health WHERE status = ? ORDER BY checked_at DESC`, [status],
      );
    }
    return query<ArticleHealth>(`SELECT * FROM kb_article_health ORDER BY checked_at DESC`);
  }

  async getCoverageHeatmap(): Promise<Array<{ request_type: string; gap_count: number; article_count: number }>> {
    return query<{ request_type: string; gap_count: number; article_count: number }>(
      `SELECT
         COALESCE(g.category, h.article_title) AS request_type,
         COUNT(DISTINCT g.id) AS gap_count,
         COUNT(DISTINCT h.id) AS article_count
       FROM kb_gap_log g
       FULL OUTER JOIN kb_article_health h ON h.article_title LIKE '%' + g.category + '%'
       WHERE g.category IS NOT NULL OR h.article_id IS NOT NULL
       GROUP BY COALESCE(g.category, h.article_title)
       ORDER BY gap_count DESC`,
    );
  }
}
