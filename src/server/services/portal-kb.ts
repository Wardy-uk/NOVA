import { query, queryOne, execute } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { McpClientManager } from './mcp-client.js';
import type { PortalKbArticle } from '../../shared/portal-types.js';
import { trackEvent } from './portal-analytics.js';

export class PortalKbService {
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private settings: FileSettingsQueries,
    private mcpManager?: McpClientManager,
  ) {}

  startSync(): void {
    const intervalMinutes = parseInt(this.settings.get('portal_kb_sync_interval_minutes') || '30', 10);
    this.syncTimer = setInterval(() => this.syncFromConfluence().catch(console.error), intervalMinutes * 60 * 1000);
    // Initial sync after 30 seconds
    setTimeout(() => this.syncFromConfluence().catch(console.error), 30_000);
  }

  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async syncFromConfluence(): Promise<{ added: number; updated: number }> {
    const spaceKey = this.settings.get('kb_confluence_space') || 'NT';
    const parentPageId = this.settings.get('kb_confluence_parent_page_id');

    if (!parentPageId) {
      console.warn('[portal-kb] No kb_confluence_parent_page_id configured, skipping sync');
      return { added: 0, updated: 0 };
    }

    let pages: Array<{ id: string; title: string; body: { storage: { value: string } }; metadata?: { labels?: { results?: Array<{ name: string }> } }; version?: { when: string } }> = [];

    try {
      if (this.mcpManager) {
        const result = await this.mcpManager.callTool('jira', 'confluence_get_page_children', {
          page_id: parentPageId,
          space_key: spaceKey,
          limit: 100,
        });
        if (result && Array.isArray(result)) {
          pages = result;
        }
      }
    } catch (err) {
      console.warn('[portal-kb] Confluence MCP sync failed, trying REST:', err instanceof Error ? err.message : err);
    }

    // If MCP didn't work or returned nothing, try direct Confluence REST
    if (pages.length === 0) {
      try {
        pages = await this.fetchPagesViaRest(spaceKey, parentPageId);
      } catch (err) {
        console.error('[portal-kb] Confluence REST sync also failed:', err instanceof Error ? err.message : err);
        return { added: 0, updated: 0 };
      }
    }

    let added = 0, updated = 0;

    for (const page of pages) {
      const bodyHtml = page.body?.storage?.value || '';
      const bodyText = stripHtml(bodyHtml);
      const labels = page.metadata?.labels?.results?.map(l => l.name).join(',') || '';
      const category = this.deriveCategoryFromLabels(labels);
      const publishedAt = page.version?.when || new Date().toISOString();

      const existing = await queryOne<{ id: number }>(
        `SELECT id FROM portal_kb_articles WHERE confluence_page_id = ?`,
        [page.id],
      );

      if (existing) {
        await execute(
          `UPDATE portal_kb_articles SET title = ?, body_html = ?, body_text = ?,
           category = ?, labels = ?, updated_at = ?, synced_at = GETUTCDATE()
           WHERE id = ?`,
          [page.title, bodyHtml, bodyText, category, labels, publishedAt, existing.id],
        );
        updated++;
      } else {
        await execute(
          `INSERT INTO portal_kb_articles (confluence_page_id, title, body_html, body_text, category, labels, published_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [page.id, page.title, bodyHtml, bodyText, category, labels, publishedAt, publishedAt],
        );
        added++;
      }
    }

    console.log(`[portal-kb] Sync complete: ${added} added, ${updated} updated`);
    return { added, updated };
  }

  private async fetchPagesViaRest(
    spaceKey: string,
    parentPageId: string,
  ): Promise<Array<{ id: string; title: string; body: { storage: { value: string } }; metadata?: { labels?: { results?: Array<{ name: string }> } }; version?: { when: string } }>> {
    const confluenceUrl = this.settings.get('confluence_base_url');
    const confluenceUser = this.settings.get('confluence_user') || this.settings.get('jira_email');
    const confluenceToken = this.settings.get('confluence_api_token') || this.settings.get('jira_api_token');

    if (!confluenceUrl || !confluenceUser || !confluenceToken) {
      throw new Error('Confluence REST credentials not configured');
    }

    const auth = Buffer.from(`${confluenceUser}:${confluenceToken}`).toString('base64');
    const url = `${confluenceUrl}/rest/api/content/${parentPageId}/child/page?expand=body.storage,metadata.labels,version&limit=100`;

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });

    if (!res.ok) throw new Error(`Confluence API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.results || [];
  }

  private deriveCategoryFromLabels(labels: string): string | null {
    if (!labels) return null;
    const labelList = labels.split(',').map(l => l.trim().toLowerCase());
    // Map common label patterns to categories
    if (labelList.some(l => l.includes('website'))) return 'Website';
    if (labelList.some(l => l.includes('email'))) return 'Email Marketing';
    if (labelList.some(l => l.includes('crm') || l.includes('leadpro'))) return 'CRM / LeadPro';
    if (labelList.some(l => l.includes('portal') || l.includes('valuation'))) return 'Portal';
    if (labelList.some(l => l.includes('onboarding'))) return 'Onboarding';
    return labelList[0] || null;
  }

  async search(searchQuery: string, portalUserId?: number, orgId?: number): Promise<Array<{
    id: number;
    title: string;
    excerpt: string;
    category: string | null;
    labels: string | null;
    helpfulScore: number;
  }>> {
    await trackEvent('kb_search', portalUserId || null, orgId || null, { search_query: searchQuery });

    const terms = searchQuery.split(/\s+/).filter(t => t.length > 2).slice(0, 10);
    if (terms.length === 0) return [];

    const conditions = terms.map(() => `(body_text LIKE ? OR title LIKE ?)`).join(' OR ');
    const params: unknown[] = [];
    terms.forEach((t) => { params.push(`%${t}%`, `%${t}%`); });

    const rows = await query<{
      id: number;
      title: string;
      body_text: string;
      category: string | null;
      labels: string | null;
      helpful_yes: number;
      helpful_no: number;
    }>(
      `SELECT TOP 20 id, title, LEFT(body_text, 500) AS body_text, category, labels, helpful_yes, helpful_no
       FROM portal_kb_articles
       WHERE ${conditions}
       ORDER BY (helpful_yes - helpful_no) DESC, view_count DESC`,
      params,
    );

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      excerpt: this.extractExcerpt(r.body_text, terms),
      category: r.category,
      labels: r.labels,
      helpfulScore: r.helpful_yes + r.helpful_no > 0
        ? Math.round((r.helpful_yes / (r.helpful_yes + r.helpful_no)) * 100)
        : 0,
    }));
  }

  private extractExcerpt(bodyText: string, terms: string[]): string {
    // Find first occurrence of any term and extract surrounding text
    const lowerBody = bodyText.toLowerCase();
    for (const term of terms) {
      const idx = lowerBody.indexOf(term.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 80);
        const end = Math.min(bodyText.length, idx + term.length + 120);
        let excerpt = bodyText.slice(start, end).trim();
        if (start > 0) excerpt = '...' + excerpt;
        if (end < bodyText.length) excerpt += '...';
        return excerpt;
      }
    }
    return bodyText.slice(0, 200);
  }

  async getArticle(id: number, portalUserId?: number, orgId?: number): Promise<PortalKbArticle | null> {
    const article = await queryOne<PortalKbArticle>(
      `SELECT * FROM portal_kb_articles WHERE id = ?`,
      [id],
    ) ?? null;

    if (article) {
      await execute(`UPDATE portal_kb_articles SET view_count = view_count + 1 WHERE id = ?`, [id]);
      await trackEvent('kb_view', portalUserId || null, orgId || null, { article_id: id });
    }

    return article;
  }

  async submitFeedback(id: number, helpful: boolean): Promise<void> {
    if (helpful) {
      await execute(`UPDATE portal_kb_articles SET helpful_yes = helpful_yes + 1 WHERE id = ?`, [id]);
    } else {
      await execute(`UPDATE portal_kb_articles SET helpful_no = helpful_no + 1 WHERE id = ?`, [id]);
    }
  }

  async getCategories(): Promise<Array<{ category: string; count: number }>> {
    return query<{ category: string; count: number }>(
      `SELECT ISNULL(category, 'Uncategorised') AS category, COUNT(*) AS count
       FROM portal_kb_articles
       GROUP BY category
       ORDER BY count DESC`,
    );
  }

  async getPopularArticles(limit: number = 5): Promise<Array<{ id: number; title: string; view_count: number; category: string | null }>> {
    return query(
      `SELECT TOP (${limit}) id, title, view_count, category
       FROM portal_kb_articles ORDER BY view_count DESC`,
    );
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
