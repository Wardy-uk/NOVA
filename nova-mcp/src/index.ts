import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { novaGet, novaPost, novaPut, novaDelete } from './api-client.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const server = new McpServer({
  name: 'nova',
  version: '4.0.0',
});

function num(v: unknown, fallback: number): number {
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (typeof v === 'string') { const n = parseInt(v, 10); if (!isNaN(n)) return n; }
  return fallback;
}

// ── Helpers ──────────────────────────────────────────────────────────

interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data: T;
  error?: string;
}

async function api<T = unknown>(path: string, params?: Record<string, string | number>): Promise<T> {
  const res = await novaGet<ApiEnvelope<T>>(path, params);
  if (!res.ok) throw new Error(res.error || `API call failed: GET ${path}`);
  return res.data;
}

async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await novaPost<ApiEnvelope<T>>(path, body);
  if (!res.ok) throw new Error(res.error || `API call failed: POST ${path}`);
  return res.data;
}

async function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await novaPut<ApiEnvelope<T>>(path, body);
  if (!res.ok) throw new Error(res.error || `API call failed: PUT ${path}`);
  return res.data;
}

async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await novaDelete<ApiEnvelope<T>>(path);
  if (!res.ok) throw new Error(res.error || `API call failed: DELETE ${path}`);
  return res.data;
}

function toolResult(summary: string, data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ summary, data, generatedAt: new Date().toISOString() }, null, 2) }],
  };
}

function toolError(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return Math.sqrt(values.map(v => (v - avg) ** 2).reduce((a, b) => a + b, 0) / values.length);
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function ragStatus(value: number, target: number, lowerIsBetter: boolean): 'green' | 'amber' | 'red' {
  if (lowerIsBetter) {
    if (value <= target) return 'green';
    if (value <= target * 1.1) return 'amber';
    return 'red';
  }
  if (value >= target) return 'green';
  if (value >= target * 0.9) return 'amber';
  return 'red';
}

// The NOVA KPI endpoints cap `days`, but honour an uncapped from/to range.
// Prefer from/to whenever both are supplied so long lookbacks aren't clamped.
function rangeParams(days: number, fallback: number, from?: string, to?: string): Record<string, string | number> {
  return from && to ? { from, to } : { days: num(days, fallback) };
}

function rangeLabel(days: number, fallback: number, from?: string, to?: string): string {
  return from && to ? `${from} → ${to}` : `the last ${num(days, fallback)} days`;
}

// Key names alone do not identify a secret: `*_connection`/`*_url` values embed
// a password (`Password=...;`, `https://user:pw@host`) under a key name that
// matches no sensitive pattern. Redact on the value as well as the key.
const SECRET_KEY_RE = /token|password|secret|apikey|api_key|client_secret|credential|private_key|conn|connection|dsn|pass$/i;
const SECRET_VALUE_RE = /(password|pwd)\s*=|:\/\/[^/\s:@]+:[^/\s@]+@|^(sk|xox[baprs]|ghp|gho|github_pat|AKIA|ya29)[-_]/i;

function redactSecrets(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'string' && value.length > 0 && (SECRET_KEY_RE.test(key) || SECRET_VALUE_RE.test(value))) {
      out[key] = `[redacted, len ${value.length}]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function likeToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = escaped.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${regex}$`, 'i');
}

// ═════════════════════════════════════════════════════════════════════
// PART 1 — EXISTING KPI TOOLS (9)
// ═════════════════════════════════════════════════════════════════════

// 1. Trend Analysis
server.tool(
  'nova_trend_analysis',
  'Analyse a KPI trend over time. Returns time series, week-over-week change, rolling average, breach periods, and whether the metric is improving or degrading vs target.',
  {
    metric: z.string().describe('KPI name or SQL LIKE pattern (e.g. "%FRT%" matches all FRT metrics)'),
    days: z.number().default(90).describe('Lookback days (default 90). Ignored when from/to are given.'),
    from: z.string().optional().describe('Start date YYYY-MM-DD. Use with `to` for lookbacks beyond the days cap.'),
    to: z.string().optional().describe('End date YYYY-MM-DD. Use with `from`.'),
    granularity: z.enum(['daily', 'weekly']).default('weekly'),
  },
  async ({ metric, days, from, to, granularity }) => {
    try {
      const rows = await api<any[]>('/api/kpi-data/daily-history', rangeParams(days, 90, from, to));
      const re = likeToRegex(metric);
      const matched = rows.filter((r: any) => re.test(r.kpi || r.KPI || ''));

      if (matched.length === 0) {
        return toolResult(`No KPIs matching "${metric}" found in ${rangeLabel(days, 90, from, to)}`, { kpiName: metric, timeSeries: [] });
      }

      const byKpi = new Map<string, any[]>();
      for (const r of matched) {
        const name = r.kpi || r.KPI;
        if (!byKpi.has(name)) byKpi.set(name, []);
        byKpi.get(name)!.push(r);
      }

      const results = [];
      for (const [kpiName, entries] of byKpi) {
        entries.sort((a: any, b: any) => new Date(a.CreatedAt || a.createdAt).getTime() - new Date(b.CreatedAt || b.createdAt).getTime());
        const target = entries[0]?.target ?? entries[0]?.KPITarget ?? null;
        const direction = entries[0]?.direction ?? entries[0]?.KPIDirection ?? 'higher_is_better';
        const lowerIsBetter = direction === 'lower_is_better';

        let timeSeries: { period: string; value: number }[];
        if (granularity === 'weekly') {
          const weeks = new Map<string, number[]>();
          for (const e of entries) {
            const d = new Date(e.CreatedAt || e.createdAt);
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - d.getDay() + 1);
            const key = weekStart.toISOString().slice(0, 10);
            if (!weeks.has(key)) weeks.set(key, []);
            weeks.get(key)!.push(Number(e.count ?? e.Count ?? 0));
          }
          timeSeries = [...weeks.entries()].map(([period, vals]) => ({ period, value: Math.round(mean(vals) * 100) / 100 }));
        } else {
          timeSeries = entries.map((e: any) => ({
            period: (e.CreatedAt || e.createdAt || '').slice(0, 10),
            value: Number(e.count ?? e.Count ?? 0),
          }));
        }

        const values = timeSeries.map(t => t.value);
        const lastTwo = values.slice(-2);
        const wowChange = lastTwo.length === 2 ? pctChange(lastTwo[1], lastTwo[0]) : null;
        const last4 = values.slice(-4);
        const rollingAvg4Period = Math.round(mean(last4) * 100) / 100;

        let improving: boolean | null = null;
        if (target !== null && values.length >= 2) {
          const recentGap = Math.abs(values[values.length - 1] - target);
          const olderGap = Math.abs(values[Math.max(0, values.length - 4)] - target);
          improving = recentGap < olderGap;
        }

        const breachPeriods: { start: string; end: string }[] = [];
        if (target !== null) {
          let breachStart: string | null = null;
          for (const t of timeSeries) {
            const breached = lowerIsBetter ? t.value > target : t.value < target;
            if (breached && !breachStart) breachStart = t.period;
            if (!breached && breachStart) {
              breachPeriods.push({ start: breachStart, end: t.period });
              breachStart = null;
            }
          }
          if (breachStart) breachPeriods.push({ start: breachStart, end: timeSeries[timeSeries.length - 1].period });
        }

        results.push({ kpiName, target, direction, timeSeries, wowChange: wowChange !== null ? Math.round(wowChange * 100) / 100 : null, rollingAvg4Period, improving, breachPeriods });
      }

      return toolResult(
        `Trend analysis for ${results.length} KPI(s) matching "${metric}" over ${rangeLabel(days, 90, from, to)} (${granularity})`,
        results.length === 1 ? results[0] : results,
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// 2. Agent Comparison
server.tool(
  'nova_agent_comparison',
  'Compare all team agents on a given metric. Returns ranked list with team average, above/below flags, and outliers.',
  {
    metric: z.enum([
      'qa_score', 'qa_accuracy', 'qa_clarity', 'qa_tone', 'qa_tickets_scored', 'qa_red', 'qa_amber', 'qa_green',
      'golden_overall', 'golden_ownership', 'golden_next_action', 'golden_timeframe', 'golden_clarity', 'golden_empathy',
      'sla_resolved', 'sla_breached', 'sla_compliance',
      'csat_count', 'csat_average',
      'open_tickets', 'solved_today', 'over_2h', 'no_update',
    ]).describe('Metric to compare'),
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ metric, days }) => {
    try {
      let rankings: { agent: string; value: number }[];

      const qaMetrics: Record<string, string> = {
        qa_score: 'avgScore', qa_accuracy: 'avgAccuracy', qa_clarity: 'avgClarity', qa_tone: 'avgTone',
        qa_tickets_scored: 'ticketsScored', qa_red: 'redCount', qa_amber: 'amberCount', qa_green: 'greenCount',
      };
      const goldenMetrics: Record<string, string> = {
        golden_overall: 'avgScore', golden_ownership: 'avgRule1', golden_next_action: 'avgRule2',
        golden_timeframe: 'avgRule3', golden_clarity: 'avgRule4', golden_empathy: 'avgRule5',
      };
      const agentDailyMetrics: Record<string, string> = {
        sla_resolved: 'SLAResolvedCount', sla_breached: 'SLABreachedCount', sla_compliance: 'SLACompliancePct',
        csat_count: 'CSATCount', csat_average: 'CSATAverage',
      };

      if (qaMetrics[metric]) {
        const agents = await api<any[]>('/api/kpi-data/qa-agents', { days });
        const field = qaMetrics[metric];
        rankings = agents.map((a: any) => ({ agent: a.assigneeName, value: Number(a[field] || 0) }));
      } else if (goldenMetrics[metric]) {
        const agents = await api<any[]>('/api/kpi-data/qa-golden-agents', { days });
        const field = goldenMetrics[metric];
        rankings = agents.map((a: any) => ({ agent: a.agentName || a.assigneeName || a.agent, value: Number(a[field] || 0) }));
      } else if (agentDailyMetrics[metric]) {
        const rows = await api<any[]>('/api/kpi-data/agent-daily', { days });
        const field = agentDailyMetrics[metric];
        const byAgent = new Map<string, number[]>();
        for (const r of rows) {
          const name = r.agent_name || r.AgentName;
          if (!name) continue;
          if (!byAgent.has(name)) byAgent.set(name, []);
          byAgent.get(name)!.push(Number(r[field] ?? 0));
        }
        rankings = [...byAgent.entries()].map(([agent, vals]) => ({ agent, value: Math.round(mean(vals) * 100) / 100 }));
      } else {
        const agentKpis = await api<any[]>('/api/kpi-data/agent-kpis', { days });
        const colMap: Record<string, string> = {
          open_tickets: 'OpenTickets_Total',
          solved_today: 'SolvedTickets_Today',
          over_2h: 'OpenTickets_Over2Hours',
          no_update: 'OpenTickets_NoUpdateToday',
        };
        const col = colMap[metric];
        const byAgent = new Map<string, number[]>();
        for (const r of agentKpis) {
          const name = r.AgentName || r.agentName;
          if (!name) continue;
          if (!byAgent.has(name)) byAgent.set(name, []);
          byAgent.get(name)!.push(Number(r[col] ?? 0));
        }
        rankings = [...byAgent.entries()].map(([agent, vals]) => ({ agent, value: Math.round(mean(vals) * 100) / 100 }));
      }

      const values = rankings.map(r => r.value);
      const teamAverage = Math.round(mean(values) * 100) / 100;
      const sd = stddev(values);

      const lowerIsBetter = ['open_tickets', 'over_2h', 'no_update', 'sla_breached', 'qa_red'].includes(metric);
      rankings.sort((a, b) => lowerIsBetter ? a.value - b.value : b.value - a.value);

      const rankedList = rankings.map((r, i) => ({
        rank: i + 1,
        agent: r.agent,
        value: r.value,
        status: Math.abs(r.value - teamAverage) < sd * 0.25 ? 'at_average' as const : (lowerIsBetter ? r.value < teamAverage : r.value > teamAverage) ? 'above_average' as const : 'below_average' as const,
        isOutlier: Math.abs(r.value - teamAverage) > sd * 1.5,
      }));

      return toolResult(
        `Agent comparison on ${metric} over ${days} days — team avg ${teamAverage}, ${rankedList.filter(r => r.isOutlier).length} outlier(s)`,
        { metric, days, teamAverage, standardDeviation: Math.round(sd * 100) / 100, rankings: rankedList, outliers: rankedList.filter(r => r.isOutlier).map(r => r.agent) },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// 3. Focus Areas
server.tool(
  'nova_focus_areas',
  'Cross-reference KPIs, QA scores, Golden Rules, and SLA to surface the top 5 areas needing attention, each with severity, metric, target, gap, and recommended action.',
  {
    days: z.number().default(14).describe('Lookback days (default 14)'),
  },
  async ({ days }) => {
    try {
      const [snapshot, qaAgents, goldenSummary] = await Promise.all([
        api<any[]>('/api/kpi-data/team-snapshot'),
        api<any[]>('/api/kpi-data/qa-agents', { days }),
        api<any>('/api/kpi-data/qa-golden-summary', { days }),
      ]);

      const candidates: { severity: 'red' | 'amber'; area: string; metric: number; target: number | null; gap: number | null; action: string }[] = [];

      for (const kpi of snapshot) {
        const val = Number(kpi.Count ?? kpi.count ?? 0);
        const target = Number(kpi.KPITarget ?? kpi.target ?? 0);
        const rag = (kpi.RAG || kpi.rag || '').toLowerCase();
        if (rag === 'red') {
          candidates.push({ severity: 'red', area: kpi.KPI || kpi.kpi, metric: val, target, gap: target ? Math.round((target - val) * 100) / 100 : null, action: `${kpi.KPI || kpi.kpi} is RED — immediate attention needed` });
        } else if (rag === 'amber') {
          candidates.push({ severity: 'amber', area: kpi.KPI || kpi.kpi, metric: val, target, gap: target ? Math.round((target - val) * 100) / 100 : null, action: `${kpi.KPI || kpi.kpi} is AMBER — monitor closely` });
        }
      }

      for (const agent of qaAgents) {
        const avg = Number(agent.avgScore || 0);
        if (avg > 0 && avg < 7.0) {
          candidates.push({ severity: avg < 5.0 ? 'red' : 'amber', area: `QA: ${agent.assigneeName}`, metric: avg, target: 7.0, gap: Math.round((7.0 - avg) * 100) / 100, action: `${agent.assigneeName} QA avg ${avg.toFixed(1)} — coaching recommended` });
        }
      }

      if (goldenSummary) {
        for (const [rule, label] of [['avgRule1', 'Ownership'], ['avgRule2', 'Next Action'], ['avgRule3', 'Timeframe']] as const) {
          const pct = Number(goldenSummary[rule] ?? 0);
          if (pct > 0 && pct < 70) {
            candidates.push({ severity: pct < 50 ? 'red' : 'amber', area: `Golden Rule: ${label}`, metric: pct, target: 70, gap: Math.round(70 - pct), action: `${label} pass rate ${pct.toFixed(0)}% — below 70% threshold` });
          }
        }
      }

      candidates.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'red' ? -1 : 1;
        return (Math.abs(b.gap ?? 0)) - (Math.abs(a.gap ?? 0));
      });

      const top5 = candidates.slice(0, 5);
      return toolResult(
        `${top5.length} focus area(s) identified from ${candidates.length} candidates over ${days} days`,
        { focusAreas: top5, totalCandidates: candidates.length },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// 4. QA Deep Dive
server.tool(
  'nova_qa_deep_dive',
  'Deep QA analysis: score distribution, dimension averages, category breakdown, concerning tickets, Golden Rules pass rates, and coaching priorities. Optional agent filter.',
  {
    agent: z.string().optional().describe('Filter to a specific agent name (omit for whole team)'),
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ agent, days }) => {
    try {
      const params: Record<string, string | number> = { days, limit: 200 };
      if (agent) params.agent = agent;

      const [qaResults, qaSummary, goldenSummary, qaAgents] = await Promise.all([
        api<any>('/api/kpi-data/qa-results', params),
        api<any>('/api/kpi-data/qa-summary', { days }),
        api<any>('/api/kpi-data/qa-golden-summary', { days }),
        api<any[]>('/api/kpi-data/qa-agents', { days }),
      ]);

      const items = qaResults?.items || qaResults?.results || (Array.isArray(qaResults) ? qaResults : []);

      const distribution: Record<string, { count: number; pct: number }> = { GREEN: { count: 0, pct: 0 }, AMBER: { count: 0, pct: 0 }, RED: { count: 0, pct: 0 } };
      const dimensions = { overall: 0, accuracy: 0, clarity: 0, tone: 0 };
      const dimCounts = { overall: 0, accuracy: 0, clarity: 0, tone: 0 };
      const categories = new Map<string, { total: number; count: number }>();
      const concerning: any[] = [];

      for (const item of items) {
        const grade = (item.grade || '').toUpperCase();
        if (distribution[grade]) distribution[grade].count++;
        for (const dim of ['overall', 'accuracy', 'clarity', 'tone'] as const) {
          const key = `${dim}Score` as string;
          const val = Number(item[key] ?? 0);
          if (val > 0) { dimensions[dim] += val; dimCounts[dim]++; }
        }
        const cat = item.category || 'Uncategorised';
        if (!categories.has(cat)) categories.set(cat, { total: 0, count: 0 });
        const c = categories.get(cat)!;
        c.total += Number(item.overallScore ?? 0);
        c.count++;
        if (item.isConcerning) concerning.push({ issueKey: item.issueKey, overallScore: item.overallScore, assigneeName: item.assigneeName });
      }

      const total = items.length || 1;
      for (const g of Object.keys(distribution)) distribution[g].pct = Math.round((distribution[g].count / total) * 100);
      for (const dim of Object.keys(dimensions) as (keyof typeof dimensions)[]) {
        dimensions[dim] = dimCounts[dim] ? Math.round((dimensions[dim] / dimCounts[dim]) * 100) / 100 : 0;
      }

      const categoryBreakdown = [...categories.entries()].map(([category, { total: t, count }]) => ({ category, avgScore: Math.round((t / count) * 100) / 100, cnt: count })).sort((a, b) => a.avgScore - b.avgScore);

      const coachingPriority = Object.entries(dimensions).filter(([, v]) => v > 0).sort(([, a], [, b]) => a - b).map(([dimension, score]) => ({ dimension, score }));

      let vsTeam: Record<string, { agent: number; team: number }> | null = null;
      if (agent) {
        const agentData = qaAgents.find((a: any) => a.assigneeName === agent);
        if (agentData) {
          const teamAvgs = { overall: mean(qaAgents.map((a: any) => Number(a.avgScore || 0))) };
          vsTeam = { overall: { agent: Number(agentData.avgScore || 0), team: Math.round(teamAvgs.overall * 100) / 100 } };
        }
      }

      return toolResult(
        `QA deep dive for ${agent || 'all agents'} — ${items.length} reviews over ${days} days, ${concerning.length} concerning`,
        {
          agent: agent || 'all',
          totalScored: items.length,
          distribution,
          dimensions,
          categoryBreakdown,
          concerningTickets: { count: concerning.length, issues: concerning.slice(0, 20) },
          goldenRules: goldenSummary ? {
            totalChecks: goldenSummary.total || 0,
            rule1_ownership: goldenSummary.avgRule1 ?? 0,
            rule2_nextAction: goldenSummary.avgRule2 ?? 0,
            rule3_timeframe: goldenSummary.avgRule3 ?? 0,
            averageScore: goldenSummary.avgScore ?? 0,
          } : null,
          vsTeam,
          coachingPriority,
        },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// 5. SLA Breakdown
server.tool(
  'nova_sla_breakdown',
  'SLA compliance analysis: FRT and Resolution compliance percentages, over-SLA counts, escalation accuracy, and trend. Filterable by tier.',
  {
    tier: z.enum(['customer_care', 'production', 'tier2', 'tier3', 'development', 'all']).default('all').describe('Tier filter'),
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ tier, days }) => {
    try {
      const rows = await api<any[]>('/api/kpi-data/daily-history', { days });

      const tierSuffix = tier === 'all' ? '' : (() => {
        const map: Record<string, string> = { customer_care: '_CC', production: '_Prod', tier2: '_T2', tier3: '_T3', development: '_Dev' };
        return map[tier] || '';
      })();

      const kpiMap = new Map<string, number[]>();
      for (const r of rows) {
        const name = r.kpi || r.KPI || '';
        if (!kpiMap.has(name)) kpiMap.set(name, []);
        kpiMap.get(name)!.push(Number(r.count ?? r.Count ?? 0));
      }

      const avg = (name: string) => {
        const vals = kpiMap.get(name) || [];
        return vals.length ? Math.round(mean(vals) * 100) / 100 : null;
      };

      const frtMet = avg(`FRT Met${tierSuffix}`) ?? 0;
      const frtBreached = avg(`FRT Breached${tierSuffix}`) ?? 0;
      const resMet = avg(`Resolution Met${tierSuffix}`) ?? 0;
      const resBreached = avg(`Resolution Breached${tierSuffix}`) ?? 0;

      const frtCompliance = (frtMet + frtBreached) > 0 ? Math.round((frtMet / (frtMet + frtBreached)) * 10000) / 100 : null;
      const resCompliance = (resMet + resBreached) > 0 ? Math.round((resMet / (resMet + resBreached)) * 10000) / 100 : null;

      const overSlaKpis = [...kpiMap.entries()]
        .filter(([name]) => name.toLowerCase().includes('over') && name.toLowerCase().includes('sla'))
        .map(([kpi, vals]) => ({ kpi, avgCount: Math.round(mean(vals) * 100) / 100 }));

      const escalationAccuracy = avg('Escalation Accuracy');

      return toolResult(
        `SLA breakdown for ${tier} over ${days} days — FRT ${frtCompliance ?? 'N/A'}%, Resolution ${resCompliance ?? 'N/A'}%`,
        { tier, frt: { met: frtMet, breached: frtBreached, compliance: frtCompliance }, resolution: { met: resMet, breached: resBreached, compliance: resCompliance }, overSla: overSlaKpis, escalationAccuracy },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// 6. Checkpoint Summary
server.tool(
  'nova_checkpoint_summary',
  'Live vs UAT data comparison — row counts, latest dates, and extras per KPI table. Use to verify data integrity between environments.',
  {
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ env }) => {
    try {
      const comparison = await api<any>('/api/kpi-data/comparison');
      return toolResult(
        `Checkpoint comparison for ${env} environment`,
        comparison,
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// 7. Raw KPI Query
server.tool(
  'nova_raw_kpi_query',
  'Low-level query: fetch KPI daily data matching a LIKE pattern. Returns raw time series grouped by KPI name.',
  {
    kpi_pattern: z.string().describe('SQL LIKE pattern (e.g. "%FRT%")'),
    days: z.number().default(30).describe('Lookback days (default 30). Ignored when from/to are given.'),
    from: z.string().optional().describe('Start date YYYY-MM-DD. Use with `to` for lookbacks beyond the days cap.'),
    to: z.string().optional().describe('End date YYYY-MM-DD. Use with `from`.'),
  },
  async ({ kpi_pattern, days, from, to }) => {
    try {
      const rows = await api<any[]>('/api/kpi-data/daily-history', rangeParams(days, 30, from, to));
      const re = likeToRegex(kpi_pattern);
      const matched = rows.filter((r: any) => re.test(r.kpi || r.KPI || ''));

      const kpis: Record<string, { date: string; value: number; target: number | null; rag: string | null }[]> = {};
      for (const r of matched) {
        const name = r.kpi || r.KPI;
        if (!kpis[name]) kpis[name] = [];
        kpis[name].push({
          date: (r.CreatedAt || r.createdAt || '').slice(0, 10),
          value: Number(r.count ?? r.Count ?? 0),
          target: r.target ?? r.KPITarget ?? null,
          rag: r.rag ?? r.RAG ?? null,
        });
      }

      return toolResult(
        `Raw KPI query: ${Object.keys(kpis).length} KPI(s) matching "${kpi_pattern}" over ${days} days, ${matched.length} total rows`,
        { pattern: kpi_pattern, days, totalRows: matched.length, kpis },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// 8. Admin — read config
server.tool(
  'nova_admin_get_config',
  'Read NOVA settings. Returns a masked view of all settings keys (tokens/passwords redacted). Optional regex filter on key names.',
  {
    key_pattern: z.string().optional().describe('JS regex to filter key names (e.g. "jira|mcp")'),
    unmask: z.boolean().default(false).describe('Show actual values instead of masked (use with care)'),
  },
  async ({ key_pattern, unmask }) => {
    try {
      const settings = await api<Record<string, any>>('/api/settings');

      let entries = Object.entries(settings);
      if (key_pattern) {
        const re = new RegExp(key_pattern, 'i');
        entries = entries.filter(([k]) => re.test(k));
      }

      const sensitivePattern = /token|password|secret|apikey|api_key|client_secret|pass$/i;
      const emailPattern = /email|username|user|_user/i;

      const masked: Record<string, any> = {};
      for (const [key, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
        if (!unmask && typeof value === 'string' && value.length > 0) {
          // Key name OR value shape — a connection string hides a password under
          // a key that matches no sensitive name pattern.
          if (sensitivePattern.test(key) || SECRET_KEY_RE.test(key) || SECRET_VALUE_RE.test(value)) {
            masked[key] = `XXXX…XXXX (len ${value.length})`;
            continue;
          }
          if (emailPattern.test(key) && value.includes('@')) {
            const [user, domain] = value.split('@');
            masked[key] = `${user[0]}***@${domain}`;
            continue;
          }
        }
        masked[key] = value === '' || value === null || value === undefined ? '(unset)' : value;
      }

      return toolResult(
        `${entries.length} setting(s)${key_pattern ? ` matching /${key_pattern}/` : ''} — ${unmask ? 'UNMASKED' : 'masked'}`,
        { keyCount: entries.length, totalKeys: Object.keys(settings).length, filter: key_pattern || '(none)', unmask, settings: masked },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// 9. Admin — write a single setting
server.tool(
  'nova_admin_set_setting',
  'Write a single NOVA setting. Dry-run by default — pass confirm: true to apply. Blocked for sensitive keys (tokens, passwords, SSO, roles).',
  {
    key: z.string().describe('Setting key name'),
    value: z.string().describe('New value'),
    confirm: z.boolean().default(false).describe('false = dry-run preview, true = actually write'),
  },
  async ({ key, value, confirm }) => {
    try {
      const denylist = /token|password|secret|apikey|api_key|client_secret|jira_username|jira_ob_email|custom_roles|role_permissions|^sso_|smtp_pass/i;
      if (denylist.test(key)) {
        return toolError(`Key "${key}" is on the write denylist — change it via the Admin UI`);
      }

      const settings = await api<Record<string, any>>('/api/settings');
      const before = settings[key] ?? '(unset)';

      if (!confirm) {
        return toolResult(
          `DRY RUN — would change "${key}" from "${before}" to "${value}". Pass confirm: true to apply.`,
          { key, before, after: value, changed: before !== value, confirm: false },
        );
      }

      await apiPut(`/api/settings/${encodeURIComponent(key)}`, { value });
      return toolResult(
        `Setting "${key}" updated successfully`,
        { key, before, after: value, changed: true, confirm: true },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════════
// PART 2 — AI AGENT TOOLS (20)
// ═════════════════════════════════════════════════════════════════════

// ── Query Tools (13) ─────────────────────────────────────────────────

server.tool(
  'nova_agent_status',
  'Get the AI agent loop status — running/stopped/paused, health check, weekend override, and high-level stats.',
  {},
  async () => {
    try {
      const [status, health, stats] = await Promise.all([
        api<any>('/api/agent/status'),
        api<any>('/api/agent/health'),
        api<any>('/api/agent/stats'),
      ]);
      return toolResult(
        `Agent status: ${status?.state || status?.status || 'unknown'}`,
        { status, health, stats },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_decisions',
  'Get AI agent decision history — triage, respond, escalate actions with confidence scores and approval status.',
  {
    limit: z.number().default(50).describe('Max results (default 50, max 200)'),
    offset: z.number().default(0).describe('Pagination offset'),
    ticket_key: z.string().optional().describe('Filter to a specific ticket key'),
  },
  async ({ limit, offset, ticket_key }) => {
    try {
      if (ticket_key) {
        const decisions = await api<any>(`/api/agent/decisions/ticket/${encodeURIComponent(ticket_key)}`);
        return toolResult(`Decisions for ${ticket_key}`, decisions);
      }
      const decisions = await api<any>('/api/agent/decisions', { limit: Math.min(limit, 200), offset });
      return toolResult(`${Array.isArray(decisions) ? decisions.length : 'N/A'} decisions retrieved`, decisions);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_costs',
  'Get AI agent LLM cost breakdown — total spend, cost by model, cost by mode (shadow/live), and daily trend.',
  {
    days: z.number().default(30).describe('Lookback days (default 30, max 365)'),
  },
  async ({ days }) => {
    try {
      const [costs, trend, byMode, pricing] = await Promise.all([
        api<any>('/api/agent/costs', { days: Math.min(days, 365) }),
        api<any>('/api/agent/costs/trend').catch(() => null),
        api<any>('/api/agent/costs/by-mode', { days: Math.min(days, 365) }).catch(() => null),
        api<any>('/api/agent/costs/pricing').catch(() => null),
      ]);
      return toolResult(`AI agent costs over ${days} days`, { costs, trend, byMode, pricing });
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_flagged',
  'Get flagged (high-risk) tickets — risk scores, summary stats, and score distribution.',
  {
    include_summary: z.boolean().default(true).describe('Include summary stats and distribution'),
  },
  async ({ include_summary }) => {
    try {
      const flagged = await api<any>('/api/agent/flagged');
      let summary = null;
      let distribution = null;
      if (include_summary) {
        [summary, distribution] = await Promise.all([
          api<any>('/api/agent/flagged/summary').catch(() => null),
          api<any>('/api/agent/flagged/score-distribution').catch(() => null),
        ]);
      }
      return toolResult(
        `${Array.isArray(flagged) ? flagged.length : 'N/A'} flagged tickets`,
        { flagged, summary, distribution },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_approvals',
  'Get pending AI agent approvals — actions awaiting human review before execution.',
  {
    status: z.enum(['pending', 'approved', 'declined', 'all']).default('pending').describe('Filter by status'),
  },
  async ({ status }) => {
    try {
      const params: Record<string, string> = {};
      if (status !== 'all') params.status = status;
      const approvals = await api<any>('/api/approvals', params);
      const stats = await api<any>('/api/approvals/stats').catch(() => null);
      return toolResult(
        `Approvals (${status})`,
        { approvals, stats },
      );
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_coaching',
  'Get coaching scores and nudge history — team-wide or per-agent QA coaching metrics.',
  {
    agent_id: z.string().optional().describe('Agent user ID for individual coaching (omit for team)'),
    days: z.number().default(30).describe('Lookback days (default 30, max 90)'),
  },
  async ({ agent_id, days }) => {
    try {
      const d = Math.min(days, 90);
      if (agent_id) {
        const [agentCoaching, nudges] = await Promise.all([
          api<any>(`/api/agent/coaching/agent/${encodeURIComponent(agent_id)}`, { days: d }),
          api<any>('/api/agent/coaching/nudges', { agentUserId: agent_id, limit: 50 }),
        ]);
        return toolResult(`Coaching for agent ${agent_id} over ${d} days`, { coaching: agentCoaching, nudges });
      }
      const [team, nudges] = await Promise.all([
        api<any>('/api/agent/coaching/team', { days: d }),
        api<any>('/api/agent/coaching/nudges', { limit: 50 }),
      ]);
      return toolResult(`Team coaching over ${d} days`, { team, nudges });
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_kb_gaps',
  'Get knowledge base gaps detected by the AI agent — missing articles grouped by category with frequency counts.',
  {
    status: z.enum(['open', 'article_drafted', 'article_published', 'dismissed']).default('open').describe('Gap status filter'),
    limit: z.number().default(100).describe('Max results (default 100, max 500)'),
  },
  async ({ status, limit }) => {
    try {
      const [gaps, counts] = await Promise.all([
        api<any>('/api/agent/kb-gaps', { status, limit: Math.min(limit, 500) }),
        api<any>('/api/agent/kb-gaps/counts'),
      ]);
      return toolResult(`KB gaps (${status}): ${Array.isArray(gaps) ? gaps.length : 'N/A'} results`, { gaps, counts });
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_alerts',
  'Get AI agent alerts — anomalies, threshold breaches, and system warnings.',
  {
    limit: z.number().default(50).describe('Max results (default 50, max 200)'),
    include_acknowledged: z.boolean().default(false).describe('Include already acknowledged alerts'),
  },
  async ({ limit, include_acknowledged }) => {
    try {
      const alerts = await api<any>('/api/agent/alerts', {
        limit: Math.min(limit, 200),
        ...(include_acknowledged ? { includeAcknowledged: 'true' } : {}),
      });
      return toolResult(`${Array.isArray(alerts) ? alerts.length : 'N/A'} alerts`, alerts);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_lifecycle',
  'Get ticket lifecycle breakdown — how many tickets are in each state (pending approval, awaiting customer, etc.) plus approval health metrics.',
  {},
  async () => {
    try {
      const [breakdown, approvalHealth, settings] = await Promise.all([
        api<any>('/api/agent/lifecycle/breakdown'),
        api<any>('/api/agent/lifecycle/approval-health'),
        api<any>('/api/agent/lifecycle/settings'),
      ]);
      return toolResult('Ticket lifecycle breakdown', { breakdown, approvalHealth, settings });
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_providers',
  'Get LLM provider usage stats — which models are being used, success/failure rates, latency.',
  {
    days: z.number().default(7).describe('Lookback days (default 7, max 90)'),
  },
  async ({ days }) => {
    try {
      const providers = await api<any>('/api/agent/providers', { days: Math.min(days, 90) });
      return toolResult(`Provider usage over ${days} days`, providers);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_suggestions',
  'Get AI-generated suggestions for guardrail and autonomy rule improvements.',
  {
    type: z.enum(['guardrail', 'autonomy', 'all']).default('all').describe('Suggestion type filter'),
    status: z.enum(['pending', 'applied', 'dismissed', 'all']).default('pending').describe('Status filter'),
  },
  async ({ type, status }) => {
    try {
      const params: Record<string, string> = {};
      if (type !== 'all') params.type = type;
      if (status !== 'all') params.status = status;
      const suggestions = await api<any>('/api/agent/suggestions', params);
      return toolResult(`Suggestions (${type}, ${status})`, suggestions);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_guardrails',
  'Get all guardrail rules — safety checks that block or warn before agent actions execute.',
  {},
  async () => {
    try {
      const guardrails = await api<any>('/api/agent/guardrails');
      return toolResult(`${Array.isArray(guardrails) ? guardrails.length : 'N/A'} guardrail rules`, guardrails);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_autonomy',
  'Get autonomy rules — conditions under which the agent can act without human approval.',
  {},
  async () => {
    try {
      const rules = await api<any>('/api/agent/autonomy');
      return toolResult(`${Array.isArray(rules) ? rules.length : 'N/A'} autonomy rules`, rules);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// ── Action Tools (7) ─────────────────────────────────────────────────

server.tool(
  'nova_agent_start',
  'Start the AI agent loop. Requires super_admin credentials.',
  {},
  async () => {
    try {
      const result = await apiPost<any>('/api/agent/start');
      return toolResult('Agent started', result);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_stop',
  'Stop the AI agent loop. Requires super_admin credentials.',
  {},
  async () => {
    try {
      const result = await apiPost<any>('/api/agent/stop');
      return toolResult('Agent stopped', result);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_pause',
  'Pause the AI agent loop (can be resumed). Requires super_admin credentials.',
  {},
  async () => {
    try {
      const result = await apiPost<any>('/api/agent/pause');
      return toolResult('Agent paused', result);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_approve',
  'Approve a pending AI agent action. Optionally edit the response before approving.',
  {
    approval_id: z.string().describe('The approval ID to approve'),
    edited_response: z.string().optional().describe('Optionally edit the agent response before approving'),
  },
  async ({ approval_id, edited_response }) => {
    try {
      const body: Record<string, any> = { action: 'approve' };
      if (edited_response) body.editedResponse = edited_response;
      const result = await apiPost<any>(`/api/approvals/${encodeURIComponent(approval_id)}/decide`, body);
      return toolResult(`Approval ${approval_id} approved`, result);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_decline',
  'Decline a pending AI agent action with a reason.',
  {
    approval_id: z.string().describe('The approval ID to decline'),
    reason: z.string().optional().describe('Reason for declining'),
  },
  async ({ approval_id, reason }) => {
    try {
      const body: Record<string, any> = { action: 'decline' };
      if (reason) body.declineReason = reason;
      const result = await apiPost<any>(`/api/approvals/${encodeURIComponent(approval_id)}/decide`, body);
      return toolResult(`Approval ${approval_id} declined`, result);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_dismiss_flag',
  'Dismiss a flagged (high-risk) ticket after review.',
  {
    ticket_key: z.string().describe('Jira ticket key to dismiss (e.g. "NT-12345")'),
  },
  async ({ ticket_key }) => {
    try {
      const result = await apiPost<any>(`/api/agent/flagged/${encodeURIComponent(ticket_key)}/review`, { dismiss: true });
      return toolResult(`Flag dismissed for ${ticket_key}`, result);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_agent_setting',
  'Update an AI agent lifecycle setting (e.g. approval timeout, auto-approve threshold, awaiting customer hours).',
  {
    key: z.string().describe('Setting key (e.g. "agent_approval_timeout_mins", "agent_auto_approve_threshold")'),
    value: z.union([z.string(), z.number(), z.boolean()]).describe('New value'),
    confirm: z.boolean().default(false).describe('false = dry-run, true = apply'),
  },
  async ({ key, value, confirm }) => {
    try {
      const current = await api<Record<string, any>>('/api/agent/lifecycle/settings');
      const before = current[key] ?? '(unset)';

      if (!confirm) {
        return toolResult(
          `DRY RUN — would change "${key}" from ${JSON.stringify(before)} to ${JSON.stringify(value)}. Pass confirm: true to apply.`,
          { key, before, after: value, confirm: false },
        );
      }

      const result = await apiPut<any>('/api/agent/lifecycle/settings', { [key]: value });
      return toolResult(`Agent setting "${key}" updated`, { key, before, after: value, confirm: true, result });
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════════
// MI Report tools
// ═════════════════════════════════════════════════════════════════════

server.tool(
  'nova_mi_report',
  'Retrieve the full monthly Management Information (MI) report for the support department. Returns: service performance (FRT/resolution compliance by tier, FCR, CSAT, tickets opened), escalation health (FRT breach counts), backlog health (opened vs resolved, net change, aging buckets by tier and request type), development review queue (accepted, returned, queue depth, decision time, aged backlog), and top products by ticket volume. Data updates as new MI sections are added to NOVA — this tool always returns the complete current dataset.',
  {
    month: z.string().default('').describe('Month in YYYY-MM format (defaults to current month)'),
  },
  async ({ month }) => {
    try {
      const m = month || new Date().toISOString().slice(0, 7);
      const data = await api<any>('/api/board-mi/monthly', { month: m });
      return toolResult(`MI report for ${data.label || m}${data.isMtd ? ' (MTD)' : ''}`, data);
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

server.tool(
  'nova_mi_commentary',
  'Read or write the monthly MI commentary narrative. Use action "read" to retrieve the current commentary for a given month, or "write" to save/update it. The commentary is the free-text management narrative that accompanies the MI report.',
  {
    month: z.string().describe('Month in YYYY-MM format'),
    action: z.enum(['read', 'write']).default('read').describe('"read" to fetch, "write" to save'),
    text: z.string().optional().describe('Commentary content (required when action is "write")'),
  },
  async ({ month, action, text }) => {
    try {
      if (action === 'write') {
        if (!text) return toolError('text is required when action is "write"');
        await apiPost<any>('/api/board-mi/commentary', { month, content: text });
        return toolResult(`Commentary saved for ${month}`, { month, saved: true });
      }
      const data = await api<any>('/api/board-mi/monthly', { month });
      return toolResult(`Commentary for ${month}`, { month, commentary: data.commentary });
    } catch (err: any) {
      return toolError(err.message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════════
// PART 3 — BACKLOG TOOLS (6)
// ═════════════════════════════════════════════════════════════════════

interface BacklogColumn { id: number; title: string; sort_order: number; color: string | null; item_count?: number }
interface BacklogItem { id: number; column_id: number; title: string; description: string | null; wp_ref: string | null; effort: string | null; type: string | null; priority: number; created_by: string | null; completed_at: string | null; blocked_reason: string | null }

async function resolveColumn(name: string): Promise<BacklogColumn> {
  const cols = await api<BacklogColumn[]>('/api/backlog/columns');
  const col = cols.find(c => c.title.toLowerCase() === name.toLowerCase());
  if (!col) throw new Error(`No column matching "${name}". Available: ${cols.map(c => c.title).join(', ')}`);
  return col;
}

async function resolveItem(idOrTitle: string | number): Promise<BacklogItem> {
  if (typeof idOrTitle === 'number' || /^\d+$/.test(String(idOrTitle))) {
    const item = await api<BacklogItem>(`/api/backlog/items/${idOrTitle}`);
    return item;
  }
  const wpMatch = String(idOrTitle).match(/^WP-?\d+$/i);
  if (wpMatch) {
    const all = await api<BacklogItem[]>('/api/backlog/items');
    const item = all.find(i => i.wp_ref?.toLowerCase() === String(idOrTitle).toLowerCase());
    if (item) return item;
  }
  const all = await api<BacklogItem[]>('/api/backlog/items');
  const matches = all.filter(i => i.title.toLowerCase().includes(String(idOrTitle).toLowerCase()));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Multiple items match "${idOrTitle}": ${matches.map(i => `#${i.id} "${i.title}"`).join(', ')}. Use the numeric ID to be specific.`);
  throw new Error(`No item found matching "${idOrTitle}"`);
}

// 1. List backlog
server.tool(
  'nova_backlog_list',
  'List all backlog items grouped by column. Optionally filter by column name or item type.',
  {
    column: z.string().optional().describe('Filter by column title (e.g. "In Progress")'),
    type: z.string().optional().describe('Filter by item type (e.g. "code", "manual", "bugfix")'),
  },
  async ({ column, type }) => {
    try {
      const [cols, items] = await Promise.all([
        api<BacklogColumn[]>('/api/backlog/columns'),
        api<BacklogItem[]>('/api/backlog/items'),
      ]);
      let filtered = items;
      if (column) {
        const col = cols.find(c => c.title.toLowerCase() === column.toLowerCase());
        if (!col) return toolError(`No column "${column}". Available: ${cols.map(c => c.title).join(', ')}`);
        filtered = filtered.filter(i => i.column_id === col.id);
      }
      if (type) filtered = filtered.filter(i => i.type === type);

      const grouped = cols.map(c => ({
        column: c.title,
        color: c.color,
        items: filtered.filter(i => i.column_id === c.id).sort((a, b) => a.priority - b.priority).map(i => ({
          id: i.id, title: i.title, wp_ref: i.wp_ref, effort: i.effort, type: i.type,
          blocked: i.blocked_reason || undefined,
        })),
      })).filter(g => g.items.length > 0);

      const lines = grouped.map(g => `## ${g.column} (${g.items.length})\n${g.items.map(i =>
        `  - ${i.wp_ref ? `[${i.wp_ref}] ` : ''}${i.title}${i.effort ? ` (${i.effort})` : ''}${i.type ? ` [${i.type}]` : ''}${i.blocked ? ` ⚠ BLOCKED: ${i.blocked}` : ''}`
      ).join('\n')}`).join('\n\n');

      return toolResult(`${filtered.length} backlog items across ${grouped.length} columns`, { summary: lines, total: filtered.length });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 2. Add backlog item
server.tool(
  'nova_backlog_add',
  'Add a new item to the product backlog.',
  {
    title: z.string().describe('Item title'),
    column: z.string().default('Backlog').describe('Column to add to (default: Backlog)'),
    description: z.string().optional().describe('Markdown description'),
    wp_ref: z.string().optional().describe('Work package reference (e.g. "WP-15")'),
    effort: z.string().optional().describe('Effort estimate (e.g. "2-4hr", "Half day")'),
    type: z.string().optional().describe('Type: code, manual, workshop, monitoring, research, infrastructure, bugfix'),
  },
  async ({ title, column, description, wp_ref, effort, type }) => {
    try {
      const col = await resolveColumn(column);
      const item = await apiPost<BacklogItem>('/api/backlog/items', {
        column_id: col.id, title, description, wp_ref, effort, type,
      });
      return toolResult(`Created "${title}" in ${col.title}`, { item });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 3. Update backlog item
server.tool(
  'nova_backlog_update',
  'Update fields on a backlog item. Look up by ID, WP ref, or title.',
  {
    item: z.union([z.string(), z.number()]).describe('Item ID, WP ref (e.g. "WP-15"), or title substring'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description (markdown)'),
    wp_ref: z.string().optional().describe('New WP ref'),
    effort: z.string().optional().describe('New effort estimate'),
    type: z.string().optional().describe('New type'),
    blocked_reason: z.string().optional().describe('Blocked reason (empty string to clear)'),
  },
  async ({ item: lookup, ...fields }) => {
    try {
      const resolved = await resolveItem(lookup);
      const updates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) { if (v !== undefined) updates[k] = v; }
      if (Object.keys(updates).length === 0) return toolError('No fields to update — provide at least one field');
      const updated = await apiPut<BacklogItem>(`/api/backlog/items/${resolved.id}`, updates);
      return toolResult(`Updated "${resolved.title}"`, { item: updated });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 4. Move backlog item to a column
server.tool(
  'nova_backlog_move',
  'Move a backlog item to a different column (e.g. "In Progress", "Done").',
  {
    item: z.union([z.string(), z.number()]).describe('Item ID, WP ref, or title substring'),
    column: z.string().describe('Target column title'),
    priority: z.number().optional().describe('Position within column (0 = top)'),
  },
  async ({ item: lookup, column, priority }) => {
    try {
      const resolved = await resolveItem(lookup);
      const col = await resolveColumn(column);
      const moved = await apiPut<BacklogItem>(`/api/backlog/items/${resolved.id}/move`, {
        column_id: col.id, priority,
      });
      return toolResult(`Moved "${resolved.title}" → ${col.title}`, { item: moved });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 5. Remove backlog item
server.tool(
  'nova_backlog_remove',
  'Delete a backlog item permanently.',
  {
    item: z.union([z.string(), z.number()]).describe('Item ID, WP ref, or title substring'),
  },
  async ({ item: lookup }) => {
    try {
      const resolved = await resolveItem(lookup);
      await apiDelete(`/api/backlog/items/${resolved.id}`);
      return toolResult(`Deleted "${resolved.title}" (was #${resolved.id})`, { deleted: resolved });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 6. Manage backlog columns
server.tool(
  'nova_backlog_columns',
  'List, add, rename, or delete backlog columns.',
  {
    action: z.enum(['list', 'add', 'rename', 'delete', 'reorder']).default('list').describe('Action to perform'),
    title: z.string().optional().describe('Column title (for add/rename/delete)'),
    new_title: z.string().optional().describe('New title (for rename)'),
    color: z.string().optional().describe('Hex colour (for add/rename)'),
    order: z.array(z.string()).optional().describe('Column titles in desired order (for reorder)'),
  },
  async ({ action, title, new_title, color, order }) => {
    try {
      if (action === 'list') {
        const cols = await api<BacklogColumn[]>('/api/backlog/columns');
        const lines = cols.map(c => `${c.sort_order + 1}. **${c.title}** — ${c.item_count ?? 0} items${c.color ? ` (${c.color})` : ''}`).join('\n');
        return toolResult(`${cols.length} columns`, { summary: lines, columns: cols });
      }
      if (action === 'add') {
        if (!title) return toolError('title required for add');
        const col = await apiPost<BacklogColumn>('/api/backlog/columns', { title, color });
        return toolResult(`Created column "${title}"`, { column: col });
      }
      if (action === 'rename') {
        if (!title || !new_title) return toolError('title and new_title required for rename');
        const col = await resolveColumn(title);
        const updated = await apiPut<BacklogColumn>(`/api/backlog/columns/${col.id}`, { title: new_title, color });
        return toolResult(`Renamed "${title}" → "${new_title}"`, { column: updated });
      }
      if (action === 'delete') {
        if (!title) return toolError('title required for delete');
        const col = await resolveColumn(title);
        await apiDelete(`/api/backlog/columns/${col.id}`);
        return toolResult(`Deleted column "${title}"`, { deleted: col });
      }
      if (action === 'reorder') {
        if (!order || order.length === 0) return toolError('order array required for reorder');
        const cols = await api<BacklogColumn[]>('/api/backlog/columns');
        const ids = order.map(t => {
          const c = cols.find(x => x.title.toLowerCase() === t.toLowerCase());
          if (!c) throw new Error(`No column "${t}"`);
          return c.id;
        });
        await apiPut('/api/backlog/columns/reorder', { columnIds: ids });
        return toolResult(`Reordered columns: ${order.join(' → ')}`, { order });
      }
      return toolError(`Unknown action: ${action}`);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ═════════════════════════════════════════════════════════════════════
// Part 5 — AI Learning Feedback
// ═════════════════════════════════════════════════════════════════════

server.tool(
  'nova_agent_submit_learning',
  `Submit a learning/correction to improve the AI agent's future responses. Provide the ticket key, the AI's draft response (optional), and the lesson learned.`,
  {
    ticket_key: z.string().describe('Jira ticket key (e.g. NT-17647)'),
    ai_draft: z.string().optional().describe('The AI draft response that needs correction'),
    learning: z.string().describe('The lesson or correction for the AI to learn'),
    category: z.string().optional().describe('Ticket category (e.g. Data Feed, Portal, CRM) — helps match learnings to future tickets'),
    organisation: z.string().optional().describe('Customer organisation name — scopes learnings to that customer'),
    tags: z.array(z.string()).optional().describe('Tags for categorising this learning (e.g. ["tone", "product-knowledge", "brand-awareness"])'),
  },
  async ({ ticket_key, ai_draft, learning, category, organisation, tags }) => {
    try {
      const result = await apiPost<{ id: number }>('/api/ai-learnings', {
        ticket_key, ai_draft, learning, category, organisation, tags,
      });
      return toolResult(`Learning #${result.id} submitted for ${ticket_key}`, {
        id: result.id,
        ticket_key,
        learning,
        category: category ?? null,
        organisation: organisation ?? null,
      });
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_learnings',
  `List active AI learnings/corrections. These are human-submitted lessons that guide the AI agent's responses.`,
  {
    category: z.string().optional().describe('Filter by ticket category'),
    active: z.boolean().optional().default(true).describe('Filter by active status (default: true)'),
    limit: z.number().optional().default(20).describe('Max results to return'),
  },
  async ({ category, active, limit }) => {
    try {
      const params: Record<string, string | number> = { limit };
      if (active !== undefined) params.active = String(active);
      if (category) params.category = category;

      const result = await api<{ learnings: any[]; total: number }>('/api/ai-learnings', params);
      const lines = result.learnings.map((l: any) =>
        `- #${l.id} [${l.ticket_key}]${l.category ? ` (${l.category})` : ''}${l.organisation ? ` — ${l.organisation}` : ''}: ${l.learning.slice(0, 150)}${l.learning.length > 150 ? '...' : ''}`
      ).join('\n');

      return toolResult(`${result.total} learnings (showing ${result.learnings.length})`, {
        summary: lines || 'No learnings found.',
        total: result.total,
        learnings: result.learnings,
      });
    } catch (err: any) { return toolError(err.message); }
  },
);

// ═════════════════════════════════════════════════════════════════════
// PART 6 — FULL COVERAGE TOOLS (16)
// ═════════════════════════════════════════════════════════════════════

// ── KPI Data Tools (4) ───────────────────────────────────────────────

server.tool(
  'nova_team_snapshot',
  'Get the current live KPI snapshot for the entire support team. Returns every tracked KPI with its current value, target, direction (higher/lower is better), and category. Use this for "what are the numbers right now?" questions. For historical trends, use nova_trend_analysis instead.',
  {
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ env }) => {
    try {
      const data = await api<any>('/api/kpi-data/team-snapshot', { env });
      return toolResult(`Team KPI snapshot (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_eod_snapshot',
  'Get the end-of-day KPI snapshot for a specific date. Returns all KPI values as they were at close of business on that date. Useful for comparing specific days or investigating incidents.',
  {
    date: z.string().describe('Date in YYYY-MM-DD format'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ date, env }) => {
    try {
      const data = await api<any>('/api/kpi-data/eod-snapshot', { env, date });
      return toolResult(`EOD snapshot for ${date} (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_daily',
  'Get per-agent daily KPI time series. Returns daily values for each agent including volume (open tickets, solved), QA scores (overall, accuracy, clarity, tone), Golden Rules (all 5 dimensions), SLA (resolved, breached, compliance %), and CSAT. Supports filtering to a single agent. Use for individual agent trend analysis or identifying performance changes over time.',
  {
    days: z.number().default(30).describe('Lookback days (default 30). Ignored when from/to are given.'),
    from: z.string().optional().describe('Start date YYYY-MM-DD. Use with `to` for lookbacks beyond the days cap.'),
    to: z.string().optional().describe('End date YYYY-MM-DD. Use with `from`.'),
    agent: z.string().optional().describe('Filter to specific agent name'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ days, from, to, agent, env }) => {
    try {
      const data = await api<any[]>('/api/kpi-data/agent-daily', { env, ...rangeParams(days, 30, from, to) });
      const filtered = agent
        ? data.filter((r: any) => (r.agent_name || r.AgentName || '').toLowerCase() === agent.toLowerCase())
        : data;
      return toolResult(
        `Agent daily data: ${filtered.length} rows over ${rangeLabel(days, 30, from, to)}${agent ? ` for ${agent}` : ''} (${env})`,
        filtered,
      );
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_leaderboard',
  'Get the current agent leaderboard — live stats for all agents including open ticket count, tickets solved today/this week, availability status, and latest QA scores. Use for a quick overview of team capacity and performance right now.',
  {
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ env }) => {
    try {
      const data = await api<any>('/api/kpi-data/agents', { env });
      return toolResult(`Agent leaderboard (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── QA Tools (4) ─────────────────────────────────────────────────────

server.tool(
  'nova_qa_results',
  'Get individual ticket QA scores with full dimension breakdown (overall, accuracy, clarity, tone). Paginated. Use for reviewing specific ticket quality, finding low-scoring tickets, or building per-ticket QA reports. For aggregated QA analysis, use nova_qa_deep_dive instead.',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
    page: z.number().default(1).describe('Page number (default 1)'),
    limit: z.number().default(25).describe('Results per page (default 25, max 100)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ days, page, limit, env }) => {
    try {
      const data = await api<any>('/api/kpi-data/qa-results', { env, days, page, limit: Math.min(limit, 100) });
      return toolResult(`QA results page ${page} (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_qa_agents',
  'Get QA scores broken down by agent — average overall score, dimension scores (accuracy, clarity, tone), tickets scored count, and red/amber/green distribution per agent. Use for agent-level QA comparison and identifying coaching needs.',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ days, env }) => {
    try {
      const data = await api<any>('/api/kpi-data/qa-agents', { env, days });
      return toolResult(`QA agents breakdown over ${days} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_golden_rules',
  'Get Golden Rules data — the 5-dimension quality framework (clarity, empathy, action, ownership, overall). Three views: "summary" for aggregate pass rates, "results" for individual ticket pass/fail (paginated), "agents" for per-agent pass rates. Use for coaching prioritisation and quality standards tracking.',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
    view: z.enum(['summary', 'results', 'agents']).default('summary').describe('View mode'),
    page: z.number().default(1).describe('Page number (used when view=results)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ days, view, page, env }) => {
    try {
      let data: any;
      if (view === 'summary') {
        data = await api<any>('/api/kpi-data/qa-golden-summary', { env, days });
      } else if (view === 'results') {
        data = await api<any>('/api/kpi-data/qa-golden-results', { env, days, page });
      } else {
        data = await api<any>('/api/kpi-data/qa-golden-agents', { env, days });
      }
      return toolResult(`Golden Rules (${view}) over ${days} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_kpi_digest',
  'Get the AI-generated KPI digest narrative — a natural language summary of current KPI performance, trends, and notable changes. Generated nightly by NOVA\'s analysis pipeline.',
  {
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ env }) => {
    try {
      const data = await api<any>('/api/kpi-data/digest', { env });
      return toolResult(`KPI digest (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── Trend Tools (4) ──────────────────────────────────────────────────

server.tool(
  'nova_sla_trend',
  'Get SLA compliance trend over time — FRT and Resolution compliance percentages by tier, trended daily or weekly. Use for spotting SLA degradation patterns, preparing MI commentary, or comparing current vs historical compliance. For a point-in-time SLA snapshot, use nova_sla_breakdown instead.',
  {
    days: z.number().default(90).describe('Lookback days (default 90)'),
    granularity: z.enum(['daily', 'weekly']).default('weekly').describe('Granularity'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ days, granularity, env }) => {
    try {
      const data = await api<any>('/api/trends/sla', { env, days, granularity });
      return toolResult(`SLA trend (${granularity}) over ${days} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_queue_trend',
  'Get queue volume trend over time — ticket counts by tier (Customer Care, Production, Tier 2, Tier 3, Development) trended daily or weekly. Shows opened, resolved, and net change. Use for capacity planning, spotting volume spikes, and backlog growth analysis.',
  {
    days: z.number().default(90).describe('Lookback days (default 90)'),
    granularity: z.enum(['daily', 'weekly']).default('weekly').describe('Granularity'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ days, granularity, env }) => {
    try {
      const data = await api<any>('/api/trends/queue', { env, days, granularity });
      return toolResult(`Queue trend (${granularity}) over ${days} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_qa_trend',
  'Get QA score trend over time — overall scores and dimension averages (accuracy, clarity, tone) trended daily or weekly. Optionally filter to a single agent. Use for tracking quality improvement over time or comparing agent progress.',
  {
    days: z.number().default(90).describe('Lookback days (default 90)'),
    granularity: z.enum(['daily', 'weekly']).default('weekly').describe('Granularity'),
    agent: z.string().default('all').describe('Agent name filter (default "all")'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ days, granularity, agent, env }) => {
    try {
      const data = await api<any>('/api/trends/qa', { env, days, granularity, agent });
      return toolResult(`QA trend (${granularity}) over ${days} days${agent !== 'all' ? ` for ${agent}` : ''} (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_escalation_trend',
  'Get escalation trend over time — escalation counts by tier, escalation accuracy percentage, and trend. Use for monitoring whether escalation quality is improving and identifying training needs.',
  {
    days: z.number().default(90).describe('Lookback days (default 90)'),
    granularity: z.enum(['daily', 'weekly']).default('weekly').describe('Granularity'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
  },
  async ({ days, granularity, env }) => {
    try {
      const data = await api<any>('/api/trends/escalation', { env, days, granularity });
      return toolResult(`Escalation trend (${granularity}) over ${days} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── Operational Tools (4) ────────────────────────────────────────────

server.tool(
  'nova_backlog',
  'Read the NOVA backlog board. "board" view returns all columns and items grouped by column (Kanban layout). "item" view returns a single item with full description. Use for checking what\'s in the backlog, finding items by title, or reviewing item details.',
  {
    view: z.enum(['board', 'item']).default('board').describe('View mode'),
    item_id: z.number().optional().describe('Item ID (used when view=item)'),
  },
  async ({ view, item_id }) => {
    try {
      if (view === 'item') {
        if (!item_id) return toolError('item_id required when view=item');
        const item = await api<any>(`/api/backlog/items/${item_id}`);
        return toolResult(`Backlog item #${item_id}`, item);
      }
      const [cols, items] = await Promise.all([
        api<any[]>('/api/backlog/columns'),
        api<any[]>('/api/backlog/items'),
      ]);
      return toolResult(`Backlog board: ${cols.length} columns, ${items.length} items`, { columns: cols, items });
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_manager_overview',
  'Get the manager dashboard overview — team-wide stats including queue health, agent availability, workload distribution, and key alerts. Use for a quick manager\'s-eye view of how the team is performing right now.',
  {},
  async () => {
    try {
      const data = await api<any>('/api/agent/manager/overview');
      return toolResult('Manager overview', data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_coaching_prep',
  'Generate AI-powered 1-2-1 coaching prep for an agent, or create a point-in-time snapshot. "generate" produces a prep pack with QA trends, Golden Rules performance, volume stats, and suggested coaching topics. "snapshot" saves the current data as a 1-2-1 record. Use before 1-2-1 meetings.',
  {
    agent_name: z.string().describe('Agent name'),
    action: z.enum(['generate', 'snapshot']).default('generate').describe('Action: generate prep or save snapshot'),
  },
  async ({ agent_name, action }) => {
    try {
      const endpoint = action === 'generate'
        ? `/api/people/agent/${encodeURIComponent(agent_name)}/generate-prep`
        : `/api/people/agent/${encodeURIComponent(agent_name)}/snapshot`;
      const data = await apiPost<any>(endpoint);
      return toolResult(`Coaching ${action} for ${agent_name}`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_hygiene_status',
  'Get the current queue hygiene status — which hygiene checks are due, which have passed, and what needs attention. Hygiene checks cover things like stale tickets, unassigned items, and SLA-at-risk tickets.',
  {},
  async () => {
    try {
      const data = await api<any>('/api/agent/hygiene/status');
      return toolResult('Queue hygiene status', data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ═════════════════════════════════════════════════════════════════════
// PART 7 — RAW DATA ACCESS TOOLS (34)
// ═════════════════════════════════════════════════════════════════════

// ── KPI Data Gaps (8) ────────────────────────────────────────────────

server.tool(
  'nova_kpi_agent_detail',
  'Get detailed per-agent KPI metrics including all tracked fields. More comprehensive than nova_agent_leaderboard — returns the full agent-kpis dataset with every metric field. Use for deep agent performance analysis and data completeness audits.',
  {
    agent: z.string().optional().describe('Filter to specific agent name'),
    days: z.number().default(30).describe('Lookback days (default 30). Ignored when from/to are given.'),
    from: z.string().optional().describe('Start date YYYY-MM-DD. Use with `to` for lookbacks beyond the days cap.'),
    to: z.string().optional().describe('End date YYYY-MM-DD. Use with `from`.'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ agent, days, from, to, env }) => {
    try {
      const data = await api<any[]>('/api/kpi-data/agent-kpis', { env, ...rangeParams(days, 30, from, to) });
      const filtered = agent ? data.filter((r: any) => (r.AgentName || r.agentName || '').toLowerCase() === agent.toLowerCase()) : data;
      return toolResult(`Agent KPI detail: ${filtered.length} rows over ${rangeLabel(days, 30, from, to)}${agent ? ` for ${agent}` : ''} (${env})`, filtered);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_kpi_qa_scores',
  'Get raw QA score data — individual ticket scores before any aggregation. Use for data quality audits, verifying QA scoring consistency, and identifying scoring anomalies.',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
    agent: z.string().optional().describe('Filter to specific agent'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ days, agent, env }) => {
    try {
      const params: Record<string, string | number> = { env, days: num(days, 30) };
      if (agent) params.agent = agent;
      const data = await api<any>('/api/kpi-data/qa-scores', params);
      return toolResult(`Raw QA scores over ${num(days, 30)} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_kpi_team',
  'Get team-wide aggregate KPI data — overall team metrics that aren\'t broken down by agent. Use for team-level reporting, MI preparation, and verifying that team aggregates match the sum of individual agent data.',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ days, env }) => {
    try {
      const data = await api<any>('/api/public/wallboard/team-kpis', { env, days: num(days, 30) });
      return toolResult(`Team KPIs over ${num(days, 30)} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_kpi_breached',
  'Get SLA-breached tickets — tickets that missed FRT or Resolution SLA targets. Returns ticket keys, breach type, time-to-breach, agent, tier. Use for SLA investigation, identifying patterns in breaches, and coaching data.',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ days, env }) => {
    try {
      const data = await api<any>('/api/public/wallboard/breached', { env, days: num(days, 30) });
      return toolResult(`SLA breached tickets over ${num(days, 30)} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_kpi_snapshot_compare',
  'Compare KPI snapshots from two different dates side-by-side. Returns each KPI\'s value on both dates plus the delta. Use for before/after analysis, verifying data pipeline changes, and investigating sudden metric shifts.',
  {
    date1: z.string().describe('First date (YYYY-MM-DD)'),
    date2: z.string().describe('Second date (YYYY-MM-DD)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ date1, date2, env }) => {
    try {
      const data = await api<any>('/api/kpi-data/snapshot-compare', { env, date1, date2 });
      return toolResult(`Snapshot comparison: ${date1} vs ${date2} (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_kpi_call_qa',
  'Get call recording QA data. Three views: "summary" for aggregate call QA scores, "agents" for per-agent call QA breakdown, "results" for individual call scores (paginated).',
  {
    view: z.enum(['summary', 'agents', 'results']).default('summary').describe('View mode'),
    days: z.number().default(30).describe('Lookback days (default 30)'),
    page: z.number().default(1).describe('Page number (for results view)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ view, days, page, env }) => {
    try {
      const d = num(days, 30);
      const endpoints: Record<string, string> = {
        summary: '/api/kpi-data/call-qa-summary',
        agents: '/api/kpi-data/call-qa-agents',
        results: '/api/kpi-data/call-qa-results',
      };
      const params: Record<string, string | number> = { env, days: d };
      if (view === 'results') params.page = num(page, 1);
      const data = await api<any>(endpoints[view], params);
      return toolResult(`Call QA (${view}) over ${d} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_kpi_dedup',
  'Get duplicate ticket analysis — tickets identified as potential duplicates, grouping info, and dedup stats. Use for data quality auditing and understanding ticket volume inflation from duplicates.',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ days, env }) => {
    try {
      const data = await api<any>('/api/public/wallboard/dedup', { env, days: num(days, 30) });
      return toolResult(`Dedup analysis over ${num(days, 30)} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_kpi_backfill_status',
  'Get data backfill status — progress of any running or recent backfill operations. Shows which date ranges have been backfilled, which are pending, and any errors. Critical for data quality auditing.',
  {
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ env }) => {
    try {
      const data = await api<any>('/api/kpi-data/backfill-status', { env });
      return toolResult(`Backfill status (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── People & Roster (3) ──────────────────────────────────────────────

server.tool(
  'nova_agent_availability',
  'Get historical agent leave/availability (annual leave, sick, WFH, training) for a date range, all agents. Use this to size working-day denominators — the AvailableHours field on agent KPI rows is NOT leave-aware and shows a full day even when the agent was off.',
  {
    from: z.string().describe('Start date YYYY-MM-DD'),
    to: z.string().describe('End date YYYY-MM-DD'),
  },
  async ({ from, to }) => {
    try {
      const data = await api<any[]>('/api/agent/availability/range', { from, to });
      return toolResult(`Agent availability ${from} → ${to}: ${data.length} row(s)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_people_roster',
  'Get the team roster. "roster" returns all team members with roles and status. "calendar" returns availability/shift data. "survey-scores" returns internal survey scores per person.',
  {
    view: z.enum(['roster', 'calendar', 'survey-scores']).default('roster').describe('View mode'),
  },
  async ({ view }) => {
    try {
      const endpoints: Record<string, string> = {
        roster: '/api/people/roster',
        calendar: '/api/people/roster/calendar',
        'survey-scores': '/api/people/roster/survey-scores',
      };
      const data = await api<any>(endpoints[view]);
      return toolResult(`People roster (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_people_agent',
  'Get an individual agent\'s data. "profile" returns their full profile. "plan" returns their 90-day plan. "snapshots" returns historical KPI snapshots. "actions" returns their action log. "calendar" returns their schedule. "aged-tickets" returns their over-SLA/stale tickets.',
  {
    agent_name: z.string().describe('Agent name'),
    view: z.enum(['profile', 'plan', 'snapshots', 'actions', 'calendar', 'aged-tickets']).default('profile').describe('View mode'),
  },
  async ({ agent_name, view }) => {
    try {
      const base = `/api/people/agent/${encodeURIComponent(agent_name)}`;
      const suffix = view === 'profile' ? '' : `/${view}`;
      const data = await api<any>(`${base}${suffix}`);
      return toolResult(`Agent ${agent_name} (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_team_workload',
  'Get current team workload distribution — how tickets are spread across agents, who\'s overloaded, who has capacity.',
  {},
  async () => {
    try {
      const data = await api<any>('/api/team/workload');
      return toolResult('Team workload', data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── Pipeline & Data Quality (4) ──────────────────────────────────────

server.tool(
  'nova_pipeline',
  'Monitor n8n data pipelines. "stats" shows pipeline execution stats and health. "runs" shows recent execution history. "drift" detects data drift. "drift-trend" tracks drift over time for a call type. "compare" compares two pipeline versions. "uat-compare" compares UAT vs Live (requires table param).',
  {
    view: z.enum(['stats', 'runs', 'drift', 'drift-trend', 'compare', 'uat-compare']).describe('View mode'),
    pipeline: z.string().optional().describe('Pipeline name (for compare view)'),
    call_type: z.string().optional().describe('Call type (for drift-trend view)'),
    table: z.enum(['kpi_daily', 'agent_kpi_daily', 'qa_results', 'golden_rules', 'kpi_digest']).optional().describe('Table name (required for uat-compare view)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ view, pipeline, call_type, table, env }) => {
    try {
      const endpoints: Record<string, string> = {
        stats: '/api/agent/pipeline/stats',
        runs: '/api/agent/pipeline/runs',
        drift: '/api/agent/pipeline/drift',
        'drift-trend': `/api/agent/pipeline/drift/trend/${encodeURIComponent(call_type || '')}`,
        compare: `/api/agent/pipeline/compare/${encodeURIComponent(pipeline || '')}`,
        'uat-compare': `/api/agent/pipeline/uat-compare${table ? `?table=${encodeURIComponent(table)}` : ''}`,
      };
      const data = await api<any>(endpoints[view]);
      return toolResult(`Pipeline (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_data_audit',
  'Get the data quality audit trail — records of data quality checks, anomalies detected, and corrections applied.',
  {
    days: z.number().default(90).describe('Lookback days (default 90)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ days, env }) => {
    try {
      const data = await api<any>('/api/trends/data-audit', { env, days: num(days, 90) });
      return toolResult(`Data audit over ${num(days, 90)} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_uat_query',
  'Query UAT pipeline tables directly. Returns rows from the specified UAT table with date filtering. Use to verify pipeline output after deploys.',
  {
    table: z.enum(['kpi_daily', 'agent_kpi_daily', 'qa_results', 'golden_rules', 'kpi_digest']).describe('UAT table to query'),
    days: z.number().default(7).describe('Lookback days (default 7)'),
    limit: z.number().default(50).describe('Max rows returned (default 50)'),
  },
  async ({ table, days, limit }) => {
    try {
      const data = await api<any>(`/api/pipeline/uat-query`, { table, days: num(days, 7), limit: num(limit, 50) });
      return toolResult(`UAT Query: ${table}`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_uat_schema',
  'Get column schema of a UAT pipeline table — names, types, nullable. Use to verify schema changes landed correctly after deploys.',
  {
    table: z.enum(['kpi_daily', 'agent_kpi_daily', 'qa_results', 'golden_rules', 'kpi_digest']).describe('UAT table to inspect'),
  },
  async ({ table }) => {
    try {
      const data = await api<any>(`/api/pipeline/uat-schema`, { table });
      return toolResult(`UAT Schema: ${table}`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_uat_stats',
  'Summary statistics for a UAT pipeline table — row counts, null rates, score distributions, pass rates. Use for quick health checks without pulling full data.',
  {
    table: z.enum(['kpi_daily', 'agent_kpi_daily', 'qa_results', 'golden_rules', 'kpi_digest']).describe('UAT table to summarise'),
  },
  async ({ table }) => {
    try {
      const data = await api<any>(`/api/pipeline/uat-stats`, { table });
      return toolResult(`UAT Stats: ${table}`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_ai_trend',
  'Get AI agent performance trend over time — accuracy, confidence scores, action counts, cost efficiency trended daily/weekly.',
  {
    days: z.number().default(90).describe('Lookback days (default 90)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ days, env }) => {
    try {
      const data = await api<any>('/api/trends/ai', { env, days: num(days, 90) });
      return toolResult(`AI trend over ${num(days, 90)} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_checkpoint',
  'Get data checkpoint summary — validation checkpoints that confirm data was captured correctly at key points.',
  {
    days: z.number().default(90).describe('Lookback days (default 90)'),
    env: z.enum(['live', 'uat']).default('live').describe('Environment'),
  },
  async ({ days, env }) => {
    try {
      const data = await api<any>('/api/trends/checkpoint', { env, days: num(days, 90) });
      return toolResult(`Checkpoint over ${num(days, 90)} days (${env})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── Escalation & Problem Tickets (3) ─────────────────────────────────

server.tool(
  'nova_escalations',
  'Get escalation data. "list" returns individual escalations with ticket key, reason, from/to tier, agent, timestamp. "stats" returns aggregate escalation statistics by reason and tier.',
  {
    view: z.enum(['list', 'stats']).default('list').describe('View mode'),
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ view, days }) => {
    try {
      const d = num(days, 30);
      const endpoint = view === 'stats' ? '/api/escalations/stats' : '/api/escalations';
      const data = await api<any>(endpoint, { days: d });
      return toolResult(`Escalations (${view}) over ${d} days`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_problem_tickets',
  'Get problem ticket data. "list" returns all flagged tickets. "stats" shows detection statistics. "config" shows detection rules. "scan-status" shows whether scanning is current. "detail" returns a specific ticket\'s problem analysis.',
  {
    view: z.enum(['list', 'stats', 'config', 'scan-status', 'detail']).default('list').describe('View mode'),
    issue_key: z.string().optional().describe('Ticket key (for detail view)'),
  },
  async ({ view, issue_key }) => {
    try {
      const endpoints: Record<string, string> = {
        list: '/api/problem-tickets',
        stats: '/api/problem-tickets/stats',
        config: '/api/problem-tickets/config',
        'scan-status': '/api/problem-tickets/scan-status',
        detail: `/api/problem-tickets/${encodeURIComponent(issue_key || '')}`,
      };
      const data = await api<any>(endpoints[view]);
      return toolResult(`Problem tickets (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_escalation_reasons',
  'Get escalation configuration data. "reasons" returns the list of escalation reason categories. "t2-agents" returns the Tier 2 agent roster for escalation routing.',
  {
    view: z.enum(['reasons', 't2-agents']).default('reasons').describe('View mode'),
  },
  async ({ view }) => {
    try {
      const endpoint = view === 't2-agents' ? '/api/agent/escalation/t2-agents' : '/api/agent/escalation/reasons';
      const data = await api<any>(endpoint);
      return toolResult(`Escalation ${view}`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── Agent Intelligence (5) ───────────────────────────────────────────

server.tool(
  'nova_agent_workspace',
  'Access the AI agent\'s workspace view. "queue" returns the full ticket queue. "queue-fast" returns a lightweight queue. "ticket" returns full ticket detail including history, comments, and agent analysis.',
  {
    view: z.enum(['queue', 'queue-fast', 'ticket']).default('queue').describe('View mode'),
    ticket_key: z.string().optional().describe('Ticket key (for ticket view)'),
  },
  async ({ view, ticket_key }) => {
    try {
      const endpoints: Record<string, string> = {
        queue: '/api/agent/workspace/queue',
        'queue-fast': '/api/agent/workspace/queue-fast',
        ticket: `/api/agent/workspace/ticket/${encodeURIComponent(ticket_key || '')}`,
      };
      const data = await api<any>(endpoints[view]);
      return toolResult(`Agent workspace (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_classifications',
  'Get ticket classification data. "list" returns individual classifications. "breakdown" returns aggregate stats by category.',
  {
    view: z.enum(['list', 'breakdown']).default('list').describe('View mode'),
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ view, days }) => {
    try {
      const d = num(days, 30);
      const endpoint = view === 'breakdown' ? '/api/agent/classifications/breakdown' : '/api/agent/classifications';
      const data = await api<any>(endpoint, { days: d });
      return toolResult(`Classifications (${view}) over ${d} days`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_confidence',
  'Get AI agent confidence data. "history" returns confidence scores over time. "overrides" returns manual overrides where a human corrected the agent. "auto-rules" returns automation rules that bypass human review.',
  {
    view: z.enum(['history', 'overrides', 'auto-rules']).default('history').describe('View mode'),
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ view, days }) => {
    try {
      const d = num(days, 30);
      const endpoints: Record<string, string> = {
        history: '/api/agent/confidence-history',
        overrides: '/api/agent/overrides',
        'auto-rules': '/api/agent/auto-rules',
      };
      const params: Record<string, string | number> = view === 'auto-rules' ? {} : { days: d };
      const data = await api<any>(endpoints[view], params);
      return toolResult(`Agent confidence (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_ai_improvement',
  'Get AI improvement data. "stats" returns overall improvement metrics. "comparisons" returns before/after comparisons of AI responses. "signals" returns quality signals and indicators.',
  {
    view: z.enum(['stats', 'comparisons', 'signals']).default('stats').describe('View mode'),
  },
  async ({ view }) => {
    try {
      const data = await api<any>(`/api/ai-improvement/${view}`);
      return toolResult(`AI improvement (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_coaching_detail',
  'Get coaching data for a specific agent — coaching priorities, recent nudges, improvement areas, and coaching history.',
  {
    agent_name: z.string().describe('Agent name'),
  },
  async ({ agent_name }) => {
    try {
      const data = await api<any>(`/api/agent/coaching/agent/${encodeURIComponent(agent_name)}`);
      return toolResult(`Coaching detail for ${agent_name}`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── Dev Review & Surveys (3) ─────────────────────────────────────────

server.tool(
  'nova_dev_review',
  'Get development review queue data. "queue" returns tickets awaiting dev review. "dashboard" returns review stats and metrics. "outbox" returns tickets sent back to customers. "ticket" returns a specific ticket\'s review details.',
  {
    view: z.enum(['queue', 'dashboard', 'outbox', 'ticket']).default('queue').describe('View mode'),
    ticket_key: z.string().optional().describe('Ticket key (for ticket view)'),
  },
  async ({ view, ticket_key }) => {
    try {
      const endpoint = view === 'ticket'
        ? `/api/dev-review/ticket/${encodeURIComponent(ticket_key || '')}`
        : `/api/dev-review/${view}`;
      const data = await api<any>(endpoint);
      return toolResult(`Dev review (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_surveys',
  'Get survey and CSAT data. "list" returns all surveys. "teams" returns team-level survey results. "categories" returns survey categories. "satisfaction" returns CSAT satisfaction scores. "detail" returns a specific survey\'s full data.',
  {
    view: z.enum(['list', 'teams', 'categories', 'satisfaction', 'detail']).default('list').describe('View mode'),
    survey_id: z.string().optional().describe('Survey ID (for detail view)'),
  },
  async ({ view, survey_id }) => {
    try {
      const endpoints: Record<string, string> = {
        list: '/api/surveys',
        teams: '/api/surveys/teams',
        categories: '/api/surveys/categories',
        satisfaction: '/api/surveys/satisfaction-scores',
        detail: `/api/surveys/${encodeURIComponent(survey_id || '')}`,
      };
      const data = await api<any>(endpoints[view]);
      return toolResult(`Surveys (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_standups',
  'Get standup data. "today" returns today\'s standup entries. "cached" returns the most recent cached standup data. "history" returns historical standup records.',
  {
    view: z.enum(['today', 'cached', 'history']).default('today').describe('View mode'),
  },
  async ({ view }) => {
    try {
      const data = await api<any>(`/api/standups/${view}`);
      return toolResult(`Standups (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── Admin & Audit (4) ────────────────────────────────────────────────

server.tool(
  'nova_audit_log',
  'Get the system audit log — records of all significant actions taken in NOVA (setting changes, data modifications, user actions).',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/audit', { days: num(days, 30) });
      return toolResult(`Audit log over ${num(days, 30)} days`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_admin_data',
  'Get admin reference data. "users" returns all NOVA users. "teams" returns team definitions. "products" returns the Nurtur product catalog. "roles" returns role definitions.',
  {
    view: z.enum(['users', 'teams', 'products', 'roles']).describe('Data type'),
  },
  async ({ view }) => {
    try {
      const endpoints: Record<string, string> = {
        users: '/api/admin/users',
        teams: '/api/admin/teams',
        products: '/api/admin/nurtur-products',
        roles: '/api/admin/roles',
      };
      const data = await api<any>(endpoints[view]);
      return toolResult(`Admin data (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_settings',
  'Get system settings and feature flags. "all" returns all NOVA settings with secret values redacted. "feature-flags" returns just the feature flag configuration.',
  {
    view: z.enum(['all', 'feature-flags']).default('all').describe('View mode'),
  },
  async ({ view }) => {
    try {
      const endpoint = view === 'feature-flags' ? '/api/settings/feature-flags' : '/api/settings';
      const data = await api<any>(endpoint);
      // /api/settings returns every value in the clear to an admin caller, and
      // this account is an admin, so an unfiltered "all" rendered live API keys,
      // the JWT signing secret, OAuth client secrets and DB connection strings
      // straight into the transcript. Redact before returning.
      if (view === 'all' && data && typeof data === 'object') {
        return toolResult('Settings (all, secrets redacted)', redactSecrets(data as Record<string, unknown>));
      }
      return toolResult(`Settings (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_training',
  'Get training data. "summary" returns overall training completion stats. "categories" returns training categories. "items" returns individual training items. "scores" returns agent training scores. "users" returns training progress per user.',
  {
    view: z.enum(['summary', 'categories', 'items', 'scores', 'users']).default('summary').describe('View mode'),
  },
  async ({ view }) => {
    try {
      const data = await api<any>(`/api/training/${view}`);
      return toolResult(`Training (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ── Remaining Coverage (4) ───────────────────────────────────────────

server.tool(
  'nova_my_tickets',
  'Get ticket queue and event data. "queue" returns an agent\'s current ticket queue. "events" returns all ticket events. "events-today" returns today\'s events for a specific agent. "defers" returns deferred tickets. "defer-reasons" returns defer reason categories.',
  {
    view: z.enum(['queue', 'events', 'events-today', 'defers', 'defer-reasons']).default('defer-reasons').describe('View mode'),
    agent_id: z.string().optional().describe('Agent user ID (required for queue, events-today, defers)'),
  },
  async ({ view, agent_id }) => {
    try {
      const endpoints: Record<string, string> = {
        queue: `/api/my-tickets/queue/${encodeURIComponent(agent_id || '')}`,
        events: '/api/my-tickets/events',
        'events-today': `/api/my-tickets/events/agent/${encodeURIComponent(agent_id || '')}/today`,
        defers: `/api/my-tickets/defers/${encodeURIComponent(agent_id || '')}`,
        'defer-reasons': '/api/my-tickets/defer-reasons',
      };
      if (['queue', 'events-today', 'defers'].includes(view) && !agent_id) {
        return toolError(`agent_id is required for view "${view}"`);
      }
      const data = await api<any>(endpoints[view]);
      return toolResult(`My tickets (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_gamification',
  'Get gamification data. "leaderboard" returns the team leaderboard. "profile" returns a user\'s gamification profile. "achievements" returns available/earned achievements. "points" returns point history.',
  {
    view: z.enum(['leaderboard', 'profile', 'achievements', 'points']).default('leaderboard').describe('View mode'),
    user_id: z.string().optional().describe('User ID (for profile view)'),
  },
  async ({ view, user_id }) => {
    try {
      const endpoint = view === 'profile' && user_id
        ? `/api/gamification/profile/${encodeURIComponent(user_id)}`
        : view === 'profile'
          ? '/api/gamification/profile'
          : `/api/gamification/${view}`;
      const data = await api<any>(endpoint);
      return toolResult(`Gamification (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_milestones',
  'Get milestone and delivery tracking data. "summary" returns overall progress. "matrix" returns the tracking matrix. "calendar" returns calendar view. "overdue" returns overdue deliveries. "templates" returns milestone templates. "delivery" returns a specific delivery. "traffic-lights" returns RAG status for a delivery.',
  {
    view: z.enum(['summary', 'matrix', 'calendar', 'overdue', 'templates', 'delivery', 'traffic-lights']).default('summary').describe('View mode'),
    delivery_id: z.string().optional().describe('Delivery ID (for delivery/traffic-lights views)'),
    template_id: z.string().optional().describe('Template ID (for template detail)'),
  },
  async ({ view, delivery_id, template_id }) => {
    try {
      let endpoint: string;
      if (view === 'delivery') {
        endpoint = `/api/milestones/delivery/${encodeURIComponent(delivery_id || '')}`;
      } else if (view === 'traffic-lights') {
        endpoint = `/api/milestones/traffic-lights/${encodeURIComponent(delivery_id || '')}`;
      } else if (view === 'templates' && template_id) {
        endpoint = `/api/milestones/templates/${encodeURIComponent(template_id)}`;
      } else if (view === 'overdue') {
        endpoint = '/api/milestones/overdue-deliveries';
      } else {
        endpoint = `/api/milestones/${view}`;
      }
      const data = await api<any>(endpoint);
      return toolResult(`Milestones (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_feedback',
  'Get internal feedback records. "list" returns all feedback entries. "mine" returns feedback for the authenticated user.',
  {
    view: z.enum(['list', 'mine']).default('list').describe('View mode'),
  },
  async ({ view }) => {
    try {
      const endpoint = view === 'mine' ? '/api/feedback/mine' : '/api/feedback';
      const data = await api<any>(endpoint);
      return toolResult(`Feedback (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ═════════════════════════════════════════════════════════════════════
// PART 5 — AI AGENT EXTENDED TOOLS (12)
// ═════════════════════════════════════════════════════════════════════

server.tool(
  'nova_agent_pipeline_health',
  'Returns pipeline monitor data: per-pipeline output counts, zero-output alerts, last-run timestamps.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/pipeline-health');
      return toolResult(`Pipeline health (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_drift',
  'Returns drift detection snapshots: segments, severity, delta arrows, latest drift check result.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/drift', { days });
      return toolResult(`Drift detection (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_eval_results',
  'Returns eval suite results: last run, sample size, accept-rate delta, pass/fail.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/eval', { days });
      return toolResult(`Eval results (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_critic_log',
  'Returns critic gate decisions: ticket_key, original action, critic verdict, overridden, timestamp.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/critic-log', { days });
      return toolResult(`Critic log (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_ab_results',
  'Returns A/B framework results: active experiments, variant traffic split, accept-rate by variant.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/ab-tests', { days });
      return toolResult(`A/B results (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_patterns',
  'Returns pattern library: top-K patterns, match count, last matched.',
  { days: z.number().default(7).describe('Lookback days'), limit: z.number().default(20).describe('Max patterns') },
  async ({ days, limit }) => {
    try {
      const data = await api<any>('/api/agent/patterns', { days, limit });
      return toolResult(`Pattern library (${days}d, top ${limit})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_shadow_model',
  'Returns shadow model comparison: agreement rate, disagreement samples, model pair.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/shadow-model', { days });
      return toolResult(`Shadow model (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_replay',
  'Returns results of the last replay run.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/replay', { days });
      return toolResult(`Replay results (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_chase_log',
  'Returns chase automation activity: tickets chased, chase type, timestamps.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/chase-log', { days });
      return toolResult(`Chase log (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_quick_wins',
  'Returns quick win detection stats: by type, confidence distribution, auto-closed count.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/quick-wins', { days });
      return toolResult(`Quick wins (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_impact',
  'Returns business impact metrics: autonomous resolution rate, deflection rate, queue hours saved, approval/reversal rates.',
  { days: z.number().default(7).describe('Lookback days') },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/impact', { days });
      return toolResult(`Impact metrics (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_ownership',
  'Returns ownership registry: which action classes NOVA owns vs shared with n8n.',
  {},
  async () => {
    try {
      const data = await api<any>('/api/agent/ownership');
      return toolResult('Ownership registry', data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ═════════════════════════════════════════════════════════════════════
// PART 8 — P5/P6 Feature Tools
// ═════════════════════════════════════════════════════════════════════

server.tool(
  'nova_agent_predictions',
  'Returns current escalation predictions — ticket key, probability, features, accuracy history.',
  {
    days: z.number().default(7).describe('Lookback days (default 7)'),
    min_probability: z.number().default(0.5).describe('Minimum probability threshold (default 0.5)'),
  },
  async ({ days, min_probability }) => {
    try {
      const data = await api<any>('/api/agent/predictions', { days, min_probability });
      return toolResult(`Escalation predictions (${days}d, min prob ${min_probability})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_incidents',
  'Returns active and recent incidents — summary, ticket count, linked tickets, status.',
  {
    status: z.enum(['open', 'investigating', 'resolved', 'all']).default('all').describe('Incident status filter'),
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ status, days }) => {
    try {
      const data = await api<any>('/api/agent/incidents', { status, days });
      return toolResult(`Incidents (${status}, ${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_sla_interventions',
  'Returns proactive SLA interventions — ticket key, minutes remaining, intervention type, outcome.',
  {
    days: z.number().default(7).describe('Lookback days (default 7)'),
  },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/agent/sla-management', { days });
      return toolResult(`SLA interventions (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_kb_health',
  'Returns KB article health stats — current/stale/unused/drifted counts, coverage heatmap, closure rate.',
  {
    view: z.enum(['summary', 'articles', 'coverage', 'closure']).default('summary').describe('View mode'),
  },
  async ({ view }) => {
    try {
      const data = await api<any>('/api/kb-health', { view });
      return toolResult(`KB health (${view})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_training_signals',
  'Returns per-agent weakness analysis — signal type, metric vs team average, recommendation, example tickets.',
  {
    agent_id: z.string().optional().describe('Agent ID (omit for all agents)'),
    actioned: z.enum(['true', 'false', 'all']).default('all').describe('Filter by actioned status'),
  },
  async ({ agent_id, actioned }) => {
    try {
      const params: Record<string, string> = { actioned };
      if (agent_id) params.agent_id = agent_id;
      const data = await api<any>('/api/training-signals', params);
      return toolResult(`Training signals${agent_id ? ` (agent ${agent_id})` : ' (all agents)'}`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_121_brief',
  'Generates a 1-2-1 prep brief — performance, trends, coaching signals, talking points.',
  {
    agent_id: z.string().describe('Agent ID (required)'),
    period_days: z.number().default(30).describe('Period in days (default 30)'),
  },
  async ({ agent_id, period_days }) => {
    try {
      const data = await apiPost<any>(`/api/briefing/121/${agent_id}`, { period_days });
      return toolResult(`1-2-1 brief for agent ${agent_id} (${period_days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_ops_pack',
  'Returns or generates the weekly operational meeting pack — queue health, SLA, team performance, decisions needed.',
  {
    action: z.enum(['latest', 'generate']).default('latest').describe('Get latest or generate new'),
  },
  async ({ action }) => {
    try {
      const data = action === 'generate'
        ? await apiPost<any>('/api/ops-pack/generate', {})
        : await api<any>('/api/ops-pack/latest');
      return toolResult(`Ops pack (${action})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_capacity_forecast',
  'Returns 14-day volume prediction with staffing surplus/deficit and historical accuracy.',
  {
    days: z.number().default(14).describe('Forecast horizon in days (default 14)'),
  },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/capacity/forecast', { days });
      return toolResult(`Capacity forecast (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_cross_functional',
  'Returns cross-functional intelligence — bug impact analysis, feature demand clusters, recurring issues.',
  {
    signal_type: z.enum(['bug_impact', 'feature_demand', 'recurring_issue', 'all']).default('all').describe('Signal type filter'),
  },
  async ({ signal_type }) => {
    try {
      const data = await api<any>('/api/cross-functional', { signal_type });
      return toolResult(`Cross-functional intelligence (${signal_type})`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_agent_learning_status',
  'Returns novel ticket types encountered, learning acquisition rate, autonomy expansion candidates.',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/learning', { days });
      return toolResult(`Learning status (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_admin_jobs',
  'Returns all registered background jobs — name, interval, last run, error count, enabled status.',
  {},
  async () => {
    try {
      const data = await api<any>('/api/admin/jobs');
      return toolResult('Background jobs', data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_admin_job_control',
  'Start, stop, or trigger a background job by ID.',
  {
    job_id: z.string().describe('Job ID (required)'),
    action: z.enum(['start', 'stop', 'run']).describe('Action to perform'),
  },
  async ({ job_id, action }) => {
    try {
      const data = await apiPost<any>(`/api/admin/jobs/${job_id}/${action}`, {});
      return toolResult(`Job ${job_id}: ${action}`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

server.tool(
  'nova_portal_analytics',
  'Returns portal usage metrics — deflection rate, chat sessions, ticket creation, KB searches, user count.',
  {
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ days }) => {
    try {
      const data = await api<any>('/api/portal/admin/metrics', { days });
      return toolResult(`Portal analytics (${days}d)`, data);
    } catch (err: any) { return toolError(err.message); }
  },
);

// ═════════════════════════════════════════════════════════════════════
// Server startup
// ═════════════════════════════════════════════════════════════════════

server.tool(
  'nova_recent_errors',
  "Recent entries from NOVA's central error log — business-critical failures across subsystems (llm, agent, jira-sync, api, portal, kpi-pipeline, etc.). Use this to diagnose \"what is failing right now\" instead of grepping server logs.",
  {
    source: z.string().optional().describe('Filter by subsystem, e.g. "llm", "agent", "jira-sync", "api"'),
    severity: z.enum(['error', 'critical']).optional().describe('Filter by severity'),
    sinceHours: z.number().default(24).describe('Look back this many hours (default 24)'),
    unresolvedOnly: z.boolean().default(true).describe('Only unresolved errors (default true)'),
    limit: z.number().default(50).describe('Max rows (default 50, max 500)'),
  },
  async ({ source, severity, sinceHours, unresolvedOnly, limit }) => {
    try {
      const params: Record<string, string | number> = { sinceHours, limit };
      if (source) params.source = source;
      if (severity) params.severity = severity;
      if (unresolvedOnly) params.resolved = 'false';
      const rows = await api<unknown[]>('/api/errors', params);
      return toolResult(
        `${rows.length} error(s) in the last ${sinceHours}h${source ? ` from ${source}` : ''}${severity ? ` (${severity})` : ''}`,
        rows,
      );
    } catch (err) {
      return toolResult(`Failed to fetch errors: ${err instanceof Error ? err.message : String(err)}`, { error: true });
    }
  },
);

server.tool(
  'nova_error_summary',
  'Counts of NOVA errors grouped by subsystem and severity over a window — a quick health snapshot of what is failing and how much.',
  {
    sinceHours: z.number().default(24).describe('Look back this many hours (default 24)'),
  },
  async ({ sinceHours }) => {
    try {
      const rows = await api<unknown[]>('/api/errors/summary', { sinceHours });
      return toolResult(`Error summary for the last ${sinceHours}h (${rows.length} group(s))`, rows);
    } catch (err) {
      return toolResult(`Failed to fetch error summary: ${err instanceof Error ? err.message : String(err)}`, { error: true });
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error starting NOVA MCP server:', err);
  process.exit(1);
});
