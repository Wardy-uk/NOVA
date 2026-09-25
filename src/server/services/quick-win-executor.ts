import type { JiraRestClient } from './jira-client.js';
import type { AgentDecision, ActionResult } from './agent-types.js';
import type { Observer } from './observer.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { executeAndGetId, query } from './database.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';
import { prepareTicketForClose } from './close-ticket-helper.js';

const QW_COMMENT_PREFIX = '[AI Agent — Auto-Close]';

// Customer-facing close messages — posted as public JSM comments, so no internal agent prefix.
const CLOSE_COMMENTS: Record<string, string> = {
  thank_you: `Thanks for letting us know — glad we could help! We're closing this ticket now. If you need anything else, just raise a new request and we'll pick it up.`,
  stale_no_response: `We've followed up a few times but haven't heard back, so we're closing this ticket for now. If you still need help, just raise a new request or reply here and we'll reopen it.`,
  auto_resolved: `It looks like this issue has now been resolved, so we're closing this ticket. If the problem returns, please raise a new request and we'll be happy to help.`,
  duplicate: `This request looks like a duplicate of another ticket (referenced below), so we're closing it to keep everything in one place. If you think this is a separate issue, please raise a new request.`,
};

// Internal-only close notes — team-visible, so they keep the agent marker.
const INTERNAL_CLOSE_COMMENTS: Record<string, string> = {
  spam: `${QW_COMMENT_PREFIX} This ticket was identified as spam or an automated submission and has been cancelled.`,
  vendor_email: `${QW_COMMENT_PREFIX} This ticket was identified as an unsolicited vendor/marketing email rather than a support request and has been cancelled.`,
  survey_feedback: `${QW_COMMENT_PREFIX} This ticket was identified as an automated survey/feedback-request email rather than a support request and has been cancelled.`,
};

// Quick-win types that close silently: internal note only (no customer email) + `cancel` transition.
const SILENT_CANCEL_TYPES = new Set(['spam', 'vendor_email', 'survey_feedback']);

// Statuses where work is in flight: a quick win suggests closing but never closes.
const HOLD_STATUSES = new Set(['work in progress', 'waiting on partner']);

interface QuickWin {
  type: string;
  confidence: number;
  reasoning?: string;
  suggested_kba?: string | null;
}

export class QuickWinExecutor {
  constructor(
    private jiraClient: JiraRestClient,
    private settings: SettingsQueries,
    private observer: Observer,
  ) {}

  async shouldAutoClose(decision: AgentDecision, _decisionId: number): Promise<boolean> {
    const qw = decision.output.quick_win as QuickWin | undefined;
    if (!qw?.type || qw.type === 'none') return false;
    if (qw.type === 'duplicate') return false;

    const enabled = this.settings.get(`agent_quick_win_auto_close_${qw.type}`);
    if (enabled !== 'true') return false;

    const minConf = parseFloat(this.settings.get('agent_quick_win_min_confidence') || '0.90');
    if (qw.confidence < minConf) return false;

    // Hard guardrails
    const priority = (decision.inputs.priority as string || '').toLowerCase();
    if (priority === 'critical' || priority === 'highest' || priority === '1') return false;

    const keyAccountOrgs = (this.settings.get('agent_key_account_orgs') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const org = ((decision.inputs.organisation as string) || '').toLowerCase();
    if (org && keyAccountOrgs.some(ka => org.includes(ka))) return false;

    return true;
  }

  async executeAutoClose(decision: AgentDecision, decisionId: number): Promise<ActionResult> {
    const qw = decision.output.quick_win as QuickWin;
    const ticketKey = decision.ticketKey;
    const preCloseStatus = (decision.inputs.status as string) || 'unknown';

    try {
      // A human owns it, or it is mid-flight: suggest, don't close. NT-31721 was closed two
      // minutes after the customer's reply with no fix confirmed, and NT-32366 lost the
      // agent's classification the same way. The agent decides.
      const hold = await this.humanHoldReason(ticketKey);
      if (hold) {
        await this.jiraClient.addComment(
          ticketKey,
          `\u{1F916} NOVA: this looks ready to close (quick win: ${qw.type}, confidence ${qw.confidence.toFixed(2)}), `
            + `but it was not closed automatically because ${hold}. Close it if the issue is resolved.`,
          { internal: true },
        ).catch(() => { /* best effort */ });
        console.log(`[quick-win] ${ticketKey}: not auto-closing ${qw.type}, ${hold}. Posted a suggestion instead`);
        return {
          success: false, action: 'quick_win_close', ticketKey,
          detail: `Held for the agent (${hold}); internal note suggests closing.`,
          error: 'HELD_FOR_HUMAN',
        };
      }

      // Store pre-close status
      await executeAndGetId(
        `UPDATE agent_decisions SET pre_close_status = ? WHERE id = ?`,
        [preCloseStatus, decisionId],
      );

      // Assign to NOVA + update request type before closing
      await prepareTicketForClose(this.jiraClient, this.settings, {
        ticketKey,
        classification: (decision.output.classification as { category?: string; ticket_type?: string }) ?? undefined,
        requestTypeOverride: SILENT_CANCEL_TYPES.has(qw.type) ? 'Emailed request' : undefined,
      });

      // Build the close comment. It must ride WITH the transition — the NT
      // "Quick Resolve" validator checks for a public comment added ON the
      // transition, not one posted separately. spam/vendor/silent-cancel stay
      // internal (the 'cancel' transition has no public-comment validator);
      // everything else is a public customer comment.
      let commentText: string;
      let commentAdf: object | undefined;
      let commentInternal: boolean;
      if (qw.type === 'kba_match') {
        // Find the best KB match URL from the inputs (stored by reasoner alongside the decision).
        // ONLY publishable sources are eligible: this comment goes to the customer, and
        // tfs-docs is the internal nurtur-docs repo. Linking one here would hand a
        // customer an internal engineering URL.
        const kbMatches = (decision.inputs.kb_matches as Array<{ title: string; url: string; relevance: number; publishable?: boolean; source?: string }> | undefined) ?? [];
        const publishable = kbMatches.filter(m => m.publishable === true);
        const dropped = kbMatches.length - publishable.length;
        if (dropped > 0) {
          console.log(`[quick-win] ${ticketKey}: ignoring ${dropped} internal-only KB match(es) for a public close`);
        }

        // No customer-safe article to point at — closing publicly would either link
        // something internal or promise an article we can't name. Leave it for a human.
        if (publishable.length === 0) {
          console.warn(`[quick-win] ${ticketKey}: kba_match had no publishable article — not auto-closing`);
          return {
            success: false, action: 'quick_win_close', ticketKey,
            detail: 'kba_match matched only internal-only documentation (e.g. tfs-docs), which must never be sent to a customer. Left open for a human.',
            error: 'NO_PUBLISHABLE_KB_MATCH',
          };
        }

        const bestMatch = publishable.reduce((a, b) => (b.relevance > a.relevance ? b : a));

        // Written as ADF, not markdown. The plain-text path wraps everything in one text node,
        // so "[Title](https://...)" reached the customer as literal brackets on NT-31799.
        // It also could not break a paragraph, which is why the old message was a single block
        // that opened by talking about itself and closed by announcing the ticket was shut.
        const reporterName = (decision.inputs.reporter as string) || '';
        const firstName = reporterName.split(/\s+/)[0];
        const greeting = firstName && !firstName.includes('@') && firstName.length > 1
          ? `Hi ${firstName},`
          : 'Hi there,';
        const askedAbout = (decision.inputs.summary as string) || '';

        const linkNode = bestMatch.url
          ? { type: 'text', text: bestMatch.title, marks: [{ type: 'link', attrs: { href: bestMatch.url } }] }
          : { type: 'text', text: bestMatch.title };

        commentAdf = {
          type: 'doc',
          version: 1,
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: greeting }] },
            {
              type: 'paragraph',
              content: [{
                type: 'text',
                text: askedAbout
                  ? `Thanks for getting in touch about "${askedAbout}". We have a guide that covers this: `
                  : 'Thanks for getting in touch. We have a guide that covers this: ',
              }, linkNode, { type: 'text', text: '.' }],
            },
            {
              type: 'paragraph',
              content: [{
                type: 'text',
                text: "That should have everything you need, so we'll close this off here. "
                  + 'If it does not solve it, or you have any trouble following it, just reply to this '
                  + 'ticket and it will come straight back to us.',
              }],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Kind regards,' },
                { type: 'hardBreak' },
                { type: 'text', text: 'Nurtur Support' },
              ],
            },
          ],
        };
        commentText = `${greeting} Thanks for getting in touch. We have a guide that covers this: ${bestMatch.title}`
          + `${bestMatch.url ? ` (${bestMatch.url})` : ''}. If it does not solve it, reply to this ticket and it will come back to us.`;
        commentInternal = false;
      } else if (SILENT_CANCEL_TYPES.has(qw.type)) {
        commentText = INTERNAL_CLOSE_COMMENTS[qw.type];
        commentInternal = true;
      } else {
        commentText = CLOSE_COMMENTS[qw.type] || `This ticket has been closed. If you still need help, please raise a new request.`;
        commentInternal = false;
      }

      // Find and execute transition — try primary name, then fallbacks
      const targetTransition = SILENT_CANCEL_TYPES.has(qw.type) ? 'cancel' : 'resolve';
      const transitionId = await this.findTransitionId(ticketKey, targetTransition)
        || (targetTransition !== 'resolve' ? await this.findTransitionId(ticketKey, 'resolve') : null);

      if (!transitionId) {
        console.warn(`[quick-win] No ${targetTransition} transition found for ${ticketKey}`);
        return {
          success: false, action: 'quick_win_close', ticketKey,
          detail: `No suitable transition found for ${targetTransition}`,
          error: 'TRANSITION_NOT_FOUND',
        };
      }

      // Set resolution type using configurable mapping
      const resMapRaw = this.settings.get('agent_resolution_type_map');
      let resMap: Record<string, string> = {
        spam: 'Request Cancelled / Withdrawn', vendor_email: 'Request Cancelled / Withdrawn', survey_feedback: 'Request Cancelled / Withdrawn',
        thank_you: 'No Fault Found', kba_match: 'KBA Supplied',
        stale_no_response: 'Request Cancelled / Withdrawn', duplicate: 'Duplicate', auto_resolved: 'No Fault Found',
      };
      try { if (resMapRaw) resMap = { ...resMap, ...JSON.parse(resMapRaw) }; } catch {}

      const resolution = resMap[qw.type] || 'No Fault Found';
      const { fields, comment } = buildResolveFields({
        tldr: `quick-win auto-close (${qw.type})`,
        resolution,
        comment: commentText,
        commentAdf,
        closeKind: qw.type,
      });
      // Attach the comment IN the transition and set the full resolve fields.
      // No bare-payload fallback: if Jira rejects the transition, let it throw so
      // the ticket stays OPEN for a human, rather than firing a stripped payload
      // that fails every validator and strands the ticket half-closed.
      await this.jiraClient.transitionIssue(ticketKey, transitionId, {
        fields,
        comment: { ...comment, internal: commentInternal },
      });

      // Mark as executed
      await executeAndGetId(
        `UPDATE agent_decisions SET quick_win_executed = 1, quick_win_executed_at = GETUTCDATE() WHERE id = ?`,
        [decisionId],
      );

      console.log(`[quick-win] Auto-closed ${ticketKey} as ${qw.type} (confidence: ${qw.confidence.toFixed(2)})`);

      return {
        success: true, action: 'quick_win_close', ticketKey,
        detail: `Auto-closed as ${qw.type} (${targetTransition} transition, confidence: ${qw.confidence.toFixed(2)})`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[quick-win] Failed to auto-close ${ticketKey}:`, msg);
      return {
        success: false, action: 'quick_win_close', ticketKey,
        detail: `Auto-close failed: ${msg}`, error: msg,
      };
    }
  }

  /** Why a quick win must not close this ticket, or null when it may. Reads live Jira state,
   *  and holds when it can't: an unread ticket is not a ticket known to be unowned. */
  private async humanHoldReason(ticketKey: string): Promise<string | null> {
    const novaAccountId = this.settings.get('nova_ai_jira_account_id');
    try {
      const issue = await this.jiraClient.getIssue(ticketKey, ['assignee', 'status']);
      const assignee = issue?.fields?.assignee as { accountId?: string; displayName?: string } | null | undefined;
      if (assignee?.accountId && assignee.accountId !== novaAccountId) {
        return `it is assigned to ${assignee.displayName ?? 'an agent'}`;
      }
      const status = ((issue?.fields?.status as { name?: string } | undefined)?.name ?? '').toLowerCase();
      if (HOLD_STATUSES.has(status)) return `it is in ${status}`;
      return null;
    } catch (err) {
      console.warn(`[quick-win] Could not read assignee/status on ${ticketKey}:`, err instanceof Error ? err.message : err);
      return 'its assignee and status could not be read';
    }
  }

  async undoClose(decisionId: number, undoneBy: string): Promise<ActionResult> {
    const rows = await query<{
      id: number; ticket_id: string; quick_win_executed: boolean;
      quick_win_undone: boolean; pre_close_status: string | null;
    }>(
      `SELECT id, ticket_id, quick_win_executed, quick_win_undone, pre_close_status
       FROM agent_decisions WHERE id = ?`,
      [decisionId],
    );

    const row = rows[0];
    if (!row) return { success: false, action: 'undo_close', ticketKey: '', detail: 'Decision not found', error: 'NOT_FOUND' };
    if (!row.quick_win_executed) return { success: false, action: 'undo_close', ticketKey: row.ticket_id, detail: 'Not an auto-closed decision', error: 'NOT_EXECUTED' };
    if (row.quick_win_undone) return { success: false, action: 'undo_close', ticketKey: row.ticket_id, detail: 'Already undone', error: 'ALREADY_UNDONE' };

    const ticketKey = row.ticket_id;
    try {
      // Find a transition that reopens the ticket
      const transitionId = await this.findTransitionId(ticketKey, 'reopen')
        || await this.findTransitionId(ticketKey, 'open')
        || await this.findTransitionId(ticketKey, 'progress');

      if (transitionId) {
        await this.jiraClient.transitionIssue(ticketKey, transitionId);
      } else {
        console.warn(`[quick-win] No reopen transition found for ${ticketKey} — marking undone without Jira transition`);
      }

      await this.jiraClient.addComment(ticketKey,
        `[AI Agent — Undo] Auto-close reversed by ${undoneBy}. Ticket reopened.`,
        { internal: true },
      );

      await executeAndGetId(
        `UPDATE agent_decisions
         SET quick_win_undone = 1, quick_win_undone_at = GETUTCDATE(), quick_win_undone_by = ?
         WHERE id = ?`,
        [undoneBy, decisionId],
      );

      return {
        success: true, action: 'undo_close', ticketKey,
        detail: `Auto-close undone by ${undoneBy}${transitionId ? ' — ticket reopened' : ' — no reopen transition found'}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, action: 'undo_close', ticketKey, detail: `Undo failed: ${msg}`, error: msg };
    }
  }

  private async findTransitionId(issueKey: string, targetName: string): Promise<string | null> {
    try {
      const result = await this.jiraClient.getTransitionsWithFields(issueKey);
      const transitions = (result as any)?.transitions as Array<{ id: string; name: string }> | undefined;
      if (!transitions) return null;

      const match = transitions.find(t =>
        t.name.toLowerCase().includes(targetName.toLowerCase()),
      );
      return match?.id ?? null;
    } catch {
      return null;
    }
  }
}
