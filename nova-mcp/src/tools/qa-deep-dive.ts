import { z } from 'zod';
import { query } from '../db.js';
import { TEAM_AGENTS } from '../constants.js';
import { toolResult, toolError, mean } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const qaDeepDiveSchema = {
  agent: z.string().optional().describe('Agent name (must be in TEAM_AGENTS). Omit for whole team.'),
  days: z.number().default(30).describe('Number of days to look back (default 30)'),
};

export async function qaDeepDive(args: {
  agent?: string;
  days: number;
}): Promise<CallToolResult> {
  const { agent, days } = args;
  const agentList = TEAM_AGENTS.join("','");

  if (agent && !TEAM_AGENTS.includes(agent as any)) {
    return toolError(`"${agent}" is not in TEAM_AGENTS. Valid agents: ${TEAM_AGENTS.join(', ')}`);
  }

  const whereAgent = agent ? `AND assigneeName = @agent` : `AND assigneeName IN ('${agentList}')`;

  // Score distribution
  const distRows = await query<Array<{ grade: string; cnt: number }>>(
    `SELECT grade, COUNT(*) AS cnt
     FROM dbo.jira_qa_results
     WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
       ${whereAgent}
       AND (qaType IS NULL OR qaType != 'excluded')
     GROUP BY grade`,
    { days, ...(agent ? { agent } : {}) },
  );

  const totalScored = distRows.reduce((s, r) => s + r.cnt, 0);
  if (totalScored === 0) {
    return toolError(`No QA data found${agent ? ` for ${agent}` : ''} in the last ${days} days.`);
  }

  const distribution = Object.fromEntries(
    distRows.map(r => [r.grade, {
      count: r.cnt,
      pct: Math.round((r.cnt / totalScored) * 1000) / 10,
    }]),
  );

  // Average scores by dimension
  const avgRows = await query<Array<{
    avgOverall: number; avgAccuracy: number; avgClarity: number; avgTone: number;
  }>>(
    `SELECT AVG(overallScore) AS avgOverall,
            AVG(accuracyScore) AS avgAccuracy,
            AVG(clarityScore) AS avgClarity,
            AVG(toneScore) AS avgTone
     FROM dbo.jira_qa_results
     WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
       ${whereAgent}
       AND (qaType IS NULL OR qaType != 'excluded')`,
    { days, ...(agent ? { agent } : {}) },
  );

  const avgs = avgRows[0];
  const dimensions = {
    overall: Math.round(avgs.avgOverall * 100) / 100,
    accuracy: Math.round(avgs.avgAccuracy * 100) / 100,
    clarity: Math.round(avgs.avgClarity * 100) / 100,
    tone: Math.round(avgs.avgTone * 100) / 100,
  };

  // Category breakdown
  const catRows = await query<Array<{ category: string; avgScore: number; cnt: number }>>(
    `SELECT category, AVG(overallScore) AS avgScore, COUNT(*) AS cnt
     FROM dbo.jira_qa_results
     WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
       ${whereAgent}
       AND (qaType IS NULL OR qaType != 'excluded')
       AND category IS NOT NULL
     GROUP BY category
     ORDER BY AVG(overallScore) ASC`,
    { days, ...(agent ? { agent } : {}) },
  );

  // Concerning tickets
  const concerningRows = await query<Array<{ issueKey: string; overallScore: number; assigneeName: string }>>(
    `SELECT issueKey, overallScore, assigneeName
     FROM dbo.jira_qa_results
     WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
       ${whereAgent}
       AND (qaType IS NULL OR qaType != 'excluded')
       AND isConcerning = 1
     ORDER BY CreatedAt DESC`,
    { days, ...(agent ? { agent } : {}) },
  );

  // Golden Rules
  const grWhereAgent = agent ? `AND Updater = @agent` : `AND Updater IN ('${agentList}')`;
  const grRows = await query<Array<{
    totalChecks: number;
    rule1Rate: number; rule2Rate: number; rule3Rate: number;
    avgScore: number;
  }>>(
    `SELECT COUNT(*) AS totalChecks,
            AVG(CAST(rule1Pass AS FLOAT)) * 100 AS rule1Rate,
            AVG(CAST(rule2Pass AS FLOAT)) * 100 AS rule2Rate,
            AVG(CAST(rule3Pass AS FLOAT)) * 100 AS rule3Rate,
            AVG(OverallScore) AS avgScore
     FROM dbo.Jira_QA_GoldenRules
     WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
       ${grWhereAgent}`,
    { days, ...(agent ? { agent } : {}) },
  );

  const gr = grRows[0];
  const goldenRules = {
    totalChecks: gr.totalChecks,
    rule1_ownership: Math.round(gr.rule1Rate * 10) / 10,
    rule2_nextAction: Math.round(gr.rule2Rate * 10) / 10,
    rule3_timeframe: Math.round(gr.rule3Rate * 10) / 10,
    averageScore: Math.round(gr.avgScore * 100) / 100,
  };

  // If agent specified, get team averages for comparison
  let vsTeam: Record<string, { agent: number; team: number }> | null = null;
  if (agent) {
    const teamAvgs = await query<Array<{
      avgOverall: number; avgAccuracy: number; avgClarity: number; avgTone: number;
    }>>(
      `SELECT AVG(overallScore) AS avgOverall,
              AVG(accuracyScore) AS avgAccuracy,
              AVG(clarityScore) AS avgClarity,
              AVG(toneScore) AS avgTone
       FROM dbo.jira_qa_results
       WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
         AND assigneeName IN ('${agentList}')
         AND (qaType IS NULL OR qaType != 'excluded')`,
      { days },
    );
    const ta = teamAvgs[0];
    vsTeam = {
      overall: { agent: dimensions.overall, team: Math.round(ta.avgOverall * 100) / 100 },
      accuracy: { agent: dimensions.accuracy, team: Math.round(ta.avgAccuracy * 100) / 100 },
      clarity: { agent: dimensions.clarity, team: Math.round(ta.avgClarity * 100) / 100 },
      tone: { agent: dimensions.tone, team: Math.round(ta.avgTone * 100) / 100 },
    };
  }

  // Coaching priority: rank dimensions by lowest score
  const dimEntries = [
    { dimension: 'accuracy', score: dimensions.accuracy },
    { dimension: 'clarity', score: dimensions.clarity },
    { dimension: 'tone', score: dimensions.tone },
  ].sort((a, b) => a.score - b.score);

  const coachingPriority = dimEntries[0].dimension;

  const who = agent ?? 'the team';
  const summary = `QA deep dive for ${who} (last ${days} days): ${totalScored} tickets scored. ` +
    `Overall avg: ${dimensions.overall}/10. ` +
    `Distribution: ${Object.entries(distribution).map(([g, d]) => `${g} ${(d as any).pct}%`).join(', ')}. ` +
    `${concerningRows.length} concerning ticket(s). ` +
    `Golden Rules avg: ${goldenRules.averageScore}/10, pass rates — ownership ${goldenRules.rule1_ownership}%, ` +
    `next action ${goldenRules.rule2_nextAction}%, timeframe ${goldenRules.rule3_timeframe}%. ` +
    `Coaching priority: ${coachingPriority} (lowest at ${dimEntries[0].score}).`;

  return toolResult(summary, {
    agent: agent ?? 'all',
    totalScored,
    distribution,
    dimensions,
    categoryBreakdown: catRows,
    concerningTickets: {
      count: concerningRows.length,
      issues: concerningRows.slice(0, 20),
    },
    goldenRules,
    vsTeam,
    coachingPriority: dimEntries,
  });
}
