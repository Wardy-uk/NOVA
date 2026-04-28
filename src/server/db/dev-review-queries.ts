import { query, queryOne, execute, executeAndGetId } from '../services/database.js';

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
  work_item_key: string | null;
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

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Run a single-row aggregate query and return the first column as a number. */
  private async scalar(sql: string, params: (string | number)[] = []): Promise<number> {
    const row = await queryOne<Record<string, unknown>>(sql, params);
    if (!row) return 0;
    const first = Object.values(row)[0];
    return typeof first === 'number' ? first : Number(first ?? 0);
  }

  /** Run an aggregate query returning an array of rows. */
  private async rows<T>(sql: string, params: (string | number)[] = []): Promise<T[]> {
    return query<T>(sql, params);
  }

  // ── State ────────────────────────────────────────────────────────────────

  /** Get current state for a ticket; returns null if none. */
  async getState(jiraKey: string): Promise<DevReviewState | null> {
    const row = await queryOne<DevReviewState>(
      'SELECT * FROM dev_review_state WHERE jira_key = ?',
      [jiraKey],
    );
    return row ?? null;
  }

  /** Batch-fetch states for multiple keys in one query. */
  async getStatesForKeys(jiraKeys: string[]): Promise<Map<string, DevReviewState>> {
    if (jiraKeys.length === 0) return new Map();
    const placeholders = jiraKeys.map(() => '?').join(',');
    const rows = await query<DevReviewState>(
      `SELECT * FROM dev_review_state WHERE jira_key IN (${placeholders})`,
      jiraKeys,
    );
    const map = new Map<string, DevReviewState>();
    for (const r of rows) map.set(r.jira_key, r);
    return map;
  }

  /** Upsert state — used by the Jira poller when it first sees a T3 ticket. */
  async upsertFromPoll(jiraKey: string, submittedBy: string | null): Promise<void> {
    const existing = await this.getState(jiraKey);
    if (existing) {
      // If ticket was terminal but reappeared in T3 → reopen
      if (existing.status === 'archived' || existing.status === 'returned' || existing.status === 'accepted') {
        await execute(
          `UPDATE dev_review_state
           SET status = CASE WHEN claimed_by_user_id IS NOT NULL THEN 'in_review' ELSE 'pending' END,
               archived_at = NULL,
               last_action_at = GETUTCDATE()
           WHERE jira_key=?`,
          [jiraKey],
        );
      }
      return;
    }
    await execute(
      `INSERT INTO dev_review_state (jira_key, status, submitted_by_username)
       VALUES (?, 'pending', ?)`,
      [jiraKey, submittedBy],
    );
  }

  /** Backfill the submitter username (called by the background watcher after
   *  it resolves the actual escalator from the Jira changelog). */
  async setSubmitter(jiraKey: string, username: string): Promise<void> {
    await execute(
      `UPDATE dev_review_state SET submitted_by_username=? WHERE jira_key=?`,
      [username, jiraKey],
    );
  }

  /** Backfill both submitter AND escalation time from the Jira changelog.
   *  Overwrites first_seen_at so dashboards reflect the actual escalation
   *  time rather than the time NOVA first noticed the ticket on bootstrap. */
  async setEscalationMetadata(jiraKey: string, submitter: string | null, escalationIso: string | null): Promise<void> {
    if (submitter && escalationIso) {
      await execute(
        `UPDATE dev_review_state
         SET submitted_by_username=?, first_seen_at=?
         WHERE jira_key=?`,
        [submitter, escalationIso, jiraKey],
      );
    } else if (submitter) {
      await execute(
        `UPDATE dev_review_state SET submitted_by_username=? WHERE jira_key=?`,
        [submitter, jiraKey],
      );
    } else if (escalationIso) {
      await execute(
        `UPDATE dev_review_state SET first_seen_at=? WHERE jira_key=?`,
        [escalationIso, jiraKey],
      );
    }
  }

  /** Get all keys missing a submitter — for background backfill. */
  async getKeysMissingSubmitter(limit = 25): Promise<string[]> {
    const rows = await query<{ jira_key: string }>(
      `SELECT TOP(?) jira_key FROM dev_review_state WHERE submitted_by_username IS NULL AND status != 'archived'`,
      [limit],
    );
    return rows.map(r => r.jira_key);
  }

  /** Mark as archived when the ticket is no longer at Tier 3. */
  async archive(jiraKey: string): Promise<void> {
    await execute(
      `UPDATE dev_review_state
       SET status='archived', archived_at=GETUTCDATE(), last_action_at=GETUTCDATE()
       WHERE jira_key=? AND status != 'archived'`,
      [jiraKey],
    );
  }

  /** List the active queue (optionally filtered by claim / status / fast-track). */
  async listQueue(filters?: {
    status?: DevReviewState['status'];
    claimedBy?: number | null;
    fastTrackOnly?: boolean;
    includeArchived?: boolean;
  }): Promise<DevReviewState[]> {
    let sql = 'SELECT * FROM dev_review_state WHERE 1=1';
    const params: (string | number)[] = [];
    if (!filters?.includeArchived) sql += " AND status NOT IN ('archived','accepted','returned')";
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.claimedBy !== undefined) {
      if (filters.claimedBy === null) sql += ' AND claimed_by_user_id IS NULL';
      else { sql += ' AND claimed_by_user_id = ?'; params.push(filters.claimedBy); }
    }
    if (filters?.fastTrackOnly) sql += ' AND fast_track = 1';
    sql += ' ORDER BY fast_track DESC, last_action_at DESC';
    return query<DevReviewState>(sql, params);
  }

  async claim(jiraKey: string, userId: number): Promise<void> {
    await execute(
      `UPDATE dev_review_state
       SET claimed_by_user_id=?, claimed_at=GETUTCDATE(),
           status = CASE WHEN status='pending' THEN 'in_review' ELSE status END,
           last_action_at=GETUTCDATE()
       WHERE jira_key=?`,
      [userId, jiraKey],
    );
  }

  async unclaim(jiraKey: string): Promise<void> {
    await execute(
      `UPDATE dev_review_state
       SET claimed_by_user_id=NULL, claimed_at=NULL, last_action_at=GETUTCDATE()
       WHERE jira_key=?`,
      [jiraKey],
    );
  }

  async setFastTrack(jiraKey: string, on: boolean): Promise<void> {
    await execute(
      `UPDATE dev_review_state SET fast_track=?, last_action_at=GETUTCDATE() WHERE jira_key=?`,
      [on ? 1 : 0, jiraKey],
    );
  }

  async setPriority(jiraKey: string, priority: 'low' | 'normal' | 'high'): Promise<void> {
    await execute(
      `UPDATE dev_review_state SET nova_priority=?, last_action_at=GETUTCDATE() WHERE jira_key=?`,
      [priority, jiraKey],
    );
  }

  async markAccepted(jiraKey: string, workItemKey?: string | null): Promise<void> {
    await execute(
      `UPDATE dev_review_state
       SET status='accepted', accepted_at=GETUTCDATE(), last_action_at=GETUTCDATE(),
           work_item_key=ISNULL(?, work_item_key)
       WHERE jira_key=?`,
      [workItemKey ?? null, jiraKey],
    );
  }

  /** Backfill team from the Nurtur Product field on each queue sync. */
  async setTeam(jiraKey: string, team: string): Promise<void> {
    await execute(
      `UPDATE dev_review_state SET team=? WHERE jira_key=? AND (team IS NULL OR team != ?)`,
      [team, jiraKey, team],
    );
  }

  /** Generic status update — used for the waiting_on_assignee round-trip. */
  async setStatus(jiraKey: string, status: DevReviewState['status']): Promise<void> {
    await execute(
      `UPDATE dev_review_state SET status=?, last_action_at=GETUTCDATE() WHERE jira_key=?`,
      [status, jiraKey],
    );
  }

  async markReturned(jiraKey: string): Promise<void> {
    await execute(
      `UPDATE dev_review_state
       SET status='returned', returned_at=GETUTCDATE(), last_action_at=GETUTCDATE()
       WHERE jira_key=?`,
      [jiraKey],
    );
  }

  // ── Thread ───────────────────────────────────────────────────────────────

  async addThreadEntry(entry: {
    jira_key: string;
    user_id: number;
    user_display: string;
    kind: DevReviewThreadEntry['kind'];
    body?: string;
    meta?: Record<string, unknown>;
    syncState?: DevReviewThreadEntry['jira_sync_state'];
  }): Promise<number> {
    const id = await executeAndGetId(
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
    return id;
  }

  async getThread(jiraKey: string): Promise<DevReviewThreadEntry[]> {
    return query<DevReviewThreadEntry>(
      'SELECT * FROM dev_review_thread WHERE jira_key = ? ORDER BY created_at DESC, id DESC',
      [jiraKey],
    );
  }

  async markThreadSynced(id: number, jiraCommentId: string | null): Promise<void> {
    await execute(
      `UPDATE dev_review_thread SET jira_sync_state='synced', jira_comment_id=?, jira_sync_error=NULL WHERE id=?`,
      [jiraCommentId, id],
    );
  }

  /** Insert an externally-sourced Jira comment into the thread. Used by the
   *  watcher when an agent replies in Jira directly — the entry is created
   *  already-synced with the Jira comment ID set so we don't re-import it. */
  async addExternalJiraComment(entry: {
    jira_key: string;
    author_display: string;
    body: string;
    jira_comment_id: string;
    author_account_id?: string;
    internal?: boolean;
  }): Promise<void> {
    await execute(
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
  }

  /** Check whether a given Jira comment ID has already been recorded in the
   *  thread for a ticket — used by the comment watcher to avoid duplicates. */
  async hasJiraComment(jiraKey: string, jiraCommentId: string): Promise<boolean> {
    const row = await queryOne<{ n: number }>(
      `SELECT TOP(1) 1 AS n FROM dev_review_thread WHERE jira_key = ? AND jira_comment_id = ?`,
      [jiraKey, jiraCommentId],
    );
    return !!row;
  }

  /** Batch-fetch all known Jira comment IDs for a ticket — avoids N+1 hasJiraComment calls. */
  async getKnownJiraCommentIds(jiraKey: string): Promise<Set<string>> {
    const rows = await query<{ jira_comment_id: string }>(
      `SELECT jira_comment_id FROM dev_review_thread WHERE jira_key = ? AND jira_comment_id IS NOT NULL`,
      [jiraKey],
    );
    return new Set(rows.map(r => r.jira_comment_id));
  }

  /** Get all keys currently in an active review state — used by the comment
   *  watcher to know which tickets to poll for new Jira comments. */
  async getActiveKeys(): Promise<string[]> {
    const rows = await query<{ jira_key: string }>(
      `SELECT jira_key FROM dev_review_state WHERE status NOT IN ('archived','accepted','returned')`,
    );
    return rows.map(r => r.jira_key);
  }

  async markThreadSyncFailed(id: number, error: string): Promise<void> {
    await execute(
      `UPDATE dev_review_thread SET jira_sync_state='failed', jira_sync_error=? WHERE id=?`,
      [error.slice(0, 500), id],
    );
  }

  /** Delete stale failed thread entries for a ticket — used after a
   *  successful retry so the activity panel doesn't show ghost duplicates
   *  from earlier failed attempts. */
  async purgeFailedThreadEntries(jiraKey: string, excludeId?: number): Promise<number> {
    const countRow = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM dev_review_thread
       WHERE jira_key = ? AND jira_sync_state = 'failed'${excludeId ? ' AND id != ?' : ''}`,
      excludeId ? [jiraKey, excludeId] : [jiraKey],
    );
    const count = countRow?.n ?? 0;
    if (count > 0) {
      await execute(
        `DELETE FROM dev_review_thread
         WHERE jira_key = ? AND jira_sync_state = 'failed'${excludeId ? ' AND id != ?' : ''}`,
        excludeId ? [jiraKey, excludeId] : [jiraKey],
      );
    }
    return count;
  }

  // ── Outbox ───────────────────────────────────────────────────────────────

  async addOutbox(entry: { jira_key: string; op: DevReviewOutboxEntry['op']; payload: Record<string, unknown> }): Promise<number> {
    const id = await executeAndGetId(
      `INSERT INTO dev_review_outbox (jira_key, op, payload_json) VALUES (?, ?, ?)`,
      [entry.jira_key, entry.op, JSON.stringify(entry.payload)],
    );
    return id;
  }

  async pendingOutbox(limit = 20): Promise<DevReviewOutboxEntry[]> {
    return query<DevReviewOutboxEntry>(
      `SELECT TOP(?) * FROM dev_review_outbox WHERE status='pending' AND attempts < 5 ORDER BY created_at ASC`,
      [limit],
    );
  }

  async markOutboxDone(id: number): Promise<void> {
    await execute(
      `UPDATE dev_review_outbox SET status='done', processed_at=GETUTCDATE() WHERE id=?`,
      [id],
    );
  }

  async bumpOutboxFailure(id: number, error: string): Promise<void> {
    await execute(
      `UPDATE dev_review_outbox
       SET attempts = attempts + 1,
           last_error = ?,
           status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
           processed_at = CASE WHEN attempts + 1 >= 5 THEN GETUTCDATE() ELSE processed_at END
       WHERE id=?`,
      [error.slice(0, 500), id],
    );
  }

  // ── Dashboard aggregations ────────────────────────────────────────────────

  /** Top-level snapshot for the Dev Review dashboard. All times in server local TZ. */
  async getDashboard(): Promise<{
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
  }> {
    // ── Queue + counts in a single scan ──────────────────────────────────
    const [countsRow] = await this.rows<Record<string, number>>(
      `SELECT
        SUM(CASE WHEN status NOT IN ('archived','accepted','returned') THEN 1 ELSE 0 END) AS q_total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS q_pending,
        SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) AS q_in_review,
        SUM(CASE WHEN fast_track = 1 AND status NOT IN ('archived','accepted','returned') THEN 1 ELSE 0 END) AS q_fast_track,
        SUM(CASE WHEN claimed_by_user_id IS NULL AND status NOT IN ('archived','accepted','returned') THEN 1 ELSE 0 END) AS q_unclaimed,
        SUM(CASE WHEN CAST(first_seen_at AS DATE) = CAST(GETDATE() AS DATE) AND status != 'archived' THEN 1 ELSE 0 END) AS today_new,
        SUM(CASE WHEN CAST(accepted_at AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS today_accepted,
        SUM(CASE WHEN CAST(returned_at AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS today_returned,
        SUM(CASE WHEN first_seen_at >= DATEADD(day, -7, GETUTCDATE()) AND status != 'archived' THEN 1 ELSE 0 END) AS week_new,
        SUM(CASE WHEN accepted_at >= DATEADD(day, -7, GETUTCDATE()) THEN 1 ELSE 0 END) AS week_accepted,
        SUM(CASE WHEN returned_at >= DATEADD(day, -7, GETUTCDATE()) THEN 1 ELSE 0 END) AS week_returned,
        SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS all_accepted,
        SUM(CASE WHEN returned_at IS NOT NULL THEN 1 ELSE 0 END) AS all_returned
       FROM dev_review_state`,
    );
    const c = countsRow ?? {} as Record<string, number>;

    const queueObj = {
      total: c.q_total ?? 0,
      pending: c.q_pending ?? 0,
      in_review: c.q_in_review ?? 0,
      fast_track: c.q_fast_track ?? 0,
      unclaimed: c.q_unclaimed ?? 0,
    };

    const today = {
      new: c.today_new ?? 0,
      accepted: c.today_accepted ?? 0,
      returned: c.today_returned ?? 0,
      processed: (c.today_accepted ?? 0) + (c.today_returned ?? 0),
    };

    const week = {
      new: c.week_new ?? 0,
      accepted: c.week_accepted ?? 0,
      returned: c.week_returned ?? 0,
    };

    const allTime = {
      accepted: c.all_accepted ?? 0,
      returned: c.all_returned ?? 0,
    };

    // ── Averages + per-developer + sparklines (parallelized) ────────────
    const decisionTotal = allTime.accepted + allTime.returned;
    const acceptanceRatePct =
      decisionTotal > 0 ? Math.round((allTime.accepted / decisionTotal) * 1000) / 10 : null;

    const [
      avgTimeToClaimSec,
      avgDecisionSec,
      oldestSec,
      claimedRows,
      threadCounts,
      arrivals14d,
      decisionRowsByDay,
      teamQueueRows,
      teamDecisionRows,
      stateRows,
      firstPickupRows,
    ] = await Promise.all([
      this.scalar(
        `SELECT AVG(DATEDIFF(second, first_seen_at, claimed_at))
         FROM dev_review_state
         WHERE claimed_at IS NOT NULL AND first_seen_at IS NOT NULL`,
      ),
      this.scalar(
        `SELECT AVG(DATEDIFF(second, claimed_at, COALESCE(accepted_at, returned_at)))
         FROM dev_review_state
         WHERE claimed_at IS NOT NULL AND (accepted_at IS NOT NULL OR returned_at IS NOT NULL)`,
      ),
      this.scalar(
        `SELECT MAX(DATEDIFF(second, first_seen_at, GETUTCDATE()))
         FROM dev_review_state
         WHERE status NOT IN ('archived','accepted','returned')`,
      ),
      this.rows<{ user_id: number; display: string | null; cnt: number }>(
        `SELECT s.claimed_by_user_id AS user_id,
                COALESCE(u.display_name, u.username) AS display,
                COUNT(*) AS cnt
         FROM dev_review_state s
         LEFT JOIN users u ON u.id = s.claimed_by_user_id
         WHERE s.claimed_by_user_id IS NOT NULL AND s.status NOT IN ('archived','accepted','returned')
         GROUP BY s.claimed_by_user_id, u.display_name, u.username`,
      ),
      this.rows<{ user_id: number; display: string; kind: string; total: number; today: number; week: number }>(
        `SELECT user_id, user_display AS display, kind,
                COUNT(*) AS total,
                SUM(CASE WHEN CAST(created_at AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS today,
                SUM(CASE WHEN created_at >= DATEADD(day, -7, GETUTCDATE()) THEN 1 ELSE 0 END) AS week
         FROM dev_review_thread
         WHERE kind IN ('accept','return')
         GROUP BY user_id, user_display, kind`,
      ),
      this.rows<{ date: string; count: number }>(
        `SELECT CONVERT(varchar, CAST(first_seen_at AS DATE), 23) AS date, COUNT(*) AS count
         FROM dev_review_state
         WHERE first_seen_at >= DATEADD(day, -14, GETUTCDATE()) AND status != 'archived'
         GROUP BY CAST(first_seen_at AS DATE)
         ORDER BY CAST(first_seen_at AS DATE) ASC`,
      ),
      this.rows<{ date: string; kind: string; cnt: number }>(
        `SELECT CONVERT(varchar, CAST(created_at AS DATE), 23) AS date, kind, COUNT(*) AS cnt
         FROM dev_review_thread
         WHERE kind IN ('accept','return') AND created_at >= DATEADD(day, -14, GETUTCDATE())
         GROUP BY CAST(created_at AS DATE), kind
         ORDER BY CAST(created_at AS DATE) ASC`,
      ),
      this.rows<{ team: string; in_queue: number; waiting: number }>(
        `SELECT COALESCE(team, 'Unassigned') AS team,
                SUM(CASE WHEN status NOT IN ('archived','accepted','returned','waiting_on_assignee') THEN 1 ELSE 0 END) AS in_queue,
                SUM(CASE WHEN status = 'waiting_on_assignee' THEN 1 ELSE 0 END) AS waiting
         FROM dev_review_state
         WHERE status NOT IN ('archived')
         GROUP BY COALESCE(team, 'Unassigned')`,
      ),
      this.rows<{ team: string; kind: string; total: number; week: number }>(
        `SELECT COALESCE(s.team, 'Unassigned') AS team, t.kind,
                COUNT(*) AS total,
                SUM(CASE WHEN t.created_at >= DATEADD(day, -7, GETUTCDATE()) THEN 1 ELSE 0 END) AS week
         FROM dev_review_thread t
         LEFT JOIN dev_review_state s ON s.jira_key = t.jira_key
         WHERE t.kind IN ('accept','return')
         GROUP BY COALESCE(s.team, 'Unassigned'), t.kind`,
      ),
      this.rows<{ jira_key: string; first_seen_at: string; team: string | null; status: string }>(
        `SELECT jira_key, first_seen_at, team, status
         FROM dev_review_state
         WHERE status != 'archived' AND first_seen_at IS NOT NULL`,
      ),
      this.rows<{ jira_key: string; first_action_at: string }>(
        `SELECT jira_key, MIN(created_at) AS first_action_at
         FROM dev_review_thread
         WHERE kind IN ('comment','accept','return')
         GROUP BY jira_key`,
      ),
    ]);

    const avgTimeToClaimMinutes = avgTimeToClaimSec > 0 ? Math.round(avgTimeToClaimSec / 60) : null;
    const avgTimeToDecisionMinutes = avgDecisionSec > 0 ? Math.round(avgDecisionSec / 60) : null;
    const oldestPendingHours = oldestSec > 0 ? Math.round(oldestSec / 3600) : null;

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
        user_id: c.user_id, display: c.display || `User #${c.user_id}`,
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

    // ── 14-day sparklines (data already fetched above) ───────────────────
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

    // ── Per team breakdown (data already fetched above) ────────────────
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

    // ── Unpicked KPI (data already fetched above) ──────────────────────
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
      queue: queueObj,
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
