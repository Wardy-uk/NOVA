import type { Database } from 'sql.js';

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
  constructor(private db: Database) {}

  log(userId: number, entityType: string, entityId: string, action: string, changes?: Record<string, unknown>): void {
    this.db.run(
      `INSERT INTO audit_log (user_id, entity_type, entity_id, action, changes_json) VALUES (?, ?, ?, ?, ?)`,
      [userId, entityType, entityId, action, changes ? JSON.stringify(changes) : null]
    );
  }

  query(filters: {
    entity_type?: string;
    entity_id?: string;
    user_id?: number;
    limit?: number;
    offset?: number;
  }): AuditEntry[] {
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
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const stmt = this.db.prepare(
      `SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON a.user_id = u.id ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
    );
    params.push(limit, offset);
    stmt.bind(params);

    const results: AuditEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      results.push({
        id: row.id as number,
        user_id: row.user_id as number,
        username: (row.username as string) ?? null,
        entity_type: row.entity_type as string,
        entity_id: row.entity_id as string,
        action: row.action as string,
        changes_json: (row.changes_json as string) ?? null,
        created_at: row.created_at as string,
      });
    }
    stmt.free();
    return results;
  }

  count(filters: { entity_type?: string; entity_id?: string }): number {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.entity_type) { conditions.push('entity_type = ?'); params.push(filters.entity_type); }
    if (filters.entity_id) { conditions.push('entity_id = ?'); params.push(filters.entity_id); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = this.db.exec(`SELECT COUNT(*) as c FROM audit_log ${where}`, params);
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }
}
