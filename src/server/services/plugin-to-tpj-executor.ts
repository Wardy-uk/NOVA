import type { JiraRestClient } from './jira-client.js';
import type { HybridActionMatch, HybridActionResult } from './agent-types.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { executeAndGetId } from './database.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';
import { isBusinessDay } from '../utils/business-hours.js';

const TPJ_PROJECT_ID = '11808';
const QUICK_RESOLVE_TRANSITION_ID = '17';

export class PluginToTpjExecutor {
  private jiraClient: JiraRestClient;
  private settings: SettingsQueries;

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries) {
    this.jiraClient = jiraClient;
    this.settings = settings;
  }

  async execute(match: HybridActionMatch): Promise<HybridActionResult> {
    const { ticketKey, summary, description } = match;

    // On weekends and bank holidays, only close the original — don't create TPJ ticket
    if (!isBusinessDay(new Date())) {
      console.log(`[plugin-to-tpj] Non-business day — closing ${ticketKey} without creating TPJ ticket`);
      try {
        const novaAccountId = this.settings.get('nova_ai_jira_account_id');
        if (novaAccountId) {
          await this.jiraClient.updateFields(ticketKey, { assignee: { accountId: novaAccountId } });
        }
        const { fields, comment } = buildResolveFields({
          tldr: 'Plugin notification received outside business hours — closed automatically by NOVA',
          resolution: 'No Fault Found',
          comment: 'This plugin notification was received outside business hours. It has been closed automatically. If the issue persists, a new ticket will be created on the next business day.',
        });
        await this.jiraClient.transitionIssue(ticketKey, QUICK_RESOLVE_TRANSITION_ID, { fields, comment });
        if (novaAccountId) {
          await this.jiraClient.updateFields(ticketKey, { assignee: { accountId: novaAccountId } });
        }
      } catch (err) {
        console.error(`[plugin-to-tpj] Failed to close ${ticketKey} on non-business day:`, err instanceof Error ? err.message : err);
      }
      return {
        success: true,
        actionId: 'plugin_to_tpj',
        ticketKey,
        detail: 'Non-business day — original closed without TPJ clone',
      };
    }

    try {
      // 1. Get labels and description (ADF) from original ticket
      const original = await this.jiraClient.getIssue(ticketKey, ['labels', 'description']);
      const labels: string[] = (original?.fields?.labels as string[]) ?? [];
      const originalDescription = original?.fields?.description;

      // 2. Create ticket in TPJ — preserve original ADF formatting
      const adfDescription = originalDescription && typeof originalDescription === 'object'
        ? originalDescription
        : {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: (description || '').slice(0, 5000) || 'No description provided.' }] }],
          };
      const created = await this.jiraClient.createIssue({
        fields: {
          project: { id: TPJ_PROJECT_ID },
          summary,
          description: adfDescription,
          issuetype: { name: 'Support' },
          ...(labels.length > 0 ? { labels } : {}),
        },
      });

      const newKey = created?.key;
      if (!newKey) {
        return { success: false, actionId: 'plugin_to_tpj', ticketKey, detail: 'Failed to create TPJ ticket — no key returned' };
      }
      console.log(`[plugin-to-tpj] Created ${newKey} from ${ticketKey}`);

      // 3. Copy comments from original to new ticket
      try {
        const comments = await this.jiraClient.getComments(ticketKey, 50);
        for (const c of comments) {
          const bodyText = typeof c.body === 'string' ? c.body : this.extractAdfText(c.body);
          if (bodyText) {
            await this.jiraClient.addComment(newKey, `[${c.author?.displayName ?? 'Unknown'}]: ${bodyText}`, { internal: false });
          }
        }
      } catch (err) {
        console.warn(`[plugin-to-tpj] Failed to copy comments from ${ticketKey}:`, err);
      }

      // 4. Post public comment on original
      await this.jiraClient.addComment(
        ticketKey,
        `We've moved your request into The Property Jungle Support. You'll now receive updates on your new ticket: ${newKey}.`,
        { internal: false },
      );

      // 5. Assign to NOVA, transition to Resolved, then re-assign (in case transition resets assignee)
      let resolveError: string | null = null;
      try {
        const novaAccountId = this.settings.get('nova_ai_jira_account_id');
        if (novaAccountId) {
          await this.jiraClient.updateFields(ticketKey, { assignee: { accountId: novaAccountId } });
        }
        const { fields, comment } = buildResolveFields({
          tldr: `Plugin ticket cloned to ${newKey} — automated by NOVA`,
          resolution: 'Third-Party / External Resolution',
          comment: `This ticket has been automatically cloned to ${newKey} in the Third-Party Jira project. The original is being resolved as the plugin issue will be tracked there.`,
        });
        await this.jiraClient.transitionIssue(ticketKey, QUICK_RESOLVE_TRANSITION_ID, { fields, comment });
        // Re-assign after transition in case it resets assignee
        if (novaAccountId) {
          await this.jiraClient.updateFields(ticketKey, { assignee: { accountId: novaAccountId } });
        }
        console.log(`[plugin-to-tpj] Resolved original ${ticketKey}`);
      } catch (err) {
        const statusCode = (err as any)?.statusCode ?? (err as any)?.status ?? 'N/A';
        const body = (err as any)?.body ? JSON.stringify((err as any).body).slice(0, 300) : '';
        resolveError = `HTTP ${statusCode}: ${err instanceof Error ? err.message : err}${body ? ` | ${body}` : ''}`;
        console.error(`[plugin-to-tpj] Failed to resolve ${ticketKey}: ${resolveError}`);

        // Log available transitions for diagnosis
        try {
          const t = await this.jiraClient.getTransitionsWithFields(ticketKey);
          const names = ((t as any)?.transitions ?? []).map((tr: any) => `${tr.id}:${tr.name}`).join(', ');
          console.error(`[plugin-to-tpj] Available transitions for ${ticketKey}: [${names}]`);
        } catch { /* best effort */ }
      }

      // 6. Log to hybrid_action_log
      const resolved = !resolveError;
      const detail = resolved
        ? `Cloned to ${newKey}, comments copied, original resolved`
        : `Cloned to ${newKey}, comments copied, but failed to resolve original: ${resolveError}`;
      await executeAndGetId(
        `INSERT INTO hybrid_action_log (action_id, source_ticket_key, created_ticket_key, status, detail)
         VALUES ('plugin_to_tpj', ?, ?, ?, ?)`,
        [ticketKey, newKey, resolved ? 'completed' : 'partial', detail],
      );

      return {
        success: resolved,
        actionId: 'plugin_to_tpj',
        ticketKey,
        detail: resolved
          ? `Cloned to ${newKey}, comments copied, original resolved via Quick Resolve`
          : `Cloned to ${newKey} but failed to resolve original: ${resolveError}`,
        createdTicketKey: newKey,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusCode = (err as any)?.statusCode ?? (err as any)?.status ?? 'N/A';
      const responseBody = (err as any)?.body ? JSON.stringify((err as any).body).slice(0, 500) : 'N/A';
      console.error(`[plugin-to-tpj] Failed for ${ticketKey}: HTTP ${statusCode} — ${msg}`);
      console.error(`[plugin-to-tpj] Response body: ${responseBody}`);

      const detail = `HTTP ${statusCode}: ${msg} | body: ${responseBody}`.slice(0, 4000);
      try {
        await executeAndGetId(
          `INSERT INTO hybrid_action_log (action_id, source_ticket_key, status, detail)
           VALUES ('plugin_to_tpj', ?, 'failed', ?)`,
          [ticketKey, detail],
        );
      } catch { /* best effort */ }

      return { success: false, actionId: 'plugin_to_tpj', ticketKey, detail: 'Plugin redirect failed', error: msg };
    }
  }

  private extractAdfText(body: unknown): string {
    if (!body || typeof body !== 'object') return '';
    try {
      const walk = (node: unknown): string => {
        if (!node || typeof node !== 'object') return '';
        const n = node as Record<string, unknown>;
        if (n.type === 'text' && typeof n.text === 'string') return n.text;
        if (Array.isArray(n.content)) return n.content.map(walk).join('');
        return '';
      };
      return walk(body);
    } catch {
      return JSON.stringify(body).slice(0, 500);
    }
  }
}
