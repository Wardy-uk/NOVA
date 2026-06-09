import { query, execute, queryOne } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { CustomerResolver, FIELD } from './customer-resolver.js';

// Per-CUSTOMER risk rollup + nightly reconciliation. See agent_work/ba/account-risk-spec.md.
//
// Distinct from risk-scorer.ts (per-TICKET "which open tickets are going wrong now").
// This aggregates risk signals across all of a customer's tickets into a churn/complaint/
// termination risk score, with decay, and reconciles per-project/per-day coverage so every
// customer-facing ticket is either attributed to a customer or counted as unresolved.

interface SignalDef {
  type: string;
  weight: number;
  re: RegExp;            // matched against summary + description (JS)
  sql: string;           // matched against public comment bodies (SQL)
  setsFlag?: 'has_formal_complaint' | 'has_termination' | 'has_active_refund' | 'has_open_escalation';
}

// Ordered high → low. SQL uses lower-cased LIKE; keep patterns lower-case.
const SIGNALS: SignalDef[] = [
  { type: 'formal_complaint', weight: 40, setsFlag: 'has_formal_complaint',
    re: /\b(formal complaint|complaints procedure|making a complaint)\b/i,
    sql: "body_text LIKE '%formal complaint%' OR body_text LIKE '%complaints procedure%'" },
  { type: 'termination', weight: 40, setsFlag: 'has_termination',
    re: /\b(terminat\w*|notice to terminate|cancel(?:ling|lation)? (?:our|the|my) (?:contract|account|membership|subscription)|leaving nurtur)\b/i,
    sql: "body_text LIKE '%terminat%' OR body_text LIKE '%notice to terminate%' OR body_text LIKE '%cancelling our contract%' OR body_text LIKE '%cancel our contract%'" },
  { type: 'formal_escalation', weight: 35, setsFlag: 'has_open_escalation',
    re: /\b(formal escalation|escalate this formally|formally escalat\w*)\b/i,
    sql: "body_text LIKE '%formal escalation%' OR body_text LIKE '%formally escalat%'" },
  { type: 'refund', weight: 25, setsFlag: 'has_active_refund',
    re: /\brefund\w*\b/i,
    sql: "body_text LIKE '%refund%'" },
  { type: 'compensation', weight: 20,
    re: /\bcompensat\w*\b/i,
    sql: "body_text LIKE '%compensat%'" },
  { type: 'unacceptable', weight: 15,
    re: /\b(unacceptable|disgraceful|appalling|ridiculous)\b/i,
    sql: "body_text LIKE '%unacceptable%' OR body_text LIKE '%disgraceful%' OR body_text LIKE '%appalling%'" },
  { type: 'frustrated', weight: 10,
    re: /\b(frustrat\w*|still not (?:fixed|working|resolved)|still an issue)\b/i,
    sql: "body_text LIKE '%frustrat%' OR body_text LIKE '%still not fixed%' OR body_text LIKE '%still not working%' OR body_text LIKE '%still an issue%'" },
];

function tierForScore(score: number): number {
  if (score >= 100) return 4;
  if (score >= 70) return 3;
  if (score >= 40) return 2;
  if (score >= 20) return 1;
  return 0;
}

interface TicketRow {
  issue_key: string; project_key: string; summary: string | null; description_text: string | null;
  reporter_email: string | null; bc_account_number: string | null; organisation_name: string | null;
  fields_json: string | null; status_category: string | null; jira_created: string | null;
}

interface CommentAgg {
  issue_key: string;
  [k: string]: string | number;  // has_<type> flags
}

interface CustomerAccum {
  customerRef: string;
  customerName: string | null;
  bcNumber: string | null;
  primaryDomain: string | null;
  isNetwork: boolean;
  projects: Set<string>;
  totalTickets: number;
  recentTickets: number;                 // created within 90d
  firstTicket: number | null;            // epoch ms
  lastTicket: number | null;
  score: number;                         // accumulated decayed signal weight
  flags: { has_formal_complaint: boolean; has_termination: boolean; has_active_refund: boolean; has_open_escalation: boolean };
  signalRows: { ticketKey: string; project: string; type: string; weight: number; isActive: boolean; evidence: string | null; ticketCreated: string | null; ticketStatus: string | null }[];
}

export class AccountRiskEngine {
  private settings: SettingsQueries;
  private resolver: CustomerResolver;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
    this.resolver = new CustomerResolver(settings);
  }

  /** Decay factor for a ticket's signals: resolved 0.25, open >90d 0.5, open recent 1.0. */
  private decayFactor(resolved: boolean, ageDays: number): number {
    if (resolved) return 0.25;
    if (ageDays > 90) return 0.5;
    return 1;
  }

  /**
   * Full rollup + reconciliation over in-scope tickets. Idempotent — safe to re-run
   * (upserts by customer/ticket/day). Returns a compact summary.
   */
  async runRollupAndRecon(projects: string[], sinceIso = '2025-10-31'): Promise<Record<string, unknown>> {
    const t0 = Date.now();
    const now = Date.now();
    console.log('[account-risk] Rollup + recon starting…');

    await this.resolver.seedFromBcCustomers().catch(() => {});
    await this.resolver.loadIndex();

    const ph = projects.map(() => '?').join(',');
    const tickets = await query<TicketRow>(
      `SELECT issue_key, project_key, summary, description_text, reporter_email,
              bc_account_number, organisation_name, fields_json, status_category, jira_created
       FROM jira_issue_cache
       WHERE project_key IN (${ph}) AND jira_created >= ?`,
      [...projects, sinceIso],
    );

    // Comment-derived signal flags, one row per ticket, via JOIN (no huge IN list).
    const aggSelect = SIGNALS.map(s => `MAX(CASE WHEN ${s.sql} THEN 1 ELSE 0 END) AS has_${s.type}`).join(',\n         ');
    const commentAggs = await query<CommentAgg>(
      `SELECT c.issue_key,
         ${aggSelect}
       FROM jira_comment_cache c
       JOIN jira_issue_cache j ON j.issue_key = c.issue_key
       WHERE j.project_key IN (${ph}) AND j.jira_created >= ? AND c.is_public = 1
       GROUP BY c.issue_key`,
      [...projects, sinceIso],
    );
    const aggMap = new Map<string, CommentAgg>(commentAggs.map(r => [r.issue_key, r]));

    const customers = new Map<string, CustomerAccum>();
    // recon tallies keyed by `${project}|${yyyy-mm-dd}`
    const reconTotal = new Map<string, number>();
    const reconResolved = new Map<string, number>();
    let resolvedCount = 0;

    for (const t of tickets) {
      const dayKey = t.jira_created ? `${t.project_key}|${t.jira_created.slice(0, 10)}` : null;
      if (dayKey) reconTotal.set(dayKey, (reconTotal.get(dayKey) ?? 0) + 1);

      // Resolve customer.
      let instanceUrl: string | null = null, customerDomain: string | null = null, websiteUrl: string | null = null;
      if (t.fields_json) {
        try {
          const f = JSON.parse(t.fields_json) as Record<string, unknown>;
          instanceUrl = (f[FIELD.INSTANCE_URL] as string) ?? null;
          customerDomain = (f[FIELD.CUSTOMER_DOMAIN] as string) ?? null;
          websiteUrl = (f[FIELD.WEBSITE_URL] as string) ?? null;
        } catch { /* ignore */ }
      }
      const res = await this.resolver.resolveTicket({
        bcAccountNumber: t.bc_account_number, instanceUrl, customerDomain, websiteUrl,
        organizations: t.organisation_name ? [{ name: t.organisation_name }] : null,
        reporterEmail: t.reporter_email, summary: t.summary, description: t.description_text,
      });
      if (!res.customerRef) continue;  // unresolved → counts toward recon total only
      resolvedCount++;
      if (dayKey) reconResolved.set(dayKey, (reconResolved.get(dayKey) ?? 0) + 1);

      // Accumulate per customer.
      let acc = customers.get(res.customerRef);
      if (!acc) {
        acc = {
          customerRef: res.customerRef, customerName: res.customerName, bcNumber: res.source === 'bc_field' ? res.customerRef : null,
          primaryDomain: CustomerResolver.emailDomain(t.reporter_email), isNetwork: res.isNetwork,
          projects: new Set(), totalTickets: 0, recentTickets: 0, firstTicket: null, lastTicket: null,
          score: 0, flags: { has_formal_complaint: false, has_termination: false, has_active_refund: false, has_open_escalation: false }, signalRows: [],
        };
        customers.set(res.customerRef, acc);
      }
      acc.projects.add(t.project_key);
      acc.totalTickets++;
      const createdMs = t.jira_created ? new Date(t.jira_created).getTime() : null;
      if (createdMs) {
        acc.firstTicket = acc.firstTicket === null ? createdMs : Math.min(acc.firstTicket, createdMs);
        acc.lastTicket = acc.lastTicket === null ? createdMs : Math.max(acc.lastTicket, createdMs);
        if ((now - createdMs) / 86_400_000 <= 90) acc.recentTickets++;
      }

      const resolved = t.status_category === 'done';
      const ageDays = createdMs ? (now - createdMs) / 86_400_000 : 0;
      const decay = this.decayFactor(resolved, ageDays);
      const haystack = `${t.summary ?? ''}\n${t.description_text ?? ''}`;
      const agg = aggMap.get(t.issue_key);

      for (const sig of SIGNALS) {
        const inComments = agg ? Number(agg[`has_${sig.type}`]) === 1 : false;
        const inBody = sig.re.test(haystack);
        if (!inComments && !inBody) continue;
        acc.score += sig.weight * decay;
        acc.signalRows.push({
          ticketKey: t.issue_key, project: t.project_key, type: sig.type, weight: Math.round(sig.weight * decay),
          isActive: !resolved, evidence: inBody ? haystack.slice(0, 200) : '(comment match)',
          ticketCreated: t.jira_created, ticketStatus: t.status_category,
        });
        if (sig.setsFlag && !resolved) acc.flags[sig.setsFlag] = true;
      }
    }

    // Volume + cross-project signals, finalise score/tier, write.
    let written = 0, tierChanges = 0;
    for (const acc of customers.values()) {
      if (acc.recentTickets >= 50) acc.score += 30;
      else if (acc.recentTickets >= 20) acc.score += 20;
      else if (acc.recentTickets >= 10) acc.score += 10;
      if (acc.projects.size > 1) acc.score += 15;

      const score = Math.min(100, Math.round(acc.score));
      const tier = tierForScore(score);
      if (score === 0) continue;  // only persist customers with actual risk signal

      const existing = await queryOne<{ risk_score: number; risk_tier: number }>(
        `SELECT risk_score, risk_tier FROM agent_account_risk WHERE customer_ref = ?`, [acc.customerRef],
      );
      const firstDate = acc.firstTicket ? new Date(acc.firstTicket).toISOString() : null;
      const lastDate = acc.lastTicket ? new Date(acc.lastTicket).toISOString() : null;

      await execute(
        `MERGE agent_account_risk AS target
         USING (SELECT ? AS customer_ref) AS src ON target.customer_ref = src.customer_ref
         WHEN MATCHED THEN UPDATE SET
           customer_name = ?, bc_number = ?, primary_domain = ?, risk_score = ?, risk_tier = ?,
           has_formal_complaint = ?, has_termination = ?, has_active_refund = ?, has_open_escalation = ?,
           is_network_account = ?, total_ticket_count = ?, first_ticket_date = ?, last_ticket_date = ?,
           last_score_update = GETUTCDATE(), updated_at = GETUTCDATE()
         WHEN NOT MATCHED THEN INSERT
           (customer_ref, customer_source, customer_name, bc_number, primary_domain, risk_score, risk_tier,
            has_formal_complaint, has_termination, has_active_refund, has_open_escalation, is_network_account,
            total_ticket_count, first_ticket_date, last_ticket_date, last_score_update)
         VALUES (?, 'bc', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETUTCDATE());`,
        [
          acc.customerRef,
          acc.customerName, acc.bcNumber, acc.primaryDomain, score, tier,
          acc.flags.has_formal_complaint ? 1 : 0, acc.flags.has_termination ? 1 : 0, acc.flags.has_active_refund ? 1 : 0, acc.flags.has_open_escalation ? 1 : 0,
          acc.isNetwork ? 1 : 0, acc.totalTickets, firstDate, lastDate,
          acc.customerRef,
          acc.customerName, acc.bcNumber, acc.primaryDomain, score, tier,
          acc.flags.has_formal_complaint ? 1 : 0, acc.flags.has_termination ? 1 : 0, acc.flags.has_active_refund ? 1 : 0, acc.flags.has_open_escalation ? 1 : 0,
          acc.isNetwork ? 1 : 0, acc.totalTickets, firstDate, lastDate,
        ],
      );

      if (existing && existing.risk_tier !== tier) {
        tierChanges++;
        await execute(
          `INSERT INTO agent_account_risk_history (customer_ref, previous_score, new_score, previous_tier, new_tier, change_reason)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [acc.customerRef, existing.risk_score, score, existing.risk_tier, tier, 'rollup recalculation'],
        );
      }

      // Replace this customer's signal rows (idempotent rebuild).
      await execute(`DELETE FROM agent_account_risk_signals WHERE customer_ref = ?`, [acc.customerRef]);
      for (const s of acc.signalRows) {
        await execute(
          `INSERT INTO agent_account_risk_signals (customer_ref, ticket_key, project_key, signal_type, signal_weight, is_active, evidence_text, ticket_created_at, ticket_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [acc.customerRef, s.ticketKey, s.project, s.type, s.weight, s.isActive ? 1 : 0, s.evidence, s.ticketCreated, s.ticketStatus],
        );
      }
      written++;
    }

    // Reconciliation ledger: upsert each project/day, seal fully-resolved days.
    let daysComplete = 0, daysPartial = 0;
    for (const [key, total] of reconTotal.entries()) {
      const [project, day] = key.split('|');
      const resolved = reconResolved.get(key) ?? 0;
      const status = resolved >= total && total > 0 ? 'complete' : 'partial';
      if (status === 'complete') daysComplete++; else daysPartial++;
      await execute(
        `MERGE agent_risk_recon_days AS target
         USING (SELECT ? AS project_key, ? AS recon_date) AS src
           ON target.project_key = src.project_key AND target.recon_date = src.recon_date
         WHEN MATCHED THEN UPDATE SET total_tickets = ?, resolved_tickets = ?, status = ?, last_checked_at = GETUTCDATE()
         WHEN NOT MATCHED THEN INSERT (project_key, recon_date, total_tickets, resolved_tickets, status, last_checked_at)
           VALUES (?, ?, ?, ?, ?, GETUTCDATE());`,
        [project, day, total, resolved, status, project, day, total, resolved, status],
      );
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      tickets: tickets.length,
      resolved: resolvedCount,
      resolvedPct: tickets.length ? Math.round((resolvedCount / tickets.length) * 1000) / 10 : 0,
      customersAtRisk: written,
      tierChanges,
      reconDaysComplete: daysComplete,
      reconDaysPartial: daysPartial,
      seconds: Math.round((Date.now() - t0) / 1000),
    };
    console.log('[account-risk] ===== ROLLUP REPORT =====');
    console.log(`[account-risk] ${JSON.stringify(summary)}`);
    console.log('[account-risk] =========================');
    try { this.settings.set('account_risk_rollup_report', JSON.stringify(summary)); } catch { /* ignore */ }
    return summary;
  }
}
