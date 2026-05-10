import { z } from 'zod';
import { query, queryOne, execute } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { PortalJiraService } from './portal-jira.js';
import type { PortalChatSession, PortalChatMessage } from '../../shared/portal-types.js';
import { trackEvent } from './portal-analytics.js';
import type { PortalPlaybookService } from './portal-playbooks.js';

const ChatResponseSchema = z.object({ response: z.string() });

const HandoffSummarySchema = z.object({
  issue_summary: z.string(),
  category: z.string().default('General'),
  customer_intent: z.string().default(''),
  information_gathered: z.object({
    account_or_site: z.string().optional(),
    url_or_page: z.string().optional(),
    error_message: z.string().optional(),
    expected_vs_actual: z.string().optional(),
    steps_tried: z.array(z.string()).optional(),
  }).default({}),
  kb_articles_tried: z.array(z.string()).default([]),
  resolution_attempted: z.boolean().default(false),
  suggested_next_action: z.string().default('Review the chat transcript'),
});

type HandoffSummary = z.infer<typeof HandoffSummarySchema>;

interface ChatContext {
  orgName: string;
  userName: string;
  userEmail: string;
  orgId: number;
  portalUserId: number;
}

export class PortalChatService {
  private playbookService: PortalPlaybookService | null = null;

  constructor(
    private settings: FileSettingsQueries,
    private llm: LlmService | null,
    private portalJira: PortalJiraService,
  ) {}

  setPlaybookService(service: PortalPlaybookService): void {
    this.playbookService = service;
  }

  async startSession(portalUserId: number): Promise<PortalChatSession> {
    const result = await queryOne<{ id: number }>(
      `INSERT INTO portal_chat_sessions (portal_user_id, status)
       OUTPUT INSERTED.id VALUES (?, 'active')`,
      [portalUserId],
    );

    const session = await queryOne<PortalChatSession>(
      `SELECT * FROM portal_chat_sessions WHERE id = ?`,
      [result!.id],
    );

    return session!;
  }

  async sendMessage(
    sessionId: number,
    content: string,
    context: ChatContext,
  ): Promise<PortalChatMessage> {
    // Store user message
    await execute(
      `INSERT INTO portal_chat_messages (session_id, role, content)
       VALUES (?, 'user', ?)`,
      [sessionId, content],
    );

    // Get conversation history
    const history = await query<{ role: string; content: string }>(
      `SELECT role, content FROM portal_chat_messages
       WHERE session_id = ? ORDER BY created_at`,
      [sessionId],
    );

    // Check exchange count for handoff threshold
    const userMessages = history.filter(m => m.role === 'user').length;
    const handoffThreshold = parseInt(this.settings.get('portal_chat_handoff_threshold') || '3', 10);
    const maxExchanges = parseInt(this.settings.get('portal_chat_max_exchanges') || '10', 10);

    let responseContent: string;

    if (userMessages >= maxExchanges) {
      responseContent = await this.handleHandoff(sessionId, context, history);
    } else {
      // Gap 5: Check playbooks before generic LLM response
      if (this.playbookService) {
        const pbResult = await this.playbookService.tryMatch(content, sessionId, context);
        if (pbResult) {
          if (pbResult.resolved) {
            await execute(
              `UPDATE portal_chat_sessions SET status = 'resolved' WHERE id = ?`,
              [sessionId],
            );
            await trackEvent('deflection', context.portalUserId, context.orgId, {
              playbook_id: pbResult.playbookId,
              session_id: sessionId,
            });
          }
          responseContent = pbResult.response;
        } else {
          responseContent = await this.generateResponse(history, context, userMessages >= handoffThreshold);
        }
      } else {
        responseContent = await this.generateResponse(history, context, userMessages >= handoffThreshold);
      }
    }

    // Store assistant message
    await execute(
      `INSERT INTO portal_chat_messages (session_id, role, content)
       VALUES (?, 'assistant', ?)`,
      [sessionId, responseContent],
    );

    const message = await queryOne<PortalChatMessage>(
      `SELECT TOP 1 * FROM portal_chat_messages
       WHERE session_id = ? AND role = 'assistant'
       ORDER BY created_at DESC`,
      [sessionId],
    );

    return message!;
  }

  private async generateResponse(
    history: Array<{ role: string; content: string }>,
    context: ChatContext,
    offerHandoff: boolean,
  ): Promise<string> {
    if (!this.llm) {
      return 'I apologize, but the chat service is currently unavailable. Please use the "New Request" form to submit your issue, or try again later.';
    }

    // Search KB for relevant articles
    const lastUserMessage = [...history].reverse().find(m => m.role === 'user')?.content || '';
    const kbArticles = await this.searchKb(lastUserMessage);

    const systemPrompt = this.buildSystemPrompt(context, kbArticles, offerHandoff);

    const messages = history.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    try {
      const userContent = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');
      const result = await this.llm.call(
        systemPrompt,
        userContent,
        ChatResponseSchema,
        { callType: 'portal_chat', tier: 'standard', maxTokens: 1000, temperature: 0.3 },
      );

      return result.data.response;
    } catch (err) {
      console.error('[portal-chat] LLM error:', err);
      return "I'm having trouble processing your request right now. Would you like me to create a support ticket so our team can help you directly?";
    }
  }

  private buildSystemPrompt(
    context: ChatContext,
    kbArticles: Array<{ title: string; excerpt: string }>,
    offerHandoff: boolean,
  ): string {
    let prompt = `You are the Nurtur support assistant, helping customers with their queries about Nurtur's products and services.

Current user: ${context.userName} from ${context.orgName} (${context.userEmail})

Your goals:
1. Answer questions using the knowledge base articles when available
2. If the user is reporting an issue, gather key details: what they expected vs what happened, any error messages, the URL/page affected, and which account/site is affected
3. Be friendly, professional, and concise
4. If you can resolve the query from the knowledge base, do so
5. If you need to create a ticket, confirm the details with the user first

Important rules:
- Never share internal notes or internal system details
- Never make up information — if you don't know, say so
- Keep responses under 200 words unless explaining a complex solution
- Use markdown formatting for readability`;

    if (kbArticles.length > 0) {
      prompt += '\n\nRelevant knowledge base articles:\n';
      for (const article of kbArticles) {
        prompt += `\n**${article.title}**\n${article.excerpt}\n`;
      }
    }

    if (offerHandoff) {
      prompt += '\n\nThe conversation has been going on for a while. If the user\'s issue isn\'t resolved, proactively offer to create a support ticket for them.';
    }

    return prompt;
  }

  private async searchKb(searchQuery: string): Promise<Array<{ title: string; excerpt: string }>> {
    if (!searchQuery || searchQuery.length < 3) return [];

    const terms = searchQuery.split(/\s+/).filter(t => t.length > 2).slice(0, 5);
    if (terms.length === 0) return [];

    const likeConditions = terms.map(() => `(body_text LIKE ? OR title LIKE ?)`).join(' OR ');
    const params: unknown[] = [];
    terms.forEach((t) => { params.push(`%${t}%`, `%${t}%`); });

    const articles = await query<{ title: string; body_text: string }>(
      `SELECT TOP 3 title, LEFT(body_text, 500) AS body_text
       FROM portal_kb_articles
       WHERE ${likeConditions}
       ORDER BY view_count DESC`,
      params,
    );

    return articles.map(a => ({
      title: a.title,
      excerpt: a.body_text.slice(0, 300),
    }));
  }

  async handleHandoff(
    sessionId: number,
    context: ChatContext,
    history: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const transcript = history.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
    const projectKey = this.settings.get('portal_jira_project_nt') || 'NT';

    // Gap 4: Generate structured handoff summary via LLM
    let summary: HandoffSummary | null = null;
    if (this.llm) {
      try {
        const summaryResult = await this.llm.call(
          `You are summarising a support chat conversation for handoff to a human agent.
Analyse the transcript and produce a structured JSON summary.
The human agent should be able to understand the issue without reading the full transcript.`,
          `Transcript:\n\n${transcript}`,
          HandoffSummarySchema,
          { callType: 'portal_handoff_summary', tier: 'standard', maxTokens: 800, temperature: 0.1 },
        );
        summary = summaryResult.data;
      } catch (err) {
        console.warn('[portal-chat] Handoff summary generation failed:', err instanceof Error ? err.message : err);
      }
    }

    const ticketSummary = summary?.issue_summary
      ? `[Portal] ${summary.issue_summary}`
      : `[Portal] Chat support request from ${context.userName} (${context.orgName})`;

    // Build structured internal note
    let internalNote = '';
    if (summary) {
      internalNote += `*Handoff Summary*\n\n`;
      internalNote += `*Issue:* ${summary.issue_summary}\n`;
      internalNote += `*Category:* ${summary.category}\n`;
      internalNote += `*Customer Intent:* ${summary.customer_intent}\n\n`;
      if (Object.keys(summary.information_gathered).length > 0) {
        internalNote += `*Information Gathered:*\n`;
        const ig = summary.information_gathered;
        if (ig.account_or_site) internalNote += `- Account/Site: ${ig.account_or_site}\n`;
        if (ig.url_or_page) internalNote += `- URL/Page: ${ig.url_or_page}\n`;
        if (ig.error_message) internalNote += `- Error: ${ig.error_message}\n`;
        if (ig.expected_vs_actual) internalNote += `- Expected vs Actual: ${ig.expected_vs_actual}\n`;
        if (ig.steps_tried?.length) internalNote += `- Steps Tried: ${ig.steps_tried.join(', ')}\n`;
        internalNote += '\n';
      }
      if (summary.kb_articles_tried.length > 0) {
        internalNote += `*KB Articles Tried (didn't resolve):* ${summary.kb_articles_tried.join(', ')}\n\n`;
      }
      internalNote += `*Suggested Next Action:* ${summary.suggested_next_action}\n`;
      internalNote += `\n----\n\n`;
    }
    internalNote += `*Full Chat Transcript (session ${sessionId})*\n\n${transcript}`;

    try {
      const ticketKey = await this.portalJira.createTicket({
        projectKey,
        summary: ticketSummary.slice(0, 250),
        description: summary
          ? `Portal chat handoff — ${summary.issue_summary}\n\nSee internal notes for structured summary and full transcript.`
          : `Support chat conversation - user requested human assistance.\n\nPlease review the chat transcript in the internal notes.`,
        priority: 'Medium',
        reporterEmail: context.userEmail,
        internalNote,
      });

      await execute(
        `UPDATE portal_chat_sessions SET jira_issue_key = ?, status = 'handed_off' WHERE id = ?`,
        [ticketKey, sessionId],
      );

      // Store summary in session metadata
      if (summary) {
        await execute(
          `UPDATE portal_chat_sessions SET metadata = ? WHERE id = ?`,
          [JSON.stringify({ handoff_summary: summary }), sessionId],
        ).catch(() => {});
      }

      await trackEvent(summary ? 'handoff_with_summary' : 'handoff_raw_transcript', context.portalUserId, context.orgId, {
        session_id: sessionId,
        ticket_key: ticketKey,
      });

      return `I've created support ticket **${ticketKey}** and a team member will follow up with you. You can track the progress of this ticket in your portal under "My Tickets".\n\nIs there anything else I can help with?`;
    } catch (err) {
      console.error('[portal-chat] Handoff failed:', err);
      return "I wasn't able to create a ticket automatically. Please use the **New Request** form to submit your issue, and our team will get back to you as soon as possible.";
    }
  }

  async endSession(sessionId: number): Promise<void> {
    await execute(
      `UPDATE portal_chat_sessions SET status = 'resolved', ended_at = GETUTCDATE() WHERE id = ? AND status = 'active'`,
      [sessionId],
    );
  }

  async getSession(sessionId: number, portalUserId: number): Promise<{ session: PortalChatSession; messages: PortalChatMessage[] } | null> {
    const session = await queryOne<PortalChatSession>(
      `SELECT * FROM portal_chat_sessions WHERE id = ? AND portal_user_id = ?`,
      [sessionId, portalUserId],
    );
    if (!session) return null;

    const messages = await query<PortalChatMessage>(
      `SELECT * FROM portal_chat_messages WHERE session_id = ? ORDER BY created_at`,
      [sessionId],
    );

    return { session, messages };
  }

  async listSessions(portalUserId: number): Promise<PortalChatSession[]> {
    return query<PortalChatSession>(
      `SELECT * FROM portal_chat_sessions WHERE portal_user_id = ? ORDER BY started_at DESC`,
      [portalUserId],
    );
  }
}
