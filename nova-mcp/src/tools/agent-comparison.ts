import { z } from 'zod';
import { query } from '../db.js';
import { TEAM_AGENTS } from '../constants.js';
import { toolResult, toolError, mean, stddev } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const agentComparisonSchema = {
  metric: z.enum(['qa_score', 'open_tickets', 'solved_today', 'over_2h', 'no_update'])
    .describe('Metric to compare agents on'),
  days: z.number().default(30).describe('Number of days to look back (default 30)'),
};

interface AgentKpiRow {
  AgentName: string;
  value: number;
}

const METRIC_COLUMNS: Record<string, string> = {
  open_tickets: 'OpenTickets_Total',
  solved_today: 'SolvedTickets_Today',
  over_2h: 'OpenTickets_Over2Hours',
  no_update: 'OpenTickets_NoUpdateToday',
};

export async function agentComparison(args: {
  metric: string;
  days: number;
}): Promise<CallToolResult> {
  const { metric, days } = args;
  const agentList = TEAM_AGENTS.join("','");

  let rows: AgentKpiRow[];

  if (metric === 'qa_score') {
    rows = await query<AgentKpiRow[]>(
      `SELECT assigneeName AS AgentName, AVG(overallScore) AS value
       FROM dbo.jira_qa_results
       WHERE assigneeName IN ('${agentList}')
         AND CreatedAt >= DATEADD(day, -@days, GETDATE())
         AND (qaType IS NULL OR qaType != 'excluded')
       GROUP BY assigneeName
       ORDER BY value DESC`,
      { days },
    );
  } else {
    const col = METRIC_COLUMNS[metric];
    if (!col) return toolError(`Unknown metric: ${metric}`);

    rows = await query<AgentKpiRow[]>(
      `SELECT AgentName, AVG(CAST(${col} AS FLOAT)) AS value
       FROM dbo.jira_agent_kpi_daily
       WHERE AgentName IN ('${agentList}')
         AND ReportDate >= DATEADD(day, -@days, GETDATE())
       GROUP BY AgentName
       ORDER BY value ${metric === 'solved_today' ? 'DESC' : 'ASC'}`,
      { days },
    );
  }

  if (rows.length === 0) {
    return toolError(`No data found for metric "${metric}" in the last ${days} days.`);
  }

  const values = rows.map(r => r.value);
  const teamAvg = Math.round(mean(values) * 100) / 100;
  const sd = stddev(values);

  const ranked = rows.map((r, i) => {
    const val = Math.round(r.value * 100) / 100;
    const diff = val - teamAvg;
    let status: 'above_average' | 'below_average' | 'at_average';
    if (Math.abs(diff) < 0.01) status = 'at_average';
    else if (metric === 'qa_score' || metric === 'solved_today') {
      status = diff > 0 ? 'above_average' : 'below_average';
    } else {
      status = diff < 0 ? 'above_average' : 'below_average';
    }

    return {
      rank: i + 1,
      agent: r.AgentName,
      value: val,
      status,
      isOutlier: Math.abs(r.value - teamAvg) > sd,
    };
  });

  const outliers = ranked.filter(r => r.isOutlier).map(r => r.agent);
  const topAgent = ranked[0];

  const summary = `Agent comparison on "${metric}" (last ${days} days): Team average ${teamAvg}. ` +
    `Top performer: ${topAgent.agent} (${topAgent.value}). ` +
    `${ranked.length} agents ranked. ` +
    `${outliers.length > 0 ? `Outliers (>1 SD from mean): ${outliers.join(', ')}.` : 'No significant outliers.'}`;

  return toolResult(summary, {
    metric,
    days,
    teamAverage: teamAvg,
    standardDeviation: Math.round(sd * 100) / 100,
    rankings: ranked,
    outliers,
  });
}
