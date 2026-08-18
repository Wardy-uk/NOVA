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

  // Strongest evidence first: the rejection screen was used on this pass.
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
