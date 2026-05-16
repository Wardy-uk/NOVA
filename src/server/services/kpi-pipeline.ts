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

let pool: sql.ConnectionPool | null = null;

async function getKpiPool(settings: SettingsQueries): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;

  const all = settings.getAll();
  const server = all.kpi_sql_server;
  const database = all.kpi_sql_database;
  const user = all.kpi_sql_user;
  const password = all.kpi_sql_password;

  if (!server || !database || !user || !password) {
    throw new Error('KPI SQL Server not configured');
  }

  pool = await new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  }).connect();

  return pool;
}

function computeRag(value: number, target: number, direction: string): number {
  if (direction === 'Higher is better') {
    if (value >= target) return 1;
    if (value >= target * 0.8) return 2;
    return 3;
  }
  if (value <= target) return 1;
  if (value <= target * 1.5) return 2;
  return 3;
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

const ACTIONABLE_STATUSES = ['open', 'reopened', 'work in progress'];
const EXCLUDED_STATUSES = ['done', 'closed', 'resolved', 'waiting on requestor', 'waiting on partner'];

function isActionable(status: string | null): boolean {
  return ACTIONABLE_STATUSES.includes((status || '').toLowerCase());
}

function isExcludedStatus(status: string | null): boolean {
  return EXCLUDED_STATUSES.includes((status || '').toLowerCase());
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
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  if (lastUpdated >= startOfToday) return false;
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
const ALL_TIERS = ['Customer Care', 'CC (Incidents)', 'CC (Service Requests)', 'CC (TPJ)', 'Production', 'Tier 2', 'Tier 3', 'Development'];

export class KpiPipeline {
  constructor(
    private settings: SettingsQueries,
    private llmService: LlmService,
    private jiraClient: JiraRestClient,
    private jiraProject: string = 'NT',
    private monitor?: PipelineMonitor,
    private cache?: JiraCacheQueries,
  ) {}

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

      const targets = await this.loadTargets(p);
      const endOfToday = new Date(now);
      endOfToday.setUTCHours(23, 59, 59, 999);

      // Step 1: Load all open NT tickets from local MSSQL cache
      const openRows = await localQuery<CacheRow>(`
        SELECT issue_key, status_name, status_category, current_tier, request_type,
               assignee_account_id, assignee_display, jira_created, jira_updated, due_date,
               sla_breached, sla_breach_time, agent_last_updated, agent_next_update,
               no_reply, fields_json, issuetype_name, resolution_name
        FROM jira_issue_cache
        WHERE project_key = @p0 AND status_category != 'Done'
      `, [this.jiraProject]);

      // Step 2: Load resolved-today tickets
      const resolvedRows = await localQuery<CacheRow>(`
        SELECT issue_key, status_name, status_category, current_tier, request_type,
               assignee_account_id, assignee_display, jira_created, jira_updated, due_date,
               sla_breached, sla_breach_time, agent_last_updated, agent_next_update,
               no_reply, fields_json, issuetype_name, resolution_name
        FROM jira_issue_cache
        WHERE project_key = @p0
          AND resolution_name IS NOT NULL
          AND CAST(jira_updated AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND status_category = 'Done'
      `, [this.jiraProject]);

      // Step 3: Created today count
      const createdTodayRows = await localQuery<{ cnt: number }>(`
        SELECT COUNT(*) AS cnt FROM jira_issue_cache
        WHERE project_key = @p0 AND CAST(jira_created AS DATE) = CAST(GETUTCDATE() AS DATE)
      `, [this.jiraProject]);

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
        excluded: boolean;
      };

      function parseTicket(t: CacheRow): ParsedTicket {
        const rawTier = classifyTier(t.current_tier);
        const tier = rawTier === 'Customer Care' ? ccBucket(t.request_type) : rawTier;
        return {
          ...t,
          tier,
          frtBreached: isSlaBreached(parseSlaField(t.fields_json, 'customfield_14046')),
          resBreached: isSlaBreached(parseSlaField(t.fields_json, 'customfield_14048')),
          csat: parseCsat(t.fields_json),
          actionable: isActionable(t.status_name),
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

        const dueDateOk = !t.due_date || new Date(t.due_date) <= endOfToday;
        if (t.resBreached === true) {
          if (t.actionable && dueDateOk) stats.resBreachedActionable++;
          else if (!t.excluded && !t.actionable) stats.resBreachedNotActionable++;
        }
        if (t.frtBreached === true) {
          if (t.actionable) stats.frtBreachedActionable++;
          else if (!t.excluded && !t.actionable) stats.frtBreachedNotActionable++;
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
        { kpi: 'Resolved Today', group: 'Throughput', count: parsedResolved.length, target: t('Resolved Today').target || 15, direction: 'Higher is better' },
        { kpi: 'New Tickets Today', group: 'Volume', count: createdToday, target: t('New Tickets Today').target || 20, direction: 'Lower is better' },
        { kpi: 'Created Today', group: 'Volume', count: createdToday, target: t('Created Today').target || 20, direction: 'Lower is better' },
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
        if (stats.volume === 0 && !ALL_TIERS.includes(tier)) continue;
        metrics.push(
          { kpi: `${tier} — Volume`, group: 'Tier Volume', count: stats.volume, target: 0, direction: 'Lower is better' },
          { kpi: `${tier} — No Reply`, group: 'Tier No Reply', count: stats.noReply, target: 0, direction: 'Lower is better' },
          { kpi: `${tier} — Oldest Actionable (days)`, group: 'Tier Age', count: stats.oldestActionableDays, target: 0, direction: 'Lower is better' },
          { kpi: `${tier} — Resolution SLA Breached (Actionable)`, group: 'Tier SLA', count: stats.resBreachedActionable, target: 0, direction: 'Lower is better' },
          { kpi: `${tier} — FRT Breached (Actionable)`, group: 'Tier SLA', count: stats.frtBreachedActionable, target: 0, direction: 'Lower is better' },
        );
        if (tier !== 'Development') {
          metrics.push(
            { kpi: `${tier} — Resolution SLA Breached (Not Actionable)`, group: 'Tier SLA', count: stats.resBreachedNotActionable, target: 0, direction: 'Lower is better' },
            { kpi: `${tier} — FRT Breached (Not Actionable)`, group: 'Tier SLA', count: stats.frtBreachedNotActionable, target: 0, direction: 'Lower is better' },
          );
        }
      }

      // Escalation KPIs (from local MSSQL escalation_log)
      try {
        const escMetrics = await this.collectEscalationKpis();
        metrics.push(...escMetrics);
      } catch (escErr) {
        console.warn('[kpi-pipeline] Escalation KPIs failed:', escErr instanceof Error ? escErr.message : escErr);
      }

      // Write all metrics
      for (const m of metrics) {
        const tgt = targets.get(m.kpi);
        const target = tgt?.target ?? m.target;
        const direction = tgt?.direction ?? m.direction;
        const group = tgt?.group ?? m.group;
        const rag = computeRag(m.count, target, direction);
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
      await this.monitor?.logRun({
        pipeline_name: 'kpi-snapshot', started_at: started, completed_at: new Date(),
        status: 'error', rows_affected: rowsAffected, error_message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - started.getTime(),
      });
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
      { kpi: 'Escalated to Tier 2', group: 'Escalation', count: escT2, target: 0, direction: 'Lower is better' },
      { kpi: 'Escalated to Tier 3', group: 'Escalation', count: escT3, target: 0, direction: 'Lower is better' },
      { kpi: 'Escalated to Development', group: 'Escalation', count: escDev, target: 0, direction: 'Lower is better' },
      { kpi: 'Rejected by Tier 2', group: 'Escalation', count: rejT2, target: 0, direction: 'Lower is better' },
      { kpi: 'Rejected by Tier 3', group: 'Escalation', count: rejT3, target: 0, direction: 'Lower is better' },
      { kpi: 'Rejected by Development', group: 'Escalation', count: rejDev, target: 0, direction: 'Lower is better' },
      { kpi: 'Escalation Accuracy %', group: 'Escalation', count: accuracy, target: 90, direction: 'Higher is better' },
    );

    return metrics;
  }

  async upsertKpiSnapshot(): Promise<void> {
    const started = new Date();
    try {
      const p = await getKpiPool(this.settings);

      // Business hours guard: Mon-Fri 08:00-18:59 UK time
      const ukHour = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false });
      const ukDay = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
      const hour = parseInt(ukHour, 10);
      if (['Sat', 'Sun'].includes(ukDay) || hour < 8 || hour > 18) return;

      // Collect current metrics from the same local cache logic
      const openRows = await localQuery<CacheRow>(`
        SELECT issue_key, status_name, status_category, current_tier, request_type,
               assignee_account_id, assignee_display, jira_created, jira_updated, due_date,
               sla_breached, sla_breach_time, agent_last_updated, agent_next_update,
               no_reply, fields_json, issuetype_name, resolution_name
        FROM jira_issue_cache
        WHERE project_key = @p0 AND status_category != 'Done'
      `, [this.jiraProject]);

      const filtered = openRows.filter(t => !isOnboarding(t.request_type));
      const now = new Date();

      const openCount = filtered.length;
      const breachedCount = filtered.filter(t => {
        const res = isSlaBreached(parseSlaField(t.fields_json, 'customfield_14048'));
        return res === true;
      }).length;
      const unassigned = filtered.filter(t => !t.assignee_account_id).length;
      const noReplyCount = filtered.filter(t => isNoReply(t, now)).length;

      const resolvedRows = await localQuery<{ cnt: number }>(`
        SELECT COUNT(*) AS cnt FROM jira_issue_cache
        WHERE project_key = @p0 AND status_category = 'Done'
          AND CAST(jira_updated AS DATE) = CAST(GETUTCDATE() AS DATE)
      `, [this.jiraProject]);
      const resolvedToday = resolvedRows[0]?.cnt ?? 0;

      const snapshots: Array<{ name: string; value: number }> = [
        { name: 'Open Tickets', value: openCount },
        { name: 'SLA Breached', value: breachedCount },
        { name: 'Unassigned', value: unassigned },
        { name: 'No Reply', value: noReplyCount },
        { name: 'Resolved Today', value: resolvedToday },
      ];

      for (const snap of snapshots) {
        const req = p.request();
        req.input('name', sql.NVarChar(100), snap.name);
        req.input('value', sql.Float, snap.value);
        await req.query(`
          IF EXISTS (SELECT 1 FROM dbo.KpiSnapshot WHERE KpiName = @name)
            UPDATE dbo.KpiSnapshot SET KpiValue = @value, UpdatedAt = GETUTCDATE() WHERE KpiName = @name
          ELSE
            INSERT INTO dbo.KpiSnapshot (KpiName, KpiValue, UpdatedAt) VALUES (@name, @value, GETUTCDATE())
        `);
      }

      console.log(`[kpi-pipeline] KpiSnapshot upserted: ${snapshots.length} metrics`);
    } catch (err) {
      console.warn('[kpi-pipeline] KpiSnapshot upsert failed:', err instanceof Error ? err.message : err);
    }
  }

  async collectDerivedKpis(): Promise<void> {
    const started = new Date();
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;
      const today = new Date().toISOString().slice(0, 10);

      // 1st Line Resolution Rate: CC-tier resolved / total resolved today
      const resolvedRows = await localQuery<{ request_type: string | null; current_tier: string | null }>(`
        SELECT request_type, current_tier FROM jira_issue_cache
        WHERE project_key = @p0 AND status_category = 'Done'
          AND CAST(jira_updated AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND LOWER(ISNULL(request_type, '')) != 'onboarding'
      `, [this.jiraProject]);

      const ccRequestTypes = ['incident', 'chat', 'ai request', 'emailed request', 'gdpr', 'service request', 'tpj request'];
      const totalResolved = resolvedRows.length;
      const ccResolved = resolvedRows.filter(r => ccRequestTypes.includes((r.request_type || '').toLowerCase())).length;
      const firstLineRate = totalResolved > 0 ? Math.round((ccResolved / totalResolved) * 100) : 0;

      // CSAT % (derived) — same as snapshot CSAT but with different RAG
      const csatRows = await localQuery<{ fields_json: string | null }>(`
        SELECT fields_json FROM jira_issue_cache
        WHERE project_key = @p0 AND status_category = 'Done'
          AND CAST(jira_updated AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND fields_json IS NOT NULL
      `, [this.jiraProject]);
      let csatSum = 0, csatCount = 0;
      for (const r of csatRows) {
        const rating = parseCsat(r.fields_json);
        if (rating !== null) { csatSum += rating; csatCount++; }
      }
      const csatDerived = csatCount > 0 ? Math.round((csatSum / csatCount) * 20) : 0;

      // FCR Rate % — stub: needs comment data, placeholder using tickets with single agent interaction
      // Bug Escalation-to-Ack — stub: needs first comment time, placeholder
      const derivedMetrics: Array<{ kpi: string; group: string; count: number; target: number; direction: string }> = [
        { kpi: '1st Line Resolution Rate %', group: 'Derived', count: firstLineRate, target: 60, direction: 'Higher is better' },
        { kpi: 'CSAT % (Derived)', group: 'Derived', count: csatDerived, target: 80, direction: 'Higher is better' },
        { kpi: 'FCR Rate %', group: 'Derived', count: 0, target: 60, direction: 'Higher is better' }, // TODO: requires comment data
        { kpi: 'Bug Escalation-to-Ack (hours)', group: 'Derived', count: 0, target: 4, direction: 'Lower is better' }, // TODO: requires first comment time
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

  async snapshotAgentKpis(): Promise<void> {
    const started = new Date();
    let rowsAffected = 0;
    try {
      let p: sql.ConnectionPool;
      try {
        p = await getKpiPool(this.settings);
      } catch { throw new Error('KPI SQL pool unavailable'); }

      const today = new Date().toISOString().slice(0, 10);

      // Refresh NOVA AI metrics before reading Agent table
      await this.refreshNovaAiMetrics(p);

      // Always READ from the live Agent table
      const agents = await p.request().query(`
        SELECT AgentId,
               RTRIM(LTRIM(ISNULL(AgentName, '') + ' ' + ISNULL(AgentSurname, ''))) AS AgentName,
               ISNULL(TierCode, '') AS TierCode,
               ISNULL(Team, '') AS Team,
               ISNULL(OpenTickets_Total, 0) AS OpenTickets_Total,
               ISNULL(OpenTickets_Over2Hours, 0) AS OpenTickets_Over2Hours,
               ISNULL(OpenTickets_NoUpdateToday, 0) AS OpenTickets_NoUpdateToday,
               ISNULL(SolvedTickets_Today, 0) AS SolvedTickets_Today,
               ISNULL(SolvedTickets_ThisWeek, 0) AS SolvedTickets_ThisWeek,
               ISNULL(OldestTicketDays, 0) AS OldestTicketDays
        FROM dbo.Agent WHERE IsActive = 1 AND AgentId IS NOT NULL
      `);

      if (agents.recordset.length === 0) return;

      const s = this.s;
      // Ensure OldestTicketDays column exists on the daily table
      await p.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.jira_agent_kpi_daily${s}') AND name = 'OldestTicketDays')
          ALTER TABLE dbo.jira_agent_kpi_daily${s} ADD OldestTicketDays INT NULL;
      `).catch(() => {});

      for (const a of agents.recordset) {
        if (!a.AgentName?.trim()) continue;
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

        await request.query(`
          MERGE dbo.jira_agent_kpi_daily${s} AS t
          USING (SELECT @reportDate AS ReportDate, @agentName AS AgentName) AS s
          ON t.ReportDate = s.ReportDate AND t.AgentName = s.AgentName
          WHEN MATCHED THEN UPDATE SET
            AgentId = @agentId, TierCode = @tierCode, Team = @team,
            OpenTickets_Total = @openTotal, OpenTickets_Over2Hours = @over2h,
            OpenTickets_NoUpdateToday = @noUpdate,
            SolvedTickets_Today = @solvedToday, SolvedTickets_ThisWeek = @solvedWeek,
            OldestTicketDays = @oldestDays
          WHEN NOT MATCHED THEN INSERT
            (ReportDate, AgentId, AgentName, TierCode, Team,
             OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
             SolvedTickets_Today, SolvedTickets_ThisWeek, OldestTicketDays)
          VALUES (@reportDate, @agentId, @agentName, @tierCode, @team,
                  @openTotal, @over2h, @noUpdate, @solvedToday, @solvedWeek, @oldestDays);
        `);
        rowsAffected++;
      }

      console.log(`[kpi-pipeline] Agent snapshot → ${s || 'live'}: ${agents.recordset.length} agents`);

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

      const solvedTodayRows = await localQuery<{ solvedToday: number }>(`
        SELECT COUNT(DISTINCT ticket_id) AS solvedToday
        FROM agent_decisions
        WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND (
            (action = 'transition' AND outcome LIKE '%"success":true%')
            OR quick_win_executed = 1
          )
      `);

      const solvedWeekRows = await localQuery<{ solvedWeek: number }>(`
        SELECT COUNT(DISTINCT ticket_id) AS solvedWeek
        FROM agent_decisions
        WHERE created_at >= DATEADD(day, -DATEPART(weekday, GETUTCDATE()) + 1, CAST(GETUTCDATE() AS DATE))
          AND (
            (action = 'transition' AND outcome LIKE '%"success":true%')
            OR quick_win_executed = 1
          )
      `);

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

    for (const date of dates) {
      const solvedRows = await localQuery<{ solvedToday: number }>(`
        SELECT COUNT(DISTINCT ticket_id) AS solvedToday
        FROM agent_decisions
        WHERE CAST(created_at AS DATE) = @p0
          AND (
            (action = 'transition' AND outcome LIKE '%"success":true%')
            OR (quick_win_executed = 1 AND CAST(quick_win_executed_at AS DATE) = @p0)
          )
      `, [date]);

      const weekStart = new Date(date);
      const dayOfWeek = weekStart.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      weekStart.setDate(weekStart.getDate() + mondayOffset);
      const weekStartStr = weekStart.toISOString().slice(0, 10);

      const solvedWeekRows = await localQuery<{ solvedWeek: number }>(`
        SELECT COUNT(DISTINCT ticket_id) AS solvedWeek
        FROM agent_decisions
        WHERE CAST(created_at AS DATE) BETWEEN @p0 AND @p1
          AND (
            (action = 'transition' AND outcome LIKE '%"success":true%')
            OR quick_win_executed = 1
          )
      `, [weekStartStr, date]);

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
