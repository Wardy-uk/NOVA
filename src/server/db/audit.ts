import { query, queryOne, execute } from '../services/database.js';

export interface AuditEntry {
  id: number;
  user_id: number;
  username: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  changes_json: string | null;
  created_at: string;
}

export class AuditQueries {
  async log(userId: number, entityType: string, entityId: string, action: string, changes?: Record<string, unknown>): Promise<void> {
    await execute(
      `INSERT INTO audit_log (user_id, entity_type, entity_id, action, changes_json, created_at) VALUES (?, ?, ?, ?, ?, GETUTCDATE())`,
      [userId, entityType, entityId, action, changes ? JSON.stringify(changes) : null]
    );
  }

  async query(filters: {
    entity_type?: string;
    entity_id?: string;
    user_id?: number;
    limit?: number;
    offset?: number;
  }): Promise<AuditEntry[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.entity_type) {
      conditions.push('a.entity_type = ?');
      params.push(filters.entity_type);
    }
    if (filters.entity_id) {
      conditions.push('a.entity_id = ?');
      params.push(filters.entity_id);
    }
    if (filters.user_id) {
      conditions.push('a.user_id = ?');
      params.push(filters.user_id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;

    const rows = await query<AuditEntry>(
      `SELECT a.*, COALESCE(u.display_name, u.username) AS username FROM audit_log a LEFT JOIN users u ON a.user_id = u.id ${where} ORDER BY a.created_at DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
      [...params, offset, limit]
    );
    return rows;
  }

  async count(filters: { entity_type?: string; entity_id?: string }): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.entity_type) { conditions.push('entity_type = ?'); params.push(filters.entity_type); }
    if (filters.entity_id) { conditions.push('entity_id = ?'); params.push(filters.entity_id); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM audit_log ${where}`, params);
    return result?.c ?? 0;
  }
}
