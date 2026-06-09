// Legacy tier-slice metrics for the like-for-like rebuild wallboards (Customer
// Care, Technical Support). These mirror the ORIGINAL wallboard panels — sliced
// by the legacy tiers (CC Incidents/SRs/TPJ, Production, Tier 2, Dev+Tier 3) —
// but computed fresh via the new engine using the agreed correct conditions
// (NT open-filter, isNoReply, resolution-SLA-breached + actionable). 60s-cached.

import type { JiraRestClient } from '../jira-client.js';
import { NT_OPEN, NOT_ACTIONABLE_STATUSES, RESOLUTION_SLA_NAME, DUE_GATE } from './registry.js';
import { countNoReply } from './nt-compute.js';

const NOT_ACTIONABLE_LIST = NOT_ACTIONABLE_STATUSES.map(s => `"${s}"`).join(', ');
const RES_BREACHED = `"${RESOLUTION_SLA_NAME}" = breached()`;
const ACTIONABLE = `status not in (${NOT_ACTIONABLE_LIST})`;

export interface TierBucket {
  key: string;
  label: string;
  /** JQL filter for the bucket (combined with NT_OPEN). */
  filter: string;
}

// Legacy slicing (from kpi-pipeline ccBucket/classifyTier), expressed against
// the canonical request-type field (cf12800, "(NT)"-suffixed) and CurrentTier (cf12981).
export const TIER_BUCKETS: TierBucket[] = [
  { key: 'cc_incidents', label: 'CC Incidents',
    filter: `cf[12981] = "Customer Care" AND cf[12800] not in ("Service Request (NT)", "TPJ Request (NT)")` },
  { key: 'cc_service_requests', label: 'CC Service Requests',
    filter: `cf[12981] = "Customer Care" AND cf[12800] = "Service Request (NT)"` },
  { key: 'cc_tpj', label: 'Property Jungle',
    filter: `cf[12981] = "Customer Care" AND cf[12800] = "TPJ Request (NT)"` },
  { key: 'production', label: 'Production', filter: `cf[12981] = "Production"` },
  { key: 'tier2', label: 'Tier 2', filter: `cf[12981] = "Tier 2"` },
  { key: 'development', label: 'Development', filter: `cf[12981] in ("Development", "Tier 3")` },
];

export interface TierStat { active: number | null; noReply: number | null; overSla: number | null; }
export interface TierSnapshot { updatedAt: number; tiers: Record<string, TierStat>; }

/**
 * Customer cohort for the Key Accounts / Customer Success boards. The legacy
 * boards split tickets by the Key_Account / Enterprise_Account labels; we
 * reproduce that here as a JQL clause layered on top of the tier buckets.
 */
export type Cohort = 'all' | 'key_accounts' | 'customer_success';
export type TierStatKind = 'active' | 'noReply' | 'overSla';

const COHORT_FILTER: Record<Cohort, string> = {
  all: '',
  key_accounts: 'labels in (Key_Account, Enterprise_Account)',
  customer_success: '(labels not in (Key_Account, Enterprise_Account) OR labels is EMPTY)',
};

/**
 * Canonical JQL for a single tile (bucket × stat × cohort). The SAME builder
 * feeds both the snapshot counts and the drill-down ticket list, so a tile's
 * number always equals what its drill lists. For `noReply` the JQL is the open
 * bucket base — the isNoReply predicate is applied in code by both paths.
 */
export function tierTileJql(bucketKey: string, stat: TierStatKind, cohort: Cohort = 'all'): string | null {
  const b = TIER_BUCKETS.find(x => x.key === bucketKey);
  if (!b) return null;
  const cohortClause = COHORT_FILTER[cohort] ? ` AND ${COHORT_FILTER[cohort]}` : '';
  const base = `${NT_OPEN} AND ${b.filter}${cohortClause}`;
  if (stat === 'overSla') return `${base} AND ${RES_BREACHED} AND ${ACTIONABLE} AND ${DUE_GATE}`;
  return base; // active + noReply both start from the open base
}

const TTL_MS = 60_000;
const cache = new Map<Cohort, TierSnapshot>();
const inflight = new Map<Cohort, Promise<TierSnapshot>>();

function norm(n: number): number | null { return n < 0 ? null : n; }

export async function getTierSnapshot(jira: JiraRestClient, cohort: Cohort = 'all'): Promise<TierSnapshot> {
  const cached = cache.get(cohort);
  if (cached && Date.now() - cached.updatedAt < TTL_MS) return cached;
  const pending = inflight.get(cohort);
  if (pending) return pending;
  const p = build(jira, cohort).finally(() => { inflight.delete(cohort); });
  inflight.set(cohort, p);
  return p;
}

async function build(jira: JiraRestClient, cohort: Cohort): Promise<TierSnapshot> {
  const now = new Date();
  const cohortClause = COHORT_FILTER[cohort] ? ` AND ${COHORT_FILTER[cohort]}` : '';
  const tiers: Record<string, TierStat> = {};
  for (const b of TIER_BUCKETS) {
    const base = `${NT_OPEN} AND ${b.filter}${cohortClause}`;
    const [active, overSla] = await Promise.all([
      jira.jqlCount(base),
      jira.jqlCount(tierTileJql(b.key, 'overSla', cohort)!),
    ]);
    let noReply: number | null;
    try { noReply = await countNoReply(jira, base, now); } catch { noReply = null; }
    tiers[b.key] = { active: norm(active), noReply, overSla: norm(overSla) };
  }
  const snap = { updatedAt: Date.now(), tiers };
  cache.set(cohort, snap);
  return snap;
}
