import { query, queryOne, execute, executeAndGetId, transaction, txExecute } from '../services/database.js';

export interface PipelineDeal {
  id: number;
  salesperson: string;
  lead_gen: string | null;
  company: string;
  mrr: number;
  product: string | null;
  stage: string;
  demo_date: string | null;
  est_close_date: string | null;
  next_chase_date: string | null;
  contact: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlySale {
  id: number;
  sale_date: string;
  lead_gen: string | null;
  salesperson: string;
  product: string | null;
  trading_name: string | null;
  limited_company: string | null;
  company_number: string | null;
  email: string | null;
  setup_fee: number;
  licence: number;
  upsell_mrr: number;
  postal: number;
  coms: number;
  trial_mrr: number;
  actual_mrr: number;
  branches: number;
  existing_vs_new: string | null;
  hotbox_ref: number | null;
  created_at: string;
  updated_at: string;
}

export interface SalesTarget {
  id: number;
  salesperson: string;
  month: string;
  target_mrr: number;
}

export interface Booking {
  id: number;
  booked_date: string;
  salesperson: string;
  lead_gen: string | null;
  team: string | null;
  product: string | null;
  company: string;
  email: string | null;
  client_type: string | null;
  demo_date: string | null;
  dm: string | null;
  phone: string | null;
  lead_source: string | null;
  taken_place: number;
  created_at: string;
}

export interface TakenPlace {
  id: number;
  demo_date: string;
  salesperson: string;
  lead_gen: string | null;
  product: string | null;
  company: string;
  email: string | null;
  branches: number;
  dm: string | null;
  est_mrr: number;
  hwc: string | null;
  in_hotbox: string;
  client_type: string | null;
  notes: string | null;
  booking_id: number | null;
  created_at: string;
}

export interface LgKpi {
  id: number;
  person: string;
  month: string;
  days_worked: number;
  calls_kpi: number;
  calls_actual: number;
  booked_kpi: number;
  booked_actual: number;
  tp_kpi: number;
  tp_actual: number;
  sales_count: number;
  mrr_total: number;
}

export interface LgHistory {
  id: number;
  year: number;
  month_num: number;
  calls: number;
  bookings: number;
  taken_place: number;
}

export interface BdmKpi {
  id: number;
  person: string;
  month: string;
  booked_kpi: number;
  booked_actual: number;
  tp_kpi: number;
  tp_actual: number;
  sales_kpi: number;
  sales_actual: number;
  mrr_kpi: number;
  mrr_actual: number;
  target: number;
}

export class SalesQueries {

  // ── Pipeline ──────────────────────────────────────────────────────────────

  async getAllDeals(salesperson?: string): Promise<PipelineDeal[]> {
    let sql = 'SELECT * FROM sales_pipeline';
    const params: string[] = [];
    if (salesperson) {
      sql += ' WHERE salesperson = ?';
      params.push(salesperson);
    }
    sql += ' ORDER BY next_chase_date ASC, est_close_date ASC';
    return query<PipelineDeal>(sql, params);
  }

  async getDealById(id: number): Promise<PipelineDeal | undefined> {
    return queryOne<PipelineDeal>('SELECT * FROM sales_pipeline WHERE id = ?', [id]);
  }

  async createDeal(deal: Omit<PipelineDeal, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    return executeAndGetId(
      `INSERT INTO sales_pipeline (salesperson, lead_gen, company, mrr, product, stage, demo_date, est_close_date, next_chase_date, contact, phone, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [deal.salesperson, deal.lead_gen, deal.company, deal.mrr, deal.product, deal.stage, deal.demo_date, deal.est_close_date, deal.next_chase_date, deal.contact, deal.phone, deal.notes],
    );
  }

  async updateDeal(id: number, updates: Partial<Omit<PipelineDeal, 'id' | 'created_at'>>): Promise<boolean> {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (key === 'updated_at') continue;
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (!fields.length) return false;
    fields.push('updated_at = GETUTCDATE()');
    values.push(id);
    const result = await execute(`UPDATE sales_pipeline SET ${fields.join(', ')} WHERE id = ?`, values);
    return result.rowsAffected > 0;
  }

  async deleteDeal(id: number): Promise<boolean> {
    const result = await execute('DELETE FROM sales_pipeline WHERE id = ?', [id]);
    return result.rowsAffected > 0;
  }

  async getDealCount(): Promise<number> {
    const row = await queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM sales_pipeline');
    return row?.cnt ?? 0;
  }

  // ── Monthly Sales ─────────────────────────────────────────────────────────

  async getMonthlySales(month?: string): Promise<MonthlySale[]> {
    let sql = 'SELECT * FROM sales_monthly';
    const params: string[] = [];
    if (month) {
      sql += ' WHERE sale_date LIKE ?';
      params.push(`${month}%`);
    }
    sql += ' ORDER BY sale_date DESC';
    return query<MonthlySale>(sql, params);
  }

  async createSale(sale: Omit<MonthlySale, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    return executeAndGetId(
      `INSERT INTO sales_monthly (sale_date, lead_gen, salesperson, product, trading_name, limited_company, company_number, email, setup_fee, licence, upsell_mrr, postal, coms, trial_mrr, actual_mrr, branches, existing_vs_new, hotbox_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sale.sale_date, sale.lead_gen, sale.salesperson, sale.product, sale.trading_name, sale.limited_company, sale.company_number, sale.email, sale.setup_fee, sale.licence, sale.upsell_mrr, sale.postal, sale.coms, sale.trial_mrr, sale.actual_mrr, sale.branches, sale.existing_vs_new, sale.hotbox_ref],
    );
  }

  async updateSale(id: number, updates: Partial<Omit<MonthlySale, 'id' | 'created_at'>>): Promise<boolean> {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (key === 'updated_at') continue;
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (!fields.length) return false;
    fields.push('updated_at = GETUTCDATE()');
    values.push(id);
    const result = await execute(`UPDATE sales_monthly SET ${fields.join(', ')} WHERE id = ?`, values);
    return result.rowsAffected > 0;
  }

  async deleteSale(id: number): Promise<boolean> {
    const result = await execute('DELETE FROM sales_monthly WHERE id = ?', [id]);
    return result.rowsAffected > 0;
  }

  async getSaleCount(): Promise<number> {
    const row = await queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM sales_monthly');
    return row?.cnt ?? 0;
  }

  // ── Targets ───────────────────────────────────────────────────────────────

  async getTargets(month?: string): Promise<SalesTarget[]> {
    let sql = 'SELECT * FROM sales_targets';
    const params: string[] = [];
    if (month) { sql += ' WHERE month = ?'; params.push(month); }
    sql += ' ORDER BY salesperson';
    return query<SalesTarget>(sql, params);
  }

  async setTarget(salesperson: string, month: string, targetMrr: number): Promise<void> {
    await execute(
      `MERGE INTO sales_targets WITH (HOLDLOCK) AS target
       USING (VALUES (?, ?, ?)) AS source(salesperson, month, target_mrr)
       ON target.salesperson = source.salesperson AND target.month = source.month
       WHEN MATCHED THEN UPDATE SET target_mrr = source.target_mrr
       WHEN NOT MATCHED THEN INSERT (salesperson, month, target_mrr) VALUES (source.salesperson, source.month, source.target_mrr);`,
      [salesperson, month, targetMrr],
    );
  }

  async deleteTarget(id: number): Promise<boolean> {
    const result = await execute('DELETE FROM sales_targets WHERE id = ?', [id]);
    return result.rowsAffected > 0;
  }

  // ── Bulk operations (for xlsx import) ──────────────────────────────────

  async clearAllDeals(): Promise<void> {
    await execute('DELETE FROM sales_pipeline');
  }

  async clearAllSales(): Promise<void> {
    await execute('DELETE FROM sales_monthly');
  }

  async clearAllTargets(): Promise<void> {
    await execute('DELETE FROM sales_targets');
  }

  async bulkCreateDeals(deals: Omit<PipelineDeal, 'id' | 'created_at' | 'updated_at'>[]): Promise<number> {
    let count = 0;
    await transaction(async (tx) => {
      for (const deal of deals) {
        await txExecute(tx,
          `INSERT INTO sales_pipeline (salesperson, lead_gen, company, mrr, product, stage, demo_date, est_close_date, next_chase_date, contact, phone, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [deal.salesperson, deal.lead_gen, deal.company, deal.mrr, deal.product, deal.stage, deal.demo_date, deal.est_close_date, deal.next_chase_date, deal.contact, deal.phone, deal.notes],
        );
        count++;
      }
    });
    return count;
  }

  async bulkCreateSales(sales: Omit<MonthlySale, 'id' | 'created_at' | 'updated_at'>[]): Promise<number> {
    let count = 0;
    await transaction(async (tx) => {
      for (const sale of sales) {
        await txExecute(tx,
          `INSERT INTO sales_monthly (sale_date, lead_gen, salesperson, product, trading_name, limited_company, company_number, email, setup_fee, licence, upsell_mrr, postal, coms, trial_mrr, actual_mrr, branches, existing_vs_new, hotbox_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [sale.sale_date, sale.lead_gen, sale.salesperson, sale.product, sale.trading_name, sale.limited_company, sale.company_number, sale.email, sale.setup_fee, sale.licence, sale.upsell_mrr, sale.postal, sale.coms, sale.trial_mrr, sale.actual_mrr, sale.branches, sale.existing_vs_new, sale.hotbox_ref],
        );
        count++;
      }
    });
    return count;
  }

  // ── Bookings ──────────────────────────────────────────────────────────────

  async getBookings(month?: string): Promise<Booking[]> {
    let sql = 'SELECT * FROM sales_bookings';
    const params: string[] = [];
    if (month) {
      sql += ' WHERE booked_date LIKE ?';
      params.push(`${month}%`);
    }
    sql += ' ORDER BY booked_date DESC';
    return query<Booking>(sql, params);
  }

  async getBookingById(id: number): Promise<Booking | undefined> {
    return queryOne<Booking>('SELECT * FROM sales_bookings WHERE id = ?', [id]);
  }

  async createBooking(b: Omit<Booking, 'id' | 'created_at'>): Promise<number> {
    return executeAndGetId(
      `INSERT INTO sales_bookings (booked_date, salesperson, lead_gen, team, product, company, email, client_type, demo_date, dm, phone, lead_source, taken_place)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.booked_date, b.salesperson, b.lead_gen, b.team, b.product, b.company, b.email, b.client_type, b.demo_date, b.dm, b.phone, b.lead_source, b.taken_place ?? 0],
    );
  }

  async updateBooking(id: number, updates: Partial<Omit<Booking, 'id' | 'created_at'>>): Promise<boolean> {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (!fields.length) return false;
    values.push(id);
    const result = await execute(`UPDATE sales_bookings SET ${fields.join(', ')} WHERE id = ?`, values);
    return result.rowsAffected > 0;
  }

  async deleteBooking(id: number): Promise<boolean> {
    const result = await execute('DELETE FROM sales_bookings WHERE id = ?', [id]);
    return result.rowsAffected > 0;
  }

  async clearAllBookings(): Promise<void> {
    await execute('DELETE FROM sales_bookings');
  }

  async bulkCreateBookings(bookings: Omit<Booking, 'id' | 'created_at'>[]): Promise<number> {
    let count = 0;
    await transaction(async (tx) => {
      for (const b of bookings) {
        await txExecute(tx,
          `INSERT INTO sales_bookings (booked_date, salesperson, lead_gen, team, product, company, email, client_type, demo_date, dm, phone, lead_source, taken_place)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [b.booked_date, b.salesperson, b.lead_gen, b.team, b.product, b.company, b.email, b.client_type, b.demo_date, b.dm, b.phone, b.lead_source, b.taken_place ?? 0],
        );
        count++;
      }
    });
    return count;
  }

  // ── Taken Place ─────────────────────────────────────────────────────────

  async getTakenPlace(month?: string): Promise<TakenPlace[]> {
    let sql = 'SELECT * FROM sales_taken_place';
    const params: string[] = [];
    if (month) {
      sql += ' WHERE demo_date LIKE ?';
      params.push(`${month}%`);
    }
    sql += ' ORDER BY demo_date DESC';
    return query<TakenPlace>(sql, params);
  }

  async getTakenPlaceById(id: number): Promise<TakenPlace | undefined> {
    return queryOne<TakenPlace>('SELECT * FROM sales_taken_place WHERE id = ?', [id]);
  }

  async createTakenPlace(tp: Omit<TakenPlace, 'id' | 'created_at'>): Promise<number> {
    return executeAndGetId(
      `INSERT INTO sales_taken_place (demo_date, salesperson, lead_gen, product, company, email, branches, dm, est_mrr, hwc, in_hotbox, client_type, notes, booking_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tp.demo_date, tp.salesperson, tp.lead_gen, tp.product, tp.company, tp.email, tp.branches ?? 1, tp.dm, tp.est_mrr ?? 0, tp.hwc, tp.in_hotbox ?? 'No', tp.client_type, tp.notes, tp.booking_id],
    );
  }

  async updateTakenPlace(id: number, updates: Partial<Omit<TakenPlace, 'id' | 'created_at'>>): Promise<boolean> {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (!fields.length) return false;
    values.push(id);
    const result = await execute(`UPDATE sales_taken_place SET ${fields.join(', ')} WHERE id = ?`, values);
    return result.rowsAffected > 0;
  }

  async deleteTakenPlace(id: number): Promise<boolean> {
    const result = await execute('DELETE FROM sales_taken_place WHERE id = ?', [id]);
    return result.rowsAffected > 0;
  }

  async clearAllTakenPlace(): Promise<void> {
    await execute('DELETE FROM sales_taken_place');
  }

  async bulkCreateTakenPlace(items: Omit<TakenPlace, 'id' | 'created_at'>[]): Promise<number> {
    let count = 0;
    await transaction(async (tx) => {
      for (const tp of items) {
        await txExecute(tx,
          `INSERT INTO sales_taken_place (demo_date, salesperson, lead_gen, product, company, email, branches, dm, est_mrr, hwc, in_hotbox, client_type, notes, booking_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tp.demo_date, tp.salesperson, tp.lead_gen, tp.product, tp.company, tp.email, tp.branches ?? 1, tp.dm, tp.est_mrr ?? 0, tp.hwc, tp.in_hotbox ?? 'No', tp.client_type, tp.notes, tp.booking_id],
        );
        count++;
      }
    });
    return count;
  }

  // ── Lead Gen KPIs ───────────────────────────────────────────────────────

  async getLgKpis(month?: string): Promise<LgKpi[]> {
    let sql = 'SELECT * FROM sales_lg_kpi';
    const params: string[] = [];
    if (month) { sql += ' WHERE month = ?'; params.push(month); }
    sql += ' ORDER BY person';
    return query<LgKpi>(sql, params);
  }

  async setLgKpi(person: string, month: string, data: Partial<Omit<LgKpi, 'id' | 'person' | 'month'>>): Promise<void> {
    await execute(
      `MERGE INTO sales_lg_kpi WITH (HOLDLOCK) AS target
       USING (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)) AS source(person, month, days_worked, calls_kpi, calls_actual, booked_kpi, booked_actual, tp_kpi, tp_actual, sales_count, mrr_total)
       ON target.person = source.person AND target.month = source.month
       WHEN MATCHED THEN UPDATE SET
         days_worked = COALESCE(source.days_worked, target.days_worked),
         calls_kpi = COALESCE(source.calls_kpi, target.calls_kpi),
         calls_actual = COALESCE(source.calls_actual, target.calls_actual),
         booked_kpi = COALESCE(source.booked_kpi, target.booked_kpi),
         booked_actual = COALESCE(source.booked_actual, target.booked_actual),
         tp_kpi = COALESCE(source.tp_kpi, target.tp_kpi),
         tp_actual = COALESCE(source.tp_actual, target.tp_actual),
         sales_count = COALESCE(source.sales_count, target.sales_count),
         mrr_total = COALESCE(source.mrr_total, target.mrr_total)
       WHEN NOT MATCHED THEN INSERT (person, month, days_worked, calls_kpi, calls_actual, booked_kpi, booked_actual, tp_kpi, tp_actual, sales_count, mrr_total)
         VALUES (source.person, source.month, source.days_worked, source.calls_kpi, source.calls_actual, source.booked_kpi, source.booked_actual, source.tp_kpi, source.tp_actual, source.sales_count, source.mrr_total);`,
      [person, month, data.days_worked ?? 0, data.calls_kpi ?? 0, data.calls_actual ?? 0,
       data.booked_kpi ?? 0, data.booked_actual ?? 0, data.tp_kpi ?? 0, data.tp_actual ?? 0,
       data.sales_count ?? 0, data.mrr_total ?? 0],
    );
  }

  async clearAllLgKpis(): Promise<void> {
    await execute('DELETE FROM sales_lg_kpi');
  }

  // ── Lead Gen History (team-wide monthly totals) ──────────────────────────

  async getLgHistory(): Promise<LgHistory[]> {
    return query<LgHistory>('SELECT * FROM sales_lg_history ORDER BY year, month_num');
  }

  async setLgHistory(year: number, monthNum: number, data: { calls?: number; bookings?: number; taken_place?: number }): Promise<void> {
    await execute(
      `MERGE INTO sales_lg_history WITH (HOLDLOCK) AS target
       USING (VALUES (?, ?, ?, ?, ?)) AS source(year, month_num, calls, bookings, taken_place)
       ON target.year = source.year AND target.month_num = source.month_num
       WHEN MATCHED THEN UPDATE SET
         calls = COALESCE(source.calls, target.calls),
         bookings = COALESCE(source.bookings, target.bookings),
         taken_place = COALESCE(source.taken_place, target.taken_place)
       WHEN NOT MATCHED THEN INSERT (year, month_num, calls, bookings, taken_place)
         VALUES (source.year, source.month_num, source.calls, source.bookings, source.taken_place);`,
      [year, monthNum, data.calls ?? 0, data.bookings ?? 0, data.taken_place ?? 0],
    );
  }

  async clearAllLgHistory(): Promise<void> {
    await execute('DELETE FROM sales_lg_history');
  }

  // ── BDM KPIs ────────────────────────────────────────────────────────────

  async getBdmKpis(month?: string): Promise<BdmKpi[]> {
    let sql = 'SELECT * FROM sales_bdm_kpi';
    const params: string[] = [];
    if (month) { sql += ' WHERE month = ?'; params.push(month); }
    sql += ' ORDER BY person';
    return query<BdmKpi>(sql, params);
  }

  async setBdmKpi(person: string, month: string, data: Partial<Omit<BdmKpi, 'id' | 'person' | 'month'>>): Promise<void> {
    await execute(
      `MERGE INTO sales_bdm_kpi WITH (HOLDLOCK) AS target
       USING (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)) AS source(person, month, booked_kpi, booked_actual, tp_kpi, tp_actual, sales_kpi, sales_actual, mrr_kpi, mrr_actual, target)
       ON target.person = source.person AND target.month = source.month
       WHEN MATCHED THEN UPDATE SET
         booked_kpi = COALESCE(source.booked_kpi, target.booked_kpi),
         booked_actual = COALESCE(source.booked_actual, target.booked_actual),
         tp_kpi = COALESCE(source.tp_kpi, target.tp_kpi),
         tp_actual = COALESCE(source.tp_actual, target.tp_actual),
         sales_kpi = COALESCE(source.sales_kpi, target.sales_kpi),
         sales_actual = COALESCE(source.sales_actual, target.sales_actual),
         mrr_kpi = COALESCE(source.mrr_kpi, target.mrr_kpi),
         mrr_actual = COALESCE(source.mrr_actual, target.mrr_actual),
         target = COALESCE(source.target, target.target)
       WHEN NOT MATCHED THEN INSERT (person, month, booked_kpi, booked_actual, tp_kpi, tp_actual, sales_kpi, sales_actual, mrr_kpi, mrr_actual, target)
         VALUES (source.person, source.month, source.booked_kpi, source.booked_actual, source.tp_kpi, source.tp_actual, source.sales_kpi, source.sales_actual, source.mrr_kpi, source.mrr_actual, source.target);`,
      [person, month, data.booked_kpi ?? 0, data.booked_actual ?? 0, data.tp_kpi ?? 0, data.tp_actual ?? 0,
       data.sales_kpi ?? 0, data.sales_actual ?? 0, data.mrr_kpi ?? 0, data.mrr_actual ?? 0, data.target ?? 0],
    );
  }

  async clearAllBdmKpis(): Promise<void> {
    await execute('DELETE FROM sales_bdm_kpi');
  }
}
