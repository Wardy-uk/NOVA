import type { JiraRestClient } from './jira-client.js';
import type { AgentDecision, ActionResult } from './agent-types.js';
import type { Observer } from './observer.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { executeAndGetId, query } from './database.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';
import { prepareTicketForClose } from './close-ticket-helper.js';

const QW_COMMENT_PREFIX = '[AI Agent — Auto-Close]';

const CLOSE_COMMENTS: Record<string, string> = {
  spam: `${QW_COMMENT_PREFIX} This ticket was identified as spam or an automated submission and has been cancelled.`,
  thank_you: `${QW_COMMENT_PREFIX} Thanks for letting us know — glad we could help! Closing this ticket. If you need anything else, just raise a new request and we'll pick it up.`,
  stale_no_response: `${QW_COMMENT_PREFIX} We've followed up a few times but haven't heard back. Closing this ticket for now — if you still need help, just raise a new request or reply to this one and we'll reopen it.`,
  auto_resolved: `${QW_COMMENT_PREFIX} It looks like this issue has been resolved. Closing this ticket — if the problem returns, please raise a new request.`,
  duplicate: `${QW_COMMENT_PREFIX} This ticket appears to be a duplicate. Please see the original ticket referenced below. Closing to avoid duplication — if this is a separate issue, please raise a new request.`,
};

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
      // Store pre-close status
      await executeAndGetId(
        `UPDATE agent_decisions SET pre_close_status = ? WHERE id = ?`,
        [preCloseStatus, decisionId],
      );

      // Assign to NOVA + update request type before closing
      await prepareTicketForClose(this.jiraClient, this.settings, {
        ticketKey,
        classification: (decision.output.classification as { category?: string; ticket_type?: string }) ?? undefined,
        requestTypeOverride: qw.type === 'spam' ? 'Emailed request' : undefined,
      });

      // Post comment (spam = internal only, others = public)
      if (qw.type === 'kba_match') {
        const kba = qw.suggested_kba || 'a relevant knowledge base article';
        const comment = `${QW_COMMENT_PREFIX} This question is covered by our knowledge base: ${kba}. Please take a look and let us know if you need further help. If we don't hear back within 5 working days, we'll close this ticket.`;
        await this.jiraClient.addComment(ticketKey, comment, { internal: false });
      } else if (qw.type === 'spam') {
        await this.jiraClient.addComment(ticketKey, CLOSE_COMMENTS.spam, { internal: true });
      } else {
        const comment = CLOSE_COMMENTS[qw.type] || `${QW_COMMENT_PREFIX} This ticket has been auto-closed.`;
        await this.jiraClient.addComment(ticketKey, comment, { internal: false });
      }

      // Find and execute transition — try primary name, then fallbacks
      const targetTransition = qw.type === 'spam' ? 'cancel' : qw.type === 'kba_match' ? 'waiting' : 'resolve';
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
        spam: 'Request Cancelled / Withdrawn', thank_you: 'No Fault Found', kba_match: 'Fix By Tech Services',
        stale_no_response: 'Request Cancelled / Withdrawn', duplicate: 'Duplicate', auto_resolved: 'No Fault Found',
      };
      try { if (resMapRaw) resMap = { ...resMap, ...JSON.parse(resMapRaw) }; } catch {}

      if (['resolve', 'cancel'].includes(targetTransition)) {
        try {
          const resolution = resMap[qw.type] || 'No Fault Found';
          const { fields, comment: resolveComment } = buildResolveFields({
            tldr: `Quick win auto-close: ${qw.type}`,
            resolution,
            comment: CLOSE_COMMENTS[qw.type] || 'Auto-closed by NOVA quick win detection.',
          });
          await this.jiraClient.transitionIssue(ticketKey, transitionId, { fields, comment: resolveComment });
        } catch (err) {
          console.warn(`[quick-win] Failed to set resolve fields on ${ticketKey}:`, err instanceof Error ? err.message : err);
          await this.jiraClient.transitionIssue(ticketKey, transitionId, {
            fields: { resolution: { name: 'Done' } },
          });
        }
      } else {
        await this.jiraClient.transitionIssue(ticketKey, transitionId);
      }

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
