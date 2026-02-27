import type { UserSettingsQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { Task } from '../../shared/types.js';

/** Build the set of task sources a user is allowed to see.
 *  Per-user settings are checked first. Only admin users fall back to global settings
 *  (since they configured the global integrations). Non-admin users must explicitly
 *  enable integrations in their own My Settings to see tasks from those sources. */
export function getAllowedSources(
  userId: number | undefined,
  userRole: string | undefined,
  userSettingsQueries?: UserSettingsQueries,
  settingsQueries?: SettingsQueries,
): Set<string> {
  const allowed = new Set(['milestone', 'manual']);
  if (!userId) return allowed;

  const check = (key: string): boolean => {
    const userVal = userSettingsQueries?.get(userId, key);
    if (userVal !== undefined && userVal !== null) return userVal === 'true';
    if (userRole === 'admin') return settingsQueries?.get(key) === 'true';
    return false;
  };

  if (check('jira_enabled')) allowed.add('jira');
  if (check('msgraph_enabled')) {
    allowed.add('planner');
    allowed.add('todo');
    allowed.add('calendar');
    allowed.add('email');
  }
  if (check('monday_enabled')) allowed.add('monday');
  return allowed;
}

/** Filter an array of tasks to only those from allowed sources. */
export function filterTasksByAllowedSources(
  tasks: Task[],
  userId: number | undefined,
  userRole: string | undefined,
  userSettingsQueries?: UserSettingsQueries,
  settingsQueries?: SettingsQueries,
): Task[] {
  const allowed = getAllowedSources(userId, userRole, userSettingsQueries, settingsQueries);
  return tasks.filter((t) => allowed.has(t.source));
}
