import sql from 'mssql';
import type { LlmService } from './llm-service.js';
import type { JiraRestClient } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { CoachingSynthesisSchema, type CoachingSynthesis } from './coaching-schema.js';
import { loadPrompt } from './prompt-loader.js';
import { query, queryOne, executeAndGetId } from './database.js';
import type { PipelineTarget } from './pipeline-monitor.js';
import { tableSuffix } from './pipeline-monitor.js';

export type CoachingVisibility = 'off' | 'agent' | 'manager';
export type NudgeType = 'missing_next_update' | 'weak_reply' | 'no_troubleshooting' | 'unaddressed_question' | 'idle_ticket' | 'golden_rules' | 'escalation_without_docs';

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

interface GrScoreRow {
  IssueKey: string;
  CommentId: string;
  OverallScore: number;
  Rule1Score: number;
  Rule2Score: number;
  Rule3Score: number;
  Summary: string;
  commentTimestamp: Date;
}

interface QaScoreRow {
  issueKey: string;
  overallScore: number;
  accuracyScore: number;
  clarityScore: number;
  toneScore: number;
  closureScore: number;
  grade: string;
  resolutionChecks: string | null;
}

export class CoachingEngine {
  private visibility: CoachingVisibility = 'manager';

  constructor(
    private llmService: LlmService,
    private jiraClient: JiraRestClient,
    private jiraProject: string = 'NT',
    private settings?: SettingsQueries,
  ) {}

  setVisibility(v: CoachingVisibility): void { this.visibility = v; }
  getVisibility(): CoachingVisibility { return this.visibility; }
  setSettings(s: SettingsQueries): void { this.settings = s; }

  private get target(): PipelineTarget {
    const val = this.settings?.get('qa_pipeline_target');
    return val === 'live' ? 'live' : 'uat';
  }

  private get s(): string {
    return tableSuffix(this.target);
  }

  async synthesiseCoaching(agentDisplayName: string, agentEmail?: string): Promise<CoachingSynthesis | null> {
    if (!this.settings) {
      console.warn('[coach] Settings not available, skipping coaching synthesis');
      return null;
    }

    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;

      const grScores = await this.getRecentGrScores(p, s, agentDisplayName, agentEmail);
      const qaScores = await this.getRecentQaScores(p, s, agentDisplayName);

      if (grScores.length === 0 && qaScores.length === 0) {
        console.log(`[coach] No scores found for ${agentDisplayName}, skipping synthesis`);
        return null;
      }

      const context = this.buildSynthesisContext(agentDisplayName, grScores, qaScores);

      const prompt = loadPrompt('coaching', {
        agent_name: agentDisplayName,
        gr_score_summary: context.grSummary,
        qa_score_summary: context.qaSummary,
        resolution_check_results: context.resolutionResults,
      });

      const result = await this.llmService.call<CoachingSynthesis>(
        prompt,
        `Synthesise coaching for agent: ${agentDisplayName}`,
        CoachingSynthesisSchema,
        { temperature: 0.3, callType: 'coaching_synthesis' },
      );

      if (result.data) {
        const agentUserId = await this.resolveAgentUserIdByName(agentDisplayName);
        await this.saveCoachingEntry(agentUserId, result.data);

        if (this.visibility !== 'off' && result.data.nudges.length > 0) {
          await this.deliverNudges(result.data, agentDisplayName);
        }
      }

      return result.data;
    } catch (err) {
      console.error(`[coach] Synthesis failed for ${agentDisplayName}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  async synthesiseForAgents(agentNames: string[]): Promise<number> {
    let synthesised = 0;
    for (const name of agentNames) {
      try {
        const result = await this.synthesiseCoaching(name);
        if (result) synthesised++;
      } catch (err) {
        console.warn(`[coach] Synthesis failed for ${name}:`, err instanceof Error ? err.message : err);
      }
    }
    return synthesised;
  }

  async checkTicketHealth(ticketKey: string, assigneeAccountId: string): Promise<NudgeType[]> {
    const nudges: NudgeType[] = [];
    const issue = await this.jiraClient.getIssue(ticketKey, [
      'summary', 'status', 'assignee', 'updated', 'comment',
      'customfield_10010',
    ]);
    if (!issue) return nudges;

    const fields = issue.fields as any;
    const updated = fields.updated ? new Date(fields.updated) : null;
    const now = new Date();

    if (updated && this.isBusinessHours(now)) {
      const hoursSinceUpdate = (now.getTime() - updated.getTime()) / 3600000;
      if (hoursSinceUpdate > 2 && fields.status?.name !== 'Waiting On Requestor') {
        nudges.push('idle_ticket');
      }
    }

    const comments = fields.comment?.comments ?? [];
    const lastCustomerComment = [...comments].reverse().find((c: any) =>
      c.author?.accountId !== assigneeAccountId && !this.isInternal(c)
    );

    if (lastCustomerComment) {
      const agentReplied = comments.some((c: any) =>
        c.author?.accountId === assigneeAccountId &&
        new Date(c.created) > new Date(lastCustomerComment.created) &&
        !this.isInternal(c)
      );
      if (!agentReplied) {
        nudges.push('unaddressed_question');
      }
    }

    return nudges;
  }

  async getAgentScores(agentDisplayName: string, days: number = 30): Promise<{
    grAverages: { ownership: number; nextAction: number; timeframe: number; overall: number } | null;
    qaAverages: { overall: number; accuracy: number; clarity: number; tone: number; closure: number } | null;
    gradeDistribution: { green: number; amber: number; red: number };
    recentNudges: Array<{ type: string; message: string; severity: string; date: string }>;
    totalGrScores: number;
    totalQaScores: number;
  }> {
    if (!this.settings) {
      return { grAverages: null, qaAverages: null, gradeDistribution: { green: 0, amber: 0, red: 0 }, recentNudges: [], totalGrScores: 0, totalQaScores: 0 };
    }

    const p = await getKpiPool(this.settings);
    const s = this.s;
    const safeName = agentDisplayName.replace(/'/g, "''");

    const [grResult, qaResult] = await Promise.all([
      p.request().query(`
        DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          AVG(CAST(Rule1Score AS FLOAT)) AS avg_ownership,
          AVG(CAST(Rule2Score AS FLOAT)) AS avg_next_action,
          AVG(CAST(Rule3Score AS FLOAT)) AS avg_timeframe,
          AVG(CAST(OverallScore AS FLOAT)) AS avg_overall,
          COUNT(*) AS total
        FROM dbo.Jira_QA_GoldenRules${s}
        WHERE Assignee = '${safeName}'
          AND CAST(CreatedAt AS DATE) >= @since
      `),
      p.request().query(`
        DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          AVG(CAST(overallScore AS FLOAT)) AS avg_overall,
          AVG(CAST(accuracyScore AS FLOAT)) AS avg_accuracy,
          AVG(CAST(clarityScore AS FLOAT)) AS avg_clarity,
          AVG(CAST(toneScore AS FLOAT)) AS avg_tone,
          AVG(CAST(closureScore AS FLOAT)) AS avg_closure,
          SUM(CASE WHEN grade = 'GREEN' THEN 1 ELSE 0 END) AS green_count,
          SUM(CASE WHEN grade = 'AMBER' THEN 1 ELSE 0 END) AS amber_count,
          SUM(CASE WHEN grade = 'RED' THEN 1 ELSE 0 END) AS red_count,
          COUNT(*) AS total
        FROM dbo.jira_qa_results${s}
        WHERE assigneeName = '${safeName}'
          AND CAST(CreatedAt AS DATE) >= @since
          AND ISNULL(qaType, '') <> 'excluded'
      `),
    ]);

    const gr = grResult.recordset[0];
    const qa = qaResult.recordset[0];

    const nudges = await query<any>(`
      SELECT nudge_type, message, delivery_method, created_at
      FROM agent_coaching
      WHERE agent_user_id IN (SELECT id FROM users WHERE display_name = ?)
        AND created_at >= DATEADD(day, -${days}, GETUTCDATE())
        AND nudge_type IS NOT NULL
      ORDER BY created_at DESC
      OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY
    `, [agentDisplayName]);

    return {
      grAverages: gr?.total > 0 ? {
        ownership: Math.round((gr.avg_ownership ?? 0) * 10) / 10,
        nextAction: Math.round((gr.avg_next_action ?? 0) * 10) / 10,
        timeframe: Math.round((gr.avg_timeframe ?? 0) * 10) / 10,
        overall: Math.round((gr.avg_overall ?? 0) * 10) / 10,
      } : null,
      qaAverages: qa?.total > 0 ? {
        overall: Math.round((qa.avg_overall ?? 0) * 10) / 10,
        accuracy: Math.round((qa.avg_accuracy ?? 0) * 10) / 10,
        clarity: Math.round((qa.avg_clarity ?? 0) * 10) / 10,
        tone: Math.round((qa.avg_tone ?? 0) * 10) / 10,
        closure: Math.round((qa.avg_closure ?? 0) * 10) / 10,
      } : null,
      gradeDistribution: {
        green: qa?.green_count ?? 0,
        amber: qa?.amber_count ?? 0,
        red: qa?.red_count ?? 0,
      },
      recentNudges: nudges.map((n: any) => ({
        type: n.nudge_type,
        message: n.message ?? '',
        severity: n.delivery_method === 'health_check' ? 'info' : 'warning',
        date: n.created_at?.toISOString?.() ?? String(n.created_at),
      })),
      totalGrScores: gr?.total ?? 0,
      totalQaScores: qa?.total ?? 0,
    };
  }

  async getTeamScores(days: number = 30): Promise<any[]> {
    if (!this.settings) return [];

    const p = await getKpiPool(this.settings);
    const s = this.s;

    const [qaResult, grResult] = await Promise.all([
      p.request().query(`
        DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          assigneeName AS agent_name,
          COUNT(*) AS assessments,
          AVG(CAST(overallScore AS FLOAT)) AS avg_overall,
          SUM(CASE WHEN grade = 'GREEN' THEN 1 ELSE 0 END) AS green_count,
          SUM(CASE WHEN grade = 'AMBER' THEN 1 ELSE 0 END) AS amber_count,
          SUM(CASE WHEN grade = 'RED' THEN 1 ELSE 0 END) AS red_count
        FROM dbo.jira_qa_results${s}
        WHERE CAST(CreatedAt AS DATE) >= @since
          AND ISNULL(qaType, '') <> 'excluded'
          AND assigneeName IS NOT NULL AND assigneeName <> ''
        GROUP BY assigneeName
      `),
      p.request().query(`
        DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
        SELECT
          Assignee AS agent_name,
          AVG(CAST(Rule1Score AS FLOAT)) AS avg_ownership,
          AVG(CAST(Rule2Score AS FLOAT)) AS avg_next_action,
          AVG(CAST(Rule3Score AS FLOAT)) AS avg_timeframe,
          AVG(CAST(OverallScore AS FLOAT)) AS avg_overall,
          COUNT(*) AS gr_count
        FROM dbo.Jira_QA_GoldenRules${s}
        WHERE CAST(CreatedAt AS DATE) >= @since
          AND Assignee IS NOT NULL AND Assignee <> ''
        GROUP BY Assignee
      `),
    ]);

    const grMap: Record<string, any> = {};
    for (const r of grResult.recordset) grMap[r.agent_name] = r;

    return qaResult.recordset.map((row: any) => {
      const gr = grMap[row.agent_name];
      return {
        agent_name: row.agent_name,
        assessments: row.assessments,
        avg_qa_overall: row.avg_overall != null ? Math.round(row.avg_overall * 10) / 10 : null,
        avg_ownership: gr?.avg_ownership != null ? Math.round(gr.avg_ownership * 10) / 10 : null,
        avg_next_action: gr?.avg_next_action != null ? Math.round(gr.avg_next_action * 10) / 10 : null,
        avg_timeframe: gr?.avg_timeframe != null ? Math.round(gr.avg_timeframe * 10) / 10 : null,
        avg_gr_overall: gr?.avg_overall != null ? Math.round(gr.avg_overall * 10) / 10 : null,
        green_count: row.green_count,
        amber_count: row.amber_count,
        red_count: row.red_count,
      };
    });
  }

  async getNudgeHistory(limit: number = 50, agentUserId?: number): Promise<any[]> {
    if (agentUserId) {
      return query(`
        SELECT * FROM agent_coaching
        WHERE agent_user_id = ? AND nudge_type IS NOT NULL
        ORDER BY created_at DESC
        OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY
      `, [agentUserId, limit]);
    }
    return query(`
      SELECT * FROM agent_coaching
      WHERE nudge_type IS NOT NULL
      ORDER BY created_at DESC
      OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY
    `, [limit]);
  }

  private async getRecentGrScores(p: sql.ConnectionPool, suffix: string, agentName: string, agentEmail?: string): Promise<GrScoreRow[]> {
    const safeName = agentName.replace(/'/g, "''");
    let emailFilter = '';
    if (agentEmail) {
      const safeEmail = agentEmail.replace(/'/g, "''");
      emailFilter = `OR agentEmail = '${safeEmail}'`;
    }

    const result = await p.request().query(`
      SELECT TOP 20
        IssueKey, CommentId, OverallScore, Rule1Score, Rule2Score, Rule3Score,
        Summary, commentTimestamp
      FROM dbo.Jira_QA_GoldenRules${suffix}
      WHERE (Assignee = '${safeName}' OR Updater = '${safeName}' ${emailFilter})
      ORDER BY commentTimestamp DESC
    `);
    return result.recordset;
  }

  private async getRecentQaScores(p: sql.ConnectionPool, suffix: string, agentName: string): Promise<QaScoreRow[]> {
    const safeName = agentName.replace(/'/g, "''");
    const result = await p.request().query(`
      SELECT TOP 10
        issueKey, overallScore, accuracyScore, clarityScore, toneScore, closureScore,
        grade, resolutionChecks
      FROM dbo.jira_qa_results${suffix}
      WHERE assigneeName = '${safeName}'
        AND ISNULL(qaType, '') <> 'excluded'
      ORDER BY CreatedAt DESC
    `);
    return result.recordset;
  }

  private buildSynthesisContext(agentName: string, grScores: GrScoreRow[], qaScores: QaScoreRow[]): {
    grSummary: string;
    qaSummary: string;
    resolutionResults: string;
  } {
    let grSummary = 'No Golden Rules scores available.';
    if (grScores.length > 0) {
      const avgOwnership = grScores.reduce((s, r) => s + r.Rule1Score, 0) / grScores.length;
      const avgNextAction = grScores.reduce((s, r) => s + r.Rule2Score, 0) / grScores.length;
      const avgTimeframe = grScores.reduce((s, r) => s + r.Rule3Score, 0) / grScores.length;
      const avgOverall = grScores.reduce((s, r) => s + r.OverallScore, 0) / grScores.length;

      const lowest = [...grScores].sort((a, b) => a.OverallScore - b.OverallScore).slice(0, 3);
      const lowestDetail = lowest.map(r =>
        `  - ${r.IssueKey} (comment ${r.CommentId}): overall=${r.OverallScore}, ownership=${r.Rule1Score}, nextAction=${r.Rule2Score}, timeframe=${r.Rule3Score}. "${r.Summary?.slice(0, 150)}"`
      ).join('\n');

      grSummary = `${grScores.length} recent comments scored.\nAverages: ownership=${avgOwnership.toFixed(1)}, nextAction=${avgNextAction.toFixed(1)}, timeframe=${avgTimeframe.toFixed(1)}, overall=${avgOverall.toFixed(1)} (scale 1-3)\n\n3 lowest-scoring comments:\n${lowestDetail}`;
    }

    let qaSummary = 'No QA scores available.';
    let resolutionResults = 'No resolution check data available.';
    if (qaScores.length > 0) {
      const avgOverall = qaScores.reduce((s, r) => s + r.overallScore, 0) / qaScores.length;
      const avgAccuracy = qaScores.reduce((s, r) => s + r.accuracyScore, 0) / qaScores.length;
      const avgClarity = qaScores.reduce((s, r) => s + r.clarityScore, 0) / qaScores.length;
      const avgTone = qaScores.reduce((s, r) => s + r.toneScore, 0) / qaScores.length;
      const avgClosure = qaScores.reduce((s, r) => s + r.closureScore, 0) / qaScores.length;
      const redTickets = qaScores.filter(r => r.grade === 'RED' || r.grade === 'Red');

      qaSummary = `${qaScores.length} recently resolved tickets scored.\nAverages: overall=${avgOverall.toFixed(1)}, accuracy=${avgAccuracy.toFixed(1)}, clarity=${avgClarity.toFixed(1)}, tone=${avgTone.toFixed(1)}, closure=${avgClosure.toFixed(1)} (scale 1-10)\nGrade distribution: ${qaScores.filter(r => r.grade === 'GREEN' || r.grade === 'Green').length} Green, ${qaScores.filter(r => r.grade === 'AMBER' || r.grade === 'Amber').length} Amber, ${redTickets.length} Red`;

      if (redTickets.length > 0) {
        qaSummary += `\n\nRed-graded tickets:\n${redTickets.map(r => `  - ${r.issueKey}: overall=${r.overallScore}`).join('\n')}`;
      }

      const withChecks = qaScores.filter(r => r.resolutionChecks);
      if (withChecks.length > 0) {
        let failures: string[] = [];
        for (const row of withChecks) {
          try {
            const checks = typeof row.resolutionChecks === 'string' ? JSON.parse(row.resolutionChecks) : row.resolutionChecks;
            if (checks) {
              for (const [checkName, checkVal] of Object.entries(checks)) {
                const c = checkVal as any;
                if (c && !c.passed) {
                  failures.push(`  - ${row.issueKey}: ${checkName} failed — ${c.detail?.slice(0, 100) ?? 'no detail'}`);
                }
              }
            }
          } catch {}
        }
        resolutionResults = failures.length > 0
          ? `${failures.length} resolution check failure(s):\n${failures.join('\n')}`
          : 'All resolution checks passed.';
      }
    }

    return { grSummary, qaSummary, resolutionResults };
  }

  private async saveCoachingEntry(agentUserId: number, synthesis: CoachingSynthesis): Promise<void> {
    await executeAndGetId(`
      INSERT INTO agent_coaching (ticket_id, agent_user_id, nudge_type, golden_rule_scores, message, delivered, delivery_method)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      'synthesis',
      agentUserId,
      synthesis.nudges.length > 0 ? synthesis.nudges[0].type : null,
      null,
      synthesis.coachingMessage?.slice(0, 2000) || null,
      0,
      'synthesis',
    ]);
  }

  private async deliverNudges(synthesis: CoachingSynthesis, agentName: string): Promise<void> {
    const criticalNudges = synthesis.nudges.filter(n => n.severity === 'critical' || n.severity === 'warning');
    if (criticalNudges.length === 0) return;

    const nudgeText = criticalNudges.map(n => `• ${n.message}`).join('\n');
    const evidenceTickets = [...new Set(criticalNudges.flatMap(n => n.evidenceTickets))].slice(0, 5);
    const evidenceText = evidenceTickets.length > 0 ? `\nEvidence: ${evidenceTickets.join(', ')}` : '';

    console.log(`[coach] ${criticalNudges.length} nudge(s) for ${agentName}: ${criticalNudges.map(n => n.type).join(', ')}${evidenceText}`);
  }

  private async resolveAgentUserIdByName(displayName: string): Promise<number> {
    const row = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE display_name = ?`, [displayName],
    );
    return row?.id ?? 0;
  }

  private isInternal(comment: any): boolean {
    const props = comment.properties ?? [];
    return props.some((p: any) => p.key === 'sd.public.comment' && p.value?.internal === true);
  }

  private isBusinessHours(date: Date): boolean {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    const hour = date.getHours();
    return hour >= 8 && hour < 18;
  }
}
