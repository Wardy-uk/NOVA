import { query, execute } from './database.js';
import type { KbMatch } from './kb-search.js';

export class KbGapClosureService {

  async tagGapWithArticle(gapId: number, confluencePageId: string, articleTitle: string, confluenceUrl: string): Promise<void> {
    await execute(
      `UPDATE kb_gap_log
       SET confluence_page_id = ?, article_title = ?, confluence_url = ?,
           status = 'article_published', resolved_at = GETUTCDATE()
       WHERE id = ?`,
      [confluencePageId, articleTitle, confluenceUrl, gapId],
    );
  }

  async getRecentlyPublishedForCategory(category: string): Promise<Array<{
    gap_id: number;
    confluence_page_id: string;
    article_title: string;
    confluence_url: string;
  }>> {
    return query<{
      gap_id: number;
      confluence_page_id: string;
      article_title: string;
      confluence_url: string;
    }>(
      `SELECT id AS gap_id, confluence_page_id, article_title, confluence_url
       FROM kb_gap_log
       WHERE category = ? AND status = 'article_published'
         AND confluence_page_id IS NOT NULL
         AND resolved_at >= DATEADD(day, -90, GETUTCDATE())
       ORDER BY resolved_at DESC`,
      [category],
    );
  }

  async forceIncludePublishedArticles(category: string, existingMatches: KbMatch[]): Promise<KbMatch[]> {
    const published = await this.getRecentlyPublishedForCategory(category);
    if (published.length === 0) return existingMatches;

    const existingIds = new Set(existingMatches.map(m => m.id));
    const injected: KbMatch[] = [...existingMatches];

    for (const article of published) {
      if (!existingIds.has(article.confluence_page_id)) {
        injected.unshift({
          id: article.confluence_page_id,
          title: article.article_title,
          excerpt: `[Force-included: recently published from KB gap for category "${category}"]`,
          relevance: 0.95,
          url: article.confluence_url,
        });
      }
    }

    return injected;
  }

  async recordLoopClosure(ticketKey: string, articleId: string, category: string): Promise<void> {
    // Find the gap that was closed by this article
    const gap = await query<{ id: number }>(
      `SELECT TOP 1 id FROM kb_gap_log
       WHERE confluence_page_id = ? AND category = ? AND status = 'article_published'
       ORDER BY resolved_at DESC`,
      [articleId, category],
    );
    if (gap.length > 0) {
      await execute(
        `UPDATE kb_gap_log SET status = 'loop_closed' WHERE id = ?`,
        [gap[0].id],
      );
    }
  }

  async getClosureStats(): Promise<{ total_gaps: number; articles_published: number; loops_closed: number; closure_rate: number }> {
    const rows = await query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*) AS cnt FROM kb_gap_log GROUP BY status`,
    );
    let total = 0;
    let published = 0;
    let closed = 0;
    for (const r of rows) {
      total += r.cnt;
      if (r.status === 'article_published') published += r.cnt;
      if (r.status === 'loop_closed') { closed += r.cnt; published += r.cnt; }
    }
    return {
      total_gaps: total,
      articles_published: published,
      loops_closed: closed,
      closure_rate: total > 0 ? closed / total : 0,
    };
  }
}
