/**
 * SLA reference matrix, derived from live Jira data.
 *
 * Jira Cloud does not expose SLA *configuration* through a public REST API, so
 * we derive the effective goals from the SLA custom fields that Jira stamps on
 * each issue: cf14046 = First Reply Time, cf14048 = Resolution. Each field's
 * value carries the goalDuration Jira applied for that ticket's priority — so
 * sampling recent NT tickets and grouping the goal durations by priority yields
 * an accurate, self-updating matrix.
 *
 * Result is cached in-process (goals change rarely); admins see it on the
 * portal About page. A priority only appears once at least one recent ticket
 * carried it, so brand-new/unused priorities may be absent until seen.
 */
import type { JiraRestClient } from './jira-client.js';

export interface SlaMatrixRow {
  priority: string;
  firstResponse: string | null;
  resolution: string | null;
  sample: number;
}
export interface SlaMatrix {
  rows: SlaMatrixRow[];
  sampledTickets: number;
  derivedAt: string;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — goals change rarely
let cache: { ts: number; matrix: SlaMatrix } | null = null;

/** Pull the friendly goal duration (e.g. "8h") from an SLA custom-field value.
 *  Prefers the ongoing cycle, else the most recent completed cycle. */
function goalFriendly(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { ongoingCycle?: unknown; completedCycles?: unknown };
  const completed = Array.isArray(o.completedCycles) ? o.completedCycles : [];
  const cycle = (o.ongoingCycle as Record<string, unknown> | undefined)
    || (completed.length ? (completed[completed.length - 1] as Record<string, unknown>) : undefined);
  const goal = cycle?.goalDuration as { friendly?: unknown } | undefined;
  const friendly = goal?.friendly;
  return typeof friendly === 'string' && friendly.trim() ? friendly.trim() : null;
}

/** Most frequent value in a tally, or null if empty. */
function mode(tally: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of tally) { if (n > bestN) { best = k; bestN = n; } }
  return best;
}

export async function getSlaMatrix(jira: JiraRestClient, opts?: { force?: boolean }): Promise<SlaMatrix> {
  if (!opts?.force && cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.matrix;

  const jql = 'project = NT AND created >= -120d ORDER BY created DESC';
  const res = await jira.searchJqlAll(jql, ['priority', 'customfield_14046', 'customfield_14048'], 500);

  // priority → metric → (goal friendly → count)
  const byPriority = new Map<string, { frt: Map<string, number>; res: Map<string, number>; n: number }>();
  const bump = (m: Map<string, number>, key: string | null) => { if (key) m.set(key, (m.get(key) || 0) + 1); };

  for (const iss of res.issues) {
    const f = (iss.fields ?? {}) as Record<string, unknown>;
    const priority = ((f.priority as { name?: string } | undefined)?.name || 'Unspecified').trim();
    const frt = goalFriendly(f.customfield_14046);
    const resolution = goalFriendly(f.customfield_14048);
    if (!frt && !resolution) continue;
    let row = byPriority.get(priority);
    if (!row) { row = { frt: new Map(), res: new Map(), n: 0 }; byPriority.set(priority, row); }
    row.n++;
    bump(row.frt, frt);
    bump(row.res, resolution);
  }

  const rows: SlaMatrixRow[] = [...byPriority.entries()]
    .map(([priority, r]) => ({ priority, firstResponse: mode(r.frt), resolution: mode(r.res), sample: r.n }))
    .sort((a, b) => b.sample - a.sample);

  const matrix: SlaMatrix = {
    rows,
    sampledTickets: res.issues.length,
    derivedAt: new Date().toISOString(),
  };
  cache = { ts: Date.now(), matrix };
  return matrix;
}
