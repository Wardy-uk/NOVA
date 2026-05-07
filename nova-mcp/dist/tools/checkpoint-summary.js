import { z } from 'zod';
import { apiGet, getEnv } from '../auth.js';
import { TEAM_AGENTS, CHECKPOINT_DATES } from '../constants.js';
import { toolResult, toolError, ragStatus, mean } from './helpers.js';
export const checkpointSummarySchema = {
    env: z.enum(['live', 'uat']).default('live').describe('Environment (default live)'),
};
function getMonday() {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - ((day + 6) % 7));
    return d.toISOString().slice(0, 10);
}
function getFirstOfMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function today() {
    return new Date().toISOString().slice(0, 10);
}
function n(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}
function inRange(dateStr, start, end) {
    const d = dateStr.slice(0, 10);
    return d >= start && d <= end;
}
const TEAM_SET = new Set(TEAM_AGENTS);
async function fetchAllPaged(path, base) {
    const out = [];
    for (let page = 1; page <= 5; page++) {
        const batch = await apiGet(path, { ...base, page, limit: 100 });
        if (!batch || batch.length === 0)
            break;
        out.push(...batch);
        if (batch.length < 100)
            break;
    }
    return out;
}
export async function checkpointSummary(args) {
    const env = args.env || getEnv();
    const periodRanges = {
        day0: { start: CHECKPOINT_DATES.day0, end: CHECKPOINT_DATES.day0 },
        day1: { start: CHECKPOINT_DATES.day1, end: CHECKPOINT_DATES.day1 },
        day15: { start: CHECKPOINT_DATES.day15, end: CHECKPOINT_DATES.day15 },
        day30: { start: CHECKPOINT_DATES.day30, end: CHECKPOINT_DATES.day30 },
        wtd: { start: getMonday(), end: today() },
        mtd: { start: getFirstOfMonth(), end: today() },
    };
    // Compute overall fetch window: earliest start across all periods → today
    const starts = Object.values(periodRanges).map((r) => r.start).sort();
    const earliest = starts[0];
    const latest = today();
    // Number of days back from today (for qa-results/golden which don't support from/to)
    const daysBack = Math.max(1, Math.ceil((new Date(latest).getTime() - new Date(earliest).getTime()) / 86400_000) + 1);
    const qaDays = Math.min(daysBack + 2, 365);
    // Fetch all data up-front
    let history;
    let qaRows;
    let grRows;
    try {
        [history, qaRows, grRows] = await Promise.all([
            apiGet('/api/kpi-data/daily-history', { env, from: earliest, to: latest }),
            fetchAllPaged('/api/kpi-data/qa-results', { env, days: qaDays }),
            fetchAllPaged('/api/kpi-data/qa-golden-results', { env, days: qaDays }),
        ]);
    }
    catch (err) {
        return toolError(`Failed to fetch checkpoint data: ${err instanceof Error ? err.message : err}`);
    }
    const metrics = [
        { metric: 'FRT Compliance %', target: 90, lowerIsBetter: false, periods: {} },
        { metric: 'Resolution Compliance %', target: 85, lowerIsBetter: false, periods: {} },
        { metric: 'Team QA Average', target: 7.0, lowerIsBetter: false, periods: {} },
        { metric: 'Golden Rules Avg %', target: 70, lowerIsBetter: false, periods: {} },
        { metric: 'Total Queue Size', target: null, lowerIsBetter: true, periods: {} },
        { metric: 'Oldest Support Ticket', target: null, lowerIsBetter: true, periods: {} },
    ];
    for (const m of metrics) {
        m.periods = {};
        for (const pk of Object.keys(periodRanges)) {
            m.periods[pk] = { value: null, rag: null };
        }
    }
    for (const [pk, range] of Object.entries(periodRanges)) {
        const hRows = history.filter((r) => inRange(r.CreatedAt, range.start, range.end));
        // FRT Compliance
        let frtMet = 0;
        let frtBreached = 0;
        for (const r of hRows) {
            if (/^FRT Met/i.test(r.kpi))
                frtMet += n(r.count);
            else if (/^FRT Breached/i.test(r.kpi))
                frtBreached += n(r.count);
        }
        const frtTotal = frtMet + frtBreached;
        if (frtTotal > 0) {
            const val = Math.round((frtMet / frtTotal) * 1000) / 10;
            metrics[0].periods[pk] = { value: val, rag: ragStatus(val, 90, false) };
        }
        // Resolution Compliance
        let resMet = 0;
        let resBreached = 0;
        for (const r of hRows) {
            if (/^Resolution Met/i.test(r.kpi))
                resMet += n(r.count);
            else if (/^Resolution Breached/i.test(r.kpi))
                resBreached += n(r.count);
        }
        const resTotal = resMet + resBreached;
        if (resTotal > 0) {
            const val = Math.round((resMet / resTotal) * 1000) / 10;
            metrics[1].periods[pk] = { value: val, rag: ragStatus(val, 85, false) };
        }
        // Team QA Average
        const qaInRange = qaRows.filter((r) => TEAM_SET.has(r.assigneeName) && inRange(r.processedAt, range.start, range.end));
        if (qaInRange.length > 0) {
            const val = Math.round(mean(qaInRange.map((r) => n(r.overallScore))) * 100) / 100;
            metrics[2].periods[pk] = { value: val, rag: ragStatus(val, 7.0, false) };
        }
        // Golden Rules Avg %
        const grInRange = grRows.filter((r) => {
            const updater = r.Updater ?? r.assigneeName ?? '';
            return TEAM_SET.has(updater) && inRange(r.processedAt, range.start, range.end);
        });
        if (grInRange.length > 0) {
            const avgPct = mean(grInRange.map((r) => ((n(r.rule1Pass) + n(r.rule2Pass) + n(r.rule3Pass)) / 3) * 100));
            const val = Math.round(avgPct * 10) / 10;
            metrics[3].periods[pk] = { value: val, rag: ragStatus(val, 70, false) };
        }
        // Total Queue Size — use latest date in range where there are "Number of Tickets in%" rows
        const queueRows = hRows.filter((r) => /^Number of Tickets in/i.test(r.kpi));
        if (queueRows.length > 0) {
            queueRows.sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt));
            const latestDate = queueRows[0].CreatedAt.slice(0, 10);
            const total = queueRows
                .filter((r) => r.CreatedAt.slice(0, 10) === latestDate)
                .reduce((s, r) => s + n(r.count), 0);
            metrics[4].periods[pk] = { value: total, rag: null };
        }
        // Oldest Support Ticket
        const oldestRows = hRows.filter((r) => /^Oldest actionable ticket/i.test(r.kpi));
        if (oldestRows.length > 0) {
            oldestRows.sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt));
            const latestDate = oldestRows[0].CreatedAt.slice(0, 10);
            const maxAge = Math.max(...oldestRows.filter((r) => r.CreatedAt.slice(0, 10) === latestDate).map((r) => n(r.count)));
            metrics[5].periods[pk] = { value: maxAge, rag: null };
        }
    }
    const changes = [];
    for (const m of metrics) {
        const d1 = m.periods.day1.value;
        const latestVal = m.periods.wtd.value ?? m.periods.mtd.value;
        if (d1 !== null && latestVal !== null) {
            const diff = latestVal - d1;
            if (Math.abs(diff) > 0.1) {
                const dir = (m.lowerIsBetter ? diff < 0 : diff > 0) ? 'improved' : 'worsened';
                changes.push(`${m.metric} ${dir} from ${d1} to ${latestVal}`);
            }
        }
    }
    const summary = `Checkpoint summary across the 90-day framework. ` +
        `${changes.length > 0 ? `Since Day 1: ${changes.join('; ')}.` : 'No significant movement since Day 1.'}`;
    return toolResult(summary, {
        periodDates: periodRanges,
        matrix: metrics.map((m) => ({
            metric: m.metric,
            target: m.target,
            ...m.periods,
        })),
    });
}
//# sourceMappingURL=checkpoint-summary.js.map