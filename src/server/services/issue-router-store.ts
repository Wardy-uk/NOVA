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

export interface AtRiskCustomer {
  customer: string; issue_count: number; ticket_total: number; growing: number;
  routes: string[]; score: number; tier: number;
}

/** Invert issue cards → per-customer at-risk league table. */
export async function getAtRiskCustomersFromIssues(): Promise<AtRiskCustomer[]> {
  const rows = await query<{ customer: string; signature: string; ticket_count: number; trend: string | null; route: string | null }>(
    `SELECT ic.customer, ic.signature, ic.ticket_count, c.trend, c.route
     FROM agent_issue_customers ic JOIN agent_issue_cards c ON c.signature = ic.signature`,
  );
  const byCust = new Map<string, AtRiskCustomer & { _routeScore: number }>();
  for (const r of rows) {
    let a = byCust.get(r.customer);
    if (!a) { a = { customer: r.customer, issue_count: 0, ticket_total: 0, growing: 0, routes: [], score: 0, tier: 0, _routeScore: 0 }; byCust.set(r.customer, a); }
    a.issue_count++;
    a.ticket_total += r.ticket_count ?? 0;
    if (r.trend === 'growing') a.growing++;
    if (r.route && !a.routes.includes(r.route)) a.routes.push(r.route);
    a._routeScore += (r.route && ROUTE_WEIGHT[r.route]) || 1;
  }
  const out = [...byCust.values()].map(a => {
    // Simple, tunable model: volume + breadth of issues + growing + route severity.
    const score = Math.min(100, Math.round(a.ticket_total * 1.5 + a.issue_count * 4 + a.growing * 10 + a._routeScore * 2));
    const tier = score >= 70 ? 4 : score >= 45 ? 3 : score >= 25 ? 2 : score >= 10 ? 1 : 0;
    return { customer: a.customer, issue_count: a.issue_count, ticket_total: a.ticket_total, growing: a.growing, routes: a.routes, score, tier };
  });
  out.sort((x, y) => y.score - x.score);
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
