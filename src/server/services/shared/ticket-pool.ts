import type { Pool } from '../assignment-engine.js';

// CurrentTier values that route to the T2 round-robin pool.
const T2_POOL_TIERS = new Set(['Tier 2', 'Tier2', 'T2', 'Tier 3', 'Tier3', 'T3', 'Production']);

/** Map a ticket's project + CurrentTier (+ labels) to its round-robin pool. Mirrors
 *  determinePoolFromTicket in agent-loop.ts: NTPJ routes by project (its tickets are
 *  almost always tier "Customer Care" and would otherwise mis-route), int_setup →
 *  Tier 2, T2/T3/Production → t2, Development → never auto-assigned, everything else
 *  (incl. Customer Care / T1 / blank) → cc. Returns null when the ticket must not be
 *  round-robined at all. */
export function poolForTicket(tier: string | null, labels: string | null, project?: string | null): Pool | null {
  if (project === 'NTPJ') return 'tpj';
  if ((labels ?? '').includes('int_setup')) return 't2';
  const t = (tier ?? '').trim();
  if (t === 'Development') return null;
  if (T2_POOL_TIERS.has(t)) return 't2';
  return 'cc';
}
