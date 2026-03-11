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
}
