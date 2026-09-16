import { test, describe } from 'node:test';
import assert from 'node:assert';
import { tierRankSql, GENUINE_ESCALATION, GENUINE_REJECTION } from './escalation-sql.js';
import { TIER_RANK, tierRank } from './tier-rank.js';

describe('escalation SQL predicates', () => {
  test('the rank expression knows every tier tierRank() knows', () => {
    // The whole point of generating the CASE is that it cannot drift from the
    // map. If someone adds a queue to TIER_RANK, it must appear here too.
    const sql = tierRankSql('from_tier');
    for (const [name, rank] of Object.entries(TIER_RANK)) {
      assert.ok(sql.includes(`WHEN '${name}' THEN ${rank}`), `missing tier: ${name}`);
    }
  });

  test('both Jira and short-form vocabularies are covered', () => {
    // escalation-log-service writes T1/T2/Dev; the live sync writes Jira's raw
    // "Customer Care" / "Tier 2" / "Development". Both are already in the table,
    // and a predicate matching only one silently counts half the rows.
    const sql = tierRankSql('to_tier');
    for (const name of ['t1', 'customer care', 't2', 'tier 2', 'dev', 'development']) {
      assert.ok(sql.includes(`WHEN '${name}'`), `missing vocabulary: ${name}`);
    }
    assert.equal(tierRank('Customer Care'), tierRank('T1'));
    assert.equal(tierRank('Development'), tierRank('Dev'));
  });

  test('off-ladder queues fall through to NULL, not to a rank', () => {
    const sql = tierRankSql('from_tier');
    assert.ok(sql.includes('ELSE NULL END'));
    assert.ok(!sql.toLowerCase().includes("when 'escalations'"));
    assert.ok(!sql.toLowerCase().includes("when 'production'"));
  });

  test('the escalation predicate requires an UPWARD move, not merely a non-rejection', () => {
    // The bug this replaced: `escalation_type <> 'rejection'` counted lateral
    // moves, returns-after-fix and disputes as escalations, inflating the
    // denominator of Escalation Accuracy.
    assert.ok(GENUINE_ESCALATION.includes('>'));
    assert.ok(!GENUINE_ESCALATION.includes("<> 'rejection'"));
    for (const notAnEscalation of ['dispute', 'rejection', 'jira_transition']) {
      assert.ok(
        !GENUINE_ESCALATION.includes(`'${notAnEscalation}'`),
        `${notAnEscalation} must not be counted as an escalation by type`,
      );
    }
  });

  test('the rejection predicate stays evidence-gated', () => {
    // Never direction-based. Inferring rejections from downward moves is what
    // produced 217 phantom handbacks, 80 of them completed work.
    assert.equal(GENUINE_REJECTION, `(escalation_type = 'rejection')`);
  });
});
