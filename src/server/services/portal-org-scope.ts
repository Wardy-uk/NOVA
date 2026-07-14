import { queryOne } from './database.js';

// Single source of truth for "which Jira tickets belong to this portal org".
//
// An org is scoped by BC Account Number (customfield_14626) OR a set of reporter
// identities. Both are needed: not every ticket carries a BC account, and not
// every customer contact is on the reporter list.
//
// IMPORTANT — cf[14626] is a free-text Jira field, so JQL only supports the fuzzy
// `~` operator on it. `cf[14626] ~ "123"` also matches BC account "1234". With one
// tenant that was harmless; with several it is a cross-tenant leak. So the JQL
// branches below are a *prefilter* only — every result must still be passed
// through matchesOrgScope(), which compares the BC account exactly.

export const CF_BC_ACCOUNT = 'customfield_14626';

export interface OrgScope {
  orgId: number;
  bcAccount: string | null;
  /** Lowercased reporter identities: emails, display names or Jira accountIds. */
  reporters: string[];
  domain: string | null;
}

function parseReporters(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map(s => s.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);
}

export async function getOrgScope(orgId: number): Promise<OrgScope> {
  const row = await queryOne<{
    bc_account_number: string | null;
    scope_reporters: string | null;
    domain: string | null;
  }>(
    `SELECT bc_account_number, scope_reporters, domain FROM portal_organisations WHERE id = ?`,
    [orgId],
  );
  return {
    orgId,
    bcAccount: row?.bc_account_number?.trim() || null,
    reporters: parseReporters(row?.scope_reporters),
    domain: row?.domain?.trim().toLowerCase() || null,
  };
}

/**
 * JQL branches for the org's scope, to be OR'd together. Returns [] when the org
 * has no scope configured at all — callers must then return no tickets (fail
 * closed), never fall back to an unscoped query.
 */
export function buildScopeJqlBranches(scope: OrgScope): string[] {
  const branches: string[] = [];
  if (scope.reporters.length) {
    // Account ids are safe unquoted; anything with a reserved char (e.g. '@' in
    // an email) must be quoted.
    const list = scope.reporters
      .map(r => (/[@\s(),]/.test(r) ? JSON.stringify(r) : r))
      .join(', ');
    branches.push(`reporter in (${list})`);
  }
  if (scope.bcAccount) branches.push(`cf[${CF_BC_ACCOUNT.replace('customfield_', '')}] ~ ${JSON.stringify(scope.bcAccount)}`);
  return branches;
}

function cfText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as { value?: string; name?: string };
    return o.value ?? o.name ?? null;
  }
  return null;
}

/**
 * Exact-match authorisation for a single Jira issue against an org's scope.
 * This is the security boundary — the JQL prefilter is not.
 */
export function matchesOrgScope(scope: OrgScope, issue: { fields?: Record<string, any> } | null | undefined): boolean {
  const f = issue?.fields;
  if (!f) return false;

  const bc = cfText(f[CF_BC_ACCOUNT])?.trim();
  if (scope.bcAccount && bc && bc.toLowerCase() === scope.bcAccount.toLowerCase()) return true;

  if (scope.reporters.length) {
    const identities = [
      f.reporter?.emailAddress,
      f.reporter?.displayName,
      f.reporter?.accountId,
    ]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map(v => v.toLowerCase());
    if (identities.some(id => scope.reporters.includes(id))) return true;
  }

  return false;
}
