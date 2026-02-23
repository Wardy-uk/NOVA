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

  getAllIncludingDone(): Task[] {
    const stmt = this.db.prepare(`SELECT * FROM tasks ORDER BY updated_at DESC`);
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
    conversation?: string;
  }): number {
    this.db.run(
      `INSERT INTO rituals (type, date, summary_md, planned_items, completed_items, blockers, openai_response_id, conversation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ritual.type,
        ritual.date,
        ritual.summary_md ?? null,
        ritual.planned_items ?? null,
        ritual.completed_items ?? null,
        ritual.blockers ?? null,
        ritual.openai_response_id ?? null,
        ritual.conversation ?? null,
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

// ---------- Delivery Entries ----------

export interface DeliveryEntry {
  id: number;
  product: string;
  account: string;
  status: string;
  onboarder: string | null;
  order_date: string | null;
  go_live_date: string | null;
  predicted_delivery: string | null;
  branches: number | null;
  mrr: number | null;
  incremental: number | null;
  licence_fee: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class DeliveryQueries {
  constructor(private db: Database) {}

  getAll(product?: string): DeliveryEntry[] {
    let sql = `SELECT * FROM delivery_entries`;
    const params: string[] = [];
    if (product) {
      sql += ` WHERE product = ?`;
      params.push(product);
    }
    sql += ` ORDER BY created_at DESC`;

    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);

    const entries: DeliveryEntry[] = [];
    while (stmt.step()) {
      entries.push(stmt.getAsObject() as unknown as DeliveryEntry);
    }
    stmt.free();
    return entries;
  }

  getById(id: number): DeliveryEntry | undefined {
    const stmt = this.db.prepare(`SELECT * FROM delivery_entries WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) {
      const entry = stmt.getAsObject() as unknown as DeliveryEntry;
      stmt.free();
      return entry;
    }
    stmt.free();
    return undefined;
  }

  create(entry: Omit<DeliveryEntry, 'id' | 'created_at' | 'updated_at'>): number {
    this.db.run(
      `INSERT INTO delivery_entries (product, account, status, onboarder, order_date, go_live_date,
        predicted_delivery, branches, mrr, incremental, licence_fee, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.product, entry.account, entry.status ?? '',
        entry.onboarder ?? null, entry.order_date ?? null, entry.go_live_date ?? null,
        entry.predicted_delivery ?? null, entry.branches ?? null,
        entry.mrr ?? null, entry.incremental ?? null, entry.licence_fee ?? null,
        entry.notes ?? null,
      ]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  update(id: number, updates: Partial<Omit<DeliveryEntry, 'id' | 'created_at' | 'updated_at'>>): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    this.db.run(`UPDATE delivery_entries SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return this.getById(id) !== undefined;
  }

  delete(id: number): boolean {
    const exists = this.getById(id);
    if (!exists) return false;
    this.db.run(`DELETE FROM delivery_entries WHERE id = ?`, [id]);
    saveDb();
    return true;
  }

  getProducts(): string[] {
    const stmt = this.db.prepare(`SELECT DISTINCT product FROM delivery_entries ORDER BY product`);
    const products: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      products.push(row.product as string);
    }
    stmt.free();
    return products;
  }
}

// ---------- CRM ----------

export type RagStatus = 'red' | 'amber' | 'green';

export interface CrmCustomer {
  id: number;
  name: string;
  company: string | null;
  sector: string | null;
  mrr: number | null;
  owner: string | null;
  rag_status: RagStatus;
  next_review_date: string | null;
  contract_start: string | null;
  contract_end: string | null;
  dynamics_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmReview {
  id: number;
  customer_id: number;
  review_date: string;
  rag_status: RagStatus;
  outcome: string | null;
  actions: string | null;
  reviewer: string | null;
  next_review_date: string | null;
  notes: string | null;
  created_at: string;
}

export class CrmQueries {
  constructor(private db: Database) {}

  // --- Customers ---

  getAllCustomers(filters?: { rag_status?: string; owner?: string; search?: string }): CrmCustomer[] {
    let sql = `SELECT * FROM crm_customers WHERE 1=1`;
    const params: string[] = [];
    if (filters?.rag_status) { sql += ` AND rag_status = ?`; params.push(filters.rag_status); }
    if (filters?.owner) { sql += ` AND owner = ?`; params.push(filters.owner); }
    if (filters?.search) {
      sql += ` AND (name LIKE ? OR company LIKE ?)`;
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    sql += ` ORDER BY CASE rag_status WHEN 'red' THEN 0 WHEN 'amber' THEN 1 WHEN 'green' THEN 2 END, next_review_date ASC`;

    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results: CrmCustomer[] = [];
    while (stmt.step()) { results.push(stmt.getAsObject() as unknown as CrmCustomer); }
    stmt.free();
    return results;
  }

  getCustomerById(id: number): CrmCustomer | undefined {
    const stmt = this.db.prepare(`SELECT * FROM crm_customers WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) { const c = stmt.getAsObject() as unknown as CrmCustomer; stmt.free(); return c; }
    stmt.free();
    return undefined;
  }

  createCustomer(c: Omit<CrmCustomer, 'id' | 'created_at' | 'updated_at'>): number {
    this.db.run(
      `INSERT INTO crm_customers (name, company, sector, mrr, owner, rag_status, next_review_date, contract_start, contract_end, dynamics_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.name, c.company ?? null, c.sector ?? null, c.mrr ?? null, c.owner ?? null,
       c.rag_status ?? 'green', c.next_review_date ?? null, c.contract_start ?? null,
       c.contract_end ?? null, c.dynamics_id ?? null, c.notes ?? null]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateCustomer(id: number, updates: Partial<Omit<CrmCustomer, 'id' | 'created_at' | 'updated_at'>>): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    this.db.run(`UPDATE crm_customers SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return this.getCustomerById(id) !== undefined;
  }

  deleteCustomer(id: number): boolean {
    const exists = this.getCustomerById(id);
    if (!exists) return false;
    this.db.run(`DELETE FROM crm_reviews WHERE customer_id = ?`, [id]);
    this.db.run(`DELETE FROM crm_customers WHERE id = ?`, [id]);
    saveDb();
    return true;
  }

  getOwners(): string[] {
    const stmt = this.db.prepare(`SELECT DISTINCT owner FROM crm_customers WHERE owner IS NOT NULL AND owner != '' ORDER BY owner`);
    const owners: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      if (row.owner) owners.push(row.owner as string);
    }
    stmt.free();
    return owners;
  }

  // --- Reviews ---

  getReviewsForCustomer(customerId: number): CrmReview[] {
    const stmt = this.db.prepare(`SELECT * FROM crm_reviews WHERE customer_id = ? ORDER BY review_date DESC`);
    stmt.bind([customerId]);
    const results: CrmReview[] = [];
    while (stmt.step()) { results.push(stmt.getAsObject() as unknown as CrmReview); }
    stmt.free();
    return results;
  }

  getReviewById(id: number): CrmReview | undefined {
    const stmt = this.db.prepare(`SELECT * FROM crm_reviews WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) { const r = stmt.getAsObject() as unknown as CrmReview; stmt.free(); return r; }
    stmt.free();
    return undefined;
  }

  createReview(r: Omit<CrmReview, 'id' | 'created_at'>): number {
    this.db.run(
      `INSERT INTO crm_reviews (customer_id, review_date, rag_status, outcome, actions, reviewer, next_review_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.customer_id, r.review_date, r.rag_status, r.outcome ?? null, r.actions ?? null,
       r.reviewer ?? null, r.next_review_date ?? null, r.notes ?? null]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    // Propagate RAG + next review to parent customer
    this.db.run(
      `UPDATE crm_customers SET rag_status = ?, next_review_date = COALESCE(?, next_review_date), updated_at = datetime('now') WHERE id = ?`,
      [r.rag_status, r.next_review_date ?? null, r.customer_id]
    );
    saveDb();
    return id;
  }

  updateReview(id: number, updates: Partial<Omit<CrmReview, 'id' | 'created_at'>>): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    params.push(id);
    this.db.run(`UPDATE crm_reviews SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return this.getReviewById(id) !== undefined;
  }

  deleteReview(id: number): boolean {
    const exists = this.getReviewById(id);
    if (!exists) return false;
    this.db.run(`DELETE FROM crm_reviews WHERE id = ?`, [id]);
    saveDb();
    return true;
  }

  getSummary(): { total: number; red: number; amber: number; green: number; overdueReviews: number; totalMrr: number } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN rag_status = 'red' THEN 1 ELSE 0 END) as red,
        SUM(CASE WHEN rag_status = 'amber' THEN 1 ELSE 0 END) as amber,
        SUM(CASE WHEN rag_status = 'green' THEN 1 ELSE 0 END) as green,
        SUM(CASE WHEN next_review_date < date('now') THEN 1 ELSE 0 END) as overdueReviews,
        COALESCE(SUM(mrr), 0) as totalMrr
      FROM crm_customers
    `);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        total: (row.total as number) ?? 0,
        red: (row.red as number) ?? 0,
        amber: (row.amber as number) ?? 0,
        green: (row.green as number) ?? 0,
        overdueReviews: (row.overdueReviews as number) ?? 0,
        totalMrr: (row.totalMrr as number) ?? 0,
      };
    }
    stmt.free();
    return { total: 0, red: 0, amber: 0, green: 0, overdueReviews: 0, totalMrr: 0 };
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
