import type { UserSettingsQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { Task } from '../../shared/types.js';
import { isAdmin } from './role-helpers.js';

/** Build the set of task sources a user is allowed to see.
 *  Per-user settings are checked first. Only admin users fall back to global settings
 *  (since they configured the global integrations). Non-admin users must explicitly
 *  enable integrations in their own My Settings to see tasks from those sources. */
export async function getAllowedSources(
  userId: number | undefined,
  userRole: string | undefined,
  userSettingsQueries?: UserSettingsQueries,
  settingsQueries?: SettingsQueries,
): Promise<Set<string>> {
  const allowed = new Set(['milestone', 'manual']);
  if (!userId) return allowed;

  const check = async (key: string): Promise<boolean> => {
    const userVal = await userSettingsQueries?.get(userId, key);
    if (userVal !== undefined && userVal !== null) return userVal === 'true';
    if (isAdmin(userRole ?? '')) return settingsQueries?.get(key) === 'true';
    return false;
  };

  if (await check('jira_enabled')) allowed.add('jira');
  if (await check('msgraph_enabled')) {
    allowed.add('planner');
    allowed.add('todo');
    allowed.add('calendar');
    allowed.add('email');
  }
  if (await check('monday_enabled')) allowed.add('monday');
  return allowed;
}

/** Filter an array of tasks to only those from allowed sources. */
export async function filterTasksByAllowedSources(
  tasks: Task[],
  userId: number | undefined,
  userRole: string | undefined,
  userSettingsQueries?: UserSettingsQueries,
  settingsQueries?: SettingsQueries,
): Promise<Task[]> {
  const allowed = await getAllowedSources(userId, userRole, userSettingsQueries, settingsQueries);
  return tasks.filter((t) => allowed.has(t.source));
}
