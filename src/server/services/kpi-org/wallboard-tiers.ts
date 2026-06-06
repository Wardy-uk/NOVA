// Legacy tier-slice metrics for the like-for-like rebuild wallboards (Customer
// Care, Technical Support). These mirror the ORIGINAL wallboard panels — sliced
// by the legacy tiers (CC Incidents/SRs/TPJ, Production, Tier 2, Dev+Tier 3) —
// but computed fresh via the new engine using the agreed correct conditions
// (NT open-filter, isNoReply, resolution-SLA-breached + actionable). 60s-cached.

import type { JiraRestClient } from '../jira-client.js';
import { NT_OPEN, NOT_ACTIONABLE_STATUSES, RESOLUTION_SLA_NAME } from './registry.js';
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

const TTL_MS = 60_000;
let cache: TierSnapshot | null = null;
let inflight: Promise<TierSnapshot> | null = null;

function norm(n: number): number | null { return n < 0 ? null : n; }

export async function getTierSnapshot(jira: JiraRestClient): Promise<TierSnapshot> {
  if (cache && Date.now() - cache.updatedAt < TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = build(jira).finally(() => { inflight = null; });
  return inflight;
}

async function build(jira: JiraRestClient): Promise<TierSnapshot> {
  const now = new Date();
  const tiers: Record<string, TierStat> = {};
  for (const b of TIER_BUCKETS) {
    const base = `${NT_OPEN} AND ${b.filter}`;
    const [active, overSla] = await Promise.all([
      jira.jqlCount(base),
      jira.jqlCount(`${base} AND ${RES_BREACHED} AND ${ACTIONABLE}`),
    ]);
    let noReply: number | null;
    try { noReply = await countNoReply(jira, base, now); } catch { noReply = null; }
    tiers[b.key] = { active: norm(active), noReply, overSla: norm(overSla) };
  }
  cache = { updatedAt: Date.now(), tiers };
  return cache;
}
