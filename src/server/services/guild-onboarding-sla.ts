/**
 * Guild/BYM onboarding SLA + milestone logic (backlog #8, R4/R5/R7).
 *
 * Pure functions — no Jira/DB access — so they're easy to reason about and test.
 *
 * Two clocks (spec R4), both starting from the onboarding SUBMISSION date:
 *   - Overall SLA: 30 days, carried on the QA parent. RAG + breach at day 30.
 *   - INTS escalation: the only child that escalates — day 7 / 14 / 21 / 30.
 *
 * The dashboard progress line (R5) is the Guild sheet's columns as milestones,
 * in sheet order, mixing ticket-backed / manual / calculated treatments (§4).
 */
import { GUILD_CHILDREN, type GuildChildKey } from './guild-onboarding.js';

export const GUILD_SLA_DAYS = 30;
export const INTS_LADDER = [7, 14, 21, 30] as const;
export type IntsLevel = 0 | 7 | 14 | 21 | 30;
export type GuildSlaRag = 'green' | 'amber' | 'red' | 'met';

export interface GuildSlaState {
  sla30Day: string;          // YYYY-MM-DD — submission + 30 days
  daysElapsed: number;
  daysRemaining: number;     // negative = breached
  rag: GuildSlaRag;          // 'met' once the parent is resolved
  breached: boolean;
}

/** Whole days between two instants (b - a), floored. */
function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/** Overall 30-day SLA on the parent, measured from submission. `parentDone`
 *  marks the QA parent resolved → SLA met regardless of clock.
 *  RAG bands are by days ELAPSED, matching the Guild's own reading of the
 *  tracker (customer feedback, Aug 2026): 0–7 green, 8–14 amber, 15+ red. */
export function computeSla(submissionDate: Date, now: Date, parentDone: boolean): GuildSlaState {
  const target = addDays(submissionDate, GUILD_SLA_DAYS);
  const daysElapsed = Math.max(0, daysBetween(submissionDate, now));
  const daysRemaining = GUILD_SLA_DAYS - daysElapsed;
  const breached = daysRemaining <= 0 && !parentDone;
  let rag: GuildSlaRag;
  if (parentDone) rag = 'met';
  else if (daysElapsed > 14) rag = 'red';
  else if (daysElapsed > 7) rag = 'amber';
  else rag = 'green';
  return {
    sla30Day: target.toISOString().slice(0, 10),
    daysElapsed,
    daysRemaining,
    rag,
    breached,
  };
}

/** Highest INTS escalation threshold crossed, from submission. Returns 0 once
 *  the INTS child is resolved (nothing left to escalate). */
export function computeIntsLevel(submissionDate: Date, now: Date, intsDone: boolean): IntsLevel {
  if (intsDone) return 0;
  const days = daysBetween(submissionDate, now);
  let level: IntsLevel = 0;
  for (const t of INTS_LADDER) { if (days >= t) level = t; }
  return level;
}

// ── Milestone model (the Guild sheet's columns, in order) ──

export type GuildMilestoneKind = 'ticket' | 'manual' | 'calculated';
export type GuildMilestoneState = 'done' | 'in_progress' | 'pending' | 'na';

export interface GuildMilestoneDef {
  key: string;
  label: string;
  kind: GuildMilestoneKind;
  childKey?: GuildChildKey | 'parent';  // for ticket milestones
  manualKey?: string;                   // for manual milestones
  calc?: 'crmCreated' | 'sla30Day';     // for calculated milestones
}

/** Sheet columns → milestones. "Ignore for now" columns (Received setup form,
 *  Domain Verified?) are omitted per §4. Order follows the sheet. */
export const GUILD_MILESTONES: GuildMilestoneDef[] = [
  { key: 'dateReceived', label: 'Date Received', kind: 'manual', manualKey: 'dateReceived' },
  { key: 'crmCreated', label: 'CRM Created', kind: 'calculated', calc: 'crmCreated' },
  { key: 'contractUploaded', label: 'Contract Uploaded', kind: 'manual', manualKey: 'contractUploaded' },
  { key: 'deliverySheetUpdated', label: 'Delivery sheet updated', kind: 'manual', manualKey: 'deliverySheetUpdated' },
  { key: 'billedDeliverySheet', label: 'Billed – Delivery Sheet', kind: 'manual', manualKey: 'billedDeliverySheet' },
  { key: 'preBilled', label: 'Pre-billed', kind: 'manual', manualKey: 'preBilled' },
  { key: 'formUploadedCrm', label: 'Form uploaded to CRM', kind: 'manual', manualKey: 'formUploadedCrm' },
  { key: 'sla30Day', label: '30 Day SLA', kind: 'calculated', calc: 'sla30Day' },
  { key: 'leadpro', label: 'Leadpro', kind: 'ticket', childKey: 'leadpro' },
  { key: 'instance', label: 'BYM – Instance', kind: 'ticket', childKey: 'instance' },
  { key: 'ints', label: 'BYM – Integration (INTS)', kind: 'ticket', childKey: 'ints' },
  { key: 'design', label: 'BYM – Design & Support', kind: 'ticket', childKey: 'design' },
  { key: 'welcomeEmail', label: 'BYM – Welcome Email', kind: 'manual', manualKey: 'welcomeEmail' },
  { key: 'ars', label: 'ARS', kind: 'ticket', childKey: 'ars' },
  { key: 'cat', label: 'CAT', kind: 'ticket', childKey: 'cat' },
  { key: 'qa', label: 'BYM – QA', kind: 'ticket', childKey: 'parent' },
  { key: 'users', label: 'BYM – Set up Users', kind: 'ticket', childKey: 'users' },
  { key: 'updateEmailSent', label: 'Update Email Sent', kind: 'manual', manualKey: 'updateEmailSent' },
];

/** Manual field keys, in the order they appear on the sheet — used by the
 *  editable panel (R6). `obComments` is free text and lives outside the line. */
export const GUILD_MANUAL_FIELDS: Array<{ key: string; label: string; type: 'date' | 'flag' | 'text' }> = [
  { key: 'dateReceived', label: 'Date Received', type: 'date' },
  { key: 'contractUploaded', label: 'Contract Uploaded', type: 'flag' },
  { key: 'deliverySheetUpdated', label: 'Delivery sheet updated', type: 'flag' },
  { key: 'billedDeliverySheet', label: 'Billed – Delivery Sheet', type: 'flag' },
  { key: 'preBilled', label: 'Pre-billed', type: 'flag' },
  { key: 'formUploadedCrm', label: 'Form uploaded to CRM', type: 'flag' },
  { key: 'welcomeEmail', label: 'BYM – Welcome Email', type: 'flag' },
  { key: 'updateEmailSent', label: 'Update Email Sent', type: 'flag' },
  { key: 'obComments', label: 'OB Comments', type: 'text' },
];

/** The admin/paperwork milestones that can all be ticked before a single ticket
 *  exists. Together they're worth GUILD_ADMIN_WEIGHT_PCT of the bar — the
 *  delivery work carries the rest. (Guild feedback, Aug 2026: the tracker read
 *  44% before onboarding had actually started.) */
export const GUILD_ADMIN_MILESTONES = new Set([
  'dateReceived', 'crmCreated', 'contractUploaded', 'deliverySheetUpdated',
  'billedDeliverySheet', 'preBilled', 'formUploadedCrm',
]);
export const GUILD_ADMIN_WEIGHT_PCT = 1;

/** Weighted completion for the tracker bar. All the admin actions done but no
 *  tickets raised = 1%; the remaining 99% accrues across the delivery
 *  milestones once the tickets exist. `sla30Day` is a clock, not a deliverable,
 *  so it never scores. */
export function computeProgressPct(
  milestones: Array<{ key: string; state: GuildMilestoneState }>,
  ticketsRaised: boolean,
): number {
  const scored = milestones.filter(m => m.state !== 'na' && m.key !== 'sla30Day');
  const admin = scored.filter(m => GUILD_ADMIN_MILESTONES.has(m.key));
  const delivery = scored.filter(m => !GUILD_ADMIN_MILESTONES.has(m.key));
  const doneIn = (list: typeof scored) => list.filter(m => m.state === 'done').length;
  // Floor, so a part-finished admin block stays at 0 and only the full set earns the 1%.
  const adminPct = admin.length ? Math.floor((doneIn(admin) / admin.length) * GUILD_ADMIN_WEIGHT_PCT) : 0;
  if (!ticketsRaised || delivery.length === 0) return adminPct;
  const deliveryPct = Math.round((doneIn(delivery) / delivery.length) * (100 - GUILD_ADMIN_WEIGHT_PCT));
  return Math.min(100, adminPct + deliveryPct);
}

/** Jira status → milestone state. Done/closed → done; anything active with a
 *  status → in_progress; unknown/missing → pending. */
export function jiraStatusToState(status: string | null | undefined): GuildMilestoneState {
  if (!status) return 'pending';
  const s = status.toLowerCase();
  if (/(done|closed|resolved|complete)/.test(s)) return 'done';
  return 'in_progress';
}

function manualToState(val: unknown, type: 'date' | 'flag' | 'text'): { state: GuildMilestoneState; detail: string | null } {
  if (type === 'flag') return { state: val ? 'done' : 'pending', detail: val ? 'Yes' : null };
  if (type === 'date') { const s = val ? String(val) : null; return { state: s ? 'done' : 'pending', detail: s }; }
  const s = val ? String(val) : null;
  return { state: s ? 'done' : 'pending', detail: s };
}
