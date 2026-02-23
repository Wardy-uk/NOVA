import { Router } from 'express';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const DELIVERY_PATH = path.join(
  process.env.USERPROFILE ?? 'C:/Users/NickW',
  'Downloads',
  'Delivery sheet Master.xlsx'
);

// Product sheets to display (in order)
const PRODUCT_SHEETS = [
  'BYM', 'KYM', 'Yomdel', 'Leadpro', 'TPJ', 'Voice AI',
  'GRS', 'Undeliverable',
  'SB - Web', 'SB - DM', 'Google Ad Spend', 'Google SEO',
  'Guild Package',
];

interface DeliveryRow {
  orderDate: string | null;
  goLiveDate: string | null;
  onboarder: string | null;
  account: string;
  predictedDelivery: string | null;
  status: string;
  branches: number | null;
  mrr: number | null;
  incremental: number | null;
  licenceFee: number | null;
  notes: string | null;
  daysToDeliver: number | null;
}

interface SheetResult {
  rows: DeliveryRow[];
  totals: { count: number; mrr: number; wip: number; complete: number; dead: number };
}

// Cache parsed data, keyed by file mtime
let cache: { mtime: number; sheets: Record<string, SheetResult>; lastModified: string } | null = null;

function excelDateToStr(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    if (val.match(/^\d{1,2}\/\d{1,2}/)) return val;
    if (val === 'DEAD' || val === 'TBC') return val;
    return val;
  }
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
    } catch {
      return String(val);
    }
  }
  return null;
}

function str(val: unknown): string {
  return String(val ?? '').trim();
}

function parseSheet(ws: XLSX.WorkSheet): { headers: string[]; rows: DeliveryRow[] } {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

  // Find the header row (contains "Account" or "Customer" or "Onboarder")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    const row = raw[i];
    if (!row) continue;
    const joined = row.map((c) => str(c).toLowerCase()).join('|');
    if (joined.includes('account') || joined.includes('customer') || joined.includes('onboarder')) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) return { headers: [], rows: [] };

  // Build dense header array (sparse slots become '')
  const rawHeader = raw[headerIdx];
  const headerRow: string[] = Array.from({ length: rawHeader.length }, (_, i) => str(rawHeader[i]));

  // Map column indices by fuzzy name matching
  const findCol = (...names: string[]) => {
    const lower = names.map((n) => n.toLowerCase());
    return headerRow.findIndex((h) =>
      lower.some((n) => h.toLowerCase().includes(n))
    );
  };

  const colOrder = findCol('order received', 'order date');
  const colGoLive = findCol('mrr go live', 'go live');
  const colOnboarder = findCol('onboarder', 'pm');
  const colAccount = findCol('account', 'customer');
  const colPredicted = findCol('predicted delivery', 'predicted');
  const colStatus = Math.max(
    headerRow.findIndex((h, i) => h.toLowerCase() === 'status' && i < 8),
    findCol('status')
  );
  const colBranches = findCol('branch no', 'branches');
  const colMrr = findCol('mrr');
  const colIncr = findCol('incr', 'adhoc', 'set up fee');
  const colLicence = findCol('licence fee', 'monthly licence');
  const colNotes = headerRow.lastIndexOf('Status') > colStatus
    ? headerRow.lastIndexOf('Status')
    : findCol('notes', 'status detail');
  const colDays = findCol('days to deliver');

  const rows: DeliveryRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.length === 0) continue;

    const account = colAccount >= 0 ? str(r[colAccount]) : '';
    if (!account || account.toLowerCase() === 'totals') continue;

    const status = colStatus >= 0 ? str(r[colStatus]) : '';
    rows.push({
      orderDate: colOrder >= 0 ? excelDateToStr(r[colOrder]) : null,
      goLiveDate: colGoLive >= 0 ? excelDateToStr(r[colGoLive]) : null,
      onboarder: colOnboarder >= 0 ? str(r[colOnboarder]) || null : null,
      account,
      predictedDelivery: colPredicted >= 0 ? excelDateToStr(r[colPredicted]) : null,
      status,
      branches: colBranches >= 0 && r[colBranches] != null ? Number(r[colBranches]) || null : null,
      mrr: colMrr >= 0 && r[colMrr] != null ? Number(r[colMrr]) || null : null,
      incremental: colIncr >= 0 && r[colIncr] != null ? Number(r[colIncr]) || null : null,
      licenceFee: colLicence >= 0 && r[colLicence] != null ? Number(r[colLicence]) || null : null,
      notes: colNotes >= 0 ? str(r[colNotes]) || null : null,
      daysToDeliver: colDays >= 0 && r[colDays] != null ? Number(r[colDays]) || null : null,
    });
  }

  return { headers: headerRow, rows };
}

function loadWorkbook(): Record<string, SheetResult> & { _lastModified: string } {
  const stat = fs.statSync(DELIVERY_PATH);
  const mtime = stat.mtime.getTime();

  if (cache && cache.mtime === mtime) {
    return Object.assign({}, cache.sheets, { _lastModified: cache.lastModified });
  }

  console.log('[Delivery] Reading workbook...');
  const buf = fs.readFileSync(DELIVERY_PATH);
  const wb = XLSX.read(buf);
  console.log('[Delivery] Parsed', wb.SheetNames.length, 'sheets');

  const sheets: Record<string, SheetResult> = {};
  for (const name of PRODUCT_SHEETS) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const { rows } = parseSheet(ws);
    if (rows.length === 0) continue;

    const totalMrr = rows.reduce((s, r) => s + (r.mrr ?? 0), 0);
    const sl = (s: string) => (s || '').toLowerCase();
    const complete = rows.filter((r) => sl(r.status) === 'complete').length;
    const dead = rows.filter((r) => sl(r.status) === 'dead').length;
    const wip = rows.filter((r) => !['complete', 'dead', 'back to sales'].includes(sl(r.status))).length;

    sheets[name] = {
      rows,
      totals: { count: rows.length, mrr: Math.round(totalMrr * 100) / 100, wip, complete, dead },
    };
  }

  const lastModified = stat.mtime.toISOString();
  cache = { mtime, sheets, lastModified };
  console.log('[Delivery] Cached', Object.keys(sheets).length, 'product sheets');
  return Object.assign({}, sheets, { _lastModified: lastModified });
}

import type { DeliveryQueries } from '../db/queries.js';

export function createDeliveryRoutes(deliveryQueries?: DeliveryQueries): Router {
  const router = Router();

  // Pre-load on startup (non-blocking to avoid slowing boot)
  setTimeout(() => {
    try {
      if (fs.existsSync(DELIVERY_PATH)) loadWorkbook();
    } catch (err) {
      console.error('[Delivery] Preload failed:', err instanceof Error ? err.message : err);
    }
  }, 3000);

  router.get('/', (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 0;
    if (!fs.existsSync(DELIVERY_PATH)) {
      res.status(404).json({ ok: false, error: `Delivery sheet not found at ${DELIVERY_PATH}` });
      return;
    }

    try {
      const loaded = loadWorkbook();
      const lastModified = loaded._lastModified;
      const sheets: Record<string, SheetResult> = {};

      for (const [name, sheet] of Object.entries(loaded)) {
        if (name === '_lastModified') continue;
        const s = sheet as SheetResult;
        // Totals always reflect ALL rows; limit only trims what's sent
        const displayRows = limit > 0 ? s.rows.slice(-limit) : s.rows;
        sheets[name] = { rows: displayRows, totals: s.totals };
      }

      // Overall summary (use full totals from cache, not limited rows)
      const allSheets = Object.values(sheets);
      const summary = {
        totalCustomers: allSheets.reduce((s, sh) => s + sh.totals.count, 0),
        totalMrr: Math.round(allSheets.reduce((s, sh) => s + sh.totals.mrr, 0) * 100) / 100,
        totalWip: allSheets.reduce((s, sh) => s + sh.totals.wip, 0),
        totalComplete: allSheets.reduce((s, sh) => s + sh.totals.complete, 0),
        totalDead: allSheets.reduce((s, sh) => s + sh.totals.dead, 0),
        products: Object.keys(sheets),
        lastModified,
      };

      res.json({ ok: true, data: { summary, sheets } });
    } catch (err) {
      console.error('[Delivery] Error:', err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to read delivery sheet',
      });
    }
  });

  // ---- DB-backed entries (CRUD) ----
  if (deliveryQueries) {
    router.get('/entries', (req, res) => {
      const product = req.query.product as string | undefined;
      res.json({ ok: true, data: deliveryQueries.getAll(product) });
    });

    router.post('/entries', (req, res) => {
      const { product, account, status, onboarder, order_date, go_live_date,
        predicted_delivery, training_date, branches, mrr, incremental, licence_fee, notes } = req.body;
      if (!product || !account) {
        res.status(400).json({ ok: false, error: 'product and account are required' });
        return;
      }
      const id = deliveryQueries.create({
        product, account, status: status ?? '', onboarder, order_date, go_live_date,
        predicted_delivery, training_date: training_date ?? null,
        branches: branches ?? null, mrr: mrr ?? null,
        incremental: incremental ?? null, licence_fee: licence_fee ?? null,
        is_starred: 0, notes,
      });
      res.json({ ok: true, data: deliveryQueries.getById(id) });
    });

    router.patch('/entries/:id/star', (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      const toggled = deliveryQueries.toggleStar(id);
      if (!toggled) { res.status(404).json({ ok: false, error: 'Entry not found' }); return; }
      res.json({ ok: true, data: deliveryQueries.getById(id) });
    });

    router.put('/entries/:id', (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      const updated = deliveryQueries.update(id, req.body);
      if (!updated) { res.status(404).json({ ok: false, error: 'Entry not found' }); return; }
      res.json({ ok: true, data: deliveryQueries.getById(id) });
    });

    router.delete('/entries/:id', (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      const deleted = deliveryQueries.delete(id);
      if (!deleted) { res.status(404).json({ ok: false, error: 'Entry not found' }); return; }
      res.json({ ok: true });
    });
  }

  return router;
}
