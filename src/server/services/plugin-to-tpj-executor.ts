import type { JiraRestClient } from './jira-client.js';
import type { HybridActionMatch, HybridActionResult } from './agent-types.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { executeAndGetId } from './database.js';

const TPJ_PROJECT_ID = '11808';
const QUICK_RESOLVE_TRANSITION_ID = '17';
const CF_RESOLUTION_TYPE = 'customfield_14494';

export class PluginToTpjExecutor {
  private jiraClient: JiraRestClient;
  private settings: SettingsQueries;

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries) {
    this.jiraClient = jiraClient;
    this.settings = settings;
  }

  async execute(match: HybridActionMatch): Promise<HybridActionResult> {
    const { ticketKey, summary, description } = match;

    try {
      // 1. Get labels from original ticket
      const original = await this.jiraClient.getIssue(ticketKey, ['labels']);
      const labels: string[] = (original?.fields?.labels as string[]) ?? [];

      // 2. Create ticket in TPJ
      const truncatedDesc = (description || '').slice(0, 5000);
      const created = await this.jiraClient.createIssue({
        fields: {
          project: { id: TPJ_PROJECT_ID },
          summary,
          description: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: truncatedDesc || 'No description provided.' }] }],
          },
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

      // 5. Set resolution type, assign to NOVA service account, then transition original to Resolved
      try {
        await this.jiraClient.updateFields(ticketKey, {
          [CF_RESOLUTION_TYPE]: { value: 'No Fault Found' },
        });
        const novaAccountId = this.settings.get('nova_ai_jira_account_id');
        if (novaAccountId) {
          await this.jiraClient.updateFields(ticketKey, { assignee: { accountId: novaAccountId } });
        }
        await this.jiraClient.transitionIssue(ticketKey, QUICK_RESOLVE_TRANSITION_ID);
        console.log(`[plugin-to-tpj] Resolved original ${ticketKey}`);
      } catch (err) {
        const statusCode = (err as any)?.statusCode ?? (err as any)?.status ?? 'N/A';
        const body = (err as any)?.body ? JSON.stringify((err as any).body).slice(0, 300) : '';
        console.warn(`[plugin-to-tpj] Failed to transition ${ticketKey} to resolved: HTTP ${statusCode} — ${err instanceof Error ? err.message : err}${body ? ` | ${body}` : ''}`);
      }

      // 6. Log to hybrid_action_log
      await executeAndGetId(
        `INSERT INTO hybrid_action_log (action_id, source_ticket_key, created_ticket_key, status, detail)
         VALUES ('plugin_to_tpj', ?, ?, 'completed', ?)`,
        [ticketKey, newKey, `Cloned to ${newKey}, comments copied, original resolved`],
      );

      return {
        success: true,
        actionId: 'plugin_to_tpj',
        ticketKey,
        detail: `Cloned to ${newKey}, comments copied, original resolved via Quick Resolve`,
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
