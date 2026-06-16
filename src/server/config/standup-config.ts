/**
 * Team standup — server-side config.
 *
 * Agents and their email addresses are sourced live from the KPI database
 * (techservicesjsm dbo.Agent) via services/standup-roster.ts — there is no
 * hard-coded agent list here. Only the recipient for the accountability report
 * and the base URL for email links live as config.
 */

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
