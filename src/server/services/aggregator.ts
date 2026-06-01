import type { McpClientManager } from './mcp-client.js';
import type { TaskQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { JiraRestClient, type JiraIssue } from './jira-client.js';

interface NormalizedTask {
  source: string;
  source_id: string;
  source_url?: string;
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  due_date?: string;
  sla_breach_at?: string;
  category?: string;
  raw_data?: unknown;
  transient?: boolean;
}

// Sources whose data should not persist across server restarts
const TRANSIENT_SOURCES = new Set<string>();

interface FetchResult {
  tasks: NormalizedTask[];
  ok: boolean;
}

export interface SyncContext {
  /** Per-user Jira REST client — built from user's personal credentials */
  jiraClient?: JiraRestClient | null;
  jiraBaseUrl?: string;
}

interface SourceAdapter {
  source: string;
  serverName: string;
  fetch(mcp: McpClientManager, ctx?: SyncContext): Promise<FetchResult>;
}

let lastJiraSearchText: string | null = null;

export function getLastJiraSearchText(): string | null {
  return lastJiraSearchText;
}

// ---------- Jira Adapter (Direct REST — per-user) ----------
function createJiraAdapter(): SourceAdapter {
  return {
    source: 'jira',
    serverName: 'jira',

    async fetch(_mcp: McpClientManager, ctx?: SyncContext): Promise<FetchResult> {
      const client = ctx?.jiraClient;
      if (!client) return { tasks: [], ok: false };

      try {
        const FIELDS = ['summary', 'status', 'priority', 'description', 'assignee',
          'created', 'duedate', 'customfield_12981', 'customfield_14081',
          'customfield_14185', 'customfield_14048', 'customfield_13183',
          'customfield_14527', 'customfield_13184'];
        const result = await client.searchJql(
          'assignee = currentUser() AND status NOT IN (Done, Closed, Resolved) ORDER BY priority DESC, updated DESC',
          FIELDS,
          50
        );
        const tasks = (result.issues ?? []).map(issue => {
          const flat: Record<string, unknown> = { key: issue.key, id: issue.id, self: issue.self, ...issue.fields };
          return mapJiraIssue(flat, ctx?.jiraBaseUrl);
        });
        console.log(`[JiraAdapter] REST: fetched ${tasks.length} tasks for currentUser`);
        return { tasks, ok: true };
      } catch (err) {
        console.error(`[JiraAdapter] REST search failed:`, err instanceof Error ? err.message : err);
        return { tasks: [], ok: false };
      }
    },
  };
}

function mapJiraIssue(issue: Record<string, unknown>, jiraBaseUrl?: string): NormalizedTask {
  // Status and priority can be objects with a 'name' field or plain strings.
  // Jira may return localized names (e.g. Chinese) — prefer statusCategory fallback.
  const statusRaw = issue.status;
  let statusStr: string | undefined;
  if (typeof statusRaw === 'string') {
    statusStr = statusRaw;
  } else if (statusRaw && typeof statusRaw === 'object') {
    const s = statusRaw as Record<string, unknown>;
    const name = typeof s.name === 'string' ? s.name : undefined;
    if (name && /^[\x20-\x7E]+$/.test(name)) {
      statusStr = name;
    } else {
      const cat = s.statusCategory as Record<string, unknown> | undefined;
      statusStr = (cat?.name as string) ?? (cat?.key === 'new' ? 'Open' : cat?.key === 'indeterminate' ? 'In Progress' : cat?.key === 'done' ? 'Done' : name) ?? name;
    }
  }

  const priorityRaw = issue.priority;
  const priorityStr = typeof priorityRaw === 'string'
    ? priorityRaw
    : (priorityRaw as Record<string, unknown>)?.name as string | undefined;

  // Build browse URL from Jira base URL + issue key
  const key = (issue.key as string) ?? String(issue.id);
  const url = jiraBaseUrl
    ? `${jiraBaseUrl.replace(/\/$/, '')}/browse/${key}`
    : (issue.url as string) ?? (issue.self as string) ?? undefined;

  // Extract assignee — can be string or object with displayName/name
  const assigneeRaw = issue.assignee;
  const assignee = typeof assigneeRaw === 'string'
    ? assigneeRaw
    : (assigneeRaw as Record<string, unknown>)?.displayName as string
      ?? (assigneeRaw as Record<string, unknown>)?.name as string
      ?? 'Unassigned';

  // Created date
  const created = (issue.created as string) ?? (issue.created_at as string) ?? '';

  // Build description with metadata
  const descParts: string[] = [];
  descParts.push(`Assignee: ${assignee}`);
  descParts.push(`Status: ${statusStr ?? 'unknown'}`);
  descParts.push(`Priority: ${priorityStr ?? 'unknown'}`);
  descParts.push(`Created: ${created ? new Date(created).toLocaleDateString() : 'unknown'}`);
  if (typeof issue.description === 'string' && issue.description.trim()) {
    descParts.push(issue.description);
  }

  return {
    source: 'jira',
    source_id: (issue.key as string) ?? String(issue.id),
    source_url: url,
    title:
      (issue.summary as string) ?? (issue.title as string) ?? 'Untitled',
    description: descParts.join('\n'),
    status: mapJiraStatus(statusStr),
    priority: mapJiraPriority(priorityStr),
    due_date: (issue.duedate as string) ?? (issue.due_date as string) ?? undefined,
    sla_breach_at: issue.sla_breach_at as string | undefined,
    category: 'project',
    raw_data: issue,
  };
}

function mapJiraStatus(status?: string): string {
  if (!status) return 'open';
  const lower = status.toLowerCase();
  if (
    lower.includes('done') ||
    lower.includes('closed') ||
    lower.includes('resolved')
  )
    return 'done';
  if (lower.includes('progress') || lower.includes('review'))
    return 'in_progress';
  return 'open';
}

function mapJiraPriority(priority?: string): number {
  if (!priority) return 50;
  const lower = priority.toLowerCase();
  if (lower.includes('highest') || lower.includes('critical')) return 95;
  if (lower.includes('high')) return 80;
  if (lower.includes('medium')) return 50;
  if (lower.includes('low')) return 30;
  if (lower.includes('lowest')) return 15;
  return 50;
}


// ---------- Aggregator Service ----------
export type SdFilter = 'mine' | 'unassigned' | 'all';

export class TaskAggregator {
  private adapters: SourceAdapter[];
  private getJiraClient?: () => JiraRestClient | null;

  constructor(
    private mcp: McpClientManager,
    private taskQueries: TaskQueries,
    private settingsQueries?: SettingsQueries,
    getJiraClient?: () => JiraRestClient | null,
  ) {
    this.getJiraClient = getJiraClient;
    this.adapters = [
      createJiraAdapter(),
    ];
  }

  /** Live Jira search for Service Desk with ownership filter. Returns normalized tasks (not persisted). */
  async fetchServiceDeskTickets(filter: SdFilter = 'mine', userJiraIdentity?: string): Promise<NormalizedTask[]> {
    const jiraClient = this.getJiraClient?.() ?? null;
    if (!jiraClient) return [];

    const sdProject = this.settingsQueries?.get('jira_sd_project');
    const sdTiers = this.settingsQueries?.get('jira_sd_tiers');
    const jiraBaseUrl = this.settingsQueries?.get('jira_ob_url')
      ?? this.settingsQueries?.get('jira_url') ?? undefined;

    // Build JQL based on filter
    const parts: string[] = [];
    if (filter === 'mine') {
      if (userJiraIdentity) {
        parts.push(`assignee = "${userJiraIdentity}"`);
      } else {
        console.log('[ServiceDesk] No jira_username configured for user — returning empty for "mine" filter');
        return [];
      }
    } else if (filter === 'unassigned') {
      parts.push('assignee IS EMPTY');
    }

    if (sdProject) {
      parts.push(`project = ${sdProject}`);
    }

    // Exclude configured tiers (e.g. Development) from global views only — My Tickets shows everything
    if (sdTiers && filter !== 'mine') {
      const tierValues = sdTiers.split(',').map(t => `"${t.trim()}"`).join(', ');
      parts.push(`"Current Tier" NOT IN (${tierValues})`);
    }

    parts.push('status NOT IN (Done, Closed, Resolved)');
    const jql = parts.join(' AND ') + ' ORDER BY priority DESC, updated DESC';
    console.log(`[ServiceDesk] JQL (${filter}): ${jql}`);

    try {
      const SD_FIELDS = ['summary', 'status', 'priority', 'description', 'assignee', 'created', 'duedate',
        'customfield_12981', 'customfield_14081', 'customfield_14185', 'customfield_14048',
        'customfield_13183', 'customfield_14527', 'customfield_13184',
        // Request type — needed so CC tiles (Incidents / Service Requests / TPJ) bucket correctly
        // in the wallboard drill-down. Without these, ccBucket() never matches and CC drills are empty.
        'customfield_13482', 'customfield_12800'];
      const result = await jiraClient.searchJqlAll(jql, SD_FIELDS, 500);
      return (result.issues ?? []).map(issue => {
        const flat: Record<string, unknown> = { key: issue.key, id: issue.id, self: issue.self, ...issue.fields };
        return mapJiraIssue(flat, jiraBaseUrl);
      });
    } catch (err) {
      console.warn(`[ServiceDesk] REST search failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  /** Run an arbitrary Service Desk JQL and return RAW Jira issues (key + fields).
   *  Used by wallboards that need queries the normalized fetch doesn't cover
   *  (e.g. "solved today" = status changed to Resolved/Closed since start of day). */
  async searchServiceDeskRaw(jql: string, fields: string[], max = 500): Promise<Array<{ key: string; fields: Record<string, unknown> }>> {
    const jiraClient = this.getJiraClient?.() ?? null;
    if (!jiraClient) return [];
    try {
      const result = await jiraClient.searchJqlAll(jql, fields, max);
      return (result.issues ?? []) as Array<{ key: string; fields: Record<string, unknown> }>;
    } catch (err) {
      console.warn(`[ServiceDesk] raw JQL search failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  /** Sync a single source by name. userId tags synced tasks with the owning user. */
  async syncSource(sourceName: string, userId?: number, ctx?: SyncContext): Promise<{ source: string; count: number; error?: string }> {
    const adapter = this.adapters.find((a) => a.source === sourceName);
    if (!adapter) return { source: sourceName, count: 0, error: 'Unknown source' };

    // Check if this source is disabled in settings
    if (this.settingsQueries?.get(`sync_${adapter.source}_enabled`) === 'false') {
      console.log(`[Aggregator] ${adapter.source}: Skipped — sync disabled`);
      return { source: adapter.source, count: 0 };
    }

    try {
      const { tasks, ok } = await adapter.fetch(this.mcp, ctx);
      let didChange = false;
      const freshIds: string[] = [];
      const isTransient = TRANSIENT_SOURCES.has(adapter.source);
      for (const task of tasks) {
        await this.taskQueries.upsertFromSource({ ...task, transient: isTransient, user_id: userId });
        freshIds.push(`${task.source}:${task.source_id}`);
        didChange = true;
      }

      // Remove tasks that are no longer in the source
      const canPurgeAll = false;
      let removed = 0;
      if (ok) {
        if (freshIds.length === 0 && !canPurgeAll) {
          console.warn(
            `[Aggregator] ${adapter.source}: Returned 0 tasks with ok=true — skipping stale cleanup to prevent accidental purge`
          );
        } else {
          removed = await this.taskQueries.deleteStaleBySource(adapter.source, freshIds, {
            allowEmpty: canPurgeAll,
            userId,
          });
        }
      }
      if (removed > 0) didChange = true;

      console.log(
        `[Aggregator] ${adapter.source}: Synced ${tasks.length} tasks` +
        (removed > 0 ? `, removed ${removed} stale` : '') +
        (userId ? ` (user ${userId})` : '')
      );
      return { source: adapter.source, count: tasks.length };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Aggregator] ${adapter.source}: Sync failed:`, errMsg);
      return { source: adapter.source, count: 0, error: errMsg };
    }
  }

  /** Get the list of known source names from registered adapters. */
  get sourceNames(): string[] {
    return this.adapters.map((a) => a.source);
  }

  async syncAll(userId?: number, ctx?: SyncContext): Promise<
    { source: string; count: number; error?: string }[]
  > {
    const results = [];
    for (const adapter of this.adapters) {
      results.push(await this.syncSource(adapter.source, userId, ctx));
    }
    return results;
  }

  /** Sync only sources the user has enabled (prevents shared MCP leaking to other users). */
  async syncAllForUser(userId: number | undefined, allowedSources: Set<string>, ctx?: SyncContext): Promise<
    { source: string; count: number; error?: string }[]
  > {
    const results = [];
    for (const adapter of this.adapters) {
      if (!allowedSources.has(adapter.source)) {
        results.push({ source: adapter.source, count: 0 });
        continue;
      }
      results.push(await this.syncSource(adapter.source, userId, ctx));
    }
    return results;
  }
}
