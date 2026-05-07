import type { JiraRestClient, JiraIssue, JiraComment } from './jira-client.js';
import type { JiraCacheQueries, CachedIssue, CachedComment } from './jira-cache-queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { QueuePerception, TicketEvent, CommentSnapshot } from './agent-types.js';
import { query, execute } from './database.js';

const DEFAULT_FIELDS = [
  'summary', 'description', 'status', 'priority', 'issuetype',
  'assignee', 'reporter', 'created', 'updated', 'customfield_10020', // request type
  'customfield_10010', // SLA
  'labels', 'resolution',
];

const KNOWN_AUTOMATION_NAMES = [
  'automation for jira',
  'jira automation',
  'n8n',
  'nova',
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
    reporterEmail: (f.reporter as any)?.emailAddress ?? null,
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
    reporterEmail: ci.reporter_email ?? null,
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
  private processedCommentIds = new Set<string>();
  private pendingCommentIds: string[] = [];
  private excludedAccountIds = new Set<string>();
  private knownAgentNames = new Set<string>();
  private excludedAccountsLoaded = false;
  private dbLoaded = false;
  private catchUpIssues: CachedIssue[] = [];

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries, cache?: JiraCacheQueries) {
    this.jiraClient = jiraClient;
    this.settings = settings;
    this.cache = cache ?? null;
  }

  async loadProcessedComments(): Promise<void> {
    if (this.dbLoaded) return;
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const rows = await query<{ comment_id: string }>(
        `SELECT comment_id FROM processed_comments WHERE processed_at >= ?`, [cutoff],
      );
      for (const r of rows) this.processedCommentIds.add(r.comment_id);
      this.dbLoaded = true;
      console.log(`[perceiver] Loaded ${rows.length} processed comment IDs from DB`);
    } catch (err) {
      console.warn('[perceiver] Failed to load processed comments from DB:', err instanceof Error ? err.message : err);
      this.dbLoaded = true;
    }
  }

  private async flushPendingComments(): Promise<void> {
    if (this.pendingCommentIds.length === 0) return;
    const batch = this.pendingCommentIds.splice(0);
    try {
      for (const id of batch) {
        await execute(
          `IF NOT EXISTS (SELECT 1 FROM processed_comments WHERE comment_id = ?)
           INSERT INTO processed_comments (comment_id) VALUES (?)`, [id, id],
        );
      }
    } catch (err) {
      console.warn('[perceiver] Failed to persist processed comments:', err instanceof Error ? err.message : err);
    }
    try {
      await execute(`DELETE FROM processed_comments WHERE processed_at < DATEADD(hour, -48, GETUTCDATE())`, []);
    } catch { /* best effort cleanup */ }
  }

  private loadExcludedAccounts(): void {
    if (this.excludedAccountsLoaded) return;
    this.excludedAccountsLoaded = true;
    const raw = this.settings.get('agent_comment_exclude_accounts') ?? '';
    for (const id of raw.split(',').map(s => s.trim()).filter(Boolean)) {
      this.excludedAccountIds.add(id);
    }
    // Load known agent names from setting (comma-separated display names)
    const names = this.settings.get('agent_known_agent_names') ?? '';
    for (const name of names.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
      this.knownAgentNames.add(name);
    }
    if (this.excludedAccountIds.size > 0 || this.knownAgentNames.size > 0) {
      console.log(`[perceiver] Loaded ${this.excludedAccountIds.size} excluded account IDs, ${this.knownAgentNames.size} known agent names`);
    }
  }

  private isInternalAuthor(comment: CachedComment): boolean {
    if (comment.author_email?.endsWith('@nurtur.tech')) return true;
    if (comment.author_account_id && this.excludedAccountIds.has(comment.author_account_id)) return true;
    const name = (comment.author_display ?? '').toLowerCase();
    if (KNOWN_AUTOMATION_NAMES.some(n => name.includes(n))) return true;
    if (this.knownAgentNames.has(name)) return true;
    return false;
  }

  private isInternalAuthorApi(comment: JiraComment, agentEmail: string): boolean {
    if (agentEmail && comment.author?.emailAddress === agentEmail) return true;
    const email = comment.author?.emailAddress ?? '';
    if (email.endsWith('@nurtur.tech')) return true;
    const accountId = comment.author?.accountId ?? '';
    if (accountId && this.excludedAccountIds.has(accountId)) return true;
    const name = (comment.author?.displayName ?? '').toLowerCase();
    if (KNOWN_AUTOMATION_NAMES.some(n => name.includes(n))) return true;
    if (this.knownAgentNames.has(name)) return true;
    return false;
  }

  private hasAgentRepliedAfter(allComments: CachedComment[], triggeringComment: CachedComment): boolean {
    const triggerTime = new Date(triggeringComment.jira_created).getTime();
    return allComments.some(c => {
      if (!c.is_public) return false;
      const commentTime = new Date(c.jira_created).getTime();
      if (commentTime <= triggerTime) return false;
      return this.isInternalAuthor(c);
    });
  }

  getLastOpenIssues(): JiraIssue[] {
    return this.lastOpenIssues;
  }

  queueCatchUpIssues(issues: CachedIssue[]): void {
    this.catchUpIssues.push(...issues);
    console.log(`[perceiver] ${issues.length} restart catch-up ticket(s) queued for next tick`);
  }

  private getProjects(): string[] {
    const raw = this.settings.get('agent_jira_project') || 'NT';
    return raw.split(',').map(p => p.trim()).filter(Boolean);
  }

  private buildProjectFilter(): string {
    const projects = this.getProjects();
    if (projects.length === 0) throw new Error('agent_jira_project not configured — cannot build JQL');
    if (projects.length === 1) return `project = ${projects[0]}`;
    return `project IN (${projects.join(', ')})`;
  }

  private trackComment(id: string): void {
    if (!this.processedCommentIds.has(id)) {
      this.processedCommentIds.add(id);
      this.pendingCommentIds.push(id);
    }
  }

  async perceive(): Promise<QueuePerception> {
    await this.loadProcessedComments();
    const result = this.cache
      ? await this.perceiveFromCache()
      : await this.perceiveFromApi();
    await this.flushPendingComments();
    return result;
  }

  private async perceiveFromCache(): Promise<QueuePerception> {
    this.loadExcludedAccounts();
    const projects = this.getProjects();
    const now = new Date();
    const rawSince = this.lastTickAt ?? new Date(now.getTime() - 60 * 60 * 1000);
    const since = new Date(rawSince.getTime() - 30_000);

    const [openIssues, newIssues, updatedIssues, untriagedIssues] = await Promise.all([
      this.cache!.getOpenIssues(projects),
      this.cache!.getRecentlyCreated(projects, since),
      this.cache!.getRecentlyUpdated(projects, since),
      this.cache!.getUntriagedIssues(projects, 10),
    ]);

    if (newIssues.length > 0 || untriagedIssues.length > 0) {
      console.log(`[perceiver] since=${since.toISOString()} | new=${newIssues.length} untriaged=${untriagedIssues.length}`);
    }

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

    const seenKeys = new Set<string>();
    const allNewCandidates = [...newIssues];
    for (const ci of newIssues) seenKeys.add(ci.issue_key);
    for (const ci of untriagedIssues) {
      if (!seenKeys.has(ci.issue_key)) {
        allNewCandidates.push(ci);
        seenKeys.add(ci.issue_key);
      }
    }
    if (this.catchUpIssues.length > 0) {
      const catchUp = this.catchUpIssues.splice(0);
      let added = 0;
      for (const ci of catchUp) {
        if (!seenKeys.has(ci.issue_key)) {
          allNewCandidates.push(ci);
          seenKeys.add(ci.issue_key);
          added++;
        }
      }
      if (added > 0) console.log(`[perceiver] Drained ${added} restart catch-up ticket(s)`);
    }
    const newEvents = allNewCandidates.map(ci => cachedToTicketEvent(ci, 'ticket_created'));

    const commentEvents: TicketEvent[] = [];
    const updatedCandidates = updatedIssues.filter(ci => !seenKeys.has(ci.issue_key));

    for (const ci of updatedCandidates.slice(0, 20)) {
      const recentComments = await this.cache!.getRecentComments(ci.issue_key, since);
      // Filter: public, not internal author, not assignee, not already processed
      const newCustomerComments = recentComments.filter(c => {
        if (!c.is_public) return false;
        if (this.isInternalAuthor(c)) return false;
        if (this.processedCommentIds.has(c.jira_comment_id)) return false;
        if (c.author_account_id && c.author_account_id === ci.assignee_account_id) return false;
        return true;
      });
      if (newCustomerComments.length === 0) continue;

      // Check if an agent already replied after the triggering comment
      const allComments = await this.cache!.getComments(ci.issue_key, 20);
      const latestCustomerComment = newCustomerComments[0]; // newest first from query
      if (this.hasAgentRepliedAfter(allComments, latestCustomerComment)) {
        for (const c of newCustomerComments) this.trackComment(c.jira_comment_id);
        console.log(`[perceiver] Skipping ${ci.issue_key} — agent already replied after customer comment`);
        continue;
      }

      // Mark all recent comments as processed to prevent duplicates
      for (const c of recentComments) this.trackComment(c.jira_comment_id);

      const event = cachedToTicketEvent(ci, 'comment_added');
      event.comments = allComments.slice(0, 5).map(cachedCommentToSnapshot);
      commentEvents.push(event);
    }

    // Prevent unbounded memory growth — trim oldest entries
    if (this.processedCommentIds.size > 5000) {
      const arr = [...this.processedCommentIds];
      this.processedCommentIds = new Set(arr.slice(arr.length - 3000));
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
    this.loadExcludedAccounts();
    const projectFilter = this.buildProjectFilter();
    const now = new Date();
    const rawSince = this.lastTickAt ?? new Date(now.getTime() - 60 * 60 * 1000);
    const since = new Date(rawSince.getTime() - 30_000);
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
        const comments = await this.jiraClient.getComments(issue.key, 20);
        const assigneeId = (issue.fields?.assignee as { accountId?: string } | undefined)?.accountId;
        const recentCustomer = comments.filter(c => {
          const isRecent = new Date(c.created).getTime() > since.getTime();
          const isPublic = c.jsdPublic !== false;
          if (!isRecent || !isPublic) return false;
          if (this.isInternalAuthorApi(c, agentEmail)) return false;
          if (this.processedCommentIds.has(c.id)) return false;
          if (assigneeId && c.author?.accountId === assigneeId) return false;
          return true;
        });
        if (recentCustomer.length === 0) continue;

        // Check if agent already replied after the latest customer comment
        const latestCustomerTime = new Date(recentCustomer[0].created).getTime();
        const agentRepliedAfter = comments.some(c => {
          if (c.jsdPublic === false) return false;
          const t = new Date(c.created).getTime();
          if (t <= latestCustomerTime) return false;
          return this.isInternalAuthorApi(c, agentEmail);
        });
        if (agentRepliedAfter) {
          for (const c of recentCustomer) this.trackComment(c.id);
          console.log(`[perceiver] Skipping ${issue.key} — agent already replied after customer comment`);
          continue;
        }

        for (const c of comments.filter(x => new Date(x.created).getTime() > since.getTime())) {
          this.trackComment(c.id);
        }

        const event = toTicketEvent(issue, 'comment_added');
        event.comments = comments.slice(0, 5).map(c => toCommentSnapshot(c));
        commentEvents.push(event);
      } catch (err) {
        console.warn(`[perceiver] Failed to check comments on ${issue.key}:`, err instanceof Error ? err.message : err);
      }
    }

    if (this.processedCommentIds.size > 5000) {
      const arr = [...this.processedCommentIds];
      this.processedCommentIds = new Set(arr.slice(arr.length - 3000));
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
