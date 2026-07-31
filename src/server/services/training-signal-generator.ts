import sql from 'mssql';
import { z } from 'zod';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { query, execute, executeAndGetId } from './database.js';
import type { PipelineTarget } from './pipeline-monitor.js';
import { tableSuffix } from './pipeline-monitor.js';

export interface TrainingSignal {
  id: number;
  agent_id: string;
  agent_name: string | null;
  signal_type: string;
  request_type: string | null;
  component: string | null;
  metric_value: number | null;
  team_average: number | null;
  recommendation: string | null;
  example_tickets: string | null;
  kb_article_link: string | null;
  actioned: boolean;
  generated_at: string;
}

const RecommendationSchema = z.object({
  recommendation: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
});

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

export class TrainingSignalGenerator {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
  ) {}

  private get target(): PipelineTarget {
    const val = this.settings.get('qa_pipeline_target');
    return val === 'live' ? 'live' : 'uat';
  }

  private get s(): string {
    return tableSuffix(this.target);
  }

  async generateWeeklySignals(): Promise<number> {
    const agents = await query<{ assignee_account_id: string; assignee_display: string | null }>(
      `SELECT DISTINCT assignee_account_id, assignee_display
       FROM jira_issue_cache
       WHERE assignee_account_id IS NOT NULL
         AND jira_updated >= DATEADD(day, -30, GETUTCDATE())`,
    );

    let signalCount = 0;
    for (const agent of agents) {
      try {
        signalCount += await this.analyseAgent(agent.assignee_account_id, agent.assignee_display ?? agent.assignee_account_id);
      } catch (err) {
        console.warn(`[training-signals] Analysis failed for ${agent.assignee_display}:`, err instanceof Error ? err.message : err);
      }
    }
    return signalCount;
  }

  private async analyseAgent(agentId: string, agentName: string): Promise<number> {
    let signalCount = 0;

    // 1. Escalation rate by request type (unchanged — reads from agent_decisions + jira_issue_cache)
    const escalationRates = await query<{
      request_type: string;
      total: number;
      escalated: number;
      rate: number;
    }>(
      `SELECT
         jic.request_type,
         COUNT(*) AS total,
         SUM(CASE WHEN ad.action LIKE 'escalate%' THEN 1 ELSE 0 END) AS escalated,
         CAST(SUM(CASE WHEN ad.action LIKE 'escalate%' THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) AS rate
       FROM agent_decisions ad
       JOIN jira_issue_cache jic ON jic.issue_key = ad.ticket_id
       WHERE jic.assignee_account_id = ?
         AND ad.created_at >= DATEADD(day, -30, GETUTCDATE())
         AND jic.request_type IS NOT NULL
       GROUP BY jic.request_type
       HAVING COUNT(*) >= 3`,
      [agentId],
    );

    const teamEscRates = await query<{ request_type: string; team_rate: number }>(
      `SELECT
         jic.request_type,
         CAST(SUM(CASE WHEN ad.action LIKE 'escalate%' THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) AS team_rate
       FROM agent_decisions ad
       JOIN jira_issue_cache jic ON jic.issue_key = ad.ticket_id
       WHERE ad.created_at >= DATEADD(day, -30, GETUTCDATE())
         AND jic.request_type IS NOT NULL
       GROUP BY jic.request_type
       HAVING COUNT(*) >= 5`,
    );
    const teamRateMap = new Map(teamEscRates.map(r => [r.request_type, r.team_rate]));

    for (const rate of escalationRates) {
      const teamAvg = teamRateMap.get(rate.request_type) ?? 0;
      if (rate.rate > teamAvg * 1.5 && rate.rate > 0.3) {
        const examples = await this.getExampleTickets(agentId, rate.request_type, 'escalate');
        const rec = await this.generateRecommendation(
          agentName, 'high_escalation_rate', rate.request_type,
          `Agent escalates ${(rate.rate * 100).toFixed(0)}% of ${rate.request_type} tickets vs team average ${(teamAvg * 100).toFixed(0)}%`,
        );
        await this.saveSignal(agentId, agentName, 'high_escalation_rate', rate.request_type, null,
          rate.rate, teamAvg, rec, examples);
        signalCount++;
      }
    }

    // 2. GR scores from Jira_QA_GoldenRules (KPI SQL)
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;
      const safeName = agentName.replace(/'/g, "''");

      const grScores = await p.request().query(`
        SELECT
          AVG(CAST(Rule1Score AS FLOAT)) AS avg_ownership,
          AVG(CAST(Rule2Score AS FLOAT)) AS avg_next_action,
          AVG(CAST(Rule3Score AS FLOAT)) AS avg_timeframe,
          AVG(CAST(OverallScore AS FLOAT)) AS avg_overall,
          COUNT(*) AS total
        FROM dbo.Jira_QA_GoldenRules${s}
        WHERE (Assignee = '${safeName}' OR Updater = '${safeName}')
          AND CreatedAt >= DATEADD(day, -30, GETUTCDATE())
      `);

      const teamGr = await p.request().query(`
        SELECT
          AVG(CAST(OverallScore AS FLOAT)) AS team_avg
        FROM dbo.Jira_QA_GoldenRules${s}
        WHERE CreatedAt >= DATEADD(day, -30, GETUTCDATE())
      `);

      const gr = grScores.recordset[0];
      const teamGrAvg = teamGr.recordset[0]?.team_avg ?? 0;

      if (gr?.total >= 3 && gr.avg_overall < teamGrAvg * 0.8 && gr.avg_overall < 2.0) {
        const rec = await this.generateRecommendation(
          agentName, 'low_gr_score', null,
          `Agent GR overall score is ${gr.avg_overall.toFixed(1)} vs team average ${teamGrAvg.toFixed(1)} (scale 1-3). Ownership: ${gr.avg_ownership?.toFixed(1)}, Next Action: ${gr.avg_next_action?.toFixed(1)}, Timeframe: ${gr.avg_timeframe?.toFixed(1)}`,
        );
        await this.saveSignal(agentId, agentName, 'low_gr_score', null, null,
          gr.avg_overall, teamGrAvg, rec, null);
        signalCount++;
      }

      // 3. QA scores from jira_qa_results (KPI SQL)
      const qaScores = await p.request().query(`
        SELECT
          AVG(CAST(overallScore AS FLOAT)) AS avg_overall,
          SUM(CASE WHEN grade = 'RED' THEN 1 ELSE 0 END) AS red_count,
          SUM(CASE WHEN grade = 'GREEN' THEN 1 ELSE 0 END) AS green_count,
          COUNT(*) AS total
        FROM dbo.jira_qa_results${s}
        WHERE assigneeName = '${safeName}'
          AND CreatedAt >= DATEADD(day, -30, GETUTCDATE())
          AND ISNULL(qaType, '') <> 'excluded'
      `);

      const teamQa = await p.request().query(`
        SELECT AVG(CAST(overallScore AS FLOAT)) AS team_avg
        FROM dbo.jira_qa_results${s}
        WHERE CreatedAt >= DATEADD(day, -30, GETUTCDATE())
          AND ISNULL(qaType, '') <> 'excluded'
      `);

      const qa = qaScores.recordset[0];
      const teamQaAvg = teamQa.recordset[0]?.team_avg ?? 0;

      if (qa?.total >= 3 && qa.avg_overall < teamQaAvg * 0.8) {
        const rec = await this.generateRecommendation(
          agentName, 'low_qa_score', null,
          `Agent QA score is ${qa.avg_overall.toFixed(1)} vs team average ${teamQaAvg.toFixed(1)} (scale 1-10). ${qa.red_count} Red tickets out of ${qa.total} total.`,
        );
        await this.saveSignal(agentId, agentName, 'low_qa_score', null, null,
          qa.avg_overall, teamQaAvg, rec, null);
        signalCount++;
      }

      // 4. Resolution check failure rate from jira_qa_results (KPI SQL)
      const rcResults = await p.request().query(`
        SELECT
          resolutionChecks,
          issueKey
        FROM dbo.jira_qa_results${s}
        WHERE assigneeName = '${safeName}'
          AND CreatedAt >= DATEADD(day, -30, GETUTCDATE())
          AND ISNULL(qaType, '') <> 'excluded'
          AND resolutionChecks IS NOT NULL
      `);

      let rcFailCount = 0;
      let rcTotalCount = 0;
      for (const row of rcResults.recordset) {
        try {
          const checks = typeof row.resolutionChecks === 'string' ? JSON.parse(row.resolutionChecks) : row.resolutionChecks;
          if (checks) {
            rcTotalCount++;
            const anyFail = Object.values(checks).some((c: any) => c && !c.passed);
            if (anyFail) rcFailCount++;
          }
        } catch {}
      }

      if (rcTotalCount >= 3 && rcFailCount / rcTotalCount > 0.3) {
        const failRate = rcFailCount / rcTotalCount;
        const rec = await this.generateRecommendation(
          agentName, 'high_resolution_fail_rate', null,
          `Agent has ${(failRate * 100).toFixed(0)}% resolution check failure rate (${rcFailCount} of ${rcTotalCount} tickets). Tickets are being closed without meeting quality checks.`,
        );
        await this.saveSignal(agentId, agentName, 'high_resolution_fail_rate', null, null,
          failRate, 0.1, rec, null);
        signalCount++;
      }
    } catch (err) {
      console.warn(`[training-signals] KPI query failed for ${agentName}:`, err instanceof Error ? err.message : err);
    }

    return signalCount;
  }

  private async getExampleTickets(agentId: string, requestType: string, actionPrefix: string): Promise<string> {
    const tickets = await query<{ ticket_id: string }>(
      `SELECT TOP 3 ad.ticket_id
       FROM agent_decisions ad
       JOIN jira_issue_cache jic ON jic.issue_key = ad.ticket_id
       WHERE jic.assignee_account_id = ?
         AND jic.request_type = ?
         AND ad.action LIKE ?
         AND ad.created_at >= DATEADD(day, -30, GETUTCDATE())
       ORDER BY ad.created_at DESC`,
      [agentId, requestType, `${actionPrefix}%`],
    );
    return JSON.stringify(tickets.map(t => t.ticket_id));
  }

  private async generateRecommendation(agentName: string, signalType: string, requestType: string | null, context: string): Promise<string> {
    try {
      const result = await this.llm.call(
        `You are a support team training advisor. Generate a concise, actionable training recommendation for an agent.`,
        `Agent: ${agentName}
Signal: ${signalType}${requestType ? ` for request type "${requestType}"` : ''}
Context: ${context}

Provide a specific, actionable recommendation in 1-2 sentences. Focus on what the agent should learn or practice.`,
        RecommendationSchema,
        { callType: 'training_signal', tier: 'cheap', temperature: 0.3 },
      );
      return result.data.recommendation;
    } catch {
      return `Review ${signalType} patterns${requestType ? ` for ${requestType} tickets` : ''} with team lead.`;
    }
  }

  private async saveSignal(
    agentId: string, agentName: string, signalType: string,
    requestType: string | null, component: string | null,
    metricValue: number | null, teamAverage: number | null,
    recommendation: string, exampleTickets: string | null,
  ): Promise<void> {
    let kbLink: string | null = null;
    if (requestType) {
      const articles = await query<{ article_url: string }>(
        `SELECT TOP 1 article_url FROM kb_article_health
         WHERE article_title LIKE ? AND status = 'current' AND article_url IS NOT NULL`,
        [`%${requestType}%`],
      );
      if (articles.length > 0) {
        kbLink = articles[0].article_url;
      } else {
        await execute(
          `INSERT INTO kb_gap_log (ticket_id, category, suggested_title, reason, status)
           VALUES (?, ?, ?, ?, 'open')`,
          ['training_signal', requestType, `Training: ${requestType}`, `Training signal identified gap: no KB article for ${requestType}`],
        );
      }
    }

    await executeAndGetId(
      `INSERT INTO agent_training_signals
       (agent_id, agent_name, signal_type, request_type, component, metric_value, team_average, recommendation, example_tickets, kb_article_link)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [agentId, agentName, signalType, requestType, component, metricValue, teamAverage, recommendation, exampleTickets, kbLink],
    );
  }

  async getSignals(agentId?: string, actioned?: boolean): Promise<TrainingSignal[]> {
    let sql = `SELECT * FROM agent_training_signals WHERE 1=1`;
    const params: unknown[] = [];
    if (agentId) { sql += ` AND agent_id = ?`; params.push(agentId); }
    if (actioned !== undefined) { sql += ` AND actioned = ?`; params.push(actioned ? 1 : 0); }
    sql += ` ORDER BY generated_at DESC`;
    return query<TrainingSignal>(sql, params);
  }

  async markActioned(signalId: number): Promise<void> {
    await execute(`UPDATE agent_training_signals SET actioned = 1 WHERE id = ?`, [signalId]);
  }

  async getTeamHeatmap(): Promise<Array<{
    request_type: string;
    agent_count: number;
    avg_metric: number;
    signal_count: number;
  }>> {
    return query(
      `SELECT
         request_type,
         COUNT(DISTINCT agent_id) AS agent_count,
         AVG(metric_value) AS avg_metric,
         COUNT(*) AS signal_count
       FROM agent_training_signals
       WHERE request_type IS NOT NULL
         AND generated_at >= DATEADD(day, -30, GETUTCDATE())
       GROUP BY request_type
       ORDER BY signal_count DESC`,
    );
  }
}
