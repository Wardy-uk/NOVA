import type { SettingsQueries } from '../db/settings-store.js';
import type { PortalStatus } from '../../shared/portal-types.js';

type SettingsReader = Pick<SettingsQueries, 'get'>;

const DEFAULT_MAP: Record<string, PortalStatus> = {
  'open': 'Submitted',
  'new': 'Submitted',
  'to do': 'Submitted',
  'todo': 'Submitted',
  'backlog': 'Submitted',
  'triaged': 'Reviewed',
  'triage': 'Reviewed',
  'categorised': 'Reviewed',
  'categorized': 'Reviewed',
  'under review': 'Reviewed',
  'investigating': 'Reviewed',
  'in progress': 'In Progress',
  'in development': 'In Progress',
  'development': 'In Progress',
  'escalated': 'In Progress',
  'pending': 'In Progress',
  'with third party': 'Awaiting Third Party',
  'waiting on third party': 'Awaiting Third Party',
  'waiting for third party': 'Awaiting Third Party',
  'waiting on partner': 'Awaiting Third Party',
  'waiting for partner': 'Awaiting Third Party',
  'waiting on vendor': 'Awaiting Third Party',
  'waiting for vendor': 'Awaiting Third Party',
  'waiting on supplier': 'Awaiting Third Party',
  'waiting for supplier': 'Awaiting Third Party',
  'waiting for customer': 'Awaiting Your Response',
  'waiting on customer': 'Awaiting Your Response',
  'waiting on requestor': 'Awaiting Your Response',
  'waiting for requestor': 'Awaiting Your Response',
  'pending customer': 'Awaiting Your Response',
  'pending with customer': 'Awaiting Your Response',
  'resolved': 'Resolved',
  'done': 'Resolved',
  'closed': 'Closed',
  'cancelled': 'Closed',
  'canceled': 'Closed',
};

const FALLBACK: PortalStatus = 'In Progress';

function normaliseStatusKey(status: string | null | undefined): string {
  return (status ?? '').trim().toLowerCase();
}

function buildPortalStatusMap(settings?: SettingsReader): Record<string, PortalStatus> {
  const map: Record<string, PortalStatus> = { ...DEFAULT_MAP };
  const customJson = settings?.get('portal_status_map');

  if (customJson) {
    try {
      const parsed = JSON.parse(customJson) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) {
        const normalisedKey = normaliseStatusKey(k);
        if (!normalisedKey) continue;
        map[normalisedKey] = v as PortalStatus;
      }
    } catch {
      return map;
    }
  }

  return map;
}

export function mapJiraStatusToPortal(jiraStatus: string | null | undefined, settings?: SettingsReader): PortalStatus {
  const normalisedKey = normaliseStatusKey(jiraStatus);
  if (!normalisedKey) return FALLBACK;
  const map = buildPortalStatusMap(settings);
  return map[normalisedKey] ?? FALLBACK;
}
