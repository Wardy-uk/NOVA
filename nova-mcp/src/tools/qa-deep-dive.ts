import { z } from 'zod';
import { apiGet, getEnv } from '../auth.js';
import { TEAM_AGENTS } from '../constants.js';
import { toolResult, toolError, mean } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const qaDeepDiveSchema = {
  agent: z.string().optional().describe('Agent name (must be in TEAM_AGENTS). Omit for whole team.'),
  days: z.number().default(30).describe('Number of days to look back (default 30, max 365)'),
};

interface QaResultRow {
  issueKey: string;
  assigneeName: string;
  grade: string;
  overallScore: number | string;
  accuracyScore: number | string;
  clarityScore: number | string;
  toneScore: number | string;
  closureScore?: number | string;
  category: string | null;
  isConcerning: number;
  processedAt: string;
}

interface GoldenSummary {
  total: number;
  rule1Pass: number;
  rule2Pass: number;
  rule3Pass: number;
  avgScore: number | string;
}

const MAX_PAGES = 5; // 5 x 100 = 500 rows max per call
const PAGE_LIMIT = 100;
const TEAM_SET = new Set<string>(TEAM_AGENTS);

async function fetchAllQaResults(params: {
  env: string;
  days: number;
  agent?: string;
}): Promise<QaResultRow[]> {
  const collected: QaResultRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await apiGet<QaResultRow[]>('/api/kpi-data/qa-results', {
      env: params.env,
      days: params.days,
      page,
      limit: PAGE_LIMIT,
      agent: params.agent,
    });
    if (!batch || batch.length === 0) break;
    collected.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
  }
  return collected;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export async function qaDeepDive(args: { agent?: string; days: number }): Promise<CallToolResult> {
  const { agent } = args;
  const days = Math.min(Math.max(args.days, 1), 365);
  const env = getEnv();

  if (agent && !TEAM_SET.has(agent)) {
    return toolError(`"${agent}" is not in TEAM_AGENTS. Valid agents: ${TEAM_AGENTS.join(', ')}`);
  }

  let rows: QaResultRow[];
  try {
    rows = await fetchAllQaResults({ env, days, agent });
  } catch (err) {
    return toolError(`Failed to fetch qa-results: ${err instanceof Error ? err.message : err}`);
  }

  // If fetching the whole team, constrain to TEAM_AGENTS so the aggregations
  // exclude non-team noise (QA results can be scored for anyone in Jira).
  if (!agent) rows = rows.filter((r) => TEAM_SET.has(r.assigneeName));

  const totalScored = rows.length;
  if (totalScored === 0) {
    return toolError(`No QA data found${agent ? ` for ${agent}` : ''} in the last ${days} days.`);
  }

  // Distribution by grade
  const gradeCounts = new Map<string, number>();
  for (const r of rows) {
    gradeCounts.set(r.grade, (gradeCounts.get(r.grade) ?? 0) + 1);
  }
  const distribution: Record<string, { count: number; pct: number }> = {};
  for (const [g, c] of gradeCounts.entries()) {
    distribution[g] = { count: c, pct: Math.round((c / totalScored) * 1000) / 10 };
  }

  // Dimension averages
  const dimensions = {
    overall: Math.round(mean(rows.map((r) => n(r.overallScore))) * 100) / 100,
    accuracy: Math.round(mean(rows.map((r) => n(r.accuracyScore))) * 100) / 100,
    clarity: Math.round(mean(rows.map((r) => n(r.clarityScore))) * 100) / 100,
    tone: Math.round(mean(rows.map((r) => n(r.toneScore))) * 100) / 100,
  };

  // Category breakdown
  const catMap = new Map<string, number[]>();
  for (const r of rows) {
    const cat = r.category;
    if (!cat) continue;
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat)!.push(n(r.overallScore));
  }
  const categoryBreakdown = Array.from(catMap.entries())
    .map(([category, vals]) => ({
      category,
      avgScore: Math.round(mean(vals) * 100) / 100,
      cnt: vals.length,
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  // Concerning tickets
  const concerningRows = rows.filter((r) => n(r.isConcerning) === 1);

  // Golden rules
  let gr: GoldenSummary;
  try {
    gr = await apiGet<GoldenSummary>('/api/kpi-data/qa-golden-summary', { env, days });
  } catch (err) {
    return toolError(`Failed to fetch qa-golden-summary: ${err instanceof Error ? err.message : err}`);
  }
  const grTotal = n(gr.total);
  const goldenRules = {
    totalChecks: grTotal,
    rule1_ownership: grTotal > 0 ? Math.round((n(gr.rule1Pass) / grTotal) * 1000) / 10 : 0,
    rule2_nextAction: grTotal > 0 ? Math.round((n(gr.rule2Pass) / grTotal) * 1000) / 10 : 0,
    rule3_timeframe: grTotal > 0 ? Math.round((n(gr.rule3Pass) / grTotal) * 1000) / 10 : 0,
    averageScore: Math.round(n(gr.avgScore) * 100) / 100,
  };

  // Agent vs team comparison
  let vsTeam: Record<string, { agent: number; team: number }> | null = null;
  if (agent) {
    try {
      const teamRows = (await fetchAllQaResults({ env, days })).filter((r) => TEAM_SET.has(r.assigneeName));
      if (teamRows.length > 0) {
        vsTeam = {
          overall: {
            agent: dimensions.overall,
            team: Math.round(mean(teamRows.map((r) => n(r.overallScore))) * 100) / 100,
          },
          accuracy: {
            agent: dimensions.accuracy,
            team: Math.round(mean(teamRows.map((r) => n(r.accuracyScore))) * 100) / 100,
          },
          clarity: {
            agent: dimensions.clarity,
            team: Math.round(mean(teamRows.map((r) => n(r.clarityScore))) * 100) / 100,
          },
          tone: {
            agent: dimensions.tone,
            team: Math.round(mean(teamRows.map((r) => n(r.toneScore))) * 100) / 100,
          },
        };
      }
    } catch {
      vsTeam = null;
    }
  }

  const dimEntries = [
    { dimension: 'accuracy', score: dimensions.accuracy },
    { dimension: 'clarity', score: dimensions.clarity },
    { dimension: 'tone', score: dimensions.tone },
  ].sort((a, b) => a.score - b.score);
  const coachingPriority = dimEntries[0].dimension;

  const who = agent ?? 'the team';
  const summary =
    `QA deep dive for ${who} (last ${days} days): ${totalScored} tickets scored. ` +
    `Overall avg: ${dimensions.overall}/10. ` +
    `Distribution: ${Object.entries(distribution)
      .map(([g, d]) => `${g} ${d.pct}%`)
      .join(', ')}. ` +
    `${concerningRows.length} concerning ticket(s). ` +
    `Golden Rules avg: ${goldenRules.averageScore}/3, pass rates — ownership ${goldenRules.rule1_ownership}%, ` +
    `next action ${goldenRules.rule2_nextAction}%, timeframe ${goldenRules.rule3_timeframe}%. ` +
    `Coaching priority: ${coachingPriority} (lowest at ${dimEntries[0].score}).`;

  return toolResult(summary, {
    agent: agent ?? 'all',
    totalScored,
    sampledRows: totalScored, // cap note: up to 500 rows per agent/team
    distribution,
    dimensions,
    categoryBreakdown,
    concerningTickets: {
      count: concerningRows.length,
      issues: concerningRows.slice(0, 20).map((r) => ({
        issueKey: r.issueKey,
        overallScore: n(r.overallScore),
        assigneeName: r.assigneeName,
      })),
    },
    goldenRules,
    vsTeam,
    coachingPriority: dimEntries,
  });
}
