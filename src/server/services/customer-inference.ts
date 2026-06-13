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

/** Match an extracted name/URL to the customer registry → ref + match confidence (0-1). */
async function matchToRegistry(name: string | null, url: string | null): Promise<{ ref: string; name: string; matchConf: number } | null> {
  // 1. URL/domain → existing verified domain map (strongest).
  const domain = CustomerResolver.normaliseDomain(url) ?? CustomerResolver.normaliseDomain(name);
  if (domain) {
    const d = await queryOne<{ customer_ref: string; customer_name: string | null }>(
      `SELECT TOP(1) customer_ref, customer_name FROM agent_customer_domains WHERE domain = ? ORDER BY is_verified DESC, confidence DESC`, [domain]);
    if (d) return { ref: d.customer_ref, name: d.customer_name ?? domain, matchConf: 0.95 };
  }
  // 2. Name → bc_customers / crm_customers (substring; shortest match wins = tightest).
  const n = (name ?? '').trim();
  if (n.length >= 3) {
    const bc = await queryOne<{ number: string; display_name: string }>(
      `SELECT TOP(1) number, display_name FROM bc_customers WHERE display_name LIKE ? AND number IS NOT NULL ORDER BY LEN(display_name) ASC`, [`%${n}%`]);
    if (bc) return { ref: bc.number, name: bc.display_name, matchConf: 0.8 };
    const crm = await queryOne<{ id: number; name: string }>(
      `SELECT TOP(1) id, name FROM crm_customers WHERE name LIKE ? OR company LIKE ? ORDER BY LEN(name) ASC`, [`%${n}%`, `%${n}%`]);
    if (crm) return { ref: `${CRM_REF_PREFIX}${crm.id}`, name: crm.name, matchConf: 0.7 };
  }
  return null;
}

/** Infer + cache up to `cap` tickets. Idempotent (MERGE by ticket_key). */
export async function runInferenceBatch(deps: InferenceDeps, tickets: UnresolvedTicket[], cap: number): Promise<{ attempted: number; matched: number }> {
  let attempted = 0, matched = 0;
  for (const t of tickets) {
    if (attempted >= cap) break;
    attempted++;
    let out: InferenceOut | null = null;
    try {
      const res = await deps.llmService.call<InferenceOut>(
        SYSTEM_PROMPT,
        `Ticket ${t.ticketKey}\nSummary: ${t.summary ?? ''}\nDescription: ${(t.description ?? '').slice(0, 1500)}`,
        InferenceSchema,
        { temperature: 0, tier: 'cheap', callType: 'customer_inference', ticketId: t.ticketKey, maxTokens: 250 },
      );
      out = res.data;
    } catch { /* model/parse error — record as attempted-but-unmatched so we don't retry forever */ }

    let ref: string | null = null, custName: string | null = null, conf = 0;
    if (out?.company_name) {
      const m = await matchToRegistry(out.company_name, out.instance_url);
      if (m) { ref = m.ref; custName = m.name; conf = Math.round(out.confidence * m.matchConf); matched++; }
    }
    await execute(
      `MERGE agent_ticket_customer_inference AS tgt USING (SELECT ? AS k) AS s ON tgt.ticket_key = s.k
       WHEN MATCHED THEN UPDATE SET customer_ref=?, customer_name=?, extracted_name=?, extracted_url=?, confidence=?, method='ai', inferred_at=GETUTCDATE()
       WHEN NOT MATCHED THEN INSERT (ticket_key, customer_ref, customer_name, extracted_name, extracted_url, confidence, method)
         VALUES (?, ?, ?, ?, ?, ?, 'ai');`,
      [t.ticketKey, ref, custName, out?.company_name ?? null, out?.instance_url ?? null, conf,
       t.ticketKey, ref, custName, out?.company_name ?? null, out?.instance_url ?? null, conf],
    );
  }
  return { attempted, matched };
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
