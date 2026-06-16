/**
 * Standup roster — sourced live from the KPI database (techservicesjsm dbo.Agent),
 * the single source of truth for the team. Agents in the Customer Care, Digital
 * Design and Support teams take part in the daily standup.
 *
 * dbo.Agent columns used (read-only): AgentName, AgentSurname, AgentKey (email),
 * AccountId (Jira account id), Team, IsActive. This matches how the round-robin
 * assignment engine reads the same table.
 *
 * Cached in-memory for a few minutes so the public form and jobs don't hammer the
 * KPI pool.
 */
import type { SettingsQueries } from '../db/settings-store.js';
import { getKpiPool } from './kpi-pipeline.js';

export interface StandupAgent {
  name: string;
  email: string | null;
  team: string; // normalised lower-case: customercare | digitaldesign | support
  accountId: string | null;
}

const STANDUP_TEAMS = new Set(['customercare', 'digitaldesign', 'support']);
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; agents: StandupAgent[] } | null = null;

/** Live list of standup participants from dbo.Agent (cached ~5 min). */
export async function getStandupRoster(settings: SettingsQueries, force = false): Promise<StandupAgent[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.agents;
  const pool = await getKpiPool(settings);
  const result = await pool.request().query<{
    AgentName: string | null; AgentSurname: string | null; AgentKey: string | null; AccountId: string | null; Team: string | null;
  }>(`
    SELECT AgentName, AgentSurname, AgentKey, AccountId, Team
    FROM dbo.Agent
    WHERE IsActive = 1
    ORDER BY AgentName, AgentSurname
  `);
  const agents = result.recordset
    .map((r) => ({
      name: [r.AgentName?.trim(), r.AgentSurname?.trim()].filter(Boolean).join(' '),
      email: r.AgentKey?.trim() || null,
      team: (r.Team ?? '').toLowerCase().trim(),
      accountId: r.AccountId ? decodeURIComponent(r.AccountId) : null,
    }))
    .filter((a) => a.name && STANDUP_TEAMS.has(a.team));
  cache = { at: Date.now(), agents };
  return agents;
}

/** Just the participant display names (sorted). */
export function rosterNames(roster: StandupAgent[]): string[] {
  return roster.map((a) => a.name);
}

/** Digital-design team identity sets, used to flag "Design" tickets in the brief. */
export function designIdentity(roster: StandupAgent[]): { accountIds: Set<string>; names: Set<string> } {
  const dd = roster.filter((a) => a.team === 'digitaldesign');
  return {
    accountIds: new Set(dd.map((a) => a.accountId).filter((x): x is string => !!x)),
    names: new Set(dd.map((a) => a.name.toLowerCase())),
  };
}
