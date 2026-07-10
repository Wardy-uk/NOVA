import { query, execute } from './database.js';

// Storage + rollup for AgentBrain's cross-customer issue cards (Liam's issue router).
// AgentBrain owns ticket→customer attribution + classification (JSM + Zendesk); NOVA stores
// the issue cards and inverts customer_share into a per-customer at-risk view. This replaces
// NOVA's home-grown resolver/AI-inference. See issue-router-dashboard-handover.md.

export interface IssueCardPayload {
  signature: string;
  action?: string;            // send_dashboard | update_dashboard
  route?: string;             // bug_external | bug_internal | ux_friction | missing_feature | docs_gap | uncertain
  confidence?: number;        // 0.0-1.0
  severity?: string;          // optional
  title?: string;
  problem_statement?: string;
  customer_share?: { customer?: string; count?: number; pct?: number }[];
  customer_count?: number;
  frequency_label?: string;
  trend?: string;             // new | growing | stable
  first_seen?: string;
  last_seen?: string;
  citing_tickets?: { key?: string; source?: string; url?: string | null }[];
  reasoning?: string;
}

const isoOrNull = (s: string | undefined): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const jsonOrNull = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

/** Upsert one issue card by signature, and rebuild its per-customer rows. Idempotent. */
export async function upsertIssueCard(p: IssueCardPayload): Promise<void> {
  if (!p.signature || typeof p.signature !== 'string') throw new Error('signature is required');
  const conf = typeof p.confidence === 'number' ? p.confidence : null;
  const cc = typeof p.customer_count === 'number' ? p.customer_count : null;
  const vals = [
    p.route ?? null, conf, p.severity ?? null, p.title ?? null, p.problem_statement ?? null,
    cc, p.frequency_label ?? null, p.trend ?? null, isoOrNull(p.first_seen), isoOrNull(p.last_seen),
    p.reasoning ?? null, jsonOrNull(p.customer_share), jsonOrNull(p.citing_tickets), p.action ?? null,
  ];
  await execute(
    `MERGE agent_issue_cards AS t USING (SELECT ? AS sig) AS s ON t.signature = s.sig
     WHEN MATCHED THEN UPDATE SET
       route=?, confidence=?, severity=?, title=?, problem_statement=?, customer_count=?,
       frequency_label=?, trend=?, first_seen=?, last_seen=?, reasoning=?, customer_share=?,
       citing_tickets=?, last_action=?, updated_at=GETUTCDATE()
     WHEN NOT MATCHED THEN INSERT
       (signature, route, confidence, severity, title, problem_statement, customer_count,
        frequency_label, trend, first_seen, last_seen, reasoning, customer_share, citing_tickets, last_action)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [p.signature, ...vals, p.signature, ...vals],
  );

  await execute(`DELETE FROM agent_issue_customers WHERE signature = ?`, [p.signature]);
  for (const cs of p.customer_share ?? []) {
    if (!cs || !cs.customer) continue;
    await execute(
      `INSERT INTO agent_issue_customers (signature, customer, ticket_count, pct) VALUES (?, ?, ?, ?)`,
      [p.signature, String(cs.customer).slice(0, 255), Number(cs.count) || 0, typeof cs.pct === 'number' ? cs.pct : null],
    );
  }

  await execute(`DELETE FROM agent_issue_tickets WHERE signature = ?`, [p.signature]);
  const seen = new Set<string>();
  for (const ct of p.citing_tickets ?? []) {
    if (!ct || !ct.key) continue;
    const key = String(ct.key).slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    await execute(
      `INSERT INTO agent_issue_tickets (signature, ticket_key, source) VALUES (?, ?, ?)`,
      [p.signature, key, ct.source ?? null],
    );
  }
}

/**
 * For the AI agent triage flag: the cross-customer issue(s) a ticket belongs to. Returns a
 * one-line note (most-affecting issue first) or null. Maps ticket → issue via citing_tickets.
 */
export async function getTicketIssueContext(ticketKey: string): Promise<string | null> {
  const rows = await query<{ title: string | null; route: string | null; trend: string | null; customer_count: number | null }>(
    `SELECT TOP(3) c.title, c.route, c.trend, c.customer_count
     FROM agent_issue_tickets t JOIN agent_issue_cards c ON c.signature = t.signature
     WHERE t.ticket_key = ? ORDER BY c.customer_count DESC`,
    [ticketKey],
  );
  if (!rows.length) return null;
  const top = rows[0];
  const bits: string[] = [];
  if (top.route) bits.push(top.route.replace(/_/g, ' '));
  if (top.trend && top.trend !== 'stable') bits.push(top.trend);
  if (top.customer_count) bits.push(`${top.customer_count} customers affected`);
  const more = rows.length > 1 ? ` (+${rows.length - 1} more)` : '';
  return `⚠️ **Known cross-customer issue:** ${top.title ?? 'pattern'}${bits.length ? ` — ${bits.join(', ')}` : ''}${more}`;
}

export interface IssueSummary {
  totalIssues: number; atRiskCustomers: number; growing: number;
  byRoute: { route: string; count: number }[];
}

export async function getIssueSummary(): Promise<IssueSummary> {
  const [totals, routes] = await Promise.all([
    query<{ totalIssues: number; growing: number }>(
      `SELECT COUNT(*) AS totalIssues, SUM(CASE WHEN trend='growing' THEN 1 ELSE 0 END) AS growing FROM agent_issue_cards`),
    query<{ route: string; count: number }>(
      `SELECT ISNULL(route,'uncertain') AS route, COUNT(*) AS count FROM agent_issue_cards GROUP BY route ORDER BY COUNT(*) DESC`),
  ]);
  const atRisk = await query<{ n: number }>(`SELECT COUNT(DISTINCT customer) AS n FROM agent_issue_customers`);
  return {
    totalIssues: totals[0]?.totalIssues ?? 0,
    growing: totals[0]?.growing ?? 0,
    atRiskCustomers: atRisk[0]?.n ?? 0,
    byRoute: routes.map(r => ({ route: r.route, count: r.count })),
  };
}

// Route severity weights — used to lift a customer's score for the more serious issue types.
const ROUTE_WEIGHT: Record<string, number> = {
  bug_external: 3, bug_internal: 3, missing_feature: 2, ux_friction: 2, docs_gap: 1, uncertain: 1,
};

// ── Customer-name canonicalisation for the at-risk league ────────────────────
// AgentBrain attributes tickets to free-text customer names and often splits one
// real customer across variants ("Fine & Country (Head Office)" vs "Fine & Country
// (+1 related)", "Manxmove" vs "Manx Move", ±"Limited"). It also attributes some
// tickets to third-party portals/tools and to us. This layer collapses variants,
// rolls known brands up to their parent account, and drops non-customers. It is
// DISPLAY-ONLY — the stored agent_issue_* rows are never rewritten.

// Rows that are NOT at-risk customers (portals, CRMs, lead tools, internal).
// Matched case-insensitively against the exact AgentBrain string. Keep this tight
// and high-confidence — real customers are attributed by their own website domain
// (e.g. angusandco.uk), so we never blanket-exclude bare domains.
const NON_CUSTOMER_NAMES = new Set([
  'nurtur limited (intercompany)',
  'rightmove', 'onthemarket.com', 'getagent.co.uk', 'thenegotiator.co.uk',
  'property drum', 'yomdel', 'homesearch limited', 'properstar.com',
  'loop.software', 'lead.pro', 'notify.lead.pro', 'leadpro limited',
  'out.propertylogic.net', 'agentsoftware.net', 'acturis limited', 'lily comms',
  'expuk.com',
]);

// Curated parent rollups: any raw name whose normalised form matches a rule
// collapses into that canonical account. Extend as more franchise groups emerge.
interface ParentRule { display: string; match: (norm: string) => boolean; }
const PARENT_RULES: ParentRule[] = [
  {
    // GPEA Ltd = Fine & Country (all variants) + The Guild of Property Professionals.
    display: 'GPEA',
    match: n =>
      n.startsWith('fine & country') || n.startsWith('fine and country') ||
      n.startsWith('gpea') || n.includes('t/a fine & country') ||
      n.startsWith('the guild of property') || n.startsWith('guild property'),
  },
];

// Trailing parenthetical grouping artifacts AgentBrain appends: "(Head Office)",
// "(+1 related)", "(+3 related)", "(+4)". Conservative on purpose — we do NOT
// strip arbitrary parens (e.g. "(South Coast & Weald)") which can distinguish branches.
const GROUP_SUFFIX = /\s*\((?:head office|\+\s*\d+(?:\s+related)?|[^)]*\brelated\b[^)]*)\)\s*$/gi;

/** Lowercase + strip AgentBrain grouping suffixes. Basis for rollup matching. */
function normName(raw: string): string {
  return raw.trim().toLowerCase().replace(GROUP_SUFFIX, '').trim();
}

/** Whitespace/punctuation/legal-suffix-insensitive key for auto same-entity merge. */
function mergeKey(norm: string): string {
  let s = norm;
  for (let i = 0; i < 3; i++) s = s.replace(/[\s,]+(?:limited|ltd|llp|plc|llc|inc)\.?$/i, '').trim();
  return s.replace(/[^a-z0-9]+/g, '');
}

export interface CanonCustomer { key: string; display: string; }

/** Canonical {key, display} for an AgentBrain customer string, or null if it is
 *  not an at-risk customer (portal/tool/internal). Exported for the WHY panel. */
export function canonicalCustomer(raw: string): CanonCustomer | null {
  if (!raw || !raw.trim()) return null;
  if (NON_CUSTOMER_NAMES.has(raw.trim().toLowerCase())) return null;
  const norm = normName(raw);
  for (const rule of PARENT_RULES) {
    if (rule.match(norm)) return { key: 'parent:' + rule.display.toLowerCase(), display: rule.display };
  }
  // Auto-merge variants of the same entity; display strips only the grouping suffix.
  const display = raw.replace(GROUP_SUFFIX, '').trim() || raw.trim();
  return { key: mergeKey(norm), display };
}

export interface AtRiskCustomer {
  customer: string; key: string; members: string[];
  issue_count: number; ticket_total: number; growing: number;
  routes: string[]; score: number; tier: number;
}

/** Invert issue cards → per-customer at-risk league table, with variant customer
 *  names collapsed to a single canonical account (see canonicalCustomer). */
export async function getAtRiskCustomersFromIssues(): Promise<AtRiskCustomer[]> {
  const rows = await query<{ customer: string; signature: string; ticket_count: number; trend: string | null; route: string | null }>(
    `SELECT ic.customer, ic.signature, ic.ticket_count, c.trend, c.route
     FROM agent_issue_customers ic JOIN agent_issue_cards c ON c.signature = ic.signature`,
  );
  interface Acc {
    key: string; forced: string | null;
    displays: Map<string, number>;          // display candidate → ticket weight (picks the busiest variant)
    members: Set<string>;                    // raw AgentBrain names merged here
    sigs: Map<string, { route: string | null; trend: string | null; ticket: number }>; // per issue, deduped
  }
  const byKey = new Map<string, Acc>();
  for (const r of rows) {
    const canon = canonicalCustomer(r.customer);
    if (!canon) continue;                    // excluded non-customer
    let a = byKey.get(canon.key);
    if (!a) { a = { key: canon.key, forced: canon.key.startsWith('parent:') ? canon.display : null, displays: new Map(), members: new Set(), sigs: new Map() }; byKey.set(canon.key, a); }
    a.members.add(r.customer);
    a.displays.set(canon.display, (a.displays.get(canon.display) || 0) + (r.ticket_count ?? 0));
    // Dedupe by signature so a customer split across variants isn't counted twice per issue.
    const e = a.sigs.get(r.signature) || { route: r.route, trend: r.trend, ticket: 0 };
    e.ticket += r.ticket_count ?? 0;
    a.sigs.set(r.signature, e);
  }
  const out = [...byKey.values()].map(a => {
    const issue_count = a.sigs.size;
    let ticket_total = 0, growing = 0, routeScore = 0;
    const routes: string[] = [];
    for (const e of a.sigs.values()) {
      ticket_total += e.ticket;
      if (e.trend === 'growing') growing++;
      if (e.route && !routes.includes(e.route)) routes.push(e.route);
      routeScore += (e.route && ROUTE_WEIGHT[e.route]) || 1;
    }
    // Simple, tunable model: volume + breadth of issues + growing + route severity.
    // rawScore is uncapped so the league still orders correctly once many accounts
    // saturate the 0–100 badge score (which drives the HIGH/MEDIUM tier only).
    const rawScore = ticket_total * 1.5 + issue_count * 4 + growing * 10 + routeScore * 2;
    const score = Math.min(100, Math.round(rawScore));
    const tier = score >= 70 ? 4 : score >= 45 ? 3 : score >= 25 ? 2 : score >= 10 ? 1 : 0;
    // Display: forced parent name, else the busiest variant string.
    const customer = a.forced || [...a.displays.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || 'Unknown account';
    return { customer, key: a.key, members: [...a.members], issue_count, ticket_total, growing, routes, score, tier, rawScore };
  });
  out.sort((x, y) => y.rawScore - x.rawScore);
  return out;
}

export async function getIssueCards(limit = 200): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    `SELECT TOP (${Math.max(1, Math.floor(limit))}) signature, route, confidence, severity, title,
            problem_statement, customer_count, frequency_label, trend, first_seen, last_seen,
            customer_share, citing_tickets, last_action, received_at, updated_at
     FROM agent_issue_cards ORDER BY updated_at DESC`,
  );
}
