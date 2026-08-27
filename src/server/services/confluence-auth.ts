import type { SettingsQueries } from '../db/settings-store.js';
import type { UserSettingsQueries } from '../db/queries.js';

// One place that answers "how does NOVA authenticate to Confluence".
//
// Confluence and Jira are the same Atlassian site behind the same account and take the
// SAME API token, so Confluence never needed its own credential — the old
// kb_confluence_email / kb_confluence_token pair is gone.
//
// WHOSE token matters, though:
//   1. The acting user's own connection, when they have one. A published article should
//      be authored by the person who clicked publish, not by a shared identity.
//   2. Otherwise the nova-jira service account (jira_ob_*) — the right identity for
//      anything with no user behind it (KB sync, portal search, background jobs).
//
// The global jira_username / jira_token pair is a PERSONAL credential (currently Nick's).
// It is deliberately last and warns when used: it exists so a missing service-account
// grant doesn't take KB retrieval down, not as a shared identity.

export type ConfluenceActor = 'user' | 'service' | 'personal-global';

export interface ConfluenceAuth {
  /** Prefix to append '/wiki/api/v2/...' to. Either the site root or, for an OAuth
   *  token, the api.atlassian.com gateway for that cloud id. */
  baseUrl: string;
  headers: Record<string, string>;
  actor: ConfluenceActor;
  /** Who this credential belongs to, for logs and error messages. */
  label: string;
}

function siteUrl(settings: SettingsQueries): string | undefined {
  // A location, not a credential — still overridable.
  const raw = settings.get('confluence_base_url')?.trim()
    || settings.get('confluence_site_url')?.trim()
    || settings.get('jira_url')?.trim();
  return raw?.replace(/\/wiki\/?$/, '').replace(/\/$/, '');
}

function basic(email: string, token: string): Record<string, string> {
  return {
    Authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'),
    Accept: 'application/json',
  };
}

/** Credential for work with no user behind it. */
export function resolveServiceConfluenceAuth(settings: SettingsQueries): ConfluenceAuth {
  const site = siteUrl(settings);
  if (!site) throw new Error('Confluence needs jira_url (or confluence_site_url) in Settings.');

  const svcEmail = settings.get('jira_ob_email')?.trim();
  const svcToken = settings.get('jira_ob_token')?.trim();
  if (svcEmail && svcToken) {
    return { baseUrl: site, headers: basic(svcEmail, svcToken), actor: 'service', label: svcEmail };
  }

  const email = settings.get('jira_username')?.trim();
  const token = settings.get('jira_token')?.trim();
  if (email && token) {
    console.warn(`[confluence] Falling back to the personal global Jira credential (${email}) — the nova-jira service account is not configured for Confluence.`);
    return { baseUrl: site, headers: basic(email, token), actor: 'personal-global', label: email };
  }

  throw new Error('Confluence needs the nova-jira service account (jira_ob_email / jira_ob_token) in Settings → Integrations.');
}

export function confluenceConfigured(settings: SettingsQueries): boolean {
  if (!siteUrl(settings)) return false;
  return !!(settings.get('jira_ob_email')?.trim() && settings.get('jira_ob_token')?.trim())
    || !!(settings.get('jira_username')?.trim() && settings.get('jira_token')?.trim());
}

/** The acting user's own Confluence credential, or null if they haven't connected one.
 *  Their API token is preferred over OAuth: it authenticates against the site directly,
 *  whereas an OAuth token only carries Confluence rights if it was granted with the
 *  Confluence scopes (connections made before those were added have Jira scopes only). */
export async function resolveUserConfluenceAuth(
  settings: SettingsQueries,
  userSettings: UserSettingsQueries,
  userId: number,
): Promise<ConfluenceAuth | null> {
  try {
    const email = (await userSettings.get(userId, 'jira_username'))?.trim();
    const token = (await userSettings.get(userId, 'jira_token'))?.trim();
    if (email && token) {
      const site = (await userSettings.get(userId, 'jira_url'))?.trim()?.replace(/\/wiki\/?$/, '').replace(/\/$/, '')
        || siteUrl(settings);
      if (site) return { baseUrl: site, headers: basic(email, token), actor: 'user', label: email };
    }

    const cloudId = (await userSettings.get(userId, 'jira_cloud_id'))?.trim();
    const accessToken = (await userSettings.get(userId, 'jira_access_token'))?.trim();
    if (cloudId && accessToken) {
      return {
        baseUrl: `https://api.atlassian.com/ex/confluence/${cloudId}`,
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        actor: 'user',
        label: `user ${userId} (OAuth)`,
      };
    }
  } catch (err) {
    console.warn('[confluence] Could not read user Jira credential:', err instanceof Error ? err.message : err);
  }
  return null;
}

/** Credentials to try, in order, for a user-initiated Confluence write: the user's own
 *  first, the service account behind it. Callers should move to the next on 401/403 —
 *  an OAuth connection made before the Confluence scopes existed authenticates fine but
 *  is refused on Confluence routes. */
export async function resolveConfluenceCandidates(
  settings: SettingsQueries,
  userSettings: UserSettingsQueries | null,
  userId: number | undefined,
): Promise<ConfluenceAuth[]> {
  const candidates: ConfluenceAuth[] = [];
  if (userSettings && userId !== undefined) {
    const userAuth = await resolveUserConfluenceAuth(settings, userSettings, userId);
    if (userAuth) candidates.push(userAuth);
  }
  candidates.push(resolveServiceConfluenceAuth(settings));
  return candidates;
}

/** Back-compat name for the service-account path used by background callers. */
export const resolveConfluenceAuth = resolveServiceConfluenceAuth;
