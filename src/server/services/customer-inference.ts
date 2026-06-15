import { z } from 'zod';
import { query, queryOne, execute } from './database.js';
import type { LlmService } from './llm-service.js';
import { CustomerResolver } from './customer-resolver.js';

// AI customer inference (account-risk step 2): for tickets the deterministic chain can't
// resolve, ask a cheap model to read out the customer from the ticket text, then fuzzy-match
// to the registry. Results are cached in agent_ticket_customer_inference so each ticket is
// inferred once; the rollup consumes them as a resolution source. See account-risk-spec.md.

const InferenceSchema = z.object({
  company_name: z.string().nullable(),
  instance_url: z.string().nullable(),
  confidence: z.number().min(0).max(100),
});
type InferenceOut = z.infer<typeof InferenceSchema>;

const SYSTEM_PROMPT = `You identify which CUSTOMER a support ticket is about, from the ticket text only.
Context: Nurtur provides software (estate-agency websites, CRM, email marketing) to UK estate agents. A ticket's customer is the estate agency / property business the issue concerns.
Extract:
- company_name: the customer agency/business name. NOT "Nurtur"/"BriefYourMarket" (the vendor), NOT a software product, NOT an individual person's name unless it's clearly the trading name. null if you genuinely cannot tell.
- instance_url: any website/instance/feed URL or bare domain mentioned (e.g. "acen.co.uk", "foo.briefyourmarket.com"). null if none.
- confidence: 0-100 for company_name.
Return only those three fields.`;

export interface InferenceDeps { llmService: LlmService; }

export interface UnresolvedTicket { ticketKey: string; summary: string | null; description: string | null; }

const CRM_REF_PREFIX = 'crm:';

// A network/brand PARENT or internal entity stated on its own. Attributing member tickets to
// these collapses hundreds of distinct agencies onto one account, so they are NOT valid match
// targets. Anchored brand-only forms so a specific member ("Ajq Property Ltd T/A F&C West
// Hampstead") is NOT caught; internal tokens (nurtur/intercompany/briefyourmarket) match anywhere.
export const BRAND_ONLY_OR_INTERNAL =
  /^(the\s+)?guild(\s+of\s+property\s+professionals)?$|^fine\s*(and|&)\s*country$|^f\s*&?\s*c$|^exp(\s+(uk|realty))?$|^(the\s+)?property\s+franchise(\s+group)?$|^ewemove$|^know\s*your\s*market$|nurtur|intercompany|brief\s*your\s*market/i;

// Shared network/product domains — owned by the network, not a single member, so they can't
// pick out a specific customer.
export const NETWORK_OR_INTERNAL_DOMAINS = new Set([
  'guildproperty.co.uk', 'fineandcountry.com', 'ewemove.com', 'exp.uk.com', 'propertyfranchise.co.uk',
  'knowyourmarket.net', 'nurtur.tech', 'nurtur.digital', 'briefyourmarket.com',
]);

/**
 * Match an extracted name/URL to the registry → ref + match confidence (0-1). Strict: rejects
 * brand-only/internal names and shared network domains, and only accepts an UNAMBIGUOUS name
 * match (exact, or a single registry row containing it) — no "shortest of many" guessing.
 */
async function matchToRegistry(name: string | null, url: string | null): Promise<{ ref: string; name: string; matchConf: number } | null> {
  const n = (name ?? '').trim();
  if (n && BRAND_ONLY_OR_INTERNAL.test(n)) return null;  // network parent / internal → not attributable to one customer

  // 1. Specific (non-network) domain → map.
  const domain = CustomerResolver.normaliseDomain(url) ?? CustomerResolver.normaliseDomain(n);
  if (domain && !NETWORK_OR_INTERNAL_DOMAINS.has(domain)) {
    const d = await queryOne<{ customer_ref: string; customer_name: string | null }>(
      `SELECT TOP(1) customer_ref, customer_name FROM agent_customer_domains WHERE domain = ? ORDER BY is_verified DESC, confidence DESC`, [domain]);
    if (d && !(d.customer_name && BRAND_ONLY_OR_INTERNAL.test(d.customer_name))) {
      return { ref: d.customer_ref, name: d.customer_name ?? domain, matchConf: 0.9 };
    }
  }

  if (n.length < 5) return null;
  // 2. Exact name match (normalised).
  const exact = await queryOne<{ number: string; display_name: string }>(
    `SELECT TOP(1) number, display_name FROM bc_customers WHERE LOWER(display_name) = LOWER(?) AND number IS NOT NULL`, [n]);
  if (exact) return { ref: exact.number, name: exact.display_name, matchConf: 0.9 };
  // 3. Containment — but ONLY if unambiguous (exactly one registry row contains it).
  const bcHits = await query<{ number: string; display_name: string }>(
    `SELECT TOP(2) number, display_name FROM bc_customers WHERE display_name LIKE ? AND number IS NOT NULL`, [`%${n}%`]);
  if (bcHits.length === 1) return { ref: bcHits[0].number, name: bcHits[0].display_name, matchConf: 0.75 };
  const crmHits = await query<{ id: number; name: string }>(
    `SELECT TOP(2) id, name FROM crm_customers WHERE name LIKE ? OR company LIKE ?`, [`%${n}%`, `%${n}%`]);
  if (crmHits.length === 1) return { ref: `${CRM_REF_PREFIX}${crmHits[0].id}`, name: crmHits[0].name, matchConf: 0.7 };
  return null;  // no match or ambiguous → leave unresolved rather than guess
}

/**
 * Re-match all cached inferences against the (fixed) matcher WITHOUT re-calling the model — the
 * extractions were fine, only the matching was wrong. Cheap + fast; clears the collapse.
 */
export async function rematchAllInferences(): Promise<{ updated: number; nowMatched: number }> {
  const rows = await query<{ ticket_key: string; extracted_name: string | null; extracted_url: string | null; confidence: number }>(
    `SELECT ticket_key, extracted_name, extracted_url, confidence FROM agent_ticket_customer_inference`);
  let updated = 0, nowMatched = 0;
  for (const r of rows) {
    const m = r.extracted_name || r.extracted_url ? await matchToRegistry(r.extracted_name, r.extracted_url) : null;
    const ref = m?.ref ?? null;
    const cname = m?.name ?? null;
    // confidence: keep the model's read scaled by the (new) match strength; 0 if now unmatched.
    const conf = m ? Math.min(95, Math.round(60 * m.matchConf) + 20) : 0;
    if (m) nowMatched++;
    await execute(
      `UPDATE agent_ticket_customer_inference SET customer_ref=?, customer_name=?, confidence=? WHERE ticket_key=?`,
      [ref, cname, conf, r.ticket_key]);
    updated++;
  }
  return { updated, nowMatched };
}

/** Infer one ticket's customer and cache the result. Returns whether it matched a customer. */
async function inferAndCacheOne(deps: InferenceDeps, t: UnresolvedTicket): Promise<boolean> {
  let out: InferenceOut | null = null;
  try {
    const res = await deps.llmService.call<InferenceOut>(
      SYSTEM_PROMPT,
      `Ticket ${t.ticketKey}\nSummary: ${t.summary ?? ''}\nDescription: ${(t.description ?? '').slice(0, 1500)}`,
      InferenceSchema,
      { temperature: 0, tier: 'cheap', callType: 'customer_inference', ticketId: t.ticketKey, maxTokens: 250 },
    );
    out = res.data;
  } catch { /* model/parse error — still cache as attempted so we don't retry forever */ }

  let ref: string | null = null, custName: string | null = null, conf = 0, matched = false;
  if (out?.company_name) {
    const m = await matchToRegistry(out.company_name, out.instance_url);
    if (m) { ref = m.ref; custName = m.name; conf = Math.round(out.confidence * m.matchConf); matched = true; }
  }
  await execute(
    `MERGE agent_ticket_customer_inference AS tgt USING (SELECT ? AS k) AS s ON tgt.ticket_key = s.k
     WHEN MATCHED THEN UPDATE SET customer_ref=?, customer_name=?, extracted_name=?, extracted_url=?, confidence=?, method='ai', inferred_at=GETUTCDATE()
     WHEN NOT MATCHED THEN INSERT (ticket_key, customer_ref, customer_name, extracted_name, extracted_url, confidence, method)
       VALUES (?, ?, ?, ?, ?, ?, 'ai');`,
    [t.ticketKey, ref, custName, out?.company_name ?? null, out?.instance_url ?? null, conf,
     t.ticketKey, ref, custName, out?.company_name ?? null, out?.instance_url ?? null, conf],
  );
  return matched;
}

/** Enqueue unresolved tickets for the background worker (skips ones already inferred). */
export async function enqueueForInference(tickets: UnresolvedTicket[]): Promise<number> {
  let added = 0;
  for (const t of tickets) {
    const r = await execute(
      `MERGE agent_inference_queue AS tgt USING (SELECT ? AS k) AS s ON tgt.ticket_key = s.k
       WHEN NOT MATCHED AND NOT EXISTS (SELECT 1 FROM agent_ticket_customer_inference i WHERE i.ticket_key = s.k)
         THEN INSERT (ticket_key, summary, description) VALUES (?, ?, ?);`,
      [t.ticketKey, t.ticketKey, t.summary, (t.description ?? '').slice(0, 1900)],
    );
    added += r.rowsAffected;
  }
  return added;
}

/**
 * Drain up to `chunk` tickets from the queue: infer, cache, dequeue. Resumable — survives
 * restarts because progress lives in the DB (cache + queue), not in memory. Newest first.
 */
export async function processInferenceQueue(deps: InferenceDeps, chunk: number): Promise<{ processed: number; matched: number; remaining: number }> {
  const rows = await query<{ ticket_key: string; summary: string | null; description: string | null }>(
    `SELECT TOP (${Math.max(1, Math.floor(chunk))}) ticket_key, summary, description
     FROM agent_inference_queue ORDER BY ticket_key DESC`,
  );
  let matched = 0;
  for (const row of rows) {
    try {
      if (await inferAndCacheOne(deps, { ticketKey: row.ticket_key, summary: row.summary, description: row.description })) matched++;
    } catch { /* leave in queue to retry next tick */ continue; }
    await execute(`DELETE FROM agent_inference_queue WHERE ticket_key = ?`, [row.ticket_key]);
  }
  const rem = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_inference_queue`);
  return { processed: rows.length, matched, remaining: rem?.n ?? 0 };
}

/** Confident, matched inferences keyed by ticket — consumed by the rollup as a resolution source. */
export async function loadInferenceMap(minConfidence = 50): Promise<Map<string, { ref: string; name: string | null; confidence: number }>> {
  const rows = await query<{ ticket_key: string; customer_ref: string; customer_name: string | null; confidence: number }>(
    `SELECT ticket_key, customer_ref, customer_name, confidence FROM agent_ticket_customer_inference
     WHERE customer_ref IS NOT NULL AND confidence >= ?`, [minConfidence]);
  return new Map(rows.map(r => [r.ticket_key, { ref: r.customer_ref, name: r.customer_name, confidence: r.confidence }]));
}

/** All tickets already attempted (any outcome) — so we don't re-infer them. */
export async function loadInferredKeys(): Promise<Set<string>> {
  const rows = await query<{ ticket_key: string }>(`SELECT ticket_key FROM agent_ticket_customer_inference`);
  return new Set(rows.map(r => r.ticket_key));
}
