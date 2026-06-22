import type { JiraRestClient } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';

// JSM customer request type field. This is an `sd-customerrequesttype` field
// that must be set BY ID (e.g. { id: '243' }), not by name, and is the field
// JSM/portal actually uses. The legacy customfield_10020 is NOT editable on NT
// issues (absent from editmeta), so writes to it silently no-op — that was the
// long-standing bug. Configurable via setting `jira_request_type_field`
// (the same setting the onboarding orchestrator uses).
const DEFAULT_REQUEST_TYPE_FIELD = 'customfield_12800';
const DEFAULT_SERVICE_DESK_ID = '50';

const CF_REQUEST_TYPE = DEFAULT_REQUEST_TYPE_FIELD;

// Fallback request-type name → ID map for NT / service desk 50. Used only when
// the live servicedesk catalog can't be fetched or a name isn't found in it.
// Verified IDs (Jun 2026); the live catalog (getRequestTypes) takes precedence.
const REQUEST_TYPE_ID_SEED: Record<string, string> = {
  'ai request': '1064',
  'service request': '598',
  'tpj request': '897',
  'incident': '243',
  'onboarding': '930',
  'chat': '268',
};

// Cached name(lowercased) → id from the live servicedesk catalog.
let catalogCache: Record<string, string> | null = null;
let catalogFetchedAt = 0;
const CATALOG_TTL_MS = 60 * 60 * 1000; // 1h

export function getRequestTypeField(settings: SettingsQueries): string {
  return settings.get('jira_request_type_field') || DEFAULT_REQUEST_TYPE_FIELD;
}

/** Resolve a request-type name to its JSM ID, preferring the live servicedesk
 *  catalog and falling back to the seed map. */
async function resolveRequestTypeId(
  jiraClient: JiraRestClient,
  settings: SettingsQueries,
  name: string,
): Promise<string | null> {
  const wantLower = name.toLowerCase();
  if (!catalogCache || Date.now() - catalogFetchedAt > CATALOG_TTL_MS) {
    const sdId = settings.get('jira_servicedesk_id') || DEFAULT_SERVICE_DESK_ID;
    const types = await jiraClient.getRequestTypes(sdId);
    if (types.length > 0) {
      const next: Record<string, string> = {};
      for (const t of types) next[t.name.toLowerCase()] = t.id;
      catalogCache = next;
      catalogFetchedAt = Date.now();
    }
  }
  return catalogCache?.[wantLower] ?? REQUEST_TYPE_ID_SEED[wantLower] ?? null;
}

/**
 * Set the JSM customer request type on a ticket — maps NOVA's classification
 * category to the correct request type and writes it BY ID to the request-type
 * field. This is the single source of truth for "change request type away from
 * AI Request"; all handoff/assign/close paths call it.
 */
export async function setRequestType(
  jiraClient: JiraRestClient,
  settings: SettingsQueries,
  ticketKey: string,
  classification?: { category?: string; ticket_type?: string },
  override?: string,
): Promise<void> {
  const name = override ?? resolveRequestType(classification);
  const field = getRequestTypeField(settings);
  const id = await resolveRequestTypeId(jiraClient, settings, name);
  if (!id) {
    console.warn(`[request-type] No ID for request type "${name}" — skipping update on ${ticketKey}`);
    return;
  }
  try {
    await jiraClient.updateFields(ticketKey, { [field]: { id } });
    console.log(`[request-type] Set Request Type "${name}" (id ${id}) on ${ticketKey}`);
  } catch (err) {
    console.warn(`[request-type] Failed to set Request Type on ${ticketKey}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Stamp "AI Request" on a ticket NOVA is about to work — but ONLY if the request-type
 * field is currently empty, so we never clobber a type the portal/customer already set.
 * Called at self-assign so the ticket reads "AI is dealing with it" from the start; the
 * close/handoff paths later move it to the resolved category via setRequestType().
 */
export async function ensureAiRequestTypeIfEmpty(
  jiraClient: JiraRestClient,
  settings: SettingsQueries,
  ticketKey: string,
): Promise<void> {
  const field = getRequestTypeField(settings);
  try {
    const issue = await jiraClient.getIssue(ticketKey, [field]);
    const current = (issue?.fields as Record<string, unknown> | undefined)?.[field];
    if (current != null && current !== '') return; // already typed — leave it
  } catch (err) {
    console.warn(`[request-type] Could not read request type on ${ticketKey}, skipping AI Request stamp:`, err instanceof Error ? err.message : err);
    return;
  }
  await setRequestType(jiraClient, settings, ticketKey, undefined, 'AI Request');
}

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

  await setRequestType(jiraClient, settings, ctx.ticketKey, ctx.classification, ctx.requestTypeOverride);
}

export function resolveRequestType(classification?: { category?: string; ticket_type?: string }): string {
  const category = classification?.category?.toLowerCase().replace(/\s+/g, '_') ?? '';
  const ticketType = classification?.ticket_type ?? '';

  if (CATEGORY_TO_REQUEST_TYPE[category]) return CATEGORY_TO_REQUEST_TYPE[category];
  if (ticketType === 'incident') return 'Incident';
  if (ticketType === 'change') return 'Service Request';

  return 'Emailed request';
}
