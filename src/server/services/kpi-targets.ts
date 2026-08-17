/**
 * KPI target fallbacks — the targets n8n does not write.
 *
 * n8n writes 0/null into `target` for a set of KPIs, which makes them
 * unratable: a compliance KPI with target 0 is green at 0%. The dashboard has
 * carried this table since the KPI board was built.
 *
 * It lives here, rather than inline, because it is now read by three callers —
 * the live snapshot, the EOD snapshot, and NEURO's weekly risk report over the
 * bridge. The report's headline is a count of red vs green KPIs, so a fourth
 * copy drifting by one target is a report that quietly disagrees with the board
 * Nick is looking at while he reads it.
 */

export interface TargetFallback {
  target: number;
  direction: string;
}

/** Exact KPI-name matches. Keys are lowercase; callers trim + lowercase. */
export const TARGET_FALLBACKS: Record<string, TargetFallback> = {
  'frt compliance % (open queue)': { target: 95, direction: 'higher is better' },
  'frt compliance % (resolved today)': { target: 95, direction: 'higher is better' },
  'resolution compliance % (open queue)': { target: 95, direction: 'higher is better' },
  'resolution compliance % (resolved today)': { target: 95, direction: 'higher is better' },
  'cc incidents over sla (actionable)': { target: 0, direction: 'lower is better' },
  'cc service requests over sla (actionable)': { target: 0, direction: 'lower is better' },
  'cc tpj over sla (actionable)': { target: 0, direction: 'lower is better' },
  'cc (tpj) over sla (actionable)': { target: 0, direction: 'lower is better' },
  'production over sla (actionable)': { target: 0, direction: 'lower is better' },
  'tier 2 over sla (actionable)': { target: 0, direction: 'lower is better' },
  'tier 3 over sla (actionable)': { target: 0, direction: 'lower is better' },
  'development over sla (actionable)': { target: 0, direction: 'lower is better' },
  'new tickets today': { target: 110, direction: 'lower is better' },
};

/** Catch name variants the exact table misses. */
export const PATTERN_FALLBACKS: { pattern: RegExp; target: number; direction: string }[] = [
  { pattern: /frt compliance/i, target: 95, direction: 'higher is better' },
  { pattern: /resolution compliance/i, target: 95, direction: 'higher is better' },
  { pattern: /over sla \(actionable\)/i, target: 0, direction: 'lower is better' },
];

interface KpiRow {
  KPI?: string;
  KPITarget?: number | null;
  KPIDirection?: string | null;
  [k: string]: unknown;
}

/**
 * Fill in KPITarget/KPIDirection where n8n left them 0 or null. Mutates in
 * place and returns the same array, matching how the callers already use it.
 */
export function applyTargetFallbacks<T extends KpiRow>(rows: T[]): T[] {
  for (const row of rows) {
    if (row.KPITarget && row.KPITarget !== 0) continue;
    const name = (row.KPI || '').toLowerCase().trim();
    const fb = TARGET_FALLBACKS[name];
    if (fb) {
      row.KPITarget = fb.target;
      if (!row.KPIDirection) row.KPIDirection = fb.direction;
      continue;
    }
    const pf = PATTERN_FALLBACKS.find(p => p.pattern.test(row.KPI || ''));
    if (pf) {
      row.KPITarget = pf.target;
      if (!row.KPIDirection) row.KPIDirection = pf.direction;
    }
  }
  return rows;
}
