import { query, queryOne } from './database.js';

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

  async getOpenIssues(projects: string[]): Promise<CachedIssue[]> {
    const placeholders = projects.map(() => '?').join(',');
    return query<CachedIssue>(
      `SELECT * FROM jira_issue_cache
       WHERE project_key IN (${placeholders})
         AND status_category IN ('new', 'indeterminate')
       ORDER BY jira_created DESC`,
      projects,
    );
  }

  async getRecentlyCreated(projects: string[], since: Date): Promise<CachedIssue[]> {
    const placeholders = projects.map(() => '?').join(',');
    return query<CachedIssue>(
      `SELECT * FROM jira_issue_cache
       WHERE project_key IN (${placeholders})
         AND jira_created >= ?
       ORDER BY jira_created DESC`,
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

  async getTier3Issues(): Promise<CachedIssue[]> {
    return query<CachedIssue>(
      `SELECT * FROM jira_issue_cache
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

  async getByAssignee(email: string, projects: string[]): Promise<CachedIssue[]> {
    const placeholders = projects.map(() => '?').join(',');
    return query<CachedIssue>(
      `SELECT * FROM jira_issue_cache
       WHERE assignee_email = ?
         AND project_key IN (${placeholders})
         AND status_category != 'done'
       ORDER BY priority_name ASC, jira_updated DESC`,
      [email, ...projects],
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
      `SELECT * FROM jira_issue_cache
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
      `SELECT * FROM jira_issue_cache
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
