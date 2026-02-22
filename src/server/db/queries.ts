import type { Database } from 'sql.js';
import type { Task, TaskUpdate } from '../../shared/types.js';
import { saveDb } from './schema.js';

export class TaskQueries {
  constructor(private db: Database) {}

  getAll(filters?: { status?: string; source?: string }): Task[] {
    let sql = `SELECT * FROM tasks WHERE 1=1`;
    const params: string[] = [];

    if (filters?.status) {
      sql += ` AND status = ?`;
      params.push(filters.status);
    }
    if (filters?.source) {
      sql += ` AND source = ?`;
      params.push(filters.source);
    }

    sql += ` AND (snoozed_until IS NULL OR snoozed_until <= datetime('now'))`;
    sql += ` AND status NOT IN ('dismissed', 'done')`;
    sql += ` ORDER BY is_pinned DESC, priority DESC, due_date ASC`;

    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);

    const tasks: Task[] = [];
    while (stmt.step()) {
      tasks.push(this.rowToTask(stmt.getAsObject() as Record<string, unknown>));
    }
    stmt.free();
    return tasks;
  }

  getById(id: string): Task | undefined {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`);
    stmt.bind([id]);

    if (stmt.step()) {
      const task = this.rowToTask(stmt.getAsObject() as Record<string, unknown>);
      stmt.free();
      return task;
    }
    stmt.free();
    return undefined;
  }

  upsertFromSource(task: {
    source: string;
    source_id: string;
    source_url?: string;
    title: string;
    description?: string;
    status?: string;
    priority?: number;
    due_date?: string;
    sla_breach_at?: string;
    category?: string;
    raw_data?: unknown;
  }, options?: { deferSave?: boolean }): void {
    const id = `${task.source}:${task.source_id}`;
    this.db.run(
      `INSERT INTO tasks (id, source, source_id, source_url, title, description,
        status, priority, due_date, sla_breach_at, category, raw_data, last_synced, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        due_date = excluded.due_date,
        sla_breach_at = excluded.sla_breach_at,
        category = excluded.category,
        raw_data = excluded.raw_data,
        last_synced = datetime('now'),
        updated_at = datetime('now')`,
      [
        id,
        task.source,
        task.source_id,
        task.source_url ?? null,
        task.title,
        task.description ?? null,
        task.status ?? 'open',
        task.priority ?? 50,
        task.due_date ?? null,
        task.sla_breach_at ?? null,
        task.category ?? null,
        task.raw_data ? JSON.stringify(task.raw_data) : null,
      ]
    );
    if (!options?.deferSave) {
      saveDb();
    }
  }

  deleteStaleBySource(
    source: string,
    freshIds: string[],
    options?: { allowEmpty?: boolean; deferSave?: boolean }
  ): number {
    if (freshIds.length === 0) {
      if (!options?.allowEmpty) {
        return 0;
      }

      // No fresh tasks — delete all for this source
      const countStmt = this.db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE source = ?`);
      countStmt.bind([source]);
      let count = 0;
      if (countStmt.step()) {
        const row = countStmt.getAsObject() as Record<string, unknown>;
        count = (row.c as number) ?? 0;
      }
      countStmt.free();

      this.db.run(`DELETE FROM tasks WHERE source = ?`, [source]);
      if (!options?.deferSave) {
        saveDb();
      }
      return count;
    }
    const placeholders = freshIds.map(() => '?').join(',');
    const countStmt = this.db.prepare(
      `SELECT COUNT(*) as c FROM tasks WHERE source = ? AND id NOT IN (${placeholders})`
    );
    countStmt.bind([source, ...freshIds]);
    let count = 0;
    if (countStmt.step()) {
      const row = countStmt.getAsObject() as Record<string, unknown>;
      count = (row.c as number) ?? 0;
    }
    countStmt.free();

    if (count > 0) {
      this.db.run(
        `DELETE FROM tasks WHERE source = ? AND id NOT IN (${placeholders})`,
        [source, ...freshIds]
      );
      if (!options?.deferSave) {
        saveDb();
      }
    }
    return count;
  }

  update(id: string, updates: TaskUpdate): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.is_pinned !== undefined) {
      fields.push('is_pinned = ?');
      params.push(updates.is_pinned ? 1 : 0);
    }
    if (updates.snoozed_until !== undefined) {
      fields.push('snoozed_until = ?');
      params.push(updates.snoozed_until);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      params.push(updates.status);
    }

    if (fields.length === 0) return false;

    fields.push(`updated_at = datetime('now')`);
    params.push(id);

    this.db.run(
      `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`,
      params as (string | number | null)[]
    );
    saveDb();

    // Check if row was actually updated
    const check = this.getById(id);
    return check !== undefined;
  }

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      source: row.source as string,
      source_id: (row.source_id as string) ?? null,
      source_url: (row.source_url as string) ?? null,
      title: row.title as string,
      description: (row.description as string) ?? null,
      status: (row.status as string) ?? 'open',
      priority: (row.priority as number) ?? 50,
      due_date: (row.due_date as string) ?? null,
      sla_breach_at: (row.sla_breach_at as string) ?? null,
      category: (row.category as string) ?? null,
      is_pinned: row.is_pinned === 1,
      snoozed_until: (row.snoozed_until as string) ?? null,
      last_synced: (row.last_synced as string) ?? null,
      raw_data: row.raw_data ? JSON.parse(row.raw_data as string) : null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}

// ---------- Rituals ----------

export interface Ritual {
  id: number;
  type: string;
  date: string;
  conversation: string | null;
  summary_md: string | null;
  planned_items: string | null;
  completed_items: string | null;
  blockers: string | null;
  openai_response_id: string | null;
  created_at: string;
}

export class RitualQueries {
  constructor(private db: Database) {}

  create(ritual: {
    type: string;
    date: string;
    summary_md?: string;
    planned_items?: string;
    completed_items?: string;
    blockers?: string;
    openai_response_id?: string;
  }): number {
    this.db.run(
      `INSERT INTO rituals (type, date, summary_md, planned_items, completed_items, blockers, openai_response_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ritual.type,
        ritual.date,
        ritual.summary_md ?? null,
        ritual.planned_items ?? null,
        ritual.completed_items ?? null,
        ritual.blockers ?? null,
        ritual.openai_response_id ?? null,
      ]
    );
    saveDb();
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  getByDate(date: string, type?: string): Ritual[] {
    let sql = `SELECT * FROM rituals WHERE date = ?`;
    const params: string[] = [date];
    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }
    sql += ` ORDER BY created_at DESC`;

    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);

    const rituals: Ritual[] = [];
    while (stmt.step()) {
      rituals.push(this.rowToRitual(stmt.getAsObject() as Record<string, unknown>));
    }
    stmt.free();
    return rituals;
  }

  getRecent(limit: number = 10): Ritual[] {
    const stmt = this.db.prepare(
      `SELECT * FROM rituals ORDER BY date DESC, created_at DESC LIMIT ?`
    );
    stmt.bind([limit]);

    const rituals: Ritual[] = [];
    while (stmt.step()) {
      rituals.push(this.rowToRitual(stmt.getAsObject() as Record<string, unknown>));
    }
    stmt.free();
    return rituals;
  }

  getById(id: number): Ritual | undefined {
    const stmt = this.db.prepare(`SELECT * FROM rituals WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) {
      const ritual = this.rowToRitual(stmt.getAsObject() as Record<string, unknown>);
      stmt.free();
      return ritual;
    }
    stmt.free();
    return undefined;
  }

  update(id: number, updates: {
    summary_md?: string;
    planned_items?: string;
    completed_items?: string;
    blockers?: string;
  }): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.summary_md !== undefined) { fields.push('summary_md = ?'); params.push(updates.summary_md); }
    if (updates.planned_items !== undefined) { fields.push('planned_items = ?'); params.push(updates.planned_items); }
    if (updates.completed_items !== undefined) { fields.push('completed_items = ?'); params.push(updates.completed_items); }
    if (updates.blockers !== undefined) { fields.push('blockers = ?'); params.push(updates.blockers); }

    if (fields.length === 0) return false;

    params.push(id);
    this.db.run(`UPDATE rituals SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return true;
  }

  private rowToRitual(row: Record<string, unknown>): Ritual {
    return {
      id: row.id as number,
      type: row.type as string,
      date: row.date as string,
      conversation: (row.conversation as string) ?? null,
      summary_md: (row.summary_md as string) ?? null,
      planned_items: (row.planned_items as string) ?? null,
      completed_items: (row.completed_items as string) ?? null,
      blockers: (row.blockers as string) ?? null,
      openai_response_id: (row.openai_response_id as string) ?? null,
      created_at: row.created_at as string,
    };
  }
}

export class SettingsQueries {
  constructor(private db: Database) {}

  get(key: string): string | null {
    const stmt = this.db.prepare(`SELECT value FROM settings WHERE key = ?`);
    stmt.bind([key]);

    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return (row.value as string) ?? null;
    }
    stmt.free();
    return null;
  }

  set(key: string, value: string): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, value]
    );
    saveDb();
  }

  getAll(): Record<string, string> {
    const stmt = this.db.prepare(`SELECT key, value FROM settings`);
    const result: Record<string, string> = {};

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      result[row.key as string] = row.value as string;
    }
    stmt.free();
    return result;
  }
}
