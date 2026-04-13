import type { Database } from 'sql.js';
import { saveDb } from './schema.js';

export interface DevReviewState {
  jira_key: string;
  status: 'pending' | 'in_review' | 'accepted' | 'returned' | 'archived';
  fast_track: number;
  nova_priority: 'low' | 'normal' | 'high';
  claimed_by_user_id: number | null;
  claimed_at: string | null;
  submitted_by_username: string | null;
  first_seen_at: string;
  last_action_at: string;
  accepted_at: string | null;
  returned_at: string | null;
  archived_at: string | null;
}

export interface DevReviewThreadEntry {
  id: number;
  jira_key: string;
  user_id: number;
  user_display: string;
  kind: 'comment' | 'state_change' | 'accept' | 'return' | 'claim' | 'fasttrack';
  body: string | null;
  meta_json: string | null;
  jira_sync_state: 'pending' | 'synced' | 'failed' | 'skip';
  jira_sync_error: string | null;
  jira_comment_id: string | null;
  created_at: string;
}

export interface DevReviewOutboxEntry {
  id: number;
  jira_key: string;
  op: 'comment' | 'accept' | 'return';
  payload_json: string;
  attempts: number;
  status: 'pending' | 'done' | 'failed';
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

function rowToObj<T>(row: Record<string, unknown>): T {
  return row as unknown as T;
}

export class DevReviewQueries {
  constructor(private db: Database) {}

  // ── State ────────────────────────────────────────────────────────────────

  /** Get current state for a ticket; returns null if none. */
  getState(jiraKey: string): DevReviewState | null {
    const stmt = this.db.prepare('SELECT * FROM dev_review_state WHERE jira_key = ?');
    stmt.bind([jiraKey]);
    let result: DevReviewState | null = null;
    if (stmt.step()) result = rowToObj<DevReviewState>(stmt.getAsObject());
    stmt.free();
    return result;
  }

  /** Upsert state — used by the Jira poller when it first sees a T3 ticket. */
  upsertFromPoll(jiraKey: string, submittedBy: string | null): void {
    const existing = this.getState(jiraKey);
    if (existing) {
      // If ticket is archived but back in T3 → reopen
      if (existing.status === 'archived') {
        this.db.run(
          `UPDATE dev_review_state
           SET status='pending', archived_at=NULL, last_action_at=datetime('now')
           WHERE jira_key=?`,
          [jiraKey],
        );
        saveDb();
      }
      return;
    }
    this.db.run(
      `INSERT INTO dev_review_state (jira_key, status, submitted_by_username)
       VALUES (?, 'pending', ?)`,
      [jiraKey, submittedBy],
    );
    saveDb();
  }

  /** Mark as archived when the ticket is no longer at Tier 3. */
  archive(jiraKey: string): void {
    this.db.run(
      `UPDATE dev_review_state
       SET status='archived', archived_at=datetime('now'), last_action_at=datetime('now')
       WHERE jira_key=? AND status != 'archived'`,
      [jiraKey],
    );
    saveDb();
  }

  /** List the active queue (optionally filtered by claim / status / fast-track). */
  listQueue(filters?: {
    status?: DevReviewState['status'];
    claimedBy?: number | null;
    fastTrackOnly?: boolean;
    includeArchived?: boolean;
  }): DevReviewState[] {
    let sql = 'SELECT * FROM dev_review_state WHERE 1=1';
    const params: (string | number)[] = [];
    if (!filters?.includeArchived) sql += " AND status != 'archived'";
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.claimedBy !== undefined) {
      if (filters.claimedBy === null) sql += ' AND claimed_by_user_id IS NULL';
      else { sql += ' AND claimed_by_user_id = ?'; params.push(filters.claimedBy); }
    }
    if (filters?.fastTrackOnly) sql += ' AND fast_track = 1';
    sql += ' ORDER BY fast_track DESC, last_action_at DESC';
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const out: DevReviewState[] = [];
    while (stmt.step()) out.push(rowToObj<DevReviewState>(stmt.getAsObject()));
    stmt.free();
    return out;
  }

  claim(jiraKey: string, userId: number): void {
    this.db.run(
      `UPDATE dev_review_state
       SET claimed_by_user_id=?, claimed_at=datetime('now'),
           status = CASE WHEN status='pending' THEN 'in_review' ELSE status END,
           last_action_at=datetime('now')
       WHERE jira_key=?`,
      [userId, jiraKey],
    );
    saveDb();
  }

  unclaim(jiraKey: string): void {
    this.db.run(
      `UPDATE dev_review_state
       SET claimed_by_user_id=NULL, claimed_at=NULL, last_action_at=datetime('now')
       WHERE jira_key=?`,
      [jiraKey],
    );
    saveDb();
  }

  setFastTrack(jiraKey: string, on: boolean): void {
    this.db.run(
      `UPDATE dev_review_state SET fast_track=?, last_action_at=datetime('now') WHERE jira_key=?`,
      [on ? 1 : 0, jiraKey],
    );
    saveDb();
  }

  setPriority(jiraKey: string, priority: 'low' | 'normal' | 'high'): void {
    this.db.run(
      `UPDATE dev_review_state SET nova_priority=?, last_action_at=datetime('now') WHERE jira_key=?`,
      [priority, jiraKey],
    );
    saveDb();
  }

  markAccepted(jiraKey: string): void {
    this.db.run(
      `UPDATE dev_review_state
       SET status='accepted', accepted_at=datetime('now'), last_action_at=datetime('now')
       WHERE jira_key=?`,
      [jiraKey],
    );
    saveDb();
  }

  markReturned(jiraKey: string): void {
    this.db.run(
      `UPDATE dev_review_state
       SET status='returned', returned_at=datetime('now'), last_action_at=datetime('now')
       WHERE jira_key=?`,
      [jiraKey],
    );
    saveDb();
  }

  // ── Thread ───────────────────────────────────────────────────────────────

  addThreadEntry(entry: {
    jira_key: string;
    user_id: number;
    user_display: string;
    kind: DevReviewThreadEntry['kind'];
    body?: string;
    meta?: Record<string, unknown>;
    syncState?: DevReviewThreadEntry['jira_sync_state'];
  }): number {
    this.db.run(
      `INSERT INTO dev_review_thread
       (jira_key, user_id, user_display, kind, body, meta_json, jira_sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.jira_key,
        entry.user_id,
        entry.user_display,
        entry.kind,
        entry.body ?? null,
        entry.meta ? JSON.stringify(entry.meta) : null,
        entry.syncState ?? 'pending',
      ],
    );
    const stmt = this.db.prepare('SELECT last_insert_rowid() AS id');
    stmt.step();
    const id = (stmt.getAsObject() as { id: number }).id;
    stmt.free();
    saveDb();
    return id;
  }

  getThread(jiraKey: string): DevReviewThreadEntry[] {
    const stmt = this.db.prepare(
      'SELECT * FROM dev_review_thread WHERE jira_key = ? ORDER BY created_at ASC, id ASC',
    );
    stmt.bind([jiraKey]);
    const out: DevReviewThreadEntry[] = [];
    while (stmt.step()) out.push(rowToObj<DevReviewThreadEntry>(stmt.getAsObject()));
    stmt.free();
    return out;
  }

  markThreadSynced(id: number, jiraCommentId: string | null): void {
    this.db.run(
      `UPDATE dev_review_thread SET jira_sync_state='synced', jira_comment_id=?, jira_sync_error=NULL WHERE id=?`,
      [jiraCommentId, id],
    );
    saveDb();
  }

  markThreadSyncFailed(id: number, error: string): void {
    this.db.run(
      `UPDATE dev_review_thread SET jira_sync_state='failed', jira_sync_error=? WHERE id=?`,
      [error.slice(0, 500), id],
    );
    saveDb();
  }

  // ── Outbox ───────────────────────────────────────────────────────────────

  addOutbox(entry: { jira_key: string; op: DevReviewOutboxEntry['op']; payload: Record<string, unknown> }): number {
    this.db.run(
      `INSERT INTO dev_review_outbox (jira_key, op, payload_json) VALUES (?, ?, ?)`,
      [entry.jira_key, entry.op, JSON.stringify(entry.payload)],
    );
    const stmt = this.db.prepare('SELECT last_insert_rowid() AS id');
    stmt.step();
    const id = (stmt.getAsObject() as { id: number }).id;
    stmt.free();
    saveDb();
    return id;
  }

  pendingOutbox(limit = 20): DevReviewOutboxEntry[] {
    const stmt = this.db.prepare(
      `SELECT * FROM dev_review_outbox WHERE status='pending' AND attempts < 5 ORDER BY created_at ASC LIMIT ?`,
    );
    stmt.bind([limit]);
    const out: DevReviewOutboxEntry[] = [];
    while (stmt.step()) out.push(rowToObj<DevReviewOutboxEntry>(stmt.getAsObject()));
    stmt.free();
    return out;
  }

  markOutboxDone(id: number): void {
    this.db.run(
      `UPDATE dev_review_outbox SET status='done', processed_at=datetime('now') WHERE id=?`,
      [id],
    );
    saveDb();
  }

  bumpOutboxFailure(id: number, error: string): void {
    this.db.run(
      `UPDATE dev_review_outbox
       SET attempts = attempts + 1,
           last_error = ?,
           status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
           processed_at = CASE WHEN attempts + 1 >= 5 THEN datetime('now') ELSE processed_at END
       WHERE id=?`,
      [error.slice(0, 500), id],
    );
    saveDb();
  }
}
