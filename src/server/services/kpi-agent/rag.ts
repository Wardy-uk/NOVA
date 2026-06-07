// Configurable RAG thresholds for the per-agent health statuses. Thresholds live
// in settings.json (key `agent_rag_thresholds`) so they can be tuned without a
// deploy; defaults seed the legacy hardcoded values (kpi-pipeline snapshotAgentKpis).

import type { SettingsQueries } from '../../db/settings-store.js';

export type Rag = 'green' | 'amber' | 'red';

export interface RagThresholds {
  // higher-better metrics: green if >= green, amber if >= amber, else red
  productivity: { green: number; amber: number }; // tickets per hour
  csat: { green: number; amber: number };
  qa: { green: number; amber: number };
  goldenRules: { green: number; amber: number };
  sla: { green: number; amber: number };          // SLA compliance %
  // lower-better metrics: green if <= green, amber if <= amber, else red
  over2h: { green: number; amber: number };        // over-SLA count
  stale: { green: number; amber: number };         // no-update count
  oldest: { green: number; amber: number };        // oldest ticket days
}

export const DEFAULT_RAG_THRESHOLDS: RagThresholds = {
  productivity: { green: 1.5, amber: 1.0 },
  csat: { green: 4.0, amber: 3.0 },
  qa: { green: 4.0, amber: 3.0 },
  goldenRules: { green: 3.0, amber: 2.0 },
  sla: { green: 95, amber: 90 },
  over2h: { green: 0, amber: 2 },
  stale: { green: 0, amber: 1 },
  oldest: { green: 3, amber: 7 },
};

export function getRagThresholds(settings: SettingsQueries): RagThresholds {
  const raw = settings.get('agent_rag_thresholds');
  if (!raw) return DEFAULT_RAG_THRESHOLDS;
  try {
    const parsed = JSON.parse(raw) as Partial<RagThresholds>;
    return { ...DEFAULT_RAG_THRESHOLDS, ...parsed };
  } catch {
    return DEFAULT_RAG_THRESHOLDS;
  }
}

export function ragHigher(value: number | null, t: { green: number; amber: number }): Rag | null {
  if (value == null) return null;
  if (value >= t.green) return 'green';
  if (value >= t.amber) return 'amber';
  return 'red';
}

export function ragLower(value: number | null, t: { green: number; amber: number }): Rag | null {
  if (value == null) return null;
  if (value <= t.green) return 'green';
  if (value <= t.amber) return 'amber';
  return 'red';
}
