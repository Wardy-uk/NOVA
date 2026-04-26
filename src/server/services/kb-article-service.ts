import { z } from 'zod';
import { query, execute, executeAndGetId } from './database.js';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { McpClientManager } from './mcp-client.js';

// ── Types ──

export interface KbArticleDraft {
  id: number;
  gap_id: number | null;
  title: string;
  body: string;
  category: string | null;
  labels: string | null;
  status: string;
  confluence_page_id: string | null;
  confluence_url: string | null;
  created_by: number | null;
  created_at: string;
  published_at: string | null;
}

const ArticleLlmSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
});

// ── Service ──

export class KbArticleService {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
    private mcpManager: McpClientManager,
  ) {}

  async generateFromGap(
    category: string,
    suggestedTitle: string | null,
    reason: string | null,
    ticketIds: string[],
    userId: number,
  ): Promise<KbArticleDraft> {
    const ticketContext = ticketIds.slice(0, 5);
    let ticketSnippets = '';
    if (ticketContext.length > 0) {
      const rows = await query<{ ticket_id: string; summary: string; description: string }>(
        `SELECT TOP 5 ticket_id, summary, LEFT(description, 500) as description
         FROM jira_ticket_cache
         WHERE ticket_id IN (${ticketContext.map(() => '?').join(',')})`,
        ticketContext,
      );
      ticketSnippets = rows.map(r =>
        `[${r.ticket_id}] ${r.summary}\n${r.description || '(no description)'}`
      ).join('\n\n');
    }

    const systemPrompt = `You are a technical knowledge base writer for Nurtur Ltd's internal support KB.
Write clear, actionable articles that help support agents resolve issues quickly.
Use a professional but approachable tone. Structure with headers, numbered steps where appropriate.
Do NOT include metadata headers like "Title:" — just the article body content.`;

    const userMessage = `Write a KB article for this identified knowledge gap:

Category: ${category}
${suggestedTitle ? `Suggested title: ${suggestedTitle}` : ''}
${reason ? `Reason this gap was identified: ${reason}` : ''}

Related ticket examples:
${ticketSnippets || '(no ticket data available)'}

Generate:
- A clear, concise title
- A full article body in Confluence-compatible HTML (use <h2>, <p>, <ol>, <li>, <code>, <table> tags)
- Relevant labels for categorisation`;

    const result = await this.llm.call(
      systemPrompt,
      userMessage,
      ArticleLlmSchema,
      { callType: 'kb_article_gen', tier: 'standard' },
    );

    const gapRows = await query<{ id: number }>(
      `SELECT TOP 1 id FROM kb_gap_log
       WHERE category = ? AND status = 'open'
       ORDER BY created_at DESC`,
      [category],
    );
    const gapId = gapRows[0]?.id ?? null;

    const draftId = await executeAndGetId(
      `INSERT INTO kb_article_drafts (gap_id, title, body, category, labels, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
      [gapId, result.data.title, result.data.body, category, result.data.labels.join(','), userId],
    );

    if (gapId) {
      await execute(
        `UPDATE kb_gap_log SET status = 'article_drafted' WHERE id = ?`,
        [gapId],
      );
    }

    return {
      id: draftId,
      gap_id: gapId,
      title: result.data.title,
      body: result.data.body,
      category,
      labels: result.data.labels.join(','),
      status: 'draft',
      confluence_page_id: null,
      confluence_url: null,
      created_by: userId,
      created_at: new Date().toISOString(),
      published_at: null,
    };
  }

  async listDrafts(status?: string, limit = 50): Promise<KbArticleDraft[]> {
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status, limit] : [limit];
    return query<KbArticleDraft>(
      `SELECT * FROM kb_article_drafts ${where}
       ORDER BY created_at DESC
       OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`,
      params,
    );
  }

  async getById(id: number): Promise<KbArticleDraft | null> {
    const rows = await query<KbArticleDraft>(
      `SELECT * FROM kb_article_drafts WHERE id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  async updateDraft(id: number, title: string, body: string, labels?: string): Promise<void> {
    await execute(
      `UPDATE kb_article_drafts SET title = ?, body = ?, labels = COALESCE(?, labels) WHERE id = ?`,
      [title, body, labels ?? null, id],
    );
  }

  async deleteDraft(id: number): Promise<void> {
    await execute(`DELETE FROM kb_article_drafts WHERE id = ?`, [id]);
  }

  async publishToConfluence(id: number): Promise<{ pageId: string; url: string }> {
    const draft = await this.getById(id);
    if (!draft) throw new Error('Draft not found');
    if (draft.status === 'published') throw new Error('Already published');

    const spaceKey = this.settings.get('kb_confluence_space') || this.settings.get('agent_kb_confluence_space') || 'NT';
    const parentPageId = this.settings.get('kb_confluence_parent_page_id') || this.settings.get('agent_kb_parent_page_id') || '2798027072';

    if (!this.mcpManager.isConnected('jira')) {
      throw new Error('Jira/Confluence MCP server not connected');
    }

    const args: Record<string, string> = {
      spaceKey,
      title: draft.title,
      content: draft.body,
    };
    if (parentPageId) args.parentPageId = parentPageId;

    const result = await this.mcpManager.callTool('jira', 'create_page', args);
    const text = typeof result === 'string' ? result : JSON.stringify(result);

    let pageId = '';
    let url = '';
    try {
      const parsed = JSON.parse(text);
      pageId = parsed.id || parsed.pageId || '';
      url = parsed._links?.webui
        ? `${parsed._links?.base || ''}${parsed._links.webui}`
        : parsed.url || '';
    } catch {
      const idMatch = text.match(/id['":\s]+(\d+)/);
      if (idMatch) pageId = idMatch[1];
    }

    await execute(
      `UPDATE kb_article_drafts
       SET status = 'published', confluence_page_id = ?, confluence_url = ?, published_at = GETUTCDATE()
       WHERE id = ?`,
      [pageId, url, id],
    );

    if (draft.gap_id) {
      await execute(
        `UPDATE kb_gap_log SET status = 'article_published', resolved_at = GETUTCDATE(), confluence_url = ? WHERE id = ?`,
        [url, draft.gap_id],
      );
    }

    return { pageId, url };
  }
}
