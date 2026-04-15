import { z } from 'zod';
import { query } from '../db.js';
import { TEAM_AGENTS, CHECKPOINT_DATES } from '../constants.js';
import { toolResult, ragStatus } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const checkpointSummarySchema = {
  env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
};

interface MetricCell {
  value: number | null;
  rag: 'green' | 'amber' | 'red' | null;
}

type PeriodKey = 'day0' | 'day1' | 'day15' | 'day30' | 'wtd' | 'mtd';

interface MetricRow {
  metric: string;
  target: number | null;
  lowerIsBetter: boolean;
  periods: Record<PeriodKey, MetricCell>;
}

function getMonday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function getFirstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function checkpointSummary(args: { env: string }): Promise<CallToolResult> {
  const agentList = TEAM_AGENTS.join("','");

  const periodRanges: Record<PeriodKey, { start: string; end: string }> = {
    day0: { start: CHECKPOINT_DATES.day0, end: CHECKPOINT_DATES.day0 },
    day1: { start: CHECKPOINT_DATES.day1, end: CHECKPOINT_DATES.day1 },
    day15: { start: CHECKPOINT_DATES.day15, end: CHECKPOINT_DATES.day15 },
    day30: { start: CHECKPOINT_DATES.day30, end: CHECKPOINT_DATES.day30 },
    wtd: { start: getMonday(), end: today() },
    mtd: { start: getFirstOfMonth(), end: today() },
  };

  const metrics: MetricRow[] = [
    { metric: 'FRT Compliance %', target: 90, lowerIsBetter: false, periods: {} as any },
    { metric: 'Resolution Compliance %', target: 85, lowerIsBetter: false, periods: {} as any },
    { metric: 'Team QA Average', target: 7.0, lowerIsBetter: false, periods: {} as any },
    { metric: 'Golden Rules Avg %', target: 70, lowerIsBetter: false, periods: {} as any },
    { metric: 'Total Queue Size', target: null, lowerIsBetter: true, periods: {} as any },
    { metric: 'Oldest Support Ticket', target: null, lowerIsBetter: true, periods: {} as any },
  ];

  // Initialize periods
  for (const m of metrics) {
    m.periods = {} as Record<PeriodKey, MetricCell>;
    for (const pk of Object.keys(periodRanges) as PeriodKey[]) {
      m.periods[pk] = { value: null, rag: null };
    }
  }

  for (const [pk, range] of Object.entries(periodRanges) as [PeriodKey, { start: string; end: string }][]) {
    // FRT Compliance
    const frtRows = await query<Array<{ kpi: string; totalCount: number }>>(
      `SELECT kpi, SUM([count]) AS totalCount
       FROM dbo.jira_kpi_daily
       WHERE (kpi LIKE 'FRT Met%' OR kpi LIKE 'FRT Breached%')
         AND CAST(CreatedAt AS DATE) BETWEEN @start AND @end
       GROUP BY kpi`,
      { start: range.start, end: range.end },
    );

    let frtMet = 0, frtBreached = 0;
    for (const r of frtRows) {
      if (r.kpi.toLowerCase().includes('met')) frtMet += r.totalCount;
      else frtBreached += r.totalCount;
    }
    const frtTotal = frtMet + frtBreached;
    if (frtTotal > 0) {
      const val = Math.round((frtMet / frtTotal) * 1000) / 10;
      metrics[0].periods[pk] = { value: val, rag: ragStatus(val, 90, false) };
    }

    // Resolution Compliance
    const resRows = await query<Array<{ kpi: string; totalCount: number }>>(
      `SELECT kpi, SUM([count]) AS totalCount
       FROM dbo.jira_kpi_daily
       WHERE (kpi LIKE 'Resolution Met%' OR kpi LIKE 'Resolution Breached%')
         AND CAST(CreatedAt AS DATE) BETWEEN @start AND @end
       GROUP BY kpi`,
      { start: range.start, end: range.end },
    );

    let resMet = 0, resBreached = 0;
    for (const r of resRows) {
      if (r.kpi.toLowerCase().includes('met')) resMet += r.totalCount;
      else resBreached += r.totalCount;
    }
    const resTotal = resMet + resBreached;
    if (resTotal > 0) {
      const val = Math.round((resMet / resTotal) * 1000) / 10;
      metrics[1].periods[pk] = { value: val, rag: ragStatus(val, 85, false) };
    }

    // Team QA Average
    const qaRows = await query<Array<{ avg: number }>>(
      `SELECT AVG(overallScore) AS avg
       FROM dbo.jira_qa_results
       WHERE assigneeName IN ('${agentList}')
         AND (qaType IS NULL OR qaType != 'excluded')
         AND CAST(CreatedAt AS DATE) BETWEEN @start AND @end`,
      { start: range.start, end: range.end },
    );
    if (qaRows[0]?.avg != null) {
      const val = Math.round(qaRows[0].avg * 100) / 100;
      metrics[2].periods[pk] = { value: val, rag: ragStatus(val, 7.0, false) };
    }

    // Golden Rules Avg %
    const grRows = await query<Array<{ avg: number }>>(
      `SELECT AVG((CAST(rule1Pass AS FLOAT) + CAST(rule2Pass AS FLOAT) + CAST(rule3Pass AS FLOAT)) / 3.0) * 100 AS avg
       FROM dbo.Jira_QA_GoldenRules
       WHERE Updater IN ('${agentList}')
         AND CAST(CreatedAt AS DATE) BETWEEN @start AND @end`,
      { start: range.start, end: range.end },
    );
    if (grRows[0]?.avg != null) {
      const val = Math.round(grRows[0].avg * 10) / 10;
      metrics[3].periods[pk] = { value: val, rag: ragStatus(val, 70, false) };
    }

    // Total Queue Size
    const queueRows = await query<Array<{ total: number }>>(
      `SELECT SUM([count]) AS total
       FROM dbo.jira_kpi_daily
       WHERE kpi LIKE 'Number of Tickets in%'
         AND CAST(CreatedAt AS DATE) = (
           SELECT MAX(CAST(CreatedAt AS DATE))
           FROM dbo.jira_kpi_daily
           WHERE kpi LIKE 'Number of Tickets in%'
             AND CAST(CreatedAt AS DATE) BETWEEN @start AND @end
         )`,
      { start: range.start, end: range.end },
    );
    if (queueRows[0]?.total != null) {
      metrics[4].periods[pk] = { value: queueRows[0].total, rag: null };
    }

    // Oldest Support Ticket
    const oldestRows = await query<Array<{ maxAge: number }>>(
      `SELECT MAX([count]) AS maxAge
       FROM dbo.jira_kpi_daily
       WHERE kpi LIKE 'Oldest actionable ticket%'
         AND CAST(CreatedAt AS DATE) = (
           SELECT MAX(CAST(CreatedAt AS DATE))
           FROM dbo.jira_kpi_daily
           WHERE kpi LIKE 'Oldest actionable ticket%'
             AND CAST(CreatedAt AS DATE) BETWEEN @start AND @end
         )`,
      { start: range.start, end: range.end },
    );
    if (oldestRows[0]?.maxAge != null) {
      metrics[5].periods[pk] = { value: oldestRows[0].maxAge, rag: null };
    }
  }

  // Build summary
  const changes: string[] = [];
  for (const m of metrics) {
    const d1 = m.periods.day1.value;
    const latest = m.periods.wtd.value ?? m.periods.mtd.value;
    if (d1 !== null && latest !== null) {
      const diff = latest - d1;
      if (Math.abs(diff) > 0.1) {
        const dir = (m.lowerIsBetter ? diff < 0 : diff > 0) ? 'improved' : 'worsened';
        changes.push(`${m.metric} ${dir} from ${d1} to ${latest}`);
      }
    }
  }

  const summary = `Checkpoint summary across the 90-day framework. ` +
    `${changes.length > 0 ? `Since Day 1: ${changes.join('; ')}.` : 'No significant movement since Day 1.'}`;

  return toolResult(summary, {
    periodDates: periodRanges,
    matrix: metrics.map(m => ({
      metric: m.metric,
      target: m.target,
      ...m.periods,
    })),
  });
}
