import { describe, it } from 'node:test';
import assert from 'node:assert';

import { classifyTierMove } from './tier-move-classifier.js';

/**
 * Pins the rule that was wrong first time round.
 *
 * The original signal treated every downward tier move as a handback and
 * reported 217 in 30 days as friction — of which 80 were Development → Customer
 * Care, which is overwhelmingly a released fix coming back to be tested. Calling
 * that a rejection reports successful delivery as failure and points the
 * improvement effort at the part of the flow that works.
 */

const link = (key: string, done: boolean) => ({
  type: { name: 'Escalate' },
  outwardIssue: { key, fields: { status: { statusCategory: { key: done ? 'done' : 'indeterminate' } } } },
});

describe('classifyTierMove', () => {
  it('calls a downward move with a FRESH rejection reason a rejection', () => {
    const r = classifyTierMove({
      fromTier: 'Tier 2', toTier: 'Customer Care', ownProject: 'NT',
      reasonChanged: true, currentReason: 'Needs more investigation before escalation',
      issueLinksJson: null,
    });
    assert.equal(r.kind, 'rejection');
    assert.equal(r.reason, 'Needs more investigation before escalation');
  });

  it('does NOT call it a rejection when the reason merely exists', () => {
    // The field persists once set. Presence proves the ticket was rejected at
    // some point in its life; only a change proves THIS move was one.
    const r = classifyTierMove({
      fromTier: 'Tier 2', toTier: 'Customer Care', ownProject: 'NT',
      reasonChanged: false, currentReason: 'Rejected back in June',
      issueLinksJson: null,
    });
    assert.notEqual(r.kind, 'rejection');
  });

  it('calls Development → Customer Care with a closed delivery item a return after fix', () => {
    // The case that made the first version wrong. TPJ-2644 Done, ticket comes
    // back to Customer Care to test and confirm.
    const r = classifyTierMove({
      fromTier: 'Development', toTier: 'Customer Care', ownProject: 'NT',
      reasonChanged: false, currentReason: null,
      issueLinksJson: JSON.stringify([link('TPJ-2644', true)]),
    });
    assert.equal(r.kind, 'return_after_fix');
    assert.equal(r.linkedKey, 'TPJ-2644');
  });

  it('ignores a delivery item that is still open', () => {
    const r = classifyTierMove({
      fromTier: 'Development', toTier: 'Customer Care', ownProject: 'NT',
      reasonChanged: false, currentReason: null,
      issueLinksJson: JSON.stringify([link('TPJ-9999', false)]),
    });
    assert.equal(r.kind, 'unclassified', 'work in flight is not work delivered');
  });

  it('ignores closed links in the SAME project', () => {
    // Same-project links are duplicates and relates-to. Neither means a fix
    // shipped, and counting them would manufacture return-after-fix events.
    const r = classifyTierMove({
      fromTier: 'Development', toTier: 'Customer Care', ownProject: 'NT',
      reasonChanged: false, currentReason: null,
      issueLinksJson: JSON.stringify([link('NT-1234', true)]),
    });
    assert.equal(r.kind, 'unclassified');
  });

  it('prefers a fresh rejection over a closed delivery item', () => {
    // Both signals present: someone explicitly rejected it. The explicit act
    // outranks the circumstantial evidence.
    const r = classifyTierMove({
      fromTier: 'Development', toTier: 'Customer Care', ownProject: 'NT',
      reasonChanged: true, currentReason: 'Fix did not resolve the issue',
      issueLinksJson: JSON.stringify([link('TPJ-2644', true)]),
    });
    assert.equal(r.kind, 'rejection');
  });

  it('says unclassified rather than guessing when there is no evidence', () => {
    const r = classifyTierMove({
      fromTier: 'Tier 3', toTier: 'Tier 2', ownProject: 'NT',
      reasonChanged: false, currentReason: null, issueLinksJson: null,
    });
    assert.equal(r.kind, 'unclassified');
    assert.match(r.evidence!, /no rejection reason and no closed delivery item/);
  });

  it('never classifies a move involving an off-ladder queue', () => {
    for (const tier of ['Escalations', 'Production']) {
      const r = classifyTierMove({
        fromTier: tier, toTier: 'Customer Care', ownProject: 'NT',
        reasonChanged: true, currentReason: 'x', issueLinksJson: null,
      });
      assert.equal(r.kind, 'unclassified', `${tier} is not a rung on the ladder`);
    }
  });

  it('recognises escalations and lateral moves as neither', () => {
    assert.equal(classifyTierMove({
      fromTier: 'Customer Care', toTier: 'Tier 2', ownProject: 'NT',
      reasonChanged: false, currentReason: null, issueLinksJson: null,
    }).kind, 'escalation');

    assert.equal(classifyTierMove({
      fromTier: 'Tier 2', toTier: 'Second Line', ownProject: 'NT',
      reasonChanged: false, currentReason: null, issueLinksJson: null,
    }).kind, 'lateral', 'the two vocabularies name the same rung');
  });

  it('survives malformed link JSON rather than throwing mid-sync', () => {
    const r = classifyTierMove({
      fromTier: 'Development', toTier: 'Customer Care', ownProject: 'NT',
      reasonChanged: false, currentReason: null, issueLinksJson: '{not json',
    });
    assert.equal(r.kind, 'unclassified');
  });
});
