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

type DomainHit = { customer_ref: string; customer_name: string | null; confidence: number; is_network: boolean };

export class CustomerResolver {
  private settings: SettingsQueries;

  // Optional in-memory index. When loaded (via loadIndex), lookups hit memory
  // instead of the DB — used by the dry-run to avoid a query per ticket (NOVA has
  // a documented connection-pool-exhaustion history).
  private domainCache: Map<string, DomainHit> | null = null;
  private orgCache: Map<string, DomainHit> | null = null;
  private bcNames: Map<string, string> | null = null;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  /** Preload the domain/org map and BC customer names into memory. */
  async loadIndex(): Promise<void> {
    const domains = await query<{ customer_ref: string; customer_name: string | null; domain: string; domain_type: string; confidence: number; is_network: boolean; is_verified: boolean }>(
      `SELECT customer_ref, customer_name, domain, domain_type, confidence, is_network, is_verified
       FROM agent_customer_domains ORDER BY is_verified DESC, confidence DESC`,
    );
    const dc = new Map<string, DomainHit>();
    const oc = new Map<string, DomainHit>();
    for (const r of domains) {
      const hit: DomainHit = { customer_ref: r.customer_ref, customer_name: r.customer_name, confidence: r.confidence, is_network: r.is_network };
      const target = r.domain_type === 'org' ? oc : dc;
      if (!target.has(r.domain)) target.set(r.domain, hit); // first wins (ordered by verified/confidence)
    }
    this.domainCache = dc;
    this.orgCache = oc;
    const bc = await query<{ number: string; display_name: string }>(
      `SELECT number, display_name FROM bc_customers WHERE number IS NOT NULL`,
    );
    this.bcNames = new Map(bc.map(r => [r.number, r.display_name]));
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

  /** Look up a domain in the customer-domain map (memory if indexed, else DB). */
  private async lookupDomain(domain: string | null): Promise<DomainHit | null> {
    if (!domain) return null;
    if (this.domainCache) return this.domainCache.get(domain) ?? null;
    return (await queryOne<DomainHit>(
      `SELECT TOP(1) customer_ref, customer_name, confidence, is_network
       FROM agent_customer_domains WHERE domain = ? ORDER BY is_verified DESC, confidence DESC`,
      [domain],
    )) ?? null;
  }

  /** Look up a JSM organization name in the map (domain_type='org'). */
  private async lookupOrg(orgName: string | null): Promise<DomainHit | null> {
    if (!orgName) return null;
    const key = orgName.toLowerCase();
    if (this.orgCache) return this.orgCache.get(key) ?? null;
    return (await queryOne<DomainHit>(
      `SELECT TOP(1) customer_ref, customer_name, confidence, is_network FROM agent_customer_domains
       WHERE domain = ? AND domain_type = 'org' ORDER BY is_verified DESC`,
      [key],
    )) ?? null;
  }

  /** Resolve a BC Account Number (e.g. "CU0001155") against bc_customers. */
  private async lookupBcNumber(bcNumber: string | null): Promise<{ customer_ref: string; customer_name: string } | null> {
    if (!bcNumber) return null;
    const n = bcNumber.trim();
    if (!n) return null;
    let displayName: string | undefined;
    if (this.bcNames) {
      displayName = this.bcNames.get(n);
    } else {
      const row = await queryOne<{ number: string; display_name: string }>(
        `SELECT TOP(1) number, display_name FROM bc_customers WHERE number = ? OR bc_id = ?`,
        [n, n],
      );
      displayName = row?.display_name;
    }
    // Even if not in bc_customers yet, the BC number is itself a valid canonical ref.
    return { customer_ref: n, customer_name: displayName ?? n };
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
    const byOrg = await this.lookupOrg(orgName);
    if (byOrg) {
      return { customerRef: byOrg.customer_ref, customerName: byOrg.customer_name, source: 'jsm_org', confidence: 95, isNetwork: byOrg.is_network, internalReporter };
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

  /**
   * One-time dry-run: seed the domain map, then resolve every cached in-scope ticket
   * and log the resolution rate by source. Read-only except for the seed. Guarded by
   * the caller via a settings flag so it runs once per deploy of this change.
   */
  async runDryRunReport(projects: string[], sinceIso = '2025-10-31'): Promise<void> {
    const t0 = Date.now();
    console.log('[risk-resolver] Dry-run starting…');
    const seed = await this.seedFromBcCustomers();
    console.log(`[risk-resolver] Domain seed from bc_customers: +${seed.added} new, ${seed.skipped} skipped`);

    await this.loadIndex();
    console.log(`[risk-resolver] Index: ${this.domainCache?.size ?? 0} domains, ${this.orgCache?.size ?? 0} orgs, ${this.bcNames?.size ?? 0} BC customers`);

    const placeholders = projects.map(() => '?').join(',');
    const tickets = await query<{
      issue_key: string; project_key: string; summary: string | null;
      description_text: string | null; reporter_email: string | null;
      bc_account_number: string | null; organisation_name: string | null;
      fields_json: string | null;
    }>(
      `SELECT issue_key, project_key, summary, description_text, reporter_email,
              bc_account_number, organisation_name, fields_json
       FROM jira_issue_cache
       WHERE project_key IN (${placeholders}) AND jira_created >= ?`,
      [...projects, sinceIso],
    );

    const bySource = new Map<string, number>();
    const byProjectTotal = new Map<string, number>();
    const byProjectResolved = new Map<string, number>();
    let resolved = 0;
    const unresolvedSamples: string[] = [];

    for (const t of tickets) {
      let instanceUrl: string | null = null, customerDomain: string | null = null, websiteUrl: string | null = null;
      if (t.fields_json) {
        try {
          const f = JSON.parse(t.fields_json) as Record<string, unknown>;
          instanceUrl = (f[FIELD.INSTANCE_URL] as string) ?? null;
          customerDomain = (f[FIELD.CUSTOMER_DOMAIN] as string) ?? null;
          websiteUrl = (f[FIELD.WEBSITE_URL] as string) ?? null;
        } catch { /* malformed cache row — ignore */ }
      }
      const res = await this.resolveTicket({
        bcAccountNumber: t.bc_account_number,
        instanceUrl, customerDomain, websiteUrl,
        organizations: t.organisation_name ? [{ name: t.organisation_name }] : null,
        reporterEmail: t.reporter_email,
        summary: t.summary,
        description: t.description_text,
      });
      bySource.set(res.source, (bySource.get(res.source) ?? 0) + 1);
      byProjectTotal.set(t.project_key, (byProjectTotal.get(t.project_key) ?? 0) + 1);
      if (res.source !== 'unresolved') {
        resolved++;
        byProjectResolved.set(t.project_key, (byProjectResolved.get(t.project_key) ?? 0) + 1);
      } else if (unresolvedSamples.length < 20) {
        unresolvedSamples.push(`${t.issue_key} <${t.reporter_email ?? 'no-email'}>`);
      }
    }

    const total = tickets.length;
    const pct = (n: number) => total ? `${Math.round((n / total) * 1000) / 10}%` : '0%';
    console.log('[risk-resolver] ===== DRY-RUN REPORT =====');
    console.log(`[risk-resolver] In-scope tickets since ${sinceIso}: ${total}`);
    console.log(`[risk-resolver] Resolved to a customer: ${resolved} (${pct(resolved)})`);
    console.log('[risk-resolver] By source:');
    for (const [src, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`[risk-resolver]   ${src.padEnd(16)} ${n} (${pct(n)})`);
    }
    console.log('[risk-resolver] By project (resolved/total):');
    for (const proj of projects) {
      const tot = byProjectTotal.get(proj) ?? 0;
      const r = byProjectResolved.get(proj) ?? 0;
      console.log(`[risk-resolver]   ${proj.padEnd(6)} ${r}/${tot}`);
    }
    console.log(`[risk-resolver] Unresolved samples: ${unresolvedSamples.join(', ') || '(none)'}`);
    console.log(`[risk-resolver] ===== done in ${Math.round((Date.now() - t0) / 1000)}s =====`);

    // Persist a compact report so it's retrievable without log access (settings.json
    // is read by the admin UI and survives restarts). This is the canonical result.
    const report = {
      generatedAt: new Date().toISOString(),
      sinceIso,
      seed,
      indexSize: { domains: this.domainCache?.size ?? 0, orgs: this.orgCache?.size ?? 0, bcCustomers: this.bcNames?.size ?? 0 },
      totalTickets: total,
      resolved,
      resolvedPct: total ? Math.round((resolved / total) * 1000) / 10 : 0,
      bySource: Object.fromEntries(bySource),
      byProject: projects.map(p => ({ project: p, resolved: byProjectResolved.get(p) ?? 0, total: byProjectTotal.get(p) ?? 0 })),
      unresolvedSamples,
    };
    try {
      this.settings.set('risk_resolver_dryrun_report', JSON.stringify(report));
    } catch (err) {
      console.warn('[risk-resolver] failed to persist report:', err instanceof Error ? err.message : err);
    }
  }
}
