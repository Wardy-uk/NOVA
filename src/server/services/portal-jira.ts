import { query, queryOne } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';
import { broadcastPortalEvent } from '../routes/portal-events.js';
import type {
  PortalTicketSummary,
  PortalTicketDetail,
  PortalTicketComment,
  PortalTicketAttachment,
  PortalStatusChange,
  PortalSlaStatus,
} from '../../shared/portal-types.js';

interface TicketQueryOptions {
  orgId: number;
  userId?: number;
  status?: 'open' | 'resolved' | 'all';
  search?: string;
  priority?: string;
  dateRange?: 'today' | 'week' | 'month' | 'all';
  page?: number;
  pageSize?: number;
}

interface JiraPriority {
  id: string;
  name: string;
  isDefault?: boolean;
}

export class PortalJiraService {
  private priorityCache: { names: string[]; defaultName: string; fetchedAt: number } | null = null;
  private static PRIORITY_CACHE_TTL = 3_600_000; // 1 hour

  constructor(
    private settings: FileSettingsQueries,
    private jiraClient: JiraRestClient | null,
  ) {}

  async getJiraPriorities(): Promise<{ names: string[]; defaultName: string }> {
    if (this.priorityCache && Date.now() - this.priorityCache.fetchedAt < PortalJiraService.PRIORITY_CACHE_TTL) {
      return { names: this.priorityCache.names, defaultName: this.priorityCache.defaultName };
    }

    if (!this.jiraClient) throw new Error('Jira client not configured');

    const priorities = await this.jiraClient.rawGet<JiraPriority[]>('priority');
    const names = priorities.map((p: JiraPriority) => p.name);
    const defaultPriority = priorities.find((p: JiraPriority) => p.isDefault)?.name || names[Math.floor(names.length / 2)] || 'Medium';

    this.priorityCache = { names, defaultName: defaultPriority, fetchedAt: Date.now() };
    console.log(`[portal-jira] Cached ${names.length} Jira priorities: [${names.join(', ')}], default: ${defaultPriority}`);
    return { names, defaultName: defaultPriority };
  }

  async resolveJiraPriority(requested: string): Promise<string | null> {
    try {
      const { names, defaultName } = await this.getJiraPriorities();
      if (names.includes(requested)) return requested;
      const lower = requested.toLowerCase();
      const caseMatch = names.find(n => n.toLowerCase() === lower);
      if (caseMatch) return caseMatch;
      // Try partial match (e.g. "Highest" → "Highest" even if casing differs)
      const partialMatch = names.find(n => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()));
      if (partialMatch) {
        console.warn(`[portal-jira] Priority "${requested}" partial-matched to "${partialMatch}"`);
        return partialMatch;
      }
      console.warn(`[portal-jira] Priority "${requested}" not found in Jira [${names.join(', ')}], using default "${defaultName}"`);
      return defaultName;
    } catch (err) {
      console.error('[portal-jira] Could not fetch priorities, omitting priority field:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async getOrgEmailDomain(orgId: number): Promise<string | null> {
    // Check explicit mapping first
    const mapping = await queryOne<{ jira_email_domain: string | null }>(
      `SELECT jira_email_domain FROM portal_org_jira_mapping WHERE org_id = ?`,
      [orgId],
    );
    if (mapping?.jira_email_domain) return mapping.jira_email_domain;

    // Fallback to org domain
    const org = await queryOne<{ domain: string | null }>(
      `SELECT domain FROM portal_organisations WHERE id = ?`,
      [orgId],
    );
    return org?.domain || null;
  }

  private async getOrgJiraOrgId(orgId: number): Promise<string | null> {
    const mapping = await queryOne<{ jira_organisation_id: string | null }>(
      `SELECT jira_organisation_id FROM portal_org_jira_mapping WHERE org_id = ?`,
      [orgId],
    );
    return mapping?.jira_organisation_id || null;
  }

  async listTickets(opts: TicketQueryOptions): Promise<{ tickets: PortalTicketSummary[]; total: number }> {
    const domain = await this.getOrgEmailDomain(opts.orgId);
    const jiraOrgId = await this.getOrgJiraOrgId(opts.orgId);

    if (!domain && !jiraOrgId) return { tickets: [], total: 0 };

    const page = opts.page || 1;
    const pageSize = Math.min(opts.pageSize || 20, 100);
    const offset = (page - 1) * pageSize;

    // Build org-scoped WHERE: email domain match, OR jira_org_id if column exists
    // jira_issue_cache may not have a jira_org_id column yet — fall back to email only
    let orgCondition: string;
    const countParams: unknown[] = [];
    const queryParams: unknown[] = [];

    if (domain && jiraOrgId) {
      // Both available — use OR for broadest match
      orgCondition = `(jic.reporter_email LIKE ? OR jic.reporter_email LIKE ?)`;
      countParams.push(`%@${domain}`, `%@${domain}`);
      queryParams.push(`%@${domain}`, `%@${domain}`);
      // NOTE: full jira_org_id matching requires a jira_org_id column on jira_issue_cache,
      // populated by the Jira sync service. Until then, email domain is the only path.
      if (jiraOrgId) {
        console.log(`[portal-jira] Org ${opts.orgId} has jira_organisation_id=${jiraOrgId}, but jira_issue_cache lacks org column — using email domain only`);
      }
    } else if (domain) {
      orgCondition = `jic.reporter_email LIKE ?`;
      countParams.push(`%@${domain}`);
      queryParams.push(`%@${domain}`);
    } else {
      // No domain, only jiraOrgId — can't query cache without org column
      console.warn(`[portal-jira] Org ${opts.orgId} has jira_organisation_id but no email domain — cannot query ticket cache`);
      return { tickets: [], total: 0 };
    }

    let statusFilter = '';
    if (opts.status === 'open') {
      statusFilter = `AND jic.status NOT IN ('Closed', 'Resolved', 'Done', 'Cancelled')`;
    } else if (opts.status === 'resolved') {
      statusFilter = `AND jic.status IN ('Closed', 'Resolved', 'Done', 'Cancelled')`;
    }

    let searchFilter = '';
    let priorityFilter = '';
    let dateFilter = '';

    if (opts.search) {
      searchFilter = `AND (jic.summary LIKE ? OR jic.issue_key LIKE ?)`;
      countParams.push(`%${opts.search}%`, `%${opts.search}%`);
      queryParams.push(`%${opts.search}%`, `%${opts.search}%`);
    }

    if (opts.priority && opts.priority !== 'all') {
      priorityFilter = `AND jic.priority = ?`;
      countParams.push(opts.priority);
      queryParams.push(opts.priority);
    }

    if (opts.dateRange && opts.dateRange !== 'all') {
      const now = new Date();
      let cutoff: Date;
      if (opts.dateRange === 'today') {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (opts.dateRange === 'week') {
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else {
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      dateFilter = `AND jic.created_at >= ?`;
      countParams.push(cutoff.toISOString());
      queryParams.push(cutoff.toISOString());
    }

    if (opts.userId) {
      // If filtering by user, also get their email for reporter match
      const user = await queryOne<{ email: string }>(
        `SELECT email FROM portal_users WHERE id = ?`,
        [opts.userId],
      );
      // userEmail available for future per-user filtering
    }

    const countResult = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM jira_issue_cache jic
       WHERE ${orgCondition} ${statusFilter} ${searchFilter} ${priorityFilter} ${dateFilter}`,
      countParams,
    );

    queryParams.push(offset, pageSize);

    const rows = await query<{
      issue_key: string;
      summary: string;
      status: string;
      priority: string;
      created_at: string;
      updated_at: string;
      assignee: string | null;
      reporter_email: string | null;
    }>(
      `SELECT jic.issue_key, jic.summary, jic.status, ISNULL(jic.priority, 'Medium') AS priority,
              jic.created_at, jic.updated_at, jic.assignee_display AS assignee, jic.reporter_email
       FROM jira_issue_cache jic
       WHERE ${orgCondition} ${statusFilter} ${searchFilter} ${priorityFilter} ${dateFilter}
       ORDER BY jic.updated_at DESC
       OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
      queryParams,
    );

    const tickets: PortalTicketSummary[] = rows.map(r => ({
      key: r.issue_key,
      summary: r.summary || '',
      status: r.status || 'Unknown',
      priority: r.priority,
      created: r.created_at,
      updated: r.updated_at,
      assignee: r.assignee,
      reporter: r.reporter_email,
      latestComment: null,
    }));

    return { tickets, total: countResult?.total || 0 };
  }

  async getOrgOpenTicketCount(orgId: number): Promise<number> {
    const domain = await this.getOrgEmailDomain(orgId);
    if (!domain) return 0;

    const result = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM jira_issue_cache jic
       WHERE jic.reporter_email LIKE ?
         AND jic.status NOT IN ('Closed', 'Resolved', 'Done', 'Cancelled')`,
      [`%@${domain}`],
    );
    return result?.total || 0;
  }

  async getTicketDetail(ticketKey: string, orgId: number): Promise<PortalTicketDetail | null> {
    // Verify ticket belongs to org
    const domain = await this.getOrgEmailDomain(orgId);
    if (!domain) return null;

    const ticket = await queryOne<{
      issue_key: string;
      summary: string;
      status: string;
      priority: string;
      created_at: string;
      updated_at: string;
      assignee: string | null;
      reporter_email: string | null;
      description: string | null;
      bc_account_number: string | null;
      sla_breach_time: string | null;
    }>(
      `SELECT issue_key, summary, status, ISNULL(priority, 'Medium') AS priority,
              created_at, updated_at, assignee_display AS assignee, reporter_email, description,
              bc_account_number, sla_breach_time
       FROM jira_issue_cache
       WHERE issue_key = ? AND reporter_email LIKE ?`,
      [ticketKey, `%@${domain}`],
    );

    if (!ticket) return null;

    // Get public comments from comment cache
    const comments = await query<{
      jira_comment_id: string;
      author_display: string;
      body_text: string;
      jira_created: string;
      is_public: number;
    }>(
      `SELECT jira_comment_id, author_display, body_text, jira_created, is_public
       FROM jira_comment_cache
       WHERE issue_key = ? AND is_public = 1
       ORDER BY jira_created DESC`,
      [ticketKey],
    );

    const publicComments: PortalTicketComment[] = comments.map(c => ({
      id: c.jira_comment_id,
      author: c.author_display || 'Unknown',
      body: c.body_text || '',
      created: c.jira_created,
      isInternal: false,
    }));

    let slaStatus: PortalSlaStatus | null = null;
    if (ticket.sla_breach_time) {
      const breachTime = new Date(ticket.sla_breach_time).getTime();
      const now = Date.now();
      const diffMs = breachTime - now;
      const breached = diffMs <= 0;
      const absDiff = Math.abs(diffMs);
      const hours = Math.floor(absDiff / 3_600_000);
      const minutes = Math.floor((absDiff % 3_600_000) / 60_000);
      slaStatus = {
        name: 'Time to resolution',
        remaining: breached ? `Breached by ${hours}h ${minutes}m` : `${hours}h ${minutes}m`,
        breached,
      };
    }

    let attachments: PortalTicketAttachment[] = [];
    let statusHistory: PortalStatusChange[] = [];

    if (this.jiraClient) {
      const [attachResult, changelogResult] = await Promise.allSettled([
        this.jiraClient.getIssue(ticketKey, ['attachment']),
        this.jiraClient.getChangelog(ticketKey),
      ]);

      if (attachResult.status === 'fulfilled' && attachResult.value) {
        const fields = attachResult.value.fields as Record<string, unknown> | undefined;
        const rawAttachments = (fields?.attachment ?? []) as Array<{
          id: string; filename: string; mimeType: string; size: number; content: string;
        }>;
        attachments = rawAttachments.map(a => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          url: `/api/portal/tickets/${ticketKey}/attachments/${a.id}`,
        }));
      }

      if (changelogResult.status === 'fulfilled') {
        const entries = changelogResult.value ?? [];
        statusHistory = entries
          .flatMap(entry =>
            entry.items
              .filter(item => item.field === 'status')
              .map(item => ({
                from: item.fromString,
                to: item.toString || 'Unknown',
                changedAt: entry.created,
                changedBy: entry.author?.displayName || null,
              })),
          )
          .sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
      }
    }

    return {
      key: ticket.issue_key,
      summary: ticket.summary || '',
      status: ticket.status || 'Unknown',
      priority: ticket.priority,
      created: ticket.created_at,
      updated: ticket.updated_at,
      assignee: ticket.assignee,
      reporter: ticket.reporter_email,
      latestComment: publicComments.length > 0 ? publicComments[0].body.slice(0, 200) : null,
      description: ticket.description,
      bcAccountNumber: ticket.bc_account_number,
      comments: publicComments,
      attachments,
      statusHistory,
      slaStatus,
    };
  }

  async addComment(ticketKey: string, orgId: number, body: string, authorName: string): Promise<void> {
    // Verify ticket belongs to org
    const domain = await this.getOrgEmailDomain(orgId);
    if (!domain) throw new Error('Organisation not mapped');

    const ticket = await queryOne<{ issue_key: string }>(
      `SELECT issue_key FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
      [ticketKey, `%@${domain}`],
    );
    if (!ticket) throw new Error('Ticket not found or not accessible');

    if (!this.jiraClient) throw new Error('Jira client not configured');

    await this.jiraClient.addComment(ticketKey, `[Portal - ${authorName}]\n\n${body}`);

    broadcastPortalEvent(orgId, {
      type: 'ticket:comment',
      ticketKey,
      data: { author: authorName, summary: body.slice(0, 200) },
    });
  }

  async createTicket(params: {
    projectKey: string;
    summary: string;
    description: string;
    priority?: string;
    components?: string[];
    reporterEmail?: string;
    internalNote?: string;
  }): Promise<string> {
    if (!this.jiraClient) throw new Error('Jira client not configured');

    const resolvedPriority = params.priority
      ? await this.resolveJiraPriority(params.priority)
      : null;

    const fields: Record<string, unknown> = {
      project: { key: params.projectKey },
      summary: params.summary,
      description: params.description,
      issuetype: { name: 'Service Request' },
    };

    if (resolvedPriority) {
      fields.priority = { name: resolvedPriority };
    }

    if (params.components && params.components.length > 0) {
      fields.components = params.components.map(c => ({ name: c }));
    }

    let issue: { key: string };
    try {
      issue = await this.jiraClient.createIssue({ fields });
    } catch (err: unknown) {
      const jiraErr = err as { statusCode?: number; body?: unknown; message?: string };
      console.error('[portal-jira] Ticket creation failed:', {
        status: jiraErr.statusCode,
        body: typeof jiraErr.body === 'object' ? JSON.stringify(jiraErr.body).slice(0, 500) : jiraErr.body,
        fields: { project: fields.project, priority: fields.priority, issuetype: fields.issuetype },
        error: jiraErr.message || String(err),
      });
      throw new Error("We couldn't create your ticket right now — please try again or contact us directly at support@nurtur.tech.");
    }

    if (params.internalNote) {
      try {
        await this.jiraClient.addComment(issue.key, params.internalNote, { internal: true });
      } catch (err) {
        console.warn('[portal-jira] Failed to post internal note on', issue.key, ':', err instanceof Error ? err.message : err);
      }
    }

    return issue.key;
  }

  async uploadAttachment(
    ticketKey: string,
    orgId: number,
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    const domain = await this.getOrgEmailDomain(orgId);
    if (!domain) throw new Error('Organisation not mapped');

    const ticket = await queryOne<{ issue_key: string }>(
      `SELECT issue_key FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
      [ticketKey, `%@${domain}`],
    );
    if (!ticket) throw new Error('Ticket not found or not accessible');

    if (!this.jiraClient) throw new Error('Jira client not configured');

    await this.jiraClient.uploadAttachment(ticketKey, filename, buffer, mimeType);
  }

  async proxyAttachment(
    ticketKey: string,
    attachmentId: string,
    orgId: number,
  ): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; contentLength: string | null; filename: string }> {
    const domain = await this.getOrgEmailDomain(orgId);
    if (!domain) throw new Error('Organisation not mapped');

    const ticket = await queryOne<{ issue_key: string }>(
      `SELECT issue_key FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
      [ticketKey, `%@${domain}`],
    );
    if (!ticket) throw new Error('Ticket not found or not accessible');
    if (!this.jiraClient) throw new Error('Jira client not configured');

    const issue = await this.jiraClient.getIssue(ticketKey, ['attachment']);
    const fields = issue?.fields as Record<string, unknown> | undefined;
    const attachments = (fields?.attachment ?? []) as Array<{ id: string; filename: string; content: string }>;
    const attachment = attachments.find(a => a.id === attachmentId);
    if (!attachment) throw new Error('Attachment not found');

    const stream = await this.jiraClient.fetchAttachmentContent(attachment.content);
    return { ...stream, filename: attachment.filename };
  }
}
