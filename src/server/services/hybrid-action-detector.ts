import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';
import type { TicketEvent, HybridActionMatch } from './agent-types.js';
import { executeAndGetId, query } from './database.js';

const MAX_RETRY_COUNT = 3;
const PLUGIN_REPORTER_EMAIL = 'smart.plugin.manager@wpengine.com';
const PLUGIN_SUMMARY_PATTERNS = [
  /\d+\s+plugins?\s+(?:were|was)\s+not\s+updated/i,
  /Smart Plugin Manager could not connect/i,
];

const ABUSE_SUMMARY = 'Received Abuse Report';
const ABUSE_FIELD_PATTERNS = {
  abuseEmail: /(?:abuse\s*email|from|email)\s*[:=]\s*([^\r\n]+)/i,
  instanceId: /instance\s*id\s*[:=]\s*(\d+)/i,
  contactId: /contact\s*id\s*[:=]\s*(\d+)/i,
  instanceUrl: /instance\s*url\s*[:=]\s*(https?:\/\/[^\s\r\n]+)/i,
};

export class HybridActionDetector {
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  async detect(event: TicketEvent, jiraClient: JiraRestClient): Promise<HybridActionMatch | null> {
    if (event.eventType !== 'ticket_created') return null;

    const pluginMatch = this.detectPluginToTpj(event);
    if (pluginMatch) {
      const retryExhausted = await this.checkRetryExhausted(event.ticketKey, 'plugin_to_tpj');
      if (retryExhausted) {
        return null;
      }
      const preEmpted = await this.checkPluginPreEmption(event.ticketKey, jiraClient);
      if (preEmpted) {
        await this.logPreEmption(event, 'plugin_to_tpj', preEmpted);
        return null;
      }
      return pluginMatch;
    }

    const abuseMatch = this.detectAbuseReport(event);
    if (abuseMatch) {
      const retryExhausted = await this.checkRetryExhausted(event.ticketKey, 'abuse_report');
      if (retryExhausted) {
        return null;
      }
      const preEmpted = await this.checkAbusePreEmption(event.ticketKey, jiraClient);
      if (preEmpted) {
        await this.logPreEmption(event, 'abuse_report', preEmpted);
        return null;
      }
      return abuseMatch;
    }

    return null;
  }

  private detectPluginToTpj(event: TicketEvent): HybridActionMatch | null {
    const reporterEmail = event.reporterEmail
      ?? (event.fields?.reporter as { emailAddress?: string })?.emailAddress
      ?? null;
    const summaryMatch = PLUGIN_SUMMARY_PATTERNS.some(p => p.test(event.summary));
    const emailMatch = reporterEmail?.toLowerCase() === PLUGIN_REPORTER_EMAIL;

    if (emailMatch && !summaryMatch) {
      console.warn(`[hybrid-detector] Plugin email but summary didn't match: ${event.ticketKey} — "${event.summary}"`);
    }

    if (!summaryMatch && !emailMatch) return null;

    console.log(`[hybrid-detector] Plugin ticket detected: ${event.ticketKey} (email=${emailMatch}, summary=${summaryMatch})`);
    return {
      actionId: 'plugin_to_tpj',
      ticketKey: event.ticketKey,
      ticketId: event.ticketId,
      summary: event.summary,
      description: event.description,
      parsedData: { reporterEmail, detectionMethod: emailMatch ? 'email' : 'summary' },
      requiresApproval: false,
    };
  }

  private detectAbuseReport(event: TicketEvent): HybridActionMatch | null {
    const isSummaryMatch = event.summary === ABUSE_SUMMARY;
    const desc = event.description || '';
    const hasAllFields = desc.includes('Instance ID:') && desc.includes('Contact ID:') && desc.includes('Instance URL:');

    if (!isSummaryMatch && !hasAllFields) return null;

    const parsed: Record<string, string> = {};
    for (const [key, pattern] of Object.entries(ABUSE_FIELD_PATTERNS)) {
      const match = desc.match(pattern);
      if (match) parsed[key] = match[1].trim();
    }

    if (!parsed.contactId || !parsed.instanceId) {
      console.warn(`[hybrid-detector] Abuse report detected but missing required fields: ${event.ticketKey}`);
      return null;
    }

    console.log(`[hybrid-detector] Abuse report detected: ${event.ticketKey} (contact=${parsed.contactId}, instance=${parsed.instanceId})`);
    return {
      actionId: 'abuse_report',
      ticketKey: event.ticketKey,
      ticketId: event.ticketId,
      summary: event.summary,
      description: event.description,
      parsedData: parsed,
      requiresApproval: true,
    };
  }

  private async checkPluginPreEmption(ticketKey: string, jiraClient: JiraRestClient): Promise<string | null> {
    try {
      const issue = await jiraClient.getIssue(ticketKey, ['status', 'comment']);
      if (!issue) return 'Ticket no longer exists';

      const statusCat = (issue.fields?.status as { statusCategory?: { key?: string } })?.statusCategory?.key;
      if (statusCat === 'done') return 'Ticket already resolved/closed';

      const comments = await jiraClient.getComments(ticketKey, 20);
      for (const c of comments) {
        const bodyText = typeof c.body === 'string' ? c.body : JSON.stringify(c.body);
        if (bodyText.includes('moved your request into')) {
          return 'Ticket already moved by human (comment found)';
        }
      }
      return null;
    } catch (err) {
      console.warn(`[hybrid-detector] Pre-emption check failed for ${ticketKey}:`, err);
      return null;
    }
  }

  private async checkAbusePreEmption(ticketKey: string, jiraClient: JiraRestClient): Promise<string | null> {
    try {
      const issue = await jiraClient.getIssue(ticketKey, ['status']);
      if (!issue) return 'Ticket no longer exists';

      const statusCat = (issue.fields?.status as { statusCategory?: { key?: string } })?.statusCategory?.key;
      if (statusCat === 'done') return 'Ticket already resolved/closed';

      const comments = await jiraClient.getComments(ticketKey, 20);
      for (const c of comments) {
        if (c.author?.displayName === 'n8n Automations') {
          return 'Already processed by n8n workflow';
        }
        const bodyText = typeof c.body === 'string' ? c.body : JSON.stringify(c.body);
        if (bodyText.includes('Abuse report processed')) {
          return 'Already processed (comment found)';
        }
      }
      return null;
    } catch (err) {
      console.warn(`[hybrid-detector] Pre-emption check failed for ${ticketKey}:`, err);
      return null;
    }
  }

  private async checkRetryExhausted(ticketKey: string, actionId: string): Promise<boolean> {
    try {
      const rows = await query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM hybrid_action_log
         WHERE source_ticket_key = ? AND action_id = ? AND status = 'failed'`,
        [ticketKey, actionId],
      );
      const failCount = rows[0]?.cnt ?? 0;
      if (failCount >= MAX_RETRY_COUNT) {
        console.warn(`[hybrid-detector] ${actionId} on ${ticketKey} exhausted ${MAX_RETRY_COUNT} retries — marking as permanently failed`);
        await executeAndGetId(
          `INSERT INTO hybrid_action_log (action_id, source_ticket_key, status, detail)
           VALUES (?, ?, 'failed_permanent', ?)`,
          [actionId, ticketKey, `Exhausted ${MAX_RETRY_COUNT} retries — manual intervention needed`],
        );
        return true;
      }
      return false;
    } catch (err) {
      console.warn(`[hybrid-detector] Retry check failed for ${ticketKey}:`, err);
      return false;
    }
  }

  private async logPreEmption(event: TicketEvent, actionId: string, reason: string): Promise<void> {
    console.log(`[hybrid-detector] Pre-empted ${actionId} on ${event.ticketKey}: ${reason}`);
    try {
      await executeAndGetId(
        `INSERT INTO hybrid_action_log (action_id, source_ticket_key, status, pre_empted, pre_emption_reason)
         VALUES (?, ?, 'pre_empted', 1, ?)`,
        [actionId, event.ticketKey, reason],
      );
    } catch (err) {
      console.warn(`[hybrid-detector] Failed to log pre-emption:`, err);
    }
  }
}
