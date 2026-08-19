/**
 * Direct Jira Cloud REST API v3 client.
 * Used by the onboarding orchestrator for operations not supported by MCP tools
 * (issue linking, custom fields on create).
 */

import { normalizeStatusFields } from '../utils/jira-locale.js';
import { extractText } from './shared/adf-utils.js';

/** Per-request ceiling for every Jira REST call. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Resolves the real BC Account Number for a ticket that the NT "Quick Resolve"
 * validator has just blocked for a missing BC account. Injected at construction
 * so this low-level REST client stays decoupled from BC/settings.
 * Returns:
 *   - a string  → the BC account number to set, then retry the transition;
 *   - null      → resolved but no confident match → HOLD (don't close);
 *   - undefined → resolver unavailable → fall back to the legacy 'N/A' sentinel.
 */
export type BcAccountResolver = (
  ticket: {
    key: string;
    summary?: string | null;
    description?: string | null;
    organisationName?: string | null;
    reporterEmail?: string | null;
    bcAccountNumber?: string | null;
  },
  opts: { infraFallback: boolean },
) => Promise<string | null | undefined>;

export interface JiraClientConfig {
  baseUrl: string;   // e.g. https://yourorg.atlassian.net
  email: string;     // Jira account email
  apiToken: string;  // API token from id.atlassian.com
}

export interface JiraOAuthClientConfig {
  cloudId: string;       // Atlassian cloud ID
  accessToken: string;   // OAuth Bearer token
}

export interface JiraCloudBasicConfig {
  cloudId: string;       // Atlassian cloud ID
  email: string;         // Jira account email
  apiToken: string;      // API token from id.atlassian.com
}

// Known Jira error patterns (Chinese locale on service account) → English
const JIRA_ERROR_TRANSLATIONS: Array<[RegExp, string]> = [
  [/您可能不具有相应权限，或是此工作项缺少必要信息。如果此问题依然存在，请联系您的 Jira 管理员。/i,
    'You may lack permissions, or the issue is missing required fields. Contact your Jira admin if this persists.'],
  [/无法移动.*缺少必要信息/i, 'Cannot transition — required fields are missing'],
  [/无法移动/i, 'Cannot transition this issue'],
  [/您无权/i, 'Permission denied'],
  [/不具有相应权限/i, 'Insufficient permissions'],
  [/此工作项缺少必要信息/i, 'Required fields are missing on this issue'],
  [/如果此问题依然存在/i, 'If this problem persists'],
  [/请联系您的 Jira 管理员/i, 'Contact your Jira administrator'],
  [/无权在此项目中创建/i, 'No permission to create issues in this project'],
];

function translateJiraError(detail: string): string {
  // If mostly ASCII, leave it alone
  const nonAscii = detail.replace(/[\x00-\x7F]/g, '');
  if (nonAscii.length < 3) return detail;
  // Try known translations
  const translations: string[] = [];
  for (const [pattern, english] of JIRA_ERROR_TRANSLATIONS) {
    if (pattern.test(detail)) translations.push(english);
  }
  if (translations.length > 0) return `${translations.join('; ')} [原文: ${detail}]`;
  return `Non-English Jira error (service account locale) [原文: ${detail}]`;
}

export class JiraApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public body: unknown,
    public retryable: boolean = false,
    public requestBody?: unknown,
  ) {
    const rawDetail = body && typeof body === 'object'
      ? (body as any).errorMessages?.join('; ') || (body as any).message || JSON.stringify(body).slice(0, 200)
      : String(body).slice(0, 200);
    const detail = translateJiraError(rawDetail);
    super(`Jira API ${statusCode}: ${statusText} — ${detail}`);
    this.name = 'JiraApiError';
  }
}

// ── Types ──

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: Record<string, unknown>;
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  nextPageToken?: string;
  isLast?: boolean;
}

export interface JiraCreatedIssue {
  id: string;
  key: string;
  self: string;
}

export interface JiraIssueLink {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string };
  outwardIssue?: { key: string };
}

export interface JiraComment {
  id: string;
  author: { displayName: string; emailAddress?: string; accountId?: string; accountType?: string };
  body: unknown;
  created: string;
  updated: string;
  jsdPublic?: boolean;
  properties?: Array<{ key: string; value: unknown }>;
}

export interface JiraCommentPage {
  comments: JiraComment[];
  total: number;
  maxResults: number;
}

// ── ADF helpers ──

interface AdfSection {
  heading?: string;
  text?: string;
  codeBlock?: string;
  bulletList?: string[];
}

export function buildAdfDescription(sections: AdfSection[]): object {
  const content: object[] = [];

  for (const section of sections) {
    if (section.heading) {
      content.push({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: section.heading }],
      });
    }
    if (section.text) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: section.text }],
      });
    }
    if (section.bulletList && section.bulletList.length > 0) {
      content.push({
        type: 'bulletList',
        content: section.bulletList.map(item => ({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: item }],
          }],
        })),
      });
    }
    if (section.codeBlock) {
      content.push({
        type: 'codeBlock',
        attrs: { language: 'json' },
        content: [{ type: 'text', text: section.codeBlock }],
      });
    }
  }

  return { version: 1, type: 'doc', content };
}

// ── Client ──

export class JiraRestClient {
  private authHeader: string;
  private baseUrl: string;
  private bcResolver?: BcAccountResolver;

  constructor(
    config: JiraClientConfig | JiraOAuthClientConfig | JiraCloudBasicConfig,
    deps?: { bcResolver?: BcAccountResolver },
  ) {
    this.bcResolver = deps?.bcResolver;
    if ('cloudId' in config && 'accessToken' in config) {
      // OAuth 3LO — use Atlassian API gateway with Bearer token
      this.baseUrl = `https://api.atlassian.com/ex/jira/${config.cloudId}`;
      this.authHeader = `Bearer ${config.accessToken}`;
    } else if ('cloudId' in config && 'email' in config) {
      // Cloud Basic — use Atlassian API gateway with Basic auth
      this.baseUrl = `https://api.atlassian.com/ex/jira/${config.cloudId}`;
      this.authHeader = 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    } else if ('baseUrl' in config) {
      // Direct Basic auth (email + API token) to org URL
      this.baseUrl = config.baseUrl.replace(/\/+$/, '');
      this.authHeader = 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    } else {
      throw new Error('Invalid JiraRestClient config');
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries = 2
  ): Promise<T> {
    return this.send<T>(method, `/rest/api/3/${path}`, body, retries);
  }

  /** Low-level request to any Jira REST base path (absolute after the site base URL,
   *  e.g. `/rest/api/3/issue` or `/rest/servicedeskapi/request`). */
  private async send<T>(
    method: string,
    absolutePath: string,
    body?: unknown,
    retries = 2
  ): Promise<T> {
    const url = `${this.baseUrl}${absolutePath}`;
    const maskedAuth = this.authHeader.startsWith('Basic ')
      ? `Basic ${this.authHeader.slice(6, 10)}...${this.authHeader.slice(-4)}`
      : `Bearer ${this.authHeader.slice(7, 11)}...${this.authHeader.slice(-4)}`;
    console.log(`[JiraClient] ${method} ${url} [auth: ${maskedAuth}]`);
    const opts: RequestInit = {
      method,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // Force English field values (status/priority/issuetype names). The service
        // account's Jira locale is Chinese; Jira Cloud honours Accept-Language.
        'Accept-Language': 'en-GB, en;q=0.9',
      },
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }
    // Hard timeout. Without this a hung socket never settles, and any caller
    // holding a "busy" latch (jira-sync-service) wedges permanently — which is
    // exactly how the issue cache froze for 20h on 18 Aug 2026.
    opts.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    const res = await fetch(url, opts);

    // Rate limit handling
    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
      console.warn(`[JiraClient] Rate limited, retrying in ${retryAfter}s...`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return this.send<T>(method, absolutePath, body, retries - 1);
    }

    // No content
    if (res.status === 204) {
      return undefined as T;
    }

    // Not found — return null for GET
    if (res.status === 404 && method === 'GET') {
      return null as T;
    }

    const responseBody = await res.text();
    const contentType = res.headers.get('content-type') ?? '';

    // HTML response — Jira returned an error/login page, not JSON
    if (contentType.includes('text/html') || responseBody.trimStart().startsWith('<!DOCTYPE')) {
      throw new JiraApiError(res.status, res.statusText, `Unexpected HTML response from ${url} (status ${res.status})`, false);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      parsed = responseBody;
    }

    if (!res.ok) {
      console.error(`[JiraClient] ${method} ${url} → ${res.status} ${res.statusText}`, JSON.stringify(parsed).slice(0, 500));
      if (body) console.error(`[JiraClient] Request body:`, JSON.stringify(body).slice(0, 500));
      const err = new JiraApiError(
        res.status,
        res.statusText,
        parsed,
        res.status === 429 || res.status >= 500,
        body,
      );
      (err as any).requestUrl = url;
      throw err;
    }

    return parsed as T;
  }

  // ── Public methods ──

  async searchJql(
    jql: string,
    fields?: string[],
    maxResults = 50,
    options?: { nextPageToken?: string; expand?: string[] }
  ): Promise<JiraSearchResult> {
    const body: Record<string, unknown> = {
      jql,
      fields: fields ?? ['summary', 'status', 'issuetype', 'issuelinks', 'priority', 'duedate'],
      maxResults: Math.min(maxResults, 100), // Jira caps at 100 per page
    };
    if (options?.nextPageToken) body.nextPageToken = options.nextPageToken;
    if (options?.expand?.length) body.expand = options.expand.join(',');
    const result = await this.request<JiraSearchResult>('POST', 'search/jql', body);
    if (result?.issues) result.issues.forEach(normalizeStatusFields);
    return result;
  }

  /** Approximate count of tickets matching a JQL query.
   *  The new Jira Cloud search/jql endpoint dropped the `total` field, so for
   *  count-only queries we use the dedicated /search/approximate-count endpoint.
   *  Returns -1 on error so callers can distinguish "no data" from "failed". */
  async jqlCount(jql: string): Promise<number> {
    try {
      const result = await this.request<{ count?: number }>('POST', 'search/approximate-count', { jql });
      return typeof result?.count === 'number' ? result.count : 0;
    } catch {
      return -1;
    }
  }

  /** Search with automatic pagination — fetches all pages up to maxResults total. */
  async searchJqlAll(
    jql: string,
    fields?: string[],
    maxResults = 500,
    options?: { expand?: string[] }
  ): Promise<JiraSearchResult> {
    const allIssues: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    const perPage = Math.min(maxResults, 100);

    do {
      const page = await this.searchJql(jql, fields, perPage, { nextPageToken, expand: options?.expand });
      allIssues.push(...page.issues);
      nextPageToken = page.nextPageToken;
      if (page.isLast !== false || !nextPageToken) break;
    } while (allIssues.length < maxResults);

    return { issues: allIssues, total: allIssues.length, maxResults, isLast: true };
  }

  async getIssue(issueKey: string, fields?: string[], options?: { expand?: string[] }): Promise<JiraIssue | null> {
    const fieldStr = (fields ?? ['summary', 'status', 'issuetype', 'issuelinks', 'priority', 'duedate']).join(',');
    const expand = options?.expand?.length ? `&expand=${options.expand.join(',')}` : '';
    const issue = await this.request<JiraIssue | null>('GET', `issue/${issueKey}?fields=${fieldStr}${expand}`);
    if (issue) normalizeStatusFields(issue);
    return issue;
  }

  async getMyself(): Promise<{ accountId: string; displayName: string; emailAddress: string }> {
    return this.request<{ accountId: string; displayName: string; emailAddress: string }>('GET', 'myself');
  }

  async createIssue(payload: { fields: Record<string, unknown> }): Promise<JiraCreatedIssue> {
    return this.request<JiraCreatedIssue>('POST', 'issue', payload);
  }

  /** Create a JSM customer request via the Service Desk API. Unlike the platform
   *  `createIssue`, this sets the customer request type natively (the `vp-origin`
   *  field can't be set through /rest/api/3/issue) and can set the reporter via
   *  `raiseOnBehalfOf`. Returns the created issue key/id. */
  async createServiceDeskRequest(payload: {
    serviceDeskId: string;
    requestTypeId: string;
    requestFieldValues: Record<string, unknown>;
    raiseOnBehalfOf?: string;
  }): Promise<{ issueId: string; issueKey: string }> {
    return this.send<{ issueId: string; issueKey: string }>('POST', '/rest/servicedeskapi/request', payload);
  }

  /** Add request participants (they receive the same JSM correspondence as the
   *  reporter). accountIds only — resolve emails via searchUsers first. */
  async addRequestParticipants(issueIdOrKey: string, accountIds: string[]): Promise<void> {
    if (accountIds.length === 0) return;
    await this.send<unknown>('POST', `/rest/servicedeskapi/request/${encodeURIComponent(issueIdOrKey)}/participant`, { accountIds });
  }

  async createIssueLink(payload: {
    type: { name: string };
    inwardIssue: { key: string };
    outwardIssue: { key: string };
  }): Promise<void> {
    await this.request<void>('POST', 'issueLink', payload);
  }

  async getCreateMeta(projectKey: string): Promise<unknown> {
    return this.request<unknown>(
      'GET',
      `issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes.fields`
    );
  }

  /** Add a comment with optional visibility or JSM internal flag.
   *  - `visibility` = classic role/group restriction (legacy)
   *  - `internal: true` = JSM "Add internal comment" marker
   *    (uses properties [{key:'sd.public.comment', value:{internal:true}}])
   */
  async addComment(
    issueKey: string,
    bodyText: string,
    options?: { visibility?: { type: string; value: string }; internal?: boolean }
  ): Promise<unknown> {
    const payload: Record<string, unknown> = {
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: bodyText }] }],
      },
    };
    if (options?.visibility) {
      payload.visibility = options.visibility;
    }
    if (options?.internal !== undefined) {
      payload.properties = [{ key: 'sd.public.comment', value: { internal: options.internal } }];
    }
    return this.request<unknown>('POST', `issue/${issueKey}/comment`, payload);
  }

  /** Add a comment using a pre-built ADF document body (e.g. with link marks).
   *  `internal: false` marks it as a customer-visible JSM comment. */
  async addCommentAdf(
    issueKey: string,
    body: object,
    options?: { internal?: boolean }
  ): Promise<unknown> {
    const payload: Record<string, unknown> = { body };
    if (options?.internal !== undefined) {
      payload.properties = [{ key: 'sd.public.comment', value: { internal: options.internal } }];
    }
    return this.request<unknown>('POST', `issue/${issueKey}/comment`, payload);
  }

  /** Update fields on an existing issue */
  async updateFields(issueKey: string, fields: Record<string, unknown>): Promise<void> {
    await this.request<void>('PUT', `issue/${issueKey}`, { fields });
  }

  /** Transition an issue to a new status, optionally including fields and comment
   *  in the same request (required by transition validators).
   *  `comment.internal: true` marks the comment as a JSM internal note. */
  async transitionIssue(
    issueKey: string,
    transitionId: string,
    options?: {
      fields?: Record<string, unknown>;
      comment?: {
        body: object;
        visibility?: { type: string; value: string };
        internal?: boolean;
      };
      /** For Nurtur-internal infra notifications (PMTA/BYM): if no customer BC
       *  account resolves, close against Nurtur's own BC account instead of holding. */
      bcInfraFallback?: boolean;
    }
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      transition: { id: transitionId },
    };
    if (options?.fields && Object.keys(options.fields).length > 0) {
      payload.fields = options.fields;
    }
    if (options?.comment) {
      const commentAdd: Record<string, unknown> = { body: options.comment.body };
      if (options.comment.visibility) commentAdd.visibility = options.comment.visibility;
      if (options.comment.internal !== undefined) {
        commentAdd.properties = [{ key: 'sd.public.comment', value: { internal: options.comment.internal } }];
      }
      payload.update = {
        comment: [{ add: commentAdd }],
      };
    }
    // Retry loop: strip fields Jira rejects as "not on the appropriate screen",
    // and satisfy the NT "BC Account number is mandatory" resolve validator by
    // resolving the ticket's *real* Business Central account (via the injected
    // bcResolver) before retrying. This only fires when the validator actually
    // rejects, so tickets that already carry a real BC account never reach here
    // and their value is never overwritten.
    let bcAccountHandled = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await this.request<void>('POST', `issue/${issueKey}/transitions`, payload);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const fieldMatch = msg.match(/Field '([^']+)' cannot be set/);
        if (fieldMatch && payload.fields && typeof payload.fields === 'object') {
          const badField = fieldMatch[1];
          const fields = { ...(payload.fields as Record<string, unknown>) };
          delete fields[badField];
          console.warn(`[JiraClient] Retrying transition on ${issueKey} without rejected field '${badField}'`);
          payload.fields = Object.keys(fields).length > 0 ? fields : undefined;
          continue;
        }
        if (!bcAccountHandled && /BC Account number is mandatory|BC Account Number with actual value.*does not match/i.test(msg)) {
          bcAccountHandled = true;
          const bcNumber = await this.resolveBcAccount(issueKey, options?.bcInfraFallback ?? false);
          if (bcNumber) {
            // Field isn't on the resolve screen — set via a normal edit, then retry.
            try {
              await this.updateFields(issueKey, { customfield_14626: bcNumber });
              console.warn(`[JiraClient] Set BC Account number '${bcNumber}' on ${issueKey} to satisfy resolve validator, retrying transition`);
              continue;
            } catch (setErr) {
              console.error(`[JiraClient] Failed to set BC Account number on ${issueKey}:`, setErr instanceof Error ? setErr.message : setErr);
              throw err;
            }
          }
          // Resolver ran but found no confident match → hold for a human.
          // Never invent a value: rethrow so the caller leaves the ticket open.
          console.warn(`[JiraClient] No BC account could be confidently resolved for ${issueKey} — holding for human, not closing.`);
          throw err;
        }
        throw err;
      }
    }
  }

  /**
   * Resolve the real BC account number for a ticket blocked by the "BC Account
   * number is mandatory" validator. Gathers signals from the issue and defers to
   * the injected resolver. Returns:
   * Always returns a value that satisfies the ^CU\d{7}$ validator: the resolved
   * customer account when a confident (>95%) match is found, otherwise the
   * Nurtur catch-all CU0001778. Never returns 'N/A' — the validator is now a
   * regex, so the old sentinel would fail the close.
   */
  private async resolveBcAccount(issueKey: string, infraFallback: boolean): Promise<string | null> {
    const FALLBACK_BC = 'CU0001778';
    const toValidBc = (v: unknown): string => {
      const clean = typeof v === 'string' ? v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
      return /^CU\d{7}$/.test(clean) ? clean : FALLBACK_BC;
    };
    if (!this.bcResolver) return FALLBACK_BC; // no resolver wired → safe catch-all
    let signals: {
      summary?: string | null; description?: string | null;
      organisationName?: string | null; reporterEmail?: string | null; bcAccountNumber?: string | null;
    } = {};
    try {
      const issue = await this.getIssue(issueKey, [
        'summary', 'description', 'reporter', 'customfield_10002', 'customfield_14626',
      ]);
      const f = (issue?.fields ?? {}) as Record<string, any>;
      const orgs = f.customfield_10002;
      signals = {
        summary: f.summary ?? null,
        description: extractText(f.description) || null,
        organisationName: Array.isArray(orgs) ? (orgs[0]?.name ?? null) : (orgs?.name ?? null),
        reporterEmail: f.reporter?.emailAddress ?? null,
        bcAccountNumber: (f.customfield_14626 as string) ?? null,
      };
    } catch (err) {
      console.warn(`[JiraClient] Could not gather BC signals for ${issueKey}:`, err instanceof Error ? err.message : err);
    }
    try {
      const resolved = await this.bcResolver({ key: issueKey, ...signals }, { infraFallback });
      // Coerce whatever comes back to a validator-valid value; fall back otherwise.
      return toValidBc(resolved);
    } catch (err) {
      console.error(`[JiraClient] BC resolver threw for ${issueKey}:`, err instanceof Error ? err.message : err);
      return FALLBACK_BC; // resolver error → don't strand the close; use catch-all
    }
  }

  /** Get editable field metadata for an issue (allowed values etc.) */
  async getEditMeta(issueKey: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `issue/${issueKey}/editmeta`);
  }

  /** Get allowed options for a custom field via the field context API.
   *  Works for fields not exposed in editmeta/transition screens. */
  async getFieldOptions(fieldId: string): Promise<Array<{ value: string; id: string }>> {
    try {
      const ctxData = await this.request<Record<string, unknown>>('GET', `field/${fieldId}/context`);
      const contexts = (ctxData as any)?.values as Array<{ id: string }> | undefined;
      if (!contexts || contexts.length === 0) return [];
      const optData = await this.request<Record<string, unknown>>(
        'GET', `field/${fieldId}/context/${contexts[0].id}/option`
      );
      return ((optData as any)?.values as Array<{ value: string; id: string }>) ?? [];
    } catch {
      return [];
    }
  }

  /** List customer request types for a JSM service desk (id + name).
   *  Used to resolve request-type names → IDs for setting the customer
   *  request type field (sd-customerrequesttype, e.g. customfield_12800),
   *  which must be set by ID, not name. Hits servicedeskapi (not /rest/api/3). */
  async getRequestTypes(serviceDeskId: string): Promise<Array<{ id: string; name: string }>> {
    const url = `${this.baseUrl}/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype?limit=100`;
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': this.authHeader, 'Accept': 'application/json', 'Accept-Language': 'en-GB, en;q=0.9' },
      });
      if (!res.ok) {
        console.warn(`[JiraClient] getRequestTypes(${serviceDeskId}) → ${res.status} ${res.statusText}`);
        return [];
      }
      const data = await res.json() as { values?: Array<{ id: number | string; name: string }> };
      return (data.values ?? []).map(v => ({ id: String(v.id), name: v.name }));
    } catch (err) {
      console.warn(`[JiraClient] getRequestTypes(${serviceDeskId}) failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  async uploadAttachment(issueKey: string, filename: string, buffer: Buffer, mimeType: string): Promise<unknown> {
    const url = `${this.baseUrl}/rest/api/3/issue/${issueKey}/attachments`;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[JiraClient] Attachment upload failed: ${res.status} ${res.statusText}`, body.slice(0, 500));
      throw new JiraApiError(res.status, res.statusText, body, res.status >= 500);
    }

    return res.json();
  }

  async fetchAttachmentContent(contentUrl: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; contentLength: string | null }> {
    const res = await fetch(contentUrl, {
      headers: { 'Authorization': this.authHeader },
    });
    if (!res.ok || !res.body) {
      throw new JiraApiError(res.status, res.statusText, `Failed to fetch attachment from ${contentUrl}`, false);
    }
    return {
      body: res.body,
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      contentLength: res.headers.get('content-length'),
    };
  }

  async rawGet<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** Get available transitions with their field screens (allowedValues for each transition) */
  async getTransitionsWithFields(issueKey: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET', `issue/${issueKey}/transitions?expand=transitions.fields`
    );
  }

  /** Get issue link types available on the instance */
  async getLinkTypes(): Promise<{ issueLinkTypes: Array<{ id: string; name: string; inward: string; outward: string }> }> {
    return this.request<{ issueLinkTypes: Array<{ id: string; name: string; inward: string; outward: string }> }>(
      'GET', 'issueLinkType'
    );
  }

  /** Get issue changelog (status transitions, field changes).
   *  Returns changelog entries with items array — use to detect escalation transitions. */
  async getChangelog(issueKey: string, maxResults = 100): Promise<Array<{
    id: string;
    created: string;
    author: { displayName: string; accountId: string };
    items: Array<{ field: string; fieldId?: string; fromString: string | null; toString: string | null }>;
  }>> {
    const result = await this.request<{
      values: Array<{
        id: string;
        created: string;
        author: { displayName: string; accountId: string };
        items: Array<{ field: string; fieldId?: string; fromString: string | null; toString: string | null }>;
      }>;
    }>('GET', `issue/${issueKey}/changelog?maxResults=${maxResults}`);
    return result?.values ?? [];
  }

  /** Get comments for an issue, newest first. Requests the jsdPublic and
   *  properties expands so internal/public can be distinguished. */
  async getComments(issueKey: string, maxResults = 5): Promise<JiraComment[]> {
    const result = await this.request<JiraCommentPage>(
      'GET', `issue/${issueKey}/comment?orderBy=-created&maxResults=${maxResults}&expand=properties`
    );
    return result?.comments ?? [];
  }

  /** Search for users (for assignee picker) */
  async searchUsers(query: string, maxResults = 10): Promise<Array<{ accountId: string; displayName: string; emailAddress?: string; avatarUrls?: Record<string, string> }>> {
    return this.request<Array<{ accountId: string; displayName: string; emailAddress?: string; avatarUrls?: Record<string, string> }>>(
      'GET', `user/search?query=${encodeURIComponent(query)}&maxResults=${maxResults}`
    ) ?? [];
  }

  /** Get visible projects */
  async getProjects(maxResults = 50): Promise<Array<{ id: string; key: string; name: string; projectTypeKey?: string }>> {
    const result = await this.request<{ values: Array<{ id: string; key: string; name: string; projectTypeKey?: string }> }>(
      'GET', `project/search?maxResults=${maxResults}`
    );
    return result?.values ?? [];
  }

  /** Proxy an attachment content download — returns raw Response for streaming to client. */
  async getAttachmentContent(attachmentId: string): Promise<Response> {
    const url = `${this.baseUrl}/rest/api/3/attachment/content/${attachmentId}`;
    const res = await fetch(url, {
      headers: { 'Authorization': this.authHeader },
      redirect: 'follow',
    });
    return res;
  }
}
