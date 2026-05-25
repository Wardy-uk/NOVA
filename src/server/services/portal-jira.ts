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
import { mapJiraStatusToPortal } from './portal-status-mapper.js';

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

function extractTextFromInlineNodes(nodes: any[]): string {
  return nodes.map((node: any) => {
    if (Array.isArray(node.content)) return extractTextFromInlineNodes(node.content);
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return node.attrs?.text ?? node.attrs?.id ?? '';
    if (node.type === 'inlineCard' && node.attrs?.url) return node.attrs.url;
    if (node.type === 'emoji') return node.attrs?.shortName ?? '';
    return node.text ?? '';
  }).join('');
}

function extractTextFromNode(node: any): string {
  if (node.type === 'paragraph' || node.type === 'heading') {
    return Array.isArray(node.content) ? extractTextFromInlineNodes(node.content) : '';
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content ?? []).map((li: any) =>
      `- ${(li.content ?? []).map(extractTextFromNode).join(' ').trim()}`
    ).join('\n');
  }
  if (node.type === 'blockquote') {
    return (node.content ?? []).map(extractTextFromNode).join('\n');
  }
  if (node.type === 'codeBlock') {
    return (node.content ?? []).map((c: any) => c.text ?? '').join('');
  }
  if (node.type === 'mediaSingle' || node.type === 'mediaGroup') {
    return (node.content ?? []).map((m: any) =>
      m.attrs?.alt ?? m.attrs?.url ?? '[attachment]'
    ).join(' ');
  }
  if (node.type === 'blockCard' && node.attrs?.url) return node.attrs.url;
  if (node.type === 'embedCard' && node.attrs?.url) return node.attrs.url;
  if (Array.isArray(node.content)) return node.content.map(extractTextFromNode).join('\n');
  return node.text ?? '';
}

function extractJiraText(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return typeof adf === 'string' ? adf : '';
  try {
    const content = (adf as any).content;
    if (!Array.isArray(content)) return JSON.stringify(adf).slice(0, 2000);
    return content.map(extractTextFromNode).join('\n').trim();
  } catch {
    return '';
  }
}

function buildCustomerVisibleStatusHistory(
  entries: Array<{
    created: string;
    author?: { displayName?: string | null } | null;
    items: Array<{ field: string; fromString?: string | null; toString?: string | null }>;
  }>,
  settings: FileSettingsQueries,
): PortalStatusChange[] {
  const ascendingChanges = entries
    .flatMap(entry =>
      entry.items
        .filter(item => item.field === 'status')
        .map((item) => ({
          from: item.fromString ? mapJiraStatusToPortal(item.fromString, settings) : null,
          to: mapJiraStatusToPortal(item.toString || 'Unknown', settings),
          changedAt: entry.created,
          changedBy: entry.author?.displayName || null,
        })),
    )
    .sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());

  const deduped: PortalStatusChange[] = [];
  for (const change of ascendingChanges) {
    if (change.from === change.to) continue;
    const previous = deduped[deduped.length - 1];
    if (previous?.to === change.to) continue;
    deduped.push(change);
  }

  return deduped.reverse();
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
      status: mapJiraStatusToPortal(r.status || 'Unknown', this.settings),
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

  private async hasPortalAssociation(ticketKey: string, orgId: number): Promise<boolean> {
    const result = await queryOne<{ allowed: number }>(
      `SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM portal_form_submissions pfs
            INNER JOIN portal_users pu ON pu.id = pfs.portal_user_id
            WHERE pfs.jira_issue_key = ? AND pu.org_id = ?
          ) THEN 1
          WHEN EXISTS (
            SELECT 1
            FROM portal_chat_sessions pcs
            INNER JOIN portal_users pu ON pu.id = pcs.portal_user_id
            WHERE pcs.jira_issue_key = ? AND pu.org_id = ?
          ) THEN 1
          ELSE 0
        END AS allowed`,
      [ticketKey, orgId, ticketKey, orgId],
    );

    return result?.allowed === 1;
  }

  private buildSlaStatus(slaBreachTime: string | null): PortalSlaStatus | null {
    if (!slaBreachTime) return null;

    const breachTime = new Date(slaBreachTime).getTime();
    const now = Date.now();
    const diffMs = breachTime - now;
    const breached = diffMs <= 0;
    const absDiff = Math.abs(diffMs);
    const hours = Math.floor(absDiff / 3_600_000);
    const minutes = Math.floor((absDiff % 3_600_000) / 60_000);

    return {
      name: 'Time to resolution',
      remaining: breached ? `Breached by ${hours}h ${minutes}m` : `${hours}h ${minutes}m`,
      breached,
    };
  }

  private async getLiveTicketDetail(ticketKey: string): Promise<PortalTicketDetail | null> {
    if (!this.jiraClient) return null;

    const [issue, comments, changelog] = await Promise.all([
      this.jiraClient.getIssue(ticketKey, ['summary', 'status', 'priority', 'created', 'updated', 'assignee', 'reporter', 'description', 'attachment']),
      this.jiraClient.getComments(ticketKey, 20),
      this.jiraClient.getChangelog(ticketKey),
    ]);

    if (!issue) return null;

    const fields = (issue.fields ?? {}) as Record<string, any>;
    const attachments = Array.isArray(fields.attachment)
      ? fields.attachment.map((attachment: any) => ({
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          url: `/api/portal/tickets/${ticketKey}/attachments/${attachment.id}`,
        }))
      : [];

    const publicComments: PortalTicketComment[] = (comments ?? [])
      .filter(comment => comment.jsdPublic !== false)
      .map(comment => ({
        id: comment.id,
        author: comment.author?.displayName || 'Unknown',
        body: extractJiraText(comment.body),
        created: comment.created,
        isInternal: false,
      }));

    const statusHistory = buildCustomerVisibleStatusHistory(changelog ?? [], this.settings);

    return {
      key: issue.key,
      summary: fields.summary || '',
      status: mapJiraStatusToPortal(fields.status?.name || 'Unknown', this.settings),
      priority: fields.priority?.name || 'Medium',
      created: fields.created || new Date().toISOString(),
      updated: fields.updated || fields.created || new Date().toISOString(),
      assignee: fields.assignee?.displayName || null,
      reporter: fields.reporter?.emailAddress || fields.reporter?.displayName || null,
      latestComment: publicComments.length > 0 ? publicComments[0].body.slice(0, 200) : null,
      description: extractJiraText(fields.description),
      bcAccountNumber: typeof fields.bc_account_number === 'string' ? fields.bc_account_number : null,
      comments: publicComments,
      attachments,
      statusHistory,
      slaStatus: null,
    };
  }

  async getTicketDetail(ticketKey: string, orgId: number): Promise<PortalTicketDetail | null> {
    const domain = await this.getOrgEmailDomain(orgId);
    const hasPortalAssociation = await this.hasPortalAssociation(ticketKey, orgId);
    if (!domain && !hasPortalAssociation) return null;

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
       WHERE issue_key = ?
         AND (? = 1 OR (? <> '' AND reporter_email LIKE ?))`,
      [ticketKey, hasPortalAssociation ? 1 : 0, domain || '', domain ? `%@${domain}` : ''],
    );

    if (!ticket) {
      if (!hasPortalAssociation) return null;
      return this.getLiveTicketDetail(ticketKey);
    }

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

    const slaStatus = this.buildSlaStatus(ticket.sla_breach_time);

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
        statusHistory = buildCustomerVisibleStatusHistory(changelogResult.value ?? [], this.settings);
      }
    }

    return {
      key: ticket.issue_key,
      summary: ticket.summary || '',
      status: mapJiraStatusToPortal(ticket.status || 'Unknown', this.settings),
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
    const domain = await this.getOrgEmailDomain(orgId);
    const hasPortalAssociation = await this.hasPortalAssociation(ticketKey, orgId);
    if (!domain && !hasPortalAssociation) throw new Error('Organisation not mapped');

    if (domain) {
      const ticket = await queryOne<{ issue_key: string }>(
        `SELECT issue_key FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
        [ticketKey, `%@${domain}`],
      );
      if (!ticket && !hasPortalAssociation) throw new Error('Ticket not found or not accessible');
    } else if (!hasPortalAssociation) {
      throw new Error('Ticket not found or not accessible');
    }

    if (!this.jiraClient) throw new Error('Jira client not configured');

    await this.jiraClient.addComment(ticketKey, `[Portal - ${authorName}]\n\n${body}`);

    broadcastPortalEvent(orgId, {
      type: 'ticket:comment',
      ticketKey,
      data: { author: authorName, summary: body.slice(0, 200) },
    });
  }

  private textToAdf(text: string): Record<string, unknown> {
    const paragraphs = text.split(/\n{2,}/).map(block => {
      const lines = block.split('\n');
      const inlineContent: Array<Record<string, unknown>> = [];
      lines.forEach((line, i) => {
        if (i > 0) inlineContent.push({ type: 'hardBreak' });
        if (line) inlineContent.push({ type: 'text', text: line });
      });
      return { type: 'paragraph', content: inlineContent.length > 0 ? inlineContent : [{ type: 'text', text: ' ' }] };
    });
    return { type: 'doc', version: 1, content: paragraphs };
  }

  async createTicket(params: {
    projectKey: string;
    summary: string;
    description: string;
    priority?: string;
    components?: string[];
    labels?: string[];
    reporterEmail?: string;
    internalNote?: string;
    issueTypeName?: string;
  }): Promise<string> {
    if (!this.jiraClient) throw new Error('Jira client not configured');

    const resolvedPriority = params.priority
      ? await this.resolveJiraPriority(params.priority)
      : null;

    // Issue type: explicit param > per-project setting > global setting > project-specific defaults
    const issueTypeName = params.issueTypeName
      || this.settings.get(`portal_jira_issue_type_${params.projectKey.toLowerCase()}`)
      || this.settings.get('portal_jira_issue_type')
      || (params.projectKey === 'NTPJ' ? 'Support' : 'Service Request');

    const fields: Record<string, unknown> = {
      project: { key: params.projectKey },
      summary: params.summary,
      description: this.textToAdf(params.description),
      issuetype: { name: issueTypeName },
    };

    if (resolvedPriority) {
      fields.priority = { name: resolvedPriority };
    }

    if (params.components && params.components.length > 0) {
      fields.components = params.components.map(c => ({ name: c }));
    }

    if (params.labels && params.labels.length > 0) {
      fields.labels = params.labels;
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

  async linkIssues(newKey: string, originalKey: string): Promise<void> {
    if (!this.jiraClient) return;
    const linkTypeName = this.settings.get('jira_link_type_name') || 'Relates';
    await this.jiraClient.createIssueLink({
      type: { name: linkTypeName },
      inwardIssue: { key: originalKey },
      outwardIssue: { key: newKey },
    });
  }

  async uploadAttachment(
    ticketKey: string,
    orgId: number,
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    const domain = await this.getOrgEmailDomain(orgId);
    const hasPortalAssociation = await this.hasPortalAssociation(ticketKey, orgId);
    if (!domain && !hasPortalAssociation) throw new Error('Organisation not mapped');

    if (domain) {
      const ticket = await queryOne<{ issue_key: string }>(
        `SELECT issue_key FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
        [ticketKey, `%@${domain}`],
      );
      if (!ticket && !hasPortalAssociation) throw new Error('Ticket not found or not accessible');
    } else if (!hasPortalAssociation) {
      throw new Error('Ticket not found or not accessible');
    }

    if (!this.jiraClient) throw new Error('Jira client not configured');

    await this.jiraClient.uploadAttachment(ticketKey, filename, buffer, mimeType);
  }

  async proxyAttachment(
    ticketKey: string,
    attachmentId: string,
    orgId: number,
  ): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; contentLength: string | null; filename: string }> {
    const domain = await this.getOrgEmailDomain(orgId);
    const hasPortalAssociation = await this.hasPortalAssociation(ticketKey, orgId);
    if (!domain && !hasPortalAssociation) throw new Error('Organisation not mapped');

    if (domain) {
      const ticket = await queryOne<{ issue_key: string }>(
        `SELECT issue_key FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
        [ticketKey, `%@${domain}`],
      );
      if (!ticket && !hasPortalAssociation) throw new Error('Ticket not found or not accessible');
    } else if (!hasPortalAssociation) {
      throw new Error('Ticket not found or not accessible');
    }
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
