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
    super(`Jira API ${statusCode}: ${statusText}`);
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

    const res = await fetch(url, opts);

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

  async searchJql(jql: string, fields?: string[], maxResults = 50): Promise<JiraSearchResult> {
    return this.request<JiraSearchResult>('POST', 'search', {
      jql,
      fields: fields ?? ['summary', 'status', 'issuetype', 'issuelinks', 'priority', 'duedate'],
      maxResults,
    });
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

  /** Get issue link types available on the instance */
  async getLinkTypes(): Promise<{ issueLinkTypes: Array<{ id: string; name: string; inward: string; outward: string }> }> {
    return this.request<{ issueLinkTypes: Array<{ id: string; name: string; inward: string; outward: string }> }>(
      'GET', 'issueLinkType'
    );
  }
}
