import { query, queryOne, execute, executeAndGetId } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { McpClientManager } from './mcp-client.js';
import type { PortalKbArticle } from '../../shared/portal-types.js';
import { trackEvent } from './portal-analytics.js';
import { expandSearchTerms, cleanSearchTerms, rankAndFilter } from './kb-search-utils.js';

const kbViewCache = new Map<number, { articleIds: number[]; viewedAt: number }>();

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
    const spaceKey = this.settings.get('kb_confluence_space')
      || this.settings.get('kb_confluence_space_keys')?.split(',')[0]?.trim()
      || 'NT';
    const parentPageId = this.settings.get('kb_confluence_parent_page_id');

    let pages: Array<{ id: string; title: string; body: { storage: { value: string } }; metadata?: { labels?: { results?: Array<{ name: string }> } }; version?: { when: string } }> = [];

    // Try parent-page children first (backwards compat)
    if (parentPageId) {
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

      if (pages.length === 0) {
        try {
          pages = await this.fetchChildPagesViaRest(spaceKey, parentPageId);
        } catch (err) {
          console.warn('[portal-kb] Confluence REST child-page sync failed:', err instanceof Error ? err.message : err);
        }
      }
    }

    // Augment with full-space CQL search to pick up articles outside the parent page tree
    try {
      const spacePages = await this.fetchAllSpacePagesViaRest(spaceKey);
      const existingIds = new Set(pages.map(p => p.id));
      for (const p of spacePages) {
        if (!existingIds.has(p.id)) {
          pages.push(p);
          existingIds.add(p.id);
        }
      }
    } catch (err) {
      if (pages.length === 0) {
        console.error('[portal-kb] Confluence full-space sync failed and no child pages available:', err instanceof Error ? err.message : err);
        return { added: 0, updated: 0 };
      }
      console.warn('[portal-kb] Full-space sync failed, continuing with child pages only:', err instanceof Error ? err.message : err);
    }

    if (pages.length === 0) {
      console.warn('[portal-kb] No pages found in space ' + spaceKey);
      return { added: 0, updated: 0 };
    }

    let added = 0, updated = 0;

    for (const page of pages) {
      const bodyHtml = page.body?.storage?.value || '';
      const bodyText = stripHtml(bodyHtml);
      const labels = page.metadata?.labels?.results?.map(l => l.name).join(',') || '';
      const category = this.deriveCategory(page.title, labels, bodyText);
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

  private getConfluenceAuth(): { url: string; auth: string } {
    const confluenceUrl = this.settings.get('confluence_base_url')
      || this.settings.get('confluence_site_url')
      || this.settings.get('jira_url');
    const confluenceUser = this.settings.get('confluence_user')
      || this.settings.get('kb_confluence_email')
      || this.settings.get('jira_username')
      || this.settings.get('jira_email')
      || this.settings.get('jira_ob_email');
    const confluenceToken = this.settings.get('confluence_api_token')
      || this.settings.get('kb_confluence_token')
      || this.settings.get('jira_token')
      || this.settings.get('jira_api_token')
      || this.settings.get('jira_ob_token');

    if (!confluenceUrl || !confluenceUser || !confluenceToken) {
      throw new Error('Confluence REST credentials not configured');
    }

    return {
      url: confluenceUrl.replace(/\/wiki\/?$/, '').replace(/\/$/, ''),
      auth: Buffer.from(`${confluenceUser}:${confluenceToken}`).toString('base64'),
    };
  }

  private async fetchChildPagesViaRest(
    spaceKey: string,
    parentPageId: string,
  ): Promise<Array<{ id: string; title: string; body: { storage: { value: string } }; metadata?: { labels?: { results?: Array<{ name: string }> } }; version?: { when: string } }>> {
    const { url: confluenceUrl, auth } = this.getConfluenceAuth();
    const url = `${confluenceUrl}/wiki/rest/api/content/${parentPageId}/child/page?expand=body.storage,metadata.labels,version&limit=100`;

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });

    if (!res.ok) throw new Error(`Confluence API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.results || [];
  }

  private async fetchAllSpacePagesViaRest(
    spaceKey: string,
  ): Promise<Array<{ id: string; title: string; body: { storage: { value: string } }; metadata?: { labels?: { results?: Array<{ name: string }> } }; version?: { when: string } }>> {
    const { url: confluenceUrl, auth } = this.getConfluenceAuth();
    const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };

    const cql = `space = "${spaceKey}" AND type = "page"`;
    const allPages: Array<{ id: string; title: string; body: { storage: { value: string } }; metadata?: { labels?: { results?: Array<{ name: string }> } }; version?: { when: string } }> = [];
    let start = 0;
    const pageSize = 50;

    while (true) {
      const url = `${confluenceUrl}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&expand=body.storage,metadata.labels,version&limit=${pageSize}&start=${start}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Confluence CQL search ${res.status}: ${await res.text()}`);
      const data = await res.json() as { results: any[]; size: number; _links?: { next?: string } };
      const results = data.results || [];
      for (const page of results) {
        allPages.push(page);
      }
      if (results.length < pageSize || !data._links?.next) break;
      start += pageSize;
      if (allPages.length >= 500) break;
    }

    console.log(`[portal-kb] Full-space CQL found ${allPages.length} pages in space ${spaceKey}`);
    return allPages;
  }

  private deriveCategory(title: string, labels: string, bodyText: string): string | null {
    const fromLabels = this.deriveCategoryFromLabels(labels);
    if (fromLabels) return fromLabels;
    return this.deriveCategoryFromContent(title, bodyText);
  }

  private deriveCategoryFromLabels(labels: string): string | null {
    if (!labels) return null;
    const haystack = labels
      .split(',')
      .map(l => l.trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
    return this.matchCategory(haystack);
  }

  private deriveCategoryFromContent(title: string, bodyText: string): string | null {
    const haystack = `${title} ${bodyText}`.toLowerCase();
    return this.matchCategory(haystack);
  }

  private matchCategory(haystack: string): string | null {
    if (!haystack) return null;

    const rules: Array<{ category: string; patterns: RegExp[] }> = [
      {
        category: 'Email Marketing',
        patterns: [/\bemail\b/, /\bautocaller\b/, /\bnotification\b/, /\bblacklist\b/, /\bcampaign\b/],
      },
      {
        category: 'Website',
        patterns: [/\bwebsite\b/, /\bfacebook advertising\b/, /\bgoogle analytics\b/, /\bseo\b/, /\btracking\b/],
      },
      {
        category: 'Portal',
        patterns: [/\bportal\b/, /\binstant valuation\b/, /\bvaluation tool\b/],
      },
      {
        category: 'Integrations',
        patterns: [/\bwebhook\b/, /\bapi\b/, /\bauthentication\b/, /\balto\b/, /\bzapier\b/, /\bintegration\b/],
      },
      {
        category: 'CRM / LeadPro',
        patterns: [/\bleadpro\b/, /\blead api\b/, /\bcrm\b/, /\blead form\b/, /\blead routing\b/, /\blead attribution\b/],
      },
      {
        category: 'Onboarding',
        patterns: [/\bonboarding\b/, /\bsetting up\b/, /\bset up\b/, /\bsetup\b/, /\badding users\b/],
      },
    ];

    for (const rule of rules) {
      if (rule.patterns.some(pattern => pattern.test(haystack))) return rule.category;
    }

    return null;
  }

  private async refreshDerivedCategories(): Promise<number> {
    const articles = await query<Array<{
      id: number;
      title: string;
      body_text: string | null;
      labels: string | null;
      category: string | null;
    }>[0]>(
      `SELECT id, title, body_text, labels, category
       FROM portal_kb_articles`,
    );

    let updated = 0;
    for (const article of articles) {
      const category = this.deriveCategory(article.title, article.labels || '', article.body_text || '');
      const normalizedCurrent = (article.category || '').trim();
      const normalizedNext = (category || '').trim();
      if (normalizedCurrent === normalizedNext) continue;
      await execute(`UPDATE portal_kb_articles SET category = ? WHERE id = ?`, [category, article.id]);
      updated++;
    }
    if (updated > 0) {
      console.log(`[portal-kb] Refreshed categories for ${updated} portal KB article(s)`);
    }
    return updated;
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

    const originalTerms = cleanSearchTerms(searchQuery.split(/\s+/)).slice(0, 10);
    if (originalTerms.length === 0) return [];

    const allTerms = expandSearchTerms(originalTerms);

    let rows: Array<{
      id: number;
      title: string;
      body_text: string;
      category: string | null;
      labels: string | null;
      helpful_yes: number;
      helpful_no: number;
    }>;

    try {
      const ftTerms = allTerms.map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
      rows = await query(
        `SELECT TOP 40 id, title, LEFT(body_text, 500) AS body_text, category, labels, helpful_yes, helpful_no
         FROM portal_kb_articles
         WHERE CONTAINS((title, body_text), ?)`,
        [ftTerms],
      );
    } catch {
      const conditions = allTerms.map(() => `(body_text LIKE ? OR title LIKE ?)`).join(' OR ');
      const params: unknown[] = [];
      allTerms.forEach((t) => { params.push(`%${t}%`, `%${t}%`); });
      rows = await query(
        `SELECT TOP 40 id, title, LEFT(body_text, 500) AS body_text, category, labels, helpful_yes, helpful_no
         FROM portal_kb_articles
         WHERE ${conditions}`,
        params,
      );
    }

    const ranked = rankAndFilter(
      rows,
      r => r.title,
      r => r.body_text,
      originalTerms,
      allTerms,
      10,
    );

    return ranked.map(({ item: r, score }) => {
      const helpfulScore = r.helpful_yes + r.helpful_no > 0
        ? Math.round((r.helpful_yes / (r.helpful_yes + r.helpful_no)) * 100)
        : 0;
      return {
        id: r.id,
        title: r.title,
        excerpt: this.extractExcerpt(r.body_text, originalTerms.length > 0 ? originalTerms : allTerms),
        category: r.category,
        labels: r.labels,
        helpfulScore,
      };
    });
  }

  async getArticlesByCategory(category: string): Promise<Array<{
    id: number;
    title: string;
    excerpt: string;
    category: string | null;
    labels: string | null;
    helpfulScore: number;
  }>> {
    await this.refreshDerivedCategories();

    const rows = await query<Array<{
      id: number;
      title: string;
      body_text: string;
      category: string | null;
      labels: string | null;
      helpful_yes: number;
      helpful_no: number;
    }>[0]>(
      `SELECT TOP 200 id, title, LEFT(body_text, 500) AS body_text, category, labels, helpful_yes, helpful_no
       FROM portal_kb_articles
       WHERE category = ?
       ORDER BY title ASC`,
      [category],
    );

    return rows.map((r) => {
      const helpfulScore = r.helpful_yes + r.helpful_no > 0
        ? Math.round((r.helpful_yes / (r.helpful_yes + r.helpful_no)) * 100)
        : 0;
      return {
        id: r.id,
        title: r.title,
        excerpt: this.extractExcerpt(r.body_text, []),
        category: r.category,
        labels: r.labels,
        helpfulScore,
      };
    });
  }

  private extractExcerpt(bodyText: string, terms: string[]): string {
    if (terms.length === 0) {
      return bodyText.slice(0, 200).trim() + (bodyText.length > 200 ? '...' : '');
    }
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

      // Gap 6: Track article view for effectiveness correlation
      if (portalUserId) {
        const existing = kbViewCache.get(portalUserId);
        if (existing) {
          if (!existing.articleIds.includes(id)) existing.articleIds.push(id);
          existing.viewedAt = Date.now();
        } else {
          kbViewCache.set(portalUserId, { articleIds: [id], viewedAt: Date.now() });
        }
      }
    }

    return article;
  }

  async recordKbDeflection(portalUserId: number, orgId: number): Promise<void> {
    const cached = kbViewCache.get(portalUserId);
    if (!cached || cached.articleIds.length === 0) return;
    // Only count if they viewed articles in the last 30 minutes
    if (Date.now() - cached.viewedAt > 30 * 60 * 1000) return;

    await trackEvent('kb_deflection', portalUserId, orgId, {
      article_ids: cached.articleIds,
    });

    for (const articleId of cached.articleIds) {
      await execute(
        `UPDATE portal_kb_articles SET deflection_count = ISNULL(deflection_count, 0) + 1 WHERE id = ?`,
        [articleId],
      ).catch(() => {});
    }
    kbViewCache.delete(portalUserId);
  }

  async recordKbFailedDeflection(portalUserId: number, orgId: number, ticketKey: string): Promise<void> {
    const cached = kbViewCache.get(portalUserId);
    if (!cached || cached.articleIds.length === 0) {
      await trackEvent('no_kb_ticket', portalUserId, orgId, { ticket_key: ticketKey });
      return;
    }
    if (Date.now() - cached.viewedAt > 30 * 60 * 1000) {
      await trackEvent('no_kb_ticket', portalUserId, orgId, { ticket_key: ticketKey });
      return;
    }

    await trackEvent('kb_failed_deflection', portalUserId, orgId, {
      article_ids: cached.articleIds,
      ticket_key: ticketKey,
    });

    for (const articleId of cached.articleIds) {
      await execute(
        `UPDATE portal_kb_articles SET failed_deflection_count = ISNULL(failed_deflection_count, 0) + 1 WHERE id = ?`,
        [articleId],
      ).catch(() => {});
    }
    kbViewCache.delete(portalUserId);
  }

  async getEffectiveness(): Promise<{
    aggregate: { deflection_rate: number; no_kb_rate: number };
    most_effective: Array<{ id: number; title: string; deflection_count: number }>;
    least_effective: Array<{ id: number; title: string; failed_deflection_count: number }>;
    category_gaps: Array<{ category: string; no_kb_count: number }>;
  }> {
    const [deflections, failedDeflections, noKb, mostEffective, leastEffective, categoryGaps] = await Promise.all([
      query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM portal_analytics WHERE event_type = 'kb_deflection' AND created_at >= DATEADD(DAY, -30, GETUTCDATE())`,
      ),
      query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM portal_analytics WHERE event_type = 'kb_failed_deflection' AND created_at >= DATEADD(DAY, -30, GETUTCDATE())`,
      ),
      query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM portal_analytics WHERE event_type = 'no_kb_ticket' AND created_at >= DATEADD(DAY, -30, GETUTCDATE())`,
      ),
      query<{ id: number; title: string; deflection_count: number }>(
        `SELECT TOP 10 id, title, ISNULL(deflection_count, 0) AS deflection_count
         FROM portal_kb_articles WHERE ISNULL(deflection_count, 0) > 0
         ORDER BY deflection_count DESC`,
      ),
      query<{ id: number; title: string; failed_deflection_count: number }>(
        `SELECT TOP 10 id, title, ISNULL(failed_deflection_count, 0) AS failed_deflection_count
         FROM portal_kb_articles WHERE ISNULL(failed_deflection_count, 0) > 0
         ORDER BY failed_deflection_count DESC`,
      ),
      query<{ category: string; no_kb_count: number }>(
        `SELECT JSON_VALUE(metadata, '$.category') AS category, COUNT(*) AS no_kb_count
         FROM portal_analytics
         WHERE event_type = 'no_kb_ticket' AND created_at >= DATEADD(DAY, -30, GETUTCDATE())
           AND JSON_VALUE(metadata, '$.category') IS NOT NULL
         GROUP BY JSON_VALUE(metadata, '$.category')
         ORDER BY no_kb_count DESC`,
      ),
    ]);

    const d = deflections[0]?.cnt ?? 0;
    const fd = failedDeflections[0]?.cnt ?? 0;
    const nk = noKb[0]?.cnt ?? 0;
    const totalTickets = fd + nk;

    return {
      aggregate: {
        deflection_rate: d + fd > 0 ? Math.round((d / (d + fd)) * 10000) / 10000 : 0,
        no_kb_rate: totalTickets > 0 ? Math.round((nk / totalTickets) * 10000) / 10000 : 0,
      },
      most_effective: mostEffective,
      least_effective: leastEffective,
      category_gaps: categoryGaps,
    };
  }

  async submitFeedback(id: number, helpful: boolean): Promise<void> {
    if (helpful) {
      await execute(`UPDATE portal_kb_articles SET helpful_yes = helpful_yes + 1 WHERE id = ?`, [id]);
    } else {
      await execute(`UPDATE portal_kb_articles SET helpful_no = helpful_no + 1 WHERE id = ?`, [id]);
    }
  }

  async getCategories(): Promise<Array<{ category: string; count: number }>> {
    await this.refreshDerivedCategories();
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

  async getRelatedArticles(articleId: number, limit: number = 3): Promise<Array<{ id: number; title: string; excerpt: string; category: string | null }>> {
    const article = await queryOne<{ category: string | null; labels: string | null; body_text: string }>(
      `SELECT category, labels, body_text FROM portal_kb_articles WHERE id = ?`,
      [articleId],
    );
    if (!article) return [];

    const params: unknown[] = [articleId];
    const conditions: string[] = [];

    if (article.category) {
      conditions.push(`category = ?`);
      params.push(article.category);
    }

    if (article.labels) {
      const labelList = article.labels.split(',').map(l => l.trim()).filter(Boolean);
      for (const label of labelList.slice(0, 3)) {
        conditions.push(`labels LIKE ?`);
        params.push(`%${label}%`);
      }
    }

    if (conditions.length === 0) return [];

    const rows = await query<{ id: number; title: string; body_text: string; category: string | null }>(
      `SELECT TOP (${limit}) id, title, body_text, category
       FROM portal_kb_articles
       WHERE id != ? AND (${conditions.join(' OR ')})
       ORDER BY view_count DESC`,
      params,
    );

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      excerpt: (r.body_text || '').slice(0, 150).trim() + (r.body_text && r.body_text.length > 150 ? '...' : ''),
      category: r.category,
    }));
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
