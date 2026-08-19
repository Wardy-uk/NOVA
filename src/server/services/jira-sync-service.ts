import type { JiraRestClient, JiraIssue, JiraComment } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { AssignmentEngine, Pool } from './assignment-engine.js';
import { query, queryOne, execute } from './database.js';
import { classifyTierMove } from './tier-move-classifier.js';
import { logError } from './error-log.js';
import { broadcastPortalEvent } from '../routes/portal-events.js';
import { generateCsatSurvey } from '../routes/portal-csat.js';
import { mapJiraStatusToPortal } from './portal-status-mapper.js';
import { noReplyCutoff } from './shared/no-reply.js';
import { poolForTicket } from './shared/ticket-pool.js';

const PRIORITY_NORMALIZE: Record<string, string> = {
  '最高': 'Highest', '高': 'High', '中': 'Medium', '低': 'Low', '最低': 'Lowest',
  '高い': 'High', '低い': 'Low',
  '최고': 'Highest', '높음': 'High', '중간': 'Medium', '낮음': 'Low', '최저': 'Lowest',
};

function normalisePriorityName(raw: string | null): string | null {
  if (!raw) return null;
  return PRIORITY_NORMALIZE[raw] ?? raw;
}

/** A sync running longer than this is assumed dead, and its slot is reclaimed. */
const STALL_CEILING_MS = 30 * 60_000;

const ALL_FIELDS = [
  'summary', 'description', 'status', 'priority', 'issuetype',
  'assignee', 'reporter', 'created', 'updated', 'duedate',
  'resolution', 'resolutiondate', 'labels', 'issuelinks', 'attachment',
  'customfield_10010', // SLA (legacy — not returned by API)
  'customfield_10020', // JSM customer request type (legacy — not used for CC bucketing)
  'customfield_12800', // Request type fallback
  'customfield_12981', // Current Tier
  'customfield_13482', // Request type (CC bucket classification)
  'customfield_13183', // Nurtur Product
  'customfield_13184', // TL;DR
  'customfield_13185', // Agent Summary
  'customfield_13186', // Escalation Reason
  // Rejection Reason — mandatory on the "Submit for Rejection to ..." transition
  // screen, so every handback carries one. Without it the escalation log can say
  // how often work is returned but never why, which is the half the Support
  // Review actually complained about.
  'customfield_13216',
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
  'customfield_12802', // Customer Satisfaction (CSAT rating)
  'customfield_11706', // Story Points (NTPJ bespoke metric) — captured into fields_json; see clean-sheet KPI design
];

export class JiraSyncService {
  private jiraClient: JiraRestClient;
  private settings: SettingsQueries;
  private lastSyncAt: Date | null = null;
  private syncing = false;
  private syncStartedAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fullSyncDone = false;
  private consecutiveErrors = 0;
  private assignmentEngine: AssignmentEngine | null = null;

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries) {
    this.jiraClient = jiraClient;
    this.settings = settings;
  }

  /** Injected post-construction (assignment engine is built later in index.ts). Enables
   *  event-driven round-robin the moment a tier escalation clears the assignee, rather
   *  than waiting on the periodic unassigned sweep. */
  setAssignmentEngine(engine: AssignmentEngine): void {
    this.assignmentEngine = engine;
  }

  /** Take the single-sync slot. Returns false if a sync is genuinely in flight.
   *  If the in-flight sync has been running longer than STALL_CEILING_MS it is
   *  treated as dead and the slot is reclaimed — otherwise one wedged request
   *  silently stops all syncing until the next restart. */
  private claimSyncSlot(): boolean {
    if (this.syncing) {
      const runningMs = this.syncStartedAt ? Date.now() - this.syncStartedAt : 0;
      if (runningMs < STALL_CEILING_MS) return false;
      console.warn(`[jira-sync] Previous sync stalled for ${Math.round(runningMs / 60_000)}m — reclaiming sync slot`);
    }
    this.syncing = true;
    this.syncStartedAt = Date.now();
    return true;
  }

  private releaseSyncSlot(): void {
    this.syncing = false;
    this.syncStartedAt = null;
  }

  getStatus() {
    return {
      lastSyncAt: this.lastSyncAt?.toISOString() ?? null,
      syncing: this.syncing,
      syncRunningMs: this.syncStartedAt ? Date.now() - this.syncStartedAt : null,
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
    if (!this.claimSyncSlot()) return;
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

      // Every upsert failing is not a partial sync, it's a broken one (a bad
      // MERGE froze the cache for 20h on 18 Aug while lastSyncAt kept advancing,
      // so everything downstream still believed the cache was current).
      if (issueCount === 0 && upsertErrors > 0) {
        throw new Error(`All ${upsertErrors} issue upserts failed — cache not updated`);
      }

      // Mark cache as active even if some issues failed — partial data is better than no data
      this.lastSyncAt = new Date();
      this.fullSyncDone = true;
      this.consecutiveErrors = 0;

      const issueDuration = Date.now() - start;
      console.log(`[jira-sync] Issue sync complete: ${issueCount} issues in ${issueDuration}ms${upsertErrors > 0 ? ` (${upsertErrors} failed)` : ''} — cache now active`);

      // Reconciliation sweep: remove rows not touched by this full sync.
      // Safety guard: only sweep if we upserted a credible number of issues (≥50)
      // to avoid wiping the cache on a partial/failed Jira fetch.
      const RECONCILIATION_MIN_ISSUES = 50;
      if (issueCount >= RECONCILIATION_MIN_ISSUES) {
        try {
          const syncStartIso = new Date(start).toISOString();
          const projects = this.buildProjectFilter();
          const projectKeys = projects.split(',').map(p => p.trim()).filter(Boolean);
          const placeholders = projectKeys.map(() => '?').join(', ');

          // Batch delete to avoid Azure SQL request timeout on large stale sets
          let totalSwept = 0;
          const BATCH_SIZE = 100;
          let batchAffected: number;
          do {
            const batchResult = await execute(
              `DELETE TOP (${BATCH_SIZE}) FROM jira_issue_cache WHERE project_key IN (${placeholders}) AND synced_at < ?`,
              [...projectKeys, syncStartIso]
            );
            batchAffected = batchResult.rowsAffected;
            totalSwept += batchAffected;
            if (batchAffected === BATCH_SIZE) await new Promise(r => setTimeout(r, 200));
          } while (batchAffected === BATCH_SIZE);

          console.log(`[jira-sync] Reconciliation sweep: removed ${totalSwept} stale rows (synced before ${syncStartIso})`);
        } catch (err) {
          console.warn('[jira-sync] Reconciliation sweep failed (non-fatal):', err instanceof Error ? err.message : err);
        }
      } else {
        console.log(`[jira-sync] Reconciliation sweep skipped: only ${issueCount} issues upserted (minimum ${RECONCILIATION_MIN_ISSUES})`);
      }

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
      void logError('jira-sync', err, { severity: 'critical', context: { phase: 'full' } });
      await this.recordSync('full', issueCount, commentCount, duration, err instanceof Error ? err.message : String(err));
    } finally {
      this.releaseSyncSlot();
    }
  }

  async incrementalSync(): Promise<void> {
    if (this.syncing && this.syncStartedAt && Date.now() - this.syncStartedAt < STALL_CEILING_MS) return;
    if (!this.lastSyncAt) {
      await this.fullSync();
      return;
    }

    if (!this.claimSyncSlot()) return;
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
      void logError('jira-sync', err, { context: { phase: 'incremental' } });
    } finally {
      this.releaseSyncSlot();
    }
  }

  async syncSingleIssue(issueKey: string): Promise<void> {
    try {
      const issue = await this.jiraClient.getIssue(issueKey, ALL_FIELDS);
      if (!issue) {
        await execute('DELETE FROM jira_issue_cache WHERE issue_key = ?', [issueKey]);
        console.log(`[jira-sync] Deleted confirmed-missing issue ${issueKey} from cache`);
        return;
      }
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

  /** Reconcile one assignee's cached open queue against live Jira.
   *  A ticket deleted in Jira never appears in the incremental sync (it produces no
   *  `updated` event), so it lingers in the cache until the next full sync — i.e. a
   *  server restart. This re-checks any cached row the live query no longer returns:
   *  confirmed-missing issues are dropped, the rest are re-upserted with fresh state. */
  async reconcileAssigneeQueue(accountId: string, projects: string[]): Promise<{ checked: number; removed: number }> {
    const projectKeys = projects.map(p => p.trim()).filter(Boolean);
    if (!accountId || projectKeys.length === 0) return { checked: 0, removed: 0 };

    const placeholders = projectKeys.map(() => '?').join(', ');
    const cached = await query<{ issue_key: string }>(
      `SELECT issue_key FROM jira_issue_cache
       WHERE assignee_account_id = ? AND project_key IN (${placeholders}) AND status_category != 'done'`,
      [accountId, ...projectKeys],
    );
    if (cached.length === 0) return { checked: 0, removed: 0 };

    const projectJql = projectKeys.length > 1 ? `project IN (${projectKeys.join(', ')})` : `project = ${projectKeys[0]}`;
    const live = await this.jiraClient.searchJqlAll(
      `${projectJql} AND assignee = "${accountId}" AND statusCategory != Done`,
      ['summary'],
      500,
    );
    const liveKeys = new Set(live.issues.map(i => i.key));

    // Bound the per-issue re-check so a badly out-of-sync cache can't stall the request.
    const stale = cached.filter(c => !liveKeys.has(c.issue_key)).slice(0, 50);
    let removed = 0;
    for (const { issue_key } of stale) {
      const issue = await this.jiraClient.getIssue(issue_key, ALL_FIELDS);
      if (!issue) {
        await execute('DELETE FROM jira_issue_cache WHERE issue_key = ?', [issue_key]);
        console.log(`[jira-sync] Reconcile: dropped deleted issue ${issue_key} from cache`);
        removed++;
      } else {
        await this.upsertIssue(issue);
      }
    }
    return { checked: stale.length, removed };
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
    // customfield_14048 = Resolution SLA. It was customfield_10010, which this
    // sync has never fetched — the field list above asks Jira for 14046 and
    // 14048 — so both columns were silently 0/NULL on all 5,600+ cached rows
    // since the day they were added, and everything downstream trusting them was
    // quietly wrong. 14048 is the same field the wallboards count with
    // `cf[14048] = breached()`, so the column now agrees with the boards.
    const slaBreachTime = extractSlaBreachTime(f.customfield_14048);
    const slaBreached = extractSlaBreached(f.customfield_14048);
    const noReply = computeNoReply(
      statusName,
      f.created as string | null,
      f.customfield_14081 as string | null,
      f.customfield_14185 as string | null,
      currentTier,
    );
    const labels = Array.isArray(f.labels) ? (f.labels as string[]).join(';') : null;
    const issueLinksJson = f.issuelinks ? JSON.stringify(f.issuelinks) : null;
    const fieldsJson = JSON.stringify(f);
    // Rejection Reason. Cached so the next pass can tell whether it CHANGED,
    // which is what separates a fresh rejection from a field set weeks ago.
    const rejectionReasonText = typeof f.customfield_13216 === 'string'
      ? f.customfield_13216.trim().slice(0, 500) || null
      : null;

    // Detect changes for portal SSE broadcast
    const oldRow = await queryOne<{ status_name: string | null; assignee_display: string | null; reporter_email: string | null; current_tier: string | null; rejection_reason_text: string | null }>(
      `SELECT status_name, assignee_display, reporter_email, current_tier, rejection_reason_text FROM jira_issue_cache WHERE issue_key = ?`,
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
        issue_links_json = ?, rejection_reason_text = ?, fields_json = ?, organisation_name = ?, bc_account_number = ?,
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
        issue_links_json, rejection_reason_text, fields_json, organisation_name, bc_account_number, resolved_at
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
        ?, ?, ?, ?, ?, ?
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
        issueLinksJson, rejectionReasonText, fieldsJson, organisationName, bcAccountNumber,
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
        issueLinksJson, rejectionReasonText, fieldsJson, organisationName, bcAccountNumber,
        f.resolutiondate ? new Date(f.resolutiondate as string) : null,
      ],
    );

    // Log tier changes to escalation_log for KPI pipeline
    if (oldRow && currentTier && oldRow.current_tier && currentTier !== oldRow.current_tier) {
      // Direction decides the type. Every tier move used to be logged as
      // 'jira_transition' regardless of which way it went, which is why
      // `escalation_type = 'rejection'` returned zero across the whole table
      // while 139 tickets were visibly ping-ponging. The columns held the
      // direction all along; nothing read it.
      //
      // null means neither — one end of the move is off the tier ladder
      // (Escalations, Production), and guessing would manufacture handbacks.
      // What the move MEANT, not merely which way it went.
      //
      // Direction alone is not enough, and getting this wrong does real damage:
      // Development → Customer Care is usually a released fix coming back to be
      // tested and confirmed, not a rejection. Logging those as rejections
      // reports successful delivery as friction and aims the improvement effort
      // at the part of the flow that is working. The classifier demands evidence
      // and returns "unclassified" when it has none.
      const move = classifyTierMove({
        fromTier: oldRow.current_tier as string | null,
        toTier: currentTier,
        ownProject: issue.key.split('-')[0] ?? '',
        // The reason PERSISTS once set, so its presence proves the ticket was
        // rejected at some point in its life, not that THIS move was one. A
        // change proves the rejection screen was used on this pass.
        reasonChanged: (rejectionReasonText ?? null) !== ((oldRow.rejection_reason_text as string | null) ?? null),
        currentReason: rejectionReasonText,
        issueLinksJson,
      });

      const escalationType = move.kind === 'rejection' ? 'rejection' : 'jira_transition';
      const noteFor: Record<string, string> = {
        rejection: `Rejected: ${oldRow.current_tier} → ${currentTier}${move.reason ? ` — ${move.reason}` : ''}`,
        return_after_fix: `Returned after fix: ${oldRow.current_tier} → ${currentTier} (${move.evidence})`,
        unclassified: `Tier change: ${oldRow.current_tier} → ${currentTier} (${move.evidence})`,
        escalation: `Escalated: ${oldRow.current_tier} → ${currentTier}`,
        lateral: `Tier change: ${oldRow.current_tier} → ${currentTier}`,
      };

      try {
        await execute(`
          INSERT INTO escalation_log
            (ticket_key, escalation_type, from_tier, to_tier, reason_code, reason_label,
             escalated_by, notes, source, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'jira_sync', GETUTCDATE()
          WHERE NOT EXISTS (
            SELECT 1 FROM escalation_log
            WHERE ticket_key = ? AND from_tier = ? AND to_tier = ? AND source = 'jira_sync'
              AND ABS(DATEDIFF(minute, created_at, GETUTCDATE())) < 5
          )`,
          [
            issue.key, escalationType, oldRow.current_tier, currentTier,
            // A real code rather than NULL: 96% of the log already reads
            // `unknown`, and adding to that pile would make the reason-capture
            // finding in the weekly report worse rather than better. The code
            // carries the CLASSIFICATION, so a return-after-fix can never be
            // counted as a rejection downstream.
            move.kind === 'escalation' || move.kind === 'lateral' ? null : `jira_${move.kind}`,
            move.reason,
            (assignee?.displayName as string) ?? 'system',
            noteFor[move.kind],
            issue.key, oldRow.current_tier, currentTier,
          ],
        );
      } catch (err) {
        console.warn(`[jira-sync] Failed to log tier change for ${issue.key}:`, err instanceof Error ? err.message : err);
      }
    }

    // An escalation closes when its ticket closes. Keyed off the ticket being done
    // rather than off the transition edge, so it is idempotent (the WHERE clause
    // stops matching once stamped) and it also back-stamps escalations that were
    // logged before this existed, or on tickets that closed while sync was down.
    // minutes_to_resolve answers "did escalating actually change anything" without
    // a join; it is left NULL when the close predates the log row, which happens
    // for rows inserted by backfillFromChangelog.
    if ((status?.statusCategory?.key as string) === 'done') {
      try {
        const resolvedAt = f.resolutiondate ? new Date(f.resolutiondate as string) : new Date();
        await execute(`
          UPDATE escalation_log
             SET resolved_at = ?,
                 minutes_to_resolve = CASE WHEN ? >= created_at
                                           THEN DATEDIFF(minute, created_at, ?)
                                           ELSE NULL END
           WHERE ticket_key = ? AND resolved_at IS NULL`,
          [resolvedAt, resolvedAt, resolvedAt, issue.key],
        );
      } catch (err) {
        console.warn(`[jira-sync] Failed to stamp escalation closure for ${issue.key}:`, err instanceof Error ? err.message : err);
      }
    }

    // Event-driven round-robin safety net: when a ticket becomes unassigned via a
    // transition — an escalation/de-escalation that clears the assignee, or a human
    // unassigning it — re-place it immediately rather than waiting on the periodic sweep.
    // Fires only on the transition itself (assignee just cleared, or tier just changed
    // while unassigned) so an already-unassigned ticket isn't re-processed every sync,
    // and brand-new untriaged tickets (no oldRow) are left to the triage path.
    // Fire-and-forget; assignWithFallback keeps its live human-owner check + retry fallback.
    if (
      oldRow && this.assignmentEngine &&
      (status?.statusCategory?.key as string) !== 'done' &&
      assignee?.accountId == null
    ) {
      const assigneeJustCleared = oldRow.assignee_display != null;
      const tierJustChanged = currentTier !== oldRow.current_tier;
      if (assigneeJustCleared || tierJustChanged) {
        this.maybeReassignUnassigned(issue.key, currentTier, labels, oldRow.current_tier)
          .catch(err => console.warn(`[jira-sync] Reassign-on-unassign failed for ${issue.key}:`, err instanceof Error ? err.message : err));
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
      // and (if enabled) post the survey link as a public JSM comment.
      if (oldRow && oldRow.status_name !== statusName) {
        const resolvedStates = ['Closed', 'Resolved', 'Done'];
        if (statusName && resolvedStates.includes(statusName)) {
          const reporterEmail = reporter?.emailAddress as string | null;
          generateCsatSurvey(issue.key, reporterEmail)
            .then(token => (token ? this.postCsatComment(issue.key, token) : undefined))
            .catch(err => {
              console.warn(`[jira-sync] CSAT survey generation failed for ${issue.key}:`, err);
            });
        }
      }
    }
  }

  /** Round-robin a now-unassigned ticket into the pool implied by its current tier
   *  (CC or T2) immediately, closing the gap where escalated/de-escalated/unassigned
   *  tickets sit idle until the periodic sweep runs. NTPJ routes by project on its own
   *  paths; Development tier is never auto-assigned. */
  private async maybeReassignUnassigned(
    issueKey: string, toTier: string | null, labels: string | null, fromTier: string | null,
  ): Promise<void> {
    if (!this.assignmentEngine) return;
    if (this.settings.get('agent_escalation_reassign_enabled') === 'false') return;

    const project = this.assignmentEngine.resolveProjectFromTicketKey(issueKey);
    if (project === 'NTPJ') return;

    const pool = poolForTicket(toTier, labels, project);
    if (!pool) return; // Development / not auto-assignable

    if (!this.assignmentEngine.isWorkingTime()) return; // don't hand tickets to people out of hours

    const result = await this.assignmentEngine.assignWithFallback(issueKey, pool, project);
    if (result) {
      await this.assignmentEngine.postAssignmentComment(issueKey, result);
      console.log(`[jira-sync] Reassigned ${issueKey} (${fromTier ?? '—'} → ${toTier ?? '—'}, pool ${pool}) → ${result.agent.display_name}`);
    }
  }

  /** Resolve the public-facing base URL for portal links. */
  private getPublicBaseUrl(): string {
    const appBase = this.settings.get('app_base_url');
    if (appBase) return appBase.replace(/\/+$/, '');
    const ssoBase = this.settings.get('sso_base_url');
    if (ssoBase) return ssoBase.replace(/\/+$/, '');
    if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, '');
    // Prod settings are typically blank; fall back to the stable live host rather
    // than localhost so survey links work even before app_base_url is configured.
    return 'https://nova.nurtur.tech';
  }

  /** Post the CSAT survey link as a JSM comment on the resolved ticket.
   *  Controlled by `csat_comment_mode`:
   *    - 'internal' (default / test mode): private internal note, not seen by the customer
   *    - 'public': customer-visible comment (go-live)
   *    - 'off': post nothing
   *  Comment text is configurable via `csat_comment_template` ({link} placeholder). */
  private async postCsatComment(issueKey: string, token: string): Promise<void> {
    const mode = (this.settings.get('csat_comment_mode') || 'internal').toLowerCase();
    if (mode === 'off') return;
    const internal = mode !== 'public';

    const link = `${this.getPublicBaseUrl()}/portal/csat/${token}`;
    const template =
      this.settings.get('csat_comment_template') ||
      "Thanks for your patience while we worked on this. We'd love your feedback — it only takes 30 seconds to let us know how we did: {link}";

    // In test mode, prefix the internal note so it's obvious it's not customer-facing yet.
    const text = internal ? `[CSAT test — internal only] ${template}` : template;

    // Build an ADF paragraph, turning the {link} placeholder into a clickable link.
    const parts = text.split('{link}');
    const content: Array<Record<string, unknown>> = [];
    parts.forEach((part, i) => {
      if (part) content.push({ type: 'text', text: part });
      if (i < parts.length - 1) {
        content.push({
          type: 'text',
          text: link,
          marks: [{ type: 'link', attrs: { href: link } }],
        });
      }
    });
    if (content.length === 0) content.push({ type: 'text', text: link });

    const body = {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content }],
    };

    try {
      await this.jiraClient.addCommentAdf(issueKey, body, { internal });
      console.log(`[csat] Posted ${internal ? 'internal' : 'public'} survey comment on ${issueKey}`);
    } catch (err) {
      console.warn(`[jira-sync] CSAT comment post failed for ${issueKey}:`, err);
    }
  }

  private async upsertComment(issueKey: string, comment: JiraComment): Promise<void> {
    const bodyText = extractText(comment.body);
    const bodyAdf = comment.body ? JSON.stringify(comment.body) : null;
    const isPublic = comment.jsdPublic !== false;
    // Flag CSAT-link comments at write time so adoption metrics never LIKE-scan bodies.
    const hasCsatLink = bodyText && bodyText.includes('/portal/csat/') ? 1 : 0;

    await execute(`
      MERGE jira_comment_cache AS target
      USING (SELECT ? AS jira_comment_id) AS source ON target.jira_comment_id = source.jira_comment_id
      WHEN MATCHED THEN UPDATE SET
        issue_key = ?, author_account_id = ?, author_display = ?, author_email = ?,
        body_text = ?, body_adf = ?, is_public = ?, has_csat_link = ?,
        jira_created = ?, jira_updated = ?, synced_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (
        jira_comment_id, issue_key, author_account_id, author_display, author_email,
        body_text, body_adf, is_public, has_csat_link, jira_created, jira_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        comment.id,
        // UPDATE
        issueKey,
        comment.author?.accountId ?? null, comment.author?.displayName ?? null,
        comment.author?.emailAddress ?? null,
        bodyText || null, bodyAdf, isPublic, hasCsatLink,
        new Date(comment.created), new Date(comment.updated),
        // INSERT
        comment.id, issueKey,
        comment.author?.accountId ?? null, comment.author?.displayName ?? null,
        comment.author?.emailAddress ?? null,
        bodyText || null, bodyAdf, isPublic, hasCsatLink,
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

/**
 * Has this ticket's SLA breached?
 *
 * Checks the ONGOING cycle first. The previous version looked only at
 * `completedCycles`, which is the history — so a ticket sitting open and
 * currently in breach, which is precisely the one anybody wants to know about,
 * returned false. Combined with the field-id bug below, `sla_breached` was 0 on
 * every row in the cache.
 *
 * Completed cycles are still checked, so a ticket that breached and was then
 * resolved keeps its flag.
 */
function extractSlaBreached(slaField: unknown): boolean {
  if (!slaField || typeof slaField !== 'object') return false;
  try {
    if ((slaField as any)?.ongoingCycle?.breached === true) return true;
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
  currentTier: string | null,
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
  if (lastUpdated >= noReplyCutoff(currentTier, new Date(now)).getTime()) return false;
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
