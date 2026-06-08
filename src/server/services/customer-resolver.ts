import { query, queryOne, execute } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';

// Resolves a Jira ticket to a canonical customer. See agent_work/ba/account-risk-spec.md.
//
// Measured reality (most recent 100 in-scope tickets, Jun 2026): only ~14% carry a
// structured identifier (BC Account Number 10%, JSM Organization 6%, Instance URL 1%),
// but 99% have a reporter email. So the resolution chain leads with the high-confidence
// structured fields when present, then falls back to the email-domain map for the
// majority, then URL extraction, then (future) AI inference.

// NT custom field IDs (discovered Jun 2026 — see spec).
export const FIELD = {
  BC_ACCOUNT_NUMBER: 'customfield_14626', // e.g. "CU0001155"
  INSTANCE_URL: 'customfield_13181',      // e.g. "pfg-internal.briefyourmarket.com"
  CUSTOMER_DOMAIN: 'customfield_13956',
  WEBSITE_URL: 'customfield_13415',
  FEED_ACCOUNT_URL: 'customfield_13416',
  ORGANIZATIONS: 'customfield_12500',     // JSM organizations array
  CLIENT_NAME: 'customfield_13444',
  CUSTOMER: 'customfield_13311',
} as const;

// Free-mail / generic domains never identify a customer.
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'live.co.uk', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com',
  'aol.com', 'btinternet.com', 'sky.com', 'msn.com', 'protonmail.com',
]);

// Internal Nurtur domains — reporter is staff (e.g. CSM forwarding on behalf).
const INTERNAL_DOMAINS = new Set([
  'nurtur.tech', 'nurtur.digital', 'briefyourmarket.com',
]);

export type ResolveSource =
  | 'bc_field' | 'jsm_org' | 'instance_url' | 'customer_domain' | 'website_url'
  | 'email_domain' | 'body_url' | 'ai_inference' | 'unresolved';

export interface ResolveResult {
  customerRef: string | null;     // canonical key (BC number when known)
  customerName: string | null;
  source: ResolveSource;
  confidence: number;             // 0-100
  isNetwork: boolean;
  internalReporter: boolean;      // reporter is Nurtur staff (proxy access)
}

export interface ResolveInput {
  bcAccountNumber?: string | null;
  instanceUrl?: string | null;
  customerDomain?: string | null;
  websiteUrl?: string | null;
  organizations?: { name?: string }[] | null;
  reporterEmail?: string | null;
  summary?: string | null;
  description?: string | null;
}

const UNRESOLVED: ResolveResult = {
  customerRef: null, customerName: null, source: 'unresolved',
  confidence: 0, isNetwork: false, internalReporter: false,
};

export class CustomerResolver {
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  /** Normalise a host/domain: strip scheme, path, leading www., lower-case. */
  static normaliseDomain(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let d = raw.trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '');
    d = d.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
    return d && d.includes('.') ? d : null;
  }

  static emailDomain(email: string | null | undefined): string | null {
    if (!email || !email.includes('@')) return null;
    return CustomerResolver.normaliseDomain(email.split('@').pop());
  }

  /** Pull candidate hostnames out of free text (instance URLs, website mentions). */
  static extractDomainsFromText(text: string | null | undefined): string[] {
    if (!text) return [];
    const out = new Set<string>();
    // Explicit URLs
    const urlRe = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(text)) !== null) {
      const d = CustomerResolver.normaliseDomain(m[1]);
      if (d) out.add(d);
    }
    // Bare BYM/Nurtur instance hosts (e.g. "companyname.briefyourmarket.com")
    const hostRe = /\b([a-z0-9-]+\.(?:briefyourmarket\.com|nurtur\.digital|nurtur\.tech))\b/gi;
    while ((m = hostRe.exec(text)) !== null) {
      const d = CustomerResolver.normaliseDomain(m[1]);
      if (d) out.add(d);
    }
    return [...out];
  }

  /** Look up a domain in the customer-domain map. */
  private async lookupDomain(domain: string | null): Promise<{ customer_ref: string; customer_name: string | null; confidence: number; is_network: boolean } | null> {
    if (!domain) return null;
    return (await queryOne<{ customer_ref: string; customer_name: string | null; confidence: number; is_network: boolean }>(
      `SELECT TOP(1) customer_ref, customer_name, confidence, is_network
       FROM agent_customer_domains WHERE domain = ? ORDER BY is_verified DESC, confidence DESC`,
      [domain],
    )) ?? null;
  }

  /** Resolve a BC Account Number (e.g. "CU0001155") against bc_customers. */
  private async lookupBcNumber(bcNumber: string | null): Promise<{ customer_ref: string; customer_name: string } | null> {
    if (!bcNumber) return null;
    const n = bcNumber.trim();
    if (!n) return null;
    const row = await queryOne<{ number: string; display_name: string }>(
      `SELECT TOP(1) number, display_name FROM bc_customers WHERE number = ? OR bc_id = ?`,
      [n, n],
    );
    // Even if not in bc_customers yet, the BC number is itself a valid canonical ref.
    return { customer_ref: n, customer_name: row?.display_name ?? n };
  }

  async resolveTicket(input: ResolveInput): Promise<ResolveResult> {
    const emailDomain = CustomerResolver.emailDomain(input.reporterEmail);
    const internalReporter = emailDomain ? INTERNAL_DOMAINS.has(emailDomain) : false;

    // 1. BC Account Number — highest confidence when present (~10% of tickets).
    if (input.bcAccountNumber) {
      const bc = await this.lookupBcNumber(input.bcAccountNumber);
      if (bc) {
        return { customerRef: bc.customer_ref, customerName: bc.customer_name, source: 'bc_field', confidence: 100, isNetwork: false, internalReporter };
      }
    }

    // 2. JSM Organization (~6%).
    const orgName = input.organizations?.find(o => o.name)?.name ?? null;
    if (orgName) {
      const byOrg = await queryOne<{ customer_ref: string; customer_name: string | null; is_network: boolean }>(
        `SELECT TOP(1) customer_ref, customer_name, is_network FROM agent_customer_domains
         WHERE domain = ? AND domain_type = 'org' ORDER BY is_verified DESC`,
        [orgName.toLowerCase()],
      );
      if (byOrg) {
        return { customerRef: byOrg.customer_ref, customerName: byOrg.customer_name, source: 'jsm_org', confidence: 95, isNetwork: byOrg.is_network, internalReporter };
      }
    }

    // 3. Structured URL fields → domain map (instance URL, customer domain, website URL).
    const structured: [string | null, ResolveSource][] = [
      [CustomerResolver.normaliseDomain(input.instanceUrl), 'instance_url'],
      [CustomerResolver.normaliseDomain(input.customerDomain), 'customer_domain'],
      [CustomerResolver.normaliseDomain(input.websiteUrl), 'website_url'],
    ];
    for (const [domain, source] of structured) {
      const hit = await this.lookupDomain(domain);
      if (hit) {
        return { customerRef: hit.customer_ref, customerName: hit.customer_name, source, confidence: Math.min(95, hit.confidence), isNetwork: hit.is_network, internalReporter };
      }
    }

    // 4. Reporter email domain — the workhorse (~99% have an email). Skip generic /
    //    internal domains, which don't identify the affected customer.
    if (emailDomain && !GENERIC_DOMAINS.has(emailDomain) && !internalReporter) {
      const hit = await this.lookupDomain(emailDomain);
      if (hit) {
        return { customerRef: hit.customer_ref, customerName: hit.customer_name, source: 'email_domain', confidence: hit.confidence, isNetwork: hit.is_network, internalReporter };
      }
    }

    // 5. Domains mentioned in body/summary (instance hosts, website links).
    const textDomains = [
      ...CustomerResolver.extractDomainsFromText(input.summary),
      ...CustomerResolver.extractDomainsFromText(input.description),
    ];
    for (const domain of textDomains) {
      const hit = await this.lookupDomain(domain);
      if (hit) {
        return { customerRef: hit.customer_ref, customerName: hit.customer_name, source: 'body_url', confidence: Math.min(80, hit.confidence), isNetwork: hit.is_network, internalReporter };
      }
    }

    // 6. AI inference — future (chunk 1 leaves the hook; see spec step 8).
    return { ...UNRESOLVED, internalReporter };
  }

  /**
   * Seed the domain map from bc_customers email domains. Idempotent — skips domains
   * already mapped and never overwrites verified/manual entries. Generic free-mail
   * domains are skipped. Returns the number of new rows added.
   */
  async seedFromBcCustomers(): Promise<{ added: number; skipped: number }> {
    const rows = await query<{ number: string; display_name: string; email: string }>(
      `SELECT number, display_name, email FROM bc_customers
       WHERE email IS NOT NULL AND email <> '' AND number IS NOT NULL`,
    );
    let added = 0, skipped = 0;
    for (const r of rows) {
      const domain = CustomerResolver.emailDomain(r.email);
      if (!domain || GENERIC_DOMAINS.has(domain) || INTERNAL_DOMAINS.has(domain)) { skipped++; continue; }
      const existing = await queryOne(
        `SELECT 1 AS x FROM agent_customer_domains WHERE domain = ? AND domain_type = 'email'`, [domain],
      );
      if (existing) { skipped++; continue; }
      await execute(
        `INSERT INTO agent_customer_domains (customer_ref, customer_source, customer_name, domain, domain_type, confidence, is_verified, source_note)
         VALUES (?, 'bc', ?, ?, 'email', 70, 0, 'seed:bc_customers')`,
        [r.number, r.display_name, domain],
      );
      added++;
    }
    return { added, skipped };
  }
}
