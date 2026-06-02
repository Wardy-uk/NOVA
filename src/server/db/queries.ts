import type { Task, TaskUpdate } from '../../shared/types.js';
import { query, queryOne, execute, executeAndGetId, transaction, txExecute, txExecuteAndGetId, txQuery } from '../services/database.js';

// ─── Tasks ────────────────────────────────────────────────────────────────────

export class TaskQueries {
  async getAll(filters?: { status?: string; source?: string; userId?: number }): Promise<Task[]> {
    const useUserPins = filters?.userId != null;
    let sql: string;
    if (useUserPins) {
      sql = `SELECT t.*, CASE WHEN p.task_id IS NOT NULL THEN 1 ELSE 0 END as is_pinned
             FROM tasks t LEFT JOIN user_task_pins p ON t.id = p.task_id AND p.user_id = ?
             WHERE t.user_id = ?`;
    } else {
      sql = `SELECT * FROM tasks WHERE 1=1`;
    }
    const params: unknown[] = [];
    if (useUserPins) { params.push(filters!.userId!); params.push(filters!.userId!); }

    if (filters?.status) {
      sql += ` AND ${useUserPins ? 't.' : ''}status = ?`;
      params.push(filters.status);
    }
    if (filters?.source) {
      sql += ` AND ${useUserPins ? 't.' : ''}source = ?`;
      params.push(filters.source);
    }

    if (useUserPins) {
      sql += ` AND (t.snoozed_until IS NULL OR t.snoozed_until <= GETUTCDATE())`;
      sql += ` AND t.status NOT IN ('dismissed', 'done')`;
    } else {
      sql += ` AND (snoozed_until IS NULL OR snoozed_until <= GETUTCDATE())`;
      sql += ` AND status NOT IN ('dismissed', 'done')`;
    }
    sql += useUserPins
      ? ` ORDER BY (CASE WHEN p.task_id IS NOT NULL THEN 1 ELSE 0 END) DESC, t.priority DESC, t.due_date ASC`
      : ` ORDER BY is_pinned DESC, priority DESC, due_date ASC`;

    const rows = await query<Record<string, unknown>>(sql, params);
    return rows.map(r => this.rowToTask(r));
  }

  async searchByTitle(searchQuery: string, source?: string, limit: number = 20): Promise<Task[]> {
    let sql = `SELECT TOP(?) * FROM tasks WHERE title LIKE ?`;
    const params: unknown[] = [limit, `%${searchQuery}%`];
    if (source) { sql += ` AND source = ?`; params.push(source); }
    sql += ` ORDER BY updated_at DESC`;
    const rows = await query<Record<string, unknown>>(sql, params);
    return rows.map(r => this.rowToTask(r));
  }

  async getAllIncludingDone(userId?: number): Promise<Task[]> {
    const sql = userId != null
      ? `SELECT * FROM tasks WHERE user_id = ? ORDER BY updated_at DESC`
      : `SELECT * FROM tasks ORDER BY updated_at DESC`;
    const params = userId != null ? [userId] : [];
    const rows = await query<Record<string, unknown>>(sql, params);
    return rows.map(r => this.rowToTask(r));
  }

  async getById(id: string): Promise<Task | undefined> {
    const row = await queryOne<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = ?`, [id]);
    return row ? this.rowToTask(row) : undefined;
  }

  async upsertFromSource(task: {
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
    user_id?: number;
  }): Promise<void> {
    const id = `${task.source}:${task.source_id}`;
    const params = [
      id, task.source, task.source_id, task.source_url ?? null,
      task.title, task.description ?? null, task.status ?? 'open',
      task.priority ?? 50, task.due_date ?? null, task.sla_breach_at ?? null,
      task.category ?? null, task.raw_data ? JSON.stringify(task.raw_data) : null,
      task.transient ? 1 : 0, task.user_id ?? null,
    ];
    await execute(`
      MERGE INTO tasks WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?))
        AS source(id, source, source_id, source_url, title, description, status, priority, due_date, sla_breach_at, category, raw_data, [transient], user_id)
      ON target.id = source.id
      WHEN MATCHED THEN UPDATE SET
        source_url = source.source_url, title = source.title, description = source.description,
        status = source.status, priority = source.priority, due_date = source.due_date,
        sla_breach_at = source.sla_breach_at, category = source.category, raw_data = source.raw_data,
        [transient] = source.[transient], user_id = COALESCE(target.user_id, source.user_id),
        last_synced = GETUTCDATE(), updated_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (id, source, source_id, source_url, title, description, status, priority, due_date, sla_breach_at, category, raw_data, [transient], user_id, last_synced, updated_at)
        VALUES (source.id, source.source, source.source_id, source.source_url, source.title, source.description, source.status, source.priority, source.due_date, source.sla_breach_at, source.category, source.raw_data, source.[transient], source.user_id, GETUTCDATE(), GETUTCDATE());
    `, params);
  }

  async setTaskUserId(taskId: string, userId: number | null): Promise<void> {
    await execute(`UPDATE tasks SET user_id = ?, updated_at = GETUTCDATE() WHERE id = ?`, [userId, taskId]);
  }

  async deleteTransientTasks(): Promise<number> {
    const row = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM tasks WHERE [transient] = 1');
    const count = row?.c ?? 0;
    if (count > 0) {
      await execute('DELETE FROM tasks WHERE [transient] = 1');
    }
    return count;
  }

  async deleteStaleBySource(
    source: string,
    freshIds: string[],
    options?: { allowEmpty?: boolean; userId?: number }
  ): Promise<number> {
    if (source === 'milestone') return 0;

    const userClause = options?.userId != null ? ` AND user_id = ?` : '';
    const userParams: number[] = options?.userId != null ? [options.userId] : [];

    if (freshIds.length === 0) {
      if (!options?.allowEmpty) return 0;
      const row = await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM tasks WHERE source = ?${userClause}`, [source, ...userParams]);
      const count = row?.c ?? 0;
      await execute(`DELETE FROM tasks WHERE source = ?${userClause}`, [source, ...userParams]);
      return count;
    }
    const placeholders = freshIds.map(() => '?').join(',');
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM tasks WHERE source = ? AND id NOT IN (${placeholders})${userClause}`,
      [source, ...freshIds, ...userParams]
    );
    const count = row?.c ?? 0;
    if (count > 0) {
      await execute(
        `DELETE FROM tasks WHERE source = ? AND id NOT IN (${placeholders})${userClause}`,
        [source, ...freshIds, ...userParams]
      );
    }
    return count;
  }

  async purgeUnsyncedTasks(maxAgeDays: number = 2): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM tasks WHERE source != 'milestone' AND [transient] = 0 AND (last_synced IS NULL OR last_synced < ?)`,
      [cutoff]
    );
    const count = row?.c ?? 0;
    if (count > 0) {
      await execute(
        `DELETE FROM tasks WHERE source != 'milestone' AND [transient] = 0 AND (last_synced IS NULL OR last_synced < ?)`,
        [cutoff]
      );
    }
    return count;
  }

  async update(id: string, updates: TaskUpdate, userId?: number): Promise<boolean> {
    if (updates.is_pinned !== undefined && userId != null) {
      if (updates.is_pinned) {
        await execute(
          `IF NOT EXISTS (SELECT 1 FROM user_task_pins WHERE user_id = ? AND task_id = ?)
           INSERT INTO user_task_pins (user_id, task_id) VALUES (?, ?)`,
          [userId, id, userId, id]
        );
      } else {
        await execute(`DELETE FROM user_task_pins WHERE user_id = ? AND task_id = ?`, [userId, id]);
      }
    }

    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.is_pinned !== undefined && userId == null) {
      fields.push('is_pinned = ?');
      params.push(updates.is_pinned ? 1 : 0);
    }
    if (updates.snoozed_until !== undefined) { fields.push('snoozed_until = ?'); params.push(updates.snoozed_until); }
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }

    if (fields.length > 0) {
      fields.push(`updated_at = GETUTCDATE()`);
      params.push(id);
      await execute(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    const check = await this.getById(id);
    return check !== undefined;
  }

  async deleteBySourcePrefix(source: string, sourceIdPrefix: string): Promise<number> {
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM tasks WHERE source = ? AND source_id LIKE ?`,
      [source, sourceIdPrefix + '%']
    );
    const count = row?.c ?? 0;
    if (count > 0) {
      await execute(`DELETE FROM tasks WHERE source = ? AND source_id LIKE ?`, [source, sourceIdPrefix + '%']);
    }
    return count;
  }

  async deleteAllBySource(source: string): Promise<number> {
    const row = await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM tasks WHERE source = ?`, [source]);
    const count = row?.c ?? 0;
    if (count > 0) {
      await execute(`DELETE FROM tasks WHERE source = ?`, [source]);
    }
    return count;
  }

  async getTasksWithUpcomingSla(withinMinutes = 30): Promise<Task[]> {
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM tasks
       WHERE status NOT IN ('done', 'dismissed')
         AND sla_breach_at IS NOT NULL
         AND sla_breach_at > GETUTCDATE()
         AND sla_breach_at <= DATEADD(minute, ?, GETUTCDATE())`,
      [withinMinutes]
    );
    return rows.map(r => this.rowToTask(r));
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
      is_pinned: row.is_pinned === 1 || row.is_pinned === true,
      snoozed_until: (row.snoozed_until as string) ?? null,
      last_synced: (row.last_synced as string) ?? null,
      raw_data: row.raw_data ? JSON.parse(row.raw_data as string) : null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}

// ─── Rituals ──────────────────────────────────────────────────────────────────

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
  async create(ritual: {
    type: string; date: string; summary_md?: string; planned_items?: string;
    completed_items?: string; blockers?: string; openai_response_id?: string;
    conversation?: string; user_id?: number;
  }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO rituals (type, date, summary_md, planned_items, completed_items, blockers, openai_response_id, conversation, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ritual.type, ritual.date, ritual.summary_md ?? null, ritual.planned_items ?? null,
       ritual.completed_items ?? null, ritual.blockers ?? null, ritual.openai_response_id ?? null,
       ritual.conversation ?? null, ritual.user_id ?? null]
    );
  }

  async getByDate(date: string, type?: string, userId?: number): Promise<Ritual[]> {
    let sql = `SELECT * FROM rituals WHERE date = ?`;
    const params: unknown[] = [date];
    if (type) { sql += ` AND type = ?`; params.push(type); }
    if (userId != null) { sql += ` AND user_id = ?`; params.push(userId); }
    sql += ` ORDER BY created_at DESC`;
    return query<Ritual>(sql, params);
  }

  async getRecent(limit: number = 10): Promise<Ritual[]> {
    return query<Ritual>(`SELECT TOP(?) * FROM rituals ORDER BY date DESC, created_at DESC`, [limit]);
  }

  async getById(id: number): Promise<Ritual | undefined> {
    return queryOne<Ritual>(`SELECT * FROM rituals WHERE id = ?`, [id]);
  }

  async update(id: number, updates: { summary_md?: string; planned_items?: string; completed_items?: string; blockers?: string }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.summary_md !== undefined) { fields.push('summary_md = ?'); params.push(updates.summary_md); }
    if (updates.planned_items !== undefined) { fields.push('planned_items = ?'); params.push(updates.planned_items); }
    if (updates.completed_items !== undefined) { fields.push('completed_items = ?'); params.push(updates.completed_items); }
    if (updates.blockers !== undefined) { fields.push('blockers = ?'); params.push(updates.blockers); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE rituals SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }
}

// ─── Delivery Entries ─────────────────────────────────────────────────────────

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
  crm_customer_id: number | null;
  is_starred: number;
  star_scope: 'me' | 'all';
  starred_by: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const BRAND_PREFIXES: Record<string, string> = {
  'BYM': 'BYM', 'KYM': 'KYM', 'Yomdel': 'YMD', 'Leadpro': 'LDP', 'TPJ': 'TPJ',
  'Voice AI': 'VAI', 'GRS': 'GRS', 'Undeliverable': 'UND', 'SB - Web': 'SBW',
  'SB - DM': 'SBD', 'Google Ad Spend': 'GAS', 'Google SEO': 'GSO', 'Guild Package': 'GLD',
};

function getBrandPrefix(product: string): string {
  if (BRAND_PREFIXES[product]) return BRAND_PREFIXES[product];
  return product.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() || 'UNK';
}

export class DeliveryQueries {
  async getNextOnboardingId(product: string): Promise<string> {
    const prefix = getBrandPrefix(product);
    const row = await queryOne<{ onboarding_id: string }>(
      `SELECT TOP 1 onboarding_id FROM delivery_entries WHERE onboarding_id LIKE ? ORDER BY onboarding_id DESC`,
      [`${prefix}%`]
    );
    let nextNum = 1;
    if (row) {
      const numPart = parseInt(row.onboarding_id.substring(prefix.length), 10);
      if (!isNaN(numPart)) nextNum = numPart + 1;
    }
    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  async backfillOnboardingIds(): Promise<number> {
    const entries = await query<{ id: number; product: string }>(
      `SELECT id, product FROM delivery_entries WHERE onboarding_id IS NULL ORDER BY id`
    );
    let count = 0;
    for (const entry of entries) {
      const newId = await this.getNextOnboardingId(entry.product);
      await execute(`UPDATE delivery_entries SET onboarding_id = ? WHERE id = ?`, [newId, entry.id]);
      count++;
    }
    return count;
  }

  async getAll(product?: string): Promise<DeliveryEntry[]> {
    let sql = `SELECT * FROM delivery_entries`;
    const params: string[] = [];
    if (product) { sql += ` WHERE product = ?`; params.push(product); }
    sql += ` ORDER BY is_starred DESC, created_at DESC`;
    return query<DeliveryEntry>(sql, params);
  }

  async getUpcomingGoLive(withinDays = 7, onboarderName?: string): Promise<DeliveryEntry[]> {
    let sql = `SELECT * FROM delivery_entries
       WHERE status != 'complete'
         AND go_live_date IS NOT NULL
         AND go_live_date >= CAST(GETUTCDATE() AS DATE)
         AND go_live_date <= DATEADD(day, ?, GETUTCDATE())`;
    const params: unknown[] = [withinDays];
    if (onboarderName) {
      sql += ` AND LOWER(onboarder) LIKE ?`;
      params.push(`%${onboarderName.toLowerCase()}%`);
    }
    sql += ` ORDER BY go_live_date`;
    return query<DeliveryEntry>(sql, params);
  }

  async getById(id: number): Promise<DeliveryEntry | undefined> {
    return queryOne<DeliveryEntry>(`SELECT * FROM delivery_entries WHERE id = ?`, [id]);
  }

  async findByProductAccount(product: string, account: string): Promise<DeliveryEntry | undefined> {
    return queryOne<DeliveryEntry>(`SELECT TOP 1 * FROM delivery_entries WHERE product = ? AND account = ?`, [product, account]);
  }

  async deleteDuplicates(): Promise<number> {
    const dupes = await query<{ id: number }>(
      `SELECT id FROM delivery_entries WHERE id NOT IN (SELECT MIN(id) FROM delivery_entries GROUP BY product, account)`
    );
    if (dupes.length === 0) return 0;
    const dupeIds = dupes.map(r => r.id);
    await execute(`DELETE FROM delivery_entries WHERE id IN (${dupeIds.join(',')})`);
    return dupeIds.length;
  }

  async create(entry: Omit<DeliveryEntry, 'id' | 'onboarding_id' | 'created_at' | 'updated_at'> & { onboarding_id?: string | null }): Promise<number> {
    const onboardingId = entry.onboarding_id || await this.getNextOnboardingId(entry.product);
    return executeAndGetId(
      `INSERT INTO delivery_entries (onboarding_id, product, account, status, onboarder, order_date, go_live_date,
        predicted_delivery, training_date, branches, mrr, incremental, licence_fee, sale_type, crm_customer_id, is_starred, star_scope, starred_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [onboardingId, entry.product, entry.account, entry.status ?? '',
       entry.onboarder ?? null, entry.order_date ?? null, entry.go_live_date ?? null,
       entry.predicted_delivery ?? null, entry.training_date ?? null,
       entry.branches ?? null, entry.mrr ?? null, entry.incremental ?? null, entry.licence_fee ?? null,
       entry.sale_type ?? null, entry.crm_customer_id ?? null,
       entry.is_starred ?? 0, entry.star_scope ?? 'all', entry.starred_by ?? null, entry.notes ?? null]
    );
  }

  async update(id: number, updates: Partial<Omit<DeliveryEntry, 'id' | 'created_at' | 'updated_at'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    fields.push(`updated_at = GETUTCDATE()`);
    params.push(id);
    await execute(`UPDATE delivery_entries SET ${fields.join(', ')} WHERE id = ?`, params);
    return (await this.getById(id)) !== undefined;
  }

  async delete(id: number): Promise<boolean> {
    const exists = await this.getById(id);
    if (!exists) return false;
    await execute(`DELETE FROM delivery_entries WHERE id = ?`, [id]);
    return true;
  }

  async toggleStar(id: number, userId?: number): Promise<boolean> {
    const entry = await this.getById(id);
    if (!entry) return false;
    const newVal = entry.is_starred ? 0 : 1;
    const params: unknown[] = [newVal];
    let sql = `UPDATE delivery_entries SET is_starred = ?`;
    if (newVal && userId) { sql += `, starred_by = ?`; params.push(userId); }
    if (!newVal) { sql += `, starred_by = NULL, star_scope = 'me'`; }
    sql += `, updated_at = GETUTCDATE() WHERE id = ?`;
    params.push(id);
    await execute(sql, params);
    return true;
  }

  async getMyFocus(userId: number, userNames: string[]): Promise<DeliveryEntry[]> {
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
          WHERE dm.delivery_id = de.id AND dm.status != 'complete' AND dm.target_date < CAST(GETUTCDATE() AS DATE)
        )
      )`);
      for (const name of userNames) params.push(`%${name.toLowerCase()}%`);
    }

    const sql = `SELECT de.* FROM delivery_entries de WHERE ${conditions.join(' OR ')} ORDER BY de.is_starred DESC, de.updated_at DESC`;
    return query<DeliveryEntry>(sql, params);
  }

  async getProducts(): Promise<string[]> {
    const rows = await query<{ product: string }>(`SELECT DISTINCT product FROM delivery_entries ORDER BY product`);
    return rows.map(r => r.product);
  }

  async updateAzDoFields(deliveryId: number, branchName: string | null, prUrl: string | null): Promise<boolean> {
    const result = await execute(
      `UPDATE delivery_entries SET azdo_branch_name = ?, azdo_pr_url = ? WHERE id = ?`,
      [branchName, prUrl, deliveryId]
    );
    return result.rowsAffected > 0;
  }
}

// ─── CRM ──────────────────────────────────────────────────────────────────────

export type RagStatus = 'red' | 'amber' | 'green';

export interface CrmCustomer {
  id: number; name: string; company: string | null; sector: string | null;
  mrr: number | null; owner: string | null; rag_status: RagStatus;
  next_review_date: string | null; contract_start: string | null;
  contract_end: string | null; dynamics_id: string | null;
  account_number: string | null; notes: string | null;
  created_at: string; updated_at: string;
}

export interface CrmReview {
  id: number; customer_id: number; review_date: string; rag_status: RagStatus;
  outcome: string | null; actions: string | null; reviewer: string | null;
  next_review_date: string | null; notes: string | null; created_at: string;
}

export class CrmQueries {
  async getAllCustomers(filters?: { rag_status?: string; owner?: string; search?: string }): Promise<CrmCustomer[]> {
    let sql = `SELECT * FROM crm_customers WHERE 1=1`;
    const params: string[] = [];
    if (filters?.rag_status) { sql += ` AND rag_status = ?`; params.push(filters.rag_status); }
    if (filters?.owner) { sql += ` AND owner = ?`; params.push(filters.owner); }
    if (filters?.search) {
      sql += ` AND (name LIKE ? OR company LIKE ?)`;
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    sql += ` ORDER BY CASE rag_status WHEN 'red' THEN 0 WHEN 'amber' THEN 1 WHEN 'green' THEN 2 END, next_review_date ASC`;
    return query<CrmCustomer>(sql, params);
  }

  async getCustomerById(id: number): Promise<CrmCustomer | undefined> {
    return queryOne<CrmCustomer>(`SELECT * FROM crm_customers WHERE id = ?`, [id]);
  }

  async createCustomer(c: Omit<CrmCustomer, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    return executeAndGetId(
      `INSERT INTO crm_customers (name, company, sector, mrr, owner, rag_status, next_review_date, contract_start, contract_end, dynamics_id, account_number, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.name, c.company ?? null, c.sector ?? null, c.mrr ?? null, c.owner ?? null,
       c.rag_status ?? 'green', c.next_review_date ?? null, c.contract_start ?? null,
       c.contract_end ?? null, c.dynamics_id ?? null, c.account_number ?? null, c.notes ?? null]
    );
  }

  async updateCustomer(id: number, updates: Partial<Omit<CrmCustomer, 'id' | 'created_at' | 'updated_at'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    fields.push(`updated_at = GETUTCDATE()`);
    params.push(id);
    await execute(`UPDATE crm_customers SET ${fields.join(', ')} WHERE id = ?`, params);
    return (await this.getCustomerById(id)) !== undefined;
  }

  async deleteCustomer(id: number): Promise<boolean> {
    const exists = await this.getCustomerById(id);
    if (!exists) return false;
    await execute(`DELETE FROM crm_reviews WHERE customer_id = ?`, [id]);
    await execute(`DELETE FROM crm_customers WHERE id = ?`, [id]);
    return true;
  }

  async deleteAllCustomers(): Promise<number> {
    const all = await this.getAllCustomers({});
    const count = all.length;
    await execute(`DELETE FROM crm_reviews`);
    await execute(`DELETE FROM crm_customers`);
    return count;
  }

  async getOwners(): Promise<string[]> {
    const rows = await query<{ owner: string }>(`SELECT DISTINCT owner FROM crm_customers WHERE owner IS NOT NULL AND owner != '' ORDER BY owner`);
    return rows.map(r => r.owner);
  }

  async getReviewsForCustomer(customerId: number): Promise<CrmReview[]> {
    return query<CrmReview>(`SELECT * FROM crm_reviews WHERE customer_id = ? ORDER BY review_date DESC`, [customerId]);
  }

  async getReviewById(id: number): Promise<CrmReview | undefined> {
    return queryOne<CrmReview>(`SELECT * FROM crm_reviews WHERE id = ?`, [id]);
  }

  async createReview(r: Omit<CrmReview, 'id' | 'created_at'>): Promise<number> {
    const id = await executeAndGetId(
      `INSERT INTO crm_reviews (customer_id, review_date, rag_status, outcome, actions, reviewer, next_review_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.customer_id, r.review_date, r.rag_status, r.outcome ?? null, r.actions ?? null,
       r.reviewer ?? null, r.next_review_date ?? null, r.notes ?? null]
    );
    await execute(
      `UPDATE crm_customers SET rag_status = ?, next_review_date = COALESCE(?, next_review_date), updated_at = GETUTCDATE() WHERE id = ?`,
      [r.rag_status, r.next_review_date ?? null, r.customer_id]
    );
    return id;
  }

  async updateReview(id: number, updates: Partial<Omit<CrmReview, 'id' | 'created_at'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE crm_reviews SET ${fields.join(', ')} WHERE id = ?`, params);
    return (await this.getReviewById(id)) !== undefined;
  }

  async deleteReview(id: number): Promise<boolean> {
    const exists = await this.getReviewById(id);
    if (!exists) return false;
    await execute(`DELETE FROM crm_reviews WHERE id = ?`, [id]);
    return true;
  }

  async getSummary(): Promise<{ total: number; red: number; amber: number; green: number; overdueReviews: number; totalMrr: number }> {
    const row = await queryOne<Record<string, unknown>>(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN rag_status = 'red' THEN 1 ELSE 0 END) as red,
        SUM(CASE WHEN rag_status = 'amber' THEN 1 ELSE 0 END) as amber,
        SUM(CASE WHEN rag_status = 'green' THEN 1 ELSE 0 END) as green,
        SUM(CASE WHEN next_review_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as overdueReviews,
        COALESCE(SUM(mrr), 0) as totalMrr
      FROM crm_customers
    `);
    if (!row) return { total: 0, red: 0, amber: 0, green: 0, overdueReviews: 0, totalMrr: 0 };
    return {
      total: (row.total as number) ?? 0, red: (row.red as number) ?? 0,
      amber: (row.amber as number) ?? 0, green: (row.green as number) ?? 0,
      overdueReviews: (row.overdueReviews as number) ?? 0, totalMrr: (row.totalMrr as number) ?? 0,
    };
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface User {
  id: number; username: string; display_name: string | null; email: string | null;
  password_hash: string; role: string; auth_provider: string;
  provider_id: string | null; team_id: number | null; created_at: string; updated_at: string;
}

export class UserQueries {
  async getByUsername(username: string): Promise<User | undefined> {
    return queryOne<User>(`SELECT * FROM users WHERE username = ?`, [username]);
  }

  async getById(id: number): Promise<User | undefined> {
    return queryOne<User>(`SELECT * FROM users WHERE id = ?`, [id]);
  }

  async getByProviderId(provider: string, providerId: string): Promise<User | undefined> {
    return queryOne<User>(`SELECT * FROM users WHERE auth_provider = ? AND provider_id = ?`, [provider, providerId]);
  }

  async create(user: { username: string; display_name?: string; email?: string; password_hash: string; role?: string; auth_provider?: string; provider_id?: string }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO users (username, display_name, email, password_hash, role, auth_provider, provider_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.username, user.display_name ?? null, user.email ?? null, user.password_hash,
       user.role ?? 'viewer', user.auth_provider ?? 'local', user.provider_id ?? null]
    );
  }

  async update(id: number, updates: Partial<Omit<User, 'id' | 'created_at'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    fields.push(`updated_at = GETUTCDATE()`);
    params.push(id);
    await execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    return (await this.getById(id)) !== undefined;
  }

  async count(): Promise<number> {
    const row = await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM users`);
    return row?.c ?? 0;
  }

  async getAll(): Promise<Omit<User, 'password_hash'>[]> {
    return query<Omit<User, 'password_hash'>>(
      `SELECT id, username, display_name, email, role, auth_provider, provider_id, team_id, created_at, updated_at FROM users ORDER BY LOWER(display_name), LOWER(username)`
    );
  }

  async getByEmail(email: string): Promise<User | undefined> {
    return queryOne<User>(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`, [email]);
  }

  async delete(id: number): Promise<boolean> {
    await execute(`DELETE FROM user_teams WHERE user_id = ?`, [id]);
    await execute(`DELETE FROM users WHERE id = ?`, [id]);
    await execute(`DELETE FROM user_settings WHERE user_id = ?`, [id]);
    return true;
  }

  async ensureServiceAccount(spec: {
    username: string;
    password_hash: string;
    role: string;
    display_name?: string;
  }): Promise<boolean> {
    const existing = await this.getByUsername(spec.username);
    if (existing) return false;
    await this.create({
      username: spec.username,
      password_hash: spec.password_hash,
      role: spec.role,
      display_name: spec.display_name ?? spec.username,
    });
    return true;
  }
}

// ─── Teams ─────────────────────────────────���──────────────────────────���───────

export interface Team {
  id: number; name: string; description: string | null; created_at: string;
  jira_products: string[] | null;
  jira_project_key: string | null;
}

export class TeamQueries {
  private rowToTeam(row: Record<string, unknown>): Team {
    const raw = row.jira_products as string | null;
    let products: string[] | null = null;
    if (raw) { try { products = JSON.parse(raw); } catch { products = null; } }
    return { id: row.id as number, name: row.name as string,
      description: (row.description as string | null) ?? null, created_at: row.created_at as string,
      jira_products: products, jira_project_key: (row.jira_project_key as string | null) ?? null };
  }

  async getAll(): Promise<Team[]> {
    const rows = await query<Record<string, unknown>>(`SELECT * FROM teams ORDER BY name`);
    return rows.map(r => this.rowToTeam(r));
  }

  async getById(id: number): Promise<Team | undefined> {
    const row = await queryOne<Record<string, unknown>>(`SELECT * FROM teams WHERE id = ?`, [id]);
    return row ? this.rowToTeam(row) : undefined;
  }

  async create(name: string, description?: string): Promise<number> {
    return executeAndGetId(`INSERT INTO teams (name, description) VALUES (?, ?)`, [name, description ?? null]);
  }

  async update(id: number, updates: { name?: string; description?: string; jira_products?: string[] | null; jira_project_key?: string | null }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (updates.jira_products !== undefined) {
      fields.push('jira_products = ?');
      params.push(updates.jira_products && updates.jira_products.length > 0 ? JSON.stringify(updates.jira_products) : null);
    }
    if (updates.jira_project_key !== undefined) {
      fields.push('jira_project_key = ?');
      params.push(updates.jira_project_key?.trim() || null);
    }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async delete(id: number): Promise<boolean> {
    await execute(`UPDATE users SET team_id = NULL WHERE team_id = ?`, [id]);
    await execute(`DELETE FROM user_teams WHERE team_id = ?`, [id]);
    await execute(`DELETE FROM teams WHERE id = ?`, [id]);
    return true;
  }
}

// ─── User Teams (many-to-many) ───────────────────────────────────────────────

export class UserTeamQueries {
  async getTeamIdsForUser(userId: number): Promise<number[]> {
    const rows = await query<{ team_id: number }>(`SELECT team_id FROM user_teams WHERE user_id = ?`, [userId]);
    return rows.map(r => r.team_id);
  }

  async getTeamsForUser(userId: number, teamQueries: TeamQueries): Promise<Team[]> {
    const ids = await this.getTeamIdsForUser(userId);
    if (ids.length === 0) return [];
    const all = await teamQueries.getAll();
    const idSet = new Set(ids);
    return all.filter(t => idSet.has(t.id));
  }

  async setTeamsForUser(userId: number, teamIds: number[]): Promise<void> {
    await execute(`DELETE FROM user_teams WHERE user_id = ?`, [userId]);
    for (const tid of teamIds) {
      await execute(`INSERT INTO user_teams (user_id, team_id) VALUES (?, ?)`, [userId, tid]);
    }
    // Keep legacy team_id in sync (first team or null)
    await execute(`UPDATE users SET team_id = ?, updated_at = GETUTCDATE() WHERE id = ?`,
      [teamIds.length > 0 ? teamIds[0] : null, userId]);
  }

  async getUserIdsForTeam(teamId: number): Promise<number[]> {
    const rows = await query<{ user_id: number }>(`SELECT user_id FROM user_teams WHERE team_id = ?`, [teamId]);
    return rows.map(r => r.user_id);
  }

  async getAllUserTeamIds(): Promise<Record<number, number[]>> {
    const rows = await query<{ user_id: number; team_id: number }>(`SELECT user_id, team_id FROM user_teams`);
    const map: Record<number, number[]> = {};
    for (const r of rows) {
      if (!map[r.user_id]) map[r.user_id] = [];
      map[r.user_id].push(r.team_id);
    }
    return map;
  }
}

// ─── User Settings ────────────────────────────────────────────────────────────

export class UserSettingsQueries {
  async get(userId: number, key: string): Promise<string | null> {
    const row = await queryOne<{ value: string }>(`SELECT value FROM user_settings WHERE user_id = ? AND [key] = ?`, [userId, key]);
    return row?.value ?? null;
  }

  async set(userId: number, key: string, value: string): Promise<void> {
    await execute(`
      MERGE INTO user_settings WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?)) AS source(user_id, [key], value)
      ON target.user_id = source.user_id AND target.[key] = source.[key]
      WHEN MATCHED THEN UPDATE SET value = source.value, updated_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (user_id, [key], value, updated_at) VALUES (source.user_id, source.[key], source.value, GETUTCDATE());
    `, [userId, key, value]);
  }

  async delete(userId: number, key: string): Promise<void> {
    await execute(`DELETE FROM user_settings WHERE user_id = ? AND [key] = ?`, [userId, key]);
  }

  async getAllForUser(userId: number): Promise<Record<string, string>> {
    const rows = await query<{ key: string; value: string }>(`SELECT [key], value FROM user_settings WHERE user_id = ?`, [userId]);
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

export interface Feedback {
  id: number; user_id: number; type: 'bug' | 'question' | 'feature';
  title: string; description: string | null; status: string; created_at: string;
  admin_reply: string | null; admin_reply_at: string | null;
  admin_reply_by: number | null; task_id: number | null;
}

export class FeedbackQueries {
  async create(entry: { user_id: number; type: string; title: string; description?: string }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO feedback (user_id, type, title, description) VALUES (?, ?, ?, ?)`,
      [entry.user_id, entry.type, entry.title, entry.description ?? null]
    );
  }

  async getByUser(userId: number, filters?: { hideResolved?: boolean }): Promise<Feedback[]> {
    let sql = `SELECT * FROM feedback WHERE user_id = ?`;
    const params: unknown[] = [userId];
    if (filters?.hideResolved) { sql += ` AND status != 'resolved'`; }
    sql += ` ORDER BY created_at DESC`;
    return query<Feedback>(sql, params);
  }

  async getAll(filters?: { status?: string }): Promise<(Feedback & { username?: string })[]> {
    let sql = `SELECT f.*, u.username FROM feedback f LEFT JOIN users u ON f.user_id = u.id WHERE 1=1`;
    const params: string[] = [];
    if (filters?.status) { sql += ` AND f.status = ?`; params.push(filters.status); }
    sql += ` ORDER BY f.created_at DESC`;
    return query<Feedback & { username?: string }>(sql, params);
  }

  async updateStatus(id: number, status: string): Promise<boolean> {
    await execute(`UPDATE feedback SET status = ? WHERE id = ?`, [status, id]);
    return true;
  }

  async reply(id: number, replyText: string, adminUserId: number): Promise<boolean> {
    await execute(
      `UPDATE feedback SET admin_reply = ?, admin_reply_at = GETUTCDATE(), admin_reply_by = ?, status = 'reviewed' WHERE id = ?`,
      [replyText, adminUserId, id]
    );
    return true;
  }

  async linkTask(id: number, taskId: number): Promise<boolean> {
    await execute(`UPDATE feedback SET task_id = ? WHERE id = ?`, [taskId, id]);
    return true;
  }

  async getById(id: number): Promise<(Feedback & { username?: string }) | null> {
    return (await queryOne<Feedback & { username?: string }>(
      `SELECT f.*, u.username FROM feedback f LEFT JOIN users u ON f.user_id = u.id WHERE f.id = ?`, [id]
    )) ?? null;
  }

  async delete(id: number): Promise<boolean> {
    await execute(`DELETE FROM feedback WHERE id = ?`, [id]);
    return true;
  }
}

// ─── Onboarding Config ───────────────────────────────────────────────────────

export interface OnboardingTicketGroup {
  id: number; name: string; sort_order: number; active: number;
  display_name: string | null; traffic_light_group: string | null; created_at: string;
}
export interface OnboardingSaleType {
  id: number; name: string; sort_order: number; active: number;
  jira_tickets_required: number; created_at: string;
}
export interface OnboardingCapability {
  id: number; name: string; code: string | null; ticket_group_id: number | null;
  ticket_group_name?: string; sort_order: number; active: number;
  created_at: string; item_count?: number;
}
export interface OnboardingMatrixCell { id: number; sale_type_id: number; capability_id: number; enabled: number; notes: string | null; }
export interface OnboardingCapabilityItem {
  id: number; capability_id: number; name: string; is_bolt_on: number;
  sort_order: number; active: number; created_at: string;
}
export interface ResolvedCapability { capabilityId: number; capabilityName: string; code: string | null; items: string[]; }
export interface ResolvedTicketGroup { ticketGroupId: number | null; ticketGroupName: string; capabilities: ResolvedCapability[]; }

export class OnboardingConfigQueries {
  async getAllTicketGroups(): Promise<OnboardingTicketGroup[]> {
    return query<OnboardingTicketGroup>(`SELECT * FROM onboarding_ticket_groups ORDER BY sort_order, name`);
  }

  async createTicketGroup(name: string, sortOrder?: number): Promise<number> {
    return executeAndGetId(`INSERT INTO onboarding_ticket_groups (name, sort_order) VALUES (?, ?)`, [name, sortOrder ?? 0]);
  }

  async updateTicketGroup(id: number, updates: { name?: string; sort_order?: number; active?: number; display_name?: string | null; traffic_light_group?: string | null }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (updates.display_name !== undefined) { fields.push('display_name = ?'); params.push(updates.display_name); }
    if (updates.traffic_light_group !== undefined) { fields.push('traffic_light_group = ?'); params.push(updates.traffic_light_group); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE onboarding_ticket_groups SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteTicketGroup(id: number): Promise<boolean> {
    await execute(`UPDATE onboarding_capabilities SET ticket_group_id = NULL WHERE ticket_group_id = ?`, [id]);
    await execute(`DELETE FROM onboarding_ticket_groups WHERE id = ?`, [id]);
    return true;
  }

  async getTrafficLightGroups(): Promise<Array<{ tag: string; displayName: string }>> {
    const rows = await query<{ traffic_light_group: string; display_name: string | null }>(
      `SELECT DISTINCT traffic_light_group, display_name FROM onboarding_ticket_groups WHERE traffic_light_group IS NOT NULL AND traffic_light_group != '' ORDER BY traffic_light_group`
    );
    const results: Array<{ tag: string; displayName: string }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!seen.has(row.traffic_light_group)) {
        seen.add(row.traffic_light_group);
        results.push({ tag: row.traffic_light_group, displayName: row.display_name || row.traffic_light_group });
      }
    }
    return results;
  }

  async getAllSaleTypes(): Promise<OnboardingSaleType[]> {
    return query<OnboardingSaleType>(`SELECT * FROM onboarding_sale_types ORDER BY sort_order, name`);
  }

  async createSaleType(name: string, sortOrder?: number, jiraTicketsRequired?: number): Promise<number> {
    return executeAndGetId(
      `INSERT INTO onboarding_sale_types (name, sort_order, jira_tickets_required) VALUES (?, ?, ?)`,
      [name, sortOrder ?? 0, jiraTicketsRequired ?? 0]
    );
  }

  async updateSaleType(id: number, updates: { name?: string; sort_order?: number; active?: number }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE onboarding_sale_types SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteSaleType(id: number): Promise<boolean> {
    await execute(`DELETE FROM onboarding_matrix WHERE sale_type_id = ?`, [id]);
    await execute(`DELETE FROM onboarding_sale_types WHERE id = ?`, [id]);
    return true;
  }

  async getAllCapabilities(): Promise<OnboardingCapability[]> {
    return query<OnboardingCapability>(`
      SELECT c.*, tg.name as ticket_group_name, COUNT(i.id) as item_count
      FROM onboarding_capabilities c
      LEFT JOIN onboarding_ticket_groups tg ON c.ticket_group_id = tg.id
      LEFT JOIN onboarding_capability_items i ON c.id = i.capability_id
      GROUP BY c.id, c.name, c.code, c.ticket_group_id, c.sort_order, c.active, c.created_at, tg.name
      ORDER BY c.sort_order, c.name
    `);
  }

  async createCapability(name: string, code?: string, sortOrder?: number, ticketGroupId?: number): Promise<number> {
    return executeAndGetId(
      `INSERT INTO onboarding_capabilities (name, code, sort_order, ticket_group_id) VALUES (?, ?, ?, ?)`,
      [name, code ?? null, sortOrder ?? 0, ticketGroupId ?? null]
    );
  }

  async updateCapability(id: number, updates: { name?: string; code?: string; sort_order?: number; active?: number; ticket_group_id?: number | null }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.code !== undefined) { fields.push('code = ?'); params.push(updates.code); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (updates.ticket_group_id !== undefined) { fields.push('ticket_group_id = ?'); params.push(updates.ticket_group_id); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE onboarding_capabilities SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteCapability(id: number): Promise<boolean> {
    await execute(`DELETE FROM onboarding_capability_items WHERE capability_id = ?`, [id]);
    await execute(`DELETE FROM onboarding_matrix WHERE capability_id = ?`, [id]);
    await execute(`DELETE FROM onboarding_capabilities WHERE id = ?`, [id]);
    return true;
  }

  async getFullMatrix(): Promise<{ saleTypes: OnboardingSaleType[]; capabilities: OnboardingCapability[]; cells: OnboardingMatrixCell[]; ticketGroups: OnboardingTicketGroup[] }> {
    const [saleTypes, capabilities, ticketGroups, cells] = await Promise.all([
      this.getAllSaleTypes(),
      this.getAllCapabilities(),
      this.getAllTicketGroups(),
      query<OnboardingMatrixCell>(`SELECT * FROM onboarding_matrix`),
    ]);
    return { saleTypes, capabilities, cells, ticketGroups };
  }

  async setMatrixCell(saleTypeId: number, capabilityId: number, enabled: boolean, notes?: string | null): Promise<void> {
    await execute(`
      MERGE INTO onboarding_matrix WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?, ?)) AS source(sale_type_id, capability_id, enabled, notes)
      ON target.sale_type_id = source.sale_type_id AND target.capability_id = source.capability_id
      WHEN MATCHED THEN UPDATE SET enabled = source.enabled, notes = COALESCE(source.notes, target.notes)
      WHEN NOT MATCHED THEN INSERT (sale_type_id, capability_id, enabled, notes) VALUES (source.sale_type_id, source.capability_id, source.enabled, source.notes);
    `, [saleTypeId, capabilityId, enabled ? 1 : 0, notes ?? null]);
  }

  async batchUpdateMatrix(updates: Array<{ sale_type_id: number; capability_id: number; enabled: boolean; notes?: string | null }>): Promise<void> {
    for (const u of updates) {
      await this.setMatrixCell(u.sale_type_id, u.capability_id, u.enabled, u.notes);
    }
  }

  async resolveForSaleType(saleTypeName: string): Promise<ResolvedTicketGroup[]> {
    const st = await queryOne<{ id: number }>(`SELECT id FROM onboarding_sale_types WHERE name = ? AND active = 1`, [saleTypeName]);
    if (!st) return [];

    const caps = await query<Record<string, unknown>>(`
      SELECT c.id, c.name, c.code, c.ticket_group_id, COALESCE(tg.name, c.name) as ticket_group_name, COALESCE(tg.sort_order, c.sort_order) as group_sort
      FROM onboarding_matrix m
      JOIN onboarding_capabilities c ON m.capability_id = c.id
      LEFT JOIN onboarding_ticket_groups tg ON c.ticket_group_id = tg.id
      WHERE m.sale_type_id = ? AND m.enabled = 1 AND c.active = 1
      ORDER BY group_sort, c.sort_order, c.name
    `, [st.id]);

    const groupMap = new Map<string, ResolvedTicketGroup>();
    for (const row of caps) {
      const groupId = row.ticket_group_id as number | null;
      const groupKey = groupId != null ? `g:${groupId}` : `c:${row.id}`;
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, { ticketGroupId: groupId, ticketGroupName: row.ticket_group_name as string, capabilities: [] });
      }
      const items = await query<{ name: string }>(
        `SELECT name FROM onboarding_capability_items WHERE capability_id = ? AND active = 1 ORDER BY sort_order, name`,
        [row.id as number]
      );
      groupMap.get(groupKey)!.capabilities.push({
        capabilityId: row.id as number, capabilityName: row.name as string,
        code: (row.code as string) ?? null, items: items.map(i => i.name),
      });
    }
    return Array.from(groupMap.values());
  }

  async getItemsForCapability(capabilityId: number): Promise<OnboardingCapabilityItem[]> {
    return query<OnboardingCapabilityItem>(
      `SELECT * FROM onboarding_capability_items WHERE capability_id = ? ORDER BY sort_order, name`, [capabilityId]
    );
  }

  async createItem(capabilityId: number, name: string, isBoltOn?: boolean, sortOrder?: number): Promise<number> {
    return executeAndGetId(
      `INSERT INTO onboarding_capability_items (capability_id, name, is_bolt_on, sort_order) VALUES (?, ?, ?, ?)`,
      [capabilityId, name, isBoltOn ? 1 : 0, sortOrder ?? 0]
    );
  }

  async updateItem(id: number, updates: { name?: string; is_bolt_on?: number; sort_order?: number; active?: number }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.is_bolt_on !== undefined) { fields.push('is_bolt_on = ?'); params.push(updates.is_bolt_on); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE onboarding_capability_items SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteItem(id: number): Promise<boolean> {
    await execute(`DELETE FROM onboarding_capability_items WHERE id = ?`, [id]);
    return true;
  }

  async clearAll(): Promise<void> {
    await execute(`DELETE FROM onboarding_capability_items`);
    await execute(`DELETE FROM onboarding_matrix`);
    await execute(`DELETE FROM onboarding_capabilities`);
    await execute(`DELETE FROM onboarding_sale_types`);
    await execute(`DELETE FROM onboarding_ticket_groups`);
  }
}

// ─── Onboarding Runs ───────────────────────────────────────���─────────────────

export interface OnboardingRun {
  id: number; onboarding_ref: string; status: 'pending' | 'success' | 'partial' | 'error';
  parent_key: string | null; child_keys: string | null; created_count: number;
  linked_count: number; error_message: string | null; payload: string | null;
  dry_run: number; user_id: number | null; created_at: string; updated_at: string;
}

export class OnboardingRunQueries {
  async getByRef(ref: string): Promise<OnboardingRun | undefined> {
    return queryOne<OnboardingRun>(
      `SELECT TOP 1 * FROM onboarding_runs WHERE onboarding_ref = ? AND status = 'success' ORDER BY created_at DESC`, [ref]
    );
  }

  async getAllByRef(ref: string): Promise<OnboardingRun[]> {
    return query<OnboardingRun>(`SELECT * FROM onboarding_runs WHERE onboarding_ref = ? ORDER BY created_at DESC`, [ref]);
  }

  async getRecent(limit: number = 20): Promise<OnboardingRun[]> {
    return query<OnboardingRun>(`SELECT TOP(?) * FROM onboarding_runs ORDER BY created_at DESC`, [limit]);
  }

  async create(run: { onboarding_ref: string; payload?: string; user_id?: number; dry_run?: boolean }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO onboarding_runs (onboarding_ref, payload, user_id, dry_run) VALUES (?, ?, ?, ?)`,
      [run.onboarding_ref, run.payload ?? null, run.user_id ?? null, run.dry_run ? 1 : 0]
    );
  }

  async update(id: number, updates: Partial<Pick<OnboardingRun, 'status' | 'parent_key' | 'child_keys' | 'created_count' | 'linked_count' | 'error_message'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    fields.push(`updated_at = GETUTCDATE()`);
    params.push(id);
    await execute(`UPDATE onboarding_runs SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async getMaxRefNumber(prefix: string): Promise<number> {
    const row = await queryOne<{ onboarding_ref: string }>(
      `SELECT TOP 1 onboarding_ref FROM onboarding_runs WHERE onboarding_ref LIKE ? ORDER BY onboarding_ref DESC`,
      [`${prefix}%`]
    );
    if (!row) return 0;
    const numPart = parseInt(row.onboarding_ref.substring(prefix.length), 10);
    return !isNaN(numPart) ? numPart : 0;
  }
}

// ─── Milestone Templates & Delivery Milestones ───────────────────────────────

export interface MilestoneTemplate {
  id: number; name: string; day_offset: number; sort_order: number;
  checklist_json: string; lead_days: number; active: number;
  tickets_enabled: number; created_at: string; updated_at: string;
}
export interface DeliveryMilestone {
  id: number; delivery_id: number; template_id: number; template_name: string;
  target_date: string | null; actual_date: string | null; status: string;
  checklist_state_json: string; notes: string | null;
  workflow_task_created: number; workflow_tickets_created: number;
  jira_keys: string | null; assigned_to: number | null;
  created_at: string; updated_at: string;
}
export interface WorkflowReadyMilestone extends DeliveryMilestone {
  lead_days: number; account: string; product: string;
  sale_type: string | null; onboarding_id: string | null; onboarder: string | null;
}

export class MilestoneQueries {
  async getAllTemplates(activeOnly = false): Promise<MilestoneTemplate[]> {
    const sql = activeOnly
      ? `SELECT * FROM milestone_templates WHERE active = 1 ORDER BY sort_order, name`
      : `SELECT * FROM milestone_templates ORDER BY sort_order, name`;
    return query<MilestoneTemplate>(sql);
  }

  async getTemplateById(id: number): Promise<MilestoneTemplate | undefined> {
    return queryOne<MilestoneTemplate>(`SELECT * FROM milestone_templates WHERE id = ?`, [id]);
  }

  async createTemplate(data: { name: string; day_offset: number; sort_order?: number; checklist_json?: string }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO milestone_templates (name, day_offset, sort_order, checklist_json) VALUES (?, ?, ?, ?)`,
      [data.name, data.day_offset, data.sort_order ?? 0, data.checklist_json ?? '[]']
    );
  }

  async updateTemplate(id: number, updates: Partial<Pick<MilestoneTemplate, 'name' | 'day_offset' | 'sort_order' | 'checklist_json' | 'lead_days' | 'active' | 'tickets_enabled'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.day_offset !== undefined) { fields.push('day_offset = ?'); params.push(updates.day_offset); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.checklist_json !== undefined) { fields.push('checklist_json = ?'); params.push(updates.checklist_json); }
    if (updates.lead_days !== undefined) { fields.push('lead_days = ?'); params.push(updates.lead_days); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (updates.tickets_enabled !== undefined) { fields.push('tickets_enabled = ?'); params.push(updates.tickets_enabled); }
    if (fields.length === 0) return false;
    fields.push(`updated_at = GETUTCDATE()`);
    params.push(id);
    await execute(`UPDATE milestone_templates SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteTemplate(id: number): Promise<boolean> {
    await execute(`DELETE FROM milestone_templates WHERE id = ?`, [id]);
    return true;
  }

  async getMatrixOffsets(): Promise<Array<{ sale_type_id: number; template_id: number; day_offset: number }>> {
    return query<{ sale_type_id: number; template_id: number; day_offset: number }>(`SELECT sale_type_id, template_id, day_offset FROM milestone_sale_type_offsets`);
  }

  async setMatrixOffset(saleTypeId: number, templateId: number, dayOffset: number): Promise<void> {
    await execute(`
      MERGE INTO milestone_sale_type_offsets WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?)) AS source(sale_type_id, template_id, day_offset)
      ON target.sale_type_id = source.sale_type_id AND target.template_id = source.template_id
      WHEN MATCHED THEN UPDATE SET day_offset = source.day_offset
      WHEN NOT MATCHED THEN INSERT (sale_type_id, template_id, day_offset) VALUES (source.sale_type_id, source.template_id, source.day_offset);
    `, [saleTypeId, templateId, dayOffset]);
  }

  async batchSetMatrixOffsets(updates: Array<{ sale_type_id: number; template_id: number; day_offset: number }>): Promise<void> {
    for (const u of updates) await this.setMatrixOffset(u.sale_type_id, u.template_id, u.day_offset);
  }

  async deleteMatrixRow(saleTypeId: number): Promise<void> {
    await execute(`DELETE FROM milestone_sale_type_offsets WHERE sale_type_id = ?`, [saleTypeId]);
  }

  async getOffsetsForSaleType(saleTypeName: string): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    const templates = await this.getAllTemplates(true);
    for (const t of templates) result.set(t.id, t.day_offset);
    const rows = await query<{ template_id: number; day_offset: number }>(`
      SELECT mso.template_id, mso.day_offset
      FROM milestone_sale_type_offsets mso
      JOIN onboarding_sale_types ost ON mso.sale_type_id = ost.id
      WHERE ost.name = ? AND ost.active = 1
    `, [saleTypeName]);
    for (const row of rows) result.set(row.template_id, row.day_offset);
    return result;
  }

  async getByDelivery(deliveryId: number): Promise<DeliveryMilestone[]> {
    return query<DeliveryMilestone>(`SELECT * FROM delivery_milestones WHERE delivery_id = ? ORDER BY target_date, template_name`, [deliveryId]);
  }

  async getMilestoneById(id: number): Promise<DeliveryMilestone | undefined> {
    return queryOne<DeliveryMilestone>(`SELECT * FROM delivery_milestones WHERE id = ?`, [id]);
  }

  async createForDelivery(deliveryId: number, startDate: string, saleType?: string): Promise<DeliveryMilestone[]> {
    const templates = await this.getAllTemplates(true);
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return [];
    const saleTypeOffsets = saleType ? await this.getOffsetsForSaleType(saleType) : null;

    for (const tmpl of templates) {
      const dayOffset = saleTypeOffsets?.get(tmpl.id) ?? tmpl.day_offset;
      const target = new Date(start);
      target.setDate(target.getDate() + dayOffset);
      const targetStr = target.toISOString().split('T')[0];
      let stateJson = '[]';
      try {
        const items = JSON.parse(tmpl.checklist_json || '[]');
        if (Array.isArray(items)) stateJson = JSON.stringify(items.map((text: string) => ({ text, checked: false })));
      } catch { /* keep empty */ }
      await execute(
        `INSERT INTO delivery_milestones (delivery_id, template_id, template_name, target_date, checklist_state_json) VALUES (?, ?, ?, ?, ?)`,
        [deliveryId, tmpl.id, tmpl.name, targetStr, stateJson]
      );
    }
    return this.getByDelivery(deliveryId);
  }

  async updateMilestone(id: number, updates: Partial<Pick<DeliveryMilestone, 'status' | 'actual_date' | 'checklist_state_json' | 'notes' | 'target_date' | 'jira_keys' | 'assigned_to'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.actual_date !== undefined) { fields.push('actual_date = ?'); params.push(updates.actual_date); }
    if (updates.checklist_state_json !== undefined) { fields.push('checklist_state_json = ?'); params.push(updates.checklist_state_json); }
    if (updates.notes !== undefined) { fields.push('notes = ?'); params.push(updates.notes); }
    if (updates.target_date !== undefined) { fields.push('target_date = ?'); params.push(updates.target_date); }
    if (updates.jira_keys !== undefined) { fields.push('jira_keys = ?'); params.push(updates.jira_keys); }
    if (updates.assigned_to !== undefined) { fields.push('assigned_to = ?'); params.push(updates.assigned_to); }
    if (fields.length === 0) return false;
    fields.push(`updated_at = GETUTCDATE()`);
    params.push(id);
    await execute(`UPDATE delivery_milestones SET ${fields.join(', ')} WHERE id = ?`, params);
    return (await this.getMilestoneById(id)) !== undefined;
  }

  async deleteByDelivery(deliveryId: number): Promise<number> {
    const row = await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM delivery_milestones WHERE delivery_id = ?`, [deliveryId]);
    const count = row?.c ?? 0;
    await execute(`DELETE FROM delivery_milestones WHERE delivery_id = ?`, [deliveryId]);
    return count;
  }

  async getOverdueSummaryByDelivery(deliveryIds: number[]): Promise<Map<number, { overdueCount: number; totalCount: number; completeCount: number; nextOverdue: string | null }>> {
    const result = new Map<number, { overdueCount: number; totalCount: number; completeCount: number; nextOverdue: string | null }>();
    if (deliveryIds.length === 0) return result;
    const placeholders = deliveryIds.map(() => '?').join(',');
    const rows = await query<Record<string, unknown>>(`
      SELECT delivery_id,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
        SUM(CASE WHEN status != 'complete' AND target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as overdue,
        MIN(CASE WHEN status != 'complete' AND target_date < CAST(GETUTCDATE() AS DATE) THEN template_name END) as next_overdue
      FROM delivery_milestones
      WHERE delivery_id IN (${placeholders})
      GROUP BY delivery_id
    `, deliveryIds);
    for (const row of rows) {
      result.set(row.delivery_id as number, {
        overdueCount: (row.overdue as number) ?? 0, totalCount: (row.total as number) ?? 0,
        completeCount: (row.complete as number) ?? 0, nextOverdue: (row.next_overdue as string) ?? null,
      });
    }
    return result;
  }

  async getAllWithDelivery(): Promise<Array<DeliveryMilestone & { account: string; product: string; onboarding_id: string | null; onboarder: string | null }>> {
    return query<any>(`
      SELECT dm.*, de.account, de.product, de.onboarding_id, de.onboarder
      FROM delivery_milestones dm
      JOIN delivery_entries de ON dm.delivery_id = de.id
      ORDER BY dm.target_date, de.account, dm.template_name
    `);
  }

  async getOverdue(onboarderName?: string): Promise<Array<DeliveryMilestone & { account: string; product: string; onboarding_id: string | null; onboarder: string | null }>> {
    let sql = `
      SELECT dm.*, de.account, de.product, de.onboarding_id, de.onboarder
      FROM delivery_milestones dm
      JOIN delivery_entries de ON dm.delivery_id = de.id
      WHERE dm.status != 'complete'
        AND dm.target_date IS NOT NULL
        AND dm.target_date < CAST(GETUTCDATE() AS DATE)`;
    const params: unknown[] = [];
    if (onboarderName) {
      sql += ` AND LOWER(de.onboarder) LIKE ?`;
      params.push(`%${onboarderName.toLowerCase()}%`);
    }
    sql += ` ORDER BY dm.target_date, de.account, dm.template_name`;
    return query<any>(sql, params);
  }

  async getSummary(): Promise<{ total: number; pending: number; in_progress: number; complete: number; overdue: number }> {
    const row = await queryOne<Record<string, unknown>>(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
        SUM(CASE WHEN status != 'complete' AND target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as overdue
      FROM delivery_milestones
    `);
    if (!row) return { total: 0, pending: 0, in_progress: 0, complete: 0, overdue: 0 };
    return {
      total: (row.total as number) ?? 0, pending: (row.pending as number) ?? 0,
      in_progress: (row.in_progress as number) ?? 0, complete: (row.complete as number) ?? 0,
      overdue: (row.overdue as number) ?? 0,
    };
  }

  async getOverdueDeliveries(): Promise<Array<{
    delivery_id: number; onboarding_id: string | null; account: string; product: string;
    onboarder: string | null; status: string; go_live_date: string | null;
    overdue_count: number; total_count: number; complete_count: number;
    oldest_overdue_name: string; oldest_overdue_date: string;
  }>> {
    return query<any>(`
      SELECT
        de.id as delivery_id, de.onboarding_id, de.account, de.product,
        de.onboarder, de.status, de.go_live_date,
        COUNT(*) as total_count,
        SUM(CASE WHEN dm.status = 'complete' THEN 1 ELSE 0 END) as complete_count,
        SUM(CASE WHEN dm.status != 'complete' AND dm.target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as overdue_count,
        (SELECT TOP 1 dm2.template_name FROM delivery_milestones dm2
         WHERE dm2.delivery_id = de.id AND dm2.status != 'complete' AND dm2.target_date < CAST(GETUTCDATE() AS DATE)
         ORDER BY dm2.target_date ASC) as oldest_overdue_name,
        (SELECT TOP 1 dm2.target_date FROM delivery_milestones dm2
         WHERE dm2.delivery_id = de.id AND dm2.status != 'complete' AND dm2.target_date < CAST(GETUTCDATE() AS DATE)
         ORDER BY dm2.target_date ASC) as oldest_overdue_date
      FROM delivery_milestones dm
      JOIN delivery_entries de ON dm.delivery_id = de.id
      GROUP BY de.id, de.onboarding_id, de.account, de.product, de.onboarder, de.status, de.go_live_date
      HAVING SUM(CASE WHEN dm.status != 'complete' AND dm.target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) > 0
      ORDER BY SUM(CASE WHEN dm.status != 'complete' AND dm.target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) DESC
    `);
  }

  async completeMatchingDeliveries(deliveryStatus: string, product?: string): Promise<{ deliveries: number; milestones: number }> {
    const productClause = product ? ` AND de.product = ?` : '';
    const params: string[] = [deliveryStatus];
    if (product) params.push(product);

    const row = await queryOne<{ deliveries: number; milestones: number }>(`
      SELECT COUNT(DISTINCT de.id) as deliveries, COUNT(dm.id) as milestones
      FROM delivery_milestones dm JOIN delivery_entries de ON dm.delivery_id = de.id
      WHERE LOWER(de.status) = LOWER(?) ${productClause} AND dm.status != 'complete'
    `, params);
    const deliveries = row?.deliveries ?? 0;
    const milestones = row?.milestones ?? 0;
    if (milestones === 0) return { deliveries: 0, milestones: 0 };

    await execute(`
      UPDATE delivery_milestones SET status = 'complete', actual_date = CAST(GETUTCDATE() AS DATE), updated_at = GETUTCDATE()
      WHERE status != 'complete'
        AND delivery_id IN (
          SELECT de.id FROM delivery_entries de WHERE LOWER(de.status) = LOWER(?) ${productClause}
        )
    `, params);
    return { deliveries, milestones };
  }

  async getNextPendingByDelivery(deliveryIds: number[]): Promise<Map<number, { name: string; target_date: string; status: string }>> {
    const result = new Map<number, { name: string; target_date: string; status: string }>();
    if (deliveryIds.length === 0) return result;
    const placeholders = deliveryIds.map(() => '?').join(',');
    const rows = await query<Record<string, unknown>>(`
      SELECT delivery_id, template_name, target_date, status
      FROM delivery_milestones
      WHERE delivery_id IN (${placeholders}) AND status != 'complete'
      ORDER BY target_date ASC
    `, deliveryIds);
    const seen = new Set<number>();
    for (const row of rows) {
      const did = row.delivery_id as number;
      if (seen.has(did)) continue;
      seen.add(did);
      result.set(did, { name: row.template_name as string, target_date: (row.target_date as string) ?? '', status: row.status as string });
    }
    return result;
  }

  async getTemplateTicketGroups(templateId: number): Promise<number[]> {
    const rows = await query<{ ticket_group_id: number }>(
      `SELECT ticket_group_id FROM milestone_template_ticket_groups WHERE template_id = ? ORDER BY ticket_group_id`, [templateId]
    );
    return rows.map(r => r.ticket_group_id);
  }

  async setTemplateTicketGroups(templateId: number, ticketGroupIds: number[]): Promise<void> {
    await execute(`DELETE FROM milestone_template_ticket_groups WHERE template_id = ?`, [templateId]);
    for (const gid of ticketGroupIds) {
      await execute(`INSERT INTO milestone_template_ticket_groups (template_id, ticket_group_id) VALUES (?, ?)`, [templateId, gid]);
    }
  }

  async getAllTemplateTicketGroupMappings(): Promise<Array<{ template_id: number; ticket_group_id: number }>> {
    return query<{ template_id: number; ticket_group_id: number }>(`SELECT template_id, ticket_group_id FROM milestone_template_ticket_groups`);
  }

  async getMilestonesReadyForWorkflow(): Promise<WorkflowReadyMilestone[]> {
    return query<WorkflowReadyMilestone>(`
      SELECT dm.*, mt.lead_days, de.account, de.product, de.sale_type, de.onboarding_id, de.onboarder
      FROM delivery_milestones dm
      JOIN milestone_templates mt ON dm.template_id = mt.id
      JOIN delivery_entries de ON dm.delivery_id = de.id
      WHERE dm.status != 'complete'
        AND dm.workflow_task_created = 0
        AND dm.target_date IS NOT NULL
        AND DATEADD(day, -COALESCE(mt.lead_days, 3), dm.target_date) <= CAST(GETUTCDATE() AS DATE)
      ORDER BY dm.target_date ASC
    `);
  }

  async markWorkflowTaskCreated(milestoneId: number): Promise<void> {
    await execute(`UPDATE delivery_milestones SET workflow_task_created = 1, updated_at = GETUTCDATE() WHERE id = ?`, [milestoneId]);
  }

  async markWorkflowTicketsCreated(milestoneId: number, jiraKeys: string[]): Promise<void> {
    await execute(
      `UPDATE delivery_milestones SET workflow_tickets_created = 1, jira_keys = ?, updated_at = GETUTCDATE() WHERE id = ?`,
      [JSON.stringify(jiraKeys), milestoneId]
    );
  }

  async getNextMilestoneForDelivery(deliveryId: number, afterTemplateId: number): Promise<(DeliveryMilestone & { lead_days: number }) | undefined> {
    return queryOne<DeliveryMilestone & { lead_days: number }>(`
      SELECT TOP 1 dm.*, mt.lead_days
      FROM delivery_milestones dm
      JOIN milestone_templates mt ON dm.template_id = mt.id
      WHERE dm.delivery_id = ? AND dm.status != 'complete' AND dm.workflow_task_created = 0
        AND mt.sort_order > (SELECT sort_order FROM milestone_templates WHERE id = ?)
      ORDER BY mt.sort_order ASC
    `, [deliveryId, afterTemplateId]);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export class SettingsQueries {
  async get(key: string): Promise<string | null> {
    const row = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE [key] = ?`, [key]);
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await execute(`
      MERGE INTO settings WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?)) AS source([key], value)
      ON target.[key] = source.[key]
      WHEN MATCHED THEN UPDATE SET value = source.value, updated_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT ([key], value, updated_at) VALUES (source.[key], source.value, GETUTCDATE());
    `, [key, value]);
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await query<{ key: string; value: string }>(`SELECT [key], value FROM settings`);
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }
}

// ─── Problem Ticket Detection ─────────────────────────────���───────────────────

export interface ProblemTicketAlert {
  id: number; issue_key: string; project_key: string; summary: string;
  status: string | null; priority: string | null; assignee: string | null;
  reporter: string | null; created_at: string | null; severity: string;
  score: number; fingerprint: string; first_seen: string; last_seen: string;
  resolved_at: string | null; sla_remaining_ms: number | null;
  sentiment_score: number | null; sentiment_summary: string | null;
  scan_id: string; last_analysed_at: string | null; reasons?: ProblemTicketAlertReason[];
}
export interface ProblemTicketAlertReason { rule: string; label: string; weight: number; detail: string | null; }
export interface ProblemTicketIgnore {
  id: number; issue_key: string; ignored_by: string; reason: string | null;
  fingerprint_at_ignore: string; ignored_at: string; lifted_at: string | null; lifted_reason: string | null;
}
export interface ProblemTicketConfigRow { rule: string; enabled: boolean; weight: number; threshold_json: string; }

export class ProblemTicketQueries {
  async upsertAlert(
    alert: Omit<ProblemTicketAlert, 'id' | 'first_seen' | 'last_seen' | 'resolved_at' | 'reasons' | 'last_analysed_at'>,
    reasons: Omit<ProblemTicketAlertReason, 'alert_id'>[]
  ): Promise<number> {
    await execute(`
      MERGE INTO problem_ticket_alerts WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?))
        AS source(issue_key, project_key, summary, status, priority, assignee, reporter,
                  created_at, severity, score, fingerprint, sla_remaining_ms,
                  sentiment_score, sentiment_summary, scan_id)
      ON target.issue_key = source.issue_key
      WHEN MATCHED THEN UPDATE SET
        project_key=source.project_key, summary=source.summary, status=source.status,
        priority=source.priority, assignee=source.assignee, reporter=source.reporter,
        created_at=source.created_at, severity=source.severity, score=source.score,
        fingerprint=source.fingerprint, sla_remaining_ms=source.sla_remaining_ms,
        sentiment_score=source.sentiment_score, sentiment_summary=source.sentiment_summary,
        scan_id=source.scan_id, last_seen=GETUTCDATE(), resolved_at=NULL
      WHEN NOT MATCHED THEN INSERT (issue_key, project_key, summary, status, priority, assignee, reporter,
        created_at, severity, score, fingerprint, sla_remaining_ms, sentiment_score, sentiment_summary, scan_id, last_seen)
        VALUES (source.issue_key, source.project_key, source.summary, source.status, source.priority, source.assignee, source.reporter,
          source.created_at, source.severity, source.score, source.fingerprint, source.sla_remaining_ms,
          source.sentiment_score, source.sentiment_summary, source.scan_id, GETUTCDATE());
    `, [
      alert.issue_key, alert.project_key, alert.summary, alert.status,
      alert.priority, alert.assignee, alert.reporter, alert.created_at,
      alert.severity, alert.score, alert.fingerprint, alert.sla_remaining_ms,
      alert.sentiment_score, alert.sentiment_summary, alert.scan_id,
    ]);

    const idRow = await queryOne<{ id: number }>(`SELECT id FROM problem_ticket_alerts WHERE issue_key = ?`, [alert.issue_key]);
    const alertId = idRow?.id ?? 0;

    await execute(`DELETE FROM problem_ticket_alert_reasons WHERE alert_id = ?`, [alertId]);
    for (const r of reasons) {
      await execute(
        `INSERT INTO problem_ticket_alert_reasons (alert_id, [rule], label, weight, detail) VALUES (?, ?, ?, ?, ?)`,
        [alertId, r.rule, r.label, r.weight, r.detail ?? null]
      );
    }
    return alertId;
  }

  async getActiveAlerts(filters?: { severity?: string; projectKey?: string }): Promise<ProblemTicketAlert[]> {
    let sql = `
      SELECT a.* FROM problem_ticket_alerts a
      WHERE a.resolved_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM problem_ticket_ignores i
          WHERE i.issue_key = a.issue_key AND i.lifted_at IS NULL AND i.fingerprint_at_ignore = a.fingerprint
        )
    `;
    const params: unknown[] = [];
    if (filters?.severity) { sql += ` AND a.severity = ?`; params.push(filters.severity); }
    if (filters?.projectKey) { sql += ` AND a.project_key = ?`; params.push(filters.projectKey); }
    sql += ` ORDER BY a.score DESC, a.last_seen DESC`;

    const alerts = await query<Record<string, unknown>>(sql, params);
    const result: ProblemTicketAlert[] = [];
    for (const row of alerts) {
      const a = this.rowToAlert(row);
      a.reasons = await this.getReasonsForAlert(a.id);
      result.push(a);
    }
    return result;
  }

  async getAlertByIssueKey(issueKey: string): Promise<ProblemTicketAlert | null> {
    const row = await queryOne<Record<string, unknown>>(`SELECT * FROM problem_ticket_alerts WHERE issue_key = ?`, [issueKey]);
    if (!row) return null;
    const alert = this.rowToAlert(row);
    alert.reasons = await this.getReasonsForAlert(alert.id);
    return alert;
  }

  private async getReasonsForAlert(alertId: number): Promise<ProblemTicketAlertReason[]> {
    return query<ProblemTicketAlertReason>(
      `SELECT [rule], label, weight, detail FROM problem_ticket_alert_reasons WHERE alert_id = ? ORDER BY weight DESC`, [alertId]
    );
  }

  async insertIgnore(issueKey: string, ignoredBy: string, reason: string | null, fingerprint: string): Promise<void> {
    await execute(
      `INSERT INTO problem_ticket_ignores (issue_key, ignored_by, reason, fingerprint_at_ignore) VALUES (?, ?, ?, ?)`,
      [issueKey, ignoredBy, reason, fingerprint]
    );
  }

  async getIgnoresForIssue(issueKey: string): Promise<ProblemTicketIgnore[]> {
    return query<ProblemTicketIgnore>(`SELECT * FROM problem_ticket_ignores WHERE issue_key = ? ORDER BY ignored_at DESC`, [issueKey]);
  }

  async liftIgnore(issueKey: string, reason: string): Promise<void> {
    await execute(
      `UPDATE problem_ticket_ignores SET lifted_at = GETUTCDATE(), lifted_reason = ? WHERE issue_key = ? AND lifted_at IS NULL`,
      [reason, issueKey]
    );
  }

  async getConfig(): Promise<ProblemTicketConfigRow[]> {
    const rows = await query<Record<string, unknown>>(`SELECT * FROM problem_ticket_config ORDER BY [rule]`);
    return rows.map(row => ({
      rule: row.rule as string, enabled: (row.enabled as number) === 1,
      weight: row.weight as number, threshold_json: (row.threshold_json as string) ?? '{}',
    }));
  }

  async updateConfig(rule: string, updates: { enabled?: boolean; weight?: number; threshold_json?: string }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
    if (updates.weight !== undefined) { sets.push('weight = ?'); params.push(updates.weight); }
    if (updates.threshold_json !== undefined) { sets.push('threshold_json = ?'); params.push(updates.threshold_json); }
    if (sets.length === 0) return;
    params.push(rule);
    await execute(`UPDATE problem_ticket_config SET ${sets.join(', ')} WHERE [rule] = ?`, params);
  }

  async markResolved(activeIssueKeys: string[]): Promise<number> {
    if (activeIssueKeys.length === 0) {
      const row = await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM problem_ticket_alerts WHERE resolved_at IS NULL`);
      const count = row?.c ?? 0;
      if (count > 0) await execute(`UPDATE problem_ticket_alerts SET resolved_at = GETUTCDATE() WHERE resolved_at IS NULL`);
      return count;
    }
    const placeholders = activeIssueKeys.map(() => '?').join(',');
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM problem_ticket_alerts WHERE resolved_at IS NULL AND issue_key NOT IN (${placeholders})`,
      activeIssueKeys
    );
    const count = row?.c ?? 0;
    if (count > 0) {
      await execute(
        `UPDATE problem_ticket_alerts SET resolved_at = GETUTCDATE() WHERE resolved_at IS NULL AND issue_key NOT IN (${placeholders})`,
        activeIssueKeys
      );
    }
    return count;
  }

  async getStats(): Promise<{ p1: number; p2: number; p3: number; total: number; ignored: number; lastScan: string | null }> {
    const counts = await query<{ severity: string; cnt: number }>(`
      SELECT severity, COUNT(*) as cnt FROM problem_ticket_alerts WHERE resolved_at IS NULL GROUP BY severity
    `);
    let p1 = 0, p2 = 0, p3 = 0;
    for (const row of counts) {
      if (row.severity === 'P1') p1 = row.cnt;
      else if (row.severity === 'P2') p2 = row.cnt;
      else if (row.severity === 'P3') p3 = row.cnt;
    }
    const ignoredRow = await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM problem_ticket_ignores WHERE lifted_at IS NULL`);
    const ignored = ignoredRow?.c ?? 0;
    const lastScanRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE [key] = 'problem_ticket_last_scan'`);
    const lastScan = lastScanRow?.value ?? null;
    return { p1, p2, p3, total: p1 + p2 + p3, ignored, lastScan };
  }

  async cleanupOld(daysToKeep = 30): Promise<number> {
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM problem_ticket_alerts WHERE resolved_at IS NOT NULL AND resolved_at < DATEADD(day, -?, GETUTCDATE())`,
      [daysToKeep]
    );
    const count = row?.c ?? 0;
    if (count > 0) {
      await execute(
        `DELETE FROM problem_ticket_alerts WHERE resolved_at IS NOT NULL AND resolved_at < DATEADD(day, -?, GETUTCDATE())`,
        [daysToKeep]
      );
    }
    return count;
  }

  private rowToAlert(row: Record<string, unknown>): ProblemTicketAlert {
    return {
      id: row.id as number, issue_key: row.issue_key as string, project_key: row.project_key as string,
      summary: row.summary as string, status: (row.status as string) ?? null,
      priority: (row.priority as string) ?? null, assignee: (row.assignee as string) ?? null,
      reporter: (row.reporter as string) ?? null, created_at: (row.created_at as string) ?? null,
      severity: row.severity as string, score: row.score as number,
      fingerprint: row.fingerprint as string, first_seen: row.first_seen as string,
      last_seen: row.last_seen as string, resolved_at: (row.resolved_at as string) ?? null,
      sla_remaining_ms: (row.sla_remaining_ms as number) ?? null,
      sentiment_score: (row.sentiment_score as number) ?? null,
      sentiment_summary: (row.sentiment_summary as string) ?? null, scan_id: row.scan_id as string,
      last_analysed_at: (row.last_analysed_at as string) ?? null,
    };
  }

  async markAnalysed(issueKeys: string[]): Promise<void> {
    if (issueKeys.length === 0) return;
    const placeholders = issueKeys.map(() => '?').join(',');
    await execute(
      `UPDATE problem_ticket_alerts SET last_analysed_at = GETUTCDATE() WHERE issue_key IN (${placeholders})`,
      issueKeys
    );
  }
}

// ─── Instance Setup ──────────────────────────────────────────────────────────

export interface SetupStepTemplate {
  id: number; product: string; step_key: string; step_label: string; sort_order: number; required: number;
}
export interface SetupStep {
  id: number; delivery_id: number; step_key: string; step_label: string;
  status: string; result_message: string | null; executed_at: string | null; executed_by: number | null;
}

export class InstanceSetupQueries {
  async getTemplatesByProduct(product: string): Promise<SetupStepTemplate[]> {
    return query<SetupStepTemplate>(`SELECT * FROM instance_setup_step_templates WHERE product = ? ORDER BY sort_order`, [product]);
  }

  async getAllTemplates(): Promise<SetupStepTemplate[]> {
    return query<SetupStepTemplate>(`SELECT * FROM instance_setup_step_templates ORDER BY product, sort_order`);
  }

  async getDistinctProducts(): Promise<string[]> {
    const rows = await query<{ product: string }>(`SELECT DISTINCT product FROM instance_setup_step_templates ORDER BY product`);
    return rows.map(r => r.product);
  }

  async createTemplate(data: { product: string; step_key: string; step_label: string; sort_order?: number; required?: number }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO instance_setup_step_templates (product, step_key, step_label, sort_order, required) VALUES (?, ?, ?, ?, ?)`,
      [data.product, data.step_key, data.step_label, data.sort_order ?? 0, data.required ?? 1]
    );
  }

  async updateTemplate(id: number, updates: Partial<Pick<SetupStepTemplate, 'step_label' | 'sort_order' | 'required'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.step_label !== undefined) { fields.push('step_label = ?'); params.push(updates.step_label); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.required !== undefined) { fields.push('required = ?'); params.push(updates.required); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE instance_setup_step_templates SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteTemplate(id: number): Promise<void> {
    await execute(`DELETE FROM instance_setup_step_templates WHERE id = ?`, [id]);
  }

  async getByDelivery(deliveryId: number): Promise<SetupStep[]> {
    return query<SetupStep>(`SELECT * FROM instance_setup_steps WHERE delivery_id = ? ORDER BY step_key`, [deliveryId]);
  }

  async initializeSteps(deliveryId: number, product: string): Promise<number> {
    const templates = await this.getTemplatesByProduct(product);
    let created = 0;
    for (const tmpl of templates) {
      try {
        const existing = await queryOne<{ id: number }>(
          `SELECT id FROM instance_setup_steps WHERE delivery_id = ? AND step_key = ?`, [deliveryId, tmpl.step_key]
        );
        if (!existing) {
          await execute(
            `INSERT INTO instance_setup_steps (delivery_id, step_key, step_label) VALUES (?, ?, ?)`,
            [deliveryId, tmpl.step_key, tmpl.step_label]
          );
          created++;
        }
      } catch { /* skip duplicates */ }
    }
    return created;
  }

  async updateStepStatus(deliveryId: number, stepKey: string, status: string, resultMessage?: string, executedBy?: number): Promise<boolean> {
    const now = ['complete', 'failed'].includes(status) ? new Date().toISOString() : null;
    const result = await execute(
      `UPDATE instance_setup_steps SET status = ?, result_message = COALESCE(?, result_message), executed_at = COALESCE(?, executed_at), executed_by = COALESCE(?, executed_by) WHERE delivery_id = ? AND step_key = ?`,
      [status, resultMessage ?? null, now, executedBy ?? null, deliveryId, stepKey]
    );
    return result.rowsAffected > 0;
  }

  async deleteStepsForDelivery(deliveryId: number): Promise<void> {
    await execute(`DELETE FROM instance_setup_steps WHERE delivery_id = ?`, [deliveryId]);
  }

  async getBulkProgress(deliveryIds: number[]): Promise<Record<number, { total: number; complete: number; failed: number }>> {
    if (deliveryIds.length === 0) return {};
    const placeholders = deliveryIds.map(() => '?').join(',');
    const rows = await query<{ delivery_id: number; status: string; cnt: number }>(
      `SELECT delivery_id, status, COUNT(*) as cnt FROM instance_setup_steps WHERE delivery_id IN (${placeholders}) GROUP BY delivery_id, status`,
      deliveryIds
    );
    const result: Record<number, { total: number; complete: number; failed: number }> = {};
    for (const row of rows) {
      if (!result[row.delivery_id]) result[row.delivery_id] = { total: 0, complete: 0, failed: 0 };
      result[row.delivery_id].total += row.cnt;
      if (row.status === 'complete') result[row.delivery_id].complete += row.cnt;
      if (row.status === 'failed') result[row.delivery_id].failed += row.cnt;
    }
    return result;
  }
}

// ─── Branches ─────────────────────────────────────────────────────────────────

export interface DeliveryBranch {
  id: number; delivery_id: number; is_default: number; name: string;
  sales_email: string | null; sales_phone: string | null;
  lettings_email: string | null; lettings_phone: string | null;
  address1: string | null; address2: string | null; address3: string | null;
  town: string | null; post_code1: string | null; post_code2: string | null;
  sort_order: number; created_at: string;
}

export class BranchQueries {
  async getByDelivery(deliveryId: number): Promise<DeliveryBranch[]> {
    return query<DeliveryBranch>(`SELECT * FROM delivery_branches WHERE delivery_id = ? ORDER BY is_default DESC, sort_order, name`, [deliveryId]);
  }

  async getById(id: number): Promise<DeliveryBranch | undefined> {
    return queryOne<DeliveryBranch>(`SELECT * FROM delivery_branches WHERE id = ?`, [id]);
  }

  async create(data: Omit<DeliveryBranch, 'id' | 'created_at'>): Promise<number> {
    return executeAndGetId(
      `INSERT INTO delivery_branches (delivery_id, is_default, name, sales_email, sales_phone, lettings_email, lettings_phone, address1, address2, address3, town, post_code1, post_code2, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.delivery_id, data.is_default ?? 0, data.name, data.sales_email ?? null, data.sales_phone ?? null,
       data.lettings_email ?? null, data.lettings_phone ?? null, data.address1 ?? null, data.address2 ?? null,
       data.address3 ?? null, data.town ?? null, data.post_code1 ?? null, data.post_code2 ?? null, data.sort_order ?? 0]
    );
  }

  async update(id: number, updates: Partial<Omit<DeliveryBranch, 'id' | 'delivery_id' | 'created_at'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    params.push(id);
    const result = await execute(`UPDATE delivery_branches SET ${fields.join(', ')} WHERE id = ?`, params);
    return result.rowsAffected > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await execute(`DELETE FROM delivery_branches WHERE id = ?`, [id]);
    return result.rowsAffected > 0;
  }

  async bulkCreate(deliveryId: number, branches: Array<Omit<DeliveryBranch, 'id' | 'delivery_id' | 'created_at'>>): Promise<number> {
    let created = 0;
    for (const b of branches) {
      try {
        const existing = await queryOne<{ id: number }>(
          `SELECT id FROM delivery_branches WHERE delivery_id = ? AND name = ?`, [deliveryId, b.name]
        );
        if (!existing) {
          await execute(
            `INSERT INTO delivery_branches (delivery_id, is_default, name, sales_email, sales_phone, lettings_email, lettings_phone, address1, address2, address3, town, post_code1, post_code2, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [deliveryId, b.is_default ?? 0, b.name, b.sales_email ?? null, b.sales_phone ?? null,
             b.lettings_email ?? null, b.lettings_phone ?? null, b.address1 ?? null, b.address2 ?? null,
             b.address3 ?? null, b.town ?? null, b.post_code1 ?? null, b.post_code2 ?? null, b.sort_order ?? 0]
          );
          created++;
        }
      } catch { /* skip duplicates */ }
    }
    return created;
  }

  async setDefault(deliveryId: number, branchId: number): Promise<void> {
    await execute(`UPDATE delivery_branches SET is_default = 0 WHERE delivery_id = ?`, [deliveryId]);
    await execute(`UPDATE delivery_branches SET is_default = 1 WHERE id = ? AND delivery_id = ?`, [branchId, deliveryId]);
  }
}

// ─── Brand Settings ───────────────────────────────────���──────────────────────

export class BrandSettingsQueries {
  async getByDelivery(deliveryId: number): Promise<Record<string, string>> {
    const rows = await query<{ setting_key: string; setting_value: string }>(
      `SELECT setting_key, setting_value FROM delivery_brand_settings WHERE delivery_id = ?`, [deliveryId]
    );
    const result: Record<string, string> = {};
    for (const row of rows) result[row.setting_key] = row.setting_value;
    return result;
  }

  async upsert(deliveryId: number, key: string, value: string | null): Promise<void> {
    await execute(`
      MERGE INTO delivery_brand_settings WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?)) AS source(delivery_id, setting_key, setting_value)
      ON target.delivery_id = source.delivery_id AND target.setting_key = source.setting_key
      WHEN MATCHED THEN UPDATE SET setting_value = source.setting_value, updated_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (delivery_id, setting_key, setting_value, updated_at) VALUES (source.delivery_id, source.setting_key, source.setting_value, GETUTCDATE());
    `, [deliveryId, key, value]);
  }

  async bulkUpsert(deliveryId: number, settings: Record<string, string | null>): Promise<number> {
    let count = 0;
    for (const [key, value] of Object.entries(settings)) {
      await this.upsert(deliveryId, key, value);
      count++;
    }
    return count;
  }

  async deleteByDelivery(deliveryId: number): Promise<void> {
    await execute(`DELETE FROM delivery_brand_settings WHERE delivery_id = ?`, [deliveryId]);
  }
}

// ─── Logos ────────────────────────────────────────────────────────────────────

export interface DeliveryLogo {
  id: number; delivery_id: number; logo_type: number; logo_label: string;
  mime_type: string; image_data: string; file_name: string | null;
  file_size: number | null; created_at: string;
}

export class LogoQueries {
  async getMetadataByDelivery(deliveryId: number): Promise<Array<Omit<DeliveryLogo, 'image_data'>>> {
    return query<Omit<DeliveryLogo, 'image_data'>>(
      `SELECT id, delivery_id, logo_type, logo_label, mime_type, file_name, file_size, created_at
       FROM delivery_logos WHERE delivery_id = ? ORDER BY logo_type`, [deliveryId]
    );
  }

  async getByDeliveryAndType(deliveryId: number, logoType: number): Promise<DeliveryLogo | undefined> {
    return queryOne<DeliveryLogo>(`SELECT * FROM delivery_logos WHERE delivery_id = ? AND logo_type = ?`, [deliveryId, logoType]);
  }

  async getById(id: number): Promise<DeliveryLogo | undefined> {
    return queryOne<DeliveryLogo>(`SELECT * FROM delivery_logos WHERE id = ?`, [id]);
  }

  async upsert(data: { delivery_id: number; logo_type: number; logo_label: string; mime_type: string; image_data: string; file_name?: string; file_size?: number }): Promise<number> {
    await execute(`
      MERGE INTO delivery_logos WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?, ?, ?, ?, ?)) AS source(delivery_id, logo_type, logo_label, mime_type, image_data, file_name, file_size)
      ON target.delivery_id = source.delivery_id AND target.logo_type = source.logo_type
      WHEN MATCHED THEN UPDATE SET logo_label=source.logo_label, mime_type=source.mime_type,
        image_data=source.image_data, file_name=source.file_name, file_size=source.file_size, created_at=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (delivery_id, logo_type, logo_label, mime_type, image_data, file_name, file_size)
        VALUES (source.delivery_id, source.logo_type, source.logo_label, source.mime_type, source.image_data, source.file_name, source.file_size);
    `, [data.delivery_id, data.logo_type, data.logo_label, data.mime_type, data.image_data, data.file_name ?? null, data.file_size ?? null]);

    const row = await queryOne<{ id: number }>(`SELECT id FROM delivery_logos WHERE delivery_id = ? AND logo_type = ?`, [data.delivery_id, data.logo_type]);
    return row?.id ?? 0;
  }

  async deleteByDeliveryAndType(deliveryId: number, logoType: number): Promise<boolean> {
    const result = await execute(`DELETE FROM delivery_logos WHERE delivery_id = ? AND logo_type = ?`, [deliveryId, logoType]);
    return result.rowsAffected > 0;
  }
}

// ─── Setup Execution ───────────────────────────────────���─────────────────────

export interface SetupExecutionRun {
  id: number; delivery_id: number; started_at: string; finished_at: string | null;
  status: string; started_by: number | null; summary: string | null;
}
export interface SetupExecutionLog {
  id: number; run_id: number; step_key: string; timestamp: string; level: string; message: string;
}

export class SetupExecutionQueries {
  async createRun(deliveryId: number, startedBy: number | null): Promise<number> {
    return executeAndGetId(`INSERT INTO setup_execution_runs (delivery_id, started_by) VALUES (?, ?)`, [deliveryId, startedBy]);
  }

  async updateRunStatus(runId: number, status: string, summary?: string): Promise<void> {
    const finished = ['complete', 'failed', 'cancelled'].includes(status) ? new Date().toISOString() : null;
    await execute(
      `UPDATE setup_execution_runs SET status = ?, finished_at = COALESCE(?, finished_at), summary = COALESCE(?, summary) WHERE id = ?`,
      [status, finished, summary ?? null, runId]
    );
  }

  async addLog(runId: number, stepKey: string, level: string, message: string): Promise<void> {
    await execute(`INSERT INTO setup_execution_logs (run_id, step_key, level, message) VALUES (?, ?, ?, ?)`, [runId, stepKey, level, message]);
  }

  async getRunsByDelivery(deliveryId: number): Promise<SetupExecutionRun[]> {
    return query<SetupExecutionRun>(`SELECT TOP 20 * FROM setup_execution_runs WHERE delivery_id = ? ORDER BY started_at DESC`, [deliveryId]);
  }

  async getLogsByRun(runId: number): Promise<SetupExecutionLog[]> {
    return query<SetupExecutionLog>(`SELECT * FROM setup_execution_logs WHERE run_id = ? ORDER BY id ASC`, [runId]);
  }

  async getLatestRun(deliveryId: number): Promise<SetupExecutionRun | null> {
    return (await queryOne<SetupExecutionRun>(`SELECT TOP 1 * FROM setup_execution_runs WHERE delivery_id = ? ORDER BY started_at DESC`, [deliveryId])) ?? null;
  }
}

// ─── Setup Portal Tokens ────────────────────────────────────────────────────

export interface SetupPortalToken {
  id: number; token: string; delivery_id: number; customer_email: string;
  customer_name: string | null; expires_at: string; created_at: string;
  last_accessed: string | null; completed_at: string | null;
  created_by: number | null; progress_json: string;
}

export class SetupPortalQueries {
  async create(data: { token: string; delivery_id: number; customer_email: string; customer_name?: string; expires_at: string; created_by?: number }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO setup_portal_tokens (token, delivery_id, customer_email, customer_name, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [data.token, data.delivery_id, data.customer_email, data.customer_name ?? null, data.expires_at, data.created_by ?? null]
    );
  }

  async getByToken(token: string): Promise<SetupPortalToken | null> {
    return (await queryOne<SetupPortalToken>(
      `SELECT * FROM setup_portal_tokens WHERE token = ? AND expires_at > GETUTCDATE()`, [token]
    )) ?? null;
  }

  async getByDelivery(deliveryId: number): Promise<SetupPortalToken[]> {
    return query<SetupPortalToken>(
      `SELECT id, token, delivery_id, customer_email, customer_name, expires_at, created_at, last_accessed, completed_at, created_by, progress_json
       FROM setup_portal_tokens WHERE delivery_id = ? ORDER BY created_at DESC`, [deliveryId]
    );
  }

  async updateLastAccessed(token: string): Promise<void> {
    await execute(`UPDATE setup_portal_tokens SET last_accessed = GETUTCDATE() WHERE token = ?`, [token]);
  }

  async updateProgress(token: string, progressJson: string): Promise<void> {
    await execute(`UPDATE setup_portal_tokens SET progress_json = ? WHERE token = ?`, [progressJson, token]);
  }

  async markCompleted(token: string): Promise<void> {
    await execute(`UPDATE setup_portal_tokens SET completed_at = GETUTCDATE() WHERE token = ?`, [token]);
  }

  async revokeToken(id: number): Promise<boolean> {
    const result = await execute(`DELETE FROM setup_portal_tokens WHERE id = ?`, [id]);
    return result.rowsAffected > 0;
  }

  async deleteExpired(): Promise<number> {
    const result = await execute(`DELETE FROM setup_portal_tokens WHERE expires_at < GETUTCDATE()`);
    return result.rowsAffected;
  }
}

// ─── Portal Accounts ─────────────────────────────────────────────────────────

export interface PortalAccount { id: number; delivery_id: number; portal_name: string; created_at: string; }

export class PortalAccountQueries {
  async getByDelivery(deliveryId: number): Promise<PortalAccount[]> {
    return query<PortalAccount>(`SELECT * FROM delivery_portal_accounts WHERE delivery_id = ? ORDER BY portal_name`, [deliveryId]);
  }

  async create(deliveryId: number, portalName: string): Promise<PortalAccount | null> {
    try {
      const id = await executeAndGetId(
        `INSERT INTO delivery_portal_accounts (delivery_id, portal_name) VALUES (?, ?)`,
        [deliveryId, portalName.trim()]
      );
      return (await queryOne<PortalAccount>(`SELECT * FROM delivery_portal_accounts WHERE id = ?`, [id])) ?? null;
    } catch { return null; }
  }

  async bulkCreate(deliveryId: number, names: string[]): Promise<PortalAccount[]> {
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      try {
        const existing = await queryOne<{ id: number }>(
          `SELECT id FROM delivery_portal_accounts WHERE delivery_id = ? AND portal_name = ?`, [deliveryId, trimmed]
        );
        if (!existing) {
          await execute(`INSERT INTO delivery_portal_accounts (delivery_id, portal_name) VALUES (?, ?)`, [deliveryId, trimmed]);
        }
      } catch { /* skip duplicates */ }
    }
    return this.getByDelivery(deliveryId);
  }

  async delete(id: number): Promise<boolean> {
    const result = await execute(`DELETE FROM delivery_portal_accounts WHERE id = ?`, [id]);
    return result.rowsAffected > 0;
  }
}

// ─── Branch Districts ────────────────────────────────────────────────────────

export interface BranchDistrict {
  id: number; branch_id: number; delivery_id: number; district_name: string;
  all_sectors: number; sectors_json: string; created_at: string;
}

export class BranchDistrictQueries {
  async getByDelivery(deliveryId: number): Promise<BranchDistrict[]> {
    return query<BranchDistrict>(`SELECT * FROM delivery_branch_districts WHERE delivery_id = ? ORDER BY branch_id, district_name`, [deliveryId]);
  }

  async getByBranch(branchId: number): Promise<BranchDistrict[]> {
    return query<BranchDistrict>(`SELECT * FROM delivery_branch_districts WHERE branch_id = ? ORDER BY district_name`, [branchId]);
  }

  async create(data: { branch_id: number; delivery_id: number; district_name: string; all_sectors: boolean; sectors: string[] }): Promise<BranchDistrict | null> {
    try {
      const id = await executeAndGetId(
        `INSERT INTO delivery_branch_districts (branch_id, delivery_id, district_name, all_sectors, sectors_json) VALUES (?, ?, ?, ?, ?)`,
        [data.branch_id, data.delivery_id, data.district_name.trim(), data.all_sectors ? 1 : 0, JSON.stringify(data.sectors || [])]
      );
      return (await queryOne<BranchDistrict>(`SELECT * FROM delivery_branch_districts WHERE id = ?`, [id])) ?? null;
    } catch { return null; }
  }

  async update(id: number, data: { district_name?: string; all_sectors?: boolean; sectors?: string[] }): Promise<BranchDistrict | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (data.district_name !== undefined) { sets.push('district_name = ?'); vals.push(data.district_name.trim()); }
    if (data.all_sectors !== undefined) { sets.push('all_sectors = ?'); vals.push(data.all_sectors ? 1 : 0); }
    if (data.sectors !== undefined) { sets.push('sectors_json = ?'); vals.push(JSON.stringify(data.sectors)); }
    if (sets.length === 0) return (await queryOne<BranchDistrict>(`SELECT * FROM delivery_branch_districts WHERE id = ?`, [id])) ?? null;
    vals.push(id);
    await execute(`UPDATE delivery_branch_districts SET ${sets.join(', ')} WHERE id = ?`, vals);
    return (await queryOne<BranchDistrict>(`SELECT * FROM delivery_branch_districts WHERE id = ?`, [id])) ?? null;
  }

  async delete(id: number): Promise<boolean> {
    const result = await execute(`DELETE FROM delivery_branch_districts WHERE id = ?`, [id]);
    return result.rowsAffected > 0;
  }
}

// ─── Welcome Packs ──────────────────────────────────────────────────────────

export interface WelcomePack {
  id: number; delivery_id: number; name: string; snapshot_json: string;
  created_at: string; created_by: string | null;
}

export class WelcomePackQueries {
  async create(deliveryId: number, name: string, snapshotJson: string, createdBy?: string): Promise<WelcomePack> {
    const id = await executeAndGetId(
      `INSERT INTO delivery_welcome_packs (delivery_id, name, snapshot_json, created_by) VALUES (?, ?, ?, ?)`,
      [deliveryId, name, snapshotJson, createdBy ?? null]
    );
    return (await this.getById(id))!;
  }

  async getByDelivery(deliveryId: number): Promise<WelcomePack[]> {
    return query<WelcomePack>(`SELECT * FROM delivery_welcome_packs WHERE delivery_id = ? ORDER BY created_at DESC`, [deliveryId]);
  }

  async getById(id: number): Promise<WelcomePack | null> {
    return (await queryOne<WelcomePack>(`SELECT * FROM delivery_welcome_packs WHERE id = ?`, [id])) ?? null;
  }
}

// ─── Business Central Customers ─────────────────────────────────────────────

export interface BcCustomer {
  id: number; bc_id: string; number: string | null; display_name: string;
  email: string | null; phone_number: string | null;
  address: string | null; address_line_2: string | null;
  city: string | null; state: string | null; country: string | null;
  postal_code: string | null;
  tax_registration_number: string | null;             // VAT Registration No.
  company_registration_number: string | null;         // Companies House-style reg
  primary_contact_name: string | null;
  currency_code: string | null;
  balance: number | null; blocked: string | null; last_synced: string; created_at: string;
}

export class BcCustomerQueries {
  async getAll(search?: string): Promise<BcCustomer[]> {
    let sql = `SELECT * FROM bc_customers WHERE 1=1`;
    const params: string[] = [];
    if (search?.trim()) {
      sql += ` AND (display_name LIKE ? OR [number] LIKE ? OR city LIKE ?)`;
      const like = `%${search.trim()}%`;
      params.push(like, like, like);
    }
    sql += ` ORDER BY display_name ASC`;
    return query<BcCustomer>(sql, params);
  }

  async getByBcId(bcId: string): Promise<BcCustomer | null> {
    return (await queryOne<BcCustomer>(`SELECT * FROM bc_customers WHERE bc_id = ?`, [bcId])) ?? null;
  }

  async upsert(c: Omit<BcCustomer, 'id' | 'created_at'>): Promise<void> {
    await execute(`
      MERGE INTO bc_customers WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?))
        AS source(bc_id, [number], display_name, email, phone_number,
                  address, address_line_2, city, state, country, postal_code,
                  tax_registration_number, company_registration_number, primary_contact_name,
                  currency_code, balance, blocked)
      ON target.bc_id = source.bc_id
      WHEN MATCHED THEN UPDATE SET
        [number]=source.[number], display_name=source.display_name, email=source.email,
        phone_number=source.phone_number,
        address=source.address, address_line_2=source.address_line_2,
        city=source.city, state=source.state, country=source.country,
        postal_code=source.postal_code,
        tax_registration_number=source.tax_registration_number,
        company_registration_number=source.company_registration_number,
        primary_contact_name=source.primary_contact_name,
        currency_code=source.currency_code, balance=source.balance,
        blocked=source.blocked, last_synced=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (bc_id, [number], display_name, email, phone_number,
        address, address_line_2, city, state, country, postal_code,
        tax_registration_number, company_registration_number, primary_contact_name,
        currency_code, balance, blocked, last_synced)
        VALUES (source.bc_id, source.[number], source.display_name, source.email, source.phone_number,
          source.address, source.address_line_2, source.city, source.state, source.country, source.postal_code,
          source.tax_registration_number, source.company_registration_number, source.primary_contact_name,
          source.currency_code, source.balance, source.blocked, GETUTCDATE());
    `, [c.bc_id, c.number ?? null, c.display_name, c.email ?? null, c.phone_number ?? null,
        c.address ?? null, c.address_line_2 ?? null,
        c.city ?? null, c.state ?? null, c.country ?? null, c.postal_code ?? null,
        c.tax_registration_number ?? null, c.company_registration_number ?? null, c.primary_contact_name ?? null,
        c.currency_code ?? null, c.balance ?? null, c.blocked ?? null]);
  }

  async count(): Promise<number> {
    const row = await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM bc_customers`);
    return row?.c ?? 0;
  }
}

// ─── Contracts ──────────────────────────────────────────────────────────────

export interface Contract {
  id: number; bc_customer_id: string | null; customer_name: string;
  contract_number: string | null; title: string; status: string;
  start_date: string | null; end_date: string | null; value: number | null;
  currency: string; renewal_type: string | null; notes: string | null;
  bc_order_id: string | null; created_at: string; updated_at: string;
}

export class ContractsQueries {
  async getAll(filters?: { bc_customer_id?: string; status?: string; search?: string }): Promise<Contract[]> {
    let sql = `SELECT * FROM contracts WHERE 1=1`;
    const params: (string | number)[] = [];
    if (filters?.bc_customer_id) { sql += ` AND bc_customer_id = ?`; params.push(filters.bc_customer_id); }
    if (filters?.status) { sql += ` AND status = ?`; params.push(filters.status); }
    if (filters?.search?.trim()) {
      sql += ` AND (title LIKE ? OR contract_number LIKE ? OR customer_name LIKE ?)`;
      const like = `%${filters.search.trim()}%`;
      params.push(like, like, like);
    }
    sql += ` ORDER BY CASE WHEN end_date IS NULL THEN 1 ELSE 0 END, end_date ASC, title ASC`;
    return query<Contract>(sql, params);
  }

  async getById(id: number): Promise<Contract | null> {
    return (await queryOne<Contract>(`SELECT * FROM contracts WHERE id = ?`, [id])) ?? null;
  }

  async create(c: Omit<Contract, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    return executeAndGetId(
      `INSERT INTO contracts (bc_customer_id, customer_name, contract_number, title, status, start_date, end_date, value, currency, renewal_type, notes, bc_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.bc_customer_id ?? null, c.customer_name, c.contract_number ?? null, c.title,
       c.status ?? 'active', c.start_date ?? null, c.end_date ?? null, c.value ?? null,
       c.currency ?? 'GBP', c.renewal_type ?? null, c.notes ?? null, c.bc_order_id ?? null]
    );
  }

  async update(id: number, c: Partial<Omit<Contract, 'id' | 'created_at' | 'updated_at'>>): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await execute(
      `UPDATE contracts SET bc_customer_id=?, customer_name=?, contract_number=?, title=?, status=?, start_date=?, end_date=?, value=?, currency=?, renewal_type=?, notes=?, bc_order_id=?, updated_at=GETUTCDATE() WHERE id=?`,
      [c.bc_customer_id ?? existing.bc_customer_id, c.customer_name ?? existing.customer_name,
       c.contract_number ?? existing.contract_number, c.title ?? existing.title,
       c.status ?? existing.status, c.start_date ?? existing.start_date,
       c.end_date ?? existing.end_date, c.value ?? existing.value,
       c.currency ?? existing.currency, c.renewal_type ?? existing.renewal_type,
       c.notes ?? existing.notes, c.bc_order_id ?? existing.bc_order_id, id]
    );
    return true;
  }

  async delete(id: number): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await execute(`DELETE FROM contracts WHERE id = ?`, [id]);
    return true;
  }
}

// ─── Contract Terms (pre-approved text blocks for Adobe agreements) ────────

export interface ContractTerm {
  id: number;
  label: string;
  body: string;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export class ContractTermsQueries {
  async getAll(filters?: { activeOnly?: boolean }): Promise<ContractTerm[]> {
    let sql = `SELECT id, label, body, active, sort_order, created_at, updated_at FROM contract_terms`;
    if (filters?.activeOnly) sql += ` WHERE active = 1`;
    sql += ` ORDER BY sort_order ASC, label ASC`;
    return query<ContractTerm>(sql, []);
  }

  async getById(id: number): Promise<ContractTerm | null> {
    return (await queryOne<ContractTerm>(`SELECT * FROM contract_terms WHERE id = ?`, [id])) ?? null;
  }

  async create(t: { label: string; body: string; active?: number; sort_order?: number }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO contract_terms (label, body, active, sort_order) VALUES (?, ?, ?, ?)`,
      [t.label, t.body, t.active ?? 1, t.sort_order ?? 0]
    );
  }

  async update(id: number, t: Partial<Pick<ContractTerm, 'label' | 'body' | 'active' | 'sort_order'>>): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await execute(
      `UPDATE contract_terms SET label=?, body=?, active=?, sort_order=?, updated_at=GETUTCDATE() WHERE id=?`,
      [t.label ?? existing.label, t.body ?? existing.body,
       t.active ?? existing.active, t.sort_order ?? existing.sort_order, id]
    );
    return true;
  }

  async delete(id: number): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await execute(`DELETE FROM contract_terms WHERE id = ?`, [id]);
    return true;
  }
}

// ─── Counters (atomic sequence numbers) ─────────────────────────────────────

export class CounterQueries {
  // Atomically increment + return the new value for a named counter.
  // The MERGE INTO ... OUTPUT pattern is the standard MSSQL way to do a "get or
  // create + increment" in a single round-trip without read-modify-write races.
  // First call for a name returns 1, second returns 2, etc.
  async nextValue(name: string): Promise<number> {
    const row = await queryOne<{ value: number }>(
      `MERGE INTO counters WITH (HOLDLOCK) AS target
       USING (VALUES (?, 1)) AS source(name, value)
       ON target.name = source.name
       WHEN MATCHED THEN UPDATE SET value = target.value + 1
       WHEN NOT MATCHED THEN INSERT (name, value) VALUES (source.name, source.value)
       OUTPUT inserted.value AS value;`,
      [name]
    );
    return row?.value ?? 0;
  }
}

// ─── Agreement field values (per-field record per Adobe agreement) ──────────

export interface AgreementFieldValue {
  id: number;
  agreement_id: string;
  field_name: string;
  field_value: string | null;
  source: 'SENDER' | 'SIGNER';
  captured_at: string;
}

export class AgreementFieldValueQueries {
  async getByAgreementId(agreementId: string): Promise<AgreementFieldValue[]> {
    return query<AgreementFieldValue>(
      `SELECT * FROM agreement_field_values WHERE agreement_id = ? ORDER BY id ASC`,
      [agreementId]
    );
  }

  // Bulk insert — used at agreement-create time to capture every wizard-filled
  // field in one go. Empty/null values are still inserted so we have a complete
  // audit of what was asked vs. what was filled.
  async bulkInsert(agreementId: string, source: 'SENDER' | 'SIGNER',
    values: Array<{ field_name: string; field_value: string | null }>): Promise<void> {
    if (values.length === 0) return;
    for (const v of values) {
      await execute(
        `INSERT INTO agreement_field_values (agreement_id, field_name, field_value, source)
         VALUES (?, ?, ?, ?)`,
        [agreementId, v.field_name, v.field_value, source]
      );
    }
  }
}

// ─── Template Field Signer Overrides ───────────────────────────────────────
// Per-template list of field names the sender has marked as "signer fills" in
// the wizard, on top of whatever Adobe's assignee says. The wizard reads these
// when classifying fields. Adobe-side signer fields stay signer regardless —
// overrides only ADD to the signer panel, never move signer fields back.

export interface TemplateFieldSignerOverride {
  id: number;
  template_id: string;
  field_name: string;
  created_at: string;
  created_by: number | null;
}

export class TemplateFieldOverrideQueries {
  async getByTemplateId(templateId: string): Promise<TemplateFieldSignerOverride[]> {
    return query<TemplateFieldSignerOverride>(
      `SELECT * FROM template_field_signer_overrides WHERE template_id = ? ORDER BY field_name`,
      [templateId]
    );
  }

  // Idempotent: re-marking a field that's already overridden is a no-op.
  async add(templateId: string, fieldName: string, createdBy: number | null): Promise<void> {
    await execute(
      `IF NOT EXISTS (
         SELECT 1 FROM template_field_signer_overrides
         WHERE template_id = ? AND field_name = ?
       )
       INSERT INTO template_field_signer_overrides (template_id, field_name, created_by)
       VALUES (?, ?, ?)`,
      [templateId, fieldName, templateId, fieldName, createdBy]
    );
  }

  async remove(templateId: string, fieldName: string): Promise<boolean> {
    await execute(
      `DELETE FROM template_field_signer_overrides
       WHERE template_id = ? AND field_name = ?`,
      [templateId, fieldName]
    );
    return true;
  }
}

// ─── Adobe Sign Agreements ──────────────────────────────────────────────────

export interface AdobeSignAgreement {
  id: number; agreement_id: string; contract_id: number | null;
  bc_customer_id: string | null; subscription_contract_no: string | null;
  bc_imported_at: string | null; bc_import_error: string | null;
  name: string; status: string; sender_email: string | null; signer_emails: string | null;
  filled_fields: string | null;
  signed_form_data: string | null; signed_pdf_path: string | null; signed_at: string | null;
  created_via_nova: number;
  adobe_created_date: string | null; adobe_expiration_date: string | null;
  signed_document_url: string | null; raw_data: string | null;
  synced_at: string | null; created_at: string; updated_at: string;
}

// Subset used for upsert from the wizard / sync job. The signed_* and bc_imported_*
// columns are never written via upsert — they're set via markSigned() / markBcImported
// /markBcImportError, so they aren't overwritten when the 5-min sync just refreshes status.
export type AdobeSignAgreementUpsert = Omit<AdobeSignAgreement,
  'id' | 'created_at' | 'updated_at' | 'signed_form_data' | 'signed_pdf_path' | 'signed_at'
  | 'bc_imported_at' | 'bc_import_error'>;

export class AdobeSignAgreementQueries {
  async getAll(filters?: { contract_id?: number; status?: string; search?: string }): Promise<AdobeSignAgreement[]> {
    let sql = `SELECT * FROM adobe_sign_agreements WHERE 1=1`;
    const params: (string | number)[] = [];
    if (filters?.contract_id) { sql += ` AND contract_id = ?`; params.push(filters.contract_id); }
    if (filters?.status) { sql += ` AND status = ?`; params.push(filters.status); }
    if (filters?.search?.trim()) {
      sql += ` AND (name LIKE ? OR sender_email LIKE ? OR signer_emails LIKE ?)`;
      const like = `%${filters.search.trim()}%`;
      params.push(like, like, like);
    }
    sql += ` ORDER BY created_at DESC`;
    return query<AdobeSignAgreement>(sql, params);
  }

  async getById(id: number): Promise<AdobeSignAgreement | null> {
    return (await queryOne<AdobeSignAgreement>(`SELECT * FROM adobe_sign_agreements WHERE id = ?`, [id])) ?? null;
  }

  async getByAgreementId(agreementId: string): Promise<AdobeSignAgreement | null> {
    return (await queryOne<AdobeSignAgreement>(`SELECT * FROM adobe_sign_agreements WHERE agreement_id = ?`, [agreementId])) ?? null;
  }

  async upsert(a: AdobeSignAgreementUpsert): Promise<void> {
    // bc_customer_id + subscription_contract_no are INSERT-only — once set at create
    // time, the 5-min sync job (which passes null) won't be able to wipe them.
    await execute(`
      MERGE INTO adobe_sign_agreements WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?))
        AS source(agreement_id, contract_id, bc_customer_id, subscription_contract_no, name, status, sender_email, signer_emails,
                  filled_fields, created_via_nova, adobe_created_date, adobe_expiration_date,
                  signed_document_url, raw_data, synced_at)
      ON target.agreement_id = source.agreement_id
      WHEN MATCHED THEN UPDATE SET
        status=source.status, sender_email=source.sender_email, signer_emails=source.signer_emails,
        adobe_expiration_date=source.adobe_expiration_date, signed_document_url=source.signed_document_url,
        raw_data=source.raw_data, synced_at=source.synced_at, updated_at=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (agreement_id, contract_id, bc_customer_id, subscription_contract_no, name, status, sender_email, signer_emails,
        filled_fields, created_via_nova, adobe_created_date, adobe_expiration_date, signed_document_url, raw_data, synced_at)
        VALUES (source.agreement_id, source.contract_id, source.bc_customer_id, source.subscription_contract_no, source.name, source.status,
          source.sender_email, source.signer_emails, source.filled_fields, source.created_via_nova,
          source.adobe_created_date, source.adobe_expiration_date, source.signed_document_url, source.raw_data, source.synced_at);
    `, [a.agreement_id, a.contract_id ?? null, a.bc_customer_id ?? null,
        a.subscription_contract_no ?? null, a.name,
        a.status, a.sender_email ?? null, a.signer_emails ?? null,
        a.filled_fields ?? null, a.created_via_nova ? 1 : 0,
        a.adobe_created_date ?? null, a.adobe_expiration_date ?? null,
        a.signed_document_url ?? null, a.raw_data ?? null,
        a.synced_at ?? new Date().toISOString()]);
  }

  // Targeted update for post-sign capture — won't be touched by the periodic
  // upsert from the sync job. Idempotent: callers can re-invoke safely.
  async markSigned(agreementId: string, data: { signedFormData: string | null; signedPdfPath: string | null; signedAt: string }): Promise<void> {
    await execute(
      `UPDATE adobe_sign_agreements
       SET signed_form_data = ?,
           signed_pdf_path  = ?,
           signed_at        = ?,
           updated_at       = GETUTCDATE()
       WHERE agreement_id = ?`,
      [data.signedFormData, data.signedPdfPath, data.signedAt, agreementId]
    );
  }

  // Successful BC subscription import write — sets the timestamp and clears any
  // prior error so retries reset state cleanly. Idempotent.
  async markBcImported(agreementId: string): Promise<void> {
    await execute(
      `UPDATE adobe_sign_agreements
       SET bc_imported_at  = GETUTCDATE(),
           bc_import_error = NULL,
           updated_at      = GETUTCDATE()
       WHERE agreement_id = ?`,
      [agreementId]
    );
  }

  // Failed BC subscription import write — stores the error message for visibility
  // and leaves bc_imported_at null so the agreement can be retried.
  async markBcImportError(agreementId: string, error: string): Promise<void> {
    await execute(
      `UPDATE adobe_sign_agreements
       SET bc_import_error = ?,
           updated_at      = GETUTCDATE()
       WHERE agreement_id = ?`,
      [error.slice(0, 4000), agreementId]
    );
  }

  async delete(id: number): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await execute(`DELETE FROM adobe_sign_agreements WHERE id = ?`, [id]);
    return true;
  }

  async getByContractId(contractId: number): Promise<AdobeSignAgreement[]> {
    return query<AdobeSignAgreement>(`SELECT * FROM adobe_sign_agreements WHERE contract_id = ? ORDER BY created_at DESC`, [contractId]);
  }
}

// ─── Approvals ──────────────────────────────────────────────────────────────

export interface ApprovalItem {
  id: number; ticket_id: string; ticket_summary: string;
  reporter_name: string | null; reporter_email: string | null;
  ai_response_adf: string | null; conversation_json: string | null;
  kb_sources: string | null; resume_url: string; status: string;
  decided_by: string | null; decided_at: string | null;
  edited_response_adf: string | null; decline_reason: string | null;
  priority: string | null; created_at: string; expires_at: string;
  action_type: string | null; source: string | null;
  confidence: number | null; reasoning: string | null;
  warned_at: string | null;
  shadow_mode: boolean;
  decision_id: number | null;
}

// NOVA agent_decisions use negative IDs (-id) to distinguish from approval_queue items.
// The decide() method routes writes to the correct table based on ID sign.

function agentDecisionToApproval(row: Record<string, unknown>): ApprovalItem {
  const id = row.id as number;
  let summary = '';
  let reporter: string | null = null;
  let reporterEmail: string | null = null;
  let priority: string | null = null;
  try {
    const inputs = typeof row.inputs === 'string' ? JSON.parse(row.inputs) : row.inputs;
    summary = inputs?.summary ?? inputs?.ticket_summary ?? inputs?.ticketSummary ?? '';
    reporter = inputs?.reporter ?? inputs?.reporter_name ?? null;
    reporterEmail = inputs?.reporterEmail ?? inputs?.reporter_email ?? null;
    priority = inputs?.priority ?? null;
  } catch { /* inputs not parseable */ }

  const approvalStatus = row.approval_status as string | null;
  const status = !approvalStatus || approvalStatus === 'pending' ? 'pending'
    : approvalStatus === 'approved' ? 'approved'
    : approvalStatus === 'declined' ? 'declined' : approvalStatus;

  return {
    id: -id,
    ticket_id: row.ticket_id as string,
    ticket_summary: summary || `${row.action} — ${row.event_type}`,
    reporter_name: reporter,
    reporter_email: reporterEmail,
    ai_response_adf: row.output as string | null,
    conversation_json: row.inputs as string | null,
    kb_sources: null,
    resume_url: '',
    status,
    decided_by: null,
    decided_at: (row.resolved_at as string) ?? null,
    edited_response_adf: null,
    decline_reason: null,
    priority,
    created_at: row.created_at as string,
    expires_at: '',
    action_type: row.action as string | null,
    source: 'nova_ai',
    confidence: row.confidence != null ? Number(row.confidence) : null,
    reasoning: (row.reasoning as string) ?? null,
    warned_at: null,
    shadow_mode: !!(row.shadow_mode),
    decision_id: id,
  };
}

export class ApprovalQueries {
  private async getNovaDecisions(status?: string): Promise<ApprovalItem[]> {
    let where = 'WHERE d.approval_required = 1 AND d.shadow_mode = 0';
    // Exclude agent_decisions that have ANY matching approval_queue entry — queue is authoritative
    where += ` AND NOT EXISTS (SELECT 1 FROM approval_queue q WHERE q.ticket_id = d.ticket_id)`;
    if (status === 'pending') where += ` AND (d.approval_status IS NULL OR d.approval_status = 'pending')`;
    else if (status === 'approved') where += ` AND d.approval_status IN ('approved', 'confirmed', 'executed')`;
    else if (status === 'declined') where += ` AND d.approval_status = 'declined'`;
    else if (status === 'timed_out' || status === 'cancelled') return [];
    const rows = await query<Record<string, unknown>>(
      `SELECT d.id, d.ticket_id, d.event_type, d.inputs, d.output, d.action,
              d.confidence, d.reasoning, d.approval_required, d.approval_status,
              d.shadow_mode, d.created_at, d.resolved_at
       FROM agent_decisions d ${where}
       ORDER BY d.created_at DESC`,
    );
    return rows.map(agentDecisionToApproval);
  }

  async getAll(status?: string): Promise<ApprovalItem[]> {
    await execute(`UPDATE approval_queue SET status = 'timed_out' WHERE status = 'pending' AND expires_at <= GETUTCDATE()`);
    let sql = `SELECT *, CAST(0 AS BIT) AS shadow_mode, NULL AS decision_id FROM approval_queue`;
    const params: string[] = [];
    const conditions: string[] = [];
    if (status) { conditions.push(`status = ?`); params.push(status); }
    // Exclude agent-assigned approvals from the global queue — those show in My Tickets
    conditions.push(`assigned_agent IS NULL`);
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ` ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`;
    const queueItems = await query<ApprovalItem>(sql, params);
    // getNovaDecisions already excludes tickets that have any approval_queue entry
    const novaItems = await this.getNovaDecisions(status);

    const merged = [...queueItems, ...novaItems];
    merged.sort((a, b) => {
      const aPending = a.status === 'pending' ? 0 : 1;
      const bPending = b.status === 'pending' ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return merged;
  }

  async getById(id: number): Promise<ApprovalItem | undefined> {
    if (id < 0) {
      const rows = await query<Record<string, unknown>>(
        `SELECT id, ticket_id, event_type, inputs, output, action,
                confidence, reasoning, approval_required, approval_status,
                shadow_mode, created_at, resolved_at
         FROM agent_decisions WHERE id = ?`, [Math.abs(id)],
      );
      return rows.length ? agentDecisionToApproval(rows[0]) : undefined;
    }
    return queryOne<ApprovalItem>(`SELECT *, CAST(0 AS BIT) AS shadow_mode, NULL AS decision_id FROM approval_queue WHERE id = ?`, [id]);
  }

  async getPending(): Promise<ApprovalItem[]> { return this.getAll('pending'); }

  async getPendingByTicket(ticketId: string): Promise<ApprovalItem | undefined> {
    const queueItem = await queryOne<ApprovalItem>(`SELECT *, CAST(0 AS BIT) AS shadow_mode, NULL AS decision_id FROM approval_queue WHERE ticket_id = ? AND status = 'pending' ORDER BY created_at DESC`, [ticketId]);
    if (queueItem) return queueItem;
    const novaRows = await query<Record<string, unknown>>(
      `SELECT id, ticket_id, event_type, inputs, output, action,
              confidence, reasoning, approval_required, approval_status,
              shadow_mode, created_at, resolved_at
       FROM agent_decisions d
       WHERE d.ticket_id = ? AND d.approval_required = 1 AND d.shadow_mode = 0
         AND (d.approval_status IS NULL OR d.approval_status = 'pending')
         AND NOT EXISTS (SELECT 1 FROM approval_queue q WHERE q.ticket_id = d.ticket_id)
       ORDER BY d.created_at DESC`, [ticketId],
    );
    return novaRows.length ? agentDecisionToApproval(novaRows[0]) : undefined;
  }

  async getByAgent(agentAccountId: string, status?: string): Promise<ApprovalItem[]> {
    await execute(`UPDATE approval_queue SET status = 'timed_out' WHERE status = 'pending' AND expires_at <= GETUTCDATE()`);
    let sql = `SELECT *, CAST(0 AS BIT) AS shadow_mode, NULL AS decision_id FROM approval_queue WHERE assigned_agent = ?`;
    const params: unknown[] = [agentAccountId];
    if (status) { sql += ` AND status = ?`; params.push(status); }
    sql += ` ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`;
    return query<ApprovalItem>(sql, params);
  }

  async withdrawByTicketKey(ticketKey: string, reason: string): Promise<number> {
    const result = await execute(
      `UPDATE approval_queue SET status = 'cancelled', decided_by = ?, decided_at = GETUTCDATE()
       WHERE ticket_id = ? AND status = 'pending'`,
      [reason, ticketKey],
    );
    await execute(
      `UPDATE agent_decisions SET approval_status = 'cancelled', resolved_by = ?, resolved_at = GETUTCDATE()
       WHERE ticket_id = ? AND approval_required = 1 AND (approval_status IS NULL OR approval_status = 'pending')`,
      [reason, ticketKey],
    );
    const count = (result as any)?.rowsAffected?.[0] ?? 0;
    if (count > 0) {
      console.log(`[approvals] Withdrew ${count} pending approval(s) for ${ticketKey}: ${reason}`);
    }
    return count;
  }

  async getPendingCount(): Promise<number> {
    await execute(`UPDATE approval_queue SET status = 'timed_out' WHERE status = 'pending' AND expires_at <= GETUTCDATE()`);
    const queueRow = await queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM approval_queue WHERE status = 'pending' AND assigned_agent IS NULL`);
    const novaRow = await queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT d.ticket_id) as count FROM agent_decisions d
       WHERE d.approval_required = 1 AND d.shadow_mode = 0
         AND (d.approval_status IS NULL OR d.approval_status = 'pending')
         AND NOT EXISTS (SELECT 1 FROM approval_queue q WHERE q.ticket_id = d.ticket_id)`,
    );
    return (queueRow?.count ?? 0) + (novaRow?.count ?? 0);
  }

  async getStats(): Promise<{
    pending: number; approved: number; declined: number; declined_today: number; timed_out: number;
    today_decided: number; system_approved_today: number; system_expired_today: number;
  }> {
    await execute(`UPDATE approval_queue SET status = 'timed_out' WHERE status = 'pending' AND expires_at <= GETUTCDATE()`);
    const qRow = await queryOne<Record<string, unknown>>(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) as declined,
        SUM(CASE WHEN status = 'declined' AND decided_at >= CAST(GETUTCDATE() AS DATE)
            AND decided_by NOT IN ('system', 'system-sla', 'system-cleanup', 'NOVA-lifecycle') THEN 1 ELSE 0 END) as declined_today,
        SUM(CASE WHEN status = 'timed_out' THEN 1 ELSE 0 END) as timed_out,
        SUM(CASE WHEN decided_at >= CAST(GETUTCDATE() AS DATE) AND status IN ('approved', 'declined')
            AND decided_by NOT IN ('system', 'system-sla', 'system-cleanup') THEN 1 ELSE 0 END) as today_decided,
        SUM(CASE WHEN decided_at >= CAST(GETUTCDATE() AS DATE) AND status = 'approved'
            AND decided_by IN ('system', 'system-sla', 'system-cleanup') THEN 1 ELSE 0 END) as system_approved_today,
        SUM(CASE WHEN decided_at >= CAST(GETUTCDATE() AS DATE) AND status IN ('timed_out', 'expired')
            AND decided_by IN ('system', 'system-sla', 'system-cleanup') THEN 1 ELSE 0 END) as system_expired_today
      FROM approval_queue
    `);
    // Only count agent_decisions that have NO matching approval_queue entry (any status).
    // approval_queue is authoritative; agent_decisions are fallback for items that never queued.
    const nRow = await queryOne<Record<string, unknown>>(`
      SELECT
        SUM(CASE WHEN approval_status IS NULL OR approval_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN approval_status IN ('approved', 'confirmed', 'executed') THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN approval_status = 'declined' THEN 1 ELSE 0 END) as declined,
        SUM(CASE WHEN approval_status = 'declined' AND resolved_at >= CAST(GETUTCDATE() AS DATE)
            AND (resolved_by IS NULL OR resolved_by NOT IN ('system', 'system-sla', 'system-cleanup', 'NOVA-lifecycle')) THEN 1 ELSE 0 END) as declined_today,
        SUM(CASE WHEN approval_status IN ('approved', 'confirmed', 'executed', 'declined') AND resolved_at >= CAST(GETUTCDATE() AS DATE)
            AND (resolved_by IS NULL OR resolved_by NOT IN ('system', 'system-sla', 'system-cleanup')) THEN 1 ELSE 0 END) as today_decided,
        SUM(CASE WHEN approval_status IN ('approved', 'confirmed', 'executed') AND resolved_at >= CAST(GETUTCDATE() AS DATE)
            AND resolved_by IN ('system', 'system-sla', 'system-cleanup') THEN 1 ELSE 0 END) as system_approved_today,
        SUM(CASE WHEN approval_status = 'timed_out' AND resolved_at >= CAST(GETUTCDATE() AS DATE)
            AND resolved_by IN ('system', 'system-sla', 'system-cleanup') THEN 1 ELSE 0 END) as system_expired_today
      FROM agent_decisions d
      WHERE d.approval_required = 1 AND d.shadow_mode = 0
        AND NOT EXISTS (SELECT 1 FROM approval_queue q WHERE q.ticket_id = d.ticket_id)
    `);
    return {
      pending: ((qRow?.pending as number) || 0) + ((nRow?.pending as number) || 0),
      approved: ((qRow?.approved as number) || 0) + ((nRow?.approved as number) || 0),
      declined: ((qRow?.declined as number) || 0) + ((nRow?.declined as number) || 0),
      declined_today: ((qRow?.declined_today as number) || 0) + ((nRow?.declined_today as number) || 0),
      timed_out: (qRow?.timed_out as number) || 0,
      today_decided: ((qRow?.today_decided as number) || 0) + ((nRow?.today_decided as number) || 0),
      system_approved_today: ((qRow?.system_approved_today as number) || 0) + ((nRow?.system_approved_today as number) || 0),
      system_expired_today: ((qRow?.system_expired_today as number) || 0) + ((nRow?.system_expired_today as number) || 0),
    };
  }

  async create(item: {
    ticket_id: string; ticket_summary: string; reporter_name?: string; reporter_email?: string;
    ai_response_adf?: string; conversation_json?: string; kb_sources?: string;
    resume_url: string; priority?: string; expires_at: string; action_type?: string; source?: string;
    assigned_agent?: string;
  }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO approval_queue (ticket_id, ticket_summary, reporter_name, reporter_email, ai_response_adf, conversation_json, kb_sources, resume_url, priority, expires_at, action_type, source, assigned_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.ticket_id, item.ticket_summary, item.reporter_name || null, item.reporter_email || null,
       item.ai_response_adf || null, item.conversation_json || null, item.kb_sources || null,
       item.resume_url, item.priority || null, item.expires_at, item.action_type || 'draft_response', item.source || 'n8n_ai',
       item.assigned_agent || null]
    );
  }

  async decide(id: number, action: 'approved' | 'declined' | 'timed_out' | 'expired' | 'superseded' | 'cancelled', decidedBy: string, editedResponseAdf?: string, declineReason?: string): Promise<boolean> {
    if (id < 0) {
      const realId = Math.abs(id);
      const row = await queryOne<{ approval_status: string | null }>(
        `SELECT approval_status FROM agent_decisions WHERE id = ? AND approval_required = 1`, [realId],
      );
      if (!row) return false;
      if (row.approval_status && row.approval_status !== 'pending') return false;
      await execute(
        `UPDATE agent_decisions SET approval_status = ?, resolved_at = GETUTCDATE(), resolved_by = ? WHERE id = ?`,
        [action, decidedBy, realId],
      );
      return true;
    }
    const item = await this.getById(id);
    if (!item || item.status !== 'pending') return false;
    await execute(
      `UPDATE approval_queue SET status = ?, decided_by = ?, decided_at = GETUTCDATE(), edited_response_adf = ?, decline_reason = ? WHERE id = ?`,
      [action, decidedBy, editedResponseAdf || null, declineReason || null, id]
    );
    return true;
  }

  async markWarned(id: number): Promise<void> {
    await execute(
      `UPDATE approval_queue SET warned_at = GETUTCDATE() WHERE id = ?`,
      [id],
    );
  }

  async cleanupExpiredAndSupersededApprovals(expiryHours: number, _jiraClient?: any): Promise<{ expired: number; superseded: number }> {
    let expired = 0;
    let superseded = 0;

    // 1. Expire stale approval_queue entries
    try {
      const aqExpired = await query<{ id: number }>(`
        SELECT id FROM approval_queue
        WHERE status = 'pending' AND created_at <= DATEADD(hour, -?, GETUTCDATE())
      `, [expiryHours]);

      for (const row of aqExpired) {
        const ok = await this.decide(row.id, 'expired', 'NOVA-lifecycle');
        if (ok) expired++;
      }
    } catch (err) {
      console.warn('[approvals] approval_queue expiry failed:', err instanceof Error ? err.message : err);
    }

    // 2. Expire stale agent_decisions entries (bulk UPDATE)
    try {
      const result = await execute(`
        UPDATE agent_decisions
        SET approval_status = 'expired', resolved_at = GETUTCDATE()
        WHERE approval_required = 1
          AND (approval_status IS NULL OR approval_status = 'pending')
          AND created_at <= DATEADD(hour, -?, GETUTCDATE())
      `, [expiryHours]);
      expired += result.rowsAffected;
    } catch (err) {
      console.warn('[approvals] agent_decisions expiry failed:', err instanceof Error ? err.message : err);
    }

    // 3. Supersede approval_queue where Jira ticket is resolved/closed/done (via cache, no API calls)
    try {
      const result = await execute(`
        UPDATE aq
        SET aq.status = 'superseded',
            aq.decided_by = 'NOVA-lifecycle',
            aq.decided_at = GETUTCDATE(),
            aq.decline_reason = CONCAT('Ticket ', aq.ticket_id, ' is ', jc.status_name, '. Approval superseded.')
        FROM approval_queue aq
        JOIN jira_issue_cache jc ON jc.issue_key = aq.ticket_id
        WHERE aq.status = 'pending'
          AND LOWER(jc.status_name) IN ('resolved', 'closed', 'done', 'cancelled')
      `);
      superseded += result.rowsAffected;
    } catch (err) {
      console.warn('[approvals] approval_queue superseded cleanup failed:', err instanceof Error ? err.message : err);
    }

    // 4. Supersede agent_decisions where Jira ticket is resolved/closed/done (via cache)
    try {
      const result = await execute(`
        UPDATE ad
        SET ad.approval_status = 'superseded',
            ad.resolved_at = GETUTCDATE()
        FROM agent_decisions ad
        JOIN jira_issue_cache jc ON jc.issue_key = ad.ticket_id
        WHERE ad.approval_required = 1
          AND (ad.approval_status IS NULL OR ad.approval_status = 'pending')
          AND LOWER(jc.status_name) IN ('resolved', 'closed', 'done', 'cancelled')
      `);
      superseded += result.rowsAffected;
    } catch (err) {
      console.warn('[approvals] agent_decisions superseded cleanup failed:', err instanceof Error ? err.message : err);
    }

    return { expired, superseded };
  }

  async getDailyStats(days: number = 90): Promise<Array<{ date: string; approved: number; declined: number; timed_out: number; total_decisions: number }>> {
    return query<{ date: string; approved: number; declined: number; timed_out: number; total_decisions: number }>(`
      SELECT date, SUM(approved) as approved, SUM(declined) as declined, SUM(timed_out) as timed_out, SUM(total_decisions) as total_decisions
      FROM (
        SELECT CAST(decided_at AS DATE) as date,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) as declined,
          SUM(CASE WHEN status = 'timed_out' THEN 1 ELSE 0 END) as timed_out,
          COUNT(*) as total_decisions
        FROM approval_queue
        WHERE status IN ('approved', 'declined', 'timed_out')
          AND decided_at >= DATEADD(day, -?, GETUTCDATE())
        GROUP BY CAST(decided_at AS DATE)
        UNION ALL
        SELECT CAST(resolved_at AS DATE) as date,
          SUM(CASE WHEN approval_status IN ('approved', 'confirmed', 'executed') THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN approval_status = 'declined' THEN 1 ELSE 0 END) as declined,
          0 as timed_out,
          COUNT(*) as total_decisions
        FROM agent_decisions
        WHERE approval_required = 1
          AND approval_status IN ('approved', 'confirmed', 'executed', 'declined')
          AND resolved_at >= DATEADD(day, -?, GETUTCDATE())
        GROUP BY CAST(resolved_at AS DATE)
      ) combined
      GROUP BY date ORDER BY date ASC
    `, [days, days]);
  }

  async getTodayStats(): Promise<{ approved: number; declined: number; timed_out: number; pending: number; resolution_rate: number }> {
    await execute(`UPDATE approval_queue SET status = 'timed_out' WHERE status = 'pending' AND expires_at <= GETUTCDATE()`);
    const qRow = await queryOne<Record<string, unknown>>(`
      SELECT
        SUM(CASE WHEN status = 'approved' AND CAST(decided_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'declined' AND CAST(decided_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as declined,
        SUM(CASE WHEN status = 'timed_out' AND CAST(decided_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as timed_out,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as total_approved,
        SUM(CASE WHEN status IN ('approved', 'declined', 'timed_out') THEN 1 ELSE 0 END) as total_decisions
      FROM approval_queue
    `);
    const nRow = await queryOne<Record<string, unknown>>(`
      SELECT
        SUM(CASE WHEN approval_status IN ('approved', 'confirmed', 'executed') AND CAST(resolved_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN approval_status = 'declined' AND CAST(resolved_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as declined,
        SUM(CASE WHEN approval_status IS NULL OR approval_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN approval_status IN ('approved', 'confirmed', 'executed') THEN 1 ELSE 0 END) as total_approved,
        SUM(CASE WHEN approval_status IN ('approved', 'confirmed', 'executed', 'declined') THEN 1 ELSE 0 END) as total_decisions
      FROM agent_decisions WHERE approval_required = 1
    `);
    const totalApproved = ((qRow?.total_approved as number) || 0) + ((nRow?.total_approved as number) || 0);
    const totalDecisions = ((qRow?.total_decisions as number) || 0) + ((nRow?.total_decisions as number) || 0);
    return {
      approved: ((qRow?.approved as number) || 0) + ((nRow?.approved as number) || 0),
      declined: ((qRow?.declined as number) || 0) + ((nRow?.declined as number) || 0),
      timed_out: (qRow?.timed_out as number) || 0,
      pending: ((qRow?.pending as number) || 0) + ((nRow?.pending as number) || 0),
      resolution_rate: totalDecisions > 0 ? Math.round((totalApproved / totalDecisions) * 100 * 10) / 10 : 0,
    };
  }
}

// ─── Training Matrix ────────────────────────────────────────────────────────

export interface TrainingCategory { id: number; name: string; sort_order: number; }
export interface TrainingItem { id: number; category_id: number; section: string; name: string; tech_lead: string | null; max_score: number; sort_order: number; }
export interface TrainingScore { id: number; item_id: number; user_id: number; score: number; updated_at: string; }

export class TrainingQueries {
  async getCategories(): Promise<TrainingCategory[]> {
    return query<TrainingCategory>(`SELECT * FROM training_categories ORDER BY sort_order, id`);
  }

  async createCategory(name: string, sort_order: number): Promise<number> {
    return executeAndGetId(`INSERT INTO training_categories (name, sort_order) VALUES (?, ?)`, [name, sort_order]);
  }

  async updateCategory(id: number, name: string, sort_order: number): Promise<void> {
    await execute(`UPDATE training_categories SET name = ?, sort_order = ? WHERE id = ?`, [name, sort_order, id]);
  }

  async deleteCategory(id: number): Promise<void> {
    await execute(`DELETE FROM training_categories WHERE id = ?`, [id]);
  }

  async deleteAllData(): Promise<void> {
    await execute(`DELETE FROM training_scores`);
    await execute(`DELETE FROM training_items`);
    await execute(`DELETE FROM training_categories`);
    await execute(`DELETE FROM training_members`);
  }

  async getMembers(): Promise<number[]> {
    const rows = await query<{ user_id: number }>(`SELECT user_id FROM training_members ORDER BY sort_order, user_id`);
    return rows.map(r => r.user_id);
  }

  async addMember(userId: number, sortOrder: number): Promise<void> {
    const existing = await queryOne<{ user_id: number }>(`SELECT user_id FROM training_members WHERE user_id = ?`, [userId]);
    if (!existing) {
      await execute(`INSERT INTO training_members (user_id, sort_order) VALUES (?, ?)`, [userId, sortOrder]);
    }
  }

  async getItems(categoryId?: number): Promise<TrainingItem[]> {
    let sql = `SELECT * FROM training_items`;
    const params: number[] = [];
    if (categoryId != null) { sql += ` WHERE category_id = ?`; params.push(categoryId); }
    sql += ` ORDER BY sort_order, id`;
    return query<TrainingItem>(sql, params);
  }

  async createItem(item: Omit<TrainingItem, 'id'>): Promise<number> {
    return executeAndGetId(
      `INSERT INTO training_items (category_id, section, name, tech_lead, max_score, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [item.category_id, item.section, item.name, item.tech_lead, item.max_score, item.sort_order]
    );
  }

  async updateItem(id: number, updates: Partial<Omit<TrainingItem, 'id'>>): Promise<void> {
    const fields: string[] = [];
    const vals: (string | number | null)[] = [];
    if (updates.category_id != null) { fields.push('category_id = ?'); vals.push(updates.category_id); }
    if (updates.section != null) { fields.push('section = ?'); vals.push(updates.section); }
    if (updates.name != null) { fields.push('name = ?'); vals.push(updates.name); }
    if ('tech_lead' in updates) { fields.push('tech_lead = ?'); vals.push(updates.tech_lead ?? null); }
    if (updates.max_score != null) { fields.push('max_score = ?'); vals.push(updates.max_score); }
    if (updates.sort_order != null) { fields.push('sort_order = ?'); vals.push(updates.sort_order); }
    if (fields.length === 0) return;
    vals.push(id);
    await execute(`UPDATE training_items SET ${fields.join(', ')} WHERE id = ?`, vals);
  }

  async deleteItem(id: number): Promise<void> {
    await execute(`DELETE FROM training_items WHERE id = ?`, [id]);
  }

  async getScores(categoryId?: number, userId?: number): Promise<TrainingScore[]> {
    let sql = `SELECT ts.* FROM training_scores ts`;
    const params: number[] = [];
    if (categoryId != null) {
      sql += ` JOIN training_items ti ON ts.item_id = ti.id WHERE ti.category_id = ?`;
      params.push(categoryId);
      if (userId != null) { sql += ` AND ts.user_id = ?`; params.push(userId); }
    } else if (userId != null) {
      sql += ` WHERE ts.user_id = ?`;
      params.push(userId);
    }
    return query<TrainingScore>(sql, params);
  }

  async upsertScore(item_id: number, user_id: number, score: number): Promise<void> {
    await execute(`
      MERGE INTO training_scores WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?)) AS source(item_id, user_id, score)
      ON target.item_id = source.item_id AND target.user_id = source.user_id
      WHEN MATCHED THEN UPDATE SET score = source.score, updated_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (item_id, user_id, score, updated_at) VALUES (source.item_id, source.user_id, source.score, GETUTCDATE());
    `, [item_id, user_id, score]);
  }

  async bulkUpsertScores(scores: Array<{ item_id: number; user_id: number; score: number }>): Promise<void> {
    for (const s of scores) await this.upsertScore(s.item_id, s.user_id, s.score);
  }

  async bulkImport(data: {
    categories: Array<{ name: string; sort_order: number }>;
    items: Array<{ categoryName: string; section: string; name: string; tech_lead: string | null; max_score: number; sort_order: number }>;
    scores: Array<{ itemCategoryName: string; itemSection: string; itemName: string; user_id: number; score: number }>;
  }): Promise<{ categories: number; items: number; scores: number }> {
    let catCount = 0, itemCount = 0, scoreCount = 0;
    const catMap = new Map<string, number>();

    for (const cat of data.categories) {
      try {
        const id = await executeAndGetId(`INSERT INTO training_categories (name, sort_order) VALUES (?, ?)`, [cat.name, cat.sort_order]);
        catMap.set(cat.name, id);
        catCount++;
      } catch {
        const existing = await queryOne<{ id: number }>(`SELECT id FROM training_categories WHERE name = ?`, [cat.name]);
        if (existing) catMap.set(cat.name, existing.id);
      }
    }

    const itemMap = new Map<string, number>();
    for (const item of data.items) {
      const catId = catMap.get(item.categoryName);
      if (catId == null) continue;
      const id = await executeAndGetId(
        `INSERT INTO training_items (category_id, section, name, tech_lead, max_score, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
        [catId, item.section, item.name, item.tech_lead, item.max_score, item.sort_order]
      );
      itemMap.set(`${item.categoryName}||${item.section}||${item.name}`, id);
      itemCount++;
    }

    for (const s of data.scores) {
      const itemId = itemMap.get(`${s.itemCategoryName}||${s.itemSection}||${s.itemName}`);
      if (itemId == null) continue;
      await this.upsertScore(itemId, s.user_id, s.score);
      scoreCount++;
    }

    return { categories: catCount, items: itemCount, scores: scoreCount };
  }
}

// ─── Backlog Kanban ─────────────────────────────────────────────────────────

export interface BacklogColumn {
  id: number;
  title: string;
  sort_order: number;
  color: string | null;
  created_at: string;
  item_count?: number;
}

export interface BacklogItem {
  id: number;
  column_id: number;
  title: string;
  description: string | null;
  wp_ref: string | null;
  effort: string | null;
  type: string | null;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  blocked_reason: string | null;
}

export class BacklogQueries {
  // ── Columns ──

  async getColumns(): Promise<BacklogColumn[]> {
    return query<BacklogColumn>(
      `SELECT c.*, (SELECT COUNT(*) FROM backlog_items WHERE column_id = c.id) AS item_count
       FROM backlog_columns c ORDER BY c.sort_order`
    );
  }

  async getColumnById(id: number): Promise<BacklogColumn | undefined> {
    return queryOne<BacklogColumn>(`SELECT * FROM backlog_columns WHERE id = ?`, [id]);
  }

  async getColumnByTitle(title: string): Promise<BacklogColumn | undefined> {
    return queryOne<BacklogColumn>(`SELECT * FROM backlog_columns WHERE LOWER(title) = LOWER(?)`, [title]);
  }

  async createColumn(title: string, color?: string): Promise<number> {
    const maxOrder = await queryOne<{ m: number }>(`SELECT ISNULL(MAX(sort_order), -1) AS m FROM backlog_columns`);
    return executeAndGetId(
      `INSERT INTO backlog_columns (title, sort_order, color) VALUES (?, ?, ?)`,
      [title, (maxOrder?.m ?? -1) + 1, color ?? null]
    );
  }

  async updateColumn(id: number, fields: { title?: string; color?: string; sort_order?: number }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fields.title !== undefined) { sets.push('title = ?'); params.push(fields.title); }
    if (fields.color !== undefined) { sets.push('color = ?'); params.push(fields.color); }
    if (fields.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(fields.sort_order); }
    if (sets.length === 0) return;
    params.push(id);
    await execute(`UPDATE backlog_columns SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteColumn(id: number): Promise<void> {
    await execute(`DELETE FROM backlog_columns WHERE id = ?`, [id]);
  }

  async reorderColumns(columnIds: number[]): Promise<void> {
    for (let i = 0; i < columnIds.length; i++) {
      await execute(`UPDATE backlog_columns SET sort_order = ? WHERE id = ?`, [i, columnIds[i]]);
    }
  }

  async columnItemCount(id: number): Promise<number> {
    const row = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM backlog_items WHERE column_id = ?`, [id]);
    return row?.c ?? 0;
  }

  // ── Items ──

  async getItems(filters?: { column_id?: number; type?: string }): Promise<BacklogItem[]> {
    let sql = `SELECT * FROM backlog_items WHERE 1=1`;
    const params: unknown[] = [];
    if (filters?.column_id) { sql += ` AND column_id = ?`; params.push(filters.column_id); }
    if (filters?.type) { sql += ` AND type = ?`; params.push(filters.type); }
    sql += ` ORDER BY column_id, priority`;
    return query<BacklogItem>(sql, params);
  }

  async getItemById(id: number): Promise<BacklogItem | undefined> {
    return queryOne<BacklogItem>(`SELECT * FROM backlog_items WHERE id = ?`, [id]);
  }

  async findItemByRef(wpRef: string): Promise<BacklogItem | undefined> {
    return queryOne<BacklogItem>(`SELECT * FROM backlog_items WHERE LOWER(wp_ref) = LOWER(?)`, [wpRef]);
  }

  async findItemsByTitle(title: string): Promise<BacklogItem[]> {
    return query<BacklogItem>(`SELECT * FROM backlog_items WHERE LOWER(title) LIKE LOWER(?)`, [`%${title}%`]);
  }

  async createItem(item: {
    column_id: number; title: string; description?: string; wp_ref?: string;
    effort?: string; type?: string; priority?: number; created_by?: string;
  }): Promise<number> {
    const maxPri = await queryOne<{ m: number }>(
      `SELECT ISNULL(MAX(priority), -1) AS m FROM backlog_items WHERE column_id = ?`, [item.column_id]
    );
    const priority = item.priority ?? ((maxPri?.m ?? -1) + 1);
    return executeAndGetId(
      `INSERT INTO backlog_items (column_id, title, description, wp_ref, effort, type, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.column_id, item.title, item.description ?? null, item.wp_ref ?? null,
       item.effort ?? null, item.type ?? null, priority, item.created_by ?? null]
    );
  }

  async updateItem(id: number, fields: Partial<Omit<BacklogItem, 'id' | 'created_at'>>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const allowed = ['column_id', 'title', 'description', 'wp_ref', 'effort', 'type', 'priority', 'created_by', 'completed_at', 'blocked_reason'] as const;
    for (const key of allowed) {
      if ((fields as Record<string, unknown>)[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push((fields as Record<string, unknown>)[key]);
      }
    }
    if (sets.length === 0) return;
    sets.push('updated_at = GETUTCDATE()');
    params.push(id);
    await execute(`UPDATE backlog_items SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteItem(id: number): Promise<void> {
    await execute(`DELETE FROM backlog_items WHERE id = ?`, [id]);
  }

  async moveItem(id: number, columnId: number, priority?: number): Promise<void> {
    const col = await this.getColumnById(columnId);
    const completedAt = col && col.title.toLowerCase() === 'done' ? 'GETUTCDATE()' : 'NULL';
    if (priority !== undefined) {
      await execute(
        `UPDATE backlog_items SET column_id = ?, priority = ?, completed_at = ${completedAt}, updated_at = GETUTCDATE() WHERE id = ?`,
        [columnId, priority, id]
      );
    } else {
      const maxPri = await queryOne<{ m: number }>(
        `SELECT ISNULL(MAX(priority), -1) AS m FROM backlog_items WHERE column_id = ?`, [columnId]
      );
      await execute(
        `UPDATE backlog_items SET column_id = ?, priority = ?, completed_at = ${completedAt}, updated_at = GETUTCDATE() WHERE id = ?`,
        [columnId, (maxPri?.m ?? -1) + 1, id]
      );
    }
  }

  async reorderItems(columnId: number, itemIds: number[]): Promise<void> {
    for (let i = 0; i < itemIds.length; i++) {
      await execute(`UPDATE backlog_items SET priority = ? WHERE id = ? AND column_id = ?`, [i, itemIds[i], columnId]);
    }
  }
}

// ── Auto-Rule Override Queries ──

export class AutoRuleOverrideQueries {
  async getOverrides(): Promise<Record<string, boolean>> {
    const rows = await query<{ rule_id: string; enabled: boolean }>(`SELECT rule_id, enabled FROM auto_rule_overrides`);
    const map: Record<string, boolean> = {};
    for (const r of rows) map[r.rule_id] = !!r.enabled;
    return map;
  }

  async setEnabled(ruleId: string, enabled: boolean, username: string): Promise<void> {
    await execute(
      `MERGE auto_rule_overrides AS t
       USING (SELECT ? AS rule_id) AS s ON t.rule_id = s.rule_id
       WHEN MATCHED THEN UPDATE SET
         enabled = ?,
         disabled_by = CASE WHEN ? = 0 THEN ? ELSE NULL END,
         disabled_at = CASE WHEN ? = 0 THEN GETUTCDATE() ELSE NULL END,
         updated_at = GETUTCDATE()
       WHEN NOT MATCHED THEN INSERT (rule_id, enabled, disabled_by, disabled_at, updated_at)
         VALUES (?, ?,
           CASE WHEN ? = 0 THEN ? ELSE NULL END,
           CASE WHEN ? = 0 THEN GETUTCDATE() ELSE NULL END,
           GETUTCDATE());`,
      [ruleId, enabled ? 1 : 0, enabled ? 1 : 0, username, enabled ? 1 : 0, ruleId, enabled ? 1 : 0, enabled ? 1 : 0, username, enabled ? 1 : 0],
    );
  }
}

// ── Assignment Retry Queue ──

export interface RetryQueueItem {
  id: number;
  ticket_key: string;
  pool: string;
  project_key: string;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  resolved: boolean;
  resolved_reason: string | null;
  created_at: string;
  updated_at: string;
}

export class AssignmentRetryQueries {
  async insert(ticketKey: string, pool: string, projectKey: string, error?: string): Promise<number> {
    return executeAndGetId(
      `MERGE assignment_retry_queue AS t
       USING (SELECT ? AS ticket_key) AS s ON t.ticket_key = s.ticket_key
       WHEN MATCHED AND t.resolved = 0 THEN UPDATE SET
         last_error = ?, updated_at = GETUTCDATE()
       WHEN NOT MATCHED THEN INSERT (ticket_key, pool, project_key, last_error)
         VALUES (?, ?, ?, ?);`,
      [ticketKey, error ?? null, ticketKey, pool, projectKey, error ?? null],
    );
  }

  async getUnresolved(limit: number = 10): Promise<RetryQueueItem[]> {
    return query<RetryQueueItem>(
      `SELECT TOP(?) * FROM assignment_retry_queue
       WHERE resolved = 0 AND retry_count < max_retries
       ORDER BY created_at ASC`,
      [limit],
    );
  }

  async incrementRetry(id: number, error?: string): Promise<void> {
    await execute(
      `UPDATE assignment_retry_queue
       SET retry_count = retry_count + 1, last_error = ?, updated_at = GETUTCDATE()
       WHERE id = ?`,
      [error ?? null, id],
    );
  }

  async markResolved(ticketKey: string, reason: string): Promise<void> {
    await execute(
      `UPDATE assignment_retry_queue
       SET resolved = 1, resolved_reason = ?, updated_at = GETUTCDATE()
       WHERE ticket_key = ? AND resolved = 0`,
      [reason, ticketKey],
    );
  }

  async markExhausted(id: number): Promise<void> {
    await execute(
      `UPDATE assignment_retry_queue
       SET resolved = 1, resolved_reason = 'max_retries_exhausted', updated_at = GETUTCDATE()
       WHERE id = ?`,
      [id],
    );
  }

  async isQueued(ticketKey: string): Promise<boolean> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM assignment_retry_queue WHERE ticket_key = ? AND resolved = 0`,
      [ticketKey],
    );
    return (row?.cnt ?? 0) > 0;
  }
}
