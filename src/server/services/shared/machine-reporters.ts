import type { SettingsQueries } from '../../db/settings-store.js';

/**
 * Tickets raised by a machine rather than a person.
 *
 * PowerMTA DKIM alerts, the daily Failed Jobs ticket, the MWU morning report, abuse feeds and
 * n8n all open tickets under service-account addresses. There is no one on the other end, so a
 * customer-facing reply to one is addressed to nobody — NT-31792 and NT-31407 were both sent
 * "Thank you for reporting this issue" in answer to an automated alert, and promised that
 * someone would "contact you" about it.
 *
 * The list lived in frt-safety-net.ts, which was the only thing that knew the difference. It is
 * shared now because the triage reply path needs the same answer, and two copies would drift.
 */
export const DEFAULT_MACHINE_REPORTERS = [
  'trigger@briefyourmarket.com',
  'info@briefyourmarket.com',
  'failedjobsalerting@briefyourmarket.com',
  'pmta-dkim-service@',
  'ragreportnotifications@nurtur.tech',
  'n8n@nurtur.tech',
  'nova-jira',
];

/** Matched case-insensitively as substrings of the reporter's email or display name.
 *  Override with `frt_safety_net_internal_reporters` (comma-separated), which is the setting
 *  the safety net already uses — one list, one place to change it. */
export function isMachineRaised(settings: SettingsQueries, reporter: string | null | undefined): boolean {
  const needle = (reporter ?? '').trim().toLowerCase();
  if (!needle) return false;
  const raw = settings.get('frt_safety_net_internal_reporters');
  const patterns = raw
    ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_MACHINE_REPORTERS;
  const list = patterns.length > 0 ? patterns : DEFAULT_MACHINE_REPORTERS;
  return list.some(p => needle.includes(p));
}
