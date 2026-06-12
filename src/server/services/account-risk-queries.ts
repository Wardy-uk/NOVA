import { query, queryOne } from './database.js';
import { CustomerResolver } from './customer-resolver.js';
import type { SettingsQueries } from '../db/settings-store.js';

// Read-side helpers for account-level risk: the per-ticket lookup used by triage
// enrichment + the ticket sidebar, and list/summary queries for the dashboard.
// See agent_work/ba/account-risk-spec.md.

export const RISK_TIER_LABELS = ['Normal', 'Watch', 'Medium', 'High', 'Critical'];

export interface CustomerRiskSummary {
  customerRef: string;
  customerName: string | null;
  riskScore: number;
  riskTier: number;            // 0-4
  tierLabel: string;
  signals: string[];           // distinct active signal types
  activeSignalTickets: number; // open tickets contributing a signal
  flags: { formalComplaint: boolean; termination: boolean; refund: boolean; escalation: boolean };
}

interface AccountRow {
  customer_ref: string; customer_name: string | null; risk_score: number; risk_tier: number;
  has_formal_complaint: boolean; has_termination: boolean; has_active_refund: boolean; has_open_escalation: boolean;
}

function rowToSummary(row: AccountRow, signals: string[], activeSignalTickets: number): CustomerRiskSummary {
  return {
    customerRef: row.customer_ref,
    customerName: row.customer_name,
    riskScore: row.risk_score,
    riskTier: row.risk_tier,
    tierLabel: RISK_TIER_LABELS[row.risk_tier] ?? 'Normal',
    signals,
    activeSignalTickets,
    flags: {
      formalComplaint: !!row.has_formal_complaint,
      termination: !!row.has_termination,
      refund: !!row.has_active_refund,
      escalation: !!row.has_open_escalation,
    },
  };
}

async function loadSignals(customerRef: string): Promise<{ types: string[]; tickets: number }> {
  const rows = await query<{ signal_type: string; ticket_key: string }>(
    `SELECT DISTINCT signal_type, ticket_key FROM agent_account_risk_signals
     WHERE customer_ref = ? AND is_active = 1`,
    [customerRef],
  );
  return { types: [...new Set(rows.map(r => r.signal_type))], tickets: new Set(rows.map(r => r.ticket_key)).size };
}

/**
 * Resolve a ticket to its customer and return that customer's risk profile, or null
 * if unresolved / Normal tier (nothing worth surfacing). Reuses CustomerResolver's DB
 * lookups (no in-memory index needed for a single ticket).
 */
export async function getTicketCustomerRisk(
  ticketKey: string,
  settings: SettingsQueries,
): Promise<CustomerRiskSummary | null> {
  const t = await queryOne<{
    reporter_email: string | null; bc_account_number: string | null;
    organisation_name: string | null; summary: string | null; description_text: string | null;
  }>(
    `SELECT reporter_email, bc_account_number, organisation_name, summary, description_text
     FROM jira_issue_cache WHERE issue_key = ?`,
    [ticketKey],
  );
  if (!t) return null;

  const res = await new CustomerResolver(settings).resolveTicket({
    bcAccountNumber: t.bc_account_number,
    organizations: t.organisation_name ? [{ name: t.organisation_name }] : null,
    reporterEmail: t.reporter_email, summary: t.summary, description: t.description_text,
  });
  if (!res.customerRef) return null;

  const row = await queryOne<AccountRow>(
    `SELECT customer_ref, customer_name, risk_score, risk_tier,
            has_formal_complaint, has_termination, has_active_refund, has_open_escalation
     FROM agent_account_risk WHERE customer_ref = ?`,
    [res.customerRef],
  );
  if (!row || row.risk_tier === 0) return null;  // only surface Watch+ on tickets

  const sig = await loadSignals(row.customer_ref);
  return rowToSummary(row, sig.types, sig.tickets);
}

/** One-line risk annotation for NOVA's internal ticket comments. */
export function formatRiskLine(r: CustomerRiskSummary): string {
  const flagBits: string[] = [];
  if (r.flags.formalComplaint) flagBits.push('formal complaint');
  if (r.flags.termination) flagBits.push('termination notice');
  if (r.flags.refund) flagBits.push('refund claim');
  if (r.flags.escalation) flagBits.push('open escalation');
  const detail = flagBits.length ? flagBits.join(', ')
    : r.signals.length ? r.signals.map(s => s.replace(/_/g, ' ')).join(', ')
    : '';
  const name = r.customerName ? `${r.customerName} — ` : '';
  return `⚠️ **Customer Risk: ${r.tierLabel}** (${name}score ${r.riskScore}/100`
    + `${detail ? `; ${detail}` : ''}${r.activeSignalTickets ? `; ${r.activeSignalTickets} flagged ticket${r.activeSignalTickets === 1 ? '' : 's'}` : ''})`;
}

// ── Dashboard queries ──

export async function getRiskTierDistribution(): Promise<{ tier: number; label: string; count: number }[]> {
  const rows = await query<{ risk_tier: number; cnt: number }>(
    `SELECT risk_tier, COUNT(*) AS cnt FROM agent_account_risk GROUP BY risk_tier`,
  );
  const byTier = new Map(rows.map(r => [r.risk_tier, r.cnt]));
  return [0, 1, 2, 3, 4].map(tier => ({ tier, label: RISK_TIER_LABELS[tier], count: byTier.get(tier) ?? 0 }));
}

export async function getAtRiskAccounts(minTier = 1): Promise<Record<string, unknown>[]> {
  return await query<Record<string, unknown>>(
    `SELECT customer_ref, customer_name, bc_number, primary_domain, risk_score, risk_tier,
            has_formal_complaint, has_termination, has_active_refund, has_open_escalation,
            is_network_account, total_ticket_count, first_ticket_date, last_ticket_date, last_score_update
     FROM agent_account_risk WHERE risk_tier >= ? ORDER BY risk_score DESC`,
    [minTier],
  );
}
