import { z } from 'zod';
import { apiGet, getEnv } from '../auth.js';
import { TEAM_AGENTS } from '../constants.js';
import { toolResult, toolError, mean, stddev } from './helpers.js';
export const agentComparisonSchema = {
    metric: z
        .enum(['qa_score', 'open_tickets', 'solved_today', 'over_2h', 'no_update'])
        .describe('Metric to compare agents on'),
    days: z.number().default(30).describe('Number of days to look back (default 30, max 90)'),
};
const METRIC_COLUMNS = {
    open_tickets: 'OpenTickets_Total',
    solved_today: 'SolvedTickets_Today',
    over_2h: 'OpenTickets_Over2Hours',
    no_update: 'OpenTickets_NoUpdateToday',
};
const TEAM_SET = new Set(TEAM_AGENTS);
export async function agentComparison(args) {
    const { metric } = args;
    const days = Math.min(Math.max(args.days, 1), 90);
    const env = getEnv();
    let rows = [];
    if (metric === 'qa_score') {
        try {
            const qa = await apiGet('/api/kpi-data/qa-agents', { env, days });
            rows = qa
                .filter((r) => TEAM_SET.has(r.assigneeName))
                .map((r) => ({ AgentName: r.assigneeName, value: Number(r.avgScore) || 0 }))
                .sort((a, b) => b.value - a.value);
        }
        catch (err) {
            return toolError(`Failed to fetch qa-agents: ${err instanceof Error ? err.message : err}`);
        }
    }
    else {
        const col = METRIC_COLUMNS[metric];
        if (!col)
            return toolError(`Unknown metric: ${metric}`);
        let raw;
        try {
            raw = await apiGet('/api/kpi-data/agent-daily', { env, days });
        }
        catch (err) {
            return toolError(`Failed to fetch agent-daily: ${err instanceof Error ? err.message : err}`);
        }
        // Aggregate: average <col> per agent across the returned date range.
        const acc = new Map();
        for (const r of raw) {
            if (!r.AgentName || !TEAM_SET.has(r.AgentName))
                continue;
            const v = Number(r[col] ?? 0);
            if (!Number.isFinite(v))
                continue;
            if (!acc.has(r.AgentName))
                acc.set(r.AgentName, []);
            acc.get(r.AgentName).push(v);
        }
        rows = Array.from(acc.entries()).map(([name, vals]) => ({
            AgentName: name,
            value: mean(vals),
        }));
        // For solved_today, higher is better. For everything else (over_2h, no_update,
        // open_tickets), lower is better.
        const desc = metric === 'solved_today';
        rows.sort((a, b) => (desc ? b.value - a.value : a.value - b.value));
    }
    if (rows.length === 0) {
        return toolError(`No data found for metric "${metric}" in the last ${days} days.`);
    }
    const values = rows.map((r) => r.value);
    const teamAvg = Math.round(mean(values) * 100) / 100;
    const sd = stddev(values);
    const ranked = rows.map((r, i) => {
        const val = Math.round(r.value * 100) / 100;
        const diff = val - teamAvg;
        let status;
        if (Math.abs(diff) < 0.01)
            status = 'at_average';
        else if (metric === 'qa_score' || metric === 'solved_today') {
            status = diff > 0 ? 'above_average' : 'below_average';
        }
        else {
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
    const outliers = ranked.filter((r) => r.isOutlier).map((r) => r.agent);
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
//# sourceMappingURL=agent-comparison.js.map