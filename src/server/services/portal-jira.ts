import { query, queryOne } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';
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
  page?: number;
  pageSize?: number;
}

export class PortalJiraService {
  constructor(
    private settings: FileSettingsQueries,
    private jiraClient: JiraRestClient | null,
  ) {}

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

  async listTickets(opts: TicketQueryOptions): Promise<{ tickets: PortalTicketSummary[]; total: number }> {
    const domain = await this.getOrgEmailDomain(opts.orgId);
    if (!domain) return { tickets: [], total: 0 };

    const page = opts.page || 1;
    const pageSize = Math.min(opts.pageSize || 20, 100);
    const offset = (page - 1) * pageSize;

    let statusFilter = '';
    if (opts.status === 'open') {
      statusFilter = `AND jic.status NOT IN ('Closed', 'Resolved', 'Done', 'Cancelled')`;
    } else if (opts.status === 'resolved') {
      statusFilter = `AND jic.status IN ('Closed', 'Resolved', 'Done', 'Cancelled')`;
    }

    let searchFilter = '';
    const countParams: unknown[] = [`%@${domain}`];
    const queryParams: unknown[] = [`%@${domain}`];

    if (opts.search) {
      searchFilter = `AND (jic.summary LIKE ? OR jic.issue_key LIKE ?)`;
      countParams.push(`%${opts.search}%`, `%${opts.search}%`);
      queryParams.push(`%${opts.search}%`, `%${opts.search}%`);
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
       WHERE jic.reporter_email LIKE ? ${statusFilter} ${searchFilter}`,
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
       WHERE jic.reporter_email LIKE ? ${statusFilter} ${searchFilter}
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
      attachments: [],
      statusHistory: [],
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

    const fields: Record<string, unknown> = {
      project: { key: params.projectKey },
      summary: params.summary,
      description: params.description,
      issuetype: { name: 'Service Request' },
    };

    if (params.priority) {
      fields.priority = { name: params.priority };
    }

    if (params.components && params.components.length > 0) {
      fields.components = params.components.map(c => ({ name: c }));
    }

    const issue = await this.jiraClient.createIssue({ fields });

    // Post internal note with structured intake data
    if (params.internalNote) {
      await this.jiraClient.addComment(issue.key, params.internalNote, { internal: true });
    }

    return issue.key;
  }
}
