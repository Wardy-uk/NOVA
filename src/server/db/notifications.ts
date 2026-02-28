import type { Database } from 'sql.js';

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export class NotificationQueries {
  constructor(private db: Database) {}

  getForUser(userId: number, limit: number = 20): Notification[] {
    const stmt = this.db.prepare(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    );
    stmt.bind([userId, limit]);
    const results: Notification[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as Notification);
    stmt.free();
    return results;
  }

  getUnreadCount(userId: number): number {
    const stmt = this.db.prepare(
      `SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_at IS NULL`
    );
    stmt.bind([userId]);
    let count = 0;
    if (stmt.step()) count = (stmt.getAsObject() as Record<string, unknown>).c as number;
    stmt.free();
    return count;
  }

  markRead(id: number, userId: number): boolean {
    this.db.run(
      `UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    return this.db.getRowsModified() > 0;
  }

  markAllRead(userId: number): number {
    this.db.run(
      `UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`,
      [userId]
    );
    return this.db.getRowsModified();
  }

  create(n: { user_id: number; type: string; title: string; message?: string; entity_type?: string; entity_id?: string }): boolean {
    // Dedup: don't create if same type+entity_id is already unread for this user
    try {
      this.db.run(
        `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [n.user_id, n.type, n.title, n.message ?? null, n.entity_type ?? null, n.entity_id ?? null]
      );
      return true;
    } catch {
      // Unique constraint violation — duplicate unread notification
      return false;
    }
  }
}
