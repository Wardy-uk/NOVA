import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { novaGet, novaPost, novaPut, novaDelete } from './api-client.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const server = new McpServer({
  name: 'nova',
  version: '2.0.0',
});

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
    days: z.number().default(90).describe('Lookback days (default 90)'),
    granularity: z.enum(['daily', 'weekly']).default('weekly'),
  },
  async ({ metric, days, granularity }) => {
    try {
      const rows = await api<any[]>('/api/admin/kpi-data/daily-history', { days });
      const re = likeToRegex(metric);
      const matched = rows.filter((r: any) => re.test(r.kpi || r.KPI || ''));

      if (matched.length === 0) {
        return toolResult(`No KPIs matching "${metric}" found in the last ${days} days`, { kpiName: metric, timeSeries: [] });
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
        `Trend analysis for ${results.length} KPI(s) matching "${metric}" over ${days} days (${granularity})`,
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
    metric: z.enum(['qa_score', 'open_tickets', 'solved_today', 'over_2h', 'no_update']).describe('Metric to compare'),
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ metric, days }) => {
    try {
      let rankings: { agent: string; value: number }[];

      if (metric === 'qa_score') {
        const agents = await api<any[]>('/api/kpi-data/qa-agents', { days });
        rankings = agents.map((a: any) => ({ agent: a.assigneeName, value: Number(a.avgScore || 0) }));
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

      const lowerIsBetter = ['open_tickets', 'over_2h', 'no_update'].includes(metric);
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
        api<any[]>('/api/admin/kpi-data/team-snapshot'),
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
      const rows = await api<any[]>('/api/admin/kpi-data/daily-history', { days });

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
      const comparison = await api<any>('/api/admin/kpi-data/comparison');
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
    days: z.number().default(30).describe('Lookback days (default 30)'),
  },
  async ({ kpi_pattern, days }) => {
    try {
      const rows = await api<any[]>('/api/admin/kpi-data/daily-history', { days });
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
          if (sensitivePattern.test(key)) {
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
  'Get QA coaching data from the Golden Rules pipeline — team-wide or per-agent. Sources from jira_qa_results and Jira_QA_GoldenRules.',
  {
    agent_name: z.string().optional().describe('Agent display name for individual coaching (omit for team overview)'),
    days: z.number().default(30).describe('Lookback days (default 30, max 90)'),
  },
  async ({ agent_name, days }) => {
    try {
      const d = Math.min(days, 90);
      if (agent_name) {
        const [agentCoaching, nudges] = await Promise.all([
          api<any>(`/api/agent/coaching/agent/${encodeURIComponent(agent_name)}`, { days: d }),
          api<any>('/api/agent/coaching/nudges', { agent: agent_name, limit: 50 }),
        ]);
        return toolResult(`Coaching for ${agent_name} over ${d} days`, { coaching: agentCoaching, nudges });
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

async function resolveColumnId(input: string | number): Promise<number> {
  if (typeof input === 'number' || /^\d+$/.test(String(input))) return Number(input);
  const cols = await api<BacklogColumn[]>('/api/backlog/columns');
  const col = cols.find(c => c.title.toLowerCase() === String(input).toLowerCase());
  if (!col) throw new Error(`No column matching "${input}". Available: ${cols.map(c => c.title).join(', ')}`);
  return col.id;
}

async function resolveItemId(args: { id?: number; wp_ref?: string; title_match?: string }): Promise<{ id: number; title: string }> {
  if (args.id !== undefined) {
    const item = await api<BacklogItem>(`/api/backlog/items/${args.id}`);
    return { id: item.id, title: item.title };
  }
  const items = await api<BacklogItem[]>('/api/backlog/items');
  let matches: BacklogItem[];
  if (args.wp_ref) {
    matches = items.filter(i => i.wp_ref?.toLowerCase() === args.wp_ref!.toLowerCase());
    if (matches.length === 0) throw new Error(`No item with wp_ref "${args.wp_ref}"`);
  } else if (args.title_match) {
    matches = items.filter(i => i.title.toLowerCase() === args.title_match!.toLowerCase());
    if (matches.length === 0) throw new Error(`No item with exact title "${args.title_match}"`);
  } else {
    throw new Error('Provide id, wp_ref, or title_match to identify the item');
  }
  if (matches.length > 1) throw new Error(`Multiple items match: ${matches.map(i => `#${i.id} "${i.title}"`).join(', ')}. Use numeric id.`);
  return { id: matches[0].id, title: matches[0].title };
}

// 1. List columns
server.tool(
  'nova_backlog_columns',
  'List all backlog columns with their IDs, titles, colours, and item counts.',
  {},
  async () => {
    try {
      const cols = await api<BacklogColumn[]>('/api/backlog/columns');
      const lines = cols.map(c => `${c.sort_order + 1}. **${c.title}** (id=${c.id}) — ${c.item_count ?? 0} items${c.color ? ` [${c.color}]` : ''}`).join('\n');
      return toolResult(`${cols.length} columns`, { columns: cols, summary: lines });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 2. List backlog items
server.tool(
  'nova_backlog_list',
  'List backlog items, optionally filtered by column (by title or id) or type. Returns items with column name resolved.',
  {
    column: z.string().optional().describe('Filter by column title (e.g. "Backlog", "In Progress") or numeric id'),
    type: z.string().optional().describe('Filter by item type (e.g. "code", "bugfix", "manual", "workshop")'),
  },
  async ({ column, type }) => {
    try {
      const params: Record<string, string | number> = {};
      if (column) params.column_id = await resolveColumnId(column);
      if (type) params.type = type;
      const [cols, items] = await Promise.all([
        api<BacklogColumn[]>('/api/backlog/columns'),
        api<BacklogItem[]>('/api/backlog/items', Object.keys(params).length ? params : undefined),
      ]);
      const colMap = new Map(cols.map(c => [c.id, c.title]));
      const enriched = items.map(i => ({ ...i, column_name: colMap.get(i.column_id) ?? '?' }));

      const grouped = cols.map(c => ({
        column: c.title,
        items: enriched.filter(i => i.column_id === c.id).sort((a, b) => a.priority - b.priority),
      })).filter(g => g.items.length > 0);

      const lines = grouped.map(g => `## ${g.column} (${g.items.length})\n${g.items.map(i =>
        `  - #${i.id} ${i.wp_ref ? `[${i.wp_ref}] ` : ''}${i.title}${i.effort ? ` (${i.effort})` : ''}${i.type ? ` [${i.type}]` : ''}${i.blocked_reason ? ` ⚠ BLOCKED: ${i.blocked_reason}` : ''}`
      ).join('\n')}`).join('\n\n');

      return toolResult(`${items.length} backlog items across ${grouped.length} columns`, { summary: lines, total: items.length, items: enriched });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 3. Add backlog item
server.tool(
  'nova_backlog_add',
  'Add a new backlog item. Accepts column by title (e.g. "Backlog") or id.',
  {
    column: z.string().describe('Column title (e.g. "Backlog", "This Sprint") or numeric id'),
    title: z.string().describe('Item title'),
    description: z.string().optional().describe('Markdown description'),
    wp_ref: z.string().optional().describe('Work package reference (e.g. "WP-53")'),
    effort: z.string().optional().describe('Effort estimate (e.g. "1-2 days", "30min")'),
    type: z.string().optional().describe('Type: code, bugfix, manual, workshop, process, research, infrastructure, monitoring'),
    priority: z.number().optional().describe('Sort priority within column (lower = higher)'),
  },
  async ({ column, title, description, wp_ref, effort, type, priority }) => {
    try {
      const column_id = await resolveColumnId(column);
      const item = await apiPost<BacklogItem>('/api/backlog/items', { column_id, title, description, wp_ref, effort, type, priority });
      return toolResult(`Created #${item.id} "${title}"`, { item });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 4. Update backlog item
server.tool(
  'nova_backlog_update',
  'Update fields on an existing backlog item. Accepts item by numeric id, by wp_ref (e.g. "WP-53"), or by exact title match.',
  {
    id: z.number().optional().describe('Numeric item id'),
    wp_ref: z.string().optional().describe('Work package reference to match (e.g. "WP-53")'),
    title_match: z.string().optional().describe('Exact title to match (case-insensitive)'),
    fields: z.object({
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      wp_ref: z.string().optional().describe('New work package reference'),
      effort: z.string().optional().describe('New effort estimate'),
      type: z.string().optional().describe('New type'),
      blocked_reason: z.string().optional().describe('Blocked reason (empty string to clear)'),
    }).describe('Fields to update (at least one required)'),
  },
  async ({ id, wp_ref, title_match, fields }) => {
    try {
      const resolved = await resolveItemId({ id, wp_ref, title_match });
      const updates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) { if (v !== undefined) updates[k] = v; }
      if (Object.keys(updates).length === 0) return toolError('No fields to update — provide at least one field');
      const updated = await apiPut<BacklogItem>(`/api/backlog/items/${resolved.id}`, updates);
      return toolResult(`Updated #${resolved.id} "${resolved.title}"`, { item: updated });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 5. Move backlog item
server.tool(
  'nova_backlog_move',
  'Move an item to a different column. Auto-completes when moved to Done.',
  {
    id: z.number().optional().describe('Numeric item id'),
    wp_ref: z.string().optional().describe('Work package reference to match'),
    title_match: z.string().optional().describe('Exact title to match (case-insensitive)'),
    to_column: z.string().describe('Target column title (e.g. "In Progress", "Done") or numeric id'),
    priority: z.number().optional().describe('Position within target column (0 = top)'),
  },
  async ({ id, wp_ref, title_match, to_column, priority }) => {
    try {
      const resolved = await resolveItemId({ id, wp_ref, title_match });
      const column_id = await resolveColumnId(to_column);
      const moved = await apiPut<BacklogItem>(`/api/backlog/items/${resolved.id}/move`, { column_id, priority });
      return toolResult(`Moved #${resolved.id} "${resolved.title}" → column ${to_column}`, { item: moved });
    } catch (err: any) { return toolError(err.message); }
  },
);

// 6. Remove backlog item
server.tool(
  'nova_backlog_remove',
  'Delete a backlog item. Returns the deleted item\'s title for confirmation.',
  {
    id: z.number().optional().describe('Numeric item id'),
    wp_ref: z.string().optional().describe('Work package reference to match'),
    title_match: z.string().optional().describe('Exact title to match (case-insensitive)'),
  },
  async ({ id, wp_ref, title_match }) => {
    try {
      const resolved = await resolveItemId({ id, wp_ref, title_match });
      await apiDelete(`/api/backlog/items/${resolved.id}`);
      return toolResult(`Deleted #${resolved.id} "${resolved.title}"`, { deleted: { id: resolved.id, title: resolved.title } });
    } catch (err: any) { return toolError(err.message); }
  },
);

// ═════════════════════════════════════════════════════════════════════
// Server startup
// ═════════════════════════════════════════════════════════════════════

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
