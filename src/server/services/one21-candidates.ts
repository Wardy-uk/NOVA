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

export interface TranscriptCandidate {
  id: number;
  plaud_id: string;
  agent_name: string | null;
  meeting_date: string | null;
  title: string | null;
  note_path: string | null;
  attribution: string | null;
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
}): Promise<{ id: number; created: boolean; status: string }> {
  const existing = await queryOne<{ id: number; status: string }>(
    `SELECT TOP 1 id, status FROM agent_121_transcript_candidates WHERE plaud_id = ?`, [input.plaudId]);

  if (existing) {
    if (existing.status === 'pending') {
      await execute(`
        UPDATE agent_121_transcript_candidates
        SET agent_name = ?, meeting_date = ?, title = ?, note_path = ?,
            transcript_text = COALESCE(?, transcript_text), attribution = ?,
            participants = ?, started_at = ?, duration_minutes = ?, summary_excerpt = ?
        WHERE id = ?
      `, [input.agentName, input.meetingDate, input.title, input.notePath,
          input.transcript, input.attribution,
          input.participants ?? null, input.startedAt ?? null,
          input.durationMinutes ?? null, input.summaryExcerpt ?? null,
          existing.id]);
    }
    return { id: existing.id, created: false, status: existing.status };
  }

  const id = await executeAndGetId(`
    INSERT INTO agent_121_transcript_candidates
      (plaud_id, agent_name, meeting_date, title, note_path, transcript_text, attribution,
       participants, started_at, duration_minutes, summary_excerpt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `, [input.plaudId, input.agentName, input.meetingDate, input.title, input.notePath,
      input.transcript, input.attribution,
      input.participants ?? null, input.startedAt ?? null,
      input.durationMinutes ?? null, input.summaryExcerpt ?? null]);
  return { id, created: true, status: 'pending' };
}

/** Candidates awaiting a decision, newest meeting first. */
export async function listPendingCandidates(): Promise<TranscriptCandidate[]> {
  const rows = await query<TranscriptCandidate & { transcript_text: string | null }>(`
    SELECT id, plaud_id, agent_name, meeting_date, title, note_path, attribution,
           participants, started_at, duration_minutes, summary_excerpt,
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
export async function approveCandidate(candidateId: number, agentName?: string): Promise<{
  ok: boolean; error?: string; sessionId?: number;
}> {
  const c = await queryOne<{
    id: number; plaud_id: string; agent_name: string | null; meeting_date: string | null;
    transcript_text: string | null; status: string;
  }>(`SELECT id, plaud_id, agent_name, meeting_date, transcript_text, status
      FROM agent_121_transcript_candidates WHERE id = ?`, [candidateId]);
  if (!c) return { ok: false, error: 'Candidate not found' };
  if (c.status !== 'pending') return { ok: false, error: `Already ${c.status}` };

  const agent = (agentName ?? c.agent_name ?? '').trim();
  if (!agent) return { ok: false, error: 'No agent to attach this to — pick one first.' };

  // Never let one recording sit on two sessions.
  const clash = await queryOne<{ id: number; agent_name: string }>(
    `SELECT TOP 1 id, agent_name FROM agent_121_sessions WHERE plaud_recording_id = ?`, [c.plaud_id]);
  if (clash) return { ok: false, error: `Already attached to ${clash.agent_name}'s 1-2-1.` };

  const held = c.meeting_date && /^\d{4}-\d{2}-\d{2}$/.test(c.meeting_date)
    ? c.meeting_date
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

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
    SET status = 'approved', agent_name = ?, session_id = ?, resolved_at = GETUTCDATE()
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
