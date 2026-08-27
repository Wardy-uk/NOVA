import type { SettingsQueries } from '../db/settings-store.js';

// One place that answers "how does NOVA authenticate to Confluence".
//
// Confluence and Jira are the same Atlassian site behind the same account, so they take
// the SAME API token — there was never a reason for Confluence to carry its own
// credential. The separate kb_confluence_email / kb_confluence_token pair was dropped:
// it had to be kept in step with the Jira globals by hand, and in prod the token was
// simply left blank, which quietly disabled Confluence work.

export interface ConfluenceAuth {
  /** Site root with no trailing /wiki — append '/wiki/api/v2/...' to it. */
  baseUrl: string;
  email: string;
  token: string;
  headers: Record<string, string>;
}

function parts(settings: SettingsQueries) {
  // Site URL stays overridable: it's a location, not a credential.
  const siteUrl = settings.get('confluence_base_url')?.trim()
    || settings.get('confluence_site_url')?.trim()
    || settings.get('jira_url')?.trim();
  // Email and token are a pair — always take both from the same source, or auth fails
  // in a way that looks like a permissions problem.
  const email = settings.get('jira_username')?.trim() || settings.get('jira_ob_email')?.trim();
  const token = settings.get('jira_token')?.trim() || settings.get('jira_ob_token')?.trim();
  return { siteUrl, email, token };
}

export function confluenceConfigured(settings: SettingsQueries): boolean {
  const { siteUrl, email, token } = parts(settings);
  return !!(siteUrl && email && token);
}

export function resolveConfluenceAuth(settings: SettingsQueries): ConfluenceAuth {
  const { siteUrl, email, token } = parts(settings);
  if (!siteUrl || !email || !token) {
    throw new Error(
      'Confluence needs the global Jira connection: jira_url, jira_username and jira_token (Settings → Integrations → Jira). Confluence uses the same Atlassian token as Jira.',
    );
  }
  return {
    baseUrl: siteUrl.replace(/\/wiki\/?$/, '').replace(/\/$/, ''),
    email,
    token,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'),
      Accept: 'application/json',
    },
  };
}
