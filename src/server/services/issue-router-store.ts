import { query, execute } from './database.js';

// Storage + rollup for AgentBrain's cross-customer issue cards (Liam's issue router).
// AgentBrain owns ticket→customer attribution + classification (JSM + Zendesk); NOVA stores
// the issue cards and inverts customer_share into a per-customer at-risk view. This replaces
// NOVA's home-grown resolver/AI-inference. See issue-router-dashboard-handover.md.

export interface IssueCardPayload {
  signature: string;
  action?: string;            // send_dashboard | update_dashboard
  route?: string;             // bug_external | ux_friction | missing_feature | docs_gap | uncertain
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
}

// Route severity weights — used to lift a customer's score for the more serious issue types.
const ROUTE_WEIGHT: Record<string, number> = {
  bug_external: 3, missing_feature: 2, ux_friction: 2, docs_gap: 1, uncertain: 1,
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
