import { z } from 'zod';
import { apiGet, getEnv } from '../auth.js';
import { toolResult, toolError, mean } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const slaBreakdownSchema = {
  tier: z
    .enum(['customer_care', 'production', 'tier2', 'tier3', 'development', 'all'])
    .default('all')
    .describe('Tier filter (default all)'),
  days: z.number().default(30).describe('Number of days to look back (default 30, max 90)'),
};

const TIER_LABELS: Record<string, string> = {
  customer_care: 'Customer Care',
  production: 'Production',
  tier2: 'Tier 2',
  tier3: 'Tier 3',
  development: 'Development',
  all: 'All',
};

interface DailyRow {
  kpi: string;
  kpiGroup?: string;
  count: number;
  CreatedAt: string;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export async function slaBreakdown(args: { tier: string; days: number }): Promise<CallToolResult> {
  const { tier } = args;
  const days = Math.min(Math.max(args.days, 1), 90);
  const env = getEnv();
  const tierLabel = TIER_LABELS[tier] ?? 'All';
  const tierSuffix = tier === 'all' ? '(All)' : `(${tierLabel})`;
  const tierNeedle = tierSuffix.toLowerCase();

  let history: DailyRow[];
  try {
    history = await apiGet<DailyRow[]>('/api/kpi-data/daily-history', { env, days });
  } catch (err) {
    return toolError(`Failed to fetch daily-history: ${err instanceof Error ? err.message : err}`);
  }

  const nowMs = Date.now();
  const halfCutoff = nowMs - Math.floor(days / 2) * 86400_000;

  // FRT Met/Breached for this tier
  const frtRows = history.filter(
    (r) =>
      (r.kpi?.toLowerCase().startsWith('frt met ') || r.kpi?.toLowerCase().startsWith('frt breached ')) &&
      r.kpi.toLowerCase().includes(tierNeedle),
  );
  let frtMet = 0;
  let frtBreached = 0;
  for (const r of frtRows) {
    if (r.kpi.toLowerCase().includes('met')) frtMet += n(r.count);
    else if (r.kpi.toLowerCase().includes('breach')) frtBreached += n(r.count);
  }
  const frtTotal = frtMet + frtBreached;
  const frtCompliance = frtTotal > 0 ? Math.round((frtMet / frtTotal) * 1000) / 10 : null;

  // Resolution Met/Breached for this tier
  const resRows = history.filter(
    (r) =>
      (r.kpi?.toLowerCase().startsWith('resolution met ') ||
        r.kpi?.toLowerCase().startsWith('resolution breached ')) &&
      r.kpi.toLowerCase().includes(tierNeedle),
  );
  let resMet = 0;
  let resBreached = 0;
  for (const r of resRows) {
    if (r.kpi.toLowerCase().includes('met')) resMet += n(r.count);
    else if (r.kpi.toLowerCase().includes('breach')) resBreached += n(r.count);
  }
  const resTotal = resMet + resBreached;
  const resCompliance = resTotal > 0 ? Math.round((resMet / resTotal) * 1000) / 10 : null;

  // Over-SLA counts across all tiers (matches any "over sla (actionable)")
  const overSlaMap = new Map<string, number[]>();
  for (const r of history) {
    if (!/over sla \(actionable\)/i.test(r.kpi)) continue;
    if (!overSlaMap.has(r.kpi)) overSlaMap.set(r.kpi, []);
    overSlaMap.get(r.kpi)!.push(n(r.count));
  }
  const overSlaRows = Array.from(overSlaMap.entries())
    .map(([kpi, vals]) => ({ kpi, avgCount: mean(vals) }))
    .sort((a, b) => b.avgCount - a.avgCount);

  // Escalation accuracy
  const escVals: number[] = [];
  for (const r of history) {
    if (/^escalation accuracy/i.test(r.kpi)) escVals.push(n(r.count));
  }
  const escalationAccuracy = escVals.length > 0 ? Math.round(mean(escVals) * 100) / 100 : null;

  // Trend: first half vs second half
  const halves: Record<'first' | 'second', { frtMet: number; frtBreached: number; resMet: number; resBreached: number }> = {
    first: { frtMet: 0, frtBreached: 0, resMet: 0, resBreached: 0 },
    second: { frtMet: 0, frtBreached: 0, resMet: 0, resBreached: 0 },
  };
  for (const r of history) {
    const t = new Date(r.CreatedAt).getTime();
    const half: 'first' | 'second' = t >= halfCutoff ? 'second' : 'first';
    const k = r.kpi ?? '';
    if (/^FRT Met/i.test(k)) halves[half].frtMet += n(r.count);
    else if (/^FRT Breached/i.test(k)) halves[half].frtBreached += n(r.count);
    else if (/^Resolution Met/i.test(k)) halves[half].resMet += n(r.count);
    else if (/^Resolution Breached/i.test(k)) halves[half].resBreached += n(r.count);
  }

  const trend: Record<string, { frtPct: number | null; resPct: number | null }> = {};
  for (const [half, vals] of Object.entries(halves)) {
    const frtT = vals.frtMet + vals.frtBreached;
    const resT = vals.resMet + vals.resBreached;
    trend[half] = {
      frtPct: frtT > 0 ? Math.round((vals.frtMet / frtT) * 1000) / 10 : null,
      resPct: resT > 0 ? Math.round((vals.resMet / resT) * 1000) / 10 : null,
    };
  }

  const summary =
    `SLA breakdown for ${tierLabel} (last ${days} days): ` +
    `FRT compliance ${frtCompliance !== null ? `${frtCompliance}%` : 'N/A'}, ` +
    `Resolution compliance ${resCompliance !== null ? `${resCompliance}%` : 'N/A'}. ` +
    `${
      overSlaRows.length > 0
        ? `Over-SLA avg: ${overSlaRows.map((r) => `${r.kpi}: ${r.avgCount.toFixed(1)}`).join(', ')}. `
        : ''
    }` +
    `Escalation accuracy: ${escalationAccuracy !== null ? escalationAccuracy : 'N/A'}. ` +
    `Trend: FRT ${trend.first?.frtPct ?? '?'}% → ${trend.second?.frtPct ?? '?'}%, ` +
    `Resolution ${trend.first?.resPct ?? '?'}% → ${trend.second?.resPct ?? '?'}%.`;

  return toolResult(summary, {
    tier: tierLabel,
    frt: { met: frtMet, breached: frtBreached, compliance: frtCompliance },
    resolution: { met: resMet, breached: resBreached, compliance: resCompliance },
    overSla: overSlaRows.map((r) => ({ kpi: r.kpi, avgCount: Math.round(r.avgCount * 100) / 100 })),
    escalationAccuracy,
    trend,
  });
}
