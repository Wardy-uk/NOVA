import { z } from 'zod';
import { query } from '../db.js';
import { TEAM_AGENTS } from '../constants.js';
import { toolResult, mean } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const focusAreasSchema = {
  days: z.number().default(14).describe('Number of days to look back (default 14)'),
};

interface FocusItem {
  severity: 'red' | 'amber';
  area: string;
  metric: number;
  target: number | null;
  gap: number | null;
  action: string;
}

export async function focusAreas(args: { days: number }): Promise<CallToolResult> {
  const { days } = args;
  const agentList = TEAM_AGENTS.join("','");
  const items: FocusItem[] = [];

  // 1. KPIs below target
  const kpiRows = await query<Array<{
    kpi: string; avgCount: number; target: number; direction: string;
  }>>(
    `SELECT kpi, AVG([count]) AS avgCount, AVG(target) AS target, MAX(direction) AS direction
     FROM dbo.jira_kpi_daily
     WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
       AND target IS NOT NULL AND target > 0
     GROUP BY kpi
     HAVING (MAX(direction) LIKE '%lower%' AND AVG([count]) > AVG(target) * 1.1)
        OR  (MAX(direction) NOT LIKE '%lower%' AND AVG([count]) < AVG(target) * 0.9)
     ORDER BY ABS(AVG([count]) - AVG(target)) / AVG(target) DESC`,
    { days },
  );

  for (const row of kpiRows.slice(0, 5)) {
    const lowerIsBetter = (row.direction ?? '').toLowerCase().includes('lower');
    const gap = lowerIsBetter
      ? ((row.avgCount - row.target) / row.target) * 100
      : ((row.target - row.avgCount) / row.target) * 100;
    items.push({
      severity: gap > 20 ? 'red' : 'amber',
      area: row.kpi,
      metric: Math.round(row.avgCount * 100) / 100,
      target: row.target,
      gap: Math.round(gap * 10) / 10,
      action: lowerIsBetter
        ? `Reduce ${row.kpi} — currently ${Math.round(gap)}% above target.`
        : `Improve ${row.kpi} — currently ${Math.round(gap)}% below target.`,
    });
  }

  // 2. QA averages below 7.0 by agent
  const qaRows = await query<Array<{ assigneeName: string; avgScore: number }>>(
    `SELECT assigneeName, AVG(overallScore) AS avgScore
     FROM dbo.jira_qa_results
     WHERE assigneeName IN ('${agentList}')
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())
       AND (qaType IS NULL OR qaType != 'excluded')
     GROUP BY assigneeName
     HAVING AVG(overallScore) < 7.0
     ORDER BY AVG(overallScore) ASC`,
    { days },
  );

  for (const row of qaRows.slice(0, 3)) {
    items.push({
      severity: row.avgScore < 5.0 ? 'red' : 'amber',
      area: `QA: ${row.assigneeName}`,
      metric: Math.round(row.avgScore * 100) / 100,
      target: 7.0,
      gap: Math.round(((7.0 - row.avgScore) / 7.0) * 1000) / 10,
      action: `Coach ${row.assigneeName} on QA — average ${row.avgScore.toFixed(1)} is below the 7.0 threshold.`,
    });
  }

  // 3. Golden Rules pass rates below 70%
  const grRows = await query<Array<{ rule: string; passRate: number }>>(
    `SELECT 'Rule 1 (Ownership)' AS rule,
            AVG(CAST(rule1Pass AS FLOAT)) * 100 AS passRate
     FROM dbo.Jira_QA_GoldenRules
     WHERE Updater IN ('${agentList}')
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())
     UNION ALL
     SELECT 'Rule 2 (Next Action)',
            AVG(CAST(rule2Pass AS FLOAT)) * 100
     FROM dbo.Jira_QA_GoldenRules
     WHERE Updater IN ('${agentList}')
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())
     UNION ALL
     SELECT 'Rule 3 (Timeframe)',
            AVG(CAST(rule3Pass AS FLOAT)) * 100
     FROM dbo.Jira_QA_GoldenRules
     WHERE Updater IN ('${agentList}')
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())`,
    { days },
  );

  for (const row of grRows) {
    if (row.passRate < 70) {
      items.push({
        severity: row.passRate < 50 ? 'red' : 'amber',
        area: `Golden Rules: ${row.rule}`,
        metric: Math.round(row.passRate * 10) / 10,
        target: 70,
        gap: Math.round((70 - row.passRate) * 10) / 10,
        action: `Focus team on ${row.rule} — pass rate ${row.passRate.toFixed(0)}% is below 70% threshold.`,
      });
    }
  }

  // 4. Week-on-week deterioration
  const wowRows = await query<Array<{
    kpi: string; thisWeek: number; lastWeek: number; direction: string;
  }>>(
    `WITH ThisWeek AS (
       SELECT kpi, AVG([count]) AS avg_count, MAX(direction) AS direction
       FROM dbo.jira_kpi_daily
       WHERE CreatedAt >= DATEADD(day, -7, GETDATE())
       GROUP BY kpi
     ),
     LastWeek AS (
       SELECT kpi, AVG([count]) AS avg_count
       FROM dbo.jira_kpi_daily
       WHERE CreatedAt >= DATEADD(day, -14, GETDATE())
         AND CreatedAt < DATEADD(day, -7, GETDATE())
       GROUP BY kpi
     )
     SELECT t.kpi, t.avg_count AS thisWeek, l.avg_count AS lastWeek, t.direction
     FROM ThisWeek t
     JOIN LastWeek l ON t.kpi = l.kpi
     WHERE l.avg_count > 0
       AND (
         (t.direction LIKE '%lower%' AND t.avg_count > l.avg_count * 1.15)
         OR (t.direction NOT LIKE '%lower%' AND t.avg_count < l.avg_count * 0.85)
       )`,
    { days },
  );

  for (const row of wowRows.slice(0, 3)) {
    const lowerIsBetter = (row.direction ?? '').toLowerCase().includes('lower');
    const change = ((row.thisWeek - row.lastWeek) / Math.abs(row.lastWeek)) * 100;
    items.push({
      severity: Math.abs(change) > 30 ? 'red' : 'amber',
      area: `WoW decline: ${row.kpi}`,
      metric: Math.round(row.thisWeek * 100) / 100,
      target: Math.round(row.lastWeek * 100) / 100,
      gap: Math.round(Math.abs(change) * 10) / 10,
      action: `${row.kpi} ${lowerIsBetter ? 'increased' : 'dropped'} ${Math.abs(change).toFixed(0)}% week-over-week — investigate root cause.`,
    });
  }

  // 5. Over-SLA counts
  const slaRows = await query<Array<{ kpi: string; avgCount: number }>>(
    `SELECT kpi, AVG([count]) AS avgCount
     FROM dbo.jira_kpi_daily
     WHERE (kpiGroup = 'SLA' OR kpi LIKE '%over sla%')
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())
       AND [count] > 0
     GROUP BY kpi
     ORDER BY AVG([count]) DESC`,
    { days },
  );

  for (const row of slaRows.slice(0, 2)) {
    items.push({
      severity: row.avgCount > 5 ? 'red' : 'amber',
      area: `SLA: ${row.kpi}`,
      metric: Math.round(row.avgCount * 100) / 100,
      target: 0,
      gap: null,
      action: `Average ${row.avgCount.toFixed(1)} tickets over SLA for "${row.kpi}" — prioritise clearing the backlog.`,
    });
  }

  // Sort by severity (red first), then by gap descending
  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'red' ? -1 : 1;
    return (b.gap ?? 0) - (a.gap ?? 0);
  });

  const top5 = items.slice(0, 5);

  const summary = top5.length === 0
    ? 'No significant focus areas identified — all KPIs appear healthy.'
    : `Top ${top5.length} focus areas: ${top5.map((f, i) =>
        `${i + 1}. ${f.area} (${f.severity.toUpperCase()}: ${f.metric}${f.target !== null ? ` vs target ${f.target}` : ''})`
      ).join('; ')}. ${top5.filter(f => f.severity === 'red').length} red, ${top5.filter(f => f.severity === 'amber').length} amber.`;

  return toolResult(summary, { focusAreas: top5, totalCandidates: items.length });
}
