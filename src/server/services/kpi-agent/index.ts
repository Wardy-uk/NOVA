// Agent KPI orchestration (Layer 3). Live recompute (60s-cached) for the SLA
// Breach Board rebuild + scorecard; daily 18:00 freeze into kpi_agent_daily.

import type { JiraRestClient } from '../jira-client.js';
import type { SettingsQueries } from '../../db/settings-store.js';
import { computeAgentKpis, type AgentKpiRow } from './compute.js';
import { ensureAgentTable, saveDay } from './store.js';

export { getLatestDay, getDay, getAgentHistory, ensureAgentTable } from './store.js';
export { getAgentPeriod, getAgentHistoryGrid } from './period.js';
export { backfillAgentFromLegacy } from './backfill.js';
export { syncAgentRosterStats } from './roster-sync.js';
export type { AgentKpiRow } from './compute.js';
export { getRagThresholds, DEFAULT_RAG_THRESHOLDS } from './rag.js';

function ukDay(d: Date): string { return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); }

export interface AgentCaptureSummary { day: string; agents: number; failed: boolean; error?: string; }

/** Compute + freeze all agent KPIs for the day. Never throws. */
export async function captureAgentKpis(settings: SettingsQueries, jira: JiraRestClient, now: Date = new Date()): Promise<AgentCaptureSummary> {
  const day = ukDay(now);
  try {
    await ensureAgentTable();
    // Capture runs once/day, so it can afford per-ticket changelog fetches to credit the
    // actual resolver. The live snapshot path stays on current-assignee for speed.
    const rows = await computeAgentKpis(settings, jira, now, { attributeResolver: true });
    await saveDay(day, rows);
    console.log(`[kpi-agent] capture ${day}: ${rows.length} agents`);
    return { day, agents: rows.length, failed: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[kpi-agent] capture failed:`, error);
    return { day, agents: 0, failed: true, error };
  }
}

// ── Live snapshot (60s cache, shared inflight) ──
export interface AgentLiveSnapshot { updatedAt: number; agents: AgentKpiRow[]; }
const TTL_MS = 60_000;
let cache: AgentLiveSnapshot | null = null;
let inflight: Promise<AgentLiveSnapshot> | null = null;

export async function getAgentLiveSnapshot(settings: SettingsQueries, jira: JiraRestClient): Promise<AgentLiveSnapshot> {
  if (cache && Date.now() - cache.updatedAt < TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = computeAgentKpis(settings, jira)
    .then(agents => { cache = { updatedAt: Date.now(), agents }; return cache; })
    .finally(() => { inflight = null; });
  return inflight;
}
