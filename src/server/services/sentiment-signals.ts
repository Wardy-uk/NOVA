import { query } from './database.js';

/**
 * Sentiment — customer and internal — for the NEURO bridge.
 *
 * There is no single sentiment number in NOVA and pretending otherwise would be
 * the worst thing this file could do. There are four incompatible measures, each
 * with a different scale, population and bias, and the honest job here is to
 * report them side by side WITH what they cover, not to average them into a
 * comforting figure that means nothing.
 *
 *   CSAT (Jira)   — customfield_12802 on resolved tickets. The KPI's source.
 *                   Coverage is around 0.4% of solved, so it is a signal about
 *                   the few who answered, not about customers.
 *   CSAT (portal) — NOVA's own survey, 1–5, sent as a Jira comment on close.
 *                   A different population from the above; they do not add up.
 *   AI sentiment  — −1..+1, inferred from ticket comments. Only ever computed
 *                   for tickets that ALREADY tripped a problem rule, so it is
 *                   deliberately a sample of trouble. It cannot be read as "how
 *                   customers feel"; it is "how bad the bad ones feel".
 *   Surveys       — internal 1–5 satisfaction by category (team, KAM, CSM).
 *
 * Every block carries its own denominator for that reason.
 *
 * Strictly SELECT. Nothing here writes.
 */

const DIRTY_READ = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\n';

export const SENTIMENT_BUILD = '2026-08-19-sentiment-a';

/** Below this an aggregate says more about who answered than about anything else. */
export const THIN_SAMPLE = 10;
/** AI sentiment at or below this is treated as an unhappy customer. */
export const NEGATIVE_THRESHOLD = -0.3;

export interface Block<T> {
  ok: boolean;
  error: string | null;
  data: T | null;
}

async function block<T>(fn: () => Promise<T>): Promise<Block<T>> {
  try {
    return { ok: true, error: null, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Query failed', data: null };
  }
}

/**
 * AI-inferred sentiment on problem tickets.
 *
 * `basis` is not decoration. This population is selected for trouble, so a bad
 * average here is the expected reading and an improving one is the interesting
 * one. Reported as a distribution rather than a mean, because a mean of a
 * bimodal "mostly fine / a few furious" set describes neither group.
 */
async function aiSentiment(days: number) {
  const rows = await query<{ issue_key: string; sentiment_score: number; sentiment_summary: string | null; last_seen: string }>(
    `${DIRTY_READ}
     SELECT issue_key, sentiment_score, sentiment_summary, last_seen
       FROM problem_ticket_alerts
      WHERE sentiment_score IS NOT NULL
        AND last_seen >= DATEADD(day, ?, GETUTCDATE())
      ORDER BY sentiment_score ASC`,
    [-days],
  );

  const scored = rows.filter(r => typeof r.sentiment_score === 'number');
  const negative = scored.filter(r => r.sentiment_score <= NEGATIVE_THRESHOLD);

  return {
    basis: 'AI-inferred from ticket comments, ONLY on tickets that already tripped a problem rule. '
      + 'A sample selected for trouble — not a measure of how customers in general feel.',
    scored: scored.length,
    negative: negative.length,
    negativeThreshold: NEGATIVE_THRESHOLD,
    average: scored.length ? Math.round((scored.reduce((s, r) => s + r.sentiment_score, 0) / scored.length) * 100) / 100 : null,
    // The angriest few, named, because those are the ones worth a phone call.
    worst: scored.slice(0, 5).map(r => ({
      ticket: r.issue_key,
      score: Math.round(r.sentiment_score * 100) / 100,
      summary: (r.sentiment_summary || '').slice(0, 220),
    })),
  };
}

/** NOVA's own portal CSAT. A different population from the Jira field. */
async function portalCsat(days: number) {
  const rows = await query<{ responded: number; sent: number; avg_csat: number | null; avg_ease: number | null; avg_effort: number | null }>(
    `${DIRTY_READ}
     SELECT SUM(CASE WHEN responded_at IS NOT NULL THEN 1 ELSE 0 END) AS responded,
            COUNT(*) AS sent,
            AVG(CASE WHEN responded_at IS NOT NULL THEN CAST(csat_score AS FLOAT) END) AS avg_csat,
            AVG(CASE WHEN responded_at IS NOT NULL THEN CAST(ease_score AS FLOAT) END) AS avg_ease,
            AVG(CASE WHEN responded_at IS NOT NULL THEN CAST(effort_score AS FLOAT) END) AS avg_effort
       FROM portal_csat_surveys
      WHERE sent_at >= DATEADD(day, ?, GETUTCDATE())`,
    [-days],
  );

  const r = rows[0];
  const responded = Number(r?.responded ?? 0);
  const round = (v: number | null) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

  return {
    basis: "NOVA's portal CSAT, 1–5, sent as a comment when a ticket closes. "
      + 'A different population from the Jira Satisfaction field the KPI uses; the two do not add up.',
    sent: Number(r?.sent ?? 0),
    responded,
    responseRatePct: r?.sent ? Math.round((responded / Number(r.sent)) * 1000) / 10 : null,
    // Averages are withheld on a thin sample rather than shown with a caveat
    // nobody reads. Three responses is not a score.
    thin: responded < THIN_SAMPLE,
    avgCsat: responded >= THIN_SAMPLE ? round(r?.avg_csat ?? null) : null,
    avgEase: responded >= THIN_SAMPLE ? round(r?.avg_ease ?? null) : null,
    avgEffort: responded >= THIN_SAMPLE ? round(r?.avg_effort ?? null) : null,
    recentComments: [] as Array<{ ticket: string; score: number; comment: string }>,
  };
}

/** Free-text CSAT comments — the part people actually read. */
async function csatComments(days: number) {
  return query<{ jira_issue_key: string; csat_score: number; comment: string; responded_at: string }>(
    `${DIRTY_READ}
     SELECT TOP (10) jira_issue_key, csat_score, comment, responded_at
       FROM portal_csat_surveys
      WHERE comment IS NOT NULL AND LTRIM(RTRIM(comment)) <> ''
        AND responded_at >= DATEADD(day, ?, GETUTCDATE())
      ORDER BY responded_at DESC`,
    [-days],
  );
}

/**
 * Internal satisfaction surveys, by category, across ALL closed surveys.
 *
 * Deliberately not the "latest survey only" shape the existing endpoints use.
 * A monthly team survey is worth having precisely because it produces a series,
 * and a query that only ever returns the most recent one throws that away.
 */
async function surveySentiment() {
  const rows = await query<{ category: string; survey_id: number; title: string; closed_at: string | null; end_date: string | null; responses: number; avg_score: number | null }>(
    `${DIRTY_READ}
     SELECT s.category, s.id AS survey_id, s.title, s.closed_at, s.end_date,
            COUNT(DISTINCT r.id) AS responses,
            AVG(CAST(a.value AS FLOAT)) AS avg_score
       FROM surveys s
       LEFT JOIN survey_responses r ON r.survey_id = s.id
       OUTER APPLY OPENJSON(r.answers) WITH (question_id INT '$.question_id', value NVARCHAR(50) '$.value') a
       LEFT JOIN survey_questions q ON q.id = a.question_id AND q.question_type = 'scale_5'
      WHERE q.id IS NOT NULL
      GROUP BY s.category, s.id, s.title, s.closed_at, s.end_date
      ORDER BY s.category, ISNULL(s.closed_at, s.end_date)`,
  );

  const byCategory: Record<string, Array<{ surveyId: number; title: string; period: string | null; responses: number; avgScore: number | null; thin: boolean }>> = {};
  for (const r of rows) {
    const cat = r.category || 'custom';
    (byCategory[cat] ||= []).push({
      surveyId: r.survey_id,
      title: r.title,
      period: (r.closed_at || r.end_date || '')?.toString().slice(0, 10) || null,
      responses: Number(r.responses ?? 0),
      // Suppressed below the threshold. A small team's "aggregate" identifies
      // people, which is the whole reason the anonymity work exists.
      avgScore: Number(r.responses ?? 0) >= 5 && r.avg_score !== null
        ? Math.round(Number(r.avg_score) * 100) / 100
        : null,
      thin: Number(r.responses ?? 0) < 5,
    });
  }

  return {
    basis: 'Internal 1–5 satisfaction surveys. Every closed survey, not just the most recent, '
      + 'so a monthly cadence produces a series. Scores are suppressed below 5 responses.',
    byCategory,
  };
}

export async function getSentimentSignals(days = 30) {
  const window = Math.min(Math.max(days, 1), 365);

  // Sequential, like the flow signals, and for the same reason: concurrent
  // aggregates starve each other on this instance.
  const ai = await block(() => aiSentiment(window));
  const portal = await block(() => portalCsat(window));
  const surveys = await block(() => surveySentiment());

  if (portal.ok && portal.data) {
    try {
      const comments = await csatComments(window);
      portal.data.recentComments = comments.map(c => ({
        ticket: c.jira_issue_key,
        score: c.csat_score,
        comment: (c.comment || '').slice(0, 240),
      }));
    } catch { /* comments are the enrichment; the rates are the signal */ }
  }

  const named: Array<[string, Block<unknown>]> = [['ai', ai], ['portalCsat', portal], ['surveys', surveys]];

  return {
    build: SENTIMENT_BUILD,
    window: { days: window },
    ai,
    portalCsat: portal,
    surveys,
    unavailable: named.filter(([, v]) => !v.ok).map(([name, v]) => ({ name, error: v.error })),
  };
}
