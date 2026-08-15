import { query } from './database.js';
import type { JiraRestClient } from './jira-client.js';
import type { EscalationLogService } from './escalation-log-service.js';

/**
 * Manual escalation — "this needs to jump the queue", as opposed to the
 * capability escalations SOP-002 already covers ("I can't progress this").
 *
 * Decisions this encodes (BA, 15 Aug 2026 — see NEURO
 * .claude/memory/workstream-escalation-and-chasing.md):
 *  - The Jira comment is ALWAYS internal. There is deliberately no public option
 *    on this path: an urgency reason is commercial ("the AM says they're at
 *    renewal") and must never be readable by the customer.
 *  - duedate only ever TIGHTENS. An escalation must never push a commitment out.
 *  - priority only ever RAISES, and always to Critical (Blocker stays reserved
 *    for genuine outages, so an existing Blocker is left alone).
 *  - The comment names the route back, because an escalation nobody can dispute
 *    is one people resent.
 */

/** Highest → lowest, as returned by the NT edit screen (verified 15 Aug 2026).
 *  NB: priority IDs are NOT in rank order — Normal is 10100 while Minor is 4 —
 *  so ranking must go through this list and never through the id. */
const PRIORITY_RANK = ['Blocker', 'Critical', 'Major', 'Normal', 'Minor', 'Unset'];

const TARGET_PRIORITY = 'Critical';

/** Index into PRIORITY_RANK, or -1 if we don't recognise the name. */
function rankOf(name: string): number {
  return PRIORITY_RANK.findIndex(p => p.toLowerCase() === name.toLowerCase());
}

/** Critical unless the ticket is already at Critical or above. Null = leave alone.
 *  An unrecognised priority is left alone rather than assumed to be low: if the
 *  scheme ever gains a level above Critical, guessing would DEMOTE it, and
 *  "an escalation never lowers priority" is the invariant that matters most here. */
export function priorityRaise(current: string | null | undefined): string | null {
  if (!current) return TARGET_PRIORITY;      // no priority set at all
  const i = rankOf(current);
  if (i === -1) return null;                 // unknown — don't touch it
  return i > rankOf(TARGET_PRIORITY) ? TARGET_PRIORITY : null;
}

/** The requested date only if it beats what's there. Null = leave alone.
 *  Both are YYYY-MM-DD, so a string compare is a date compare. */
export function dueDateTighten(current: string | null | undefined, requested: string): string | null {
  if (!requested) return null;
  if (!current) return requested;
  return requested < current ? requested : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ManualEscalationInput {
  ticket_key: string;
  reason_code: string;
  /** YYYY-MM-DD. Optional — an escalation can be "look at this now" with no date. */
  needed_by?: string;
  notes?: string;
  /** From the JWT, never from the request body. */
  escalated_by: string;
}

export interface ManualEscalationResult {
  escalation_id: number;
  ticket_key: string;
  reason_code: string;
  reason_label: string;
  duedate: { from: string | null; to: string | null; changed: boolean; reason?: string };
  priority: { from: string | null; to: string | null; changed: boolean; reason?: string };
  comment_posted: boolean;
  /** Non-fatal failures. The escalation is still logged when these are present. */
  warnings: string[];
}

interface ReasonRow {
  reason_code: string;
  label: string;
  reason_kind: string;
  active: number;
}

export class ManualEscalationService {
  constructor(
    private jira: JiraRestClient,
    private escalationLog: EscalationLogService,
  ) {}

  async listReasons(kind?: 'capability' | 'urgency'): Promise<ReasonRow[]> {
    const rows = await query<ReasonRow>(
      `SELECT reason_code, label, reason_kind, active
         FROM escalation_reasons
        WHERE active = 1 ${kind ? 'AND reason_kind = ?' : ''}
        ORDER BY sort_order`,
      kind ? [kind] : [],
    );
    return rows ?? [];
  }

  async escalate(input: ManualEscalationInput): Promise<ManualEscalationResult> {
    const ticketKey = input.ticket_key?.trim().toUpperCase();
    if (!ticketKey) throw new Error('ticket_key is required');
    if (!input.reason_code) throw new Error('reason_code is required');
    if (input.needed_by && !ISO_DATE.test(input.needed_by)) {
      throw new Error('needed_by must be YYYY-MM-DD');
    }

    const reasons = await query<ReasonRow>(
      `SELECT reason_code, label, reason_kind, active
         FROM escalation_reasons WHERE reason_code = ?`,
      [input.reason_code],
    );
    const reason = reasons?.[0];
    if (!reason) throw new Error(`Unknown reason_code: ${input.reason_code}`);
    if (!reason.active) throw new Error(`Reason ${input.reason_code} is retired`);

    const issue = await this.jira.getIssue(ticketKey, [
      'duedate', 'priority', 'status', 'assignee', 'customfield_12981',
    ]);
    if (!issue) throw new Error(`Ticket ${ticketKey} not found`);

    const f = issue.fields;
    const currentDue = (f.duedate as string | null) ?? null;
    const currentPriority = (f.priority as { name?: string } | null)?.name ?? null;
    const currentTier = (f.customfield_12981 as { value?: string } | null)?.value ?? null;
    const assignee = (f.assignee as { displayName?: string } | null)?.displayName ?? null;

    const warnings: string[] = [];

    // ── Work out the changes before touching anything ──
    const newDue = input.needed_by ? dueDateTighten(currentDue, input.needed_by) : null;
    const newPriority = priorityRaise(currentPriority);

    const dueOutcome: ManualEscalationResult['duedate'] = {
      from: currentDue, to: newDue ?? currentDue, changed: false,
    };
    if (input.needed_by && !newDue) {
      dueOutcome.reason = `left alone — existing due date ${currentDue} is already on or before ${input.needed_by}`;
    }

    const priOutcome: ManualEscalationResult['priority'] = {
      from: currentPriority, to: newPriority ?? currentPriority, changed: false,
    };
    if (!newPriority) {
      priOutcome.reason = `left alone — already at ${currentPriority ?? 'unknown'}`;
    }

    // ── Apply them ──
    const fields: Record<string, unknown> = {};
    if (newDue) fields.duedate = newDue;
    if (newPriority) fields.priority = { name: newPriority };

    if (Object.keys(fields).length > 0) {
      try {
        await this.jira.updateFields(ticketKey, fields);
        if (newDue) dueOutcome.changed = true;
        if (newPriority) priOutcome.changed = true;
      } catch (e) {
        // Deliberately non-fatal: the escalation still gets recorded and commented.
        // A silently-half-applied escalation is worse than a loud partial one.
        const msg = e instanceof Error ? e.message : 'unknown error';
        warnings.push(`Jira field update failed (${msg}) — the escalation is logged and commented, but duedate/priority were not changed.`);
        dueOutcome.to = currentDue;
        priOutcome.to = currentPriority;
      }
    }

    let commentPosted = false;
    try {
      await this.jira.addComment(
        ticketKey,
        this.buildComment({
          escalatedBy: input.escalated_by,
          reasonLabel: reason.label,
          reasonCode: reason.reason_code,
          neededBy: dueOutcome.changed ? newDue : null,
          priorityFrom: priOutcome.changed ? currentPriority : null,
          priorityTo: priOutcome.changed ? newPriority : null,
          notes: input.notes,
        }),
        { internal: true },   // ← never public on this path. See the header comment.
      );
      commentPosted = true;
    } catch (e) {
      warnings.push(`Jira comment failed (${e instanceof Error ? e.message : 'unknown error'}) — the escalation is still logged.`);
    }

    const noteParts = [
      input.notes?.trim(),
      input.needed_by ? `Needed by ${input.needed_by}.` : null,
      dueOutcome.reason ? `Due date ${dueOutcome.reason}.` : null,
      priOutcome.reason ? `Priority ${priOutcome.reason}.` : null,
    ].filter(Boolean);

    const escalationId = await this.escalationLog.log({
      ticket_key: ticketKey,
      escalation_type: 'manual',
      from_tier: currentTier,
      to_tier: currentTier,          // urgency escalation does not move tier
      reason_code: reason.reason_code,
      reason_label: reason.label,
      escalated_by: input.escalated_by,
      assigned_to: assignee ?? undefined,
      notes: noteParts.join(' ') || undefined,
      source: 'manual',
    });

    return {
      escalation_id: escalationId,
      ticket_key: ticketKey,
      reason_code: reason.reason_code,
      reason_label: reason.label,
      duedate: dueOutcome,
      priority: priOutcome,
      comment_posted: commentPosted,
      warnings,
    };
  }

  private buildComment(o: {
    escalatedBy: string;
    reasonLabel: string;
    reasonCode: string;
    neededBy: string | null;
    priorityFrom: string | null;
    priorityTo: string | null;
    notes?: string;
  }): string {
    const lines = [
      `Escalated by ${o.escalatedBy}.`,
      `Reason: ${o.reasonLabel} (${o.reasonCode})`,
    ];
    if (o.neededBy) lines.push(`Needed by: ${o.neededBy}`);
    if (o.priorityTo) lines.push(`Priority raised: ${o.priorityFrom ?? 'unset'} → ${o.priorityTo}`);
    if (o.notes?.trim()) lines.push('', o.notes.trim());
    lines.push(
      '',
      `If you think this escalation is wrong, say so — reply here or tell ${o.escalatedBy}. ` +
      'Disputes are recorded against the escalation, not against you.',
    );
    return lines.join('\n');
  }
}
