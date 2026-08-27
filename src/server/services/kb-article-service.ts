import { z } from 'zod';
import { query, execute, executeAndGetId } from './database.js';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { McpClientManager } from './mcp-client.js';
import { resolveConfluenceAuth } from './confluence-auth.js';

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

const flexStr = z.any().transform((val): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

const ArticleLlmSchema = z.object({
  title: flexStr,
  body: flexStr,
  labels: z.array(flexStr),
});

// ── Service ──

export class KbArticleService {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
    private mcpManager: McpClientManager,
  ) {}

  /** Generate from a register cluster. Unlike generateFromGap this has a brief to work
   *  from — the agreed title, the case for the article and the required sections — so
   *  the LLM is filling in a commissioned outline rather than guessing at scope from
   *  one ticket. Falls back to generateFromGap's behaviour if no brief exists yet. */
  async generateFromCluster(
    cluster: {
      id: number;
      canonical_title: string;
      category: string | null;
      why_needed: string | null;
      outline_json: string | null;
      audience: string | null;
      member_count: number;
    },
    ticketIds: string[],
    userId: number,
  ): Promise<KbArticleDraft> {
    const outline: Array<{ heading: string; covers: string | null }> =
      cluster.outline_json ? JSON.parse(cluster.outline_json) : [];

    const ticketSnippets = await this.fetchTicketSnippets(ticketIds, 8);

    const systemPrompt = `You are a technical knowledge base writer for Nurtur Ltd's internal support KB.
Write clear, actionable articles that help support agents resolve issues quickly.
Use a professional but approachable tone. Structure with headers, numbered steps where appropriate.
Do NOT include metadata headers like "Title:" — just the article body content.
Follow the commissioned outline: cover every section given, in that order. Where the source
tickets don't establish a step, say what the reader must confirm rather than inventing it.`;

    const userMessage = `Write the KB article commissioned by this brief.

Title: ${cluster.canonical_title}
Category: ${cluster.category || '(none)'}
Audience: ${cluster.audience || 'support agent'}
Raised by: ${cluster.member_count} support ticket${cluster.member_count === 1 ? '' : 's'}
${cluster.why_needed ? `\nWhy it's needed:\n${cluster.why_needed}` : ''}

Required sections:
${outline.length ? outline.map((s, i) => `${i + 1}. ${s.heading}${s.covers ? `\n   Must cover: ${s.covers}` : ''}`).join('\n') : '(none specified — use your judgement)'}

Source tickets:
${ticketSnippets || '(no ticket data available)'}

Generate:
- A clear, concise title
- A full article body in Confluence-compatible HTML (use <h2>, <p>, <ol>, <li>, <code>, <table> tags)
- Relevant labels for categorisation`;

    const result = await this.llm.call(systemPrompt, userMessage, ArticleLlmSchema, {
      callType: 'kb_article_gen', tier: 'standard',
    });

    const draftId = await executeAndGetId(
      `INSERT INTO kb_article_drafts (gap_id, title, body, category, labels, status, created_by)
       VALUES (NULL, ?, ?, ?, ?, 'draft', ?)`,
      [result.data.title, result.data.body, cluster.category, result.data.labels.join(','), userId],
    );

    return {
      id: draftId,
      gap_id: null,
      title: result.data.title,
      body: result.data.body,
      category: cluster.category,
      labels: result.data.labels.join(','),
      status: 'draft',
      confluence_page_id: null,
      confluence_url: null,
      created_by: userId,
      created_at: new Date().toISOString(),
      published_at: null,
    };
  }

  private async fetchTicketSnippets(ticketIds: string[], max: number): Promise<string> {
    const keys = [...new Set(ticketIds.filter(k => /^(NT|NTPJ)-\d+$/i.test(k)))].slice(0, max);
    if (keys.length === 0) return '';
    const rows = await query<{ issue_key: string; summary: string; description: string | null; answer: string | null }>(
      `SELECT issue_key, summary, LEFT(description_text, 500) AS description, LEFT(last_public_comment, 700) AS answer
       FROM jira_issue_cache WHERE issue_key IN (${keys.map(() => '?').join(',')})`,
      keys,
    );
    return rows.map(r =>
      `[${r.issue_key}] ${r.summary}\n${r.description || '(no description)'}\nAnswer given: ${r.answer || '(not recorded)'}`,
    ).join('\n\n');
  }

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
      const rows = await query<{ issue_key: string; summary: string; description: string }>(
        `SELECT TOP 5 issue_key, summary, LEFT(description_text, 500) as description
         FROM jira_issue_cache
         WHERE issue_key IN (${ticketContext.map(() => '?').join(',')})`,
        ticketContext,
      );
      ticketSnippets = rows.map(r =>
        `[${r.issue_key}] ${r.summary}\n${r.description || '(no description)'}`
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

    // Match the exact gap group the caller generated from. Matching on category
    // alone attached the draft to an unrelated gap and flipped that one's status
    // instead — with ~900 distinct titles under "website" that was near-random.
    const gapRows = await query<{ id: number }>(
      `SELECT id FROM kb_gap_log
       WHERE category = ? AND ISNULL(suggested_title, '') = ISNULL(?, '') AND status = 'open'
       ORDER BY created_at DESC`,
      [category, suggestedTitle],
    );
    const gapId = gapRows[0]?.id ?? null;

    const draftId = await executeAndGetId(
      `INSERT INTO kb_article_drafts (gap_id, title, body, category, labels, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
      [gapId, result.data.title, result.data.body, category, result.data.labels.join(','), userId],
    );

    // The whole group is the unit of work, so move every row in it — otherwise the
    // group keeps reappearing as "open" with a one-lower count.
    if (gapRows.length > 0) {
      await execute(
        `UPDATE kb_gap_log SET status = 'article_drafted'
         WHERE id IN (${gapRows.map(() => '?').join(',')})`,
        gapRows.map(r => r.id),
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

    // Publishes over Confluence REST with the global Jira credentials — the same
    // token and code path the KB sync already uses. It previously went through the
    // 'jira' MCP server, which meant publishing failed whenever that connection was
    // down and left the outcome dependent on whatever shape the tool returned.
    const auth = resolveConfluenceAuth(this.settings);
    const headers = { ...auth.headers, 'Content-Type': 'application/json' };

    const spaceRes = await fetch(`${auth.baseUrl}/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`, { headers });
    if (!spaceRes.ok) {
      throw new Error(`Could not resolve Confluence space "${spaceKey}": ${spaceRes.status} ${(await spaceRes.text()).slice(0, 200)}`);
    }
    const spaceData = await spaceRes.json() as { results?: Array<{ id: string }> };
    const spaceId = spaceData.results?.[0]?.id;
    if (!spaceId) {
      throw new Error(`Confluence space "${spaceKey}" not found — check the key and that the Jira service account has Confluence access`);
    }

    const payload: Record<string, unknown> = {
      spaceId,
      status: 'current',
      title: draft.title,
      body: { representation: 'storage', value: draft.body },
    };
    if (parentPageId) payload.parentId = parentPageId;

    const createRes = await fetch(`${auth.baseUrl}/wiki/api/v2/pages`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    const createText = await createRes.text();
    if (!createRes.ok) {
      throw new Error(`Confluence publish failed: ${createRes.status} ${createText.slice(0, 300)}`);
    }

    const created = JSON.parse(createText) as { id?: string; _links?: { webui?: string; base?: string } };
    const pageId = created.id || '';
    const webui = created._links?.webui || '';
    const url = webui
      ? `${created._links?.base || `${auth.baseUrl}/wiki`}${webui}`
      : `${auth.baseUrl}/wiki/spaces/${spaceKey}/pages/${pageId}`;

    await execute(
      `UPDATE kb_article_drafts
       SET status = 'published', confluence_page_id = ?, confluence_url = ?, published_at = GETUTCDATE(), body = NULL
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
