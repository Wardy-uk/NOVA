import { z } from 'zod';
import { query } from '../db.js';
import { toolResult, toolError, mean } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const slaBreakdownSchema = {
  tier: z.enum(['customer_care', 'production', 'tier2', 'tier3', 'development', 'all'])
    .default('all')
    .describe('Tier filter (default all)'),
  days: z.number().default(30).describe('Number of days to look back (default 30)'),
};

const TIER_LABELS: Record<string, string> = {
  customer_care: 'Customer Care',
  production: 'Production',
  tier2: 'Tier 2',
  tier3: 'Tier 3',
  development: 'Development',
  all: 'All',
};

export async function slaBreakdown(args: {
  tier: string;
  days: number;
}): Promise<CallToolResult> {
  const { tier, days } = args;
  const tierLabel = TIER_LABELS[tier] ?? 'All';
  const tierSuffix = tier === 'all' ? '(All)' : `(${tierLabel})`;

  // FRT compliance
  const frtRows = await query<Array<{ kpi: string; totalCount: number }>>(
    `SELECT kpi, SUM([count]) AS totalCount
     FROM dbo.jira_kpi_daily
     WHERE (kpi LIKE 'FRT Met ${tierSuffix}%' OR kpi LIKE 'FRT Breached ${tierSuffix}%')
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())
     GROUP BY kpi`,
    { days },
  );

  let frtMet = 0, frtBreached = 0;
  for (const row of frtRows) {
    if (row.kpi.toLowerCase().includes('met')) frtMet = row.totalCount;
    else if (row.kpi.toLowerCase().includes('breach')) frtBreached = row.totalCount;
  }
  const frtTotal = frtMet + frtBreached;
  const frtCompliance = frtTotal > 0 ? Math.round((frtMet / frtTotal) * 1000) / 10 : null;

  // Resolution compliance
  const resRows = await query<Array<{ kpi: string; totalCount: number }>>(
    `SELECT kpi, SUM([count]) AS totalCount
     FROM dbo.jira_kpi_daily
     WHERE (kpi LIKE 'Resolution Met ${tierSuffix}%' OR kpi LIKE 'Resolution Breached ${tierSuffix}%')
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())
     GROUP BY kpi`,
    { days },
  );

  let resMet = 0, resBreached = 0;
  for (const row of resRows) {
    if (row.kpi.toLowerCase().includes('met')) resMet = row.totalCount;
    else if (row.kpi.toLowerCase().includes('breach')) resBreached = row.totalCount;
  }
  const resTotal = resMet + resBreached;
  const resCompliance = resTotal > 0 ? Math.round((resMet / resTotal) * 1000) / 10 : null;

  // Over-SLA counts
  const overSlaRows = await query<Array<{ kpi: string; avgCount: number }>>(
    `SELECT kpi, AVG([count]) AS avgCount
     FROM dbo.jira_kpi_daily
     WHERE kpi LIKE '%over sla (actionable)%'
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())
     GROUP BY kpi
     ORDER BY AVG([count]) DESC`,
    { days },
  );

  // Escalation accuracy
  const escRows = await query<Array<{ kpi: string; avgCount: number }>>(
    `SELECT kpi, AVG([count]) AS avgCount
     FROM dbo.jira_kpi_daily
     WHERE kpi LIKE 'Escalation Accuracy%'
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())
     GROUP BY kpi`,
    { days },
  );

  const escalationAccuracy = escRows.length > 0
    ? Math.round(escRows[0].avgCount * 100) / 100
    : null;

  // Trend: first half vs second half
  const halfDays = Math.floor(days / 2);
  const trendRows = await query<Array<{ half: string; frtMet: number; frtBreached: number; resMet: number; resBreached: number }>>(
    `SELECT
       CASE WHEN CreatedAt >= DATEADD(day, -@halfDays, GETDATE()) THEN 'second' ELSE 'first' END AS half,
       SUM(CASE WHEN kpi LIKE 'FRT Met%' THEN [count] ELSE 0 END) AS frtMet,
       SUM(CASE WHEN kpi LIKE 'FRT Breached%' THEN [count] ELSE 0 END) AS frtBreached,
       SUM(CASE WHEN kpi LIKE 'Resolution Met%' THEN [count] ELSE 0 END) AS resMet,
       SUM(CASE WHEN kpi LIKE 'Resolution Breached%' THEN [count] ELSE 0 END) AS resBreached
     FROM dbo.jira_kpi_daily
     WHERE CreatedAt >= DATEADD(day, -@days, GETDATE())
     GROUP BY CASE WHEN CreatedAt >= DATEADD(day, -@halfDays, GETDATE()) THEN 'second' ELSE 'first' END`,
    { days, halfDays },
  );

  const trend: Record<string, { frtPct: number | null; resPct: number | null }> = {};
  for (const row of trendRows) {
    const frtT = row.frtMet + row.frtBreached;
    const resT = row.resMet + row.resBreached;
    trend[row.half] = {
      frtPct: frtT > 0 ? Math.round((row.frtMet / frtT) * 1000) / 10 : null,
      resPct: resT > 0 ? Math.round((row.resMet / resT) * 1000) / 10 : null,
    };
  }

  const summary = `SLA breakdown for ${tierLabel} (last ${days} days): ` +
    `FRT compliance ${frtCompliance !== null ? `${frtCompliance}%` : 'N/A'}, ` +
    `Resolution compliance ${resCompliance !== null ? `${resCompliance}%` : 'N/A'}. ` +
    `${overSlaRows.length > 0 ? `Over-SLA avg: ${overSlaRows.map(r => `${r.kpi}: ${r.avgCount.toFixed(1)}`).join(', ')}. ` : ''}` +
    `Escalation accuracy: ${escalationAccuracy !== null ? escalationAccuracy : 'N/A'}. ` +
    `Trend: FRT ${trend.first?.frtPct ?? '?'}% → ${trend.second?.frtPct ?? '?'}%, ` +
    `Resolution ${trend.first?.resPct ?? '?'}% → ${trend.second?.resPct ?? '?'}%.`;

  return toolResult(summary, {
    tier: tierLabel,
    frt: { met: frtMet, breached: frtBreached, compliance: frtCompliance },
    resolution: { met: resMet, breached: resBreached, compliance: resCompliance },
    overSla: overSlaRows.map(r => ({ kpi: r.kpi, avgCount: Math.round(r.avgCount * 100) / 100 })),
    escalationAccuracy,
    trend,
  });
}
