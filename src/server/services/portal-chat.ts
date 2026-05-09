import { z } from 'zod';
import { query, queryOne, execute } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { PortalJiraService } from './portal-jira.js';
import type { PortalChatSession, PortalChatMessage } from '../../shared/portal-types.js';
import { trackEvent } from './portal-analytics.js';

const ChatResponseSchema = z.object({ response: z.string() });

interface ChatContext {
  orgName: string;
  userName: string;
  userEmail: string;
  orgId: number;
  portalUserId: number;
}

export class PortalChatService {
  constructor(
    private settings: FileSettingsQueries,
    private llm: LlmService | null,
    private portalJira: PortalJiraService,
  ) {}

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
      responseContent = await this.generateResponse(history, context, userMessages >= handoffThreshold);
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
    // Gather conversation into a transcript
    const transcript = history.map(m => `[${m.role}]: ${m.content}`).join('\n\n');

    const projectKey = this.settings.get('portal_jira_project_nt') || 'NT';

    try {
      const ticketKey = await this.portalJira.createTicket({
        projectKey,
        summary: `Chat support request from ${context.userName} (${context.orgName})`,
        description: `Support chat conversation - user requested human assistance.\n\nPlease review the chat transcript in the internal notes.`,
        priority: 'Medium',
        reporterEmail: context.userEmail,
        internalNote: `*Portal chat transcript (session ${sessionId})*\n\n${transcript}`,
      });

      // Link session to ticket
      await execute(
        `UPDATE portal_chat_sessions SET jira_issue_key = ?, status = 'handed_off' WHERE id = ?`,
        [ticketKey, sessionId],
      );

      await trackEvent('chat_handoff', context.portalUserId, context.orgId, {
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
