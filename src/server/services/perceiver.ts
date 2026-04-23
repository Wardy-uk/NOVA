import type { JiraRestClient, JiraIssue, JiraComment } from './jira-client.js';
import type { JiraCacheQueries, CachedIssue, CachedComment } from './jira-cache-queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { QueuePerception, TicketEvent, CommentSnapshot } from './agent-types.js';

const DEFAULT_FIELDS = [
  'summary', 'description', 'status', 'priority', 'issuetype',
  'assignee', 'reporter', 'created', 'updated', 'customfield_10020', // request type
  'customfield_10010', // SLA
  'labels', 'resolution',
];

function toTicketEvent(issue: JiraIssue, eventType: TicketEvent['eventType']): TicketEvent {
  const f = issue.fields;
  return {
    ticketId: issue.id,
    ticketKey: issue.key,
    eventType,
    summary: (f.summary as string) ?? '',
    description: extractText(f.description),
    status: (f.status as any)?.name ?? 'Unknown',
    priority: (f.priority as any)?.name ?? 'Medium',
    requestType: (f.customfield_10020 as any)?.requestType?.name ?? '',
    assignee: (f.assignee as any)?.displayName ?? null,
    reporter: (f.reporter as any)?.displayName ?? null,
    organisation: (f.reporter as any)?.emailAddress?.split('@')[1] ?? null,
    created: (f.created as string) ?? '',
    updated: (f.updated as string) ?? '',
    slaBreachTime: extractSlaBreachTime(f.customfield_10010),
    fields: f,
  };
}

function cachedToTicketEvent(ci: CachedIssue, eventType: TicketEvent['eventType']): TicketEvent {
  return {
    ticketId: ci.jira_id,
    ticketKey: ci.issue_key,
    eventType,
    summary: ci.summary ?? '',
    description: ci.description_text ?? '',
    status: ci.status_name ?? 'Unknown',
    priority: ci.priority_name ?? 'Medium',
    requestType: ci.request_type ?? '',
    assignee: ci.assignee_display ?? null,
    reporter: ci.reporter_display ?? null,
    organisation: ci.reporter_email?.split('@')[1] ?? null,
    created: ci.jira_created?.toISOString() ?? '',
    updated: ci.jira_updated?.toISOString() ?? '',
    slaBreachTime: ci.sla_breach_time?.toISOString() ?? null,
    fields: ci.fields_json ? JSON.parse(ci.fields_json) : {},
  };
}

function cachedToJiraIssue(ci: CachedIssue): JiraIssue {
  const fields = ci.fields_json ? JSON.parse(ci.fields_json) : {};
  return {
    id: ci.jira_id,
    key: ci.issue_key,
    self: '',
    fields,
  };
}

function cachedCommentToSnapshot(c: CachedComment): CommentSnapshot {
  return {
    author: c.author_display ?? 'Unknown',
    body: c.body_text ?? '',
    created: c.jira_created?.toISOString() ?? '',
    isPublic: c.is_public,
  };
}

function extractText(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  if (typeof adf === 'string') return adf;
  try {
    const content = (adf as any).content;
    if (!Array.isArray(content)) return JSON.stringify(adf).slice(0, 500);
    return content
      .flatMap((node: any) => {
        if (node.type === 'paragraph' && Array.isArray(node.content)) {
          return node.content.map((c: any) => c.text ?? '').join('');
        }
        return node.text ?? '';
      })
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

function extractSlaBreachTime(slaField: unknown): string | null {
  if (!slaField || typeof slaField !== 'object') return null;
  try {
    const ongoing = (slaField as any)?.ongoingCycle;
    if (ongoing?.breachTime?.epochMillis) {
      return new Date(ongoing.breachTime.epochMillis).toISOString();
    }
  } catch { /* ignore */ }
  return null;
}

function toCommentSnapshot(c: JiraComment): CommentSnapshot {
  const isPublic = c.jsdPublic !== false;
  return {
    author: c.author?.displayName ?? 'Unknown',
    body: extractText(c.body),
    created: c.created,
    isPublic,
  };
}

export class Perceiver {
  private jiraClient: JiraRestClient;
  private cache: JiraCacheQueries | null;
  private settings: SettingsQueries;
  private lastTickAt: Date | null = null;
  private lastOpenIssues: JiraIssue[] = [];

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries, cache?: JiraCacheQueries) {
    this.jiraClient = jiraClient;
    this.settings = settings;
    this.cache = cache ?? null;
  }

  getLastOpenIssues(): JiraIssue[] {
    return this.lastOpenIssues;
  }

  private getProjects(): string[] {
    const raw = this.settings.get('agent_jira_project') ?? 'NT';
    return raw.split(',').map(p => p.trim()).filter(Boolean);
  }

  private buildProjectFilter(): string {
    const projects = this.getProjects();
    if (projects.length === 1) return `project = ${projects[0]}`;
    return `project IN (${projects.join(', ')})`;
  }

  async perceive(): Promise<QueuePerception> {
    if (this.cache) {
      return this.perceiveFromCache();
    }
    return this.perceiveFromApi();
  }

  private async perceiveFromCache(): Promise<QueuePerception> {
    const projects = this.getProjects();
    const now = new Date();
    const since = this.lastTickAt ?? new Date(now.getTime() - 60 * 60 * 1000);
    const agentEmail = this.settings.get('jira_ob_email') ?? '';

    const [openIssues, newIssues, updatedIssues] = await Promise.all([
      this.cache!.getOpenIssues(projects),
      this.cache!.getRecentlyCreated(projects, since),
      this.cache!.getRecentlyUpdated(projects, since),
    ]);

    const byStatus: Record<string, number> = {};
    const slaAtRisk: TicketEvent[] = [];
    const staleThresholdMs = 4 * 60 * 60 * 1000;

    for (const ci of openIssues) {
      const status = ci.status_name ?? 'Unknown';
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      if (ci.sla_breach_time) {
        const breachMs = new Date(ci.sla_breach_time).getTime() - now.getTime();
        if (breachMs > 0 && breachMs < 60 * 60 * 1000) {
          slaAtRisk.push(cachedToTicketEvent(ci, 'sla_warning'));
        }
      }
    }

    const staleTickets = openIssues
      .filter(ci => {
        const updated = ci.jira_updated ? new Date(ci.jira_updated).getTime() : 0;
        return now.getTime() - updated > staleThresholdMs;
      })
      .slice(0, 20)
      .map(ci => cachedToTicketEvent(ci, 'stale'));

    const newEvents = newIssues.map(ci => cachedToTicketEvent(ci, 'ticket_created'));

    // Detect new comments from cache
    const commentEvents: TicketEvent[] = [];
    const newKeys = new Set(newIssues.map(ci => ci.issue_key));
    const updatedCandidates = updatedIssues.filter(ci => !newKeys.has(ci.issue_key));

    for (const ci of updatedCandidates.slice(0, 20)) {
      const recentComments = await this.cache!.getRecentComments(ci.issue_key, since);
      const recentPublic = recentComments.filter(c => {
        const isPublic = c.is_public;
        const isAgent = agentEmail && c.author_email === agentEmail;
        return isPublic && !isAgent;
      });
      if (recentPublic.length > 0) {
        const allComments = await this.cache!.getComments(ci.issue_key, 5);
        const event = cachedToTicketEvent(ci, 'comment_added');
        event.comments = allComments.map(cachedCommentToSnapshot);
        commentEvents.push(event);
      }
    }

    this.lastTickAt = now;
    this.lastOpenIssues = openIssues.map(cachedToJiraIssue);

    return {
      timestamp: now.toISOString(),
      totalOpen: openIssues.length,
      byStatus,
      newEvents: [...newEvents, ...commentEvents],
      slaAtRisk,
      staleTickets,
    };
  }

  private async perceiveFromApi(): Promise<QueuePerception> {
    const projectFilter = this.buildProjectFilter();
    const now = new Date();
    const since = this.lastTickAt ?? new Date(now.getTime() - 60 * 60 * 1000);
    const agentEmail = this.settings.get('jira_ob_email') ?? '';

    const [openResult, newResult, updatedResult] = await Promise.all([
      this.jiraClient.searchJqlAll(
        `${projectFilter} AND statusCategory IN ("To Do", "In Progress") ORDER BY created DESC`,
        DEFAULT_FIELDS, 1000,
      ),
      this.jiraClient.searchJqlAll(
        `${projectFilter} AND created >= "${formatJqlDate(since)}" ORDER BY created DESC`,
        DEFAULT_FIELDS, 50,
      ),
      this.jiraClient.searchJqlAll(
        `${projectFilter} AND statusCategory IN ("To Do", "In Progress") AND updated >= "${formatJqlDate(since)}" AND created < "${formatJqlDate(since)}" ORDER BY updated DESC`,
        DEFAULT_FIELDS, 100,
      ),
    ]);

    const byStatus: Record<string, number> = {};
    const slaAtRisk: TicketEvent[] = [];
    const staleThresholdMs = 4 * 60 * 60 * 1000;

    for (const issue of openResult.issues) {
      const status = (issue.fields.status as any)?.name ?? 'Unknown';
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      const slaBreachTime = extractSlaBreachTime(issue.fields.customfield_10010);
      if (slaBreachTime) {
        const breachMs = new Date(slaBreachTime).getTime() - now.getTime();
        if (breachMs > 0 && breachMs < 60 * 60 * 1000) {
          slaAtRisk.push(toTicketEvent(issue, 'sla_warning'));
        }
      }
    }

    const staleTickets = openResult.issues
      .filter(issue => {
        const updated = new Date((issue.fields.updated as string) ?? '');
        return now.getTime() - updated.getTime() > staleThresholdMs;
      })
      .slice(0, 20)
      .map(issue => toTicketEvent(issue, 'stale'));

    const newEvents = newResult.issues.map(issue => toTicketEvent(issue, 'ticket_created'));

    const commentEvents: TicketEvent[] = [];
    const newKeys = new Set(newResult.issues.map(i => i.key));
    const updatedCandidates = updatedResult.issues.filter(i => !newKeys.has(i.key));

    for (const issue of updatedCandidates.slice(0, 20)) {
      try {
        const comments = await this.jiraClient.getComments(issue.key, 5);
        const recentPublic = comments.filter(c => {
          const isRecent = new Date(c.created).getTime() > since.getTime();
          const isPublic = c.jsdPublic !== false;
          const isAgent = agentEmail && c.author?.emailAddress === agentEmail;
          return isRecent && isPublic && !isAgent;
        });
        if (recentPublic.length > 0) {
          const event = toTicketEvent(issue, 'comment_added');
          event.comments = comments.map(c => toCommentSnapshot(c));
          commentEvents.push(event);
        }
      } catch (err) {
        console.warn(`[perceiver] Failed to check comments on ${issue.key}:`, err instanceof Error ? err.message : err);
      }
    }

    this.lastTickAt = now;
    this.lastOpenIssues = openResult.issues;

    return {
      timestamp: now.toISOString(),
      totalOpen: openResult.issues.length,
      byStatus,
      newEvents: [...newEvents, ...commentEvents],
      slaAtRisk,
      staleTickets,
    };
  }

  resetLastTick(): void {
    this.lastTickAt = null;
  }
}

function formatJqlDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}
