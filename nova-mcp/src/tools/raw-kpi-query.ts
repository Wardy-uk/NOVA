import { z } from 'zod';
import { apiGet, getEnv } from '../auth.js';
import { toolResult, toolError } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const rawKpiQuerySchema = {
  kpi_pattern: z
    .string()
    .describe('KPI name pattern (SQL-LIKE syntax, e.g. "%FRT%"). Percent signs are converted to a case-insensitive substring match client-side.'),
  days: z.number().default(30).describe('Number of days to look back (default 30, max 90)'),
};

const INJECTION_PATTERN = /[';]|--|\/\*/;

interface DailyRow {
  kpi: string;
  count: number;
  target: number | null;
  direction: string | null;
  rag: string | null;
  CreatedAt: string;
}

/** Convert a SQL LIKE pattern (with % and _) into a RegExp anchored ^...$. */
function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const rx = escaped.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${rx}$`, 'i');
}

export async function rawKpiQuery(args: {
  kpi_pattern: string;
  days: number;
}): Promise<CallToolResult> {
  const { kpi_pattern } = args;
  const days = Math.min(Math.max(args.days, 1), 90);

  if (INJECTION_PATTERN.test(kpi_pattern)) {
    return toolError(
      'Pattern contains disallowed characters. Remove any single quotes, semicolons, --, or /* sequences.',
    );
  }

  let all: DailyRow[];
  try {
    all = await apiGet<DailyRow[]>('/api/kpi-data/daily-history', { env: getEnv(), days });
  } catch (err) {
    return toolError(`Failed to fetch daily-history: ${err instanceof Error ? err.message : err}`);
  }

  const matcher = likeToRegExp(kpi_pattern);
  const rows = all
    .filter((r) => matcher.test(r.kpi ?? ''))
    .sort((a, b) => {
      if (a.kpi !== b.kpi) return a.kpi.localeCompare(b.kpi);
      return new Date(a.CreatedAt).getTime() - new Date(b.CreatedAt).getTime();
    });

  if (rows.length === 0) {
    return toolError(`No rows matched pattern "${kpi_pattern}" in the last ${days} days.`);
  }

  const grouped = new Map<
    string,
    Array<{ date: string; value: number; target: number | null; rag: string | null }>
  >();
  for (const row of rows) {
    if (!grouped.has(row.kpi)) grouped.set(row.kpi, []);
    grouped.get(row.kpi)!.push({
      date: new Date(row.CreatedAt).toISOString().slice(0, 10),
      value: Number(row.count),
      target: row.target,
      rag: row.rag,
    });
  }

  const kpiNames = Array.from(grouped.keys());
  const summary = `Found ${rows.length} rows across ${kpiNames.length} KPI(s) matching "${kpi_pattern}": ${kpiNames.join(', ')}.`;

  return toolResult(summary, {
    pattern: kpi_pattern,
    days,
    totalRows: rows.length,
    kpis: Object.fromEntries(grouped),
  });
}
