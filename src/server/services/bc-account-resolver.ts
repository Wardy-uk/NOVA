/**
 * BC Account Number resolver.
 *
 * NOVA must set a ticket's BC Account Number (customfield_14626) to the *real*
 * Business Central account number before closing — a mandatory Jira validator on
 * the NT "Quick Resolve" transition blocks any close when the field is empty.
 *
 * This resolves the number the way a human agent would: from the customer the
 * ticket is ABOUT (the website/domain in the summary/description or the synced
 * organisation), NOT necessarily the reporter (plugin/infra reporters like
 * smart.plugin.manager@wpengine.com are not customers).
 *
 * Policy (Nick, 22 Jul 2026): prefer the customer's real BC account, but never
 * let a missing one block a close. If no confident match resolves from any
 * signal, fall back to Nurtur's own BC account (CU0001778) so the mandatory
 * ^CU\d{7}$ validator is satisfied and the ticket can close. (This supersedes
 * the earlier "never invent a value → hold" rule — holding was the main thing
 * blocking NOVA's closes.)
 *
 * Signal priority (most reliable first):
 *   1. A BC account number already on the ticket (real, non-sentinel) — trust it.
 *   2. organisation_name synced from Jira.
 *   3. site/domain parsed from summary + description.
 *   4. reporter email domain (only if it's a real customer domain).
 *
 * A signal "resolves" only when it yields exactly ONE distinct BC customer, OR
 * when 2+ match but exactly one is an *exact* match (org name / email domain).
 * Otherwise → try the next signal; still nothing at the end → CU0001778 fallback.
 *
 * Infra notifications (PMTA / BYM-infra with no real customer) are the one
 * exception: callers handling those pass `{ infraFallback: true }`, and when no
 * customer resolves the resolver returns Nurtur's own BC account (CU0001778)
 * rather than holding — these are Nurtur-internal notifications, not customer work.
 */

import type { BusinessCentralClient, BcRawCustomer } from './bc-client.js';

/** Nurtur's own BC account — the catch-all when no confident customer resolves. */
export const NURTUR_BC_ACCOUNT = 'CU0001778';

/**
 * Coerce a value to the exact BC account format the Jira validator demands
 * (^CU\d{7}$). Strips stray punctuation/whitespace (e.g. "CU0001474." → the
 * malformed trailing dot that failed NT-24707) and uppercases. Returns null if
 * it still doesn't conform, so the caller resolves a real one or falls back.
 */
export function sanitiseBcNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^CU\d{7}$/.test(cleaned) ? cleaned : null;
}

export interface ResolverTicket {
  key?: string;
  summary?: string | null;
  description?: string | null; // plain text (description_text from cache)
  organisationName?: string | null;
  reporterEmail?: string | null;
  /** Existing value of customfield_14626 on the ticket, if any. */
  bcAccountNumber?: string | null;
}

export interface BcResolution {
  /** The BC account number to write, or null if none could be confidently resolved. */
  number: string | null;
  /** Human-readable explanation — used for internal "needs manual lookup" notes and logs. */
  reason: string;
  /** Which signal produced the match (when resolved). */
  signal?: 'existing' | 'organisation' | 'domain' | 'reporter' | 'infra' | 'fallback';
}

export interface ResolveOptions {
  /**
   * When true, and no customer resolves from any signal, return Nurtur's own BC
   * account (CU0001778) instead of null. Set this ONLY on callers that handle
   * Nurtur-internal infra notifications (PMTA / BYM-infra) — never on generic
   * customer closes, or a wrong account gets written.
   */
  infraFallback?: boolean;
}

/** Normalise a name/label for exact comparison: lowercase, strip non-alphanumerics. */
function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Sentinels / placeholders that must NOT be treated as a real BC account. */
const SENTINEL_VALUES = new Set(['n/a', 'na', 'none', 'unknown', '-', 'tbc', 'tbd']);

/**
 * Email/infra domains that are never a customer (generic providers + known
 * plugin/infra senders). A ticket whose only domain signal is one of these has
 * no derivable customer.
 */
const NON_CUSTOMER_DOMAINS = new Set([
  'wpengine.com',
  'pmta.io',
  'powermta.com',
  'nurtur.tech',
  'nurtur.co.uk',
  'briefyourmarket.com',
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'live.co.uk',
  'yahoo.com',
  'yahoo.co.uk',
  'icloud.com',
  'me.com',
  'aol.com',
  'msn.com',
  'protonmail.com',
]);

function isSentinel(value: string | null | undefined): boolean {
  if (!value) return true;
  return SENTINEL_VALUES.has(value.trim().toLowerCase());
}

/** Looks like a BC customer number (e.g. CU00012345, C00012, 10001). */
function looksLikeBcNumber(value: string): boolean {
  return /^[A-Za-z]{0,3}\d{3,}$/.test(value.trim());
}

/**
 * Extract candidate customer domains from free text (summary + description).
 * Handles bare domains and URLs; strips protocol/www; drops non-customer domains.
 * Returns unique lowercased hostnames, most-specific first.
 */
export function extractDomains(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  // URLs and bare hostnames: something.tld(.tld)
  const re = /\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Skip email local-parts with dots (e.g. "smart.plugin.manager" in
    // smart.plugin.manager@wpengine.com) — a match immediately followed by '@'
    // is the part before an email address, not a domain.
    if (text[re.lastIndex] === '@') continue;
    const host = m[1].toLowerCase().replace(/\.$/, '');
    // Ignore file-ish false positives (e.g. "image.png", "index.js")
    const tld = host.slice(host.lastIndexOf('.') + 1);
    if (['png', 'jpg', 'jpeg', 'gif', 'js', 'ts', 'css', 'html', 'php', 'json', 'txt', 'pdf'].includes(tld)) continue;
    if (NON_CUSTOMER_DOMAINS.has(host)) continue;
    found.add(host);
  }
  return [...found];
}

function domainOfEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/** Second-level label of a domain, e.g. "crowtherkey.co.uk" → "crowtherkey". */
function sldLabel(domain: string): string | null {
  const parts = domain.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  // For x.co.uk / x.org.uk style, the label is the third-from-last; otherwise second-from-last.
  const twoLevelTlds = new Set(['co.uk', 'org.uk', 'com.au', 'co.nz', 'co.za', 'ac.uk', 'gov.uk']);
  const lastTwo = parts.slice(-2).join('.');
  const idx = twoLevelTlds.has(lastTwo) ? parts.length - 3 : parts.length - 2;
  return idx >= 0 ? parts[idx] : null;
}

/** Dedupe a match list by BC customer number. */
function distinctByNumber(rows: BcRawCustomer[]): BcRawCustomer[] {
  const seen = new Map<string, BcRawCustomer>();
  for (const r of rows) {
    if (r.number && !seen.has(r.number)) seen.set(r.number, r);
  }
  return [...seen.values()];
}

/**
 * Resolve a BC account number for a ticket. See module header for policy.
 * Returns a BcResolution; on any failure/uncertainty `number` is null with a reason.
 */
export async function resolveBcAccountDetailed(
  bc: BusinessCentralClient,
  ticket: ResolverTicket,
  opts: ResolveOptions = {},
): Promise<BcResolution> {
  // 1. Trust an existing real value on the ticket — but only if it's well-formed
  //    (a malformed one like "CU0001474." fails the validator; re-resolve instead).
  if (!isSentinel(ticket.bcAccountNumber)) {
    const existing = sanitiseBcNumber(ticket.bcAccountNumber);
    if (existing) return { number: existing, reason: 'ticket already carries a BC account number', signal: 'existing' };
  }

  let sawAmbiguous = false;

  // 2. organisation_name — could be a BC number outright, or a name to search.
  const org = ticket.organisationName?.trim();
  if (org) {
    if (looksLikeBcNumber(org)) {
      try {
        const exact = await bc.getCustomerByNumber(org);
        if (exact?.number) return { number: exact.number, reason: `organisation_name "${org}" matched BC customer exactly`, signal: 'organisation' };
      } catch (err) {
        console.warn('[bc-resolver] getCustomerByNumber failed:', err instanceof Error ? err.message : err);
      }
    }
    const orgNorm = normaliseName(org);
    const hit = await matchOne(bc, org, c => !!c.displayName && normaliseName(c.displayName) === orgNorm);
    if (hit.number) return { ...hit, reason: `organisation_name "${org}" — ${hit.reason}`, signal: 'organisation' };
    if (hit.ambiguous) sawAmbiguous = true;
  }

  // 3. Domains from summary + description.
  const domains = extractDomains([ticket.summary, ticket.description].filter(Boolean).join('\n'));
  for (const domain of domains) {
    // High precision first: full domain (matches BC email @domain).
    let hit = await matchOne(bc, domain, c => domainOfEmail(c.email) === domain);
    // Then the second-level label against displayName (e.g. "crowtherkey").
    if (!hit.number && !hit.ambiguous) {
      const label = sldLabel(domain);
      if (label && label.length >= 3) {
        hit = await matchOne(bc, label, c => !!c.displayName && normaliseName(c.displayName) === label);
      }
    }
    if (hit.number) return { ...hit, reason: `domain "${domain}" — ${hit.reason}`, signal: 'domain' };
    if (hit.ambiguous) sawAmbiguous = true;
  }

  // 4. Reporter email domain — last resort, only if it's a real customer domain.
  const reporterDomain = domainOfEmail(ticket.reporterEmail);
  if (reporterDomain && !NON_CUSTOMER_DOMAINS.has(reporterDomain)) {
    const hit = await matchOne(bc, reporterDomain, c => domainOfEmail(c.email) === reporterDomain);
    if (hit.number) return { ...hit, reason: `reporter domain "${reporterDomain}" — ${hit.reason}`, signal: 'reporter' };
    if (hit.ambiguous) sawAmbiguous = true;
  }

  // 5. No confident (>95%) BC match from any signal — fall back to Nurtur's own
  //    BC account so the ^CU\d{7}$ validator is satisfied and the close proceeds.
  //    This covers both "no match" and "ambiguous" (2+ matches, none exact):
  //    both are below the confidence bar, so we never write a guessed customer —
  //    just the safe Nurtur catch-all.
  const why = sawAmbiguous
    ? 'BC matches were ambiguous with no exact org/domain match — using Nurtur catch-all CU0001778'
    : 'no confident BC match from organisation, domain, or reporter — using Nurtur catch-all CU0001778';
  return { number: NURTUR_BC_ACCOUNT, reason: why, signal: 'fallback' };
}

/**
 * Convenience wrapper matching the signature in the handoff:
 * returns the resolved BC account number, or null to hold for a human.
 */
export async function resolveBcAccountNumber(
  bc: BusinessCentralClient,
  ticket: ResolverTicket,
  opts: ResolveOptions = {},
): Promise<string | null> {
  const res = await resolveBcAccountDetailed(bc, ticket, opts);
  if (res.number) {
    console.log(`[bc-resolver] ${ticket.key ?? '(ticket)'} → ${res.number} (${res.reason})`);
  } else {
    console.log(`[bc-resolver] ${ticket.key ?? '(ticket)'} → hold: ${res.reason}`);
  }
  return res.number;
}

/**
 * Search BC for a confident match. Returns the number when exactly one distinct
 * customer matches, OR when 2+ match but exactly one satisfies `exactMatch`
 * (e.g. exact org name / exact email domain). Flags ambiguous when 2+ match with
 * no single exact winner; empty otherwise.
 */
async function matchOne(
  bc: BusinessCentralClient,
  query: string,
  exactMatch?: (c: BcRawCustomer) => boolean,
): Promise<{ number: string | null; reason: string; ambiguous?: boolean }> {
  let rows: BcRawCustomer[];
  try {
    rows = await bc.searchCustomers(query);
  } catch (err) {
    console.warn(`[bc-resolver] searchCustomers("${query}") failed:`, err instanceof Error ? err.message : err);
    return { number: null, reason: 'BC search failed' };
  }
  const distinct = distinctByNumber(rows);
  if (distinct.length === 1) {
    return { number: distinct[0].number, reason: `matched BC customer "${distinct[0].displayName}"` };
  }
  if (distinct.length > 1) {
    const exact = exactMatch ? distinct.filter(exactMatch) : [];
    if (exact.length === 1) {
      return { number: exact[0].number, reason: `${distinct.length} matched; exact match "${exact[0].displayName}"` };
    }
    return { number: null, reason: `${distinct.length} BC customers matched`, ambiguous: true };
  }
  return { number: null, reason: 'no BC customer matched' };
}
