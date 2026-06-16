/**
 * Team standup — shared helpers used by both client and server.
 *
 * The agent roster is NOT hard-coded: it is sourced live from the KPI database
 * (techservicesjsm dbo.Agent) on the server — see services/standup-roster.ts.
 * The client receives the names from the standup API.
 */

/** Initials for avatar chips, e.g. "Abdi Mohamed" -> "AM". */
export function agentInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
