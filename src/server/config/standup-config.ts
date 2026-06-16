/**
 * Team standup — server-side config.
 *
 * Agent email addresses for the morning-prompt job, keyed by the EXACT name used
 * in TEAM_AGENTS (src/shared/team-standup.ts). The morning job skips (and logs)
 * any agent whose address is blank, so it is safe to fill these in over time.
 *
 * ⚠️  ACTION REQUIRED: fill in the real addresses below. They were left blank
 *     intentionally rather than guessed — a wrong address would send a colleague's
 *     queue numbers to a stranger.
 */
import { TEAM_AGENTS } from '../../shared/team-standup.js';

export const AGENT_EMAILS: Record<string, string> = {
  'Abdi Mohamed': '',
  'Arman Shazad': '',
  'Heidi Power': '',
  'Hope Goodall': '',
  'Isabel Busk': '',
  'Luke Scaife': '',
  'Maria Pappa': '',
  'Naomi Wentworth': '',
  'Nathan Rutland': '',
  'Sebastian Broome': '',
  'Stephen Mitchell': '',
  'Willem Kruger': '',
  'Zoe Rees': '',
};

/** Resolve an agent's email, or null if not yet configured. */
export function agentEmail(name: string): string | null {
  const e = AGENT_EMAILS[name]?.trim();
  return e ? e : null;
}

/** Nick's address for the accountability report. Env override wins. */
export function nickEmail(): string {
  return (process.env.NICK_EMAIL || 'nickw@nurtur.tech').trim();
}

/**
 * Base URL for links in emails. NOVA_BASE_URL env var, else the prod URL.
 * (settings app_base_url is blank in prod — see reference-nova-live-url memory.)
 */
export function novaBaseUrl(): string {
  return (process.env.NOVA_BASE_URL || 'https://nova.nurtur.tech').replace(/\/+$/, '');
}

/** Sanity helper: names in AGENT_EMAILS that aren't in the roster (config drift). */
export function unknownEmailKeys(): string[] {
  const roster = new Set<string>(TEAM_AGENTS);
  return Object.keys(AGENT_EMAILS).filter((k) => !roster.has(k));
}
