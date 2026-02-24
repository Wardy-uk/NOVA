import type { McpClientManager } from './mcp-client.js';
import type { TaskQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { saveDb } from '../db/schema.js';

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
}

interface FetchResult {
  tasks: NormalizedTask[];
  ok: boolean;
}

interface SourceAdapter {
  source: string;
  serverName: string;
  fetch(mcp: McpClientManager): Promise<FetchResult>;
}

let lastJiraSearchText: string | null = null;

export function getLastJiraSearchText(): string | null {
  return lastJiraSearchText;
}

// ---------- Jira Adapter ----------
function createJiraAdapter(jiraBaseUrl?: string): SourceAdapter {
  return {
    source: 'jira',
    serverName: 'jira',

    async fetch(mcp: McpClientManager): Promise<FetchResult> {
      if (!mcp.isConnected('jira')) return { tasks: [], ok: false };

      const result = (await mcp.callTool('jira', 'jira_search', {
        jql: 'assignee = currentUser() AND status NOT IN (Done, Closed, Resolved) ORDER BY priority DESC, updated DESC',
        limit: 50,
        fields: 'summary,status,priority,description,assignee,created,duedate,requestType,queue,"Agent Next Update","Last Agent Public Comment"',
        expand: 'sla',
      })) as { content?: Array<{ text?: string }> };

      const text = result?.content?.[0]?.text;
      if (!text) return { tasks: [], ok: false };
      lastJiraSearchText = text;

      return { tasks: parseJiraSearchResults(text, jiraBaseUrl), ok: true };
    },
  };
}

function parseJiraSearchResults(text: string, jiraBaseUrl?: string): NormalizedTask[] {
  // Try JSON parse first (some tool versions return JSON)
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return data.map((issue) => mapJiraIssue(issue, jiraBaseUrl));
    }
    if (data.issues && Array.isArray(data.issues)) {
      return data.issues.map((issue: Record<string, unknown>) =>
        mapJiraIssue(issue, jiraBaseUrl)
      );
    }
  } catch {
    // Not JSON — parse as markdown/text
  }

  // Fallback: line-by-line parsing of markdown output
  const tasks: NormalizedTask[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(
      /\[([A-Z]+-\d+)\]\((https?:\/\/[^)]+)\)\s*[-:]\s*(.+)/
    );
    if (match) {
      tasks.push({
        source: 'jira',
        source_id: match[1],
        source_url: match[2],
        title: match[3].trim(),
        status: 'open',
        priority: 50,
      });
    }
  }

  return tasks;
}

function mapJiraIssue(issue: Record<string, unknown>, jiraBaseUrl?: string): NormalizedTask {
  // Status and priority can be objects with a 'name' field or plain strings
  const statusRaw = issue.status;
  const statusStr = typeof statusRaw === 'string'
    ? statusRaw
    : (statusRaw as Record<string, unknown>)?.name as string | undefined;

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

// ---------- Planner Adapter ----------
const plannerAdapter: SourceAdapter = {
  source: 'planner',
  serverName: 'msgraph',

  async fetch(mcp: McpClientManager): Promise<FetchResult> {
    if (!mcp.isConnected('msgraph')) return { tasks: [], ok: false };

    const result = (await mcp.callTool('msgraph', 'list-planner-tasks', {})) as {
      content?: Array<{ text?: string }>;
    };

    const text = result?.content?.[0]?.text;
    if (!text) return { tasks: [], ok: false };

    const tasks = parsePlannerTasks(text);
    return { tasks: tasks ?? [], ok: tasks !== null };
  },
};

function parsePlannerTasks(text: string): NormalizedTask[] | null {
  try {
    const data = JSON.parse(text);
    const tasks = Array.isArray(data) ? data : data.value ?? data.tasks ?? [];
    return tasks
      .filter((t: Record<string, unknown>) => t.percentComplete !== 100)
      .map((t: Record<string, unknown>) => ({
        source: 'planner' as const,
        source_id: String(t.id),
        title: (t.title as string) ?? 'Untitled',
        description: (t.details as string) ?? (t.description as string) ?? undefined,
        status: mapPlannerStatus(t.percentComplete as number | undefined),
        priority: mapPlannerPriority(t.priority as number | undefined),
        due_date: (t.dueDateTime as string) ?? undefined,
        category: 'project',
        raw_data: t,
      }));
  } catch {
    console.warn('[plannerAdapter] Could not parse response');
    return null;
  }
}

function mapPlannerStatus(percentComplete?: number): string {
  if (percentComplete === undefined) return 'open';
  if (percentComplete === 100) return 'done';
  if (percentComplete > 0) return 'in_progress';
  return 'open';
}

function mapPlannerPriority(priority?: number): number {
  if (priority === undefined) return 50;
  if (priority <= 1) return 90;   // Urgent
  if (priority <= 3) return 70;   // Important
  if (priority <= 5) return 50;   // Medium
  if (priority <= 7) return 30;   // Low
  return 20;
}

// ---------- To-Do Adapter ----------
const todoAdapter: SourceAdapter = {
  source: 'todo',
  serverName: 'msgraph',

  async fetch(mcp: McpClientManager): Promise<FetchResult> {
    if (!mcp.isConnected('msgraph')) return { tasks: [], ok: false };

    // Get all task lists
    const listsResult = (await mcp.callTool('msgraph', 'list-todo-task-lists', {})) as {
      content?: Array<{ text?: string }>;
    };

    const listsText = listsResult?.content?.[0]?.text;
    if (!listsText) return { tasks: [], ok: false };

    let lists: Array<Record<string, unknown>>;
    try {
      const parsed = JSON.parse(listsText);
      lists = Array.isArray(parsed) ? parsed : parsed.value ?? [];
    } catch {
      return { tasks: [], ok: false };
    }

    // Fetch tasks from each list
    const allTasks: NormalizedTask[] = [];
    let hadAnyFetch = false;
    let hadError = false;
    for (const list of lists) {
      try {
        const tasksResult = (await mcp.callTool('msgraph', 'list-todo-tasks', {
          taskListId: String(list.id),
        })) as { content?: Array<{ text?: string }> };

        const tasksText = tasksResult?.content?.[0]?.text;
        if (!tasksText) continue;

        const parsed = JSON.parse(tasksText);
        const tasks = Array.isArray(parsed) ? parsed : parsed.value ?? [];
        hadAnyFetch = true;

        for (const t of tasks) {
          if ((t.status as string) === 'completed') continue;
          allTasks.push({
            source: 'todo',
            source_id: String(t.id),
            title: (t.title as string) ?? 'Untitled',
            description: (t.body?.content as string) ?? undefined,
            status: mapTodoStatus(t.status as string),
            priority: mapTodoPriority(t.importance as string),
            due_date: (t.dueDateTime?.dateTime as string) ?? undefined,
            category: 'personal',
            raw_data: t,
          });
        }
      } catch (err) {
        hadError = true;
        console.warn(`[todoAdapter] Error fetching list ${list.displayName}:`, err);
      }
    }

    return { tasks: allTasks, ok: hadAnyFetch && !hadError };
  },
};

function mapTodoStatus(status?: string): string {
  if (!status) return 'open';
  if (status === 'completed') return 'done';
  if (status === 'inProgress') return 'in_progress';
  return 'open';
}

function mapTodoPriority(importance?: string): number {
  if (!importance) return 50;
  if (importance === 'high') return 80;
  if (importance === 'normal') return 50;
  if (importance === 'low') return 30;
  return 50;
}

// ---------- Calendar Adapter ----------
const calendarAdapter: SourceAdapter = {
  source: 'calendar',
  serverName: 'msgraph',

  async fetch(mcp: McpClientManager): Promise<FetchResult> {
    if (!mcp.isConnected('msgraph')) return { tasks: [], ok: false };

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const result = (await mcp.callTool('msgraph', 'get-calendar-view', {
      startDateTime: now.toISOString(),
      endDateTime: weekFromNow.toISOString(),
    })) as { content?: Array<{ text?: string }> };

    const text = result?.content?.[0]?.text;
    if (!text) return { tasks: [], ok: false };

    const tasks = parseCalendarEvents(text);
    return { tasks: tasks ?? [], ok: tasks !== null };
  },
};

function parseCalendarEvents(text: string): NormalizedTask[] | null {
  try {
    const data = JSON.parse(text);
    const events = Array.isArray(data) ? data : data.value ?? [];

    return events.map((e: Record<string, unknown>) => {
      const start = e.start as { dateTime?: string } | undefined;
      return {
        source: 'calendar' as const,
        source_id: String(e.id),
        source_url: (e.webLink as string) ?? undefined,
        title: (e.subject as string) ?? 'Untitled Event',
        description: (e.bodyPreview as string) ?? undefined,
        status: 'open',
        priority: 40,
        due_date: start?.dateTime ?? undefined,
        category: 'admin',
        raw_data: e,
      };
    });
  } catch {
    console.warn('[calendarAdapter] Could not parse response');
    return null;
  }
}

// ---------- Email Adapter ----------
type EmailFilter = 'flagged' | 'unread' | 'unread_and_flagged' | 'all';

function buildEmailODataFilter(filter: EmailFilter, days: number): string {
  const parts: string[] = [];

  if (filter === 'flagged') {
    parts.push("flag/flagStatus eq 'flagged'");
  } else if (filter === 'unread') {
    parts.push('isRead eq false');
  } else if (filter === 'unread_and_flagged') {
    parts.push("(isRead eq false or flag/flagStatus eq 'flagged')");
  }
  // 'all' = no status filter

  if (days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    parts.push(`receivedDateTime ge ${since.toISOString()}`);
  }

  return parts.join(' and ');
}

function createEmailAdapter(settingsQueries?: SettingsQueries): SourceAdapter {
  return {
    source: 'email',
    serverName: 'msgraph',

    async fetch(mcp: McpClientManager): Promise<FetchResult> {
      if (!mcp.isConnected('msgraph')) return { tasks: [], ok: false };

      const filterType = (settingsQueries?.get('email_filter') ?? 'flagged') as EmailFilter;
      const days = parseInt(settingsQueries?.get('email_days') ?? '7', 10) || 7;
      const limit = parseInt(settingsQueries?.get('email_limit') ?? '50', 10) || 50;

      const odata = buildEmailODataFilter(filterType, days);

      const args: Record<string, unknown> = { top: limit };
      if (odata) args.filter = odata;

      const result = (await mcp.callTool('msgraph', 'list-mail-messages', args)) as {
        content?: Array<{ text?: string }>;
      };

      const text = result?.content?.[0]?.text;
      if (!text) return { tasks: [], ok: false };

      const tasks = parseFlaggedEmails(text);
      return { tasks: tasks ?? [], ok: tasks !== null };
    },
  };
}

function parseFlaggedEmails(text: string): NormalizedTask[] | null {
  try {
    const data = JSON.parse(text);
    const messages = Array.isArray(data) ? data : data.value ?? [];

    return messages.map((m: Record<string, unknown>) => {
      const from = m.from as { emailAddress?: { name?: string } } | undefined;
      const flag = m.flag as { dueDateTime?: { dateTime?: string } } | undefined;
      return {
        source: 'email' as const,
        source_id: String(m.id),
        source_url: (m.webLink as string) ?? undefined,
        title: (m.subject as string) ?? 'No Subject',
        description: from?.emailAddress?.name
          ? `From: ${from.emailAddress.name}`
          : undefined,
        status: 'open',
        priority: m.importance === 'high' ? 75 : 45,
        due_date: flag?.dueDateTime?.dateTime ?? undefined,
        category: 'admin',
        raw_data: m,
      };
    });
  } catch {
    console.warn('[emailAdapter] Could not parse response');
    return null;
  }
}

// ---------- Monday.com Adapter ----------
const mondayAdapter: SourceAdapter = {
  source: 'monday',
  serverName: 'monday',

  async fetch(mcp: McpClientManager): Promise<FetchResult> {
    if (!mcp.isConnected('monday')) return { tasks: [], ok: false };

    // 1. Get boards (optionally filtered by env var)
    const boardIdsEnv = process.env.MONDAY_BOARD_IDS;
    let boards: Array<Record<string, unknown>>;

    if (boardIdsEnv) {
      // Use configured board IDs directly
      boards = boardIdsEnv
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => ({ id }));
    } else {
      const boardsResult = (await mcp.callTool('monday', 'monday-list-boards', {})) as {
        content?: Array<{ text?: string }>;
      };
      const boardsText = boardsResult?.content?.[0]?.text;
      if (!boardsText) return { tasks: [], ok: false };

      try {
        const parsed = JSON.parse(boardsText);
        boards = Array.isArray(parsed) ? parsed : parsed.boards ?? parsed.data?.boards ?? [];
      } catch {
        console.warn('[mondayAdapter] Could not parse boards response');
        return { tasks: [], ok: false };
      }
    }

    // 2. For each board, get groups and items
    const allTasks: NormalizedTask[] = [];
    let hadAnyFetch = false;
    let hadError = false;

    for (const board of boards) {
      const boardId = String(board.id);
      const boardName = (board.name as string) ?? '';

      try {
        // Get groups for this board
        const groupsResult = (await mcp.callTool('monday', 'monday-get-board-groups', {
          boardId,
        })) as { content?: Array<{ text?: string }> };

        const groupsText = groupsResult?.content?.[0]?.text;
        if (!groupsText) {
          hadError = true;
          continue;
        }

        let groups: Array<Record<string, unknown>>;
        try {
          const parsed = JSON.parse(groupsText);
          groups = Array.isArray(parsed) ? parsed : parsed.groups ?? parsed.data?.groups ?? [];
        } catch {
          hadError = true;
          continue;
        }

        // Filter out done/completed groups
        const activeGroups = groups.filter((g) => {
          const title = ((g.title as string) ?? '').toLowerCase();
          return !title.includes('done') && !title.includes('completed') && !title.includes('closed');
        });

        if (activeGroups.length === 0) continue;

        const groupIds = activeGroups.map((g) => String(g.id));

        // Get items from active groups
        const itemsResult = (await mcp.callTool('monday', 'monday-list-items-in-groups', {
          boardId,
          groupIds,
        })) as { content?: Array<{ text?: string }> };

        const itemsText = itemsResult?.content?.[0]?.text;
        if (!itemsText) {
          hadError = true;
          continue;
        }

        let items: Array<Record<string, unknown>>;
        try {
          const parsed = JSON.parse(itemsText);
          items = Array.isArray(parsed) ? parsed : parsed.items ?? parsed.data?.items ?? [];
        } catch {
          hadError = true;
          continue;
        }

        hadAnyFetch = true;
        for (const item of items) {
          const columnValues = (item.column_values as Array<Record<string, unknown>>) ?? [];
          allTasks.push({
            source: 'monday',
            source_id: String(item.id),
            source_url: `https://monday.com/boards/${boardId}/pulses/${item.id}`,
            title: (item.name as string) ?? 'Untitled',
            description: boardName ? `Board: ${boardName}` : undefined,
            status: mapMondayStatus(columnValues),
            priority: mapMondayPriority(columnValues),
            due_date: extractMondayDate(columnValues),
            category: 'project',
            raw_data: item,
          });
        }
      } catch (err) {
        hadError = true;
        console.warn(`[mondayAdapter] Error fetching board ${boardId}:`, err);
      }
    }

    return { tasks: allTasks, ok: hadAnyFetch && !hadError };
  },
};

function findColumnValue(
  columns: Array<Record<string, unknown>>,
  ...keywords: string[]
): string | undefined {
  for (const col of columns) {
    const id = ((col.id as string) ?? '').toLowerCase();
    const title = ((col.title as string) ?? '').toLowerCase();
    if (keywords.some((kw) => id.includes(kw) || title.includes(kw))) {
      return (col.text as string) ?? (col.value as string) ?? undefined;
    }
  }
  return undefined;
}

function mapMondayStatus(columns: Array<Record<string, unknown>>): string {
  const status = findColumnValue(columns, 'status');
  if (!status) return 'open';
  const lower = status.toLowerCase();
  if (lower.includes('done') || lower.includes('completed') || lower.includes('closed'))
    return 'done';
  if (lower.includes('progress') || lower.includes('working'))
    return 'in_progress';
  return 'open';
}

function mapMondayPriority(columns: Array<Record<string, unknown>>): number {
  const priority = findColumnValue(columns, 'priority');
  if (!priority) return 55;
  const lower = priority.toLowerCase();
  if (lower.includes('critical')) return 95;
  if (lower.includes('high')) return 80;
  if (lower.includes('medium')) return 55;
  if (lower.includes('low')) return 30;
  return 55;
}

function extractMondayDate(columns: Array<Record<string, unknown>>): string | undefined {
  const date = findColumnValue(columns, 'date', 'due', 'deadline', 'timeline');
  if (!date) return undefined;
  // Monday dates can be ISO strings or "YYYY-MM-DD" format
  try {
    return new Date(date).toISOString();
  } catch {
    return undefined;
  }
}

// ---------- Aggregator Service ----------
export class TaskAggregator {
  private adapters: SourceAdapter[];

  constructor(
    private mcp: McpClientManager,
    private taskQueries: TaskQueries,
    private settingsQueries?: SettingsQueries
  ) {
    const jiraBaseUrl = settingsQueries?.get('jira_url') ?? undefined;
    this.adapters = [
      createJiraAdapter(jiraBaseUrl),
      plannerAdapter,
      todoAdapter,
      calendarAdapter,
      createEmailAdapter(settingsQueries),
      mondayAdapter,
    ];
  }

  /** Sync a single source by name. Returns result with count and optional error. */
  async syncSource(sourceName: string): Promise<{ source: string; count: number; error?: string }> {
    const adapter = this.adapters.find((a) => a.source === sourceName);
    if (!adapter) return { source: sourceName, count: 0, error: 'Unknown source' };

    // Check if this source is disabled in settings
    if (this.settingsQueries?.get(`sync_${adapter.source}_enabled`) === 'false') {
      console.log(`[Aggregator] ${adapter.source}: Skipped — sync disabled`);
      return { source: adapter.source, count: 0 };
    }

    try {
      const { tasks, ok } = await adapter.fetch(this.mcp);
      let didChange = false;
      const freshIds: string[] = [];
      for (const task of tasks) {
        this.taskQueries.upsertFromSource(task, { deferSave: true });
        freshIds.push(`${task.source}:${task.source_id}`);
        didChange = true;
      }

      // Remove tasks that are no longer in the source
      // Ephemeral sources (calendar, email) can legitimately return 0 items
      // Task sources should not purge all when 0 returned (likely API glitch)
      const ephemeralSources = new Set(['calendar', 'email']);
      const canPurgeAll = ephemeralSources.has(adapter.source);
      let removed = 0;
      if (ok) {
        if (freshIds.length === 0 && !canPurgeAll) {
          console.warn(
            `[Aggregator] ${adapter.source}: Returned 0 tasks with ok=true — skipping stale cleanup to prevent accidental purge`
          );
        } else {
          removed = this.taskQueries.deleteStaleBySource(adapter.source, freshIds, {
            allowEmpty: canPurgeAll,
            deferSave: true,
          });
        }
      }
      if (removed > 0) didChange = true;

      if (didChange) {
        saveDb();
      }

      console.log(
        `[Aggregator] ${adapter.source}: Synced ${tasks.length} tasks` +
        (removed > 0 ? `, removed ${removed} stale` : '')
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

  async syncAll(): Promise<
    { source: string; count: number; error?: string }[]
  > {
    const results = [];
    for (const adapter of this.adapters) {
      results.push(await this.syncSource(adapter.source));
    }
    return results;
  }
}
