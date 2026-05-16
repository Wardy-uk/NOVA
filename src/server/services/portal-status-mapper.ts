import type { FileSettingsQueries } from '../db/settings-store.js';
import type { PortalStatus } from '../../shared/portal-types.js';

const DEFAULT_MAP: Record<string, PortalStatus> = {
  'open': 'Submitted',
  'new': 'Submitted',
  'triaged': 'Reviewed',
  'categorised': 'Reviewed',
  'in progress': 'In Progress',
  'in development': 'In Progress',
  'escalated': 'In Progress',
  'with third party': 'Awaiting Third Party',
  'waiting for customer': 'Awaiting Your Response',
  'pending customer': 'Awaiting Your Response',
  'resolved': 'Resolved',
  'done': 'Resolved',
  'closed': 'Closed',
  'cancelled': 'Closed',
};

const FALLBACK: PortalStatus = 'In Progress';

export function mapJiraStatusToPortal(jiraStatus: string, settings: FileSettingsQueries): PortalStatus {
  const customJson = settings.get('portal_status_map');
  let map = DEFAULT_MAP;

  if (customJson) {
    try {
      const parsed = JSON.parse(customJson) as Record<string, string>;
      map = {};
      for (const [k, v] of Object.entries(parsed)) {
        map[k.toLowerCase()] = v as PortalStatus;
      }
    } catch {
      map = DEFAULT_MAP;
    }
  }

  return map[jiraStatus.toLowerCase()] ?? FALLBACK;
}
