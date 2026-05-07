import { z } from 'zod';
import { apiGet, getEnv } from '../auth.js';
import { TEAM_AGENTS } from '../constants.js';
import { toolResult, mean } from './helpers.js';
export const focusAreasSchema = {
    days: z.number().default(14).describe('Number of days to look back (default 14, max 90)'),
};
const TEAM_SET = new Set(TEAM_AGENTS);
function groupByKpi(rows) {
    const out = new Map();
    for (const r of rows) {
        if (!out.has(r.kpi))
            out.set(r.kpi, []);
        out.get(r.kpi).push(r);
    }
    return out;
}
export async function focusAreas(args) {
    const days = Math.min(Math.max(args.days, 1), 90);
    const env = getEnv();
    const items = [];
    // Fetch data
    const [history, qaAgents, golden] = await Promise.all([
        apiGet('/api/kpi-data/daily-history', { env, days }),
        apiGet('/api/kpi-data/qa-agents', { env, days }),
        apiGet('/api/kpi-data/qa-golden-summary', { env, days }),
    ]);
    const byKpi = groupByKpi(history);
    const kpiAggs = [];
    for (const [kpi, rs] of byKpi.entries()) {
        const targets = rs.map((r) => r.target).filter((t) => t != null && t > 0);
        if (targets.length === 0)
            continue;
        const target = mean(targets);
        const avgCount = mean(rs.map((r) => Number(r.count) || 0));
        const direction = rs.find((r) => r.direction)?.direction ?? 'higher is better';
        const lowerIsBetter = direction.toLowerCase().includes('lower');
        const breaching = lowerIsBetter ? avgCount > target * 1.1 : avgCount < target * 0.9;
        if (breaching)
            kpiAggs.push({ kpi, avgCount, target, direction });
    }
    kpiAggs.sort((a, b) => Math.abs(b.avgCount - b.target) / b.target - Math.abs(a.avgCount - a.target) / a.target);
    for (const row of kpiAggs.slice(0, 5)) {
        const lowerIsBetter = row.direction.toLowerCase().includes('lower');
        const gap = lowerIsBetter
            ? ((row.avgCount - row.target) / row.target) * 100
            : ((row.target - row.avgCount) / row.target) * 100;
        items.push({
            severity: gap > 20 ? 'red' : 'amber',
            area: row.kpi,
            metric: Math.round(row.avgCount * 100) / 100,
            target: Math.round(row.target * 100) / 100,
            gap: Math.round(gap * 10) / 10,
            action: lowerIsBetter
                ? `Reduce ${row.kpi} — currently ${Math.round(gap)}% above target.`
                : `Improve ${row.kpi} — currently ${Math.round(gap)}% below target.`,
        });
    }
    // 2. QA averages below 7.0 by agent
    const qaLow = qaAgents
        .filter((r) => TEAM_SET.has(r.assigneeName))
        .map((r) => ({ assigneeName: r.assigneeName, avgScore: Number(r.avgScore) || 0 }))
        .filter((r) => r.avgScore > 0 && r.avgScore < 7.0)
        .sort((a, b) => a.avgScore - b.avgScore);
    for (const row of qaLow.slice(0, 3)) {
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
    const grTotal = Number(golden?.total ?? 0);
    if (grTotal > 0) {
        const rules = [
            { label: 'Rule 1 (Ownership)', pass: Number(golden.rule1Pass ?? 0) },
            { label: 'Rule 2 (Next Action)', pass: Number(golden.rule2Pass ?? 0) },
            { label: 'Rule 3 (Timeframe)', pass: Number(golden.rule3Pass ?? 0) },
        ];
        for (const r of rules) {
            const passRate = (r.pass / grTotal) * 100;
            if (passRate < 70) {
                items.push({
                    severity: passRate < 50 ? 'red' : 'amber',
                    area: `Golden Rules: ${r.label}`,
                    metric: Math.round(passRate * 10) / 10,
                    target: 70,
                    gap: Math.round((70 - passRate) * 10) / 10,
                    action: `Focus team on ${r.label} — pass rate ${passRate.toFixed(0)}% is below 70% threshold.`,
                });
            }
        }
    }
    // 4. Week-on-week deterioration (needs ≥ 14 days of data)
    const now = Date.now();
    const oneWeekMs = 7 * 86400_000;
    const thisWeekRows = [];
    const lastWeekRows = [];
    for (const r of history) {
        const t = new Date(r.CreatedAt).getTime();
        if (t >= now - oneWeekMs)
            thisWeekRows.push(r);
        else if (t >= now - 2 * oneWeekMs)
            lastWeekRows.push(r);
    }
    const thisByKpi = groupByKpi(thisWeekRows);
    const lastByKpi = groupByKpi(lastWeekRows);
    const wowCandidates = [];
    for (const [kpi, rs] of thisByKpi.entries()) {
        const last = lastByKpi.get(kpi);
        if (!last || last.length === 0)
            continue;
        const thisAvg = mean(rs.map((r) => Number(r.count) || 0));
        const lastAvg = mean(last.map((r) => Number(r.count) || 0));
        if (lastAvg <= 0)
            continue;
        const direction = rs.find((r) => r.direction)?.direction ?? 'higher is better';
        const lowerIsBetter = direction.toLowerCase().includes('lower');
        const deteriorated = lowerIsBetter ? thisAvg > lastAvg * 1.15 : thisAvg < lastAvg * 0.85;
        if (deteriorated)
            wowCandidates.push({ kpi, thisWeek: thisAvg, lastWeek: lastAvg, direction });
    }
    for (const row of wowCandidates.slice(0, 3)) {
        const lowerIsBetter = row.direction.toLowerCase().includes('lower');
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
    const slaAggs = [];
    for (const [kpi, rs] of byKpi.entries()) {
        const isSla = rs.some((r) => (r.kpiGroup ?? '') === 'SLA') || /over sla/i.test(kpi);
        if (!isSla)
            continue;
        const counts = rs.map((r) => Number(r.count) || 0).filter((v) => v > 0);
        if (counts.length === 0)
            continue;
        slaAggs.push({ kpi, avgCount: mean(counts) });
    }
    slaAggs.sort((a, b) => b.avgCount - a.avgCount);
    for (const row of slaAggs.slice(0, 2)) {
        items.push({
            severity: row.avgCount > 5 ? 'red' : 'amber',
            area: `SLA: ${row.kpi}`,
            metric: Math.round(row.avgCount * 100) / 100,
            target: 0,
            gap: null,
            action: `Average ${row.avgCount.toFixed(1)} tickets over SLA for "${row.kpi}" — prioritise clearing the backlog.`,
        });
    }
    // Sort: red first, then by gap descending
    items.sort((a, b) => {
        if (a.severity !== b.severity)
            return a.severity === 'red' ? -1 : 1;
        return (b.gap ?? 0) - (a.gap ?? 0);
    });
    const top5 = items.slice(0, 5);
    const summary = top5.length === 0
        ? 'No significant focus areas identified — all KPIs appear healthy.'
        : `Top ${top5.length} focus areas: ${top5
            .map((f, i) => `${i + 1}. ${f.area} (${f.severity.toUpperCase()}: ${f.metric}${f.target !== null ? ` vs target ${f.target}` : ''})`)
            .join('; ')}. ${top5.filter((f) => f.severity === 'red').length} red, ${top5.filter((f) => f.severity === 'amber').length} amber.`;
    return toolResult(summary, { focusAreas: top5, totalCandidates: items.length });
}
//# sourceMappingURL=focus-areas.js.map