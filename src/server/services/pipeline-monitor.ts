import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';

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

export type PipelineTarget = 'uat' | 'live';

export function tableSuffix(target: PipelineTarget): string {
  return target === 'uat' ? 'UAT' : '';
}

interface PipelineRun {
  id?: number;
  pipeline_name: string;
  started_at: Date;
  completed_at: Date | null;
  status: 'success' | 'error';
  rows_affected: number;
  error_message: string | null;
  duration_ms: number;
}

const PIPELINE_INTERVALS: Record<string, number> = {
  'kpi-snapshot': 10 * 60 * 1000,
  'kpi-agent-snapshot': 30 * 60 * 1000,
  'kpi-daily-digest': 24 * 60 * 60 * 1000,
  'kpi-weekly-digest': 7 * 24 * 60 * 60 * 1000,
  'qa-scoring': 2 * 60 * 60 * 1000,
};

export class PipelineMonitor {
  private consecutiveFailures: Map<string, number> = new Map();

  constructor(private settings: SettingsQueries) {}

  async ensureRunsTable(): Promise<void> {
    const p = await getKpiPool(this.settings);
    await p.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'pipeline_runs')
      CREATE TABLE dbo.pipeline_runs (
        id INT IDENTITY(1,1) PRIMARY KEY,
        pipeline_name NVARCHAR(100) NOT NULL,
        started_at DATETIME2 NOT NULL,
        completed_at DATETIME2 NULL,
        status NVARCHAR(20) NOT NULL,
        rows_affected INT NOT NULL DEFAULT 0,
        error_message NVARCHAR(4000) NULL,
        duration_ms INT NOT NULL DEFAULT 0
      );
    `);
  }

  async ensureUatTables(): Promise<void> {
    const p = await getKpiPool(this.settings);

    await p.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'KpiSnapshotUAT')
      CREATE TABLE dbo.KpiSnapshotUAT (
        id INT IDENTITY(1,1) PRIMARY KEY,
        KPI NVARCHAR(100) NOT NULL,
        KPIGroup NVARCHAR(100),
        Value FLOAT,
        Target FLOAT,
        Direction NVARCHAR(50),
        RAG INT,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      );

      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'jira_kpi_dailyUAT')
      CREATE TABLE dbo.jira_kpi_dailyUAT (
        id INT IDENTITY(1,1) PRIMARY KEY,
        kpi NVARCHAR(100) NOT NULL,
        kpiGroup NVARCHAR(100),
        [count] FLOAT,
        target FLOAT,
        direction NVARCHAR(50),
        rag INT,
        CreatedAt DATE NOT NULL
      );

      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'jira_agent_kpi_dailyUAT')
      CREATE TABLE dbo.jira_agent_kpi_dailyUAT (
        id INT IDENTITY(1,1) PRIMARY KEY,
        ReportDate DATE NOT NULL,
        AgentId NVARCHAR(100),
        AgentName NVARCHAR(200),
        TierCode NVARCHAR(50),
        Team NVARCHAR(100),
        OpenTickets_Total INT,
        OpenTickets_Over2Hours INT,
        OpenTickets_NoUpdateToday INT,
        SolvedTickets_Today INT,
        SolvedTickets_ThisWeek INT,
        OldestTicketDays INT
      );

      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'jira_kpi_digestUAT')
      CREATE TABLE dbo.jira_kpi_digestUAT (
        id INT IDENTITY(1,1) PRIMARY KEY,
        period NVARCHAR(20),
        summary NVARCHAR(4000),
        html NVARCHAR(MAX),
        CreatedAt DATETIME NOT NULL
      );

      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'jira_qa_resultsUAT')
      CREATE TABLE dbo.jira_qa_resultsUAT (
        id INT IDENTITY(1,1) PRIMARY KEY,
        issueKey NVARCHAR(50) NOT NULL,
        assigneeName NVARCHAR(200),
        qaType NVARCHAR(50),
        overallScore FLOAT,
        accuracyScore FLOAT,
        clarityScore FLOAT,
        toneScore FLOAT,
        grade NVARCHAR(10),
        isConcerning BIT,
        severity NVARCHAR(20),
        category NVARCHAR(100),
        CreatedAt DATETIME NOT NULL
      );

      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Jira_QA_GoldenRulesUAT')
      CREATE TABLE dbo.Jira_QA_GoldenRulesUAT (
        id INT IDENTITY(1,1) PRIMARY KEY,
        IssueKey NVARCHAR(50) NOT NULL,
        OverallScore FLOAT,
        Rule1Score FLOAT,
        Rule2Score FLOAT,
        Rule3Score FLOAT,
        rule1Pass BIT,
        rule2Pass BIT,
        rule3Pass BIT,
        Summary NVARCHAR(2000),
        Assignee NVARCHAR(200),
        CreatedAt DATETIME NOT NULL
      );
    `);
  }

  async truncateUatTables(): Promise<{ truncated: string[] }> {
    const p = await getKpiPool(this.settings);
    const tables = [
      'KpiSnapshotUAT', 'jira_kpi_dailyUAT', 'jira_agent_kpi_dailyUAT',
      'jira_kpi_digestUAT', 'jira_qa_resultsUAT', 'Jira_QA_GoldenRulesUAT',
    ];
    for (const t of tables) {
      await p.request().query(`IF OBJECT_ID('dbo.${t}') IS NOT NULL TRUNCATE TABLE dbo.${t};`);
    }
    console.log(`[pipeline-monitor] Truncated ${tables.length} UAT tables`);
    return { truncated: tables };
  }

  async logRun(run: PipelineRun): Promise<void> {
    try {
      const p = await getKpiPool(this.settings);
      const request = p.request();
      request.input('pipeline_name', sql.NVarChar, run.pipeline_name);
      request.input('started_at', sql.DateTime2, run.started_at);
      request.input('completed_at', sql.DateTime2, run.completed_at);
      request.input('status', sql.NVarChar, run.status);
      request.input('rows_affected', sql.Int, run.rows_affected);
      request.input('error_message', sql.NVarChar, run.error_message);
      request.input('duration_ms', sql.Int, run.duration_ms);

      await request.query(`
        INSERT INTO dbo.pipeline_runs
          (pipeline_name, started_at, completed_at, status, rows_affected, error_message, duration_ms)
        VALUES
          (@pipeline_name, @started_at, @completed_at, @status, @rows_affected, @error_message, @duration_ms)
      `);

      if (run.status === 'error') {
        const count = (this.consecutiveFailures.get(run.pipeline_name) ?? 0) + 1;
        this.consecutiveFailures.set(run.pipeline_name, count);
        if (count >= 2) {
          await this.sendTeamsAlert(run.pipeline_name, `Failed ${count} consecutive times. Last error: ${run.error_message}`);
        }
      } else {
        this.consecutiveFailures.set(run.pipeline_name, 0);
      }
    } catch (err) {
      console.warn('[pipeline-monitor] Failed to log run:', err instanceof Error ? err.message : err);
    }
  }

  async checkStaleRuns(): Promise<void> {
    try {
      const p = await getKpiPool(this.settings);
      for (const [pipeline, expectedInterval] of Object.entries(PIPELINE_INTERVALS)) {
        const result = await p.request()
          .input('name', sql.NVarChar, pipeline)
          .query(`SELECT TOP 1 completed_at FROM dbo.pipeline_runs WHERE pipeline_name = @name AND status = 'success' ORDER BY completed_at DESC`);

        const lastRun = result.recordset[0]?.completed_at;
        if (!lastRun) continue;

        const elapsed = Date.now() - new Date(lastRun).getTime();
        if (elapsed > expectedInterval * 2) {
          const mins = Math.round(elapsed / 60000);
          await this.sendTeamsAlert(pipeline, `No successful run in ${mins} minutes (expected every ${Math.round(expectedInterval / 60000)} min)`);
        }
      }
    } catch (err) {
      console.warn('[pipeline-monitor] Stale check failed:', err instanceof Error ? err.message : err);
    }
  }

  async getRunHistory(pipeline?: string, limit: number = 50): Promise<any[]> {
    try {
      const p = await getKpiPool(this.settings);
      const request = p.request();
      request.input('limit', sql.Int, limit);
      let where = '';
      if (pipeline) {
        request.input('pipeline', sql.NVarChar, pipeline);
        where = 'WHERE pipeline_name = @pipeline';
      }
      const result = await request.query(`
        SELECT TOP (@limit) * FROM dbo.pipeline_runs ${where} ORDER BY started_at DESC
      `);
      return result.recordset;
    } catch { return []; }
  }

  async getStats(): Promise<any[]> {
    try {
      const p = await getKpiPool(this.settings);
      const result = await p.request().query(`
        SELECT
          pipeline_name,
          COUNT(*) AS total_runs,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failures,
          CAST(SUM(CASE WHEN status = 'success' THEN 1.0 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS DECIMAL(5,1)) AS success_rate,
          MAX(CASE WHEN status = 'success' THEN completed_at END) AS last_success,
          MAX(CASE WHEN status = 'error' THEN completed_at END) AS last_failure,
          (SELECT TOP 1 error_message FROM dbo.pipeline_runs p2 WHERE p2.pipeline_name = p.pipeline_name AND p2.status = 'error' ORDER BY p2.started_at DESC) AS last_error,
          AVG(CASE WHEN status = 'success' THEN duration_ms END) AS avg_duration_ms
        FROM dbo.pipeline_runs p
        WHERE started_at >= DATEADD(day, -7, GETUTCDATE())
        GROUP BY pipeline_name
        ORDER BY pipeline_name
      `);
      return result.recordset;
    } catch { return []; }
  }

  async compareKpiDaily(days: number = 7): Promise<any> {
    try {
      const p = await getKpiPool(this.settings);
      const request = p.request();
      request.input('days', sql.Int, days);

      const liveRows = await request.query(`
        SELECT kpi, CAST(CreatedAt AS DATE) AS ReportDate, [count], target, rag
        FROM dbo.jira_kpi_daily
        WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
        ORDER BY CreatedAt DESC, kpi
      `);
      const uatRows = await p.request().input('days', sql.Int, days).query(`
        SELECT kpi, CAST(CreatedAt AS DATE) AS ReportDate, [count], target, rag
        FROM dbo.jira_kpi_dailyUAT
        WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
        ORDER BY CreatedAt DESC, kpi
      `);

      const liveCounts = await p.request().input('days', sql.Int, days).query(`
        SELECT COUNT(*) AS cnt FROM dbo.jira_kpi_daily WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
      `);
      const uatCounts = await p.request().input('days', sql.Int, days).query(`
        SELECT COUNT(*) AS cnt FROM dbo.jira_kpi_dailyUAT WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
      `);

      const liveMap = new Map<string, any>();
      for (const r of liveRows.recordset) {
        const key = `${r.kpi}|${r.ReportDate?.toISOString?.()?.slice(0, 10) ?? r.ReportDate}`;
        liveMap.set(key, r);
      }

      const diffs: any[] = [];
      const onlyInUat: string[] = [];
      const onlyInLive: string[] = [];

      for (const r of uatRows.recordset) {
        const key = `${r.kpi}|${r.ReportDate?.toISOString?.()?.slice(0, 10) ?? r.ReportDate}`;
        const live = liveMap.get(key);
        if (!live) {
          onlyInUat.push(key);
        } else {
          if (live.count !== r.count || live.rag !== r.rag) {
            diffs.push({ key, live: { count: live.count, rag: live.rag }, uat: { count: r.count, rag: r.rag } });
          }
          liveMap.delete(key);
        }
      }
      for (const key of liveMap.keys()) onlyInLive.push(key);

      return {
        pipeline: 'kpi-daily',
        days,
        liveRowCount: liveCounts.recordset[0]?.cnt ?? 0,
        uatRowCount: uatCounts.recordset[0]?.cnt ?? 0,
        valueDifferences: diffs,
        onlyInLive,
        onlyInUat,
        match: diffs.length === 0 && onlyInLive.length === 0 && onlyInUat.length === 0,
      };
    } catch (err) {
      return { pipeline: 'kpi-daily', error: err instanceof Error ? err.message : 'Compare failed' };
    }
  }

  async compareAgentKpi(days: number = 7): Promise<any> {
    try {
      const p = await getKpiPool(this.settings);
      const liveRows = await p.request().input('days', sql.Int, days).query(`
        SELECT AgentName, CAST(ReportDate AS DATE) AS ReportDate, OpenTickets_Total, SolvedTickets_Today
        FROM dbo.jira_agent_kpi_daily WHERE ReportDate >= DATEADD(day, -@days, GETDATE())
      `);
      const uatRows = await p.request().input('days', sql.Int, days).query(`
        SELECT AgentName, CAST(ReportDate AS DATE) AS ReportDate, OpenTickets_Total, SolvedTickets_Today
        FROM dbo.jira_agent_kpi_dailyUAT WHERE ReportDate >= DATEADD(day, -@days, GETDATE())
      `);

      const liveMap = new Map<string, any>();
      for (const r of liveRows.recordset) {
        liveMap.set(`${r.AgentName}|${r.ReportDate?.toISOString?.()?.slice(0, 10) ?? r.ReportDate}`, r);
      }

      const diffs: any[] = [];
      const onlyInUat: string[] = [];
      for (const r of uatRows.recordset) {
        const key = `${r.AgentName}|${r.ReportDate?.toISOString?.()?.slice(0, 10) ?? r.ReportDate}`;
        const live = liveMap.get(key);
        if (!live) { onlyInUat.push(key); }
        else {
          if (live.OpenTickets_Total !== r.OpenTickets_Total || live.SolvedTickets_Today !== r.SolvedTickets_Today) {
            diffs.push({ key, live: { open: live.OpenTickets_Total, solved: live.SolvedTickets_Today }, uat: { open: r.OpenTickets_Total, solved: r.SolvedTickets_Today } });
          }
          liveMap.delete(key);
        }
      }

      return {
        pipeline: 'kpi-agent',
        days,
        liveRowCount: liveRows.recordset.length,
        uatRowCount: uatRows.recordset.length,
        valueDifferences: diffs,
        onlyInLive: [...liveMap.keys()],
        onlyInUat,
        match: diffs.length === 0 && liveMap.size === 0 && onlyInUat.length === 0,
      };
    } catch (err) {
      return { pipeline: 'kpi-agent', error: err instanceof Error ? err.message : 'Compare failed' };
    }
  }

  async compareQaResults(days: number = 7): Promise<any> {
    try {
      const p = await getKpiPool(this.settings);
      const liveRows = await p.request().input('days', sql.Int, days).query(`
        SELECT issueKey, overallScore, grade, accuracyScore, clarityScore, toneScore
        FROM dbo.jira_qa_results WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
      `);
      const uatRows = await p.request().input('days', sql.Int, days).query(`
        SELECT issueKey, overallScore, grade, accuracyScore, clarityScore, toneScore
        FROM dbo.jira_qa_resultsUAT WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
      `);

      const liveMap = new Map<string, any>();
      for (const r of liveRows.recordset) liveMap.set(r.issueKey, r);

      const diffs: any[] = [];
      const onlyInUat: string[] = [];
      for (const r of uatRows.recordset) {
        const live = liveMap.get(r.issueKey);
        if (!live) { onlyInUat.push(r.issueKey); }
        else {
          if (live.overallScore !== r.overallScore || live.grade !== r.grade) {
            diffs.push({
              issueKey: r.issueKey,
              live: { overall: live.overallScore, grade: live.grade },
              uat: { overall: r.overallScore, grade: r.grade },
            });
          }
          liveMap.delete(r.issueKey);
        }
      }

      return {
        pipeline: 'qa-results',
        days,
        liveRowCount: liveRows.recordset.length,
        uatRowCount: uatRows.recordset.length,
        valueDifferences: diffs,
        onlyInLive: [...liveMap.keys()],
        onlyInUat,
        match: diffs.length === 0 && liveMap.size === 0 && onlyInUat.length === 0,
      };
    } catch (err) {
      return { pipeline: 'qa-results', error: err instanceof Error ? err.message : 'Compare failed' };
    }
  }

  async compare(pipeline: string, days: number = 7): Promise<any> {
    switch (pipeline) {
      case 'kpi-daily': return this.compareKpiDaily(days);
      case 'kpi-agent': return this.compareAgentKpi(days);
      case 'qa-results': return this.compareQaResults(days);
      case 'all': return {
        'kpi-daily': await this.compareKpiDaily(days),
        'kpi-agent': await this.compareAgentKpi(days),
        'qa-results': await this.compareQaResults(days),
      };
      default: return { error: `Unknown pipeline: ${pipeline}. Valid: kpi-daily, kpi-agent, qa-results, all` };
    }
  }

  private static readonly TABLE_KEYS: Record<string, { keyColumns: string[]; dateColumn: string; compareColumns: string[] }> = {
    'jira_kpi_daily': {
      keyColumns: ['kpi', 'CreatedAt'],
      dateColumn: 'CreatedAt',
      compareColumns: ['kpiGroup', 'count', 'target', 'direction', 'rag'],
    },
    'jira_agent_kpi_daily': {
      keyColumns: ['AgentName', 'ReportDate'],
      dateColumn: 'ReportDate',
      compareColumns: ['TierCode', 'Team', 'OpenTickets_Total', 'OpenTickets_Over2Hours', 'OpenTickets_NoUpdateToday', 'SolvedTickets_Today', 'SolvedTickets_ThisWeek'],
    },
    'KpiSnapshot': {
      keyColumns: ['KPI', 'CreatedAt'],
      dateColumn: 'CreatedAt',
      compareColumns: ['KPIGroup', 'Value', 'Target', 'Direction', 'RAG'],
    },
    'jira_qa_results': {
      keyColumns: ['issueKey'],
      dateColumn: 'CreatedAt',
      compareColumns: ['assigneeName', 'overallScore', 'accuracyScore', 'clarityScore', 'toneScore', 'grade', 'isConcerning', 'severity', 'category'],
    },
    'Jira_QA_GoldenRules': {
      keyColumns: ['IssueKey'],
      dateColumn: 'CreatedAt',
      compareColumns: ['OverallScore', 'Rule1Score', 'Rule2Score', 'Rule3Score', 'rule1Pass', 'rule2Pass', 'rule3Pass', 'Assignee'],
    },
    'jira_kpi_digest': {
      keyColumns: ['period', 'CreatedAt'],
      dateColumn: 'CreatedAt',
      compareColumns: ['summary'],
    },
  };

  async compareTable(tableName: string, days: number = 7): Promise<any> {
    const config = PipelineMonitor.TABLE_KEYS[tableName];
    if (!config) {
      return { error: `Unknown table: ${tableName}. Valid: ${Object.keys(PipelineMonitor.TABLE_KEYS).join(', ')}` };
    }

    try {
      const p = await getKpiPool(this.settings);
      const allCols = [...config.keyColumns, ...config.compareColumns];
      const colList = allCols.map(c => c === 'count' ? '[count]' : c).join(', ');
      const dateCol = config.dateColumn;

      const liveResult = await p.request().input('days', sql.Int, days).query(
        `SELECT ${colList} FROM dbo.${tableName} WHERE ${dateCol} >= DATEADD(day, -@days, GETDATE()) ORDER BY ${dateCol} DESC`
      );
      const uatResult = await p.request().input('days', sql.Int, days).query(
        `SELECT ${colList} FROM dbo.${tableName}UAT WHERE ${dateCol} >= DATEADD(day, -@days, GETDATE()) ORDER BY ${dateCol} DESC`
      );

      const liveRows = liveResult.recordset;
      const uatRows = uatResult.recordset;

      const makeKey = (row: any) => config.keyColumns.map(k => {
        const val = row[k];
        if (val instanceof Date) return val.toISOString().slice(0, 10);
        return String(val ?? '');
      }).join('|');

      const liveMap = new Map<string, any>();
      for (const r of liveRows) liveMap.set(makeKey(r), r);

      const uatMap = new Map<string, any>();
      for (const r of uatRows) uatMap.set(makeKey(r), r);

      const onlyInLive: string[] = [];
      const onlyInUat: string[] = [];
      const valueDiffs: any[] = [];
      const sampleDiffs: any[] = [];
      const columnDriftMap: Record<string, { match: number; diff: number }> = {};
      for (const col of config.compareColumns) columnDriftMap[col] = { match: 0, diff: 0 };

      let matchedRows = 0;

      for (const [key, uatRow] of uatMap) {
        const liveRow = liveMap.get(key);
        if (!liveRow) {
          onlyInUat.push(key);
          continue;
        }

        let rowMatches = true;
        for (const col of config.compareColumns) {
          const liveVal = liveRow[col === 'count' ? 'count' : col];
          const uatVal = uatRow[col === 'count' ? 'count' : col];
          const liveStr = String(liveVal ?? '');
          const uatStr = String(uatVal ?? '');

          if (liveStr === uatStr) {
            columnDriftMap[col].match++;
          } else {
            columnDriftMap[col].diff++;
            rowMatches = false;
            if (sampleDiffs.length < 100) {
              const numLive = parseFloat(liveStr);
              const numUat = parseFloat(uatStr);
              const delta = (!isNaN(numLive) && !isNaN(numUat)) ? Math.round((numUat - numLive) * 100) / 100 : null;
              sampleDiffs.push({ key, column: col, liveValue: liveVal, uatValue: uatVal, delta });
            }
          }
        }
        if (rowMatches) matchedRows++;
        else valueDiffs.push(key);
        liveMap.delete(key);
      }

      for (const key of liveMap.keys()) onlyInLive.push(key);

      const totalComparable = matchedRows + valueDiffs.length;
      const matchPct = totalComparable > 0 ? Math.round(matchedRows / totalComparable * 1000) / 10 : 100;

      const columnDrift = config.compareColumns.map(col => ({
        column: col,
        matchCount: columnDriftMap[col].match,
        diffCount: columnDriftMap[col].diff,
        driftPct: (columnDriftMap[col].match + columnDriftMap[col].diff) > 0
          ? Math.round(columnDriftMap[col].diff / (columnDriftMap[col].match + columnDriftMap[col].diff) * 1000) / 10
          : 0,
      }));

      return {
        table: tableName,
        days,
        liveRowCount: liveRows.length,
        uatRowCount: uatRows.length,
        matchedRows,
        matchPct,
        onlyInLive,
        onlyInUat,
        valueDiffs,
        columnDrift,
        sampleDiffs,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { table: tableName, error: err instanceof Error ? err.message : 'Comparison failed' };
    }
  }

  private async sendTeamsAlert(pipeline: string, message: string): Promise<void> {
    const webhookUrl = this.settings.get('teams_webhook_url');
    if (!webhookUrl) {
      console.warn(`[pipeline-monitor] ALERT (no webhook): ${pipeline} — ${message}`);
      return;
    }
    try {
      const body = {
        '@type': 'MessageCard',
        themeColor: 'FF0000',
        title: `🚨 Pipeline Alert: ${pipeline}`,
        text: message,
        sections: [{
          facts: [
            { name: 'Pipeline', value: pipeline },
            { name: 'Time', value: new Date().toISOString() },
          ],
        }],
      };
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      console.log(`[pipeline-monitor] Teams alert sent for ${pipeline}`);
    } catch (err) {
      console.warn(`[pipeline-monitor] Teams alert failed:`, err instanceof Error ? err.message : err);
    }
  }
}
