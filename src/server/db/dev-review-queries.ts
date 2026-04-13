import type { Database } from 'sql.js';
import { saveDb } from './schema.js';

export interface DevReviewState {
  jira_key: string;
  status: 'pending' | 'in_review' | 'waiting_on_assignee' | 'accepted' | 'returned' | 'archived';
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
  team: string | null;
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

// ── Working-hours math ────────────────────────────────────────────────────
// Simple Monday–Friday 09:00–17:00 model (8 hours/day). No bank-holiday
// handling yet — can bolt on later if the count gets too noisy after Easter
// / Christmas etc. Used for the "not picked up in 8 working hours" KPI.

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
const WORK_DAY_HOURS = WORK_END_HOUR - WORK_START_HOUR;

/** Given a start timestamp and a number of business hours, compute the
 *  deadline — i.e. the wall-clock time at which that many business hours
 *  will have elapsed. Walks forward day by day, skipping weekends. */
function deadlineFromWorkingHours(startIso: string, hours: number): Date {
  let remaining = hours;
  const cursor = new Date(startIso);
  // Guard against infinite loops from bad input
  let safety = 200;
  while (remaining > 0 && safety-- > 0) {
    const day = cursor.getDay(); // 0 Sun, 6 Sat
    if (day === 0) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }
    if (day === 6) {
      cursor.setDate(cursor.getDate() + 2);
      cursor.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }
    if (cursor.getHours() < WORK_START_HOUR) {
      cursor.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }
    if (cursor.getHours() >= WORK_END_HOUR) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(WORK_START_HOUR, 0, 0, 0);
      continue;
    }
    // Inside the working window — consume as much as we can today
    const endOfDay = new Date(cursor);
    endOfDay.setHours(WORK_END_HOUR, 0, 0, 0);
    const hoursUntilEod = (endOfDay.getTime() - cursor.getTime()) / 3_600_000;
    if (remaining <= hoursUntilEod) {
      cursor.setTime(cursor.getTime() + remaining * 3_600_000);
      remaining = 0;
    } else {
      remaining -= hoursUntilEod;
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(WORK_START_HOUR, 0, 0, 0);
    }
  }
  return cursor;
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

  /** Backfill the submitter username (called by the background watcher after
   *  it resolves the actual escalator from the Jira changelog). */
  setSubmitter(jiraKey: string, username: string): void {
    this.db.run(
      `UPDATE dev_review_state SET submitted_by_username=? WHERE jira_key=?`,
      [username, jiraKey],
    );
    saveDb();
  }

  /** Backfill both submitter AND escalation time from the Jira changelog.
   *  Overwrites first_seen_at so dashboards reflect the actual escalation
   *  time rather than the time NOVA first noticed the ticket on bootstrap. */
  setEscalationMetadata(jiraKey: string, submitter: string | null, escalationIso: string | null): void {
    if (submitter && escalationIso) {
      this.db.run(
        `UPDATE dev_review_state
         SET submitted_by_username=?, first_seen_at=?
         WHERE jira_key=?`,
        [submitter, escalationIso, jiraKey],
      );
    } else if (submitter) {
      this.db.run(
        `UPDATE dev_review_state SET submitted_by_username=? WHERE jira_key=?`,
        [submitter, jiraKey],
      );
    } else if (escalationIso) {
      this.db.run(
        `UPDATE dev_review_state SET first_seen_at=? WHERE jira_key=?`,
        [escalationIso, jiraKey],
      );
    }
    saveDb();
  }

  /** Get all keys missing a submitter — for background backfill. */
  getKeysMissingSubmitter(limit = 25): string[] {
    const stmt = this.db.prepare(
      `SELECT jira_key FROM dev_review_state WHERE submitted_by_username IS NULL AND status != 'archived' LIMIT ?`,
    );
    stmt.bind([limit]);
    const out: string[] = [];
    while (stmt.step()) out.push((stmt.getAsObject() as { jira_key: string }).jira_key);
    stmt.free();
    return out;
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

  /** Backfill team from the Nurtur Product field on each queue sync. */
  setTeam(jiraKey: string, team: string): void {
    this.db.run(
      `UPDATE dev_review_state SET team=? WHERE jira_key=? AND (team IS NULL OR team != ?)`,
      [team, jiraKey, team],
    );
    saveDb();
  }

  /** Generic status update — used for the waiting_on_assignee round-trip. */
  setStatus(jiraKey: string, status: DevReviewState['status']): void {
    this.db.run(
      `UPDATE dev_review_state SET status=?, last_action_at=datetime('now') WHERE jira_key=?`,
      [status, jiraKey],
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
      'SELECT * FROM dev_review_thread WHERE jira_key = ? ORDER BY created_at DESC, id DESC',
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

  /** Insert an externally-sourced Jira comment into the thread. Used by the
   *  watcher when an agent replies in Jira directly — the entry is created
   *  already-synced with the Jira comment ID set so we don't re-import it. */
  addExternalJiraComment(entry: {
    jira_key: string;
    author_display: string;
    body: string;
    jira_comment_id: string;
    author_account_id?: string;
    internal?: boolean;
  }): void {
    this.db.run(
      `INSERT INTO dev_review_thread
       (jira_key, user_id, user_display, kind, body, meta_json, jira_sync_state, jira_comment_id)
       VALUES (?, 0, ?, 'comment', ?, ?, 'synced', ?)`,
      [
        entry.jira_key,
        entry.author_display,
        entry.body,
        JSON.stringify({ source: 'jira', author_account_id: entry.author_account_id, internal: !!entry.internal }),
        entry.jira_comment_id,
      ],
    );
    saveDb();
  }

  /** Check whether a given Jira comment ID has already been recorded in the
   *  thread for a ticket — used by the comment watcher to avoid duplicates. */
  hasJiraComment(jiraKey: string, jiraCommentId: string): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM dev_review_thread WHERE jira_key = ? AND jira_comment_id = ? LIMIT 1`,
    );
    stmt.bind([jiraKey, jiraCommentId]);
    const exists = stmt.step();
    stmt.free();
    return exists;
  }

  /** Get all keys currently in an active review state — used by the comment
   *  watcher to know which tickets to poll for new Jira comments. */
  getActiveKeys(): string[] {
    const stmt = this.db.prepare(
      `SELECT jira_key FROM dev_review_state WHERE status NOT IN ('archived','accepted','returned')`,
    );
    const out: string[] = [];
    while (stmt.step()) out.push((stmt.getAsObject() as { jira_key: string }).jira_key);
    stmt.free();
    return out;
  }

  markThreadSyncFailed(id: number, error: string): void {
    this.db.run(
      `UPDATE dev_review_thread SET jira_sync_state='failed', jira_sync_error=? WHERE id=?`,
      [error.slice(0, 500), id],
    );
    saveDb();
  }

  /** Delete stale failed thread entries for a ticket — used after a
   *  successful retry so the activity panel doesn't show ghost duplicates
   *  from earlier failed attempts. */
  purgeFailedThreadEntries(jiraKey: string, excludeId?: number): number {
    const stmt = this.db.prepare(
      `SELECT COUNT(*) AS n FROM dev_review_thread
       WHERE jira_key = ? AND jira_sync_state = 'failed'${excludeId ? ' AND id != ?' : ''}`,
    );
    stmt.bind(excludeId ? [jiraKey, excludeId] : [jiraKey]);
    let count = 0;
    if (stmt.step()) count = (stmt.getAsObject() as { n: number }).n;
    stmt.free();
    if (count > 0) {
      this.db.run(
        `DELETE FROM dev_review_thread
         WHERE jira_key = ? AND jira_sync_state = 'failed'${excludeId ? ' AND id != ?' : ''}`,
        excludeId ? [jiraKey, excludeId] : [jiraKey],
      );
      saveDb();
    }
    return count;
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

  // ── Dashboard aggregations ────────────────────────────────────────────────

  /** Run a single-row aggregate query and return the first column as a number. */
  private scalar(sql: string, params: (string | number)[] = []): number {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    let n = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const first = Object.values(row)[0];
      n = typeof first === 'number' ? first : Number(first ?? 0);
    }
    stmt.free();
    return n;
  }

  /** Run an aggregate query returning an array of rows. */
  private rows<T>(sql: string, params: (string | number)[] = []): T[] {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as unknown as T);
    stmt.free();
    return out;
  }

  /** Top-level snapshot for the Dev Review dashboard. All times in server local TZ. */
  getDashboard(): {
    queue: { total: number; pending: number; in_review: number; fast_track: number; unclaimed: number };
    today: { new: number; accepted: number; returned: number; processed: number };
    week: { new: number; accepted: number; returned: number };
    allTime: { accepted: number; returned: number };
    averages: {
      acceptanceRatePct: number | null;
      avgTimeToClaimMinutes: number | null;
      avgTimeToDecisionMinutes: number | null;
      oldestPendingHours: number | null;
    };
    perDeveloper: Array<{
      user_id: number;
      display: string;
      claimed_now: number;
      accepted_today: number;
      returned_today: number;
      accepted_week: number;
      returned_week: number;
      accepted_all: number;
      returned_all: number;
    }>;
    arrivals14d: Array<{ date: string; count: number }>;
    decisions14d: Array<{ date: string; accepted: number; returned: number }>;
    perTeam: Array<{
      team: string;
      in_queue: number;
      waiting: number;
      accepted_week: number;
      returned_week: number;
      accepted_all: number;
      returned_all: number;
    }>;
    unpickedKpi: {
      today: number;
      currentlyBreached: number;
      history14d: Array<{ date: string; count: number }>;
      liveBreaches: Array<{
        jira_key: string;
        first_seen_at: string;
        team: string | null;
        deadline: string;
        hours_overdue: number;
      }>;
    };
  } {
    // ── Queue snapshot ──────────────────────────────────────────────────
    const queue = {
      total: this.scalar(
        `SELECT COUNT(*) FROM dev_review_state WHERE status NOT IN ('archived','accepted','returned')`,
      ),
      pending: this.scalar(`SELECT COUNT(*) FROM dev_review_state WHERE status = 'pending'`),
      in_review: this.scalar(`SELECT COUNT(*) FROM dev_review_state WHERE status = 'in_review'`),
      fast_track: this.scalar(
        `SELECT COUNT(*) FROM dev_review_state WHERE fast_track = 1 AND status NOT IN ('archived','accepted','returned')`,
      ),
      unclaimed: this.scalar(
        `SELECT COUNT(*) FROM dev_review_state WHERE claimed_by_user_id IS NULL AND status NOT IN ('archived','accepted','returned')`,
      ),
    };

    // ── Today / Week ─────────────────────────────────────────────────────
    // Exclude archived rows from "new" counts — they were either closed
    // or never actually escalated to T3 (cleaned up by the watcher).
    const today = {
      new: this.scalar(
        `SELECT COUNT(*) FROM dev_review_state
         WHERE date(first_seen_at) = date('now', 'localtime') AND status != 'archived'`,
      ),
      accepted: this.scalar(
        `SELECT COUNT(*) FROM dev_review_state WHERE date(accepted_at) = date('now', 'localtime')`,
      ),
      returned: this.scalar(
        `SELECT COUNT(*) FROM dev_review_state WHERE date(returned_at) = date('now', 'localtime')`,
      ),
      processed: 0,
    };
    today.processed = today.accepted + today.returned;

    const week = {
      new: this.scalar(
        `SELECT COUNT(*) FROM dev_review_state
         WHERE first_seen_at >= datetime('now', '-7 days') AND status != 'archived'`,
      ),
      accepted: this.scalar(
        `SELECT COUNT(*) FROM dev_review_state WHERE accepted_at >= datetime('now', '-7 days')`,
      ),
      returned: this.scalar(
        `SELECT COUNT(*) FROM dev_review_state WHERE returned_at >= datetime('now', '-7 days')`,
      ),
    };

    const allTime = {
      accepted: this.scalar(`SELECT COUNT(*) FROM dev_review_state WHERE accepted_at IS NOT NULL`),
      returned: this.scalar(`SELECT COUNT(*) FROM dev_review_state WHERE returned_at IS NOT NULL`),
    };

    // ── Averages ─────────────────────────────────────────────────────────
    const decisionTotal = allTime.accepted + allTime.returned;
    const acceptanceRatePct =
      decisionTotal > 0 ? Math.round((allTime.accepted / decisionTotal) * 1000) / 10 : null;

    const avgTimeToClaimSec = this.scalar(
      `SELECT AVG((julianday(claimed_at) - julianday(first_seen_at)) * 86400)
       FROM dev_review_state
       WHERE claimed_at IS NOT NULL AND first_seen_at IS NOT NULL`,
    );
    const avgTimeToClaimMinutes = avgTimeToClaimSec > 0 ? Math.round(avgTimeToClaimSec / 60) : null;

    const avgDecisionSec = this.scalar(
      `SELECT AVG((julianday(COALESCE(accepted_at, returned_at)) - julianday(claimed_at)) * 86400)
       FROM dev_review_state
       WHERE claimed_at IS NOT NULL AND (accepted_at IS NOT NULL OR returned_at IS NOT NULL)`,
    );
    const avgTimeToDecisionMinutes = avgDecisionSec > 0 ? Math.round(avgDecisionSec / 60) : null;

    const oldestSec = this.scalar(
      `SELECT MAX((julianday('now') - julianday(first_seen_at)) * 86400)
       FROM dev_review_state
       WHERE status NOT IN ('archived','accepted','returned')`,
    );
    const oldestPendingHours = oldestSec > 0 ? Math.round(oldestSec / 3600) : null;

    // ── Per developer ────────────────────────────────────────────────────
    // Currently claimed (pulled from dev_review_state)
    const claimedRows = this.rows<{ user_id: number; cnt: number }>(
      `SELECT claimed_by_user_id AS user_id, COUNT(*) AS cnt
       FROM dev_review_state
       WHERE claimed_by_user_id IS NOT NULL AND status NOT IN ('archived','accepted','returned')
       GROUP BY claimed_by_user_id`,
    );
    // Accept/return counts come from the thread table (which records who took the action)
    const threadCounts = this.rows<{
      user_id: number;
      display: string;
      kind: string;
      total: number;
      today: number;
      week: number;
    }>(
      `SELECT user_id, user_display AS display, kind,
              COUNT(*) AS total,
              SUM(CASE WHEN date(created_at) = date('now','localtime') THEN 1 ELSE 0 END) AS today,
              SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS week
       FROM dev_review_thread
       WHERE kind IN ('accept','return')
       GROUP BY user_id, user_display, kind`,
    );

    const perDevMap = new Map<number, {
      user_id: number; display: string;
      claimed_now: number;
      accepted_today: number; returned_today: number;
      accepted_week: number; returned_week: number;
      accepted_all: number; returned_all: number;
    }>();

    for (const r of threadCounts) {
      const existing = perDevMap.get(r.user_id) || {
        user_id: r.user_id, display: r.display,
        claimed_now: 0,
        accepted_today: 0, returned_today: 0,
        accepted_week: 0, returned_week: 0,
        accepted_all: 0, returned_all: 0,
      };
      if (r.kind === 'accept') {
        existing.accepted_today += r.today;
        existing.accepted_week += r.week;
        existing.accepted_all += r.total;
      } else if (r.kind === 'return') {
        existing.returned_today += r.today;
        existing.returned_week += r.week;
        existing.returned_all += r.total;
      }
      perDevMap.set(r.user_id, existing);
    }
    for (const c of claimedRows) {
      const existing = perDevMap.get(c.user_id) || {
        user_id: c.user_id, display: `User #${c.user_id}`,
        claimed_now: 0,
        accepted_today: 0, returned_today: 0,
        accepted_week: 0, returned_week: 0,
        accepted_all: 0, returned_all: 0,
      };
      existing.claimed_now = c.cnt;
      perDevMap.set(c.user_id, existing);
    }

    const perDeveloper = Array.from(perDevMap.values()).sort(
      (a, b) => (b.claimed_now + b.accepted_week + b.returned_week) - (a.claimed_now + a.accepted_week + a.returned_week),
    );

    // ── 14-day arrival + decision sparklines ─────────────────────────────
    const arrivals14d = this.rows<{ date: string; count: number }>(
      `SELECT date(first_seen_at, 'localtime') AS date, COUNT(*) AS count
       FROM dev_review_state
       WHERE first_seen_at >= datetime('now','-14 days') AND status != 'archived'
       GROUP BY date(first_seen_at, 'localtime')
       ORDER BY date ASC`,
    );

    const decisionRowsByDay = this.rows<{ date: string; kind: string; cnt: number }>(
      `SELECT date(created_at, 'localtime') AS date, kind, COUNT(*) AS cnt
       FROM dev_review_thread
       WHERE kind IN ('accept','return') AND created_at >= datetime('now','-14 days')
       GROUP BY date(created_at, 'localtime'), kind
       ORDER BY date ASC`,
    );
    const decByDay = new Map<string, { accepted: number; returned: number }>();
    for (const r of decisionRowsByDay) {
      const e = decByDay.get(r.date) || { accepted: 0, returned: 0 };
      if (r.kind === 'accept') e.accepted += r.cnt;
      else if (r.kind === 'return') e.returned += r.cnt;
      decByDay.set(r.date, e);
    }
    const decisions14d = Array.from(decByDay.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Per team breakdown ───────────────────────────────────────────────
    // In-queue + waiting now per team, and week/all-time decisions per team.
    // Team comes from dev_review_state.team (populated during queue sync).
    const teamQueueRows = this.rows<{ team: string; in_queue: number; waiting: number }>(
      `SELECT COALESCE(team, 'Unassigned') AS team,
              SUM(CASE WHEN status NOT IN ('archived','accepted','returned','waiting_on_assignee') THEN 1 ELSE 0 END) AS in_queue,
              SUM(CASE WHEN status = 'waiting_on_assignee' THEN 1 ELSE 0 END) AS waiting
       FROM dev_review_state
       WHERE status NOT IN ('archived')
       GROUP BY COALESCE(team, 'Unassigned')`,
    );
    const teamDecisionRows = this.rows<{ team: string; kind: string; total: number; week: number }>(
      `SELECT COALESCE(s.team, 'Unassigned') AS team, t.kind,
              COUNT(*) AS total,
              SUM(CASE WHEN t.created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS week
       FROM dev_review_thread t
       LEFT JOIN dev_review_state s ON s.jira_key = t.jira_key
       WHERE t.kind IN ('accept','return')
       GROUP BY COALESCE(s.team, 'Unassigned'), t.kind`,
    );

    const teamMap = new Map<string, {
      team: string;
      in_queue: number;
      waiting: number;
      accepted_week: number;
      returned_week: number;
      accepted_all: number;
      returned_all: number;
    }>();
    for (const r of teamQueueRows) {
      teamMap.set(r.team, {
        team: r.team,
        in_queue: r.in_queue,
        waiting: r.waiting,
        accepted_week: 0, returned_week: 0, accepted_all: 0, returned_all: 0,
      });
    }
    for (const r of teamDecisionRows) {
      const existing = teamMap.get(r.team) || {
        team: r.team, in_queue: 0, waiting: 0,
        accepted_week: 0, returned_week: 0, accepted_all: 0, returned_all: 0,
      };
      if (r.kind === 'accept') {
        existing.accepted_week = r.week;
        existing.accepted_all = r.total;
      } else if (r.kind === 'return') {
        existing.returned_week = r.week;
        existing.returned_all = r.total;
      }
      teamMap.set(r.team, existing);
    }
    const perTeam = Array.from(teamMap.values()).sort(
      (a, b) => (b.in_queue + b.waiting + b.accepted_week + b.returned_week) - (a.in_queue + a.waiting + a.accepted_week + a.returned_week),
    );

    // ── Unpicked KPI: tickets that went 8 working hours without being ──
    // picked up (no dev accept/return/comment action within the deadline).
    // "Breach date" is the calendar date the 8-working-hour window expired.
    //
    // Two outputs:
    //   - 14-day history bucketed by breach date
    //   - Live list of currently-breached tickets (still active, still no
    //     dev action recorded)
    //
    // We pull every non-archived state row with first_seen_at set, load the
    // first pickup action per jira_key in one query, then bucket in JS.
    const stateRows = this.rows<{
      jira_key: string;
      first_seen_at: string;
      team: string | null;
      status: string;
    }>(
      `SELECT jira_key, first_seen_at, team, status
       FROM dev_review_state
       WHERE status != 'archived' AND first_seen_at IS NOT NULL`,
    );
    const firstPickupRows = this.rows<{ jira_key: string; first_action_at: string }>(
      `SELECT jira_key, MIN(created_at) AS first_action_at
       FROM dev_review_thread
       WHERE kind IN ('comment','accept','return')
       GROUP BY jira_key`,
    );
    const firstPickupMap = new Map<string, number>();
    for (const r of firstPickupRows) {
      firstPickupMap.set(r.jira_key, new Date(r.first_action_at).getTime());
    }

    const now = Date.now();
    const byBreachDate = new Map<string, number>();
    const liveBreaches: Array<{ jira_key: string; first_seen_at: string; team: string | null; deadline: string; hours_overdue: number }> = [];

    for (const state of stateRows) {
      const deadline = deadlineFromWorkingHours(state.first_seen_at, 8);
      const deadlineMs = deadline.getTime();
      if (deadlineMs > now) continue; // still within window

      // If first pickup happened before the deadline, no breach
      const pickupMs = firstPickupMap.get(state.jira_key);
      if (pickupMs !== undefined && pickupMs <= deadlineMs) continue;

      // Bucket by the calendar date the deadline fell on
      const breachDate = new Date(deadlineMs).toISOString().slice(0, 10);
      byBreachDate.set(breachDate, (byBreachDate.get(breachDate) || 0) + 1);

      // Live breach = no pickup yet AND status is still active/pending
      const stillActive = state.status !== 'accepted' && state.status !== 'returned' && pickupMs === undefined;
      if (stillActive) {
        liveBreaches.push({
          jira_key: state.jira_key,
          first_seen_at: state.first_seen_at,
          team: state.team,
          deadline: deadline.toISOString(),
          hours_overdue: Math.round((now - deadlineMs) / 3_600_000 * 10) / 10,
        });
      }
    }

    const todayDate = new Date().toISOString().slice(0, 10);
    const unpickedToday = byBreachDate.get(todayDate) || 0;

    const history14d: Array<{ date: string; count: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      history14d.push({ date: iso, count: byBreachDate.get(iso) || 0 });
    }

    liveBreaches.sort((a, b) => b.hours_overdue - a.hours_overdue);

    const unpickedKpi = {
      today: unpickedToday,
      currentlyBreached: liveBreaches.length,
      history14d,
      liveBreaches: liveBreaches.slice(0, 25),
    };

    return {
      queue,
      today,
      week,
      allTime,
      averages: {
        acceptanceRatePct,
        avgTimeToClaimMinutes,
        avgTimeToDecisionMinutes,
        oldestPendingHours,
      },
      perDeveloper,
      arrivals14d,
      decisions14d,
      perTeam,
      unpickedKpi,
    };
  }
}
