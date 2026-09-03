import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { JiraRestClient } from './jira-client.js';
import type { JiraCacheQueries } from './jira-cache-queries.js';
import { DailyDigestSchema, WeeklyDigestSchema, type DailyDigest, type WeeklyDigest } from './kpi-schemas.js';
import { loadPrompt } from './prompt-loader.js';
import type { PipelineMonitor, PipelineTarget } from './pipeline-monitor.js';
import { tableSuffix } from './pipeline-monitor.js';
import { query as localQuery } from './database.js';
import { logError } from './error-log.js';
import { noReplyCutoff } from './shared/no-reply.js';
import { getRagThresholds } from './kpi-agent/rag.js';

let pool: sql.ConnectionPool | null = null;

export async function getKpiPool(settings: SettingsQueries): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;

  const server = settings.get('kpi_sql_server');
  const database = settings.get('kpi_sql_database');
  const user = settings.get('kpi_sql_user');
  const password = settings.get('kpi_sql_password');

  if (!server || !database || !user || !password) {
    throw new Error('KPI SQL Server not configured');
  }

  pool = await new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 60000,
  }).connect();

  return pool;
}

export function computeRag(value: number, target: number, direction: string): number {
  if (direction === 'Higher is better') {
    if (value >= target) return 1;
    if (value >= target * 0.8) return 2;
    return 3;
  }
  if (value <= target) return 1;
  if (value <= target * 1.5) return 2;
  return 3;
}

/**
 * Fixed-band RAG for KPIs whose thresholds don't fit the generic target±band
 * model. Returns null when the KPI has no custom band (caller falls back to
 * computeRag). New ticket volume: ≤110 green, 111–120 amber, >120 red.
 */
export function customRag(kpi: string, value: number): number | null {
  if (kpi === 'New Tickets Today') return value <= 110 ? 1 : value <= 120 ? 2 : 3;
  return null;
}

/** Whole business days (Mon–Fri) elapsed between two instants, ignoring weekends. */
function businessDaysBetween(from: Date, to: Date): number {
  if (!(from instanceof Date) || isNaN(from.getTime())) return 0;
  const cur = new Date(from);
  cur.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  let days = 0;
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

/** Parse a settings value that may be a JSON array or comma-separated string into a trimmed list. */
function parseListSetting(raw: string | undefined): string[] | null {
  if (!raw || !raw.trim()) return null;
  const t = raw.trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim()).filter(Boolean);
    } catch { /* fall through to CSV parsing */ }
  }
  return t.split(',').map((s) => s.trim()).filter(Boolean);
}

// ── KPI Helper Functions ──

interface CacheRow {
  issue_key: string;
  status_name: string | null;
  status_category: string | null;
  current_tier: string | null;
  request_type: string | null;
  assignee_account_id: string | null;
  assignee_display: string | null;
  jira_created: string | null;
  jira_updated: string | null;
  due_date: string | null;
  sla_breached: boolean | number | null;
  sla_breach_time: string | null;
  agent_last_updated: string | null;
  agent_next_update: string | null;
  no_reply: boolean | number | null;
  fields_json: string | null;
  issuetype_name: string | null;
  resolution_name: string | null;
}

function isSlaBreached(slaField: any): boolean | null {
  if (!slaField) return null;
  const cycles = Array.isArray(slaField) ? slaField : [slaField];
  for (const cycle of cycles) {
    if (cycle.completedCycles) {
      for (const cc of cycle.completedCycles) {
        if (cc.breached === true || (cc.remainingTime?.millis != null && cc.remainingTime.millis < 0)) return true;
      }
    }
    if (cycle.ongoingCycle) {
      if (cycle.ongoingCycle.breached === true || (cycle.ongoingCycle.remainingTime?.millis != null && cycle.ongoingCycle.remainingTime.millis < 0)) return true;
    }
  }
  return false;
}

const TIER_MAP: Record<string, string> = {
  'customer care': 'Customer Care',
  'production': 'Production',
  'tier 2': 'Tier 2',
  'tier 3': 'Tier 3',
  'development': 'Development',
};

function classifyTier(currentTier: string | null): string {
  if (!currentTier) return 'Unclassified';
  const mapped = TIER_MAP[currentTier.toLowerCase()];
  return mapped ?? 'Unclassified';
}

function ccBucket(requestType: string | null): string {
  const rt = (requestType || '').toLowerCase();
  if (['incident', 'chat', 'ai request', 'emailed request', 'gdpr'].includes(rt)) return 'CC (Incidents)';
  if (rt === 'service request') return 'CC (Service Requests)';
  if (rt === 'tpj request') return 'CC (TPJ)';
  return 'CC (Incidents)';
}

const EXCLUDED_STATUSES = ['done', 'closed', 'resolved', 'waiting on requestor', 'waiting on partner'];
const SLA_ACTIONABLE_STATUSES = ['open', 'reopened', 'work in progress'];

function isActionable(status: string | null): boolean {
  const s = (status || '').toLowerCase();
  return !!s && !EXCLUDED_STATUSES.includes(s);
}

function isExcludedStatus(status: string | null): boolean {
  return EXCLUDED_STATUSES.includes((status || '').toLowerCase());
}

function isSlaActionable(status: string | null): boolean {
  return SLA_ACTIONABLE_STATUSES.includes((status || '').toLowerCase());
}

function isNoReply(ticket: CacheRow, now: Date): boolean {
  const status = (ticket.status_name || '').toLowerCase();
  if (status === 'waiting on requestor') return false;
  const created = new Date(ticket.jira_created || 0);
  if (now.getTime() - created.getTime() < 4 * 60 * 60 * 1000) return false;
  const nextUpdate = ticket.agent_next_update ? new Date(ticket.agent_next_update) : null;
  if (nextUpdate && nextUpdate > now) return false;
  const lastUpdated = ticket.agent_last_updated ? new Date(ticket.agent_last_updated) : null;
  if (!lastUpdated) return false;
  if (lastUpdated >= noReplyCutoff(ticket.current_tier, now)) return false;
  const fiftyTwoWeeksAgo = new Date(now.getTime() - 52 * 7 * 24 * 60 * 60 * 1000);
  if (lastUpdated < fiftyTwoWeeksAgo) return false;
  return true;
}

function isOnboarding(requestType: string | null): boolean {
  return (requestType || '').toLowerCase() === 'onboarding';
}

function parseSlaField(fieldsJson: string | null, fieldName: string): any {
  if (!fieldsJson) return null;
  try {
    const fields = JSON.parse(fieldsJson);
    return fields?.[fieldName] ?? null;
  } catch { return null; }
}

function parseCsat(fieldsJson: string | null): number | null {
  if (!fieldsJson) return null;
  try {
    const fields = JSON.parse(fieldsJson);
    const rating = fields?.customfield_12802?.rating;
    if (typeof rating === 'number' && rating >= 1 && rating <= 5) return rating;
    return null;
  } catch { return null; }
}

// All tier groups that get per-tier KPIs
const ALL_TIERS = ['CC (Incidents)', 'CC (Service Requests)', 'CC (TPJ)', 'Production', 'Tier 2', 'Tier 3', 'Development'];

function n8nKpiName(tier: string, metric: string): string {
  // Strip parentheses for tiers used in sentence-style names (except TPJ which keeps them)
  const bare = tier === 'CC (TPJ)' ? 'CC (TPJ)' : tier.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

  switch (metric) {
    case 'Volume':
      return `Number of Tickets in ${tier}`;
    case 'No Reply':
      return `Number of Tickets With No Reply in ${tier}`;
    case 'Oldest Actionable':
      return `Oldest actionable ticket (days) in ${bare}`;
    case 'FRT Breached Actionable':
      return `${bare} FRT breached (actionable)`;
    case 'FRT Breached Not Actionable':
      return `${bare} FRT breached (not actionable)`;
    case 'Resolution SLA Breached Actionable':
      return `${bare} over SLA (actionable)`;
    case 'Resolution SLA Breached Not Actionable':
      return `${bare} over SLA (not actionable)`;
    default:
      return `${tier} — ${metric}`;
  }
}

export class KpiPipeline {
  private jiraProjects: string[];

  constructor(
    private settings: SettingsQueries,
    private llmService: LlmService,
    private jiraClient: JiraRestClient,
    jiraProject: string | string[] = 'NT',
    private monitor?: PipelineMonitor,
    private cache?: JiraCacheQueries,
  ) {
    this.jiraProjects = Array.isArray(jiraProject)
      ? jiraProject
      : jiraProject.split(',').map(p => p.trim()).filter(Boolean);
    if (this.jiraProjects.length === 0) this.jiraProjects = ['NT'];
  }

  private projectInClause(startIdx = 0): { sql: string; params: string[] } {
    const placeholders = this.jiraProjects.map((_, i) => `@p${startIdx + i}`).join(', ');
    return { sql: `project_key IN (${placeholders})`, params: [...this.jiraProjects] };
  }

  private get target(): PipelineTarget {
    const val = this.settings.get('kpi_pipeline_target');
    return val === 'uat' ? 'uat' : 'live';
  }

  private get s(): string {
    return tableSuffix(this.target);
  }

  async ensureNovaAiAgent(): Promise<void> {
    try {
      const p = await getKpiPool(this.settings);
      await p.request().query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.Agent WHERE AgentName = 'NOVA' AND AgentSurname = 'AI')
        INSERT INTO dbo.Agent (AgentName, AgentSurname, Team, TierCode, IsActive)
        VALUES ('NOVA', 'AI', 'NOVA AI', 'AI', 1)
      `);
      await p.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'PeopleHrId')
        ALTER TABLE dbo.Agent ADD PeopleHrId NVARCHAR(50) NULL
      `);
    } catch (err) {
      console.warn('[kpi-pipeline] Failed to ensure NOVA AI agent row:', err instanceof Error ? err.message : err);
    }
  }

  async ensureDigestColumns(): Promise<void> {
    try {
      const p = await getKpiPool(this.settings);
      for (const tbl of ['jira_kpi_digest', 'jira_kpi_digestUAT']) {
        await p.request().query(`
          IF OBJECT_ID('dbo.${tbl}') IS NOT NULL BEGIN
            IF COL_LENGTH('${tbl}', 'summary') IS NOT NULL
              ALTER TABLE dbo.${tbl} ALTER COLUMN summary NVARCHAR(4000) NULL;
            IF COL_LENGTH('${tbl}', 'html') IS NOT NULL
              ALTER TABLE dbo.${tbl} ALTER COLUMN html NVARCHAR(MAX) NULL;
          END
        `);
      }
    } catch (err) {
      console.warn('[kpi-pipeline] Failed to widen digest columns:', err instanceof Error ? err.message : err);
    }
  }

  async collectJiraSnapshot(): Promise<void> {
    const started = new Date();
    let rowsAffected = 0;
    try {
      let p: sql.ConnectionPool;
      try {
        p = await getKpiPool(this.settings);
      } catch (err) {
        console.log(`[kpi-pipeline] ${err instanceof Error ? err.message : 'Pool error'}`);
        throw err;
      }

      const today = new Date().toISOString().slice(0, 10);
      const now = new Date();
      const s = this.s;

      try {
        await p.request().query(`
          IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME = 'jira_kpi_daily${s}' AND COLUMN_NAME = 'direction'
                       AND CHARACTER_MAXIMUM_LENGTH < 50)
            ALTER TABLE jira_kpi_daily${s} ALTER COLUMN direction NVARCHAR(50);
          IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME = 'jira_kpi_daily${s}' AND COLUMN_NAME = 'kpi'
                       AND CHARACTER_MAXIMUM_LENGTH < 100)
            ALTER TABLE jira_kpi_daily${s} ALTER COLUMN kpi NVARCHAR(100);
          IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME = 'jira_kpi_daily${s}' AND COLUMN_NAME = 'kpiGroup'
                       AND CHARACTER_MAXIMUM_LENGTH < 100)
            ALTER TABLE jira_kpi_daily${s} ALTER COLUMN kpiGroup NVARCHAR(100);
        `);
      } catch (widenErr) {
        console.warn('[kpi-pipeline] Column widening failed (may need manual ALTER):', widenErr instanceof Error ? widenErr.message : widenErr);
      }

      // One-time migration: rename today's NOVA-style KPI names to n8n-compatible names
      try {
        const nameMap: Array<[string, string]> = [];
        for (const tier of ALL_TIERS) {
          nameMap.push([`${tier} — Volume`, n8nKpiName(tier, 'Volume')]);
          nameMap.push([`${tier} — No Reply`, n8nKpiName(tier, 'No Reply')]);
          nameMap.push([`${tier} — Oldest Actionable (days)`, n8nKpiName(tier, 'Oldest Actionable')]);
          nameMap.push([`${tier} — Resolution SLA Breached (Actionable)`, n8nKpiName(tier, 'Resolution SLA Breached Actionable')]);
          nameMap.push([`${tier} — FRT Breached (Actionable)`, n8nKpiName(tier, 'FRT Breached Actionable')]);
          if (tier !== 'Development') {
            nameMap.push([`${tier} — Resolution SLA Breached (Not Actionable)`, n8nKpiName(tier, 'Resolution SLA Breached Not Actionable')]);
            nameMap.push([`${tier} — FRT Breached (Not Actionable)`, n8nKpiName(tier, 'FRT Breached Not Actionable')]);
          }
        }
        for (const [oldName, newName] of nameMap) {
          if (oldName === newName) continue;
          const req = p.request();
          req.input('oldName', sql.NVarChar(100), oldName);
          req.input('newName', sql.NVarChar(100), newName);
          await req.query(`
            UPDATE dbo.jira_kpi_daily${s}
            SET kpi = @newName
            WHERE kpi = @oldName AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
              AND NOT EXISTS (SELECT 1 FROM dbo.jira_kpi_daily${s} x WHERE x.kpi = @newName AND CAST(x.CreatedAt AS DATE) = CAST(GETDATE() AS DATE))
          `);
        }
      } catch (renameErr) {
        console.warn('[kpi-pipeline] KPI name migration failed:', renameErr instanceof Error ? renameErr.message : renameErr);
      }

      const targets = await this.loadTargets(p);

      // Step 1: Load all open tickets from local MSSQL cache (multi-project)
      const pf = this.projectInClause();
      const openRows = await localQuery<CacheRow>(`
        SELECT issue_key, status_name, status_category, current_tier, request_type,
               assignee_account_id, assignee_display, jira_created, jira_updated, due_date,
               sla_breached, sla_breach_time, agent_last_updated, agent_next_update,
               no_reply, fields_json, issuetype_name, resolution_name
        FROM jira_issue_cache
        WHERE ${pf.sql} AND status_category != 'Done'
      `, pf.params);

      // Step 2: Load resolved-today tickets
      //
      // Dated by status_category_changed_at (Jira's statuscategorychangedate) —
      // when the ticket moved into Done — with resolved_at as fallback for rows
      // not yet re-synced since that column was added.
      //
      // This used to be `resolution_name IS NOT NULL AND jira_updated = today`,
      // which was wrong in both directions. `jira_updated` is bumped by ANY edit,
      // so every later touch of an already-closed ticket re-counted as a fresh
      // solve — that is what produced 699 and 1,632 "solves" on 13-14 Jul 2026
      // against a 20-40 norm, with FRT/resolution breach counts scaling in step
      // and compliance ratios unchanged (the tell that these were historical
      // tickets being re-touched, not same-day work). Meanwhile the
      // `resolution_name IS NOT NULL` guard dropped essentially every NOVA close,
      // because NOVA moves tickets to Resolved without setting `resolution`.
      const resolvedRows = await localQuery<CacheRow>(`
        SELECT issue_key, status_name, status_category, current_tier, request_type,
               assignee_account_id, assignee_display, jira_created, jira_updated, due_date,
               sla_breached, sla_breach_time, agent_last_updated, agent_next_update,
               no_reply, fields_json, issuetype_name, resolution_name
        FROM jira_issue_cache
        WHERE ${pf.sql}
          AND status_category = 'Done'
          AND CAST(COALESCE(status_category_changed_at, resolved_at) AS DATE) = CAST(GETUTCDATE() AS DATE)
      `, pf.params);

      // Step 3: Created today count
      const createdTodayRows = await localQuery<{ cnt: number }>(`
        SELECT COUNT(*) AS cnt FROM jira_issue_cache
        WHERE ${pf.sql} AND CAST(jira_created AS DATE) = CAST(GETUTCDATE() AS DATE)
      `, pf.params);

      // Filter out onboarding tickets
      const open = openRows.filter(t => !isOnboarding(t.request_type));
      const resolved = resolvedRows.filter(t => !isOnboarding(t.request_type));

      // Step 4: Parse SLA fields for all tickets
      type ParsedTicket = CacheRow & {
        tier: string;
        frtBreached: boolean | null;
        resBreached: boolean | null;
        csat: number | null;
        actionable: boolean;
        slaActionable: boolean;
        excluded: boolean;
      };

      function parseTicket(t: CacheRow): ParsedTicket {
        const rawTier = classifyTier(t.current_tier);
        const ccTier = rawTier === 'Customer Care' ? ccBucket(t.request_type) : null;
        const tier = ccTier ?? rawTier;
        return {
          ...t,
          tier,
          frtBreached: isSlaBreached(parseSlaField(t.fields_json, 'customfield_14046')),
          resBreached: isSlaBreached(parseSlaField(t.fields_json, 'customfield_14048')),
          csat: parseCsat(t.fields_json),
          actionable: isActionable(t.status_name),
          slaActionable: isSlaActionable(t.status_name),
          excluded: isExcludedStatus(t.status_name),
        };
      }

      const parsedOpen = open.map(parseTicket);
      const parsedResolved = resolved.map(parseTicket);

      // Step 5: Compute per-tier metrics from open tickets
      interface TierStats {
        volume: number;
        noReply: number;
        oldestActionableDays: number;
        resBreachedActionable: number;
        resBreachedNotActionable: number;
        frtBreachedActionable: number;
        frtBreachedNotActionable: number;
      }

      const tierStats = new Map<string, TierStats>();
      for (const tier of ALL_TIERS) {
        tierStats.set(tier, { volume: 0, noReply: 0, oldestActionableDays: 0, resBreachedActionable: 0, resBreachedNotActionable: 0, frtBreachedActionable: 0, frtBreachedNotActionable: 0 });
      }

      let totalFrtChecked = 0, totalFrtBreached = 0;
      let totalResChecked = 0, totalResBreached = 0;

      for (const t of parsedOpen) {
        const ts = tierStats.get(t.tier);
        if (!ts) {
          tierStats.set(t.tier, { volume: 0, noReply: 0, oldestActionableDays: 0, resBreachedActionable: 0, resBreachedNotActionable: 0, frtBreachedActionable: 0, frtBreachedNotActionable: 0 });
        }
        const stats = tierStats.get(t.tier)!;
        stats.volume++;

        if (isNoReply(t, now)) stats.noReply++;

        if (t.actionable && t.jira_created) {
          const ageDays = Math.floor((now.getTime() - new Date(t.jira_created).getTime()) / 86400000);
          if (ageDays > stats.oldestActionableDays) stats.oldestActionableDays = ageDays;
        }

        if (t.resBreached === true) {
          if (t.slaActionable) stats.resBreachedActionable++;
          else if (!t.excluded && !t.slaActionable) stats.resBreachedNotActionable++;
        }
        if (t.frtBreached === true) {
          if (t.slaActionable) stats.frtBreachedActionable++;
          else if (!t.excluded && !t.slaActionable) stats.frtBreachedNotActionable++;
        }

        if (t.frtBreached !== null) { totalFrtChecked++; if (t.frtBreached) totalFrtBreached++; }
        if (t.resBreached !== null) { totalResChecked++; if (t.resBreached) totalResBreached++; }
      }

      // Step 6: Compute resolved-today SLA metrics
      let resolvedFrtTotal = 0, resolvedFrtBreached = 0;
      let resolvedResTotal = 0, resolvedResBreached = 0;
      let csatSum = 0, csatCount = 0;

      for (const t of parsedResolved) {
        if (t.frtBreached !== null) { resolvedFrtTotal++; if (t.frtBreached) resolvedFrtBreached++; }
        if (t.resBreached !== null) { resolvedResTotal++; if (t.resBreached) resolvedResBreached++; }
        if (t.csat !== null) { csatSum += t.csat; csatCount++; }
      }

      // Step 7: Build metrics array
      type Metric = { kpi: string; group: string; count: number; target: number; direction: string };
      const metrics: Metric[] = [];

      function t(name: string): { target: number; direction: string; group: string } {
        return targets.get(name) ?? { target: 0, direction: 'Lower is better', group: 'Queue' };
      }

      // Global KPIs
      const openCount = parsedOpen.length;
      const breachedCount = parsedOpen.filter(t => t.resBreached === true).length;
      const unassignedCount = parsedOpen.filter(t => !t.assignee_account_id).length;
      const worCount = parsedOpen.filter(t => (t.status_name || '').toLowerCase() === 'waiting on requestor').length;
      const createdToday = createdTodayRows[0]?.cnt ?? 0;

      metrics.push(
        { kpi: 'Open Tickets', group: 'Queue', count: openCount, target: t('Open Tickets').target || 30, direction: 'Lower is better' },
        { kpi: 'SLA Breached', group: 'SLA', count: breachedCount, target: t('SLA Breached').target || 0, direction: 'Lower is better' },
        { kpi: 'Unassigned', group: 'Queue', count: unassignedCount, target: t('Unassigned').target || 0, direction: 'Lower is better' },
        { kpi: 'Tickets Solved Today', group: 'Throughput', count: parsedResolved.length, target: t('Tickets Solved Today').target || 15, direction: 'Higher is better' },
        { kpi: 'New Tickets Today', group: 'Volume', count: createdToday, target: t('New Tickets Today').target || 110, direction: 'Lower is better' },
        { kpi: 'Waiting on Requestor', group: 'Queue', count: worCount, target: t('Waiting on Requestor').target || 10, direction: 'Lower is better' },
      );

      // Resolved-today SLA compliance
      const frtComplianceResolved = resolvedFrtTotal > 0 ? Math.round(((resolvedFrtTotal - resolvedFrtBreached) / resolvedFrtTotal) * 100) : 100;
      const resComplianceResolved = resolvedResTotal > 0 ? Math.round(((resolvedResTotal - resolvedResBreached) / resolvedResTotal) * 100) : 100;
      const csatPct = csatCount > 0 ? Math.round((csatSum / csatCount) * 20) : 0; // 1-5 → 0-100%

      metrics.push(
        { kpi: 'FRT Compliance % (Resolved Today)', group: 'SLA', count: frtComplianceResolved, target: t('FRT Compliance % (Resolved Today)').target || 90, direction: 'Higher is better' },
        { kpi: 'Resolution Compliance % (Resolved Today)', group: 'SLA', count: resComplianceResolved, target: t('Resolution Compliance % (Resolved Today)').target || 90, direction: 'Higher is better' },
        { kpi: 'FRT Breaches (Resolved Today)', group: 'SLA', count: resolvedFrtBreached, target: 0, direction: 'Lower is better' },
        { kpi: 'Resolution Breaches (Resolved Today)', group: 'SLA', count: resolvedResBreached, target: 0, direction: 'Lower is better' },
        { kpi: 'CSAT %', group: 'Quality', count: csatPct, target: t('CSAT %').target || 80, direction: 'Higher is better' },
      );

      // Open queue SLA compliance
      const frtComplianceOpen = totalFrtChecked > 0 ? Math.round(((totalFrtChecked - totalFrtBreached) / totalFrtChecked) * 100) : 100;
      const resComplianceOpen = totalResChecked > 0 ? Math.round(((totalResChecked - totalResBreached) / totalResChecked) * 100) : 100;

      metrics.push(
        { kpi: 'FRT Compliance % (Open Queue)', group: 'SLA', count: frtComplianceOpen, target: t('FRT Compliance % (Open Queue)').target || 90, direction: 'Higher is better' },
        { kpi: 'Resolution Compliance % (Open Queue)', group: 'SLA', count: resComplianceOpen, target: t('Resolution Compliance % (Open Queue)').target || 90, direction: 'Higher is better' },
      );

      // Per-tier KPIs
      for (const [tier, stats] of tierStats) {
        if (!ALL_TIERS.includes(tier)) continue;
        metrics.push(
          { kpi: n8nKpiName(tier, 'Volume'), group: 'Tier Volume', count: stats.volume, target: 0, direction: 'Lower is better' },
          { kpi: n8nKpiName(tier, 'No Reply'), group: 'Tier No Reply', count: stats.noReply, target: 0, direction: 'Lower is better' },
          { kpi: n8nKpiName(tier, 'Oldest Actionable'), group: 'Tier Age', count: stats.oldestActionableDays, target: 0, direction: 'Lower is better' },
          { kpi: n8nKpiName(tier, 'Resolution SLA Breached Actionable'), group: 'Tier SLA', count: stats.resBreachedActionable, target: 0, direction: 'Lower is better' },
          { kpi: n8nKpiName(tier, 'FRT Breached Actionable'), group: 'Tier SLA', count: stats.frtBreachedActionable, target: 0, direction: 'Lower is better' },
        );
        metrics.push(
          { kpi: n8nKpiName(tier, 'Resolution SLA Breached Not Actionable'), group: 'Tier SLA', count: stats.resBreachedNotActionable, target: 0, direction: 'Lower is better' },
          { kpi: n8nKpiName(tier, 'FRT Breached Not Actionable'), group: 'Tier SLA', count: stats.frtBreachedNotActionable, target: 0, direction: 'Lower is better' },
        );
      }

      // Escalation KPIs (from local MSSQL escalation_log)
      try {
        const escMetrics = await this.collectEscalationKpis();
        metrics.push(...escMetrics);
      } catch (escErr) {
        console.warn('[kpi-pipeline] Escalation KPIs failed:', escErr instanceof Error ? escErr.message : escErr);
      }

      // AI KPIs (from approval_queue in local MSSQL)
      try {
        const aiResolved = await localQuery<{ cnt: number }>(`
          SELECT COUNT(*) AS cnt FROM approval_queue
          WHERE status = 'approved' AND CAST(decided_at AS DATE) = CAST(GETUTCDATE() AS DATE)
        `);
        const aiPending = await localQuery<{ cnt: number }>(`
          SELECT COUNT(*) AS cnt FROM approval_queue
          WHERE status = 'pending'
        `);
        const aiTotal = await localQuery<{ cnt: number }>(`
          SELECT COUNT(*) AS cnt FROM approval_queue
          WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE)
        `);
        const aiResolvedCount = aiResolved[0]?.cnt ?? 0;
        const aiPendingCount = aiPending[0]?.cnt ?? 0;
        const aiTotalToday = aiTotal[0]?.cnt ?? 0;
        const aiRate = aiTotalToday > 0 ? Math.round((aiResolvedCount / aiTotalToday) * 100) : 0;
        metrics.push(
          { kpi: 'AI Tickets Resolved (Today)', group: 'AI', count: aiResolvedCount, target: 0, direction: 'Higher is better' },
          { kpi: 'AI Tickets Pending Approval', group: 'AI', count: aiPendingCount, target: 0, direction: 'Lower is better' },
          { kpi: 'AI Resolution Rate %', group: 'AI', count: aiRate, target: 50, direction: 'Higher is better' },
        );
      } catch (aiErr) {
        console.warn('[kpi-pipeline] AI KPIs failed:', aiErr instanceof Error ? aiErr.message : aiErr);
      }

      // WTD percentage KPIs Green/Red (from this week's jira_kpi_daily)
      try {
        const wtdResult = await p.request().query(`
          SELECT
            SUM(CASE WHEN rag = 1 THEN 1 ELSE 0 END) AS greenCount,
            SUM(CASE WHEN rag = 3 THEN 1 ELSE 0 END) AS redCount,
            COUNT(*) AS total
          FROM dbo.jira_kpi_daily${s}
          WHERE CreatedAt >= DATEADD(WEEKDAY, 1 - DATEPART(WEEKDAY, GETDATE()), CAST(GETDATE() AS DATE))
            AND target > 0
        `);
        const wtd = wtdResult.recordset[0];
        const wtdTotal = wtd?.total ?? 0;
        const wtdGreenPct = wtdTotal > 0 ? Math.round(((wtd?.greenCount ?? 0) / wtdTotal) * 100) : 0;
        const wtdRedPct = wtdTotal > 0 ? Math.round(((wtd?.redCount ?? 0) / wtdTotal) * 100) : 0;
        metrics.push(
          { kpi: "WTD percentage KPI's Green", group: 'Summary', count: wtdGreenPct, target: 80, direction: 'Higher is better' },
          { kpi: "WTD percentage KPI's Red", group: 'Summary', count: wtdRedPct, target: 10, direction: 'Lower is better' },
        );
      } catch (wtdErr) {
        console.warn('[kpi-pipeline] WTD KPIs failed:', wtdErr instanceof Error ? wtdErr.message : wtdErr);
      }

      // Write all metrics
      for (const m of metrics) {
        const tgt = targets.get(m.kpi);
        const target = tgt?.target ?? m.target;
        const direction = tgt?.direction ?? m.direction;
        const group = tgt?.group ?? m.group;
        const rag = customRag(m.kpi, m.count) ?? computeRag(m.count, target, direction);
        const request = p.request();
        request.input('kpi', sql.NVarChar(100), m.kpi.slice(0, 100));
        request.input('kpiGroup', sql.NVarChar(100), group.slice(0, 100));
        request.input('count', sql.Float, m.count);
        request.input('target', sql.Float, target);
        request.input('direction', sql.NVarChar(50), direction.slice(0, 50));
        request.input('rag', sql.Int, rag);
        request.input('date', sql.Date, today);

        await request.query(`
          MERGE dbo.jira_kpi_daily${s} AS t
          USING (SELECT @date AS CreatedAt, @kpi AS kpi) AS s
          ON CAST(t.CreatedAt AS DATE) = s.CreatedAt AND t.kpi = s.kpi
          WHEN MATCHED THEN UPDATE SET
            kpiGroup = @kpiGroup, [count] = @count, target = @target,
            direction = @direction, rag = @rag
          WHEN NOT MATCHED THEN INSERT
            (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
          VALUES (@kpi, @kpiGroup, @count, @target, @direction, @rag, @date);
        `);
        rowsAffected++;
      }

      console.log(`[kpi-pipeline] Jira snapshot → ${s || 'live'}: ${metrics.length} metrics written (${parsedOpen.length} open, ${parsedResolved.length} resolved today)`);

      await this.monitor?.logRun({
        pipeline_name: 'kpi-snapshot', started_at: started, completed_at: new Date(),
        status: 'success', rows_affected: rowsAffected, error_message: null,
        duration_ms: Date.now() - started.getTime(),
      });
    } catch (err) {
      console.error('[kpi-pipeline] Jira snapshot failed:', err instanceof Error ? err.message : err);
      void logError('kpi-pipeline', err, { context: { phase: 'jira-snapshot' } });
      await this.monitor?.logRun({
        pipeline_name: 'kpi-snapshot', started_at: started, completed_at: new Date(),
        status: 'error', rows_affected: rowsAffected, error_message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - started.getTime(),
      });
    }
  }

  async ensureKpiTargetDirections(): Promise<void> {
    const KNOWN_DIRECTIONS: Record<string, string> = {
      'Tickets Solved Today': 'Higher is better',
      'FRT Compliance % (Resolved Today)': 'Higher is better',
      'Resolution Compliance % (Resolved Today)': 'Higher is better',
      'FRT Compliance % (Open Queue)': 'Higher is better',
      'Resolution Compliance % (Open Queue)': 'Higher is better',
      'CSAT %': 'Higher is better',
      'AI Tickets Resolved (Today)': 'Higher is better',
      'AI Resolution Rate %': 'Higher is better',
      "WTD percentage KPI's Green": 'Higher is better',
      '1st Line Resolution Rate %': 'Higher is better',
      'CSAT % (Derived)': 'Higher is better',
      'FCR Rate %': 'Higher is better',
      'Open Tickets': 'Lower is better',
      'SLA Breached': 'Lower is better',
      'New Tickets Today': 'Lower is better',
      'Unassigned': 'Lower is better',
      'FRT Breaches (Resolved Today)': 'Lower is better',
      'Resolution Breaches (Resolved Today)': 'Lower is better',
      'Waiting on Requestor': 'Lower is better',
      'Bug Escalation-to-Ack (hours)': 'Lower is better',
      "WTD percentage KPI's Red": 'Lower is better',
    };
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;
      for (const [kpi, dir] of Object.entries(KNOWN_DIRECTIONS)) {
        await p.request()
          .input('kpi', sql.NVarChar(100), kpi)
          .input('dir', sql.NVarChar(50), dir)
          .query(`UPDATE dbo.KpiTargets SET Direction = @dir WHERE KpiName = @kpi AND Direction != @dir`);
      }
      console.log('[kpi-pipeline] KpiTargets direction check complete');
    } catch (err) {
      console.warn('[kpi-pipeline] ensureKpiTargetDirections failed:', err instanceof Error ? err.message : err);
    }
  }

  async loadTargets(p?: sql.ConnectionPool): Promise<Map<string, { target: number; direction: string; group: string }>> {
    const map = new Map<string, { target: number; direction: string; group: string }>();
    try {
      const pool = p ?? await getKpiPool(this.settings);
      const result = await pool.request().query(`
        SELECT KpiName, KpiGroup, TargetValue, Direction FROM dbo.KpiTargets
      `);
      for (const row of result.recordset) {
        map.set(row.KpiName, {
          target: row.TargetValue ?? 0,
          direction: row.Direction ?? 'Lower is better',
          group: row.KpiGroup ?? 'Queue',
        });
      }
    } catch {
      // KpiTargets table may not exist yet — use defaults
    }
    return map;
  }

  private async collectEscalationKpis(): Promise<Array<{ kpi: string; group: string; count: number; target: number; direction: string }>> {
    const metrics: Array<{ kpi: string; group: string; count: number; target: number; direction: string }> = [];

    const escalatedT2 = await localQuery<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM escalation_log
      WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) AND to_tier IN ('T2', 'Tier 2')
    `);
    const escalatedT3 = await localQuery<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM escalation_log
      WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) AND to_tier IN ('T3', 'Tier 3')
    `);
    const escalatedDev = await localQuery<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM escalation_log
      WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) AND to_tier IN ('Dev', 'Development')
    `);

    // Rejection detection: escalations where the ticket was escalated back to the lower tier same day
    const rejectedT2 = await localQuery<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM escalation_log
      WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE)
        AND from_tier IN ('T2', 'Tier 2') AND to_tier IN ('T1', 'Customer Care')
    `);
    const rejectedT3 = await localQuery<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM escalation_log
      WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE)
        AND from_tier IN ('T3', 'Tier 3') AND to_tier IN ('T2', 'Tier 2', 'T1', 'Customer Care')
    `);
    const rejectedDev = await localQuery<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM escalation_log
      WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE)
        AND from_tier IN ('Dev', 'Development') AND to_tier IN ('T3', 'Tier 3', 'T2', 'Tier 2')
    `);

    const escT2 = escalatedT2[0]?.cnt ?? 0;
    const escT3 = escalatedT3[0]?.cnt ?? 0;
    const escDev = escalatedDev[0]?.cnt ?? 0;
    const rejT2 = rejectedT2[0]?.cnt ?? 0;
    const rejT3 = rejectedT3[0]?.cnt ?? 0;
    const rejDev = rejectedDev[0]?.cnt ?? 0;
    const totalEsc = escT2 + escT3 + escDev;
    const totalRej = rejT2 + rejT3 + rejDev;
    const accuracy = totalEsc > 0 ? Math.round(((totalEsc - totalRej) / totalEsc) * 100) : 100;

    metrics.push(
      { kpi: 'Tickets escalated to Tier 2', group: 'Escalation', count: escT2, target: 0, direction: 'Lower is better' },
      { kpi: 'Tickets escalated to Tier 3', group: 'Escalation', count: escT3, target: 0, direction: 'Lower is better' },
      { kpi: 'Tickets escalated to Development', group: 'Escalation', count: escDev, target: 0, direction: 'Lower is better' },
      { kpi: 'Tickets rejected by Tier 2', group: 'Escalation', count: rejT2, target: 0, direction: 'Lower is better' },
      { kpi: 'Tickets rejected by Tier 3', group: 'Escalation', count: rejT3, target: 0, direction: 'Lower is better' },
      { kpi: 'Tickets rejected by Development', group: 'Escalation', count: rejDev, target: 0, direction: 'Lower is better' },
      { kpi: 'Escalation Accuracy %', group: 'Escalation', count: accuracy, target: 90, direction: 'Higher is better' },
    );

    return metrics;
  }

  async collectDerivedKpis(): Promise<void> {
    const started = new Date();
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;
      const today = new Date().toISOString().slice(0, 10);
      console.log(`[kpi-pipeline] Derived KPIs: starting collection for ${today}`);

      // 1st Line Resolution Rate: resolved at Customer Care tier / total resolved today
      const pf = this.projectInClause();
      const resolvedRows = await localQuery<{ request_type: string | null; current_tier: string | null }>(`
        SELECT request_type, current_tier FROM jira_issue_cache
        WHERE ${pf.sql} AND status_category = 'Done'
          AND CAST(COALESCE(status_category_changed_at, resolved_at) AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND LOWER(ISNULL(request_type, '')) != 'onboarding'
      `, pf.params);

      const ccRequestTypes = ['incident', 'chat', 'ai request', 'emailed request', 'gdpr', 'service request', 'tpj request'];
      const totalResolved = resolvedRows.length;
      const firstLineResolved = resolvedRows.filter(r => classifyTier(r.current_tier) === 'Customer Care').length;
      const firstLineRate = totalResolved > 0 ? Math.round((firstLineResolved / totalResolved) * 100) : 0;
      console.log(`[kpi-pipeline] Derived KPIs: ${totalResolved} resolved-today tickets found (${firstLineResolved} resolved at Customer Care tier), 1st Line Rate = ${firstLineRate}%`);

      // CSAT % (derived) — same as snapshot CSAT but with different RAG
      const csatRows = await localQuery<{ fields_json: string | null }>(`
        SELECT fields_json FROM jira_issue_cache
        WHERE ${pf.sql} AND status_category = 'Done'
          AND CAST(COALESCE(status_category_changed_at, resolved_at) AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND fields_json IS NOT NULL
      `, pf.params);
      let csatSum = 0, csatCount = 0;
      for (const r of csatRows) {
        const rating = parseCsat(r.fields_json);
        if (rating !== null) { csatSum += rating; csatCount++; }
      }
      const csatDerived = csatCount > 0 ? Math.round((csatSum / csatCount) * 20) : 0;
      console.log(`[kpi-pipeline] Derived KPIs: CSAT — ${csatCount} rated tickets from ${csatRows.length} resolved, derived ${csatDerived}%`);

      // FCR Rate % and Bug Escalation-to-Ack — computed from Jira comments
      const BOT_PATTERNS = ['nurtur', 'automation', 'jira service', 'servicedesk', 'bot'];
      const isBot = (name: string) => BOT_PATTERNS.some(p => name.toLowerCase().includes(p));

      const resolvedForComments = await localQuery<{ issue_key: string; request_type: string | null; created_at: string | null }>(`
        SELECT issue_key, request_type, jira_created AS created_at FROM jira_issue_cache
        WHERE ${pf.sql} AND status_category = 'Done'
          AND CAST(COALESCE(status_category_changed_at, resolved_at) AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND LOWER(ISNULL(request_type, '')) != 'onboarding'
      `, pf.params);

      const bugTypes = ['bug', 'development', 'defect'];
      let fcrCount = 0, fcrTotal = 0;
      const ackHours: number[] = [];
      const commentCap = 30;

      for (let i = 0; i < Math.min(resolvedForComments.length, commentCap); i++) {
        const ticket = resolvedForComments[i];
        try {
          const comments = await this.jiraClient.getComments(ticket.issue_key, 50);
          const agentComments = comments.filter(c => {
            const name = c.author?.displayName ?? '';
            const acctType = c.author?.accountType;
            return acctType !== 'customer' && !isBot(name);
          });
          const customerComments = comments.filter(c => c.author?.accountType === 'customer');

          const rt = (ticket.request_type || '').toLowerCase();

          // FCR: CC request types only
          if (ccRequestTypes.includes(rt)) {
            fcrTotal++;
            if (agentComments.length > 0) {
              const firstAgentTime = new Date(agentComments[agentComments.length - 1].created);
              const customerAfterAgent = customerComments.some(c => new Date(c.created) > firstAgentTime);
              if (!customerAfterAgent) fcrCount++;
            }
          }

          // Bug Ack: bug/dev/defect types
          if (bugTypes.includes(rt) && agentComments.length > 0 && ticket.created_at) {
            const firstAgentComment = agentComments[agentComments.length - 1];
            const createdAt = new Date(ticket.created_at);
            const ackAt = new Date(firstAgentComment.created);
            const hours = (ackAt.getTime() - createdAt.getTime()) / 3600000;
            if (hours >= 0) ackHours.push(hours);
          }

          if (i < commentCap - 1) await new Promise(r => setTimeout(r, 200));
        } catch (commentErr) {
          console.warn(`[kpi-pipeline] Failed to fetch comments for ${ticket.issue_key}:`, commentErr instanceof Error ? commentErr.message : commentErr);
        }
      }

      const fcrRate = fcrTotal > 0 ? Math.round((fcrCount / fcrTotal) * 100) : 0;
      const avgAckHours = ackHours.length > 0 ? Math.round((ackHours.reduce((a, b) => a + b, 0) / ackHours.length) * 10) / 10 : 0;
      const commentTicketsProcessed = Math.min(resolvedForComments.length, commentCap);
      console.log(`[kpi-pipeline] Derived KPIs: comments fetched for ${commentTicketsProcessed}/${resolvedForComments.length} tickets — FCR ${fcrCount}/${fcrTotal} (${fcrRate}%), Bug Ack samples: ${ackHours.length}, avg ${avgAckHours}h`);

      const derivedMetrics: Array<{ kpi: string; group: string; count: number; target: number; direction: string }> = [
        { kpi: '1st Line Resolution Rate %', group: 'Derived', count: firstLineRate, target: 60, direction: 'Higher is better' },
        { kpi: 'CSAT % (Derived)', group: 'Derived', count: csatDerived, target: 80, direction: 'Higher is better' },
        { kpi: 'FCR Rate %', group: 'Derived', count: fcrRate, target: 60, direction: 'Higher is better' },
        { kpi: 'Bug Escalation-to-Ack (hours)', group: 'Derived', count: avgAckHours, target: 4, direction: 'Lower is better' },
      ];

      for (const m of derivedMetrics) {
        const rag = computeRag(m.count, m.target, m.direction);
        const req = p.request();
        req.input('kpi', sql.NVarChar(100), m.kpi);
        req.input('kpiGroup', sql.NVarChar(100), m.group);
        req.input('count', sql.Float, m.count);
        req.input('target', sql.Float, m.target);
        req.input('direction', sql.NVarChar(50), m.direction);
        req.input('rag', sql.Int, rag);
        req.input('date', sql.Date, today);
        await req.query(`
          MERGE dbo.jira_kpi_daily${s} AS t
          USING (SELECT @date AS CreatedAt, @kpi AS kpi) AS s
          ON CAST(t.CreatedAt AS DATE) = s.CreatedAt AND t.kpi = s.kpi
          WHEN MATCHED THEN UPDATE SET
            kpiGroup = @kpiGroup, [count] = @count, target = @target,
            direction = @direction, rag = @rag
          WHEN NOT MATCHED THEN INSERT
            (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
          VALUES (@kpi, @kpiGroup, @count, @target, @direction, @rag, @date);
        `);
      }

      console.log(`[kpi-pipeline] Derived KPIs written: ${derivedMetrics.length} metrics`);

      await this.monitor?.logRun({
        pipeline_name: 'kpi-derived', started_at: started, completed_at: new Date(),
        status: 'success', rows_affected: derivedMetrics.length, error_message: null,
        duration_ms: Date.now() - started.getTime(),
      });
    } catch (err) {
      console.error('[kpi-pipeline] Derived KPIs failed:', err instanceof Error ? err.message : err);
      await this.monitor?.logRun({
        pipeline_name: 'kpi-derived', started_at: started, completed_at: new Date(),
        status: 'error', rows_affected: 0, error_message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - started.getTime(),
      });
    }
  }

  // dbo.JiraEodTicketStatusSnapshot is owned by n8n, which writes every project
  // nightly at 17:00 with RequestTypeId set. NOVA used to write it too, and could
  // not: the PK ends in RequestTypeKey = ISNULL(RequestTypeId, '__NULL__') and NOVA
  // only had the request type NAME, so every row keyed to __NULL__ and the second
  // request type sharing a (date, project, tier, status) tuple threw a PK violation.
  // Worse, the run DELETEd the whole SnapshotDate first — across ALL projects — so a
  // restart after 17:00 replaced n8n's full snapshot with a handful of NT rows.
  // captureEodSnapshot removed 19 Aug 2026; n8n is the sole writer.

  async refreshAllAgentMetrics(): Promise<void> {
    try {
      const p = await getKpiPool(this.settings);
      const now = new Date();
      const pf = this.projectInClause();

      // Open ticket stats per agent from local MSSQL cache (per-ticket rows for SLA evaluation)
      const openTickets = await localQuery<{
        assignee_account_id: string;
        assignee_display: string | null;
        issue_key: string;
        status_name: string | null;
        due_date: string | null;
        jira_created: string | null;
        jira_updated: string | null;
        fields_json: string | null;
      }>(`
        SELECT a.assignee_account_id,
          a.assignee_display,
          a.issue_key,
          a.status_name,
          a.due_date,
          a.jira_created,
          a.jira_updated,
          a.fields_json
        FROM jira_issue_cache a
        WHERE ${pf.sql.replace(/project_key/g, 'a.project_key')}
          AND a.status_category != 'Done'
          AND a.assignee_account_id IS NOT NULL
          AND a.current_tier IN ('Customer Care', 'Production', 'Tier 2', 'Tier 3', 'Development')
          AND LOWER(ISNULL(a.request_type, '')) != 'onboarding'
      `, pf.params);

      // Aggregate per-agent stats in TypeScript (SLA breach via parseSlaField + isSlaBreached)
      const agentMap = new Map<string, {
        assignee_account_id: string;
        assignee_display: string | null;
        OpenTickets_Total: number;
        OpenTickets_Over2Hours: number;
        OpenTickets_NoUpdateToday: number;
        OldestTicketDays: number;
        OldestTicketKey: string | null;
      }>();

      const SLA_EXCLUDED = ['done', 'closed', 'resolved', 'waiting on requestor', 'waiting on partner'];

      // "Not Updated" counts open tickets the agent can actually ACTION that have had no
      // activity for >= staleBusinessDays business days. Tickets parked outside the agent's
      // control (waiting on the customer/dev/partner, scheduled, awaiting deployment, etc.)
      // are excluded — the agent is not neglecting them. Both the parked-status list and the
      // staleness window are settings-overridable; the defaults below apply out of the box.
      const PARKED_STATUSES_DEFAULT = [
        'waiting on development', 'waiting for development', 'waiting on dev',
        'waiting on requestor', 'waiting for requestor', 'waiting for customer',
        'waiting on customer', 'waiting on partner', 'waiting on 3rd party',
        'waiting on third party', 'waiting for vendor', 'awaiting deployment',
        'scheduled', 'on hold', 'pending',
      ];
      const parkedStatuses = new Set(
        (parseListSetting(this.settings.get('breach_parked_statuses')) ?? PARKED_STATUSES_DEFAULT)
          .map((s) => s.toLowerCase()),
      );
      const staleBusinessDays = Number(this.settings.get('breach_stale_business_days')) || 2;

      for (const ticket of openTickets) {
        let agg = agentMap.get(ticket.assignee_account_id);
        if (!agg) {
          agg = {
            assignee_account_id: ticket.assignee_account_id,
            assignee_display: ticket.assignee_display,
            OpenTickets_Total: 0,
            OpenTickets_Over2Hours: 0,
            OpenTickets_NoUpdateToday: 0,
            OldestTicketDays: 0,
            OldestTicketKey: null,
          };
          agentMap.set(ticket.assignee_account_id, agg);
        }

        agg.OpenTickets_Total++;

        // SLA breach: use parseSlaField + isSlaBreached with status operational filter.
        // Due date no longer suppresses a resolution-SLA breach — the SLA is authoritative.
        const statusLower = (ticket.status_name || '').toLowerCase();
        const statusPassesSlaFilter = !SLA_EXCLUDED.includes(statusLower);
        if (statusPassesSlaFilter) {
          const slaField = parseSlaField(ticket.fields_json, 'customfield_14048');
          if (isSlaBreached(slaField)) {
            agg.OpenTickets_Over2Hours++;
          }
        }

        // Not Updated: agent-actionable ticket with no activity for >= staleBusinessDays
        // business days. Parked statuses (waiting on customer/dev/partner, scheduled,
        // awaiting deployment, etc.) are not the agent's to action and are excluded.
        if (ticket.jira_updated && !parkedStatuses.has(statusLower)) {
          if (businessDaysBetween(new Date(ticket.jira_updated as any), now) >= staleBusinessDays) {
            agg.OpenTickets_NoUpdateToday++;
          }
        }

        // Oldest ticket tracking
        if (ticket.jira_created) {
          const createdMs = new Date(ticket.jira_created).getTime();
          const ageDays = Math.floor((now.getTime() - createdMs) / (1000 * 60 * 60 * 24));
          if (ageDays > agg.OldestTicketDays) {
            agg.OldestTicketDays = ageDays;
            agg.OldestTicketKey = ticket.issue_key;
          }
        }
      }

      const openStats = Array.from(agentMap.values());

      // Solved today per agent
      const solvedToday = await localQuery<{
        assignee_account_id: string;
        SolvedTickets_Today: number;
      }>(`
        SELECT assignee_account_id, COUNT(*) AS SolvedTickets_Today
        FROM jira_issue_cache
        WHERE ${pf.sql}
          AND status_category = 'Done'
          AND CAST(COALESCE(status_category_changed_at, resolved_at) AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND assignee_account_id IS NOT NULL
          AND current_tier IN ('Customer Care', 'Production', 'Tier 2', 'Tier 3', 'Development')
        GROUP BY assignee_account_id
      `, pf.params);

      // Solved this week per agent
      const solvedWeek = await localQuery<{
        assignee_account_id: string;
        SolvedTickets_ThisWeek: number;
      }>(`
        SELECT assignee_account_id, COUNT(*) AS SolvedTickets_ThisWeek
        FROM jira_issue_cache
        WHERE ${pf.sql}
          AND status_category = 'Done'
          AND COALESCE(status_category_changed_at, resolved_at) >= DATEADD(day, -DATEPART(weekday, GETUTCDATE()) + 2, CAST(GETUTCDATE() AS DATE))
          AND assignee_account_id IS NOT NULL
          AND current_tier IN ('Customer Care', 'Production', 'Tier 2', 'Tier 3', 'Development')
        GROUP BY assignee_account_id
      `, pf.params);

      const solvedTodayMap = new Map(solvedToday.map(r => [r.assignee_account_id, r.SolvedTickets_Today]));
      const solvedWeekMap = new Map(solvedWeek.map(r => [r.assignee_account_id, r.SolvedTickets_ThisWeek]));

      // Update dbo.Agent for each agent that exists in the roster
      let updated = 0;
      const unmatchedAccountIds: string[] = [];
      for (const agent of openStats) {
        const req = p.request();
        req.input('accountId', sql.NVarChar(100), agent.assignee_account_id);
        req.input('openTotal', sql.Int, agent.OpenTickets_Total);
        req.input('over2h', sql.Int, agent.OpenTickets_Over2Hours);
        req.input('noUpdate', sql.Int, agent.OpenTickets_NoUpdateToday);
        req.input('solvedToday', sql.Int, solvedTodayMap.get(agent.assignee_account_id) ?? 0);
        req.input('solvedWeek', sql.Int, solvedWeekMap.get(agent.assignee_account_id) ?? 0);
        req.input('oldestDays', sql.Int, agent.OldestTicketDays ?? 0);
        req.input('oldestKey', sql.NVarChar(50), agent.OldestTicketKey ?? null);

        const result = await req.query(`
          UPDATE dbo.Agent SET
            OpenTickets_Total = @openTotal,
            OpenTickets_Over2Hours = @over2h,
            OpenTickets_NoUpdateToday = @noUpdate,
            SolvedTickets_Today = @solvedToday,
            SolvedTickets_ThisWeek = @solvedWeek,
            OldestTicketDays = @oldestDays,
            OldestTicketKey = @oldestKey,
            TicketsSnapshotAt = GETUTCDATE()
          WHERE AccountId = @accountId
        `);
        if (result.rowsAffected[0] > 0) updated++;
        else unmatchedAccountIds.push(agent.assignee_account_id);
      }

      // Zero out agents with no open tickets
      const activeAccountIds = openStats.map(a => a.assignee_account_id);
      if (activeAccountIds.length > 0) {
        const zeroReq = p.request();
        const placeholders = activeAccountIds.map((id, i) => {
          zeroReq.input(`zid${i}`, sql.NVarChar(100), id);
          return `@zid${i}`;
        }).join(',');
        await zeroReq.query(`
          UPDATE dbo.Agent SET
            OpenTickets_Total = 0, OpenTickets_Over2Hours = 0,
            OpenTickets_NoUpdateToday = 0, OldestTicketDays = 0,
            OldestTicketKey = NULL,
            TicketsSnapshotAt = GETUTCDATE()
          WHERE IsActive = 1 AND AccountId IS NOT NULL
            AND AccountId NOT IN (${placeholders})
        `);
      } else {
        await p.request().query(`
          UPDATE dbo.Agent SET
            OpenTickets_Total = 0, OpenTickets_Over2Hours = 0,
            OpenTickets_NoUpdateToday = 0, OldestTicketDays = 0,
            OldestTicketKey = NULL,
            TicketsSnapshotAt = GETUTCDATE()
          WHERE IsActive = 1 AND AccountId IS NOT NULL
        `);
      }

      // Refresh NOVA AI metrics separately (uses different data source)
      await this.refreshNovaAiMetrics(p);

      console.log(`[kpi-pipeline] Agent metrics refresh: ${openStats.length} agents from cache, ${updated} matched in dbo.Agent, ${unmatchedAccountIds.length} unmatched`);
      if (unmatchedAccountIds.length > 0) {
        console.warn(`[kpi-pipeline] Unmatched AccountIds (no dbo.Agent row): ${unmatchedAccountIds.slice(0, 10).join(', ')}${unmatchedAccountIds.length > 10 ? ` (+${unmatchedAccountIds.length - 10} more)` : ''}`);
      }
    } catch (err) {
      console.error('[kpi-pipeline] refreshAllAgentMetrics failed:', err instanceof Error ? err.message : err);
    }
  }

  async snapshotAgentKpis(): Promise<void> {
    const started = new Date();
    let rowsAffected = 0;
    try {
      let p: sql.ConnectionPool;
      try {
        p = await getKpiPool(this.settings);
      } catch { throw new Error('KPI SQL pool unavailable'); }

      const s = this.s;

      // Use SQL Server's own date to avoid JS timezone drift
      const dateResult = await p.request().query(`SELECT CAST(GETDATE() AS DATE) AS today`);
      const today = dateResult.recordset[0]?.today;
      if (!today) throw new Error('Failed to get server date');

      // Ensure all columns exist on the daily table
      const newCols = [
        'OldestTicketDays INT NULL',
        'SLAResolvedCount INT NULL',
        'SLABreachedCount INT NULL',
        'SLACompliancePct FLOAT NULL',
        'AvailableHours FLOAT NULL',
        'TicketsPerHour FLOAT NULL',
        'CSATCount INT NULL',
        'CSATAverage FLOAT NULL',
        'QATicketsScored INT NULL',
        'QAOverallAvg FLOAT NULL',
        'QAAccuracyAvg FLOAT NULL',
        'QAClarityAvg FLOAT NULL',
        'QAToneAvg FLOAT NULL',
        'QARedCount INT NULL',
        'QAAmberCount INT NULL',
        'QAGreenCount INT NULL',
        'QAConcerningCount INT NULL',
        'GoldenRulesScored INT NULL',
        'GoldenRulesAvg FLOAT NULL',
        'OwnershipAvg FLOAT NULL',
        'NextActionAvg FLOAT NULL',
        'TimeframeAvg FLOAT NULL',
        'ragProductivity NVARCHAR(10) NULL',
        'ragCSAT NVARCHAR(10) NULL',
        'ragQA NVARCHAR(10) NULL',
        'ragGoldenRules NVARCHAR(10) NULL',
        'ragOver2h NVARCHAR(10) NULL',
        'ragStale NVARCHAR(10) NULL',
        'ragSLA NVARCHAR(10) NULL',
        'ragOldestTicket NVARCHAR(10) NULL',
      ];
      for (const colDef of newCols) {
        const colName = colDef.split(' ')[0];
        await p.request().query(`
          IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.jira_agent_kpi_daily${s}') AND name = '${colName}')
            ALTER TABLE dbo.jira_agent_kpi_daily${s} ADD ${colDef};
        `).catch(() => {});
      }

      // Read agents from live Agent table
      const agents = await p.request().query(`
        SELECT AgentId, AccountId,
               RTRIM(LTRIM(ISNULL(AgentName, '') + ' ' + ISNULL(AgentSurname, ''))) AS AgentName,
               ISNULL(TierCode, '') AS TierCode,
               ISNULL(Team, '') AS Team,
               ISNULL(IsAvailable, 0) AS IsAvailable,
               ISNULL(OpenTickets_Total, 0) AS OpenTickets_Total,
               ISNULL(OpenTickets_Over2Hours, 0) AS OpenTickets_Over2Hours,
               ISNULL(OpenTickets_NoUpdateToday, 0) AS OpenTickets_NoUpdateToday,
               ISNULL(SolvedTickets_Today, 0) AS SolvedTickets_Today,
               ISNULL(SolvedTickets_ThisWeek, 0) AS SolvedTickets_ThisWeek,
               ISNULL(OldestTicketDays, 0) AS OldestTicketDays
        FROM dbo.Agent WHERE IsActive = 1 AND AgentId IS NOT NULL
      `);

      if (agents.recordset.length === 0) return;

      // Get QA scores for today
      const qaScores = new Map<string, any>();
      try {
        const qaResult = await p.request().query(`
          SELECT assigneeName, COUNT(*) AS qaTicketsScored,
                 AVG(CAST(overallScore AS FLOAT)) AS avgOverallScore,
                 AVG(CAST(accuracyScore AS FLOAT)) AS avgAccuracyScore,
                 AVG(CAST(clarityScore AS FLOAT)) AS avgClarityScore,
                 AVG(CAST(toneScore AS FLOAT)) AS avgToneScore,
                 SUM(CASE WHEN grade = 'RED' THEN 1 ELSE 0 END) AS redCount,
                 SUM(CASE WHEN grade = 'AMBER' THEN 1 ELSE 0 END) AS amberCount,
                 SUM(CASE WHEN grade = 'GREEN' THEN 1 ELSE 0 END) AS greenCount,
                 SUM(CAST(ISNULL(isConcerning, 0) AS INT)) AS concerningCount
          FROM dbo.jira_qa_results
          WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
            -- Excluded rows (chat, no public agent contribution) store overallScore = 0.
            -- Without this filter they drag every agent's daily QA average toward zero.
            AND ISNULL(qaType, '') <> 'excluded'
          GROUP BY assigneeName
        `);
        for (const r of qaResult.recordset) {
          qaScores.set((r.assigneeName || '').trim().toLowerCase(), r);
        }
      } catch { /* jira_qa_results may not exist */ }

      // Get Golden Rules scores for today
      const grScores = new Map<string, any>();
      try {
        const grResult = await p.request().query(`
          -- Updater, not Assignee: the score belongs to whoever WROTE the comment.
          -- Grouping by Assignee moved Agent A's score onto Agent B's average whenever
          -- A commented on B's ticket.
          SELECT Updater AS Assignee, COUNT(*) AS goldenRulesScored,
                 AVG(CAST(OverallScore AS FLOAT)) AS avgGoldenRulesScore,
                 AVG(CAST(Rule1Score AS FLOAT)) AS avgOwnershipScore,
                 AVG(CAST(Rule2Score AS FLOAT)) AS avgNextActionScore,
                 AVG(CAST(Rule3Score AS FLOAT)) AS avgTimeframeScore
          FROM dbo.Jira_QA_GoldenRules
          WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
          GROUP BY Updater
        `);
        for (const r of grResult.recordset) {
          grScores.set((r.Assignee || '').trim().toLowerCase(), r);
        }
      } catch { /* Jira_QA_GoldenRules may not exist */ }

      // Get CSAT per agent from resolved-today tickets
      const pfAgent = this.projectInClause();
      const csatPerAgent = new Map<string, { count: number; sum: number }>();
      try {
        const csatRows = await localQuery<{ assignee_account_id: string; fields_json: string | null }>(`
          SELECT assignee_account_id, fields_json FROM jira_issue_cache
          WHERE ${pfAgent.sql} AND status_category = 'Done'
            AND CAST(COALESCE(status_category_changed_at, resolved_at) AS DATE) = CAST(GETUTCDATE() AS DATE)
            AND assignee_account_id IS NOT NULL
            AND fields_json IS NOT NULL
        `, pfAgent.params);
        for (const r of csatRows) {
          const rating = parseCsat(r.fields_json);
          if (rating !== null) {
            const existing = csatPerAgent.get(r.assignee_account_id) ?? { count: 0, sum: 0 };
            existing.count++;
            existing.sum += rating;
            csatPerAgent.set(r.assignee_account_id, existing);
          }
        }
      } catch { /* non-critical */ }

      // Get SLA stats per agent from resolved-today tickets
      const slaPerAgent = new Map<string, { resolved: number; breached: number }>();
      try {
        const slaRows = await localQuery<{ assignee_account_id: string; fields_json: string | null }>(`
          SELECT assignee_account_id, fields_json FROM jira_issue_cache
          WHERE ${pfAgent.sql} AND status_category = 'Done'
            AND CAST(COALESCE(status_category_changed_at, resolved_at) AS DATE) = CAST(GETUTCDATE() AS DATE)
            AND assignee_account_id IS NOT NULL
        `, pfAgent.params);
        for (const r of slaRows) {
          const resBreached = isSlaBreached(parseSlaField(r.fields_json, 'customfield_14048'));
          if (resBreached !== null) {
            const existing = slaPerAgent.get(r.assignee_account_id) ?? { resolved: 0, breached: 0 };
            existing.resolved++;
            if (resBreached) existing.breached++;
            slaPerAgent.set(r.assignee_account_id, existing);
          }
        }
      } catch { /* non-critical */ }

      // Shared with the kpi-agent RAG path so the floor is defined once.
      const { minSample } = getRagThresholds(this.settings);

      for (const a of agents.recordset) {
        if (!a.AgentName?.trim()) continue;

        const agentNameLower = (a.AgentName || '').trim().toLowerCase();
        const qa = qaScores.get(agentNameLower);
        const gr = grScores.get(agentNameLower);
        const csat = a.AccountId ? csatPerAgent.get(a.AccountId) : undefined;
        const sla = a.AccountId ? slaPerAgent.get(a.AccountId) : undefined;

        const availableHours = a.IsAvailable ? 7.5 : 0;
        const ticketsPerHour = availableHours > 0 ? Math.round((Number(a.SolvedTickets_Today) / 7.5) * 100) / 100 : null;
        const slaCompliance = sla && sla.resolved > 0 ? Math.round(((sla.resolved - sla.breached) / sla.resolved) * 100 * 100) / 100 : null;
        const csatAvg = csat && csat.count > 0 ? Math.round((csat.sum / csat.count) * 100) / 100 : null;

        // RAG calculations
        const ragProductivity = ticketsPerHour !== null ? (ticketsPerHour >= 1.5 ? 'Green' : ticketsPerHour >= 1.0 ? 'Amber' : 'Red') : null;
        const ragCSAT = csatAvg !== null ? (csatAvg >= 4.0 ? 'Green' : csatAvg >= 3.0 ? 'Amber' : 'Red') : null;
        // Below the minimum sample the rating is withheld rather than awarded on
        // noise — QA now excludes tickets with no public agent contribution, so a single
        // day's sample can be 1-2 tickets for agents in the abuse-report pools.
        const ragQA = qa && Number(qa.qaTicketsScored) >= minSample.qa
          ? (qa.avgOverallScore >= 8.0 ? 'Green' : qa.avgOverallScore >= 6.0 ? 'Amber' : 'Red')  // QA OverallScore is 0–10
          : null;
        const ragGoldenRules = gr && Number(gr.goldenRulesScored) >= minSample.goldenRules
          ? (gr.avgGoldenRulesScore >= 3.0 ? 'Green' : gr.avgGoldenRulesScore >= 2.0 ? 'Amber' : 'Red')
          : null;
        const ragOver2h = Number(a.OpenTickets_Over2Hours) <= 0 ? 'Green' : Number(a.OpenTickets_Over2Hours) <= 2 ? 'Amber' : 'Red';
        const ragStale = Number(a.OpenTickets_NoUpdateToday) <= 0 ? 'Green' : Number(a.OpenTickets_NoUpdateToday) <= 1 ? 'Amber' : 'Red';
        const ragSLA = slaCompliance !== null ? (slaCompliance >= 95 ? 'Green' : slaCompliance >= 90 ? 'Amber' : 'Red') : null;
        const ragOldestTicket = Number(a.OldestTicketDays) <= 3 ? 'Green' : Number(a.OldestTicketDays) <= 7 ? 'Amber' : 'Red';

        const request = p.request();
        request.input('reportDate', sql.Date, today);
        request.input('agentId', sql.Int, Number(a.AgentId) || 0);
        request.input('agentName', sql.NVarChar(200), (a.AgentName || 'Unknown').slice(0, 200));
        request.input('tierCode', sql.NVarChar(50), (a.TierCode || '').slice(0, 50));
        request.input('team', sql.NVarChar(100), (a.Team || '').slice(0, 100));
        request.input('openTotal', sql.Int, Number(a.OpenTickets_Total) || 0);
        request.input('over2h', sql.Int, Number(a.OpenTickets_Over2Hours) || 0);
        request.input('noUpdate', sql.Int, Number(a.OpenTickets_NoUpdateToday) || 0);
        request.input('solvedToday', sql.Int, Number(a.SolvedTickets_Today) || 0);
        request.input('solvedWeek', sql.Int, Number(a.SolvedTickets_ThisWeek) || 0);
        request.input('oldestDays', sql.Int, Number(a.OldestTicketDays) || 0);
        request.input('slaResolved', sql.Int, sla?.resolved ?? null);
        request.input('slaBreached', sql.Int, sla?.breached ?? null);
        request.input('slaCompliance', sql.Float, slaCompliance);
        request.input('availableHours', sql.Float, availableHours);
        request.input('ticketsPerHour', sql.Float, ticketsPerHour);
        request.input('csatCount', sql.Int, csat?.count ?? null);
        request.input('csatAverage', sql.Float, csatAvg);
        request.input('qaTicketsScored', sql.Int, qa?.qaTicketsScored ?? null);
        request.input('qaOverallAvg', sql.Float, qa?.avgOverallScore ?? null);
        request.input('qaAccuracyAvg', sql.Float, qa?.avgAccuracyScore ?? null);
        request.input('qaClarityAvg', sql.Float, qa?.avgClarityScore ?? null);
        request.input('qaToneAvg', sql.Float, qa?.avgToneScore ?? null);
        request.input('qaRedCount', sql.Int, qa?.redCount ?? null);
        request.input('qaAmberCount', sql.Int, qa?.amberCount ?? null);
        request.input('qaGreenCount', sql.Int, qa?.greenCount ?? null);
        request.input('qaConcerningCount', sql.Int, qa?.concerningCount ?? null);
        request.input('grScored', sql.Int, gr?.goldenRulesScored ?? null);
        request.input('grAvg', sql.Float, gr?.avgGoldenRulesScore ?? null);
        request.input('ownershipAvg', sql.Float, gr?.avgOwnershipScore ?? null);
        request.input('nextActionAvg', sql.Float, gr?.avgNextActionScore ?? null);
        request.input('timeframeAvg', sql.Float, gr?.avgTimeframeScore ?? null);
        request.input('ragProductivity', sql.NVarChar(10), ragProductivity);
        request.input('ragCSAT', sql.NVarChar(10), ragCSAT);
        request.input('ragQA', sql.NVarChar(10), ragQA);
        request.input('ragGoldenRules', sql.NVarChar(10), ragGoldenRules);
        request.input('ragOver2h', sql.NVarChar(10), ragOver2h);
        request.input('ragStale', sql.NVarChar(10), ragStale);
        request.input('ragSLA', sql.NVarChar(10), ragSLA);
        request.input('ragOldestTicket', sql.NVarChar(10), ragOldestTicket);

        await request.query(`
          MERGE dbo.jira_agent_kpi_daily${s} AS t
          USING (SELECT @reportDate AS ReportDate, @agentName AS AgentName) AS s
          ON t.ReportDate = s.ReportDate AND t.AgentName = s.AgentName
          WHEN MATCHED THEN UPDATE SET
            AgentId = @agentId, TierCode = @tierCode, Team = @team,
            OpenTickets_Total = @openTotal, OpenTickets_Over2Hours = @over2h,
            OpenTickets_NoUpdateToday = @noUpdate,
            SolvedTickets_Today = @solvedToday, SolvedTickets_ThisWeek = @solvedWeek,
            OldestTicketDays = @oldestDays,
            SLAResolvedCount = @slaResolved, SLABreachedCount = @slaBreached, SLACompliancePct = @slaCompliance,
            AvailableHours = @availableHours, TicketsPerHour = @ticketsPerHour,
            CSATCount = @csatCount, CSATAverage = @csatAverage,
            QATicketsScored = @qaTicketsScored, QAOverallAvg = @qaOverallAvg,
            QAAccuracyAvg = @qaAccuracyAvg, QAClarityAvg = @qaClarityAvg, QAToneAvg = @qaToneAvg,
            QARedCount = @qaRedCount, QAAmberCount = @qaAmberCount, QAGreenCount = @qaGreenCount, QAConcerningCount = @qaConcerningCount,
            GoldenRulesScored = @grScored, GoldenRulesAvg = @grAvg,
            OwnershipAvg = @ownershipAvg, NextActionAvg = @nextActionAvg, TimeframeAvg = @timeframeAvg,
            ragProductivity = @ragProductivity, ragCSAT = @ragCSAT, ragQA = @ragQA, ragGoldenRules = @ragGoldenRules,
            ragOver2h = @ragOver2h, ragStale = @ragStale, ragSLA = @ragSLA, ragOldestTicket = @ragOldestTicket
          WHEN NOT MATCHED THEN INSERT
            (ReportDate, AgentId, AgentName, TierCode, Team,
             OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
             SolvedTickets_Today, SolvedTickets_ThisWeek, OldestTicketDays,
             SLAResolvedCount, SLABreachedCount, SLACompliancePct,
             AvailableHours, TicketsPerHour, CSATCount, CSATAverage,
             QATicketsScored, QAOverallAvg, QAAccuracyAvg, QAClarityAvg, QAToneAvg,
             QARedCount, QAAmberCount, QAGreenCount, QAConcerningCount,
             GoldenRulesScored, GoldenRulesAvg, OwnershipAvg, NextActionAvg, TimeframeAvg,
             ragProductivity, ragCSAT, ragQA, ragGoldenRules, ragOver2h, ragStale, ragSLA, ragOldestTicket)
          VALUES (@reportDate, @agentId, @agentName, @tierCode, @team,
                  @openTotal, @over2h, @noUpdate, @solvedToday, @solvedWeek, @oldestDays,
                  @slaResolved, @slaBreached, @slaCompliance,
                  @availableHours, @ticketsPerHour, @csatCount, @csatAverage,
                  @qaTicketsScored, @qaOverallAvg, @qaAccuracyAvg, @qaClarityAvg, @qaToneAvg,
                  @qaRedCount, @qaAmberCount, @qaGreenCount, @qaConcerningCount,
                  @grScored, @grAvg, @ownershipAvg, @nextActionAvg, @timeframeAvg,
                  @ragProductivity, @ragCSAT, @ragQA, @ragGoldenRules, @ragOver2h, @ragStale, @ragSLA, @ragOldestTicket);
        `);
        rowsAffected++;
      }

      // Verify rows exist for today
      const verifyReq = p.request();
      verifyReq.input('checkDate', sql.Date, today);
      const verify = await verifyReq.query(`SELECT COUNT(*) AS cnt FROM dbo.jira_agent_kpi_daily${s} WHERE ReportDate = @checkDate`);
      const todayCount = verify.recordset[0]?.cnt ?? 0;
      console.log(`[kpi-pipeline] Agent snapshot → ${s || 'live'}: ${agents.recordset.length} agents processed, ${todayCount} rows for ${today instanceof Date ? today.toISOString().slice(0, 10) : today}`);

      await this.monitor?.logRun({
        pipeline_name: 'kpi-agent-snapshot', started_at: started, completed_at: new Date(),
        status: 'success', rows_affected: rowsAffected, error_message: null,
        duration_ms: Date.now() - started.getTime(),
      });
    } catch (err) {
      console.error('[kpi-pipeline] Agent snapshot failed:', err instanceof Error ? err.message : err);
      await this.monitor?.logRun({
        pipeline_name: 'kpi-agent-snapshot', started_at: started, completed_at: new Date(),
        status: 'error', rows_affected: rowsAffected, error_message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - started.getTime(),
      });
    }
  }

  async generateDailyDigest(): Promise<DailyDigest | null> {
    const started = new Date();
    try {
      let p: sql.ConnectionPool;
      try {
        p = await getKpiPool(this.settings);
      } catch { return null; }

      const today = new Date().toISOString().slice(0, 10);
      const s = this.s;

      // Read from whichever target we're writing to
      const kpiRows = await p.request().query(`
        SELECT kpi, kpiGroup, [count], target, direction, rag
        FROM dbo.jira_kpi_daily${s}
        WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
        ORDER BY kpiGroup, kpi
      `);
      const kpiData = kpiRows.recordset.map((r: any) =>
        `${r.kpi} (${r.kpiGroup}): ${r.count} (target: ${r.target}, ${r.direction}, RAG: ${r.rag === 1 ? 'Green' : r.rag === 2 ? 'Amber' : 'Red'})`
      ).join('\n') || 'No KPI data for today';

      const agentRows = await p.request().query(`
        SELECT AgentName, TierCode, Team,
               OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
               SolvedTickets_Today, SolvedTickets_ThisWeek
        FROM dbo.jira_agent_kpi_daily${s}
        WHERE ReportDate = CAST(GETDATE() AS DATE)
        ORDER BY AgentName
      `);
      const agentData = agentRows.recordset.map((a: any) =>
        `${a.AgentName} (${a.TierCode}/${a.Team}): ${a.OpenTickets_Total} open, ${a.SolvedTickets_Today} solved today, ${a.OpenTickets_Over2Hours} >2h, ${a.OpenTickets_NoUpdateToday} no update`
      ).join('\n') || 'No agent data for today';

      const prompt = loadPrompt('kpi-daily-digest', {
        date: today,
        kpi_data: kpiData,
        agent_data: agentData,
        queue_health: kpiData,
      });

      let digest: DailyDigest;
      try {
        const result = await this.llmService.call<DailyDigest>(
          prompt,
          'Generate the daily KPI digest for today.',
          DailyDigestSchema,
          { temperature: 0.3, callType: 'kpi_daily_digest' },
        );
        digest = result.data;
      } catch (llmErr) {
        console.warn('[kpi-pipeline] Daily digest LLM failed, using fallback:', llmErr instanceof Error ? llmErr.message : llmErr);
        digest = {
          headline: `KPI Summary for ${today}`,
          kpi_summary: [kpiData],
          agent_highlights: agentData,
          concerns: [],
          actions: [],
          narrative: `Daily digest could not be generated by AI. Raw data:\n\n${kpiData}\n\n${agentData}`,
        };
      }

      await this.saveDigest(p, 'daily', digest.narrative, this.formatDigestHtml(digest));

      console.log(`[kpi-pipeline] Daily digest generated → ${s || 'live'}`);

      await this.monitor?.logRun({
        pipeline_name: 'kpi-daily-digest', started_at: started, completed_at: new Date(),
        status: 'success', rows_affected: 1, error_message: null,
        duration_ms: Date.now() - started.getTime(),
      });
      return digest;
    } catch (err) {
      console.error('[kpi-pipeline] Daily digest failed:', err instanceof Error ? err.message : err);
      await this.monitor?.logRun({
        pipeline_name: 'kpi-daily-digest', started_at: started, completed_at: new Date(),
        status: 'error', rows_affected: 0, error_message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - started.getTime(),
      });
      return null;
    }
  }

  async generateWeeklyDigest(): Promise<WeeklyDigest | null> {
    const started = new Date();
    try {
      let p: sql.ConnectionPool;
      try {
        p = await getKpiPool(this.settings);
      } catch { return null; }

      const s = this.s;

      const currentKpis = await p.request().query(`
        SELECT kpi, kpiGroup, AVG([count]) as avg_count, MAX(target) as target, MAX(direction) as direction
        FROM dbo.jira_kpi_daily${s}
        WHERE CreatedAt >= DATEADD(day, -7, GETDATE())
        GROUP BY kpi, kpiGroup ORDER BY kpiGroup, kpi
      `);

      const previousKpis = await p.request().query(`
        SELECT kpi, kpiGroup, AVG([count]) as avg_count
        FROM dbo.jira_kpi_daily${s}
        WHERE CreatedAt >= DATEADD(day, -14, GETDATE()) AND CreatedAt < DATEADD(day, -7, GETDATE())
        GROUP BY kpi, kpiGroup ORDER BY kpiGroup, kpi
      `);

      const agentSummary = await p.request().query(`
        SELECT AgentName,
               AVG(CAST(OpenTickets_Total AS FLOAT)) as avg_open,
               SUM(SolvedTickets_Today) as total_solved,
               AVG(CAST(OpenTickets_Over2Hours AS FLOAT)) as avg_over2h
        FROM dbo.jira_agent_kpi_daily${s}
        WHERE ReportDate >= DATEADD(day, -7, GETDATE())
        GROUP BY AgentName ORDER BY total_solved DESC
      `);

      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

      const currentText = currentKpis.recordset.map((r: any) =>
        `${r.kpi}: avg ${Math.round(r.avg_count * 10) / 10} (target: ${r.target}, ${r.direction})`
      ).join('\n') || 'No data';

      const previousText = previousKpis.recordset.map((r: any) =>
        `${r.kpi}: avg ${Math.round(r.avg_count * 10) / 10}`
      ).join('\n') || 'No data';

      const agentText = agentSummary.recordset.map((a: any) =>
        `${a.AgentName}: ${a.total_solved} solved, avg ${Math.round(a.avg_open)} open, avg ${Math.round(a.avg_over2h * 10) / 10} >2h`
      ).join('\n') || 'No data';

      const prompt = loadPrompt('kpi-weekly-digest', {
        period: `${startDate} to ${endDate}`,
        current_kpis: currentText,
        previous_kpis: previousText,
        agent_summary: agentText,
        classification_trends: 'See ticket classification service for detailed trends',
      });

      const result = await this.llmService.call<WeeklyDigest>(
        prompt,
        'Generate the weekly KPI digest.',
        WeeklyDigestSchema,
        { temperature: 0.3, callType: 'kpi_weekly_digest' },
      );

      if (result.data) {
        await this.saveDigest(p, 'weekly', result.data.narrative, this.formatWeeklyHtml(result.data));
      }

      console.log(`[kpi-pipeline] Weekly digest generated → ${s || 'live'}`);

      await this.monitor?.logRun({
        pipeline_name: 'kpi-weekly-digest', started_at: started, completed_at: new Date(),
        status: 'success', rows_affected: 1, error_message: null,
        duration_ms: Date.now() - started.getTime(),
      });
      return result.data;
    } catch (err) {
      console.error('[kpi-pipeline] Weekly digest failed:', err instanceof Error ? err.message : err);
      await this.monitor?.logRun({
        pipeline_name: 'kpi-weekly-digest', started_at: started, completed_at: new Date(),
        status: 'error', rows_affected: 0, error_message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - started.getTime(),
      });
      return null;
    }
  }

  async getLatestDigest(period: 'daily' | 'weekly'): Promise<any | null> {
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;
      const request = p.request();
      request.input('period', sql.NVarChar, period);
      const result = await request.query(`
        SELECT TOP 1 period, summary, html, CreatedAt
        FROM dbo.jira_kpi_digest${s}
        WHERE period = @period
        ORDER BY CreatedAt DESC
      `);
      return result.recordset[0] ?? null;
    } catch { return null; }
  }

  private async saveDigest(p: sql.ConnectionPool, period: string, summary: string, html: string): Promise<void> {
    const s = this.s;
    const request = p.request();
    request.input('period', sql.NVarChar, period);
    request.input('summary', sql.NVarChar, summary.slice(0, 4000));
    request.input('html', sql.NVarChar, html.slice(0, 8000));
    await request.query(`
      INSERT INTO dbo.jira_kpi_digest${s} (period, summary, html, CreatedAt)
      VALUES (@period, @summary, @html, GETUTCDATE())
    `);
  }

  private formatDigestHtml(d: DailyDigest): string {
    const bullets = d.kpi_summary.map(b => `<li>${b}</li>`).join('');
    const concerns = d.concerns.length > 0
      ? `<h3>Concerns</h3><ul>${d.concerns.map(c => `<li>${c}</li>`).join('')}</ul>`
      : '';
    const actions = d.actions.length > 0
      ? `<h3>Recommended Actions</h3><ul>${d.actions.map(a => `<li>${a}</li>`).join('')}</ul>`
      : '';
    return `<h2>${d.headline}</h2><ul>${bullets}</ul><p><strong>Agents:</strong> ${d.agent_highlights}</p>${concerns}${actions}<p><em>${d.narrative}</em></p>`;
  }

  private formatWeeklyHtml(d: WeeklyDigest): string {
    const wowRows = d.week_over_week.map(w =>
      `<tr><td>${w.kpi}</td><td>${w.this_week}</td><td>${w.last_week}</td><td>${w.change_pct > 0 ? '+' : ''}${w.change_pct}%</td></tr>`
    ).join('');
    const wins = d.wins.map(w => `<li>${w}</li>`).join('');
    const risks = d.risks.map(r => `<li>${r}</li>`).join('');
    const recs = d.recommendations.map(r => `<li>${r}</li>`).join('');
    return `<h2>${d.headline}</h2><table><tr><th>KPI</th><th>This Week</th><th>Last Week</th><th>Change</th></tr>${wowRows}</table><h3>Wins</h3><ul>${wins}</ul><h3>Risks</h3><ul>${risks}</ul><h3>Recommendations</h3><ul>${recs}</ul><p><em>${d.narrative}</em></p>`;
  }

  private async refreshNovaAiMetrics(kpiPool: sql.ConnectionPool): Promise<void> {
    try {
      const novaAccountId = this.settings.get('nova_ai_jira_account_id');
      if (!novaAccountId) {
        console.warn('[kpi-pipeline] nova_ai_jira_account_id not configured — skipping NOVA AI metrics');
        return;
      }

      const openStats = await localQuery<{
        openTotal: number; over2h: number; noUpdate: number; oldestDays: number | null;
      }>(`
        SELECT COUNT(*) AS openTotal,
               SUM(CASE WHEN DATEDIFF(hour, jira_updated, GETUTCDATE()) > 2 THEN 1 ELSE 0 END) AS over2h,
               SUM(CASE WHEN CAST(jira_updated AS DATE) < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) AS noUpdate,
               MAX(DATEDIFF(day, jira_created, GETUTCDATE())) AS oldestDays
        FROM jira_issue_cache
        WHERE assignee_account_id = @p0
          AND status_category NOT IN ('Done', 'Cancelled')
      `, [novaAccountId]);

      const pf = this.projectInClause();
      const solvedTodayRows = await localQuery<{ solvedToday: number }>(`
        SELECT COUNT(*) AS solvedToday
        FROM jira_issue_cache
        WHERE ${pf.sql}
          AND status_category = 'Done'
          AND CAST(COALESCE(status_category_changed_at, resolved_at) AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND assignee_account_id = @p${pf.params.length}
      `, [...pf.params, novaAccountId]);

      const solvedWeekRows = await localQuery<{ solvedWeek: number }>(`
        SELECT COUNT(*) AS solvedWeek
        FROM jira_issue_cache
        WHERE ${pf.sql}
          AND status_category = 'Done'
          AND COALESCE(status_category_changed_at, resolved_at) >= DATEADD(day, -DATEPART(weekday, GETUTCDATE()) + 2, CAST(GETUTCDATE() AS DATE))
          AND assignee_account_id = @p${pf.params.length}
      `, [...pf.params, novaAccountId]);

      const open = openStats[0] ?? { openTotal: 0, over2h: 0, noUpdate: 0, oldestDays: 0 };
      const solvedToday = solvedTodayRows[0]?.solvedToday ?? 0;
      const solvedWeek = solvedWeekRows[0]?.solvedWeek ?? 0;

      const req = kpiPool.request();
      req.input('openTotal', sql.Int, open.openTotal ?? 0);
      req.input('over2h', sql.Int, open.over2h ?? 0);
      req.input('noUpdate', sql.Int, open.noUpdate ?? 0);
      req.input('solvedToday', sql.Int, solvedToday);
      req.input('solvedWeek', sql.Int, solvedWeek);
      req.input('oldestDays', sql.Int, open.oldestDays ?? 0);
      await req.query(`
        UPDATE dbo.Agent SET
          OpenTickets_Total = @openTotal,
          OpenTickets_Over2Hours = @over2h,
          OpenTickets_NoUpdateToday = @noUpdate,
          SolvedTickets_Today = @solvedToday,
          SolvedTickets_ThisWeek = @solvedWeek,
          OldestTicketDays = @oldestDays
        WHERE AgentName = 'NOVA' AND AgentSurname = 'AI'
      `);

      console.log(`[kpi-pipeline] NOVA AI metrics refreshed: ${open.openTotal} open, ${solvedToday} solved today, ${solvedWeek} this week`);
    } catch (err) {
      console.warn('[kpi-pipeline] Failed to refresh NOVA AI metrics:', err instanceof Error ? err.message : err);
    }
  }

  async backfillNovaAiKpis(): Promise<{ daysProcessed: number }> {
    const goLiveDate = this.settings.get('agent_go_live_date') || '2026-04-23';
    const p = await getKpiPool(this.settings);
    const s = this.s;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const endDate = yesterday.toISOString().slice(0, 10);

    const dates: string[] = [];
    const current = new Date(goLiveDate);
    const end = new Date(endDate);
    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }

    let daysProcessed = 0;

    const novaAccountId = this.settings.get('nova_ai_jira_account_id');
    if (!novaAccountId) {
      console.warn('[kpi-pipeline] nova_ai_jira_account_id not configured — skipping NOVA AI backfill');
      return { daysProcessed: 0 };
    }
    const pf = this.projectInClause();

    for (const date of dates) {
      const solvedRows = await localQuery<{ solvedToday: number }>(`
        SELECT COUNT(*) AS solvedToday
        FROM jira_issue_cache
        WHERE ${pf.sql}
          AND status_category = 'Done'
          AND CAST(jira_updated AS DATE) = @p${pf.params.length}
          AND assignee_account_id = @p${pf.params.length + 1}
      `, [...pf.params, date, novaAccountId]);

      const weekStart = new Date(date);
      const dayOfWeek = weekStart.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      weekStart.setDate(weekStart.getDate() + mondayOffset);
      const weekStartStr = weekStart.toISOString().slice(0, 10);

      const solvedWeekRows = await localQuery<{ solvedWeek: number }>(`
        SELECT COUNT(*) AS solvedWeek
        FROM jira_issue_cache
        WHERE ${pf.sql}
          AND status_category = 'Done'
          AND CAST(jira_updated AS DATE) BETWEEN @p${pf.params.length} AND @p${pf.params.length + 1}
          AND assignee_account_id = @p${pf.params.length + 2}
      `, [...pf.params, weekStartStr, date, novaAccountId]);

      const solvedToday = solvedRows[0]?.solvedToday ?? 0;
      const solvedWeek = solvedWeekRows[0]?.solvedWeek ?? 0;

      const req = p.request();
      req.input('reportDate', sql.Date, date);
      req.input('solvedToday', sql.Int, solvedToday);
      req.input('solvedWeek', sql.Int, solvedWeek);
      await req.query(`
        UPDATE dbo.jira_agent_kpi_daily${s}
        SET SolvedTickets_Today = @solvedToday, SolvedTickets_ThisWeek = @solvedWeek
        WHERE ReportDate = @reportDate AND AgentName = 'NOVA AI'
      `);

      console.log(`[kpi-pipeline] NOVA AI backfill: ${date} → ${solvedToday} solved`);
      daysProcessed++;
    }

    return { daysProcessed };
  }
}
