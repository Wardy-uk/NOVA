import type { JiraRestClient, JiraIssue, JiraComment } from './jira-client.js';
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
  private settings: SettingsQueries;
  private lastTickAt: Date | null = null;
  private lastOpenIssues: JiraIssue[] = [];

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries) {
    this.jiraClient = jiraClient;
    this.settings = settings;
  }

  getLastOpenIssues(): JiraIssue[] {
    return this.lastOpenIssues;
  }

  private buildProjectFilter(): string {
    const raw = this.settings.get('agent_jira_project') ?? 'NT';
    const projects = raw.split(',').map(p => p.trim()).filter(Boolean);
    if (projects.length === 1) return `project = ${projects[0]}`;
    return `project IN (${projects.join(', ')})`;
  }

  async perceive(): Promise<QueuePerception> {
    const projectFilter = this.buildProjectFilter();
    const now = new Date();
    const since = this.lastTickAt ?? new Date(now.getTime() - 5 * 60 * 1000);

    const agentEmail = this.settings.get('jira_ob_email') ?? '';

    const [openResult, newResult, updatedResult] = await Promise.all([
      this.jiraClient.searchJqlAll(
        `${projectFilter} AND resolution = EMPTY ORDER BY created DESC`,
        DEFAULT_FIELDS,
        200,
      ),
      this.jiraClient.searchJqlAll(
        `${projectFilter} AND created >= "${formatJqlDate(since)}" ORDER BY created DESC`,
        DEFAULT_FIELDS,
        50,
      ),
      this.jiraClient.searchJqlAll(
        `${projectFilter} AND resolution = EMPTY AND updated >= "${formatJqlDate(since)}" AND created < "${formatJqlDate(since)}" ORDER BY updated DESC`,
        DEFAULT_FIELDS,
        50,
      ),
    ]);

    const byStatus: Record<string, number> = {};
    const slaAtRisk: TicketEvent[] = [];
    const staleThresholdMs = 4 * 60 * 60 * 1000; // 4 hours

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

    // Detect new comments on existing tickets
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
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}
