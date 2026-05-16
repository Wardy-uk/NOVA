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

      let openResult: number;
      let breachedCount: number;
      let unassignedResult: number;
      let resolvedTodayResult: number;
      let createdTodayResult: number;
      let wor: number;

      if (this.cache) {
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        [openResult, breachedCount, unassignedResult, resolvedTodayResult, createdTodayResult, wor] = await Promise.all([
          this.cache.countOpen(this.jiraProject),
          this.cache.countBreachedSla(this.jiraProject),
          this.cache.countUnassigned(this.jiraProject),
          this.cache.countResolvedSince(this.jiraProject, startOfDay),
          this.cache.countCreatedSince(this.jiraProject, startOfDay),
          this.cache.countByStatus(this.jiraProject, 'Waiting on Requestor'),
        ]);
      } else {
        openResult = await this.jiraClient.jqlCount(
          `project = ${this.jiraProject} AND resolution = EMPTY`,
        );
        const breachedResult = await this.jiraClient.searchJql(
          `project = ${this.jiraProject} AND resolution = EMPTY AND "Time to resolution" = breached()`,
          ['key'], 1,
        );
        breachedCount = breachedResult?.total ?? 0;
        unassignedResult = await this.jiraClient.jqlCount(
          `project = ${this.jiraProject} AND resolution = EMPTY AND assignee is EMPTY`,
        );
        resolvedTodayResult = await this.jiraClient.jqlCount(
          `project = ${this.jiraProject} AND resolved >= startOfDay()`,
        );
        createdTodayResult = await this.jiraClient.jqlCount(
          `project = ${this.jiraProject} AND created >= startOfDay()`,
        );
        wor = await this.jiraClient.jqlCount(
          `project = ${this.jiraProject} AND status = "Waiting on Requestor" AND resolution = EMPTY`,
        );
      }

      const metrics: Array<{ kpi: string; group: string; count: number; target: number; direction: string }> = [
        { kpi: 'Open Tickets', group: 'Queue', count: Math.max(openResult, 0), target: 30, direction: 'Lower is better' },
        { kpi: 'SLA Breached', group: 'SLA', count: breachedCount, target: 0, direction: 'Lower is better' },
        { kpi: 'Unassigned', group: 'Queue', count: Math.max(unassignedResult, 0), target: 0, direction: 'Lower is better' },
        { kpi: 'Resolved Today', group: 'Throughput', count: Math.max(resolvedTodayResult, 0), target: 15, direction: 'Higher is better' },
        { kpi: 'Created Today', group: 'Volume', count: Math.max(createdTodayResult, 0), target: 20, direction: 'Lower is better' },
        { kpi: 'Waiting on Requestor', group: 'Queue', count: Math.max(wor, 0), target: 10, direction: 'Lower is better' },
      ];

      for (const m of metrics) {
        const rag = computeRag(m.count, m.target, m.direction);
        const request = p.request();
        request.input('kpi', sql.NVarChar(100), m.kpi.slice(0, 100));
        request.input('kpiGroup', sql.NVarChar(100), m.group.slice(0, 100));
        request.input('count', sql.Float, m.count);
        request.input('target', sql.Float, m.target);
        request.input('direction', sql.NVarChar(50), m.direction.slice(0, 50));
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

      console.log(`[kpi-pipeline] Jira snapshot → ${s || 'live'}: ${metrics.length} metrics written`);

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
