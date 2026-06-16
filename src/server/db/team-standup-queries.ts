/**
 * Queries for the daily team standup accountability loop.
 * Tables created in schema.ts: standup_sessions, standup_submissions,
 * standup_commitments, standup_email_log.
 */
import { query, queryOne, execute, executeAndGetId } from '../services/database.js';

export type StandupSessionStatus = 'pending' | 'active' | 'complete';
export type CommitmentStatus = 'pending' | 'delivered' | 'missed' | 'excused';

export interface StandupSession {
  id: number;
  date: string;
  brief_json: string | null;
  plaud_recording_id: string | null;
  transcript_text: string | null;
  notes_text: string | null;
  status: StandupSessionStatus;
  created_at: string;
}

export interface StandupSubmission {
  id: number;
  session_id: number;
  agent_name: string;
  submitted_at: string;
  ticket_count: number | null;
  over_5_count: number | null;
  oldest_ticket: string | null;
  oldest_age: number | null;
  blockers: string | null;
  commitments_json: string | null;
  notes: string | null;
}

export interface StandupCommitment {
  id: number;
  submission_id: number;
  session_id: number;
  agent_name: string;
  commitment_text: string;
  status: CommitmentStatus;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export interface SessionSummary extends StandupSession {
  submission_count: number;
}

export class TeamStandupQueries {
  // ── Sessions ──

  async getSession(date: string): Promise<StandupSession | undefined> {
    return queryOne<StandupSession>(`SELECT * FROM standup_sessions WHERE date = ?`, [date]);
  }

  async getSessionById(id: number): Promise<StandupSession | undefined> {
    return queryOne<StandupSession>(`SELECT * FROM standup_sessions WHERE id = ?`, [id]);
  }

  /** Get the session for a date, creating it (status 'pending') if absent. */
  async ensureSession(date: string): Promise<StandupSession> {
    const existing = await this.getSession(date);
    if (existing) return existing;
    try {
      await execute(`INSERT INTO standup_sessions (date, status) VALUES (?, 'pending')`, [date]);
    } catch {
      // Unique-constraint race — another writer created it; fall through to re-read.
    }
    const created = await this.getSession(date);
    if (!created) throw new Error(`Failed to create standup session for ${date}`);
    return created;
  }

  async listSessions(limit = 60): Promise<SessionSummary[]> {
    return query<SessionSummary>(
      `SELECT s.*, (SELECT COUNT(*) FROM standup_submissions sub WHERE sub.session_id = s.id) AS submission_count
       FROM standup_sessions s
       ORDER BY s.date DESC
       OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`,
      [limit],
    );
  }

  async updateSession(
    date: string,
    fields: Partial<Pick<StandupSession, 'brief_json' | 'plaud_recording_id' | 'transcript_text' | 'notes_text' | 'status'>>,
  ): Promise<void> {
    const set: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      set.push(`${k} = ?`);
      params.push(v);
    }
    if (set.length === 0) return;
    params.push(date);
    await execute(`UPDATE standup_sessions SET ${set.join(', ')} WHERE date = ?`, params);
  }

  // ── Submissions ──

  async getSubmissions(sessionId: number): Promise<StandupSubmission[]> {
    return query<StandupSubmission>(
      `SELECT * FROM standup_submissions WHERE session_id = ? ORDER BY agent_name ASC`,
      [sessionId],
    );
  }

  async getSubmissionByAgent(sessionId: number, agentName: string): Promise<StandupSubmission | undefined> {
    return queryOne<StandupSubmission>(
      `SELECT * FROM standup_submissions WHERE session_id = ? AND agent_name = ?`,
      [sessionId, agentName],
    );
  }

  /** Insert or update an agent's submission for a session. Returns the submission id. */
  async upsertSubmission(input: {
    session_id: number;
    agent_name: string;
    ticket_count: number | null;
    over_5_count: number | null;
    oldest_ticket: string | null;
    oldest_age: number | null;
    blockers: string | null;
    commitments_json: string | null;
    notes: string | null;
  }): Promise<number> {
    const existing = await this.getSubmissionByAgent(input.session_id, input.agent_name);
    if (existing) {
      await execute(
        `UPDATE standup_submissions
         SET submitted_at = GETUTCDATE(), ticket_count = ?, over_5_count = ?, oldest_ticket = ?,
             oldest_age = ?, blockers = ?, commitments_json = ?, notes = ?
         WHERE id = ?`,
        [
          input.ticket_count, input.over_5_count, input.oldest_ticket, input.oldest_age,
          input.blockers, input.commitments_json, input.notes, existing.id,
        ],
      );
      return existing.id;
    }
    return executeAndGetId(
      `INSERT INTO standup_submissions
         (session_id, agent_name, ticket_count, over_5_count, oldest_ticket, oldest_age, blockers, commitments_json, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.session_id, input.agent_name, input.ticket_count, input.over_5_count,
        input.oldest_ticket, input.oldest_age, input.blockers, input.commitments_json, input.notes,
      ],
    );
  }

  // ── Commitments ──

  async getCommitments(sessionId: number): Promise<StandupCommitment[]> {
    return query<StandupCommitment>(
      `SELECT * FROM standup_commitments WHERE session_id = ? ORDER BY agent_name ASC, id ASC`,
      [sessionId],
    );
  }

  async getCommitment(id: number): Promise<StandupCommitment | undefined> {
    return queryOne<StandupCommitment>(`SELECT * FROM standup_commitments WHERE id = ?`, [id]);
  }

  /** Replace all commitments for a submission with the supplied list (re-explode on re-submit). */
  async replaceCommitments(
    submissionId: number,
    sessionId: number,
    agentName: string,
    texts: string[],
  ): Promise<void> {
    await execute(`DELETE FROM standup_commitments WHERE submission_id = ?`, [submissionId]);
    for (const text of texts) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      await execute(
        `INSERT INTO standup_commitments (submission_id, session_id, agent_name, commitment_text)
         VALUES (?, ?, ?, ?)`,
        [submissionId, sessionId, agentName, trimmed],
      );
    }
  }

  async updateCommitmentStatus(id: number, status: CommitmentStatus, reviewNote: string | null): Promise<boolean> {
    const { rowsAffected } = await execute(
      `UPDATE standup_commitments SET status = ?, review_note = ?, reviewed_at = GETUTCDATE() WHERE id = ?`,
      [status, reviewNote, id],
    );
    return rowsAffected > 0;
  }

  // ── Email log (idempotent morning prompts) ──

  /** Record a prompt send; returns false if already logged today (duplicate). */
  async logEmailSend(sessionId: number, agentName: string): Promise<boolean> {
    try {
      await execute(
        `INSERT INTO standup_email_log (session_id, agent_name) VALUES (?, ?)`,
        [sessionId, agentName],
      );
      return true;
    } catch {
      return false; // unique constraint -> already sent
    }
  }

  async wasEmailSent(sessionId: number, agentName: string): Promise<boolean> {
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM standup_email_log WHERE session_id = ? AND agent_name = ?`,
      [sessionId, agentName],
    );
    return (row?.n ?? 0) > 0;
  }
}
