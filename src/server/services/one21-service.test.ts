import { describe, it } from 'node:test';
import assert from 'node:assert';

import { compareRosters, isStalled, isSubmissionEditable } from './one21-service.js';

/**
 * Pins the rules that fail SILENTLY.
 *
 * Everything here was found by a prod audit on 2026-08-27 rather than by anyone
 * noticing: the day-before prep email had never been sent once, seven of eleven open
 * sessions were wedged in `in_progress`, and `agent_development_plans` still held active
 * rows for two people who had left. None of that raised an error anywhere — which is
 * exactly why these are assertions now.
 */

describe('isStalled', () => {
  const CUTOFF = '2026-08-25';   // today minus STALLED_AFTER_DAYS

  it('flags a session opened in the wizard and never finished', () => {
    // The actual failure: opening the click-through set `in_progress` for good, and the
    // day-before job only matches `scheduled`, so the agent could never be prepped again.
    assert.equal(isStalled('in_progress', '2026-08-19', CUTOFF), true);
  });

  it('does NOT flag a 1-2-1 that simply has not happened yet', () => {
    // A past `scheduled` date is overdue — a meeting not held. Different problem,
    // different fix, and it does not block the loop.
    assert.equal(isStalled('scheduled', '2026-08-19', CUTOFF), false);
    assert.equal(isStalled('awaiting_agent', '2026-08-19', CUTOFF), false);
    assert.equal(isStalled('ready', '2026-08-19', CUTOFF), false);
  });

  it('gives a 1-2-1 held today a couple of days grace before nagging', () => {
    // Nick runs the session, closes the laptop, completes it the next morning. That is
    // normal, not stalled.
    assert.equal(isStalled('in_progress', '2026-08-26', CUTOFF), false);
    assert.equal(isStalled('in_progress', CUTOFF, CUTOFF), false);   // boundary: not yet
    assert.equal(isStalled('in_progress', '2026-08-24', CUTOFF), true);
  });

  it('tolerates a datetime where a date was expected', () => {
    // MSSQL hands dates back in more than one shape depending on the driver path.
    assert.equal(isStalled('in_progress', '2026-08-19T00:00:00.000Z', CUTOFF), true);
  });
});

describe('isSubmissionEditable', () => {
  it("lets the agent revise their prep until the manager opens the 1-2-1", () => {
    assert.equal(isSubmissionEditable('awaiting_agent'), true);
    assert.equal(isSubmissionEditable('ready'), true);
  });

  it('freezes it once the 1-2-1 is underway or done', () => {
    // This is the other reason `begin` must not fire on page load: merely opening the
    // wizard used to take the agent's form away from them mid-edit.
    assert.equal(isSubmissionEditable('in_progress'), false);
    assert.equal(isSubmissionEditable('complete'), false);
    assert.equal(isSubmissionEditable('abandoned'), false);
  });
});

describe('compareRosters', () => {
  const ROSTER = ['Nathan Rutland', 'Zoe Rees', 'Hope Goodall', 'Nick Ward'];

  it('reports a plan for someone who is no longer an active agent', () => {
    // The real rows: Arman had left, Willem had moved team, and both still counted
    // towards every tile on the overview.
    const r = compareRosters([...ROSTER, 'Arman Shazad'], ROSTER, 'Nick Ward');
    assert.deepEqual(r.notOnRoster.map((x) => x.agentName).sort(), ['Arman Shazad', 'Nick Ward']);
  });

  it('reports the manager, who is on the roster but does not have a 1-2-1 with himself', () => {
    const r = compareRosters(['Nathan Rutland', 'Nick Ward'], ROSTER, 'Nick Ward');
    const self = r.notOnRoster.find((x) => x.agentName === 'Nick Ward');
    assert.ok(self, 'the self-session must be reported');
    // No "did you mean" — the name is right, the row should not exist.
    assert.equal(self!.nearMatch, null);
    // ...and he must not then show up as someone missing a plan.
    assert.ok(!r.noPlan.includes('Nick Ward'));
  });

  it('tells a typo apart from a leaver', () => {
    // A MISSING space is the case `norm` cannot absorb — it is reported as drift, but
    // with the near match attached so it reads as a typo rather than as someone gone.
    const r = compareRosters(['NathanRutland'], ROSTER, null);
    assert.equal(r.notOnRoster.length, 1);
    assert.equal(r.notOnRoster[0].nearMatch, 'Nathan Rutland');
  });

  it('a genuine leaver gets no near match', () => {
    const r = compareRosters(['Arman Shazad'], ROSTER, null);
    assert.deepEqual(r.notOnRoster, [{ agentName: 'Arman Shazad', nearMatch: null }]);
  });

  it('treats case and any spacing as the same person', () => {
    // Three systems key 1-2-1s on a display name with no join table. If casing or a
    // stray space split a person in two, their history would silently split with them.
    for (const variant of ['  nathan rutland  ', 'NATHAN RUTLAND', 'Nathan  Rutland']) {
      const r = compareRosters([variant], ['Nathan Rutland'], null);
      assert.deepEqual(r.notOnRoster, [], `${JSON.stringify(variant)} should match`);
      assert.deepEqual(r.noPlan, [], `${JSON.stringify(variant)} should match`);
    }
  });

  it('reports a team member with no plan — invisible to the whole loop', () => {
    const r = compareRosters(['Nathan Rutland'], ROSTER, 'Nick Ward');
    assert.deepEqual(r.noPlan, ['Hope Goodall', 'Zoe Rees']);
  });

  it('says nothing when the two agree', () => {
    const r = compareRosters(['Nathan Rutland', 'Zoe Rees', 'Hope Goodall'], ROSTER, 'Nick Ward');
    assert.deepEqual(r.notOnRoster, []);
    assert.deepEqual(r.noPlan, []);
  });

  it('still works when the manager cannot be identified', () => {
    // getRosterDrift derives the manager from an email match. If dbo.Agent spells them
    // differently that lookup returns nothing, and the comparison must not throw — it
    // just stops being able to single the self-session out.
    const r = compareRosters(['Nathan Rutland', 'Nick Ward'], ROSTER, null);
    assert.deepEqual(r.notOnRoster, []);
    assert.deepEqual(r.noPlan, ['Hope Goodall', 'Zoe Rees']);
  });
});
