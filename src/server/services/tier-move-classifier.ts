import { tierRank } from './tier-rank.js';

/**
 * What a tier move actually MEANT.
 *
 * The first cut treated every move to a less senior queue as a handback, and
 * reported 217 of them in 30 days as friction. That was wrong, and wrong in the
 * direction that does real damage: `Development → Customer Care` was 80 of them,
 * and most of those are a released fix coming back to Customer Care with
 * instructions to test and confirm. Reporting successful delivery as friction
 * would have aimed the improvement effort at the one part of the flow that was
 * working.
 *
 * So this refuses to infer intent from direction alone. Three outcomes, and the
 * third is the honest one:
 *
 * - `rejection` — evidenced. The Rejection Reason (cf13216) CHANGED on the same
 *   pass as the tier move, which means the "Submit for Rejection to ..."
 *   transition screen was used. The field is mandatory there and persists once
 *   set, so a change is proof of a fresh rejection while mere presence proves
 *   only that the ticket was rejected at some point in its life.
 *
 * - `return_after_fix` — a linked work item in a delivery project is Done. The
 *   development work finished and the ticket has come back to be verified. This
 *   is the system working, not failing.
 *
 * - `unclassified` — the direction is known, the reason is not. Reported as
 *   exactly that. Guessing here is how a completed fix becomes a complaint.
 */
export type TierMoveKind = 'rejection' | 'return_after_fix' | 'unclassified' | 'escalation' | 'lateral';

/**
 * What each "Tier 2 Rejection Reason" (customfield_15286) option MEANS.
 *
 * The field is a picker, and the picker already knows the answer — a handback
 * saying "Technical fix applied" is the higher tier having done the work, while
 * one saying "Insufficient information" is the escalation being sent back as not
 * good enough. Both are downward moves. Only the option tells them apart.
 *
 * This is the reason the classifier cannot simply treat "the reason field
 * changed" as proof of a rejection, the way it does for the older free-text
 * cf13216. Once NOVA starts writing this field on every Dev Review return, a
 * change-based test would mark every returned fix as a rejection and rebuild the
 * exact over-counting the classifier was written to prevent.
 *
 * Keyed lowercase because Jira option text is edited by hand in admin.
 * Deliberately NOT exhaustive-by-type: an option added in Jira that nobody has
 * mapped here falls through to `unclassified`, which is the honest answer. A
 * default of either outcome would silently mis-bucket it.
 */
export interface RejectionReasonOption {
  /** EXACTLY as the option reads in Jira. Sent back on updateFields, where a
   *  select value must match character for character — "Insufficient Information"
   *  is not the same option as "Insufficient information". */
  value: string;
  outcome: 'rejection' | 'return';
}

export const REJECTION_REASON_OPTIONS: RejectionReasonOption[] = [
  // The escalation should not have been made, or not in the state it arrived in.
  { value: 'Insufficient information',   outcome: 'rejection' },
  { value: 'Resolvable in Customer Care', outcome: 'rejection' },
  { value: 'Wrong tier',                 outcome: 'rejection' },
  { value: 'Duplicate Issue',            outcome: 'rejection' },
  // The higher tier did the work and is handing it back. The system working.
  { value: 'Guidance provided',          outcome: 'return' },
  { value: 'Technical fix applied',      outcome: 'return' },
  { value: 'Known Issue',                outcome: 'return' },
  // 'Other: State reason in comments' is deliberately absent — it carries no
  // classification by design, and the comment is where the answer lives.
];

const OUTCOME_BY_LOWER = new Map(REJECTION_REASON_OPTIONS.map(o => [o.value.toLowerCase(), o.outcome]));

/** Matching is case- and whitespace-insensitive because the option text is
 *  maintained by hand in Jira admin; the canonical spelling above is what gets
 *  written back. */
export function rejectionReasonOutcome(option: string | null | undefined): 'rejection' | 'return' | null {
  if (!option) return null;
  return OUTCOME_BY_LOWER.get(option.trim().toLowerCase()) ?? null;
}

export interface TierMoveClassification {
  kind: TierMoveKind;
  /** What the decision rested on, carried through to the log row. */
  evidence: string | null;
  /** The rejection reason, only when this is an evidenced rejection. */
  reason: string | null;
  /** The linked delivery item that closed, when that is what decided it. */
  linkedKey: string | null;
}

/** Minimal shape of a Jira issue link, as stored in `issue_links_json`. */
interface JiraIssueLink {
  type?: { name?: string; inward?: string; outward?: string };
  inwardIssue?: LinkedIssue;
  outwardIssue?: LinkedIssue;
}
interface LinkedIssue {
  key?: string;
  fields?: {
    status?: { name?: string; statusCategory?: { key?: string; name?: string } };
  };
}

/**
 * Is this linked issue a piece of DELIVERY work that has finished?
 *
 * "Different project from the ticket" is the test for delivery work, because the
 * service desk lives in its own JSM project and the fix lives wherever the
 * product is built (TPJ-2644, and so on). Same-project links are duplicates,
 * relates-to and parent/child — none of which mean a fix shipped.
 */
function closedDeliveryLink(links: JiraIssueLink[], ownProject: string): string | null {
  for (const link of links) {
    const other = link.outwardIssue || link.inwardIssue;
    const key = other?.key;
    if (!key) continue;
    const project = key.split('-')[0];
    if (!project || project === ownProject) continue;
    if (other?.fields?.status?.statusCategory?.key === 'done') return key;
  }
  return null;
}

function parseLinks(json: string | null | undefined): JiraIssueLink[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * Classify one tier move. Pure — takes everything it needs, reads nothing.
 *
 * `reasonChanged` is the caller's comparison of the cached Rejection Reason
 * against the current one. It is passed in rather than derived here so the rule
 * can be tested without a database, and so the comparison happens where both
 * values are already in hand.
 */
export function classifyTierMove(input: {
  fromTier: string | null | undefined;
  toTier: string | null | undefined;
  ownProject: string;
  reasonChanged: boolean;
  currentReason: string | null | undefined;
  issueLinksJson: string | null | undefined;
  /** cf15286 "Tier 2 Rejection Reason" — the picker, as selected right now. */
  reasonOption?: string | null;
  /** Did that picker change on this pass? Same reasoning as `reasonChanged`:
   *  the value persists, so presence proves history and a change proves now. */
  reasonOptionChanged?: boolean;
}): TierMoveClassification {
  const from = tierRank(input.fromTier);
  const to = tierRank(input.toTier);

  // Off the ladder entirely — Escalations, Production. Never guessed at.
  if (from === null || to === null) {
    return { kind: 'unclassified', evidence: 'one or both queues are off the tier ladder', reason: null, linkedKey: null };
  }
  if (to > from) return { kind: 'escalation', evidence: null, reason: null, linkedKey: null };
  if (to === from) return { kind: 'lateral', evidence: null, reason: null, linkedKey: null };

  // Downward from here. Direction alone decides nothing.

  // Strongest evidence first: the reason PICKER was set on this pass. Stronger
  // than the free-text field below because it says which of the two kinds of
  // handback this was, rather than merely that somebody typed something.
  if (input.reasonOptionChanged) {
    const option = typeof input.reasonOption === 'string' ? input.reasonOption.trim() : '';
    const outcome = rejectionReasonOutcome(option);
    if (outcome === 'rejection') {
      return { kind: 'rejection', evidence: `Rejection Reason: ${option}`, reason: option || null, linkedKey: null };
    }
    if (outcome === 'return') {
      // Counted as the flow working, exactly like a closed delivery item. Same
      // reason_code downstream, so nothing has to learn a new category to keep
      // these out of the friction numbers.
      return { kind: 'return_after_fix', evidence: `Reason given: ${option}`, reason: option || null, linkedKey: null };
    }
    // "Other: State reason in comments", or an option added in Jira that nobody
    // has mapped. Reported as unknown rather than guessed at.
    return {
      kind: 'unclassified',
      evidence: option ? `reason "${option}" has no mapped outcome` : 'reason picker cleared',
      reason: option || null,
      linkedKey: null,
    };
  }

  // Older free-text Rejection Reason (cf13216). Change-based, because the field
  // carries no categories to read.
  if (input.reasonChanged) {
    const reason = typeof input.currentReason === 'string' ? input.currentReason.trim() : null;
    return {
      kind: 'rejection',
      evidence: 'Rejection Reason set on this transition',
      reason: reason || null,
      linkedKey: null,
    };
  }

  // Otherwise: did a piece of delivery work just finish? Then this is the fix
  // coming back to be verified, which is the flow working.
  const linked = closedDeliveryLink(parseLinks(input.issueLinksJson), input.ownProject);
  if (linked) {
    return {
      kind: 'return_after_fix',
      evidence: `linked delivery item ${linked} is Done`,
      reason: null,
      linkedKey: linked,
    };
  }

  return {
    kind: 'unclassified',
    evidence: 'moved to a less senior queue with no rejection reason and no closed delivery item',
    reason: null,
    linkedKey: null,
  };
}
