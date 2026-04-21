import { query, queryOne, execute, executeAndGetId } from '../services/database.js';

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
  async getForUser(userId: number, limit: number = 20): Promise<Notification[]> {
    return query<Notification>(
      `SELECT TOP(?) * FROM notifications WHERE user_id = ? ORDER BY created_at DESC`,
      [limit, userId]
    );
  }

  async getUnreadCount(userId: number): Promise<number> {
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_at IS NULL`,
      [userId]
    );
    return row?.c ?? 0;
  }

  async markRead(id: number, userId: number): Promise<boolean> {
    const result = await execute(
      `UPDATE notifications SET read_at = GETUTCDATE() WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    return (result.rowsAffected ?? 0) > 0;
  }

  async markAllRead(userId: number): Promise<number> {
    const result = await execute(
      `UPDATE notifications SET read_at = GETUTCDATE() WHERE user_id = ? AND read_at IS NULL`,
      [userId]
    );
    return result.rowsAffected ?? 0;
  }

  async create(n: { user_id: number; type: string; title: string; message?: string; entity_type?: string; entity_id?: string }): Promise<boolean> {
    // Dedup: skip if same (user, type, entity_id) was created in the last 24 hours
    // (regardless of read status — prevents re-creating notifications the user just dismissed)
    if (n.entity_id) {
      const existing = await queryOne<{ x: number }>(
        `SELECT 1 as x FROM notifications WHERE user_id = ? AND type = ? AND entity_id = ? AND created_at > DATEADD(day, -1, GETUTCDATE())`,
        [n.user_id, n.type, n.entity_id]
      );
      if (existing) return false;
    }

    try {
      await execute(
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
