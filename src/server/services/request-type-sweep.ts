import { z } from 'zod';
import type { JiraRestClient, JiraIssue } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import { setRequestType } from './close-ticket-helper.js';

// Safety net for the request-type field (JSM customer request type, customfield_12800).
// Front-line triage (n8n NOVA-Jira) is meant to stamp "AI Request" on every ticket it
// picks up, but email-channel tickets can land with no request type and the stamp is
// occasionally missed — leaving the ticket invisible to the "AI Requests" queue and
// uncounted by the CC KPI buckets. This sweep finds any NT ticket with an empty request
// type and sets one:
//   • assigned to NOVA  → "AI Request" (NOVA is actively dealing with it)
//   • otherwise         → inferred from the ticket content, defaulting to "Incident"
// Detection is by JQL ("Request Type" is EMPTY) rather than the jira_issue_cache, because
// the cache's request_type column is populated from cf13482, not the canonical cf12800.

const DEFAULT_LIMIT = 50;
const DEFAULT_PROJECT = 'NT';

const FIELDS = [
  'summary', 'description', 'status', 'issuetype',
  'assignee', 'reporter', 'created', 'comment', 'customfield_12800',
];

// Request types the inference step may choose. "Incident" is the guaranteed fallback.
const INFER_TYPES = [
  'Incident', 'Service Request', 'Chat', 'GDPR', 'Emailed request', 'TPJ Request', 'Onboarding',
] as const;
type InferType = typeof INFER_TYPES[number];

const InferenceSchema = z.object({
  request_type: z.any().transform((v): InferType => {
    const raw = typeof v === 'string'
      ? v
      : (v && typeof v === 'object' ? ((v.value ?? v.name ?? v.type ?? '') as string) : '');
    const match = INFER_TYPES.find(t => t.toLowerCase() === String(raw).toLowerCase().trim());
    return match ?? 'Incident';
  }),
  reasoning: z.any().transform(v => (typeof v === 'string' ? v : JSON.stringify(v ?? ''))),
});
type Inference = z.infer<typeof InferenceSchema>;

export interface RequestTypeSweepResult {
  scanned: number;
  setAiRequest: number;
  inferred: number;
  failed: number;
}

export class RequestTypeSweep {
  constructor(
    private jiraClient: JiraRestClient,
    private settings: SettingsQueries,
    private llmService?: LlmService,
  ) {}

  async sweep(shadow = false): Promise<RequestTypeSweepResult> {
    const result: RequestTypeSweepResult = { scanned: 0, setAiRequest: 0, inferred: 0, failed: 0 };
    if (this.settings.get('agent_request_type_sweep_enabled') === 'false') return result;

    const project = this.settings.get('agent_request_type_sweep_project') || DEFAULT_PROJECT;
    const limit = this.getNumber('agent_request_type_sweep_limit', DEFAULT_LIMIT);
    const novaAccountId = this.settings.get('nova_ai_jira_account_id') ?? '';

    let issues: JiraIssue[];
    try {
      const projClause = project.includes(',') ? `project in (${project})` : `project = ${project}`;
      const res = await this.jiraClient.searchJqlAll(
        `${projClause} AND "Request Type" is EMPTY AND statusCategory != Done ORDER BY created DESC`,
        FIELDS,
        limit,
      );
      issues = res.issues;
    } catch (err) {
      console.warn('[rt-sweep] JQL search failed:', err instanceof Error ? err.message : err);
      return result;
    }

    result.scanned = issues.length;
    if (issues.length === 0) return result;
    console.log(`[rt-sweep] ${issues.length} ${project} ticket(s) with no request type${shadow ? ' [SHADOW]' : ''}`);

    for (const issue of issues) {
      const key = issue.key;
      const assigneeId = (issue.fields.assignee as { accountId?: string } | null)?.accountId ?? '';
      const isNova = !!novaAccountId && assigneeId === novaAccountId;
      const target = isNova ? 'AI Request' : await this.inferRequestType(issue);

      if (shadow) {
        console.log(`[rt-sweep] [SHADOW] would set "${target}" on ${key} (${isNova ? 'NOVA-assigned' : 'inferred'})`);
        if (isNova) result.setAiRequest++; else result.inferred++;
        continue;
      }

      try {
        await setRequestType(this.jiraClient, this.settings, key, undefined, target);
        if (isNova) result.setAiRequest++; else result.inferred++;
        console.log(`[rt-sweep] Set "${target}" on ${key} (${isNova ? 'NOVA-assigned' : 'inferred'})`);
      } catch (err) {
        result.failed++;
        console.warn(`[rt-sweep] Failed to set request type on ${key}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[rt-sweep] Done — AI Request: ${result.setAiRequest}, inferred: ${result.inferred}, failed: ${result.failed}`);
    return result;
  }

  /** Infer a request type from the ticket content. Defaults to "Incident" when the LLM
   *  is unavailable, errors, or can't determine a type. */
  private async inferRequestType(issue: JiraIssue): Promise<string> {
    if (!this.llmService) return 'Incident';
    const f = issue.fields;
    try {
      const conversation = this.extractConversation(issue);
      const system = `You classify inbound Nurtur (proptech SaaS) support tickets into ONE JSM request type.
Valid request types: ${INFER_TYPES.join(', ')}.
Guidance:
- Incident: something is broken or not working (website, portal, CRM, data feed, integration, errors, display/layout issues). This is the DEFAULT when unsure.
- Service Request: a request to change something or for new work — new report, user/account admin, template/design/branding — where nothing is broken.
- Chat: the ticket clearly originated from a live-chat transcript.
- GDPR: data-protection, subject-access or right-to-erasure requests.
- Emailed request: a general email enquiry that does not fit any of the above.
- TPJ Request: Property Jungle / website-build maintenance work.
- Onboarding: new-customer setup or onboarding.
Respond with JSON only: { "request_type": "<one of the valid types>", "reasoning": "<one short sentence>" }.
If you cannot determine the type, use "Incident".`;
      const user = `Ticket ${issue.key}
Summary: ${(f.summary as string) ?? ''}
Issue type: ${(f.issuetype as { name?: string } | undefined)?.name ?? ''}
Description: ${((f.description as string) ?? '').slice(0, 1200)}
Recent activity:
${conversation || '(no comments)'}`;

      const res = await this.llmService.call<Inference>(system, user, InferenceSchema, {
        ticketId: issue.key,
        callType: 'request_type_infer',
        tier: 'cheap',
        temperature: 0,
        maxTokens: 300,
      });
      return res.data.request_type;
    } catch (err) {
      console.warn(`[rt-sweep] Inference failed for ${issue.key}, defaulting to Incident:`, err instanceof Error ? err.message : err);
      return 'Incident';
    }
  }

  private extractConversation(issue: JiraIssue): string {
    const comments = (issue.fields.comment as { comments?: Array<{ author?: { displayName?: string }; body?: unknown; created?: string }> } | undefined)?.comments;
    if (!comments?.length) return '';
    return comments
      .slice(-3)
      .map(c => `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}: ${typeof c.body === 'string' ? c.body.slice(0, 300) : '(complex body)'}`)
      .join('\n');
  }

  private getNumber(key: string, fallback: number): number {
    const val = this.settings.get(key);
    if (!val) return fallback;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
}
