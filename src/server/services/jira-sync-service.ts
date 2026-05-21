import type { JiraRestClient, JiraIssue, JiraComment } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { query, queryOne, execute } from './database.js';
import { broadcastPortalEvent } from '../routes/portal-events.js';
import { generateCsatSurvey } from '../routes/portal-csat.js';
import { mapJiraStatusToPortal } from './portal-status-mapper.js';

const PRIORITY_NORMALIZE: Record<string, string> = {
  '最高': 'Highest', '高': 'High', '中': 'Medium', '低': 'Low', '最低': 'Lowest',
  '高い': 'High', '低い': 'Low',
  '최고': 'Highest', '높음': 'High', '중간': 'Medium', '낮음': 'Low', '최저': 'Lowest',
};

function normalisePriorityName(raw: string | null): string | null {
  if (!raw) return null;
  return PRIORITY_NORMALIZE[raw] ?? raw;
}

const ALL_FIELDS = [
  'summary', 'description', 'status', 'priority', 'issuetype',
  'assignee', 'reporter', 'created', 'updated', 'duedate',
  'resolution', 'labels', 'issuelinks', 'attachment',
  'customfield_10010', // SLA (legacy — not returned by API)
  'customfield_10020', // JSM customer request type (legacy — not used for CC bucketing)
  'customfield_12800', // Request type fallback
  'customfield_12981', // Current Tier
  'customfield_13482', // Request type (CC bucket classification)
  'customfield_13183', // Nurtur Product
  'customfield_13184', // TL;DR
  'customfield_13185', // Agent Summary
  'customfield_13186', // Escalation Reason
  'customfield_13212', // Troubleshooting
  'customfield_13213', // Issue Environment
  'customfield_13214', // Expected Outcome
  'customfield_13215', // Development Details
  'customfield_14046', // First Reply Time SLA
  'customfield_14048', // Resolution SLA
  'customfield_14081', // Agent Last Updated
  'customfield_14185', // Agent Next Update
  'customfield_14494', // Resolution type
  'customfield_14527', // Problem ticket field
  'customfield_14626', // BC Account Number
];

export class JiraSyncService {
  private jiraClient: JiraRestClient;
  private settings: SettingsQueries;
  private lastSyncAt: Date | null = null;
  private syncing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fullSyncDone = false;
  private consecutiveErrors = 0;

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries) {
    this.jiraClient = jiraClient;
    this.settings = settings;
  }

  getStatus() {
    return {
      lastSyncAt: this.lastSyncAt?.toISOString() ?? null,
      syncing: this.syncing,
      fullSyncDone: this.fullSyncDone,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  isReady(): boolean {
    return this.fullSyncDone;
  }

  start(intervalMs = 45_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.incrementalSync(), intervalMs);
    console.log(`[jira-sync] Started incremental sync every ${intervalMs / 1000}s`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private buildProjectFilter(): string {
    // Merge agent_jira_project (AI triage) + assignment_projects (round-robin)
    // so the cache contains tickets from both scopes.
    const agentRaw = this.settings.get('agent_jira_project') || 'NT';
    const assignRaw = this.settings.get('assignment_projects') || '';
    const all = new Set([
      ...agentRaw.split(',').map(p => p.trim()).filter(Boolean),
      ...assignRaw.split(',').map(p => p.trim()).filter(Boolean),
    ]);
    return [...all].join(', ');
  }

  private buildProjectJql(): string {
    const projects = this.buildProjectFilter();
    if (!projects) throw new Error('No projects configured — cannot build JQL');
    if (!projects.includes(',')) return `project = ${projects}`;
    return `project IN (${projects})`;
  }

  async fullSync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    const start = Date.now();
    let issueCount = 0;
    let commentCount = 0;

    try {
      const projectJql = this.buildProjectJql();
      console.log('[jira-sync] Starting full sync...');

      // Fetch all open + recently closed issues
      const jql = `${projectJql} AND (statusCategory != Done OR updated >= -7d) ORDER BY updated DESC`;
      const result = await this.jiraClient.searchJqlAll(jql, ALL_FIELDS, 2000);
      console.log(`[jira-sync] Full sync fetched ${result.issues.length} issues`);

      // Upsert individually — tolerate per-issue failures so the sync completes
      let upsertErrors = 0;
      for (const issue of result.issues) {
        try {
          await this.upsertIssue(issue);
          issueCount++;
        } catch (err) {
          upsertErrors++;
          if (upsertErrors <= 3) {
            console.warn(`[jira-sync] Failed to sync ${issue.key}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }

      // Mark cache as active even if some issues failed — partial data is better than no data
      this.lastSyncAt = new Date();
      this.fullSyncDone = true;
      this.consecutiveErrors = 0;

      const issueDuration = Date.now() - start;
      console.log(`[jira-sync] Issue sync complete: ${issueCount} issues in ${issueDuration}ms${upsertErrors > 0 ? ` (${upsertErrors} failed)` : ''} — cache now active`);

      // Backfill comments for open issues in background (non-blocking)
      const openIssues = result.issues.filter(i =>
        (i.fields.status as any)?.statusCategory?.key !== 'done'
      );
      console.log(`[jira-sync] Backfilling comments for ${openIssues.length} open issues...`);

      for (const issue of openIssues) {
        try {
          const comments = await this.jiraClient.getComments(issue.key, 20);
          for (const comment of comments) {
            await this.upsertComment(issue.key, comment);
            commentCount++;
          }
          await this.updateLastPublicComment(issue.key);
          await this.updateLastN8nComment(issue.key);
        } catch (err) {
          console.warn(`[jira-sync] Failed to sync comments for ${issue.key}:`, err instanceof Error ? err.message : err);
        }
      }

      const duration = Date.now() - start;
      console.log(`[jira-sync] Full sync complete: ${issueCount} issues, ${commentCount} comments in ${duration}ms`);

      await this.recordSync('full', issueCount, commentCount, duration);
    } catch (err) {
      this.consecutiveErrors++;
      const duration = Date.now() - start;
      console.error('[jira-sync] Full sync failed:', err instanceof Error ? err.message : err);
      await this.recordSync('full', issueCount, commentCount, duration, err instanceof Error ? err.message : String(err));
    } finally {
      this.syncing = false;
    }
  }

  async incrementalSync(): Promise<void> {
    if (this.syncing) return;
    if (!this.lastSyncAt) {
      await this.fullSync();
      return;
    }

    this.syncing = true;
    const start = Date.now();
    let issueCount = 0;
    let commentCount = 0;

    try {
      const projectJql = this.buildProjectJql();
      // Look back slightly further than lastSync to avoid missing edge cases
      const since = new Date(this.lastSyncAt.getTime() - 30_000);
      const sinceJql = formatJqlDate(since);

      const jql = `${projectJql} AND updated >= "${sinceJql}" ORDER BY updated ASC`;
      const result = await this.jiraClient.searchJqlAll(jql, ALL_FIELDS, 500);

      for (const issue of result.issues) {
        await this.upsertIssue(issue);
        issueCount++;

        // Re-fetch comments for updated issues
        try {
          const comments = await this.jiraClient.getComments(issue.key, 20);
          for (const comment of comments) {
            await this.upsertComment(issue.key, comment);
            commentCount++;
          }
          await this.updateLastPublicComment(issue.key);
          await this.updateLastN8nComment(issue.key);
        } catch (err) {
          console.warn(`[jira-sync] Failed to sync comments for ${issue.key}:`, err instanceof Error ? err.message : err);
        }
      }

      this.lastSyncAt = new Date();
      this.consecutiveErrors = 0;

      if (issueCount > 0) {
        const duration = Date.now() - start;
        console.log(`[jira-sync] Incremental sync: ${issueCount} issues, ${commentCount} comments (${duration}ms)`);
      }
    } catch (err) {
      this.consecutiveErrors++;
      console.error('[jira-sync] Incremental sync failed:', err instanceof Error ? err.message : err);
    } finally {
      this.syncing = false;
    }
  }

  async syncSingleIssue(issueKey: string): Promise<void> {
    try {
      const issue = await this.jiraClient.getIssue(issueKey, ALL_FIELDS);
      if (!issue) return;
      await this.upsertIssue(issue);

      const comments = await this.jiraClient.getComments(issueKey, 20);
      for (const comment of comments) {
        await this.upsertComment(issueKey, comment);
      }
      await this.updateLastPublicComment(issueKey);
      await this.updateLastN8nComment(issueKey);
    } catch (err) {
      console.warn(`[jira-sync] Failed to sync ${issueKey}:`, err instanceof Error ? err.message : err);
    }
  }

  private async upsertIssue(issue: JiraIssue): Promise<void> {
    const f = issue.fields;
    const status = f.status as any;
    const assignee = f.assignee as any;
    const reporter = f.reporter as any;
    const priority = f.priority as any;
    const issuetype = f.issuetype as any;
    const resolution = f.resolution as any;

    // Normalise status name: Jira returns localised names (e.g. Chinese) depending on
    const priorityName = normalisePriorityName(priority?.name as string | undefined ?? null);

    // the API user's locale. Fall back to statusCategory for non-ASCII names.
    const statusName = (() => {
      const name = status?.name as string | undefined;
      if (name && /^[\x20-\x7E]+$/.test(name)) return name;
      const cat = status?.statusCategory;
      if (cat?.name && /^[\x20-\x7E]+$/.test(cat.name as string)) return cat.name as string;
      const keyMap: Record<string, string> = { new: 'Open', indeterminate: 'In Progress', done: 'Done' };
      return keyMap[cat?.key as string] ?? (cat?.key as string) ?? name ?? null;
    })();

    const descriptionText = extractText(f.description);
    const descriptionAdf = f.description ? JSON.stringify(f.description) : null;
    const currentTier = (f.customfield_12981 as any)?.value ?? null;
    const nurturProduct = (f.customfield_13183 as any)?.value ?? null;
    const cf13482 = f.customfield_13482 as any;
    const requestType: string | null = (cf13482?.value ?? cf13482?.name ?? (typeof cf13482 === 'string' ? cf13482 : null)) || null;
    const tldrText = extractText(f.customfield_13184);
    const agentSummaryText = extractText(f.customfield_13185);
    const troubleshootingText = extractText(f.customfield_13212);
    const escalationReasonText = extractText(f.customfield_13186);
    const expectedOutcomeText = extractText(f.customfield_13214);
    const issueEnvironmentText = extractText(f.customfield_13213);
    const developmentDetailsText = extractText(f.customfield_13215);
    const resolutionType = (f.customfield_14494 as any)?.value ?? null;
    const bcAccountNumber = (f.customfield_14626 as string) ?? null;
    const agentNextUpdate = f.customfield_14185 ? new Date(f.customfield_14185 as string) : null;
    const agentLastUpdated = f.customfield_14081 ? new Date(f.customfield_14081 as string) : null;
    const organisationName = (() => {
      const orgs = f.customfield_10002 as any;
      if (Array.isArray(orgs) && orgs.length > 0) return orgs[0]?.name ?? null;
      if (orgs?.name) return orgs.name;
      return null;
    })();
    const slaBreachTime = extractSlaBreachTime(f.customfield_10010);
    const slaBreached = extractSlaBreached(f.customfield_10010);
    const noReply = computeNoReply(
      statusName,
      f.created as string | null,
      f.customfield_14081 as string | null,
      f.customfield_14185 as string | null,
    );
    const labels = Array.isArray(f.labels) ? (f.labels as string[]).join(';') : null;
    const issueLinksJson = f.issuelinks ? JSON.stringify(f.issuelinks) : null;
    const fieldsJson = JSON.stringify(f);

    // Detect changes for portal SSE broadcast
    const oldRow = await queryOne<{ status_name: string | null; assignee_display: string | null; reporter_email: string | null; current_tier: string | null }>(
      `SELECT status_name, assignee_display, reporter_email, current_tier FROM jira_issue_cache WHERE issue_key = ?`,
      [issue.key],
    );

    await execute(`
      MERGE jira_issue_cache AS target
      USING (SELECT ? AS issue_key) AS source ON target.issue_key = source.issue_key
      WHEN MATCHED THEN UPDATE SET
        jira_id = ?, project_key = ?, summary = ?, description_text = ?, description_adf = ?,
        status_name = ?, status_category = ?, priority_name = ?, issuetype_name = ?,
        resolution_name = ?, assignee_account_id = ?, assignee_display = ?, assignee_email = ?,
        reporter_account_id = ?, reporter_display = ?, reporter_email = ?,
        jira_created = ?, jira_updated = ?, due_date = ?,
        current_tier = ?, nurtur_product = ?, request_type = ?,
        tldr_text = ?, agent_summary_text = ?, troubleshooting_text = ?,
        escalation_reason_text = ?, expected_outcome_text = ?, issue_environment_text = ?,
        development_details_text = ?, resolution_type = ?,
        agent_next_update = ?, agent_last_updated = ?,
        sla_breach_time = ?, sla_breached = ?, no_reply = ?, labels = ?,
        issue_links_json = ?, fields_json = ?, organisation_name = ?, bc_account_number = ?,
        resolved_at = ?, synced_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (
        issue_key, jira_id, project_key, summary, description_text, description_adf,
        status_name, status_category, priority_name, issuetype_name,
        resolution_name, assignee_account_id, assignee_display, assignee_email,
        reporter_account_id, reporter_display, reporter_email,
        jira_created, jira_updated, due_date,
        current_tier, nurtur_product, request_type,
        tldr_text, agent_summary_text, troubleshooting_text,
        escalation_reason_text, expected_outcome_text, issue_environment_text,
        development_details_text, resolution_type,
        agent_next_update, agent_last_updated,
        sla_breach_time, sla_breached, no_reply, labels,
        issue_links_json, fields_json, organisation_name, bc_account_number, resolved_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      );`,
      [
        // Source key
        issue.key,
        // UPDATE values
        issue.id, issue.key.split('-')[0], f.summary as string ?? null,
        descriptionText || null, descriptionAdf,
        statusName, status?.statusCategory?.key ?? null,
        priorityName, issuetype?.name ?? null,
        resolution?.name ?? null,
        assignee?.accountId ?? null, assignee?.displayName ?? null, assignee?.emailAddress ?? null,
        reporter?.accountId ?? null, reporter?.displayName ?? null, reporter?.emailAddress ?? null,
        f.created ? new Date(f.created as string) : null,
        f.updated ? new Date(f.updated as string) : null,
        f.duedate ? new Date(f.duedate as string) : null,
        currentTier, nurturProduct, requestType,
        tldrText || null, agentSummaryText || null, troubleshootingText || null,
        escalationReasonText || null, expectedOutcomeText || null, issueEnvironmentText || null,
        developmentDetailsText || null, resolutionType,
        agentNextUpdate, agentLastUpdated,
        slaBreachTime ? new Date(slaBreachTime) : null, slaBreached, noReply, labels,
        issueLinksJson, fieldsJson, organisationName, bcAccountNumber,
        f.resolutiondate ? new Date(f.resolutiondate as string) : null,
        // INSERT values (same order as columns)
        issue.key, issue.id, issue.key.split('-')[0], f.summary as string ?? null,
        descriptionText || null, descriptionAdf,
        statusName, status?.statusCategory?.key ?? null,
        priorityName, issuetype?.name ?? null,
        resolution?.name ?? null,
        assignee?.accountId ?? null, assignee?.displayName ?? null, assignee?.emailAddress ?? null,
        reporter?.accountId ?? null, reporter?.displayName ?? null, reporter?.emailAddress ?? null,
        f.created ? new Date(f.created as string) : null,
        f.updated ? new Date(f.updated as string) : null,
        f.duedate ? new Date(f.duedate as string) : null,
        currentTier, nurturProduct, requestType,
        tldrText || null, agentSummaryText || null, troubleshootingText || null,
        escalationReasonText || null, expectedOutcomeText || null, issueEnvironmentText || null,
        developmentDetailsText || null, resolutionType,
        agentNextUpdate, agentLastUpdated,
        slaBreachTime ? new Date(slaBreachTime) : null, slaBreached, noReply, labels,
        issueLinksJson, fieldsJson, organisationName, bcAccountNumber,
        f.resolutiondate ? new Date(f.resolutiondate as string) : null,
      ],
    );

    // Log tier changes to escalation_log for KPI pipeline
    if (oldRow && currentTier && oldRow.current_tier && currentTier !== oldRow.current_tier) {
      try {
        await execute(`
          INSERT INTO escalation_log
            (ticket_key, escalation_type, from_tier, to_tier, escalated_by, notes, source, created_at)
          SELECT ?, 'jira_transition', ?, ?, ?, ?, 'jira_sync', GETUTCDATE()
          WHERE NOT EXISTS (
            SELECT 1 FROM escalation_log
            WHERE ticket_key = ? AND from_tier = ? AND to_tier = ? AND source = 'jira_sync'
              AND ABS(DATEDIFF(minute, created_at, GETUTCDATE())) < 5
          )`,
          [
            issue.key, oldRow.current_tier, currentTier,
            (assignee?.displayName as string) ?? 'system',
            `Tier change: ${oldRow.current_tier} → ${currentTier}`,
            issue.key, oldRow.current_tier, currentTier,
          ],
        );
      } catch (err) {
        console.warn(`[jira-sync] Failed to log tier change for ${issue.key}:`, err instanceof Error ? err.message : err);
      }
    }

    // Broadcast portal SSE events on detected changes
    if (oldRow) {
      const reporterEmail = reporter?.emailAddress as string | null;
      if (reporterEmail) {
        const orgRow = await queryOne<{ org_id: number }>(
          `SELECT o.id AS org_id FROM portal_organisations o
           JOIN portal_users u ON u.org_id = o.id
           WHERE u.email = ?`,
          [reporterEmail],
        ).catch(() => null);

        if (orgRow) {
          const previousPortalStatus = mapJiraStatusToPortal(oldRow.status_name, this.settings);
          const nextPortalStatus = mapJiraStatusToPortal(statusName, this.settings);

          if (previousPortalStatus !== nextPortalStatus) {
            broadcastPortalEvent(orgRow.org_id, {
              type: 'ticket:status_change',
              ticketKey: issue.key,
              data: { from: previousPortalStatus, to: nextPortalStatus },
            });
          }
          const newAssignee = assignee?.displayName ?? null;
          if (oldRow.assignee_display !== newAssignee) {
            broadcastPortalEvent(orgRow.org_id, {
              type: 'ticket:assignment_change',
              ticketKey: issue.key,
              data: { from: oldRow.assignee_display, to: newAssignee },
            });
          }
        }
      }

      // CSAT trigger: if status changed to a resolved state, generate survey
      if (oldRow && oldRow.status_name !== statusName) {
        const resolvedStates = ['Closed', 'Resolved', 'Done'];
        if (statusName && resolvedStates.includes(statusName)) {
          const reporterEmail = reporter?.emailAddress as string | null;
          generateCsatSurvey(issue.key, reporterEmail).catch(err => {
            console.warn(`[jira-sync] CSAT survey generation failed for ${issue.key}:`, err);
          });
        }
      }
    }
  }

  private async upsertComment(issueKey: string, comment: JiraComment): Promise<void> {
    const bodyText = extractText(comment.body);
    const bodyAdf = comment.body ? JSON.stringify(comment.body) : null;
    const isPublic = comment.jsdPublic !== false;

    await execute(`
      MERGE jira_comment_cache AS target
      USING (SELECT ? AS jira_comment_id) AS source ON target.jira_comment_id = source.jira_comment_id
      WHEN MATCHED THEN UPDATE SET
        issue_key = ?, author_account_id = ?, author_display = ?, author_email = ?,
        body_text = ?, body_adf = ?, is_public = ?,
        jira_created = ?, jira_updated = ?, synced_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (
        jira_comment_id, issue_key, author_account_id, author_display, author_email,
        body_text, body_adf, is_public, jira_created, jira_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        comment.id,
        // UPDATE
        issueKey,
        comment.author?.accountId ?? null, comment.author?.displayName ?? null,
        comment.author?.emailAddress ?? null,
        bodyText || null, bodyAdf, isPublic,
        new Date(comment.created), new Date(comment.updated),
        // INSERT
        comment.id, issueKey,
        comment.author?.accountId ?? null, comment.author?.displayName ?? null,
        comment.author?.emailAddress ?? null,
        bodyText || null, bodyAdf, isPublic,
        new Date(comment.created), new Date(comment.updated),
      ],
    );
  }

  async updateLastN8nComment(issueKey: string): Promise<void> {
    try {
      const authorEmails = (this.settings.get('n8n_comment_author_emails') || 'Alerts@Nurtur.tech')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const authorNames = (this.settings.get('n8n_comment_author_display_names') || 'Nurtur')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const bodyMarker = this.settings.get('n8n_comment_body_marker') || 'AI Summary';

      const emailClauses = authorEmails.map(() => 'LOWER(author_email) = ?');
      const nameClauses = authorNames.map(() => 'LOWER(author_display) = ?');
      const authorFilter = [...emailClauses, ...nameClauses].join(' OR ');

      await execute(`
        UPDATE jira_issue_cache SET
          last_n8n_comment = sub.body_text,
          last_n8n_comment_at = sub.jira_created,
          last_n8n_comment_author = sub.author_display
        FROM jira_issue_cache j
        CROSS APPLY (
          SELECT TOP 1 body_text, jira_created, author_display
          FROM jira_comment_cache c
          WHERE c.issue_key = ?
            AND (${authorFilter})
            AND c.body_text LIKE ?
          ORDER BY c.jira_created DESC
        ) sub
        WHERE j.issue_key = ?`,
        [issueKey, ...authorEmails, ...authorNames, `%${bodyMarker}%`, issueKey],
      );
    } catch { /* non-critical — don't fail the sync */ }
  }

  private async updateLastPublicComment(issueKey: string): Promise<void> {
    try {
      await execute(`
        UPDATE jira_issue_cache SET
          last_public_comment = (
            SELECT TOP 1 body_text FROM jira_comment_cache
            WHERE issue_key = ? AND is_public = 1 AND body_text IS NOT NULL
            ORDER BY jira_created DESC
          ),
          last_public_comment_updated_at = GETUTCDATE()
        WHERE issue_key = ?`,
        [issueKey, issueKey],
      );
    } catch { /* non-critical — don't fail the sync */ }
  }

  private async recordSync(
    type: string, issues: number, comments: number, durationMs: number, error?: string,
  ): Promise<void> {
    try {
      const projects = this.settings.get('agent_jira_project') || 'NT';
      await execute(
        `INSERT INTO jira_sync_state (sync_type, project_key, last_synced_at, issues_synced, comments_synced, duration_ms, error)
         VALUES (?, ?, GETUTCDATE(), ?, ?, ?, ?)`,
        [type, projects, issues, comments, durationMs, error ?? null],
      );
    } catch { /* don't fail the sync for logging issues */ }
  }
}

function extractTextFromInlineNodes(nodes: any[]): string {
  return nodes.map((c: any) => {
    if (c.type === 'text') return c.text ?? '';
    if (c.type === 'hardBreak') return '\n';
    if (c.type === 'mention') return c.attrs?.text ?? `@${c.attrs?.id ?? 'unknown'}`;
    if (c.type === 'inlineCard' && c.attrs?.url) return c.attrs.url;
    if (c.type === 'emoji') return c.attrs?.shortName ?? '';
    return c.text ?? '';
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
  if (node.type === 'table') {
    return (node.content ?? []).map((row: any) =>
      (row.content ?? []).map((cell: any) =>
        (cell.content ?? []).map(extractTextFromNode).join(' ')
      ).join(' | ')
    ).join('\n');
  }
  if (Array.isArray(node.content)) return node.content.map(extractTextFromNode).join('\n');
  return node.text ?? '';
}

function extractText(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  if (typeof adf === 'string') return adf;
  try {
    const content = (adf as any).content;
    if (!Array.isArray(content)) return JSON.stringify(adf).slice(0, 2000);
    return content.map(extractTextFromNode).join('\n').trim();
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

function extractSlaBreached(slaField: unknown): boolean {
  if (!slaField || typeof slaField !== 'object') return false;
  try {
    const completed = (slaField as any)?.completedCycles;
    if (Array.isArray(completed)) {
      return completed.some((c: any) => c.breached === true);
    }
  } catch { /* ignore */ }
  return false;
}

function computeNoReply(
  statusName: string | null,
  createdStr: string | null,
  agentLastUpdated: string | null,
  agentNextUpdate: string | null,
): boolean {
  if (!statusName || statusName.toLowerCase() === 'waiting on requestor') return false;
  if (!createdStr) return false;
  const now = Date.now();
  const created = new Date(createdStr).getTime();
  if (now - created < 4 * 60 * 60 * 1000) return false;
  if (agentNextUpdate) {
    const nextUpdate = new Date(agentNextUpdate).getTime();
    if (nextUpdate > now) return false;
  }
  if (!agentLastUpdated) return false;
  const lastUpdated = new Date(agentLastUpdated).getTime();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (lastUpdated >= todayStart.getTime()) return false;
  const weeksAgo52 = now - 52 * 7 * 24 * 60 * 60 * 1000;
  if (lastUpdated < weeksAgo52) return false;
  return true;
}

function formatJqlDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}
