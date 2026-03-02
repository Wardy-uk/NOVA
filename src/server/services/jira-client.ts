/**
 * Direct Jira Cloud REST API v3 client.
 * Used by the onboarding orchestrator for operations not supported by MCP tools
 * (issue linking, custom fields on create).
 */

export interface JiraClientConfig {
  baseUrl: string;   // e.g. https://yourorg.atlassian.net
  email: string;     // Jira account email
  apiToken: string;  // API token from id.atlassian.com
}

export interface JiraOAuthClientConfig {
  cloudId: string;       // Atlassian cloud ID
  accessToken: string;   // OAuth Bearer token
}

export class JiraApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public body: unknown,
    public retryable: boolean = false
  ) {
    const detail = body && typeof body === 'object'
      ? (body as any).errorMessages?.join('; ') || (body as any).message || JSON.stringify(body).slice(0, 200)
      : String(body).slice(0, 200);
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
  author: { displayName: string; emailAddress?: string };
  body: unknown;
  created: string;
  updated: string;
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

  constructor(config: JiraClientConfig | JiraOAuthClientConfig) {
    if ('cloudId' in config) {
      // OAuth 3LO — use Atlassian API gateway
      this.baseUrl = `https://api.atlassian.com/ex/jira/${config.cloudId}`;
      this.authHeader = `Bearer ${config.accessToken}`;
    } else {
      // Basic auth (email + API token)
      this.baseUrl = config.baseUrl.replace(/\/+$/, '');
      this.authHeader = 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries = 2
  ): Promise<T> {
    const url = `${this.baseUrl}/rest/api/3/${path}`;
    console.log(`[JiraClient] ${method} ${url}`);
    const opts: RequestInit = {
      method,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, { ...opts, redirect: 'manual' });

    // Redirect — Jira is sending us to a login page (auth failure)
    if (res.status >= 300 && res.status < 400) {
      throw new JiraApiError(res.status, 'Redirect', `Jira redirected to ${res.headers.get('location')} — check credentials`, false);
    }

    // Rate limit handling
    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
      console.warn(`[JiraClient] Rate limited, retrying in ${retryAfter}s...`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return this.request<T>(method, path, body, retries - 1);
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
      throw new JiraApiError(
        res.status,
        res.statusText,
        parsed,
        res.status === 429 || res.status >= 500
      );
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
      maxResults,
    };
    if (options?.nextPageToken) body.nextPageToken = options.nextPageToken;
    if (options?.expand?.length) body.expand = options.expand.join(',');
    return this.request<JiraSearchResult>('POST', 'search/jql', body);
  }

  async getIssue(issueKey: string, fields?: string[]): Promise<JiraIssue | null> {
    const fieldStr = (fields ?? ['summary', 'status', 'issuetype', 'issuelinks', 'priority', 'duedate']).join(',');
    return this.request<JiraIssue | null>('GET', `issue/${issueKey}?fields=${fieldStr}`);
  }

  async createIssue(payload: { fields: Record<string, unknown> }): Promise<JiraCreatedIssue> {
    return this.request<JiraCreatedIssue>('POST', 'issue', payload);
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

  /** Add a comment with optional visibility (internal notes for JSM) */
  async addComment(
    issueKey: string,
    bodyText: string,
    options?: { visibility?: { type: string; value: string } }
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
    return this.request<unknown>('POST', `issue/${issueKey}/comment`, payload);
  }

  /** Update fields on an existing issue */
  async updateFields(issueKey: string, fields: Record<string, unknown>): Promise<void> {
    await this.request<void>('PUT', `issue/${issueKey}`, { fields });
  }

  /** Transition an issue to a new status, optionally including fields and comment
   *  in the same request (required by transition validators). */
  async transitionIssue(
    issueKey: string,
    transitionId: string,
    options?: {
      fields?: Record<string, unknown>;
      comment?: { body: object; visibility?: { type: string; value: string } };
    }
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      transition: { id: transitionId },
    };
    if (options?.fields && Object.keys(options.fields).length > 0) {
      payload.fields = options.fields;
    }
    if (options?.comment) {
      payload.update = {
        comment: [{ add: options.comment }],
      };
    }
    await this.request<void>('POST', `issue/${issueKey}/transitions`, payload);
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

  /** Get comments for an issue, newest first */
  async getComments(issueKey: string, maxResults = 5): Promise<JiraComment[]> {
    const result = await this.request<JiraCommentPage>(
      'GET', `issue/${issueKey}/comment?orderBy=-created&maxResults=${maxResults}`
    );
    return result?.comments ?? [];
  }
}
