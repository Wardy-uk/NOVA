import { query, queryOne } from './database.js';
import { fetchRoster, nameKey, type Signal, type RosterPerson } from './people-signals.js';
import { CONVERSATION_LABELS } from './one21-candidates.js';
import type { SettingsQueries } from '../db/settings-store.js';

/**
 * Individual conversations with direct reports, for VANTAGE.
 *
 * A TEAM-WIDE feed, not the per-agent one the NOVA UI uses. VANTAGE asked for this
 * specifically: per-agent means one call per person per refresh, which is already the
 * slowest thing it reads elsewhere. One call, newest first, `?since=`.
 *
 * ⚠ READ-ONLY, AND IT MUST STAY THAT WAY.
 *
 * This is served from the NEURO bridge, which sits in FRONT of the JWT middleware and is
 * guarded only by a shared secret. Nothing here may accept a caller-supplied identity or
 * write anything. In particular the PeopleHR tick is NOT exposed: its entire evidential
 * value is that it is Nick's own confirmation, and a tool ticking it would convert a
 * personal attestation into a machine assertion — worth nothing at a review and actively
 * misleading in a document going to his manager. Ticking stays behind session auth.
 */

/**
 * Stamped into every response so a caller can tell WHICH build answered.
 *
 * `flow-signals` earned this the hard way: a deploy served a stale `dist` and returned a
 * plausible response whose new fields were quietly `undefined`. A missing field is
 * indistinguishable from one that is legitimately empty; a version is not. VANTAGE refuses
 * to render figures from a stamp it does not recognise.
 *
 * Bump on any change to the shape of the response.
 */
export const CONVERSATION_SIGNALS_BUILD = '2026-09-04-conversations-c';

export interface ConversationSignalRecord {
  kind: 'session' | 'conversation';
  /** Unique WITHIN its kind, not across both. `kind:id` is the stable key. */
  id: number;
  agentName: string;
  /**
   * The Jira account id from the KPI roster (`dbo.Agent`), which is the only identifier
   * that joins cleanly to `people-signals` and so the only one that carries a tier.
   * NULL when the name did not match the roster — reported, never guessed. See
   * `unmatchedNames` for who those were.
   */
  accountId: string | null;
  conversationType: string;
  typeLabel: string;
  /** London calendar date, 'YYYY-MM-DD'. */
  occurredOn: string;
  /** Plaud's UTC instant, normalised to carry the `Z`. Render in Europe/London. */
  startedAt: string | null;
  title: string | null;
  summaryExcerpt: string | null;
  /** The transcript body is deliberately never sent. See the header comment. */
  hasTranscript: boolean;
  peoplehrLogged: boolean;
  /**
   * When Nick ticked it, as a UTC instant WITH the `Z` on it (CONVERT style 127).
   *
   * Style 126 was the first cut and it emits `2026-09-03T17:42:11.000` — a UTC instant
   * that looks local, which is the exact ambiguity I spent this afternoon fixing in
   * Plaud's payload before shipping it again in my own new field. It matters because a
   * consumer compares this against `occurredOn`, a London calendar DATE: a tick at 00:30
   * London is 23:30 UTC the previous day, so reading it as local moves it a day, and
   * "logged within N working days" is a day-boundary measure where one day is the whole
   * answer. Late evening is exactly when a manager catches up on write-ups.
   */
  peoplehrLoggedAt: string | null;

  /**
   * When the conversation actually HAPPENED, as a UTC instant — distinct from
   * `occurredOn`, which for a 1-2-1 is the date it was BOOKED for.
   *
   * Those diverge, and not rarely: `completeSession` stamps `completed_at` with the
   * current time while `scheduled_date` stays at whatever it was booked for, and sessions
   * sit open long past their date (one was still `in_progress` in September carrying a
   * 2 July date). Measure a "logged within N days" clock from `occurredOn` and a
   * conversation held and written up the same day in September reads as sixty days late.
   *
   * NULL for `agent_conversations` rows, which have no equivalent: their `occurredOn` is
   * taken from the recording itself, so there is nothing for it to drift from and
   * `occurredOn` is authoritative for that kind.
   */
  completedAt: string | null;
}

export interface AttributionCoverage {
  /**
   * Recordings NEURO detected as a one-to-one conversation but could not attribute to
   * anybody, and therefore never offered.
   *
   * The size of the drop, not just the fact of one. "12 logged" and "12 logged, 5 could
   * not be attributed" are different claims, and only the second can be made honestly
   * without this number. While it is non-empty, any completeness figure derived from this
   * feed is a FLOOR.
   */
  unattributed: number;
  /** When NEURO last reported. NULL means it never has — which is not the same as zero. */
  lastSweepAt: string | null;
  /** True when `unattributed` is a real measurement rather than an absence of one. */
  measured: boolean;
}

export interface ConversationSignals {
  build: string;
  /** Echoed back so a caller can tell what window it actually got. */
  since: string | null;
  conversations: Signal<{
    records: ConversationSignalRecord[];
    /** Names on a conversation that no roster entry matched. Reported, never guessed. */
    unmatchedNames: string[];
  }>;
  attribution: Signal<AttributionCoverage>;
}

async function signal<T>(fn: () => Promise<T>): Promise<Signal<T>> {
  try {
    return { ok: true, error: null, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Query failed', data: null };
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Force a UTC instant to SAY it is one.
 *
 * CONVERT style 127 is documented as "ISO8601 with time zone Z" and I changed all of
 * these to it on that basis. It does not do that for `datetime2`: SQL Server only appends
 * the Z for `datetimeoffset`, so for every column here 127 emits byte-for-byte what 126
 * did and the fix silently changed nothing. It looked right in code review, it looked
 * right in a parsed response — `ConvertFrom-Json` re-renders an ISO string as a DateTime,
 * so the marker's absence was invisible — and it only showed up reading the raw bytes off
 * the wire.
 *
 * So the marker is appended here instead, where it cannot depend on a conversion style's
 * fine print. Every value passed in is written with GETUTCDATE() or is a Plaud timestamp,
 * both UTC; anything that already carries a zone is left alone.
 */
function utcIso(v: string | null | undefined): string | null {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  return /[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
}

async function records(since: string | null, roster: RosterPerson[]): Promise<{
  records: ConversationSignalRecord[]; unmatchedNames: string[];
}> {
  const byName = new Map(roster.map((p) => [nameKey(p.name), p.accountId]));

  // `since` is validated to a date literal before it reaches here and is passed as a
  // parameter regardless — the bridge is secret-guarded, not trusted.
  const sinceClause = since ? 'AND LEFT(s.scheduled_date, 10) >= ?' : '';
  const sessions = await query<{
    id: number; agent_name: string; occurred_on: string; started_at: string | null;
    title: string | null; tchars: number; peoplehr_logged_at: string | null;
    completed_at: string | null;
  }>(`
    SELECT s.id, s.agent_name,
           LEFT(s.scheduled_date, 10) AS occurred_on,
           c.started_at, c.title,
           CASE WHEN s.transcript_text IS NULL THEN 0 ELSE LEN(s.transcript_text) END AS tchars,
           -- Style 127, not 126: 127 appends the Z. Both are UTC; only one says so.
           CONVERT(varchar(33), s.peoplehr_logged_at, 127) AS peoplehr_logged_at,
           CONVERT(varchar(33), s.completed_at, 127) AS completed_at
    FROM agent_121_sessions s
    LEFT JOIN agent_121_transcript_candidates c ON c.session_id = s.id
    WHERE s.status = 'complete' ${sinceClause}
  `, since ? [since] : []);

  const convSince = since ? 'WHERE occurred_on >= ?' : '';
  const conversations = await query<{
    id: number; agent_name: string; conversation_type: string; occurred_on: string;
    started_at: string | null; title: string | null; summary_excerpt: string | null;
    tchars: number; peoplehr_logged_at: string | null;
  }>(`
    SELECT id, agent_name, conversation_type, occurred_on, started_at, title, summary_excerpt,
           CASE WHEN transcript_text IS NULL THEN 0 ELSE LEN(transcript_text) END AS tchars,
           CONVERT(varchar(33), peoplehr_logged_at, 127) AS peoplehr_logged_at
    FROM agent_conversations ${convSince}
  `, since ? [since] : []);

  const unmatched = new Set<string>();
  const resolve = (name: string): string | null => {
    const hit = byName.get(nameKey(name));
    if (!hit) unmatched.add(name);
    return hit ?? null;
  };

  const all: ConversationSignalRecord[] = [
    ...sessions.map((r) => ({
      kind: 'session' as const,
      id: r.id,
      agentName: r.agent_name,
      accountId: resolve(r.agent_name),
      conversationType: 'one_to_one',
      typeLabel: CONVERSATION_LABELS.one_to_one,
      occurredOn: r.occurred_on,
      startedAt: utcIso(r.started_at),
      title: r.title,
      summaryExcerpt: null,
      hasTranscript: Number(r.tchars) > 0,
      peoplehrLogged: !!r.peoplehr_logged_at,
      peoplehrLoggedAt: utcIso(r.peoplehr_logged_at),
      completedAt: utcIso(r.completed_at),
    })),
    ...conversations.map((r) => ({
      kind: 'conversation' as const,
      id: r.id,
      agentName: r.agent_name,
      accountId: resolve(r.agent_name),
      conversationType: r.conversation_type,
      typeLabel: CONVERSATION_LABELS[r.conversation_type] ?? r.conversation_type,
      occurredOn: r.occurred_on,
      startedAt: utcIso(r.started_at),
      title: r.title,
      summaryExcerpt: r.summary_excerpt,
      hasTranscript: Number(r.tchars) > 0,
      peoplehrLogged: !!r.peoplehr_logged_at,
      peoplehrLoggedAt: utcIso(r.peoplehr_logged_at),
      // No equivalent, and none is missing: occurredOn came off the recording.
      //
      // ⚠ NULL HERE IS A CONTRACT, NOT AN OVERSIGHT. VANTAGE branches on it: its clock is
      // `completedAt ?? occurredOn` and it states which it used, so a value appearing here
      // would silently change what it measures. If `agent_conversations` ever gains a
      // distinct "actually happened" timestamp, bump CONVERSATION_SIGNALS_BUILD and TELL
      // VANTAGE — a new field behind an unchanged stamp is the one failure the stamp
      // cannot catch.
      completedAt: null,
    })),
  ];

  all.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)
    || String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? ''))
    || b.id - a.id);

  return { records: all, unmatchedNames: [...unmatched].sort() };
}

async function attribution(): Promise<AttributionCoverage> {
  const row = await queryOne<{ unattributed: number; reported_at: string | null }>(`
    SELECT TOP 1 unattributed, CONVERT(varchar(33), reported_at, 126) AS reported_at
    FROM agent_conversation_sweep_stats ORDER BY reported_at DESC`);
  // Never default the count to 0. A sweep that has not reported is an ABSENCE of a
  // measurement, and reporting it as "nothing was dropped" is the exact false-clean
  // answer this field exists to prevent.
  if (!row) return { unattributed: 0, lastSweepAt: null, measured: false };
  return { unattributed: Number(row.unattributed) || 0, lastSweepAt: row.reported_at, measured: true };
}

export async function getConversationSignals(
  settings: SettingsQueries,
  opts: { since?: string } = {},
): Promise<ConversationSignals> {
  const since = opts.since && DATE_RE.test(opts.since) ? opts.since : null;

  // The roster is fetched once and shared. If it fails, the conversations section fails
  // with it rather than silently returning every accountId as null — a feed where every
  // join key is missing looks identical to a team nobody could be matched to.
  const roster = await signal(() => fetchRoster(settings));

  return {
    build: CONVERSATION_SIGNALS_BUILD,
    since,
    conversations: roster.ok && roster.data
      ? await signal(() => records(since, roster.data as RosterPerson[]))
      : { ok: false, error: `Roster unavailable: ${roster.error ?? 'unknown'}`, data: null },
    attribution: await signal(attribution),
  };
}

/** NEURO reports what its sweep could not attribute. See AttributionCoverage. */
export async function recordSweepStats(input: {
  unattributed: number; offered: number; scanned: number;
}): Promise<void> {
  const { execute } = await import('./database.js');
  await execute(`
    INSERT INTO agent_conversation_sweep_stats (unattributed, offered, scanned)
    VALUES (?, ?, ?)
  `, [Math.max(0, Math.trunc(input.unattributed)), Math.max(0, Math.trunc(input.offered)),
      Math.max(0, Math.trunc(input.scanned))]);
}
