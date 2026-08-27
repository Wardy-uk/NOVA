import { describe, it } from 'node:test';
import assert from 'node:assert';

import { pickQaExtremes, signalsToPrompt, type PrepSignals } from './one21-prep-signals.js';

/**
 * The merge of the two prep generators.
 *
 * `Briefing121Service` gathered richer signals than the prep that actually runs, and had
 * produced NOTHING — zero rows in `agent_121_briefings`, because the view handed it a
 * display name where its queries wanted a Jira account id. Five of its six sections
 * would have rendered as zeros. These tests exist because that failure was invisible:
 * every one of them is about telling "none" apart from "couldn't look".
 */

const qa = (issueKey: string, overallScore: number | null, grade: string | null = null) =>
  ({ issueKey, overallScore, grade });

describe('pickQaExtremes', () => {
  it('names the weakest and strongest tickets', () => {
    const rows = [qa('NT-1', 9.1), qa('NT-2', 8.5), qa('NT-3', 8.0), qa('NT-4', 5.0), qa('NT-5', 4.5), qa('NT-6', 3.2)];
    const { best, worst } = pickQaExtremes(rows);
    assert.deepEqual(worst.map((t) => t.ticketKey), ['NT-6', 'NT-5', 'NT-4']);
    assert.deepEqual(best.map((t) => t.ticketKey), ['NT-1', 'NT-2', 'NT-3']);
  });

  it('does not let one ticket be both the best and the worst', () => {
    // With four results, top-3 and bottom-3 overlap — a card claiming NT-2 is both the
    // strongest and the weakest work of the month reads as a bug, and is one.
    const { best, worst } = pickQaExtremes([qa('NT-1', 9), qa('NT-2', 7), qa('NT-3', 5)]);
    assert.deepEqual(best, [], 'too few results to claim a "best"');
    assert.deepEqual(worst.map((t) => t.ticketKey), ['NT-3', 'NT-2', 'NT-1']);
    const keys = new Set([...best, ...worst].map((t) => t.ticketKey));
    assert.equal(keys.size, best.length + worst.length);
  });

  it('ignores unscored rows rather than treating them as zero', () => {
    // A null score is "not assessed". Sorted as 0 it would top the weakest list and put
    // an unreviewed ticket in front of Nick as the month's worst work.
    const { worst } = pickQaExtremes([qa('NT-1', null), qa('NT-2', 6), qa('NT-3', 4)]);
    assert.ok(!worst.some((t) => t.ticketKey === 'NT-1'));
  });

  it('says nothing when there is nothing scored', () => {
    assert.deepEqual(pickQaExtremes([]), { best: [], worst: [] });
    assert.deepEqual(pickQaExtremes([qa('NT-1', null)]), { best: [], worst: [] });
  });
});

describe('signalsToPrompt', () => {
  const base: PrepSignals = {
    accountId: 'acct-1', escalations: null, autonomy: null, coaching: [],
    qaBest: [], qaWorst: [], trends: [], unavailable: [],
  };

  it('distinguishes "no escalations" from "could not check"', () => {
    const none = signalsToPrompt({ ...base, escalations: { count: 0, appropriateRate: null } });
    assert.match(none, /0 escalation\(s\)/);

    const broken = signalsToPrompt({ ...base, escalations: null });
    assert.match(broken, /## Escalations\n- Not available/);
  });

  it('does not report an unscored appropriateness rate as 0%', () => {
    // `appropriateRate: null` means nothing has been judged yet. Printing 0% would
    // accuse the agent of getting every escalation wrong.
    const out = signalsToPrompt({ ...base, escalations: { count: 4, appropriateRate: null } });
    assert.match(out, /appropriateness not scored/);
    assert.doesNotMatch(out, /0% judged/);
  });

  it('reports a real rate as a percentage', () => {
    const out = signalsToPrompt({ ...base, escalations: { count: 4, appropriateRate: 0.75 } });
    assert.match(out, /75% judged appropriate/);
  });

  it('tells the model explicitly not to read a gap as a zero', () => {
    // The whole reason the old service was dangerous: empty sections that looked like
    // findings. The instruction is in the prompt, not just in our heads.
    const out = signalsToPrompt({ ...base, unavailable: ['escalation analysis'] });
    assert.match(out, /do NOT treat as zero/i);
    assert.match(out, /escalation analysis/);
  });

  it('names QA tickets rather than only averaging them', () => {
    const out = signalsToPrompt({
      ...base,
      qaWorst: [{ ticketKey: 'NT-28061', score: 4.5, grade: 'RED' }],
      qaBest: [{ ticketKey: 'NT-28100', score: 9.2, grade: 'GREEN' }],
    });
    assert.match(out, /NT-28061 \(4\.5, RED\)/);
    assert.match(out, /NT-28100 \(9\.2\)/);
  });

  it('carries AI-agent interaction and coaching signals through', () => {
    const out = signalsToPrompt({
      ...base,
      autonomy: { approvals: 12, rejections: 3 },
      coaching: [{ signalType: 'low_gr_score', detail: 'Ownership language below team average', requestType: 'Bug' }],
    });
    assert.match(out, /Approved 12, rejected 3/);
    assert.match(out, /low_gr_score \(Bug\): Ownership language below team average/);
  });

  it('says when there is not enough history to compare periods', () => {
    assert.match(signalsToPrompt(base), /Not enough history to compare/);
    const out = signalsToPrompt({
      ...base,
      trends: [{ metric: 'Time to resolve', direction: 'improving', detail: '6.2h average (-18% vs the previous 30 days)' }],
    });
    assert.match(out, /Time to resolve: improving/);
  });
});
