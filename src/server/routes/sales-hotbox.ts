import { Router } from 'express';
import type { SalesQueries } from '../db/sales-queries.js';
import type { AreaAccessGuard } from '../middleware/auth.js';

/** Excel serial date → YYYY-MM-DD */
function excelDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30)
    const d = new Date((v - 25569) * 86400000);
    return d.toISOString().split('T')[0];
  }
  const s = String(v).trim();
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

const HOTBOX_SHEETS: Record<string, string> = {
  'Ben Hotbox': 'Ben M',
  'Nathan Hotbox': 'Nathan B',
  'Sharice Hotbox': 'Sharice R',
  'Chris Hotbox': 'Chris S',
  'George Hotbox': 'George V',
  'Steve Hotbox': 'Steve R',
  'RC Hotbox': 'Richard C',
};

const VALID_STAGES = new Set([
  'Demo Completed',
  'Proposal Submitted - Awaiting Feedback',
  'Proposal Submitted - In Discussion',
  'Contract Sent',
]);

export function createSalesHotboxRoutes(
  salesQueries: SalesQueries,
  requireAreaAccess?: AreaAccessGuard,
): Router {
  const router = Router();
  const writeGuard = requireAreaAccess
    ? requireAreaAccess('sales', 'edit')
    : (_req: any, _res: any, next: any) => next();

  // ── Pipeline deals ──────────────────────────────────────────────────────

  router.get('/pipeline', (req, res) => {
    const salesperson = req.query.salesperson as string | undefined;
    res.json({ ok: true, data: salesQueries.getAllDeals(salesperson) });
  });

  router.get('/pipeline/:id', (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    const deal = salesQueries.getDealById(id);
    if (!deal) return res.status(404).json({ ok: false, error: 'Deal not found' });
    res.json({ ok: true, data: deal });
  });

  router.post('/pipeline', writeGuard, (req, res) => {
    const { salesperson, company, mrr, stage } = req.body;
    if (!salesperson || !company || mrr == null || !stage) {
      return res.status(400).json({ ok: false, error: 'salesperson, company, mrr, and stage are required' });
    }
    const id = salesQueries.createDeal(req.body);
    res.json({ ok: true, data: salesQueries.getDealById(id) });
  });

  router.put('/pipeline/:id', writeGuard, (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    const ok = salesQueries.updateDeal(id, req.body);
    if (!ok) return res.status(404).json({ ok: false, error: 'Deal not found' });
    res.json({ ok: true, data: salesQueries.getDealById(id) });
  });

  router.delete('/pipeline/:id', writeGuard, (req, res) => {
    const ok = salesQueries.deleteDeal(parseInt(req.params.id as string, 10));
    res.json({ ok: true, deleted: ok });
  });

  // ── Monthly sales ─────────────────────────────────────────────────────

  router.get('/monthly', (req, res) => {
    const month = req.query.month as string | undefined;
    res.json({ ok: true, data: salesQueries.getMonthlySales(month) });
  });

  router.post('/monthly', writeGuard, (req, res) => {
    const { sale_date, salesperson } = req.body;
    if (!sale_date || !salesperson) {
      return res.status(400).json({ ok: false, error: 'sale_date and salesperson are required' });
    }
    const id = salesQueries.createSale(req.body);
    res.json({ ok: true, data: { id } });
  });

  router.put('/monthly/:id', writeGuard, (req, res) => {
    const ok = salesQueries.updateSale(parseInt(req.params.id as string, 10), req.body);
    res.json({ ok: true, updated: ok });
  });

  router.delete('/monthly/:id', writeGuard, (req, res) => {
    const ok = salesQueries.deleteSale(parseInt(req.params.id as string, 10));
    res.json({ ok: true, deleted: ok });
  });

  // ── Targets ───────────────────────────────────────────────────────────

  router.get('/targets', (req, res) => {
    const month = req.query.month as string | undefined;
    res.json({ ok: true, data: salesQueries.getTargets(month) });
  });

  router.post('/targets', writeGuard, (req, res) => {
    const { salesperson, month, target_mrr } = req.body;
    if (!salesperson || !month || target_mrr == null) {
      return res.status(400).json({ ok: false, error: 'salesperson, month, target_mrr required' });
    }
    salesQueries.setTarget(salesperson, month, target_mrr);
    res.json({ ok: true });
  });

  router.delete('/targets/:id', writeGuard, (req, res) => {
    const ok = salesQueries.deleteTarget(parseInt(req.params.id as string, 10));
    res.json({ ok: true, deleted: ok });
  });

  // ── Summary (computed) ────────────────────────────────────────────────

  router.get('/summary', (req, res) => {
    const month = req.query.month as string | undefined;
    const deals = salesQueries.getAllDeals();
    const sales = salesQueries.getMonthlySales(month);
    const targets = salesQueries.getTargets(month);

    const totalPipeline = deals.reduce((s, d) => s + d.mrr, 0);
    const contractsOut = deals.filter(d => d.stage === 'Contract Sent').reduce((s, d) => s + d.mrr, 0);
    const inDiscussion = deals.filter(d => d.stage === 'Proposal Submitted - In Discussion').reduce((s, d) => s + d.mrr, 0);
    const reps = new Set(deals.map(d => d.salesperson)).size;

    const totalMrr = sales.reduce((s, r) => s + (r.actual_mrr || 0), 0);
    const totalSetup = sales.reduce((s, r) => s + (r.setup_fee || 0), 0);
    const totalLicence = sales.reduce((s, r) => s + (r.licence || 0), 0);
    const totalComs = sales.reduce((s, r) => s + (r.coms || 0), 0);

    res.json({
      ok: true,
      data: {
        pipeline: { total: totalPipeline, contractsOut, inDiscussion, dealCount: deals.length, reps },
        monthly: { totalMrr, totalSetup, totalLicence, totalComs, saleCount: sales.length },
        targets,
      },
    });
  });

  // ── XLSX Import ────────────────────────────────────────────────────────

  router.post('/import', writeGuard, async (req, res) => {
    try {
      const fileData = req.body.fileData as string;
      if (!fileData) return res.status(400).json({ ok: false, error: 'fileData (base64) is required' });

      const XLSX = (await import('xlsx')).default;
      const buf = Buffer.from(fileData, 'base64');
      const wb = XLSX.read(buf, { type: 'buffer' });
      const stats = { deals: 0, sales: 0, targets: 0 };

      // ── Import pipeline deals from individual hotbox sheets ──
      const { clear } = req.body;
      if (clear) {
        salesQueries.clearAllDeals();
        salesQueries.clearAllSales();
        salesQueries.clearAllTargets();
      }

      for (const [sheetName, salesperson] of Object.entries(HOTBOX_SHEETS)) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;
        const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

        // Find header row by looking for "Company" column
        let headerIdx = -1;
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
          const row = rows[i] as unknown[];
          if (row && row.some((c: unknown) => String(c).toLowerCase().includes('company'))) {
            headerIdx = i;
            break;
          }
        }
        if (headerIdx < 0) continue;

        // RC Hotbox has a different format
        if (sheetName === 'RC Hotbox') continue; // skip — different column structure

        const header = rows[headerIdx] as string[];
        const companyCol = header.findIndex((h: string) => /company/i.test(String(h)));
        const mrrCol = header.findIndex((h: string) => /mrr/i.test(String(h)));
        const stageCol = header.findIndex((h: string) => /stage/i.test(String(h)));
        if (companyCol < 0 || mrrCol < 0 || stageCol < 0) continue;

        const deals: any[] = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i] as unknown[];
          if (!row || !row[companyCol]) continue;
          const company = String(row[companyCol]).trim();
          if (!company) continue;
          const mrr = parseFloat(String(row[mrrCol] ?? 0)) || 0;
          const stage = String(row[stageCol] ?? '').trim();
          if (!VALID_STAGES.has(stage)) continue;

          deals.push({
            salesperson,
            lead_gen: row[1] ? String(row[1]).trim() : null,
            company,
            mrr,
            product: row[4] ? String(row[4]).trim() : null,
            stage,
            demo_date: excelDate(row[0]),
            est_close_date: excelDate(row[6]),
            next_chase_date: excelDate(row[7]),
            contact: row[8] ? String(row[8]).trim() : null,
            phone: row[9] ? String(row[9]).trim() : null,
            notes: row[10] ? String(row[10]).trim().slice(0, 2000) : null,
          });
        }
        stats.deals += salesQueries.bulkCreateDeals(deals);
      }

      // ── Import current month sales ──
      const monthSheets = ['March 26', 'February 26', 'January 26'];
      for (const monthSheet of monthSheets) {
        const ws = wb.Sheets[monthSheet];
        if (!ws) continue;
        const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
        if (rows.length < 2) continue;

        const sales: any[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] as unknown[];
          if (!row || !row[0]) continue;
          const saleDate = excelDate(row[0]);
          if (!saleDate) continue;
          const salesperson = row[2] ? String(row[2]).trim() : null;
          if (!salesperson) continue;

          sales.push({
            sale_date: saleDate,
            lead_gen: row[1] ? String(row[1]).trim() : null,
            salesperson,
            product: row[3] ? String(row[3]).trim() : null,
            trading_name: row[4] ? String(row[4]).trim() : null,
            limited_company: row[6] ? String(row[6]).trim() : null,
            company_number: row[7] ? String(row[7]) : null,
            email: row[8] ? String(row[8]).trim() : null,
            setup_fee: parseFloat(String(row[9] ?? 0)) || 0,
            licence: parseFloat(String(row[10] ?? 0)) || 0,
            upsell_mrr: parseFloat(String(row[11] ?? 0)) || 0,
            postal: parseFloat(String(row[12] ?? 0)) || 0,
            coms: parseFloat(String(row[13] ?? 0)) || 0,
            trial_mrr: parseFloat(String(row[14] ?? 0)) || 0,
            actual_mrr: parseFloat(String(row[17] ?? 0)) || 0,
            branches: parseInt(String(row[18] ?? 1)) || 1,
            existing_vs_new: row[15] ? String(row[15]).trim() : null,
            hotbox_ref: row[28] ? parseInt(String(row[28])) || null : null,
          });
        }
        stats.sales += salesQueries.bulkCreateSales(sales);
      }

      // ── Import targets from right-side columns of March 26 ──
      const marchWs = wb.Sheets['March 26'];
      if (marchWs) {
        const rows = XLSX.utils.sheet_to_json<any[]>(marchWs, { header: 1 });
        // Target data is on the right side of the sheet
        // Column 31 = salesperson name, column 43 = target (based on data analysis)
        const targetMap: Record<string, number> = {
          'Ben': 14500, 'Chris': 15000, 'George': 14000,
          'Nathan': 13000, 'Nath': 13000, 'Sharice': 15000, 'Steve': 12000,
          'Rich': 6000, 'Richard': 6000,
        };
        const nameMap: Record<string, string> = {
          'Ben': 'Ben M', 'Chris': 'Chris S', 'George': 'George V',
          'Nathan': 'Nathan B', 'Nath': 'Nathan B', 'Sharice': 'Sharice R',
          'Steve': 'Steve R', 'Rich': 'Richard C', 'Richard': 'Richard C',
        };

        // Try to extract from data — look for rows with a name in col 31
        for (let i = 1; i < Math.min(rows.length, 20); i++) {
          const row = rows[i] as unknown[];
          if (!row || !row[31]) continue;
          const name = String(row[31]).trim();
          if (nameMap[name] && row[43]) {
            const target = parseFloat(String(row[43]));
            if (target > 0) {
              targetMap[name] = target;
            }
          }
        }

        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        for (const [shortName, fullName] of Object.entries(nameMap)) {
          if (targetMap[shortName]) {
            salesQueries.setTarget(fullName, currentMonth, targetMap[shortName]);
            stats.targets++;
          }
        }
      }

      res.json({ ok: true, data: stats });
    } catch (err) {
      console.error('[Sales] Import error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Import failed' });
    }
  });

  // ── Bookings ──────────────────────────────────────────────────────────

  router.get('/bookings', (req, res) => {
    const month = req.query.month as string | undefined;
    res.json({ ok: true, data: salesQueries.getBookings(month) });
  });

  router.post('/bookings', writeGuard, (req, res) => {
    const { booked_date, salesperson, company } = req.body;
    if (!booked_date || !salesperson || !company) {
      return res.status(400).json({ ok: false, error: 'booked_date, salesperson, and company are required' });
    }
    const id = salesQueries.createBooking(req.body);
    res.json({ ok: true, data: salesQueries.getBookingById(id) });
  });

  router.put('/bookings/:id', writeGuard, (req, res) => {
    const ok = salesQueries.updateBooking(parseInt(req.params.id as string, 10), req.body);
    if (!ok) return res.status(404).json({ ok: false, error: 'Booking not found' });
    res.json({ ok: true, data: salesQueries.getBookingById(parseInt(req.params.id as string, 10)) });
  });

  router.delete('/bookings/:id', writeGuard, (req, res) => {
    const ok = salesQueries.deleteBooking(parseInt(req.params.id as string, 10));
    res.json({ ok: true, deleted: ok });
  });

  // ── Taken Place ─────────────────────────────────────────────────────────

  router.get('/taken-place', (req, res) => {
    const month = req.query.month as string | undefined;
    res.json({ ok: true, data: salesQueries.getTakenPlace(month) });
  });

  router.post('/taken-place', writeGuard, (req, res) => {
    const { demo_date, salesperson, company } = req.body;
    if (!demo_date || !salesperson || !company) {
      return res.status(400).json({ ok: false, error: 'demo_date, salesperson, and company are required' });
    }
    const id = salesQueries.createTakenPlace(req.body);
    res.json({ ok: true, data: salesQueries.getTakenPlaceById(id) });
  });

  router.put('/taken-place/:id', writeGuard, (req, res) => {
    const ok = salesQueries.updateTakenPlace(parseInt(req.params.id as string, 10), req.body);
    if (!ok) return res.status(404).json({ ok: false, error: 'Record not found' });
    res.json({ ok: true, data: salesQueries.getTakenPlaceById(parseInt(req.params.id as string, 10)) });
  });

  router.delete('/taken-place/:id', writeGuard, (req, res) => {
    const ok = salesQueries.deleteTakenPlace(parseInt(req.params.id as string, 10));
    res.json({ ok: true, deleted: ok });
  });

  // ── KPIs ────────────────────────────────────────────────────────────────

  router.get('/lg-kpis', (req, res) => {
    const month = req.query.month as string | undefined;
    res.json({ ok: true, data: salesQueries.getLgKpis(month) });
  });

  router.post('/lg-kpis', writeGuard, (req, res) => {
    const { person, month } = req.body;
    if (!person || !month) return res.status(400).json({ ok: false, error: 'person and month required' });
    salesQueries.setLgKpi(person, month, req.body);
    res.json({ ok: true });
  });

  router.get('/bdm-kpis', (req, res) => {
    const month = req.query.month as string | undefined;
    res.json({ ok: true, data: salesQueries.getBdmKpis(month) });
  });

  router.post('/bdm-kpis', writeGuard, (req, res) => {
    const { person, month } = req.body;
    if (!person || !month) return res.status(400).json({ ok: false, error: 'person and month required' });
    salesQueries.setBdmKpi(person, month, req.body);
    res.json({ ok: true });
  });

  // ── LG History (team-wide monthly totals) ─────────────────────────────

  router.get('/lg-history', (_req, res) => {
    res.json({ ok: true, data: salesQueries.getLgHistory() });
  });

  // ── Data Pack Import (Dream Team Tracker spreadsheet) ────────────────

  router.post('/import-data-pack', writeGuard, async (req, res) => {
    try {
      const fileData = req.body.fileData as string;
      if (!fileData) return res.status(400).json({ ok: false, error: 'fileData (base64) is required' });

      const XLSX = (await import('xlsx')).default;
      const buf = Buffer.from(fileData, 'base64');
      const wb = XLSX.read(buf, { type: 'buffer' });
      const stats = { lgKpis: 0, lgHistory: 0 };

      // ── Parse "Lead Gen 2023" sheet: per-person weekly data ──

      const lgSheetName = wb.SheetNames.find((n: string) => n.includes('Lead Gen 2023'));
      if (lgSheetName) {
        const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[lgSheetName], { header: 1, defval: '', range: 0 });
        const headers = data[0] as unknown[];

        // Build date-to-column mapping: col index → { year, month }
        const colMonths: Record<number, { year: number; month: number }> = {};
        headers.forEach((h, i) => {
          if (typeof h === 'number' && h > 40000) {
            const d = new Date((h - 25569) * 86400000);
            colMonths[i] = { year: d.getFullYear(), month: d.getMonth() + 1 };
          }
        });

        // Person row mappings: { name, daysRow, callsRow, bookedTotalRow, callsPerDay }
        const LG_PEOPLE = [
          { name: 'Jane O',   daysRow: 35, callsRow: 57, bookedTotalRow: 108, callsPerDay: 64 },
          { name: 'Steve W',  daysRow: 36, callsRow: 58, bookedTotalRow: 128, callsPerDay: 80 },
          { name: 'Jack L',   daysRow: 44, callsRow: 66, bookedTotalRow: 163, callsPerDay: 80 },
          { name: 'Ethan K',  daysRow: 51, callsRow: 73, bookedTotalRow: 234, callsPerDay: 80 },
          { name: 'Georgi C', daysRow: 53, callsRow: 75, bookedTotalRow: 198, callsPerDay: 80 },
        ];

        // KPI rates per working day
        const BOOKED_KPI_PER_DAY = 24.5 / 9; // ~2.72 per day (24.5 per 9-day period ≈ month)
        const TP_KPI_PER_DAY = 16.4 / 9;     // ~1.82 per day

        // Clear existing data before import
        salesQueries.clearAllLgKpis();

        for (const person of LG_PEOPLE) {
          // Aggregate weekly values into monthly buckets
          const monthBuckets: Record<string, { days: number; calls: number; booked: number }> = {};

          for (const [colStr, mo] of Object.entries(colMonths)) {
            const col = parseInt(colStr);
            const key = `${mo.year}-${String(mo.month).padStart(2, '0')}`;
            if (!monthBuckets[key]) monthBuckets[key] = { days: 0, calls: 0, booked: 0 };

            const daysVal = parseFloat(String((data[person.daysRow] as unknown[])?.[col] ?? 0)) || 0;
            const callsVal = parseFloat(String((data[person.callsRow] as unknown[])?.[col] ?? 0)) || 0;
            const bookedVal = parseFloat(String((data[person.bookedTotalRow] as unknown[])?.[col] ?? 0)) || 0;

            monthBuckets[key].days += daysVal;
            monthBuckets[key].calls += callsVal;
            monthBuckets[key].booked += bookedVal;
          }

          // Write each month to DB
          for (const [month, bucket] of Object.entries(monthBuckets)) {
            if (bucket.days === 0 && bucket.calls === 0 && bucket.booked === 0) continue;
            salesQueries.setLgKpi(person.name, month, {
              days_worked: Math.round(bucket.days * 10) / 10,
              calls_kpi: Math.round(bucket.days * person.callsPerDay),
              calls_actual: Math.round(bucket.calls),
              booked_kpi: Math.round(bucket.days * BOOKED_KPI_PER_DAY * 10) / 10,
              booked_actual: Math.round(bucket.booked),
              tp_kpi: Math.round(bucket.days * TP_KPI_PER_DAY * 10) / 10,
            });
            stats.lgKpis++;
          }
        }
      }

      // ── Parse "LG Charts" sheet: team-wide monthly totals ──

      const lcSheetName = wb.SheetNames.find((n: string) => n.includes('LG Charts'));
      if (lcSheetName) {
        const lcData = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[lcSheetName], { header: 1, defval: '', range: 0 });

        salesQueries.clearAllLgHistory();

        // Row layout: row 2-6 = Calls YYYY, row 10-13 = Bookings YYYY, row 17-20 = TP YYYY
        // Cols 1-12 = Jan-Dec
        const parseRow = (row: unknown[]): { year: number; values: number[] } | null => {
          const label = String(row[0] || '').trim();
          const yearMatch = label.match(/(\d{4})/);
          if (!yearMatch) return null;
          const year = parseInt(yearMatch[1]);
          const values = [];
          for (let m = 1; m <= 12; m++) {
            values.push(parseFloat(String(row[m] ?? 0)) || 0);
          }
          return { year, values };
        };

        // Gather calls (rows 2-6), bookings (rows 10-13), taken_place (rows 17-20)
        const callsRows: Record<number, number[]> = {};
        const bookingsRows: Record<number, number[]> = {};
        const tpRows: Record<number, number[]> = {};

        for (let i = 2; i <= 6; i++) {
          const row = lcData[i] as unknown[];
          if (!row) continue;
          const parsed = parseRow(row);
          if (parsed) callsRows[parsed.year] = parsed.values;
        }
        for (let i = 10; i <= 13; i++) {
          const row = lcData[i] as unknown[];
          if (!row) continue;
          const parsed = parseRow(row);
          if (parsed) bookingsRows[parsed.year] = parsed.values;
        }
        for (let i = 17; i <= 20; i++) {
          const row = lcData[i] as unknown[];
          if (!row) continue;
          const parsed = parseRow(row);
          if (parsed) tpRows[parsed.year] = parsed.values;
        }

        // Merge into history records
        const allYears = new Set([
          ...Object.keys(callsRows).map(Number),
          ...Object.keys(bookingsRows).map(Number),
          ...Object.keys(tpRows).map(Number),
        ]);

        for (const year of allYears) {
          for (let m = 0; m < 12; m++) {
            const calls = callsRows[year]?.[m] ?? 0;
            const bookings = bookingsRows[year]?.[m] ?? 0;
            const tp = tpRows[year]?.[m] ?? 0;
            if (calls === 0 && bookings === 0 && tp === 0) continue;
            salesQueries.setLgHistory(year, m + 1, { calls, bookings, taken_place: tp });
            stats.lgHistory++;
          }
        }
      }

      res.json({ ok: true, data: stats });
    } catch (err) {
      console.error('[Sales] Data pack import error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Import failed' });
    }
  });

  // ── Reference data (for dropdowns) ────────────────────────────────────

  router.get('/reference', (_req, res) => {
    res.json({
      ok: true,
      data: {
        salespeople: ["Aaron L","Abi B","Annabel G","Ben M","Ben S","Bethany S","Chloe M","Chris S","Eryn A","Ethan K","George V","Georgi C","Hannah M","Harry B","Holly P","Inderpal R","Isabel L","Jack L","Jade J","Jane O","Jerson A","Jon L","Jonathan D","Josh T","Kannan G","Kian K","Kieran E","Kieran H","Lewis T","Lucy R","Malathi P","Matthew D","Milli B","Nathan B","Neil P","Nicki W","Paul A","Riannah V","Richard C","Self Gen","Sharice R","Sharon C","Shivani R","Steve R","Steve W"],
        products: ["Audit","BYM","Data Sales","KYM","LeadPro","LeadPro - Social","Nurtur Bundle","Other","Social Media","Starberry","Starberry-DM","Starberry-DRM","Starberry PPC","Starberry-SEO","Starberry-Web","TPJ","Voice AI","Website SEO","Yomdel"],
        leadSources: ["BYM","Booking Bug","Customer","Direct","Email","Events","Facebook","Google","Leaflet","LinkedIn","N/A","Prospect","Referral","Self Gen","TPJ","Website"],
        stages: ["Demo Completed","Proposal Submitted - Awaiting Feedback","Proposal Submitted - In Discussion","Contract Sent"],
        clientTypes: ["New","Existing"],
      },
    });
  });

  return router;
}
