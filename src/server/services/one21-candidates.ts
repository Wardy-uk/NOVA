import { query, queryOne, execute, executeAndGetId } from './database.js';
import { getLatestSession, STALLED_AFTER_DAYS } from './one21-service.js';

/**
 * Plaud transcripts, detected but not applied.
 *
 * NOVA used to read Plaud directly over MCP. That connection has never been authorised in
 * prod (`plaud_oauth_tokens` unset, transport closing on a loop), so no 1-2-1 has ever had
 * a recording attached. NEURO already syncs every Plaud note into the vault reliably, with
 * `plaud_id`, the date and the `people:` links in frontmatter — so the transcript comes
 * over the bridge instead, keyed on that same `plaud_id`.
 *
 * ⚠ DETECTED IS NOT ATTACHED, and that is the whole point of this table.
 *
 * Attribution is a guess. Plaud names recordings by timestamp, so the title rarely says
 * whose 1-2-1 it was, and a note that mentions three people is not evidence about which
 * one it was *with*. Binding the wrong transcript writes one person's conversation onto
 * another person's permanent record — and the extractor would then close THAT person's
 * actions from words they never said. Detection is cheap and reversible; binding is
 * neither. So a candidate sits here, with its attribution shown, until Nick approves it.
 */

/**
 * How far a booked session's date may sit from a recording's and still be the same
 * meeting. A 1-2-1 gets moved within its week; it does not slip a month.
 */
const SAME_MEETING_DAYS = 14;

/**
 * The kinds of individual conversation a recording can be filed as.
 *
 * `one_to_one` is the only one that lands on `agent_121_sessions` and therefore the only
 * one that moves the cadence clock. Everything else is a conversation on the person's
 * record: real, worth keeping, and specifically NOT a discharge of the monthly 1-2-1 — a
 * welfare check on Tuesday does not mean they have been seen this month, and filing it as
 * one would mark them up to date and stop the real 1-2-1 being booked.
 */
export const CONVERSATION_TYPES = [
  'one_to_one', 'return_to_work', 'performance', 'welfare', 'ad_hoc',
] as const;
export type ConversationType = typeof CONVERSATION_TYPES[number];

/** Everything except a 1-2-1 goes to `agent_conversations`. */
export const isOneToOne = (t: string | null | undefined): boolean => (t ?? 'one_to_one') === 'one_to_one';

export const CONVERSATION_LABELS: Record<string, string> = {
  one_to_one: '1-2-1',
  return_to_work: 'Return to work',
  performance: 'Performance',
  welfare: 'Welfare',
  ad_hoc: 'Ad-hoc',
};

export interface TranscriptCandidate {
  id: number;
  plaud_id: string;
  agent_name: string | null;
  meeting_date: string | null;
  title: string | null;
  note_path: string | null;
  attribution: string | null;
  conversation_type: string | null;
  participants: string | null;
  started_at: string | null;
  duration_minutes: number | null;
  summary_excerpt: string | null;
  status: string;
  session_id: number | null;
  created_at: string;
  /** First few lines, so the review screen can show what it is without shipping the lot. */
  preview?: string;
  transcript_chars?: number;
}

/**
 * Record a transcript NEURO has found. Idempotent on `plaud_id`.
 *
 * A re-push refreshes a still-pending candidate (the transcript may have been re-synced,
 * or the attribution improved) but never revives one Nick has already resolved — an
 * approved transcript is attached and a rejected one was rejected for a reason, and
 * either way asking again is noise.
 */
export async function recordCandidate(input: {
  plaudId: string;
  agentName: string | null;
  meetingDate: string | null;
  title: string | null;
  notePath: string | null;
  transcript: string | null;
  attribution: string | null;
  participants?: string | null;
  startedAt?: string | null;
  durationMinutes?: number | null;
  summaryExcerpt?: string | null;
  conversationType?: string | null;
}): Promise<{ id: number; created: boolean; status: string }> {
  const existing = await queryOne<{ id: number; status: string }>(
    `SELECT TOP 1 id, status FROM agent_121_transcript_candidates WHERE plaud_id = ?`, [input.plaudId]);

  if (existing) {
    if (existing.status === 'pending') {
      await execute(`
        UPDATE agent_121_transcript_candidates
        SET agent_name = ?, meeting_date = ?, title = ?, note_path = ?,
            transcript_text = COALESCE(?, transcript_text), attribution = ?,
            participants = ?, started_at = ?, duration_minutes = ?, summary_excerpt = ?,
            conversation_type = ?
        WHERE id = ?
      `, [input.agentName, input.meetingDate, input.title, input.notePath,
          input.transcript, input.attribution,
          input.participants ?? null, input.startedAt ?? null,
          input.durationMinutes ?? null, input.summaryExcerpt ?? null,
          input.conversationType ?? null,
          existing.id]);
    }
    return { id: existing.id, created: false, status: existing.status };
  }

  const id = await executeAndGetId(`
    INSERT INTO agent_121_transcript_candidates
      (plaud_id, agent_name, meeting_date, title, note_path, transcript_text, attribution,
       participants, started_at, duration_minutes, summary_excerpt, conversation_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `, [input.plaudId, input.agentName, input.meetingDate, input.title, input.notePath,
      input.transcript, input.attribution,
      input.participants ?? null, input.startedAt ?? null,
      input.durationMinutes ?? null, input.summaryExcerpt ?? null,
      input.conversationType ?? null]);
  return { id, created: true, status: 'pending' };
}

/** Candidates awaiting a decision, newest meeting first. */
export async function listPendingCandidates(): Promise<TranscriptCandidate[]> {
  const rows = await query<TranscriptCandidate & { transcript_text: string | null }>(`
    SELECT id, plaud_id, agent_name, meeting_date, title, note_path, attribution,
           conversation_type, participants, started_at, duration_minutes, summary_excerpt,
           status, session_id, created_at,
           LEFT(transcript_text, 400) AS transcript_text,
           LEN(transcript_text) AS transcript_chars
    FROM agent_121_transcript_candidates
    WHERE status = 'pending'
    ORDER BY meeting_date DESC, id DESC
  `);
  return rows.map(({ transcript_text, ...r }) => ({ ...r, preview: transcript_text ?? undefined }));
}

/**
 * Approve a candidate: bind it to the agent's 1-2-1 and let the extractor read it.
 *
 * `agentName` overrides whatever NEURO guessed — the review screen lets Nick correct the
 * attribution, which is the main reason the approval step exists at all.
 *
 * The session it binds to is the agent's most recent HELD one. If there isn't one (the
 * 1-2-1 happened but NOVA never knew), a completed session is created dated to the
 * recording, which is the same rule `assignPlaudToAgent` already follows: attaching a
 * recording is what dates a 1-2-1.
 */
export async function approveCandidate(candidateId: number, agentName?: string, conversationType?: string): Promise<{
  ok: boolean; error?: string; sessionId?: number; conversationId?: number;
}> {
  const c = await queryOne<{
    id: number; plaud_id: string; agent_name: string | null; meeting_date: string | null;
    transcript_text: string | null; status: string; conversation_type: string | null;
    title: string | null; summary_excerpt: string | null; note_path: string | null;
    started_at: string | null;
  }>(`SELECT id, plaud_id, agent_name, meeting_date, transcript_text, status, conversation_type,
             title, summary_excerpt, note_path, started_at
      FROM agent_121_transcript_candidates WHERE id = ?`, [candidateId]);
  if (!c) return { ok: false, error: 'Candidate not found' };
  if (c.status !== 'pending') return { ok: false, error: `Already ${c.status}` };

  const agent = (agentName ?? c.agent_name ?? '').trim();
  if (!agent) return { ok: false, error: 'No agent to attach this to — pick one first.' };

  // Whatever the review screen says wins over what NEURO guessed — same reason the agent
  // name is overridable, and the type is the more consequential of the two: filing a
  // welfare check as a 1-2-1 marks the person as seen this month and stops the real one
  // being booked.
  const type = (conversationType && (CONVERSATION_TYPES as readonly string[]).includes(conversationType))
    ? conversationType
    : (c.conversation_type ?? 'one_to_one');

  // Never let one recording sit on two records, of either kind.
  const clash = await queryOne<{ id: number; agent_name: string }>(
    `SELECT TOP 1 id, agent_name FROM agent_121_sessions WHERE plaud_recording_id = ?`, [c.plaud_id]);
  if (clash) return { ok: false, error: `Already attached to ${clash.agent_name}'s 1-2-1.` };
  const clashConv = await queryOne<{ id: number; agent_name: string }>(
    `SELECT TOP 1 id, agent_name FROM agent_conversations WHERE plaud_recording_id = ?`, [c.plaud_id]);
  if (clashConv) return { ok: false, error: `Already on ${clashConv.agent_name}'s record.` };

  const held = c.meeting_date && /^\d{4}-\d{2}-\d{2}$/.test(c.meeting_date)
    ? c.meeting_date
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

  // ── Not a 1-2-1: it goes on the person's record and touches no cadence ──
  if (!isOneToOne(type)) {
    const conversationId = await executeAndGetId(`
      INSERT INTO agent_conversations
        (agent_name, conversation_type, occurred_on, started_at, plaud_recording_id,
         title, summary_excerpt, transcript_text, note_path, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'plaud')
    `, [agent, type, held, c.started_at, c.plaud_id, c.title, c.summary_excerpt,
        c.transcript_text, c.note_path]);

    await execute(`
      UPDATE agent_121_transcript_candidates
      SET status = 'approved', agent_name = ?, conversation_type = ?, resolved_at = GETUTCDATE()
      WHERE id = ?
    `, [agent, type, candidateId]);

    return { ok: true, conversationId };
  }

  // Reuse the agent's latest recording-less session only when it is plausibly THIS
  // meeting. Attaching rewrites `scheduled_date` to the recording's date, so binding a
  // June recording to an April session does not fill a gap — it overwrites the April
  // 1-2-1, and one row then claims to be two meetings. That could not happen while the
  // NEURO sweep only offered the last 30 days; it can now that it offers six months, and
  // backfilling the stalled people is exactly what a wide window is for.
  const latest = await getLatestSession(agent);
  const daysApart = latest
    ? Math.abs(Date.parse(`${String(latest.scheduled_date).slice(0, 10)}T00:00:00Z`) - Date.parse(`${held}T00:00:00Z`)) / 86400000
    : Infinity;
  let sessionId: number;
  if (latest && !latest.plaud_recording_id && daysApart <= SAME_MEETING_DAYS) {
    sessionId = latest.id;
  } else {
    sessionId = await executeAndGetId(`
      INSERT INTO agent_121_sessions (agent_name, scheduled_date, status)
      VALUES (?, ?, 'scheduled')
    `, [agent, held]);
  }

  // Attaching dates the 1-2-1 and marks it held — the meeting demonstrably happened,
  // because it was recorded. `extracted_at` stays NULL so the hourly sweep reads it.
  await execute(`
    UPDATE agent_121_sessions
    SET plaud_recording_id = ?, transcript_text = ?, scheduled_date = ?,
        completed_at = COALESCE(completed_at, ?), status = 'complete', extracted_at = NULL
    WHERE id = ?
  `, [c.plaud_id, c.transcript_text, held, held, sessionId]);

  // A stalled session is now debris — clear it, or the agent stays flagged forever.
  //
  // Attaching a recording proves the 1-2-1 happened, but it lands on its own row and
  // nothing ever closed the half-finished wizard session sitting behind it. The overview
  // reads STATUS off the oldest OPEN session, not off the last held one, so Stephen's
  // 1-2-1 showed "Last 18 Aug" and "Stalled — 2 Jul" side by side, and no amount of
  // recording would have cleared it.
  //
  // Only `in_progress` sessions well past their date, which is this codebase's own
  // definition of stalled: opened in the click-through, never finished, "can never be
  // prepped again and never books the next 1-2-1". A `scheduled` session in the past is
  // left alone — that is a meeting that genuinely has not happened yet (overdue), a
  // different problem with a different fix, and silencing it here would hide it.
  const stalledBefore = new Date(Date.now() - STALLED_AFTER_DAYS * 86_400_000)
    .toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  await execute(`
    UPDATE agent_121_sessions
    SET status = 'abandoned'
    WHERE agent_name = ? AND id <> ? AND status = 'in_progress'
      AND LEFT(scheduled_date, 10) < ?
  `, [agent, sessionId, stalledBefore]);

  await execute(`
    UPDATE agent_121_transcript_candidates
    SET status = 'approved', agent_name = ?, session_id = ?, conversation_type = 'one_to_one',
        resolved_at = GETUTCDATE()
    WHERE id = ?
  `, [agent, sessionId, candidateId]);

  return { ok: true, sessionId };
}

/** Not a 1-2-1, or not one worth recording. Stays rejected — NEURO won't re-offer it. */
export async function rejectCandidate(candidateId: number): Promise<void> {
  await execute(`
    UPDATE agent_121_transcript_candidates
    SET status = 'rejected', resolved_at = GETUTCDATE()
    WHERE id = ? AND status = 'pending'
  `, [candidateId]);
}

/**
 * Which recordings NOVA has resolved, split by HOW.
 *
 * The split matters because NEURO uses it to decide whether to extract a note itself.
 * A 1-2-1 recording is extracted once, here, and NEURO must not spend a second LLM call
 * on the same words — but a recording Nick REJECTED is not a 1-2-1 at all, so it falls
 * back to NEURO's ordinary meeting scan. Merging the two lists would silently drop
 * rejected meetings out of both systems.
 */
export async function getResolvedPlaudIds(): Promise<{ approved: string[]; rejected: string[] }> {
  const rows = await query<{ plaud_id: string; status: string }>(`
    SELECT plaud_id, status FROM agent_121_transcript_candidates WHERE status <> 'pending'
    UNION
    SELECT plaud_recording_id, 'approved' FROM agent_121_sessions WHERE plaud_recording_id IS NOT NULL
    UNION
    -- Conversations count as resolved too. Without this a welfare check approved onto
    -- someone's record would be offered again on the next sweep, forever.
    SELECT plaud_recording_id, 'approved' FROM agent_conversations WHERE plaud_recording_id IS NOT NULL
  `);
  return {
    approved: rows.filter((r) => r.status === 'approved').map((r) => r.plaud_id).filter(Boolean),
    rejected: rows.filter((r) => r.status === 'rejected').map((r) => r.plaud_id).filter(Boolean),
  };
}

/** Who has a transcript waiting on a decision — drives the badge on NEURO's People card. */
export async function getPendingByAgent(): Promise<Array<{ agentName: string | null; count: number; latest: string | null }>> {
  return query(`
    SELECT agent_name AS agentName, COUNT(*) AS count, MAX(meeting_date) AS latest
    FROM agent_121_transcript_candidates
    WHERE status = 'pending'
    GROUP BY agent_name
  `);
}


/**
 * Every individual conversation on one person's record, newest first.
 *
 * ONE read model over two tables on purpose. 1-2-1s live in `agent_121_sessions` because
 * they drive the cadence; everything else lives in `agent_conversations` because it must
 * not. But "who have I sat down with, and when" is a single question, and answering it
 * from two shapes in every consumer is how they drift apart. `kind` says which table a row
 * came from, and it is also the field a caller needs to tick the right PeopleHR box.
 *
 * This is the shape Vantage will read. Deliberately flat, deliberately free of the
 * transcript body — the timeline is a list of what happened, and shipping 70k characters
 * per row would make it unusable for the thing it is for.
 */
export interface ConversationRecord {
  kind: 'session' | 'conversation';
  id: number;
  agentName: string;
  conversationType: string;
  typeLabel: string;
  occurredOn: string;
  startedAt: string | null;
  title: string | null;
  summaryExcerpt: string | null;
  hasTranscript: boolean;
  peoplehrLogged: boolean;
  peoplehrLoggedAt: string | null;
}

export async function listConversations(agentName: string): Promise<ConversationRecord[]> {
  const sessions = await query<{
    id: number; agent_name: string; occurred_on: string; started_at: string | null;
    title: string | null; tchars: number; peoplehr_logged_at: string | null;
  }>(`
    SELECT s.id, s.agent_name,
           LEFT(s.scheduled_date, 10) AS occurred_on,
           c.started_at,
           c.title,
           CASE WHEN s.transcript_text IS NULL THEN 0 ELSE LEN(s.transcript_text) END AS tchars,
           CONVERT(varchar(19), s.peoplehr_logged_at, 126) AS peoplehr_logged_at
    FROM agent_121_sessions s
    -- The candidate row is where the recording's title and start time live; a session only
    -- ever knew its date. LEFT, because a 1-2-1 held without a recording is still a 1-2-1.
    LEFT JOIN agent_121_transcript_candidates c ON c.session_id = s.id
    WHERE s.agent_name = ? AND s.status = 'complete'
  `, [agentName]);

  const conversations = await query<{
    id: number; agent_name: string; conversation_type: string; occurred_on: string;
    started_at: string | null; title: string | null; summary_excerpt: string | null;
    tchars: number; peoplehr_logged_at: string | null;
  }>(`
    SELECT id, agent_name, conversation_type, occurred_on, started_at, title, summary_excerpt,
           CASE WHEN transcript_text IS NULL THEN 0 ELSE LEN(transcript_text) END AS tchars,
           CONVERT(varchar(19), peoplehr_logged_at, 126) AS peoplehr_logged_at
    FROM agent_conversations WHERE agent_name = ?
  `, [agentName]);

  const rows: ConversationRecord[] = [
    ...sessions.map((r) => ({
      kind: 'session' as const,
      id: r.id,
      agentName: r.agent_name,
      conversationType: 'one_to_one',
      typeLabel: CONVERSATION_LABELS.one_to_one,
      occurredOn: r.occurred_on,
      startedAt: r.started_at,
      title: r.title,
      summaryExcerpt: null,
      hasTranscript: Number(r.tchars) > 0,
      peoplehrLogged: !!r.peoplehr_logged_at,
      peoplehrLoggedAt: r.peoplehr_logged_at,
    })),
    ...conversations.map((r) => ({
      kind: 'conversation' as const,
      id: r.id,
      agentName: r.agent_name,
      conversationType: r.conversation_type,
      typeLabel: CONVERSATION_LABELS[r.conversation_type] ?? r.conversation_type,
      occurredOn: r.occurred_on,
      startedAt: r.started_at,
      title: r.title,
      summaryExcerpt: r.summary_excerpt,
      hasTranscript: Number(r.tchars) > 0,
      peoplehrLogged: !!r.peoplehr_logged_at,
      peoplehrLoggedAt: r.peoplehr_logged_at,
    })),
  ];

  // Newest first, and stable when two conversations share a date — which happens more
  // than you would think, because a return-to-work and the 1-2-1 that follows it are
  // usually the same morning.
  return rows.sort((a, b) => (b.occurredOn.localeCompare(a.occurredOn))
    || String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? ''))
    || b.id - a.id);
}

/**
 * Tick a non-1-2-1 conversation as written up in PeopleHR.
 *
 * The sibling of setPeopleHrLogged for the other table. Kept as two functions rather than
 * one with a `kind` switch, because the two tables have genuinely different lifecycles and
 * a shared writer would have to be trusted to pick the right one from a string off the
 * wire — the sort of thing that goes wrong quietly.
 */
export async function setConversationPeopleHrLogged(id: number, logged: boolean): Promise<{ ok: boolean; error?: string }> {
  const row = await queryOne<{ id: number }>(`SELECT id FROM agent_conversations WHERE id = ?`, [id]);
  if (!row) return { ok: false, error: 'Conversation not found' };
  await execute(
    `UPDATE agent_conversations SET peoplehr_logged_at = ${logged ? 'GETUTCDATE()' : 'NULL'} WHERE id = ?`,
    [id]);
  return { ok: true };
}
