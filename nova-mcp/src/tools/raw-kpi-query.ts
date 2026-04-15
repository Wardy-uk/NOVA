import { z } from 'zod';
import { query } from '../db.js';
import { toolResult, toolError } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const rawKpiQuerySchema = {
  kpi_pattern: z.string().describe('KPI name pattern (LIKE syntax, e.g. "%FRT%")'),
  days: z.number().default(30).describe('Number of days to look back (default 30)'),
};

const INJECTION_PATTERN = /[';]|--|\/\*/;

export async function rawKpiQuery(args: {
  kpi_pattern: string;
  days: number;
}): Promise<CallToolResult> {
  const { kpi_pattern, days } = args;

  if (INJECTION_PATTERN.test(kpi_pattern)) {
    return toolError('Pattern contains disallowed characters. Remove any single quotes, semicolons, --, or /* sequences.');
  }

  const rows = await query<Array<{
    kpi: string; count: number; target: number | null;
    direction: string | null; rag: string | null; CreatedAt: Date;
  }>>(
    `SELECT kpi, [count], target, direction, rag, CreatedAt
     FROM dbo.jira_kpi_daily
     WHERE kpi LIKE @pattern
       AND CreatedAt >= DATEADD(day, -@days, GETDATE())
     ORDER BY kpi, CreatedAt ASC`,
    { pattern: kpi_pattern, days },
  );

  if (rows.length === 0) {
    return toolError(`No rows matched pattern "${kpi_pattern}" in the last ${days} days.`);
  }

  // Group by kpi name
  const grouped = new Map<string, Array<{ date: string; value: number; target: number | null; rag: string | null }>>();
  for (const row of rows) {
    if (!grouped.has(row.kpi)) grouped.set(row.kpi, []);
    grouped.get(row.kpi)!.push({
      date: new Date(row.CreatedAt).toISOString().slice(0, 10),
      value: row.count,
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
