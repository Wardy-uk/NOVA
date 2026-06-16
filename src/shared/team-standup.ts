/**
 * Team standup — shared config used by both the public submission form (client)
 * and the daily jobs / routes (server).
 *
 * TEAM_AGENTS is the canonical list of agents who take part in the daily standup.
 * Keep this in sync with the team roster. Agent email addresses (server-only) live
 * in src/server/config/standup-config.ts, keyed by these exact names.
 */
export const TEAM_AGENTS = [
  'Abdi Mohamed',
  'Arman Shazad',
  'Heidi Power',
  'Hope Goodall',
  'Isabel Busk',
  'Luke Scaife',
  'Maria Pappa',
  'Naomi Wentworth',
  'Nathan Rutland',
  'Sebastian Broome',
  'Stephen Mitchell',
  'Willem Kruger',
  'Zoe Rees',
] as const;

export type TeamAgent = (typeof TEAM_AGENTS)[number];

/** Initials for avatar chips, e.g. "Abdi Mohamed" -> "AM". */
export function agentInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
