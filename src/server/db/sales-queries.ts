import type { Database } from 'sql.js';
import { saveDb } from './schema.js';

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
  constructor(private db: Database) {}

  // ── Pipeline ──────────────────────────────────────────────────────────────

  getAllDeals(salesperson?: string): PipelineDeal[] {
    let sql = 'SELECT * FROM sales_pipeline';
    const params: string[] = [];
    if (salesperson) {
      sql += ' WHERE salesperson = ?';
      params.push(salesperson);
    }
    sql += ' ORDER BY next_chase_date ASC, est_close_date ASC';
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results: PipelineDeal[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as PipelineDeal);
    stmt.free();
    return results;
  }

  getDealById(id: number): PipelineDeal | null {
    const stmt = this.db.prepare('SELECT * FROM sales_pipeline WHERE id = ?');
    stmt.bind([id]);
    const result = stmt.step() ? (stmt.getAsObject() as unknown as PipelineDeal) : null;
    stmt.free();
    return result;
  }

  createDeal(deal: Omit<PipelineDeal, 'id' | 'created_at' | 'updated_at'>): number {
    this.db.run(
      `INSERT INTO sales_pipeline (salesperson, lead_gen, company, mrr, product, stage, demo_date, est_close_date, next_chase_date, contact, phone, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [deal.salesperson, deal.lead_gen, deal.company, deal.mrr, deal.product, deal.stage, deal.demo_date, deal.est_close_date, deal.next_chase_date, deal.contact, deal.phone, deal.notes],
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateDeal(id: number, updates: Partial<Omit<PipelineDeal, 'id' | 'created_at'>>): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (key === 'updated_at') continue;
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (!fields.length) return false;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.run(`UPDATE sales_pipeline SET ${fields.join(', ')} WHERE id = ?`, values as any[]);
    saveDb();
    return this.db.getRowsModified() > 0;
  }

  deleteDeal(id: number): boolean {
    this.db.run('DELETE FROM sales_pipeline WHERE id = ?', [id]);
    saveDb();
    return this.db.getRowsModified() > 0;
  }

  getDealCount(): number {
    const result = this.db.exec('SELECT COUNT(*) FROM sales_pipeline');
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  // ── Monthly Sales ─────────────────────────────────────────────────────────

  getMonthlySales(month?: string): MonthlySale[] {
    let sql = 'SELECT * FROM sales_monthly';
    const params: string[] = [];
    if (month) {
      sql += " WHERE sale_date LIKE ?";
      params.push(`${month}%`);
    }
    sql += ' ORDER BY sale_date DESC';
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results: MonthlySale[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as MonthlySale);
    stmt.free();
    return results;
  }

  createSale(sale: Omit<MonthlySale, 'id' | 'created_at' | 'updated_at'>): number {
    this.db.run(
      `INSERT INTO sales_monthly (sale_date, lead_gen, salesperson, product, trading_name, limited_company, company_number, email, setup_fee, licence, upsell_mrr, postal, coms, trial_mrr, actual_mrr, branches, existing_vs_new, hotbox_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sale.sale_date, sale.lead_gen, sale.salesperson, sale.product, sale.trading_name, sale.limited_company, sale.company_number, sale.email, sale.setup_fee, sale.licence, sale.upsell_mrr, sale.postal, sale.coms, sale.trial_mrr, sale.actual_mrr, sale.branches, sale.existing_vs_new, sale.hotbox_ref],
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateSale(id: number, updates: Partial<Omit<MonthlySale, 'id' | 'created_at'>>): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (key === 'updated_at') continue;
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (!fields.length) return false;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.run(`UPDATE sales_monthly SET ${fields.join(', ')} WHERE id = ?`, values as any[]);
    saveDb();
    return this.db.getRowsModified() > 0;
  }

  deleteSale(id: number): boolean {
    this.db.run('DELETE FROM sales_monthly WHERE id = ?', [id]);
    saveDb();
    return this.db.getRowsModified() > 0;
  }

  getSaleCount(): number {
    const result = this.db.exec('SELECT COUNT(*) FROM sales_monthly');
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  // ── Targets ───────────────────────────────────────────────────────────────

  getTargets(month?: string): SalesTarget[] {
    let sql = 'SELECT * FROM sales_targets';
    const params: string[] = [];
    if (month) { sql += ' WHERE month = ?'; params.push(month); }
    sql += ' ORDER BY salesperson';
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results: SalesTarget[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as SalesTarget);
    stmt.free();
    return results;
  }

  setTarget(salesperson: string, month: string, targetMrr: number): void {
    this.db.run(
      `INSERT INTO sales_targets (salesperson, month, target_mrr) VALUES (?, ?, ?)
       ON CONFLICT(salesperson, month) DO UPDATE SET target_mrr = excluded.target_mrr`,
      [salesperson, month, targetMrr],
    );
    saveDb();
  }

  deleteTarget(id: number): boolean {
    this.db.run('DELETE FROM sales_targets WHERE id = ?', [id]);
    saveDb();
    return this.db.getRowsModified() > 0;
  }

  // ── Bulk operations (for xlsx import) ──────────────────────────────────

  clearAllDeals(): void {
    this.db.run('DELETE FROM sales_pipeline');
  }

  clearAllSales(): void {
    this.db.run('DELETE FROM sales_monthly');
  }

  clearAllTargets(): void {
    this.db.run('DELETE FROM sales_targets');
  }

  bulkCreateDeals(deals: Omit<PipelineDeal, 'id' | 'created_at' | 'updated_at'>[]): number {
    let count = 0;
    for (const deal of deals) {
      this.db.run(
        `INSERT INTO sales_pipeline (salesperson, lead_gen, company, mrr, product, stage, demo_date, est_close_date, next_chase_date, contact, phone, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [deal.salesperson, deal.lead_gen, deal.company, deal.mrr, deal.product, deal.stage, deal.demo_date, deal.est_close_date, deal.next_chase_date, deal.contact, deal.phone, deal.notes],
      );
      count++;
    }
    saveDb();
    return count;
  }

  bulkCreateSales(sales: Omit<MonthlySale, 'id' | 'created_at' | 'updated_at'>[]): number {
    let count = 0;
    for (const sale of sales) {
      this.db.run(
        `INSERT INTO sales_monthly (sale_date, lead_gen, salesperson, product, trading_name, limited_company, company_number, email, setup_fee, licence, upsell_mrr, postal, coms, trial_mrr, actual_mrr, branches, existing_vs_new, hotbox_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sale.sale_date, sale.lead_gen, sale.salesperson, sale.product, sale.trading_name, sale.limited_company, sale.company_number, sale.email, sale.setup_fee, sale.licence, sale.upsell_mrr, sale.postal, sale.coms, sale.trial_mrr, sale.actual_mrr, sale.branches, sale.existing_vs_new, sale.hotbox_ref],
      );
      count++;
    }
    saveDb();
    return count;
  }

  // ── Bookings ──────────────────────────────────────────────────────────────

  getBookings(month?: string): Booking[] {
    let sql = 'SELECT * FROM sales_bookings';
    const params: string[] = [];
    if (month) {
      sql += ' WHERE booked_date LIKE ?';
      params.push(`${month}%`);
    }
    sql += ' ORDER BY booked_date DESC';
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results: Booking[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as Booking);
    stmt.free();
    return results;
  }

  getBookingById(id: number): Booking | null {
    const stmt = this.db.prepare('SELECT * FROM sales_bookings WHERE id = ?');
    stmt.bind([id]);
    const result = stmt.step() ? (stmt.getAsObject() as unknown as Booking) : null;
    stmt.free();
    return result;
  }

  createBooking(b: Omit<Booking, 'id' | 'created_at'>): number {
    this.db.run(
      `INSERT INTO sales_bookings (booked_date, salesperson, lead_gen, team, product, company, email, client_type, demo_date, dm, phone, lead_source, taken_place)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.booked_date, b.salesperson, b.lead_gen, b.team, b.product, b.company, b.email, b.client_type, b.demo_date, b.dm, b.phone, b.lead_source, b.taken_place ?? 0],
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateBooking(id: number, updates: Partial<Omit<Booking, 'id' | 'created_at'>>): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (!fields.length) return false;
    values.push(id);
    this.db.run(`UPDATE sales_bookings SET ${fields.join(', ')} WHERE id = ?`, values as any[]);
    saveDb();
    return this.db.getRowsModified() > 0;
  }

  deleteBooking(id: number): boolean {
    this.db.run('DELETE FROM sales_bookings WHERE id = ?', [id]);
    saveDb();
    return this.db.getRowsModified() > 0;
  }

  clearAllBookings(): void {
    this.db.run('DELETE FROM sales_bookings');
  }

  bulkCreateBookings(bookings: Omit<Booking, 'id' | 'created_at'>[]): number {
    let count = 0;
    for (const b of bookings) {
      this.db.run(
        `INSERT INTO sales_bookings (booked_date, salesperson, lead_gen, team, product, company, email, client_type, demo_date, dm, phone, lead_source, taken_place)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.booked_date, b.salesperson, b.lead_gen, b.team, b.product, b.company, b.email, b.client_type, b.demo_date, b.dm, b.phone, b.lead_source, b.taken_place ?? 0],
      );
      count++;
    }
    saveDb();
    return count;
  }

  // ── Taken Place ─────────────────────────────────────────────────────────

  getTakenPlace(month?: string): TakenPlace[] {
    let sql = 'SELECT * FROM sales_taken_place';
    const params: string[] = [];
    if (month) {
      sql += ' WHERE demo_date LIKE ?';
      params.push(`${month}%`);
    }
    sql += ' ORDER BY demo_date DESC';
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results: TakenPlace[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as TakenPlace);
    stmt.free();
    return results;
  }

  getTakenPlaceById(id: number): TakenPlace | null {
    const stmt = this.db.prepare('SELECT * FROM sales_taken_place WHERE id = ?');
    stmt.bind([id]);
    const result = stmt.step() ? (stmt.getAsObject() as unknown as TakenPlace) : null;
    stmt.free();
    return result;
  }

  createTakenPlace(tp: Omit<TakenPlace, 'id' | 'created_at'>): number {
    this.db.run(
      `INSERT INTO sales_taken_place (demo_date, salesperson, lead_gen, product, company, email, branches, dm, est_mrr, hwc, in_hotbox, client_type, notes, booking_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tp.demo_date, tp.salesperson, tp.lead_gen, tp.product, tp.company, tp.email, tp.branches ?? 1, tp.dm, tp.est_mrr ?? 0, tp.hwc, tp.in_hotbox ?? 'No', tp.client_type, tp.notes, tp.booking_id],
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = (result[0]?.values[0]?.[0] as number) ?? 0;
    saveDb();
    return id;
  }

  updateTakenPlace(id: number, updates: Partial<Omit<TakenPlace, 'id' | 'created_at'>>): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (!fields.length) return false;
    values.push(id);
    this.db.run(`UPDATE sales_taken_place SET ${fields.join(', ')} WHERE id = ?`, values as any[]);
    saveDb();
    return this.db.getRowsModified() > 0;
  }

  deleteTakenPlace(id: number): boolean {
    this.db.run('DELETE FROM sales_taken_place WHERE id = ?', [id]);
    saveDb();
    return this.db.getRowsModified() > 0;
  }

  clearAllTakenPlace(): void {
    this.db.run('DELETE FROM sales_taken_place');
  }

  bulkCreateTakenPlace(items: Omit<TakenPlace, 'id' | 'created_at'>[]): number {
    let count = 0;
    for (const tp of items) {
      this.db.run(
        `INSERT INTO sales_taken_place (demo_date, salesperson, lead_gen, product, company, email, branches, dm, est_mrr, hwc, in_hotbox, client_type, notes, booking_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tp.demo_date, tp.salesperson, tp.lead_gen, tp.product, tp.company, tp.email, tp.branches ?? 1, tp.dm, tp.est_mrr ?? 0, tp.hwc, tp.in_hotbox ?? 'No', tp.client_type, tp.notes, tp.booking_id],
      );
      count++;
    }
    saveDb();
    return count;
  }

  // ── Lead Gen KPIs ───────────────────────────────────────────────────────

  getLgKpis(month?: string): LgKpi[] {
    let sql = 'SELECT * FROM sales_lg_kpi';
    const params: string[] = [];
    if (month) { sql += ' WHERE month = ?'; params.push(month); }
    sql += ' ORDER BY person';
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results: LgKpi[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as LgKpi);
    stmt.free();
    return results;
  }

  setLgKpi(person: string, month: string, data: Partial<Omit<LgKpi, 'id' | 'person' | 'month'>>): void {
    this.db.run(
      `INSERT INTO sales_lg_kpi (person, month, days_worked, calls_kpi, calls_actual, booked_kpi, booked_actual, tp_kpi, tp_actual, sales_count, mrr_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person, month) DO UPDATE SET
         days_worked = COALESCE(excluded.days_worked, days_worked),
         calls_kpi = COALESCE(excluded.calls_kpi, calls_kpi),
         calls_actual = COALESCE(excluded.calls_actual, calls_actual),
         booked_kpi = COALESCE(excluded.booked_kpi, booked_kpi),
         booked_actual = COALESCE(excluded.booked_actual, booked_actual),
         tp_kpi = COALESCE(excluded.tp_kpi, tp_kpi),
         tp_actual = COALESCE(excluded.tp_actual, tp_actual),
         sales_count = COALESCE(excluded.sales_count, sales_count),
         mrr_total = COALESCE(excluded.mrr_total, mrr_total)`,
      [person, month, data.days_worked ?? 0, data.calls_kpi ?? 0, data.calls_actual ?? 0,
       data.booked_kpi ?? 0, data.booked_actual ?? 0, data.tp_kpi ?? 0, data.tp_actual ?? 0,
       data.sales_count ?? 0, data.mrr_total ?? 0],
    );
    saveDb();
  }

  clearAllLgKpis(): void {
    this.db.run('DELETE FROM sales_lg_kpi');
  }

  // ── Lead Gen History (team-wide monthly totals) ──────────────────────────

  getLgHistory(): LgHistory[] {
    const stmt = this.db.prepare('SELECT * FROM sales_lg_history ORDER BY year, month_num');
    const results: LgHistory[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as LgHistory);
    stmt.free();
    return results;
  }

  setLgHistory(year: number, monthNum: number, data: { calls?: number; bookings?: number; taken_place?: number }): void {
    this.db.run(
      `INSERT INTO sales_lg_history (year, month_num, calls, bookings, taken_place)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(year, month_num) DO UPDATE SET
         calls = COALESCE(excluded.calls, calls),
         bookings = COALESCE(excluded.bookings, bookings),
         taken_place = COALESCE(excluded.taken_place, taken_place)`,
      [year, monthNum, data.calls ?? 0, data.bookings ?? 0, data.taken_place ?? 0],
    );
    saveDb();
  }

  clearAllLgHistory(): void {
    this.db.run('DELETE FROM sales_lg_history');
  }

  // ── BDM KPIs ────────────────────────────────────────────────────────────

  getBdmKpis(month?: string): BdmKpi[] {
    let sql = 'SELECT * FROM sales_bdm_kpi';
    const params: string[] = [];
    if (month) { sql += ' WHERE month = ?'; params.push(month); }
    sql += ' ORDER BY person';
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results: BdmKpi[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as unknown as BdmKpi);
    stmt.free();
    return results;
  }

  setBdmKpi(person: string, month: string, data: Partial<Omit<BdmKpi, 'id' | 'person' | 'month'>>): void {
    this.db.run(
      `INSERT INTO sales_bdm_kpi (person, month, booked_kpi, booked_actual, tp_kpi, tp_actual, sales_kpi, sales_actual, mrr_kpi, mrr_actual, target)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person, month) DO UPDATE SET
         booked_kpi = COALESCE(excluded.booked_kpi, booked_kpi),
         booked_actual = COALESCE(excluded.booked_actual, booked_actual),
         tp_kpi = COALESCE(excluded.tp_kpi, tp_kpi),
         tp_actual = COALESCE(excluded.tp_actual, tp_actual),
         sales_kpi = COALESCE(excluded.sales_kpi, sales_kpi),
         sales_actual = COALESCE(excluded.sales_actual, sales_actual),
         mrr_kpi = COALESCE(excluded.mrr_kpi, mrr_kpi),
         mrr_actual = COALESCE(excluded.mrr_actual, mrr_actual),
         target = COALESCE(excluded.target, target)`,
      [person, month, data.booked_kpi ?? 0, data.booked_actual ?? 0, data.tp_kpi ?? 0, data.tp_actual ?? 0,
       data.sales_kpi ?? 0, data.sales_actual ?? 0, data.mrr_kpi ?? 0, data.mrr_actual ?? 0, data.target ?? 0],
    );
    saveDb();
  }

  clearAllBdmKpis(): void {
    this.db.run('DELETE FROM sales_bdm_kpi');
  }
}
