import type { Database } from 'sql.js';
import type { Task, TaskUpdate } from '../../shared/types.js';
import { saveDb } from './schema.js';

export class TaskQueries {
  constructor(private db: Database) {}

  getAll(filters?: { status?: string; source?: string; userId?: number }): Task[] {
    const useUserPins = filters?.userId != null;
    let sql: string;
    if (useUserPins) {
      sql = `SELECT t.*, CASE WHEN p.task_id IS NOT NULL THEN 1 ELSE 0 END as is_pinned
             FROM tasks t LEFT JOIN user_task_pins p ON t.id = p.task_id AND p.user_id = ?
             WHERE 1=1`;
    } else {
      sql = `SELECT * FROM tasks WHERE 1=1`;
    }
    const params: (string | number)[] = [];
    if (useUserPins) params.push(filters!.userId!);

    if (filters?.status) {
      sql += ` AND ${useUserPins ? 't.' : ''}status = ?`;
      params.push(filters.status);
    }
    if (filters?.source) {
      sql += ` AND ${useUserPins ? 't.' : ''}source = ?`;
      params.push(filters.source);
    }

    if (useUserPins) {
      sql += ` AND (t.snoozed_until IS NULL OR t.snoozed_until <= datetime('now'))`;
      sql += ` AND t.status NOT IN ('dismissed', 'done')`;
    } else {
      sql += ` AND (snoozed_until IS NULL OR snoozed_until <= datetime('now'))`;
      sql += ` AND status NOT IN ('dismissed', 'done')`;
    }
    sql += useUserPins
      ? ` ORDER BY (CASE WHEN p.task_id IS NOT NULL THEN 1 ELSE 0 END) DESC, t.priority DESC, t.due_date ASC`
      : ` ORDER BY is_pinned DESC, priority DESC, due_date ASC`;

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
    transient?: boolean;
  }, options?: { deferSave?: boolean }): void {
    const id = `${task.source}:${task.source_id}`;
    this.db.run(
      `INSERT INTO tasks (id, source, source_id, source_url, title, description,
        status, priority, due_date, sla_breach_at, category, raw_data, transient, last_synced, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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
        transient = excluded.transient,
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
        task.transient ? 1 : 0,
      ]
    );
    if (!options?.deferSave) {
      saveDb();
    }
  }

  deleteTransientTasks(): number {
    const countResult = this.db.exec('SELECT COUNT(*) FROM tasks WHERE transient = 1');
    const count = (countResult[0]?.values[0]?.[0] as number) ?? 0;
    if (count > 0) {
      this.db.run('DELETE FROM tasks WHERE transient = 1');
      saveDb();
    }
    return count;
  }

  deleteStaleBySource(
    source: string,
    freshIds: string[],
    options?: { allowEmpty?: boolean; deferSave?: boolean }
  ): number {
    // Milestone tasks are managed by the milestone system, not external sync
    if (source === 'milestone') return 0;

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

  update(id: string, updates: TaskUpdate, userId?: number): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];

    // Handle per-user pin via user_task_pins table
    if (updates.is_pinned !== undefined && userId != null) {
      if (updates.is_pinned) {
        this.db.run(
          `INSERT OR IGNORE INTO user_task_pins (user_id, task_id) VALUES (?, ?)`,
          [userId, id]
        );
      } else {
        this.db.run(
          `DELETE FROM user_task_pins WHERE user_id = ? AND task_id = ?`,
          [userId, id]
        );
      }
    } else if (updates.is_pinned !== undefined) {
      // Fallback: legacy global pin
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

    if (fields.length > 0) {
      fields.push(`updated_at = datetime('now')`);
      params.push(id);
      this.db.run(
        `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`,
        params as (string | number | null)[]
      );
    }

    saveDb();
    const check = this.getById(id);
    return check !== undefined;
  }

  deleteBySourcePrefix(source: string, sourceIdPrefix: string): number {
    const countStmt = this.db.prepare(
      `SELECT COUNT(*) as c FROM tasks WHERE source = ? AND source_id LIKE ?`
    );
    countStmt.bind([source, sourceIdPrefix + '%']);
    let count = 0;
    if (countStmt.step()) {
      count = (countStmt.getAsObject() as Record<string, unknown>).c as number;
    }
    countStmt.free();
    if (count > 0) {
      this.db.run(`DELETE FROM tasks WHERE source = ? AND source_id LIKE ?`, [source, sourceIdPrefix + '%']);
      saveDb();
    }
    return count;
  }

  deleteAllBySource(source: string): number {
    const countStmt = this.db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE source = ?`);
    countStmt.bind([source]);
    let count = 0;
    if (countStmt.step()) {
      count = (countStmt.getAsObject() as Record<string, unknown>).c as number;
    }
    countStmt.free();
    if (count > 0) {
      this.db.run(`DELETE FROM tasks WHERE source = ?`, [source]);
      saveDb();
    }
    return count;
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
    user_id?: number;
  }): number {
    this.db.run(
      `INSERT INTO rituals (type, date, summary_md, planned_items, completed_items, blockers, openai_response_id, conversation, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ritual.type,
        ritual.date,
        ritual.summary_md ?? null,
        ritual.planned_items ?? null,
        ritual.completed_items ?? null,
        ritual.blockers ?? null,
        ritual.openai_response_id ?? null,
        ritual.conversation ?? null,
        ritual.user_id ?? null,
      ]
    );
    saveDb();
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  getByDate(date: string, type?: string, userId?: number): Ritual[] {
    let sql = `SELECT * FROM rituals WHERE date = ?`;
    const params: (string | number)[] = [date];
    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }
    if (userId != null) {
      sql += ` AND (user_id = ? OR user_id IS NULL)`;
      params.push(userId);
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
  onboarding_id: string | null;
  product: string;
  account: string;
  status: string;
  onboarder: string | null;
  order_date: string | null;
  go_live_date: string | null;
  predicted_delivery: string | null;
  training_date: string | null;
  branches: number | null;
  mrr: number | null;
  incremental: number | null;
  licence_fee: number | null;
  sale_type: string | null;
  is_starred: number;
  star_scope: 'me' | 'all';
  starred_by: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Brand prefix mapping — product name → short code for onboarding IDs
const BRAND_PREFIXES: Record<string, string> = {
  'BYM': 'BYM',
  'KYM': 'KYM',
  'Yomdel': 'YMD',
  'Leadpro': 'LDP',
  'TPJ': 'TPJ',
  'Voice AI': 'VAI',
  'GRS': 'GRS',
  'Undeliverable': 'UND',
  'SB - Web': 'SBW',
  'SB - DM': 'SBD',
  'Google Ad Spend': 'GAS',
  'Google SEO': 'GSO',
  'Guild Package': 'GLD',
};

function getBrandPrefix(product: string): string {
  if (BRAND_PREFIXES[product]) return BRAND_PREFIXES[product];
  // Fallback: first 3 uppercase chars
  return product.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() || 'UNK';
}

export class DeliveryQueries {
  constructor(private db: Database) {}

  /** Get the next available onboarding ID for a product, e.g. BYM0001 */
  getNextOnboardingId(product: string): string {
    const prefix = getBrandPrefix(product);
    const stmt = this.db.prepare(
      `SELECT onboarding_id FROM delivery_entries WHERE onboarding_id LIKE ? ORDER BY onboarding_id DESC LIMIT 1`
    );
    stmt.bind([`${prefix}%`]);
    let nextNum = 1;
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const lastId = row.onboarding_id as string;
      const numPart = parseInt(lastId.substring(prefix.length), 10);
      if (!isNaN(numPart)) nextNum = numPart + 1;
    }
    stmt.free();
    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  /** Backfill onboarding IDs for all entries that don't have one */
  backfillOnboardingIds(): number {
    const stmt = this.db.prepare(`SELECT id, product FROM delivery_entries WHERE onboarding_id IS NULL ORDER BY id`);
    const entries: Array<{ id: number; product: string }> = [];
    while (stmt.step()) {
      entries.push(stmt.getAsObject() as { id: number; product: string });
    }
    stmt.free();
    let count = 0;
    for (const entry of entries) {
      const newId = this.getNextOnboardingId(entry.product);
      this.db.run(`UPDATE delivery_entries SET onboarding_id = ? WHERE id = ?`, [newId, entry.id]);
      count++;
    }
    if (count > 0) saveDb();
    return count;
  }

  getAll(product?: string): DeliveryEntry[] {
    let sql = `SELECT * FROM delivery_entries`;
    const params: string[] = [];
    if (product) {
      sql += ` WHERE product = ?`;
      params.push(product);
    }
    sql += ` ORDER BY is_starred DESC, created_at DESC`;

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

  findByProductAccount(product: string, account: string): DeliveryEntry | undefined {
    const stmt = this.db.prepare(`SELECT * FROM delivery_entries WHERE product = ? AND account = ? LIMIT 1`);
    stmt.bind([product, account]);
    if (stmt.step()) {
      const entry = stmt.getAsObject() as unknown as DeliveryEntry;
      stmt.free();
      return entry;
    }
    stmt.free();
    return undefined;
  }

  deleteDuplicates(): number {
    // Keep the lowest id per product+account, delete the rest
    const result = this.db.exec(
      `SELECT id FROM delivery_entries WHERE id NOT IN (SELECT MIN(id) FROM delivery_entries GROUP BY product, account)`
    );
    if (!result[0] || result[0].values.length === 0) return 0;
    const dupeIds = result[0].values.map((row: unknown[]) => row[0] as number);
    this.db.run(`DELETE FROM delivery_entries WHERE id IN (${dupeIds.join(',')})`);
    saveDb();
    return dupeIds.length;
  }

  create(entry: Omit<DeliveryEntry, 'id' | 'onboarding_id' | 'created_at' | 'updated_at'> & { onboarding_id?: string | null }): number {
    const onboardingId = entry.onboarding_id || this.getNextOnboardingId(entry.product);
    this.db.run(
      `INSERT INTO delivery_entries (onboarding_id, product, account, status, onboarder, order_date, go_live_date,
        predicted_delivery, training_date, branches, mrr, incremental, licence_fee, sale_type, is_starred, star_scope, starred_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        onboardingId,
        entry.product, entry.account, entry.status ?? '',
        entry.onboarder ?? null, entry.order_date ?? null, entry.go_live_date ?? null,
        entry.predicted_delivery ?? null, entry.training_date ?? null,
        entry.branches ?? null,
        entry.mrr ?? null, entry.incremental ?? null, entry.licence_fee ?? null,
        entry.sale_type ?? null,
        entry.is_starred ?? 0, entry.star_scope ?? 'all', entry.starred_by ?? null,
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

  toggleStar(id: number, userId?: number): boolean {
    const entry = this.getById(id);
    if (!entry) return false;
    const newVal = entry.is_starred ? 0 : 1;
    const params: unknown[] = [newVal];
    let sql = `UPDATE delivery_entries SET is_starred = ?`;
    if (newVal && userId) {
      sql += `, starred_by = ?`;
      params.push(userId);
    }
    if (!newVal) {
      sql += `, starred_by = NULL, star_scope = 'me'`;
    }
    sql += `, updated_at = datetime('now') WHERE id = ?`;
    params.push(id);
    this.db.run(sql, params as (string | number | null)[]);
    saveDb();
    return true;
  }

  /** Entries relevant to the current user's focus:
   *  - starred by me (star_scope='me') or starred for all (star_scope='all')
   *  - onboarder matches me AND has at least one overdue milestone */
  getMyFocus(userId: number, userNames: string[]): DeliveryEntry[] {
    const conditions: string[] = [
      `(de.is_starred = 1 AND (de.starred_by = ? OR de.star_scope = 'all'))`,
    ];
    const params: unknown[] = [userId];

    if (userNames.length > 0) {
      const nameClauses = userNames.map(() => `LOWER(de.onboarder) LIKE ?`);
      conditions.push(`(
        (${nameClauses.join(' OR ')})
        AND EXISTS (
          SELECT 1 FROM delivery_milestones dm
          WHERE dm.delivery_id = de.id AND dm.status != 'complete' AND dm.target_date < date('now')
        )
      )`);
      for (const name of userNames) {
        params.push(`%${name.toLowerCase()}%`);
      }
    }

    const sql = `SELECT de.* FROM delivery_entries de WHERE ${conditions.join(' OR ')} ORDER BY de.is_starred DESC, de.updated_at DESC`;
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | null)[]);

    const entries: DeliveryEntry[] = [];
    while (stmt.step()) {
      entries.push(stmt.getAsObject() as unknown as DeliveryEntry);
    }
    stmt.free();
    return entries;
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

  deleteAllCustomers(): number {
    const count = this.getAllCustomers({}).length;
    this.db.run(`DELETE FROM crm_reviews`);
    this.db.run(`DELETE FROM crm_customers`);
    saveDb();
    return count;
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

// ---------- Users ----------

export interface User {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  password_hash: string;
  role: string;
  auth_provider: string;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
}

export class UserQueries {
  constructor(private db: Database) {}

  getByUsername(username: string): User | undefined {
    const stmt = this.db.prepare(`SELECT * FROM users WHERE username = ?`);
    stmt.bind([username]);
    if (stmt.step()) { const u = stmt.getAsObject() as unknown as User; stmt.free(); return u; }
    stmt.free();
    return undefined;
  }

  getById(id: number): User | undefined {
    const stmt = this.db.prepare(`SELECT * FROM users WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) { const u = stmt.getAsObject() as unknown as User; stmt.free(); return u; }
    stmt.free();
    return undefined;
  }

  getByProviderId(provider: string, providerId: string): User | undefined {
    const stmt = this.db.prepare(`SELECT * FROM users WHERE auth_provider = ? AND provider_id = ?`);
    stmt.bind([provider, providerId]);
    if (stmt.step()) { const u = stmt.getAsObject() as unknown as User; stmt.free(); return u; }
    stmt.free();
    return undefined;
  }

  create(user: { username: string; display_name?: string; email?: string; password_hash: string; role?: string; auth_provider?: string; provider_id?: string }): number {
    this.db.run(
      `INSERT INTO users (username, display_name, email, password_hash, role, auth_provider, provider_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.username, user.display_name ?? null, user.email ?? null, user.password_hash,
       user.role ?? 'viewer', user.auth_provider ?? 'local', user.provider_id ?? null]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  update(id: number, updates: Partial<Omit<User, 'id' | 'created_at'>>): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    this.db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return this.getById(id) !== undefined;
  }

  count(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as c FROM users`);
    let count = 0;
    if (stmt.step()) { count = (stmt.getAsObject() as Record<string, unknown>).c as number; }
    stmt.free();
    return count;
  }

  getAll(): Omit<User, 'password_hash'>[] {
    const stmt = this.db.prepare(`SELECT id, username, display_name, email, role, auth_provider, provider_id, team_id, created_at, updated_at FROM users ORDER BY created_at`);
    const users: Omit<User, 'password_hash'>[] = [];
    while (stmt.step()) { users.push(stmt.getAsObject() as unknown as Omit<User, 'password_hash'>); }
    stmt.free();
    return users;
  }

  delete(id: number): boolean {
    this.db.run(`DELETE FROM users WHERE id = ?`, [id]);
    this.db.run(`DELETE FROM user_settings WHERE user_id = ?`, [id]);
    saveDb();
    return true;
  }
}

// ---------- Teams ----------
export interface Team {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export class TeamQueries {
  constructor(private db: Database) {}

  getAll(): Team[] {
    const stmt = this.db.prepare(`SELECT * FROM teams ORDER BY name`);
    const teams: Team[] = [];
    while (stmt.step()) { teams.push(stmt.getAsObject() as unknown as Team); }
    stmt.free();
    return teams;
  }

  getById(id: number): Team | undefined {
    const stmt = this.db.prepare(`SELECT * FROM teams WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) { const t = stmt.getAsObject() as unknown as Team; stmt.free(); return t; }
    stmt.free();
    return undefined;
  }

  create(name: string, description?: string): number {
    this.db.run(`INSERT INTO teams (name, description) VALUES (?, ?)`, [name, description ?? null]);
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  update(id: number, updates: { name?: string; description?: string }): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (fields.length === 0) return false;
    params.push(id);
    this.db.run(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return true;
  }

  delete(id: number): boolean {
    this.db.run(`UPDATE users SET team_id = NULL WHERE team_id = ?`, [id]);
    this.db.run(`DELETE FROM teams WHERE id = ?`, [id]);
    saveDb();
    return true;
  }
}

// ---------- User Settings (per-user key/value) ----------
export class UserSettingsQueries {
  constructor(private db: Database) {}

  get(userId: number, key: string): string | null {
    const stmt = this.db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = ?`);
    stmt.bind([userId, key]);
    if (stmt.step()) { const row = stmt.getAsObject() as Record<string, unknown>; stmt.free(); return (row.value as string) ?? null; }
    stmt.free();
    return null;
  }

  set(userId: number, key: string, value: string): void {
    this.db.run(
      `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [userId, key, value]
    );
    saveDb();
  }

  delete(userId: number, key: string): void {
    this.db.run(`DELETE FROM user_settings WHERE user_id = ? AND key = ?`, [userId, key]);
    saveDb();
  }

  getAllForUser(userId: number): Record<string, string> {
    const stmt = this.db.prepare(`SELECT key, value FROM user_settings WHERE user_id = ?`);
    stmt.bind([userId]);
    const result: Record<string, string> = {};
    while (stmt.step()) { const row = stmt.getAsObject() as Record<string, unknown>; result[row.key as string] = row.value as string; }
    stmt.free();
    return result;
  }
}

// ---------- Feedback ----------

export interface Feedback {
  id: number;
  user_id: number;
  type: 'bug' | 'question' | 'feature';
  title: string;
  description: string | null;
  status: string;
  created_at: string;
  admin_reply: string | null;
  admin_reply_at: string | null;
  admin_reply_by: number | null;
  task_id: number | null;
}

export class FeedbackQueries {
  constructor(private db: Database) {}

  create(entry: { user_id: number; type: string; title: string; description?: string }): number {
    this.db.run(
      `INSERT INTO feedback (user_id, type, title, description) VALUES (?, ?, ?, ?)`,
      [entry.user_id, entry.type, entry.title, entry.description ?? null]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  getAll(filters?: { status?: string }): (Feedback & { username?: string })[] {
    let sql = `SELECT f.*, u.username FROM feedback f LEFT JOIN users u ON f.user_id = u.id WHERE 1=1`;
    const params: string[] = [];
    if (filters?.status) { sql += ` AND f.status = ?`; params.push(filters.status); }
    sql += ` ORDER BY f.created_at DESC`;
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results: (Feedback & { username?: string })[] = [];
    while (stmt.step()) { results.push(stmt.getAsObject() as unknown as Feedback & { username?: string }); }
    stmt.free();
    return results;
  }

  updateStatus(id: number, status: string): boolean {
    this.db.run(`UPDATE feedback SET status = ? WHERE id = ?`, [status, id]);
    saveDb();
    return true;
  }

  reply(id: number, reply: string, adminUserId: number): boolean {
    this.db.run(
      `UPDATE feedback SET admin_reply = ?, admin_reply_at = datetime('now'), admin_reply_by = ?, status = 'reviewed' WHERE id = ?`,
      [reply, adminUserId, id]
    );
    saveDb();
    return true;
  }

  linkTask(id: number, taskId: number): boolean {
    this.db.run(`UPDATE feedback SET task_id = ? WHERE id = ?`, [taskId, id]);
    saveDb();
    return true;
  }

  getById(id: number): (Feedback & { username?: string }) | null {
    const stmt = this.db.prepare(
      `SELECT f.*, u.username FROM feedback f LEFT JOIN users u ON f.user_id = u.id WHERE f.id = ?`
    );
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as Feedback & { username?: string };
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  delete(id: number): boolean {
    this.db.run(`DELETE FROM feedback WHERE id = ?`, [id]);
    saveDb();
    return true;
  }
}

// ---------- Onboarding Config ----------

export interface OnboardingTicketGroup {
  id: number;
  name: string;
  sort_order: number;
  active: number;
  created_at: string;
}

export interface OnboardingSaleType {
  id: number;
  name: string;
  sort_order: number;
  active: number;
  jira_tickets_required: number;
  created_at: string;
}

export interface OnboardingCapability {
  id: number;
  name: string;
  code: string | null;
  ticket_group_id: number | null;
  ticket_group_name?: string;
  sort_order: number;
  active: number;
  created_at: string;
  item_count?: number;
}

export interface OnboardingMatrixCell {
  id: number;
  sale_type_id: number;
  capability_id: number;
  enabled: number;
  notes: string | null;
}

export interface OnboardingCapabilityItem {
  id: number;
  capability_id: number;
  name: string;
  is_bolt_on: number;
  sort_order: number;
  active: number;
  created_at: string;
}

export interface ResolvedCapability {
  capabilityId: number;
  capabilityName: string;
  code: string | null;
  items: string[];
}

export interface ResolvedTicketGroup {
  ticketGroupId: number | null;
  ticketGroupName: string;
  capabilities: ResolvedCapability[];
}

export class OnboardingConfigQueries {
  constructor(private db: Database) {}

  // ── Ticket Groups ──

  getAllTicketGroups(): OnboardingTicketGroup[] {
    const stmt = this.db.prepare(`SELECT * FROM onboarding_ticket_groups ORDER BY sort_order, name`);
    const results: OnboardingTicketGroup[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as OnboardingTicketGroup);
    stmt.free();
    return results;
  }

  createTicketGroup(name: string, sortOrder?: number): number {
    this.db.run(
      `INSERT INTO onboarding_ticket_groups (name, sort_order) VALUES (?, ?)`,
      [name, sortOrder ?? 0]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateTicketGroup(id: number, updates: { name?: string; sort_order?: number; active?: number }): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (fields.length === 0) return false;
    params.push(id);
    this.db.run(`UPDATE onboarding_ticket_groups SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return true;
  }

  deleteTicketGroup(id: number): boolean {
    // Unlink capabilities from this group
    this.db.run(`UPDATE onboarding_capabilities SET ticket_group_id = NULL WHERE ticket_group_id = ?`, [id]);
    this.db.run(`DELETE FROM onboarding_ticket_groups WHERE id = ?`, [id]);
    saveDb();
    return true;
  }

  // ── Sale Types ──

  getAllSaleTypes(): OnboardingSaleType[] {
    const stmt = this.db.prepare(`SELECT * FROM onboarding_sale_types ORDER BY sort_order, name`);
    const results: OnboardingSaleType[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as OnboardingSaleType);
    stmt.free();
    return results;
  }

  createSaleType(name: string, sortOrder?: number, jiraTicketsRequired?: number): number {
    this.db.run(
      `INSERT INTO onboarding_sale_types (name, sort_order, jira_tickets_required) VALUES (?, ?, ?)`,
      [name, sortOrder ?? 0, jiraTicketsRequired ?? 0]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateSaleType(id: number, updates: { name?: string; sort_order?: number; active?: number }): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (fields.length === 0) return false;
    params.push(id);
    this.db.run(`UPDATE onboarding_sale_types SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return true;
  }

  deleteSaleType(id: number): boolean {
    this.db.run(`DELETE FROM onboarding_matrix WHERE sale_type_id = ?`, [id]);
    this.db.run(`DELETE FROM onboarding_sale_types WHERE id = ?`, [id]);
    saveDb();
    return true;
  }

  // ── Capabilities ──

  getAllCapabilities(): OnboardingCapability[] {
    const stmt = this.db.prepare(`
      SELECT c.*, tg.name as ticket_group_name, COUNT(i.id) as item_count
      FROM onboarding_capabilities c
      LEFT JOIN onboarding_ticket_groups tg ON c.ticket_group_id = tg.id
      LEFT JOIN onboarding_capability_items i ON c.id = i.capability_id
      GROUP BY c.id
      ORDER BY c.sort_order, c.name
    `);
    const results: OnboardingCapability[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as OnboardingCapability);
    stmt.free();
    return results;
  }

  createCapability(name: string, code?: string, sortOrder?: number, ticketGroupId?: number): number {
    this.db.run(
      `INSERT INTO onboarding_capabilities (name, code, sort_order, ticket_group_id) VALUES (?, ?, ?, ?)`,
      [name, code ?? null, sortOrder ?? 0, ticketGroupId ?? null]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateCapability(id: number, updates: { name?: string; code?: string; sort_order?: number; active?: number; ticket_group_id?: number | null }): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.code !== undefined) { fields.push('code = ?'); params.push(updates.code); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (updates.ticket_group_id !== undefined) { fields.push('ticket_group_id = ?'); params.push(updates.ticket_group_id); }
    if (fields.length === 0) return false;
    params.push(id);
    this.db.run(`UPDATE onboarding_capabilities SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return true;
  }

  deleteCapability(id: number): boolean {
    this.db.run(`DELETE FROM onboarding_capability_items WHERE capability_id = ?`, [id]);
    this.db.run(`DELETE FROM onboarding_matrix WHERE capability_id = ?`, [id]);
    this.db.run(`DELETE FROM onboarding_capabilities WHERE id = ?`, [id]);
    saveDb();
    return true;
  }

  // ── Matrix ──

  getFullMatrix(): { saleTypes: OnboardingSaleType[]; capabilities: OnboardingCapability[]; cells: OnboardingMatrixCell[]; ticketGroups: OnboardingTicketGroup[] } {
    const saleTypes = this.getAllSaleTypes();
    const capabilities = this.getAllCapabilities();
    const ticketGroups = this.getAllTicketGroups();

    const stmt = this.db.prepare(`SELECT * FROM onboarding_matrix`);
    const cells: OnboardingMatrixCell[] = [];
    while (stmt.step()) cells.push(stmt.getAsObject() as unknown as OnboardingMatrixCell);
    stmt.free();

    return { saleTypes, capabilities, cells, ticketGroups };
  }

  setMatrixCell(saleTypeId: number, capabilityId: number, enabled: boolean, notes?: string | null): void {
    this.db.run(
      `INSERT INTO onboarding_matrix (sale_type_id, capability_id, enabled, notes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(sale_type_id, capability_id) DO UPDATE SET enabled = excluded.enabled, notes = COALESCE(excluded.notes, notes)`,
      [saleTypeId, capabilityId, enabled ? 1 : 0, notes ?? null]
    );
    saveDb();
  }

  batchUpdateMatrix(updates: Array<{ sale_type_id: number; capability_id: number; enabled: boolean; notes?: string | null }>): void {
    for (const u of updates) {
      this.db.run(
        `INSERT INTO onboarding_matrix (sale_type_id, capability_id, enabled, notes)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(sale_type_id, capability_id) DO UPDATE SET enabled = excluded.enabled, notes = COALESCE(excluded.notes, notes)`,
        [u.sale_type_id, u.capability_id, u.enabled ? 1 : 0, u.notes ?? null]
      );
    }
    saveDb();
  }

  /** Resolved ticket group — one Jira ticket per group, listing X'd capabilities within */
  resolveForSaleType(saleTypeName: string): ResolvedTicketGroup[] {
    const stStmt = this.db.prepare(`SELECT id FROM onboarding_sale_types WHERE name = ? AND active = 1`);
    stStmt.bind([saleTypeName]);
    if (!stStmt.step()) { stStmt.free(); return []; }
    const saleTypeId = (stStmt.getAsObject() as Record<string, unknown>).id as number;
    stStmt.free();

    // Get all enabled capabilities for this sale type, joined with their ticket group
    const capStmt = this.db.prepare(`
      SELECT c.id, c.name, c.code, c.ticket_group_id, COALESCE(tg.name, c.name) as ticket_group_name, COALESCE(tg.sort_order, c.sort_order) as group_sort
      FROM onboarding_matrix m
      JOIN onboarding_capabilities c ON m.capability_id = c.id
      LEFT JOIN onboarding_ticket_groups tg ON c.ticket_group_id = tg.id
      WHERE m.sale_type_id = ? AND m.enabled = 1 AND c.active = 1
      ORDER BY group_sort, c.sort_order, c.name
    `);
    capStmt.bind([saleTypeId]);

    // Group capabilities by ticket_group_id (null → singleton group per capability)
    const groupMap = new Map<string, ResolvedTicketGroup>();
    while (capStmt.step()) {
      const row = capStmt.getAsObject() as Record<string, unknown>;
      const groupId = row.ticket_group_id as number | null;
      const groupKey = groupId != null ? `g:${groupId}` : `c:${row.id}`;
      const groupName = row.ticket_group_name as string;

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          ticketGroupId: groupId,
          ticketGroupName: groupName,
          capabilities: [],
        });
      }

      const cap: ResolvedCapability = {
        capabilityId: row.id as number,
        capabilityName: row.name as string,
        code: (row.code as string) ?? null,
        items: [],
      };

      // Fill items
      const itemStmt = this.db.prepare(
        `SELECT name FROM onboarding_capability_items WHERE capability_id = ? AND active = 1 ORDER BY sort_order, name`
      );
      itemStmt.bind([cap.capabilityId]);
      while (itemStmt.step()) {
        const itemRow = itemStmt.getAsObject() as Record<string, unknown>;
        cap.items.push(itemRow.name as string);
      }
      itemStmt.free();

      groupMap.get(groupKey)!.capabilities.push(cap);
    }
    capStmt.free();

    return Array.from(groupMap.values());
  }

  // ── Items ──

  getItemsForCapability(capabilityId: number): OnboardingCapabilityItem[] {
    const stmt = this.db.prepare(
      `SELECT * FROM onboarding_capability_items WHERE capability_id = ? ORDER BY sort_order, name`
    );
    stmt.bind([capabilityId]);
    const results: OnboardingCapabilityItem[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as OnboardingCapabilityItem);
    stmt.free();
    return results;
  }

  createItem(capabilityId: number, name: string, isBoltOn?: boolean, sortOrder?: number): number {
    this.db.run(
      `INSERT INTO onboarding_capability_items (capability_id, name, is_bolt_on, sort_order) VALUES (?, ?, ?, ?)`,
      [capabilityId, name, isBoltOn ? 1 : 0, sortOrder ?? 0]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateItem(id: number, updates: { name?: string; is_bolt_on?: number; sort_order?: number; active?: number }): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.is_bolt_on !== undefined) { fields.push('is_bolt_on = ?'); params.push(updates.is_bolt_on); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (fields.length === 0) return false;
    params.push(id);
    this.db.run(`UPDATE onboarding_capability_items SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return true;
  }

  deleteItem(id: number): boolean {
    this.db.run(`DELETE FROM onboarding_capability_items WHERE id = ?`, [id]);
    saveDb();
    return true;
  }

  /** Clear all config tables (used before import) */
  clearAll(): void {
    this.db.run(`DELETE FROM onboarding_capability_items`);
    this.db.run(`DELETE FROM onboarding_matrix`);
    this.db.run(`DELETE FROM onboarding_capabilities`);
    this.db.run(`DELETE FROM onboarding_sale_types`);
    this.db.run(`DELETE FROM onboarding_ticket_groups`);
    saveDb();
  }
}

// ---------- Onboarding Runs ----------

export interface OnboardingRun {
  id: number;
  onboarding_ref: string;
  status: 'pending' | 'success' | 'partial' | 'error';
  parent_key: string | null;
  child_keys: string | null;
  created_count: number;
  linked_count: number;
  error_message: string | null;
  payload: string | null;
  dry_run: number;
  user_id: number | null;
  created_at: string;
  updated_at: string;
}

export class OnboardingRunQueries {
  constructor(private db: Database) {}

  getByRef(ref: string): OnboardingRun | undefined {
    const stmt = this.db.prepare(
      `SELECT * FROM onboarding_runs WHERE onboarding_ref = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1`
    );
    stmt.bind([ref]);
    if (stmt.step()) { const r = stmt.getAsObject() as unknown as OnboardingRun; stmt.free(); return r; }
    stmt.free();
    return undefined;
  }

  getAllByRef(ref: string): OnboardingRun[] {
    const stmt = this.db.prepare(`SELECT * FROM onboarding_runs WHERE onboarding_ref = ? ORDER BY created_at DESC`);
    stmt.bind([ref]);
    const results: OnboardingRun[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as OnboardingRun);
    stmt.free();
    return results;
  }

  getRecent(limit: number = 20): OnboardingRun[] {
    const stmt = this.db.prepare(`SELECT * FROM onboarding_runs ORDER BY created_at DESC LIMIT ?`);
    stmt.bind([limit]);
    const results: OnboardingRun[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as OnboardingRun);
    stmt.free();
    return results;
  }

  create(run: { onboarding_ref: string; payload?: string; user_id?: number; dry_run?: boolean }): number {
    this.db.run(
      `INSERT INTO onboarding_runs (onboarding_ref, payload, user_id, dry_run) VALUES (?, ?, ?, ?)`,
      [run.onboarding_ref, run.payload ?? null, run.user_id ?? null, run.dry_run ? 1 : 0]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  update(id: number, updates: Partial<Pick<OnboardingRun, 'status' | 'parent_key' | 'child_keys' | 'created_count' | 'linked_count' | 'error_message'>>): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    this.db.run(`UPDATE onboarding_runs SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return true;
  }

  getMaxRefNumber(prefix: string): number {
    const stmt = this.db.prepare(
      `SELECT onboarding_ref FROM onboarding_runs WHERE onboarding_ref LIKE ? ORDER BY onboarding_ref DESC LIMIT 1`
    );
    stmt.bind([`${prefix}%`]);
    let max = 0;
    if (stmt.step()) {
      const ref = (stmt.getAsObject() as Record<string, unknown>).onboarding_ref as string;
      const numPart = parseInt(ref.substring(prefix.length), 10);
      if (!isNaN(numPart) && numPart > max) max = numPart;
    }
    stmt.free();
    return max;
  }
}

// ---------- Milestone Templates & Delivery Milestones ----------

export interface MilestoneTemplate {
  id: number;
  name: string;
  day_offset: number;
  sort_order: number;
  checklist_json: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryMilestone {
  id: number;
  delivery_id: number;
  template_id: number;
  template_name: string;
  target_date: string | null;
  actual_date: string | null;
  status: string;
  checklist_state_json: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class MilestoneQueries {
  constructor(private db: Database) {}

  // ── Templates ──

  getAllTemplates(activeOnly = false): MilestoneTemplate[] {
    const sql = activeOnly
      ? `SELECT * FROM milestone_templates WHERE active = 1 ORDER BY sort_order, name`
      : `SELECT * FROM milestone_templates ORDER BY sort_order, name`;
    const stmt = this.db.prepare(sql);
    const results: MilestoneTemplate[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as MilestoneTemplate);
    stmt.free();
    return results;
  }

  getTemplateById(id: number): MilestoneTemplate | undefined {
    const stmt = this.db.prepare(`SELECT * FROM milestone_templates WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) { const t = stmt.getAsObject() as unknown as MilestoneTemplate; stmt.free(); return t; }
    stmt.free();
    return undefined;
  }

  createTemplate(data: { name: string; day_offset: number; sort_order?: number; checklist_json?: string }): number {
    this.db.run(
      `INSERT INTO milestone_templates (name, day_offset, sort_order, checklist_json) VALUES (?, ?, ?, ?)`,
      [data.name, data.day_offset, data.sort_order ?? 0, data.checklist_json ?? '[]']
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateTemplate(id: number, updates: Partial<Pick<MilestoneTemplate, 'name' | 'day_offset' | 'sort_order' | 'checklist_json' | 'active'>>): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.day_offset !== undefined) { fields.push('day_offset = ?'); params.push(updates.day_offset); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.checklist_json !== undefined) { fields.push('checklist_json = ?'); params.push(updates.checklist_json); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (fields.length === 0) return false;
    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    this.db.run(`UPDATE milestone_templates SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return true;
  }

  deleteTemplate(id: number): boolean {
    this.db.run(`DELETE FROM milestone_templates WHERE id = ?`, [id]);
    saveDb();
    return true;
  }

  // ── Sale Type Matrix (day offsets per sale type per template) ──

  getMatrixOffsets(): Array<{ sale_type_id: number; template_id: number; day_offset: number }> {
    const stmt = this.db.prepare(`SELECT sale_type_id, template_id, day_offset FROM milestone_sale_type_offsets`);
    const results: Array<{ sale_type_id: number; template_id: number; day_offset: number }> = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as { sale_type_id: number; template_id: number; day_offset: number });
    stmt.free();
    return results;
  }

  setMatrixOffset(saleTypeId: number, templateId: number, dayOffset: number): void {
    this.db.run(
      `INSERT INTO milestone_sale_type_offsets (sale_type_id, template_id, day_offset) VALUES (?, ?, ?)
       ON CONFLICT(sale_type_id, template_id) DO UPDATE SET day_offset = excluded.day_offset`,
      [saleTypeId, templateId, dayOffset]
    );
    saveDb();
  }

  batchSetMatrixOffsets(updates: Array<{ sale_type_id: number; template_id: number; day_offset: number }>): void {
    for (const u of updates) {
      this.db.run(
        `INSERT INTO milestone_sale_type_offsets (sale_type_id, template_id, day_offset) VALUES (?, ?, ?)
         ON CONFLICT(sale_type_id, template_id) DO UPDATE SET day_offset = excluded.day_offset`,
        [u.sale_type_id, u.template_id, u.day_offset]
      );
    }
    saveDb();
  }

  deleteMatrixRow(saleTypeId: number): void {
    this.db.run(`DELETE FROM milestone_sale_type_offsets WHERE sale_type_id = ?`, [saleTypeId]);
    saveDb();
  }

  /** Get offsets for a sale type name (falls back to template defaults) */
  getOffsetsForSaleType(saleTypeName: string): Map<number, number> {
    const result = new Map<number, number>();
    // Start with template defaults
    const templates = this.getAllTemplates(true);
    for (const t of templates) result.set(t.id, t.day_offset);
    // Override with sale-type-specific offsets if found
    const stmt = this.db.prepare(`
      SELECT mso.template_id, mso.day_offset
      FROM milestone_sale_type_offsets mso
      JOIN onboarding_sale_types ost ON mso.sale_type_id = ost.id
      WHERE ost.name = ? AND ost.active = 1
    `);
    stmt.bind([saleTypeName]);
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      result.set(row.template_id as number, row.day_offset as number);
    }
    stmt.free();
    return result;
  }

  // ── Delivery Milestone Instances ──

  getByDelivery(deliveryId: number): DeliveryMilestone[] {
    const stmt = this.db.prepare(
      `SELECT * FROM delivery_milestones WHERE delivery_id = ? ORDER BY target_date, template_name`
    );
    stmt.bind([deliveryId]);
    const results: DeliveryMilestone[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as DeliveryMilestone);
    stmt.free();
    return results;
  }

  getMilestoneById(id: number): DeliveryMilestone | undefined {
    const stmt = this.db.prepare(`SELECT * FROM delivery_milestones WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) { const m = stmt.getAsObject() as unknown as DeliveryMilestone; stmt.free(); return m; }
    stmt.free();
    return undefined;
  }

  createForDelivery(deliveryId: number, startDate: string, saleType?: string): DeliveryMilestone[] {
    const templates = this.getAllTemplates(true);
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return [];

    // Use sale-type-specific offsets if available
    const saleTypeOffsets = saleType ? this.getOffsetsForSaleType(saleType) : null;

    for (const tmpl of templates) {
      const dayOffset = saleTypeOffsets?.get(tmpl.id) ?? tmpl.day_offset;
      const target = new Date(start);
      target.setDate(target.getDate() + dayOffset);
      const targetStr = target.toISOString().split('T')[0];

      // Convert template checklist items (string[]) to stateful format [{text, checked}]
      let stateJson = '[]';
      try {
        const items = JSON.parse(tmpl.checklist_json || '[]');
        if (Array.isArray(items)) {
          stateJson = JSON.stringify(items.map((text: string) => ({ text, checked: false })));
        }
      } catch { /* keep empty */ }

      this.db.run(
        `INSERT INTO delivery_milestones (delivery_id, template_id, template_name, target_date, checklist_state_json)
         VALUES (?, ?, ?, ?, ?)`,
        [deliveryId, tmpl.id, tmpl.name, targetStr, stateJson]
      );
    }
    saveDb();
    return this.getByDelivery(deliveryId);
  }

  updateMilestone(id: number, updates: Partial<Pick<DeliveryMilestone, 'status' | 'actual_date' | 'checklist_state_json' | 'notes' | 'target_date'>>): boolean {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.actual_date !== undefined) { fields.push('actual_date = ?'); params.push(updates.actual_date); }
    if (updates.checklist_state_json !== undefined) { fields.push('checklist_state_json = ?'); params.push(updates.checklist_state_json); }
    if (updates.notes !== undefined) { fields.push('notes = ?'); params.push(updates.notes); }
    if (updates.target_date !== undefined) { fields.push('target_date = ?'); params.push(updates.target_date); }
    if (fields.length === 0) return false;
    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    this.db.run(`UPDATE delivery_milestones SET ${fields.join(', ')} WHERE id = ?`, params as (string | number | null)[]);
    saveDb();
    return this.getMilestoneById(id) !== undefined;
  }

  deleteByDelivery(deliveryId: number): number {
    const countStmt = this.db.prepare(`SELECT COUNT(*) as c FROM delivery_milestones WHERE delivery_id = ?`);
    countStmt.bind([deliveryId]);
    let count = 0;
    if (countStmt.step()) count = (countStmt.getAsObject() as Record<string, unknown>).c as number;
    countStmt.free();
    this.db.run(`DELETE FROM delivery_milestones WHERE delivery_id = ?`, [deliveryId]);
    saveDb();
    return count;
  }

  getOverdueSummaryByDelivery(deliveryIds: number[]): Map<number, { overdueCount: number; totalCount: number; completeCount: number; nextOverdue: string | null }> {
    const result = new Map<number, { overdueCount: number; totalCount: number; completeCount: number; nextOverdue: string | null }>();
    if (deliveryIds.length === 0) return result;

    const placeholders = deliveryIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT delivery_id,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
        SUM(CASE WHEN status != 'complete' AND target_date < date('now') THEN 1 ELSE 0 END) as overdue,
        MIN(CASE WHEN status != 'complete' AND target_date < date('now') THEN template_name END) as next_overdue
      FROM delivery_milestones
      WHERE delivery_id IN (${placeholders})
      GROUP BY delivery_id
    `);
    stmt.bind(deliveryIds);

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      result.set(row.delivery_id as number, {
        overdueCount: (row.overdue as number) ?? 0,
        totalCount: (row.total as number) ?? 0,
        completeCount: (row.complete as number) ?? 0,
        nextOverdue: (row.next_overdue as string) ?? null,
      });
    }
    stmt.free();
    return result;
  }

  /** Get all milestones joined with delivery info, for calendar view */
  getAllWithDelivery(): Array<DeliveryMilestone & { account: string; product: string; onboarding_id: string | null; onboarder: string | null }> {
    const stmt = this.db.prepare(`
      SELECT dm.*, de.account, de.product, de.onboarding_id, de.onboarder
      FROM delivery_milestones dm
      JOIN delivery_entries de ON dm.delivery_id = de.id
      ORDER BY dm.target_date, de.account, dm.template_name
    `);
    const results: Array<DeliveryMilestone & { account: string; product: string; onboarding_id: string | null; onboarder: string | null }> = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as any);
    stmt.free();
    return results;
  }

  getSummary(): { total: number; pending: number; in_progress: number; complete: number; overdue: number } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
        SUM(CASE WHEN status != 'complete' AND target_date < date('now') THEN 1 ELSE 0 END) as overdue
      FROM delivery_milestones
    `);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        total: (row.total as number) ?? 0,
        pending: (row.pending as number) ?? 0,
        in_progress: (row.in_progress as number) ?? 0,
        complete: (row.complete as number) ?? 0,
        overdue: (row.overdue as number) ?? 0,
      };
    }
    stmt.free();
    return { total: 0, pending: 0, in_progress: 0, complete: 0, overdue: 0 };
  }

  /** Get the next non-complete milestone per delivery, ordered by target_date ASC */
  getNextPendingByDelivery(deliveryIds: number[]): Map<number, { name: string; target_date: string; status: string }> {
    const result = new Map<number, { name: string; target_date: string; status: string }>();
    if (deliveryIds.length === 0) return result;

    const placeholders = deliveryIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT delivery_id, template_name, target_date, status
      FROM delivery_milestones
      WHERE delivery_id IN (${placeholders})
        AND status != 'complete'
      ORDER BY target_date ASC
    `);
    stmt.bind(deliveryIds);

    const seen = new Set<number>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const did = row.delivery_id as number;
      if (seen.has(did)) continue;
      seen.add(did);
      result.set(did, {
        name: row.template_name as string,
        target_date: (row.target_date as string) ?? '',
        status: row.status as string,
      });
    }
    stmt.free();
    return result;
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
