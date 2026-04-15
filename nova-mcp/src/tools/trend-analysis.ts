import { z } from 'zod';
import { apiGet, getEnv } from '../auth.js';
import { toolResult, toolError, mean, pctChange } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const trendAnalysisSchema = {
  metric: z.string().describe('KPI name or partial name to match (case-insensitive substring of `kpi` column)'),
  days: z.number().default(90).describe('Number of days to look back (default 90, max 90)'),
  granularity: z.enum(['daily', 'weekly']).default('weekly').describe('Time series granularity'),
};

interface DailyRow {
  kpi: string;
  kpiGroup?: string;
  count: number;
  target: number | null;
  direction: string | null;
  rag: string | null;
  CreatedAt: string;
}

export async function trendAnalysis(args: {
  metric: string;
  days: number;
  granularity: 'daily' | 'weekly';
}): Promise<CallToolResult> {
  const { metric, granularity } = args;
  const days = Math.min(Math.max(args.days, 1), 90);

  let all: DailyRow[];
  try {
    all = await apiGet<DailyRow[]>('/api/kpi-data/daily-history', { env: getEnv(), days });
  } catch (err) {
    return toolError(`Failed to fetch daily-history: ${err instanceof Error ? err.message : err}`);
  }

  const needle = metric.toLowerCase();
  const rows = all
    .filter((r) => (r.kpi ?? '').toLowerCase().includes(needle))
    .sort((a, b) => new Date(a.CreatedAt).getTime() - new Date(b.CreatedAt).getTime());

  if (rows.length === 0) {
    return toolError(`No data found for KPI matching "${metric}" in the last ${days} days.`);
  }

  const kpiName = rows[0].kpi;
  const target = rows.find((r) => r.target != null)?.target ?? null;
  const direction = rows[0].direction ?? 'higher is better';
  const lowerIsBetter = direction.toLowerCase().includes('lower');

  // Build time series by granularity
  const buckets = new Map<string, number[]>();

  for (const row of rows) {
    const d = new Date(row.CreatedAt);
    let key: string;
    if (granularity === 'daily') {
      key = d.toISOString().slice(0, 10);
    } else {
      // ISO week: use Monday of that week
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      key = monday.toISOString().slice(0, 10);
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(Number(row.count));
  }

  const timeSeries = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, values]) => ({
      period,
      value: Math.round(mean(values) * 100) / 100,
    }));

  const latest = timeSeries[timeSeries.length - 1];
  const previous = timeSeries.length >= 2 ? timeSeries[timeSeries.length - 2] : null;
  const wowChange = previous ? pctChange(latest.value, previous.value) : null;

  const last4 = timeSeries.slice(-4).map((t) => t.value);
  const rollingAvg = Math.round(mean(last4) * 100) / 100;

  let improving: boolean | null = null;
  if (previous) {
    const delta = latest.value - previous.value;
    improving = lowerIsBetter ? delta < 0 : delta > 0;
  }

  const breachPeriods: { start: string; end: string }[] = [];
  if (target !== null) {
    let breachStart: string | null = null;
    for (const point of timeSeries) {
      const breached = lowerIsBetter ? point.value > target : point.value < target;
      if (breached && !breachStart) {
        breachStart = point.period;
      } else if (!breached && breachStart) {
        breachPeriods.push({ start: breachStart, end: point.period });
        breachStart = null;
      }
    }
    if (breachStart) {
      breachPeriods.push({ start: breachStart, end: latest.period });
    }
  }

  const trendDir = improving === true ? 'improving' : improving === false ? 'degrading' : 'stable';
  const summary =
    `"${kpiName}" over the last ${days} days: latest value ${latest.value}${target !== null ? ` (target: ${target})` : ''}. ` +
    `${granularity === 'weekly' ? 'Week' : 'Day'}-over-${granularity === 'weekly' ? 'week' : 'day'} change: ${
      wowChange !== null ? `${wowChange > 0 ? '+' : ''}${wowChange.toFixed(1)}%` : 'N/A'
    }. 4-period rolling avg: ${rollingAvg}. Trend is ${trendDir} vs target.${
      breachPeriods.length > 0 ? ` ${breachPeriods.length} breach period(s) detected.` : ' No breaches detected.'
    }`;

  return toolResult(summary, {
    kpiName,
    target,
    direction,
    timeSeries,
    wowChange: wowChange !== null ? Math.round(wowChange * 100) / 100 : null,
    rollingAvg4Period: rollingAvg,
    improving,
    breachPeriods,
  });
}
