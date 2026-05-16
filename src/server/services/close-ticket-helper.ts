import type { JiraRestClient } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';

const CF_REQUEST_TYPE = 'customfield_10020';

const CATEGORY_TO_REQUEST_TYPE: Record<string, string> = {
  'email': 'Emailed request',
  'email_delivery': 'Emailed request',
  'gdpr': 'GDPR',
  'data_protection': 'GDPR',
  'incident': 'Incident',
  'integration': 'Incident',
  'integration_issue': 'Incident',
  'api_error': 'Incident',
  'server_error': 'Incident',
  'database_issue': 'Incident',
  'feed_issue': 'Incident',
  'data_feed': 'Incident',
  'website': 'Incident',
  'portal': 'Incident',
  'crm': 'Incident',
  'reporting': 'Service Request',
  'user_management': 'Service Request',
  'onboarding': 'Onboarding',
  'delivery': 'Delivery QA',
  'delivery_qa': 'Delivery QA',
  'franchise': 'Franchise Hub',
  'chat': 'Chat',
  'template': 'Service Request',
  'design': 'Service Request',
  'branding': 'Service Request',
};

export { CATEGORY_TO_REQUEST_TYPE, CF_REQUEST_TYPE };

export interface CloseContext {
  ticketKey: string;
  classification?: { category?: string; ticket_type?: string };
  requestTypeOverride?: string;
}

/**
 * Ensures a ticket being closed/resolved by NOVA AI has:
 * 1. Assignee set to the nova-jira service account
 * 2. Request type updated from "AI Request" to the correct type
 *
 * Call BEFORE the transition/resolve call on every close path outside Actor.
 */
export async function prepareTicketForClose(
  jiraClient: JiraRestClient,
  settings: SettingsQueries,
  ctx: CloseContext,
): Promise<void> {
  const accountId = settings.get('nova_ai_jira_account_id');
  if (accountId) {
    try {
      await jiraClient.updateFields(ctx.ticketKey, { assignee: { accountId } });
    } catch (err) {
      console.warn(`[close-helper] Failed to assign ${ctx.ticketKey} to NOVA:`, err instanceof Error ? err.message : err);
    }
  } else {
    console.error('[close-helper] CRITICAL: nova_ai_jira_account_id not configured');
  }

  const requestType = ctx.requestTypeOverride ?? resolveRequestType(ctx.classification);
  try {
    await jiraClient.updateFields(ctx.ticketKey, {
      [CF_REQUEST_TYPE]: { requestType: { name: requestType } },
    });
    console.log(`[close-helper] Updated Request Type to "${requestType}" on ${ctx.ticketKey}`);
  } catch (err) {
    console.warn(`[close-helper] Failed to update Request Type on ${ctx.ticketKey}:`, err instanceof Error ? err.message : err);
  }
}

export function resolveRequestType(classification?: { category?: string; ticket_type?: string }): string {
  const category = classification?.category?.toLowerCase().replace(/\s+/g, '_') ?? '';
  const ticketType = classification?.ticket_type ?? '';

  if (CATEGORY_TO_REQUEST_TYPE[category]) return CATEGORY_TO_REQUEST_TYPE[category];
  if (ticketType === 'incident') return 'Incident';
  if (ticketType === 'change') return 'Service Request';

  return 'Emailed request';
}
