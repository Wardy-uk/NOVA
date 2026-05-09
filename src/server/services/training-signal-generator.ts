import { z } from 'zod';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { query, execute, executeAndGetId } from './database.js';

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

export class TrainingSignalGenerator {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
  ) {}

  async generateWeeklySignals(): Promise<number> {
    const agents = await query<{ assignee_account_id: string; assignee_display_name: string }>(
      `SELECT DISTINCT assignee_account_id, assignee_display_name
       FROM jira_issue_cache
       WHERE assignee_account_id IS NOT NULL
         AND jira_updated >= DATEADD(day, -30, GETUTCDATE())`,
    );

    let signalCount = 0;
    for (const agent of agents) {
      const signals = await this.analyseAgent(agent.assignee_account_id, agent.assignee_display_name);
      signalCount += signals;
    }
    return signalCount;
  }

  private async analyseAgent(agentId: string, agentName: string): Promise<number> {
    let signalCount = 0;

    // 1. Escalation rate by request type
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

    // Get team averages for comparison
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

    // 2. QA scores by request type
    const qaScores = await query<{
      request_type: string;
      avg_score: number;
      ticket_count: number;
    }>(
      `SELECT
         jic.request_type,
         AVG(CAST(JSON_VALUE(ac.golden_rule_scores, '$.overall') AS FLOAT)) AS avg_score,
         COUNT(*) AS ticket_count
       FROM agent_coaching ac
       JOIN jira_issue_cache jic ON jic.issue_key = ac.ticket_id
       WHERE jic.assignee_account_id = ?
         AND ac.created_at >= DATEADD(day, -30, GETUTCDATE())
         AND ac.golden_rule_scores IS NOT NULL
         AND jic.request_type IS NOT NULL
       GROUP BY jic.request_type
       HAVING COUNT(*) >= 3`,
      [agentId],
    );

    const teamQaScores = await query<{ request_type: string; team_avg: number }>(
      `SELECT
         jic.request_type,
         AVG(CAST(JSON_VALUE(ac.golden_rule_scores, '$.overall') AS FLOAT)) AS team_avg
       FROM agent_coaching ac
       JOIN jira_issue_cache jic ON jic.issue_key = ac.ticket_id
       WHERE ac.created_at >= DATEADD(day, -30, GETUTCDATE())
         AND ac.golden_rule_scores IS NOT NULL
         AND jic.request_type IS NOT NULL
       GROUP BY jic.request_type
       HAVING COUNT(*) >= 5`,
    );
    const teamQaMap = new Map(teamQaScores.map(r => [r.request_type, r.team_avg]));

    for (const score of qaScores) {
      const teamAvg = teamQaMap.get(score.request_type) ?? 0;
      if (score.avg_score < teamAvg * 0.8 && score.avg_score < 70) {
        const rec = await this.generateRecommendation(
          agentName, 'low_qa_score', score.request_type,
          `Agent QA score is ${score.avg_score.toFixed(0)} on ${score.request_type} vs team average ${teamAvg.toFixed(0)}`,
        );
        await this.saveSignal(agentId, agentName, 'low_qa_score', score.request_type, null,
          score.avg_score, teamAvg, rec, null);
        signalCount++;
      }
    }

    // 3. Coaching nudge frequency
    const nudgeCounts = await query<{ nudge_type: string; cnt: number }>(
      `SELECT ac.nudge_type, COUNT(*) AS cnt
       FROM agent_coaching ac
       JOIN jira_issue_cache jic ON jic.issue_key = ac.ticket_id
       WHERE jic.assignee_account_id = ?
         AND ac.created_at >= DATEADD(day, -30, GETUTCDATE())
         AND ac.nudge_type IS NOT NULL
       GROUP BY ac.nudge_type
       HAVING COUNT(*) >= 3`,
      [agentId],
    );

    const teamNudgeCounts = await query<{ nudge_type: string; team_avg: number }>(
      `SELECT ac.nudge_type, CAST(COUNT(*) AS FLOAT) / NULLIF(COUNT(DISTINCT jic.assignee_account_id), 0) AS team_avg
       FROM agent_coaching ac
       JOIN jira_issue_cache jic ON jic.issue_key = ac.ticket_id
       WHERE ac.created_at >= DATEADD(day, -30, GETUTCDATE())
         AND ac.nudge_type IS NOT NULL
       GROUP BY ac.nudge_type`,
    );
    const teamNudgeMap = new Map(teamNudgeCounts.map(r => [r.nudge_type, r.team_avg]));

    for (const nudge of nudgeCounts) {
      const teamAvg = teamNudgeMap.get(nudge.nudge_type) ?? 0;
      if (nudge.cnt > teamAvg * 2 && nudge.cnt >= 5) {
        const rec = await this.generateRecommendation(
          agentName, 'frequent_nudge', null,
          `Agent received ${nudge.cnt} "${nudge.nudge_type}" nudges in 30 days vs team average ${teamAvg.toFixed(1)}`,
        );
        await this.saveSignal(agentId, agentName, 'frequent_nudge', null, nudge.nudge_type,
          nudge.cnt, teamAvg, rec, null);
        signalCount++;
      }
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
    // Check for KB article coverage
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
        // Auto-log a KB gap if no article exists for this topic
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
