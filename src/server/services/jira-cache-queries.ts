import { query, queryOne } from './database.js';

/** Just enough of an open issue to count it, judge its SLA and tell if it has gone stale —
 *  deliberately no LOB columns. See getOpenIssueSummaries. */
export interface OpenIssueSummary {
  issue_key: string;
  status_name: string | null;
  sla_breach_time: Date | null;
  jira_updated: Date | null;
}

export interface CachedIssue {
  issue_key: string;
  jira_id: string;
  project_key: string;
  summary: string | null;
  description_text: string | null;
  description_adf: string | null;
  status_name: string | null;
  status_category: string | null;
  priority_name: string | null;
  issuetype_name: string | null;
  resolution_name: string | null;
  assignee_account_id: string | null;
  assignee_display: string | null;
  assignee_email: string | null;
  reporter_account_id: string | null;
  reporter_display: string | null;
  reporter_email: string | null;
  jira_created: Date | null;
  jira_updated: Date | null;
  due_date: Date | null;
  current_tier: string | null;
  nurtur_product: string | null;
  request_type: string | null;
  tldr_text: string | null;
  agent_summary_text: string | null;
  troubleshooting_text: string | null;
  escalation_reason_text: string | null;
  expected_outcome_text: string | null;
  issue_environment_text: string | null;
  development_details_text: string | null;
  resolution_type: string | null;
  agent_next_update: Date | null;
  agent_last_updated: Date | null;
  sla_breach_time: Date | null;
  sla_breached: boolean;
  labels: string | null;
  issue_links_json: string | null;
  fields_json: string | null;
  bc_account_number: string | null;
  synced_at: Date;
}

export interface CachedComment {
  jira_comment_id: string;
  issue_key: string;
  author_account_id: string | null;
  author_display: string | null;
  author_email: string | null;
  body_text: string | null;
  body_adf: string | null;
  is_public: boolean;
  jira_created: Date;
  jira_updated: Date;
}

export interface SyncStatus {
  lastSyncAt: string | null;
  issueCount: number;
  cacheAgeSeconds: number | null;
}

export class JiraCacheQueries {

  // ── Issue queries ──

  async getIssue(key: string): Promise<CachedIssue | null> {
    const row = await queryOne<CachedIssue>(
      'SELECT * FROM jira_issue_cache WHERE issue_key = ?', [key],
    );
    return row ?? null;
  }

  async getIssuesByKeys(keys: string[]): Promise<CachedIssue[]> {
    if (keys.length === 0) return [];
    const placeholders = keys.map(() => '?').join(',');
    return query<CachedIssue>(
      `SELECT * FROM jira_issue_cache WHERE issue_key IN (${placeholders})`, keys,
    );
  }

  /**
   * Open issues, without the large columns.
   *
   * `getOpenIssues` is `SELECT *`, and on 18 Sep 2026 `jira_issue_cache` was 723MB across
   * 12,763 rows — roughly 58KB a row, nearly all of it `fields_json` and `description_text`.
   * The perceiver called it every tick to do three things: count tickets by status, spot SLA
   * breaches coming, and find stale tickets. None of those read a LOB column, yet the scan
   * dragged every one of them off disk — about 35MB of IO a minute, against a database whose
   * `avg_data_io_percent` was pegged at 100 while CPU sat at 35%.
   *
   * The narrow scan answers all three questions. The handful of rows that actually become
   * events are then hydrated by key through `getIssuesByKeys`, so the full row is read about
   * twenty times a tick rather than six hundred.
   *
   * The project CLAUDE.md already said never to `SELECT *` from this table in a request path.
   * This is that rule applied to the hottest caller of it.
   */
  async getOpenIssueSummaries(projects: string[]): Promise<OpenIssueSummary[]> {
    const placeholders = projects.map(() => '?').join(',');
    return query<OpenIssueSummary>(
      `SELECT issue_key, status_name, sla_breach_time, jira_updated
       FROM jira_issue_cache
       WHERE project_key IN (${placeholders})
         AND status_category IN ('new', 'indeterminate')
       ORDER BY jira_created DESC`,
      projects,
    );
  }

  /**
   * Open issues for the Workspace queue — every column it renders, and not one more.
   *
   * That screen called `getOpenIssues`, a bare `SELECT *`, which on jira_issue_cache means
   * fields_json and description_text for ~600 rows on a 723MB table: roughly 35MB off disk per
   * page load, none of which it displays. On 19 Sep 2026 it stopped returning at all —
   * "/workspace/queue returned an empty response (HTTP 502) after 122s".
   *
   * Same fault as the perceiver's tick scan, fixed the same way. The project CLAUDE.md rule
   * stands: never SELECT * from this table in a request path, and a user-facing page is the
   * most request-path thing there is.
   */
  async getOpenIssuesForQueue(projects: string[]): Promise<CachedIssue[]> {
    const placeholders = projects.map(() => '?').join(',');
    return query<CachedIssue>(
      `SELECT issue_key, jira_id, summary, status_name, status_category, priority_name,
              issuetype_name, assignee_account_id, assignee_display, assignee_email,
              reporter_display, reporter_email, jira_created, jira_updated, labels,
              request_type, current_tier, sla_breach_time, sla_breached
       FROM jira_issue_cache
       WHERE project_key IN (${placeholders})
         AND status_category IN ('new', 'indeterminate')
       ORDER BY jira_created DESC`,
      projects,
    );
  }

  // getOpenIssues() was removed on 19 Sep 2026. It was `SELECT *` over every open ticket,
  // which on this table means fields_json and description_text — about 35MB per call — and
  // every one of its callers wanted a handful of small columns. It timed out the Workspace
  // page at 122s, cost the perceiver ~35MB a minute, and nothing that called it displayed or
  // read a single LOB column.
  //
  // Deliberately not left in place "in case someone needs it". A convenient method that is
  // wrong for this table will be reached for again; the two narrow ones below cover what the
  // callers actually did. If a caller genuinely needs the full row, it wants getIssueByKey or
  // getIssuesByKeys, which are bounded by key rather than by an open-ended predicate.

  async getRecentlyCreated(projects: string[], since: Date): Promise<CachedIssue[]> {
    const placeholders = projects.map(() => '?').join(',');
    return query<CachedIssue>(
      `SELECT c.* FROM jira_issue_cache c
       LEFT JOIN agent_ticket_state ts ON ts.ticket_id = c.issue_key
       WHERE c.project_key IN (${placeholders})
         AND c.jira_created >= ?
         AND ts.ticket_id IS NULL
       ORDER BY c.jira_created DESC`,
      [...projects, since],
    );
  }

  async getRecentlyUpdated(projects: string[], since: Date): Promise<CachedIssue[]> {
    const placeholders = projects.map(() => '?').join(',');
    return query<CachedIssue>(
      `SELECT * FROM jira_issue_cache
       WHERE project_key IN (${placeholders})
         AND status_category IN ('new', 'indeterminate')
         AND jira_updated >= ?
         AND jira_created < ?
       ORDER BY jira_updated DESC`,
      [...projects, since, since],
    );
  }

  // ── Tier queries (Dev Review) ──

  /** Dev Review's Tier 3 queue. Named columns, not `SELECT *`: the caller maps thirteen
   *  fields and none of them is fields_json or description_text, which together are most of
   *  this table's 723MB. tldr_text stays because the queue displays it. */
  async getTier3Issues(): Promise<CachedIssue[]> {
    return query<CachedIssue>(
      `SELECT issue_key, jira_id, summary, status_name, status_category, priority_name,
              assignee_account_id, assignee_display, assignee_email,
              reporter_display, reporter_email, jira_created, jira_updated,
              current_tier, nurtur_product, request_type, tldr_text,
              sla_breach_time, sla_breached, labels
       FROM jira_issue_cache
       WHERE current_tier = 'Tier 3'
         AND status_category != 'done'
       ORDER BY jira_updated DESC`,
    );
  }

  // ── Status-based queries (Stale Sweep) ──

  async getByStatusUpdatedBefore(status: string, before: Date, limit = 50): Promise<CachedIssue[]> {
    return query<CachedIssue>(
      `SELECT TOP (?) * FROM jira_issue_cache
       WHERE status_name = ?
         AND jira_updated <= ?
       ORDER BY jira_updated ASC`,
      [limit, status, before],
    );
  }

  // ── Resolution queries ──

  async getRecentlyResolved(since: Date, limit = 30): Promise<CachedIssue[]> {
    return query<CachedIssue>(
      `SELECT TOP (?) * FROM jira_issue_cache
       WHERE status_category = 'done'
         AND jira_updated >= ?
       ORDER BY jira_updated DESC`,
      [limit, since],
    );
  }

  // ── Assignee queries ──

  async getByAssignee(identifier: string, projects: string[], matchField: 'account_id' | 'email' | 'display' = 'account_id'): Promise<CachedIssue[]> {
    const col = matchField === 'account_id' ? 'assignee_account_id'
      : matchField === 'display' ? 'assignee_display'
      : 'assignee_email';
    const placeholders = projects.map(() => '?').join(',');
    return query<CachedIssue>(
      // Named columns: queue-ranker maps these into TicketFields and reads no LOB. This
       // backs the My Tickets screen, so it is a request path.
      `SELECT issue_key, jira_id, summary, status_name, status_category, priority_name,
              issuetype_name, assignee_account_id, assignee_display, assignee_email,
              reporter_display, reporter_email, jira_created, jira_updated, labels,
              request_type, current_tier, nurtur_product, tldr_text, agent_summary_text,
              escalation_reason_text, resolution_name, agent_next_update,
              bc_account_number, organisation_name, sla_breach_time, sla_breached
       FROM jira_issue_cache
       WHERE ${col} = ?
         AND project_key IN (${placeholders})
         AND status_category != 'done'
       ORDER BY priority_name ASC, jira_updated DESC`,
      [identifier, ...projects],
    );
  }

  async countOpenForAssignee(accountId: string): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE assignee_account_id = ?
         AND status_category != 'done'`,
      [accountId],
    );
    return row?.cnt ?? 0;
  }

  // ── KPI count queries ──

  async countOpen(project: string): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND resolution_name IS NULL AND status_category != 'done'`,
      [project],
    );
    return row?.cnt ?? 0;
  }

  async countBreachedSla(project: string): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND sla_breached = 1 AND resolution_name IS NULL AND status_category != 'done'`,
      [project],
    );
    return row?.cnt ?? 0;
  }

  async countUnassigned(project: string): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND assignee_account_id IS NULL AND resolution_name IS NULL AND status_category != 'done'`,
      [project],
    );
    return row?.cnt ?? 0;
  }

  async countResolvedSince(project: string, since: Date): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND status_category = 'done' AND jira_updated >= ?`,
      [project, since],
    );
    return row?.cnt ?? 0;
  }

  async countCreatedSince(project: string, since: Date): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND jira_created >= ?`,
      [project, since],
    );
    return row?.cnt ?? 0;
  }

  async countByStatus(project: string, status: string): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND status_name = ? AND status_category != 'done'`,
      [project, status],
    );
    return row?.cnt ?? 0;
  }

  async countByRequestType(project: string, requestType: string): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND request_type = ? AND status_category != 'done'`,
      [project, requestType],
    );
    return row?.cnt ?? 0;
  }

  // ── Board MI queries ──

  async countOpenByAgeBucket(project: string, minAgeHours: number | null, maxAgeHours: number | null, excludeTiers?: string[]): Promise<number> {
    let sql = `SELECT COUNT(*) AS cnt FROM jira_issue_cache WHERE project_key = ? AND status_category != 'done'`;
    const params: unknown[] = [project];
    if (excludeTiers?.length) {
      sql += ` AND (current_tier IS NULL OR current_tier NOT IN (${excludeTiers.map(() => '?').join(',')}))`;
      params.push(...excludeTiers);
    }
    if (maxAgeHours !== null) {
      sql += ` AND jira_created >= DATEADD(hour, ?, GETUTCDATE())`;
      params.push(-maxAgeHours);
    }
    if (minAgeHours !== null) {
      sql += ` AND jira_created < DATEADD(hour, ?, GETUTCDATE())`;
      params.push(-minAgeHours);
    }
    const row = await queryOne<{ cnt: number }>(sql, params);
    return row?.cnt ?? 0;
  }

  async countOpenByTier(project: string, tier: string): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND current_tier = ? AND status_category != 'done'`,
      [project, tier],
    );
    return row?.cnt ?? 0;
  }

  async countOpenByProduct(project: string, products: string[]): Promise<number> {
    const placeholders = products.map(() => '?').join(',');
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND nurtur_product IN (${placeholders}) AND status_category != 'done'`,
      [project, ...products],
    );
    return row?.cnt ?? 0;
  }

  async getTopProducts(project: string, limit = 5, excludeTiers?: string[]): Promise<Array<{ nurtur_product: string; cnt: number }>> {
    let sql = `SELECT TOP (?) nurtur_product, COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND nurtur_product IS NOT NULL AND status_category != 'done'`;
    const params: unknown[] = [limit, project];
    if (excludeTiers?.length) {
      sql += ` AND (current_tier IS NULL OR current_tier NOT IN (${excludeTiers.map(() => '?').join(',')}))`;
      params.push(...excludeTiers);
    }
    sql += ` GROUP BY nurtur_product ORDER BY cnt DESC`;
    return query(sql, params);
  }

  async getOldestByTier(project: string, tier: string): Promise<CachedIssue | null> {
    const row = await queryOne<CachedIssue>(
      `SELECT TOP (1) * FROM jira_issue_cache
       WHERE project_key = ? AND current_tier = ? AND status_category != 'done'
       ORDER BY jira_created ASC`,
      [project, tier],
    );
    return row ?? null;
  }

  async countCreatedInRange(project: string, start: Date, end: Date, excludeTiers?: string[]): Promise<number> {
    let sql = `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND jira_created >= ? AND jira_created <= ?`;
    const params: unknown[] = [project, start, end];
    if (excludeTiers?.length) {
      sql += ` AND (current_tier IS NULL OR current_tier NOT IN (${excludeTiers.map(() => '?').join(',')}))`;
      params.push(...excludeTiers);
    }
    const row = await queryOne<{ cnt: number }>(sql, params);
    return row?.cnt ?? 0;
  }

  async countResolvedInRange(project: string, start: Date, end: Date, excludeTiers?: string[]): Promise<number> {
    let sql = `SELECT COUNT(*) AS cnt FROM jira_issue_cache
       WHERE project_key = ? AND status_category = 'done' AND jira_updated >= ? AND jira_updated <= ?`;
    const params: unknown[] = [project, start, end];
    if (excludeTiers?.length) {
      sql += ` AND (current_tier IS NULL OR current_tier NOT IN (${excludeTiers.map(() => '?').join(',')}))`;
      params.push(...excludeTiers);
    }
    const row = await queryOne<{ cnt: number }>(sql, params);
    return row?.cnt ?? 0;
  }

  // ── SLA queries ──

  async getSlaBreach(project: string): Promise<CachedIssue[]> {
    return query<CachedIssue>(
      `SELECT issue_key, jira_id, summary, status_name, status_category, priority_name,
              issuetype_name, assignee_account_id, assignee_display, assignee_email,
              reporter_display, reporter_email, jira_created, jira_updated, labels,
              request_type, current_tier, nurtur_product, tldr_text, agent_summary_text,
              escalation_reason_text, resolution_name, agent_next_update,
              bc_account_number, organisation_name, sla_breach_time, sla_breached
       FROM jira_issue_cache
       WHERE project_key = ?
         AND sla_breach_time IS NOT NULL
         AND sla_breach_time > GETUTCDATE()
         AND status_category != 'done'
       ORDER BY sla_breach_time ASC`,
      [project],
    );
  }

  async getSlaAtRisk(project: string, withinMs: number): Promise<CachedIssue[]> {
    return query<CachedIssue>(
      `SELECT issue_key, jira_id, summary, status_name, status_category, priority_name,
              issuetype_name, assignee_account_id, assignee_display, assignee_email,
              reporter_display, reporter_email, jira_created, jira_updated, labels,
              request_type, current_tier, nurtur_product, tldr_text, agent_summary_text,
              escalation_reason_text, resolution_name, agent_next_update,
              bc_account_number, organisation_name, sla_breach_time, sla_breached
       FROM jira_issue_cache
       WHERE project_key = ?
         AND sla_breach_time IS NOT NULL
         AND sla_breach_time > GETUTCDATE()
         AND sla_breach_time < DATEADD(millisecond, ?, GETUTCDATE())
         AND status_category != 'done'
       ORDER BY sla_breach_time ASC`,
      [project, withinMs],
    );
  }

  // ── Untriaged ticket detection (agent catch-up) ──

  async getUntriagedIssues(projects: string[], limit = 10, maxAgeDays = 3): Promise<CachedIssue[]> {
    const placeholders = projects.map(() => '?').join(',');
    return query<CachedIssue>(
      `SELECT TOP (?) c.* FROM jira_issue_cache c
       LEFT JOIN agent_ticket_state ts ON ts.ticket_id = c.issue_key
       WHERE c.project_key IN (${placeholders})
         AND c.status_category IN ('new', 'indeterminate')
         AND ts.ticket_id IS NULL
         AND c.jira_created >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY c.jira_created DESC`,
      [limit, ...projects, maxAgeDays],
    );
  }

  async getRestartGapTickets(projects: string[], since: Date): Promise<CachedIssue[]> {
    const placeholders = projects.map(() => '?').join(',');
    return query<CachedIssue>(
      `SELECT c.* FROM jira_issue_cache c
       LEFT JOIN agent_ticket_state ts ON ts.ticket_id = c.issue_key
       WHERE c.project_key IN (${placeholders})
         AND c.jira_created >= ?
         AND ts.ticket_id IS NULL
       ORDER BY c.jira_created DESC`,
      [...projects, since],
    );
  }

  // ── Comment queries ──

  async getComments(issueKey: string, limit = 20): Promise<CachedComment[]> {
    return query<CachedComment>(
      `SELECT TOP (?) * FROM jira_comment_cache
       WHERE issue_key = ?
       ORDER BY jira_created DESC`,
      [limit, issueKey],
    );
  }

  async getRecentComments(issueKey: string, since: Date): Promise<CachedComment[]> {
    return query<CachedComment>(
      `SELECT * FROM jira_comment_cache
       WHERE issue_key = ? AND jira_created >= ?
       ORDER BY jira_created DESC`,
      [issueKey, since],
    );
  }

  // ── Cache metadata ──

  async getCacheStatus(): Promise<SyncStatus> {
    const countRow = await queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM jira_issue_cache');
    const latestRow = await queryOne<{ latest: Date }>('SELECT MAX(synced_at) AS latest FROM jira_issue_cache');
    const lastSync = latestRow?.latest ?? null;
    const ageSeconds = lastSync ? Math.floor((Date.now() - new Date(lastSync).getTime()) / 1000) : null;
    return {
      lastSyncAt: lastSync ? new Date(lastSync).toISOString() : null,
      issueCount: countRow?.cnt ?? 0,
      cacheAgeSeconds: ageSeconds,
    };
  }

  async getTotalCached(): Promise<number> {
    const row = await queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM jira_issue_cache');
    return row?.cnt ?? 0;
  }
}
