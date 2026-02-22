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

function excelDateToStr(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    // Already a date string
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

function parseSheet(ws: XLSX.WorkSheet): { headers: string[]; rows: DeliveryRow[] } {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

  // Find the header row (contains "Account" or "Customer" or "Onboarder")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    const row = raw[i];
    if (!row) continue;
    const joined = row.map((c) => String(c ?? '').toLowerCase()).join('|');
    if (joined.includes('account') || joined.includes('customer') || joined.includes('onboarder')) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) return { headers: [], rows: [] };

  const headerRow = raw[headerIdx].map((c) => String(c ?? '').trim());

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

    const account = colAccount >= 0 ? String(r[colAccount] ?? '').trim() : '';
    if (!account || account.toLowerCase() === 'totals') continue;

    rows.push({
      orderDate: colOrder >= 0 ? excelDateToStr(r[colOrder]) : null,
      goLiveDate: colGoLive >= 0 ? excelDateToStr(r[colGoLive]) : null,
      onboarder: colOnboarder >= 0 ? String(r[colOnboarder] ?? '').trim() || null : null,
      account,
      predictedDelivery: colPredicted >= 0 ? excelDateToStr(r[colPredicted]) : null,
      status: colStatus >= 0 ? String(r[colStatus] ?? '').trim() : '',
      branches: colBranches >= 0 && r[colBranches] != null ? Number(r[colBranches]) || null : null,
      mrr: colMrr >= 0 && r[colMrr] != null ? Number(r[colMrr]) || null : null,
      incremental: colIncr >= 0 && r[colIncr] != null ? Number(r[colIncr]) || null : null,
      licenceFee: colLicence >= 0 && r[colLicence] != null ? Number(r[colLicence]) || null : null,
      notes: colNotes >= 0 ? String(r[colNotes] ?? '').trim() || null : null,
      daysToDeliver: colDays >= 0 && r[colDays] != null ? Number(r[colDays]) || null : null,
    });
  }

  return { headers: headerRow, rows };
}

export function createDeliveryRoutes(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    if (!fs.existsSync(DELIVERY_PATH)) {
      res.status(404).json({ ok: false, error: `Delivery sheet not found at ${DELIVERY_PATH}` });
      return;
    }

    try {
      const wb = XLSX.readFile(DELIVERY_PATH);
      const sheets: Record<string, { rows: DeliveryRow[]; totals: { count: number; mrr: number; wip: number; complete: number } }> = {};

      for (const name of PRODUCT_SHEETS) {
        const ws = wb.Sheets[name];
        if (!ws) continue;
        const { rows } = parseSheet(ws);
        if (rows.length === 0) continue;

        const totalMrr = rows.reduce((s, r) => s + (r.mrr ?? 0), 0);
        const complete = rows.filter((r) => r.status.toLowerCase() === 'complete').length;
        const wip = rows.filter((r) => !['complete', 'dead', 'back to sales'].includes(r.status.toLowerCase())).length;

        sheets[name] = {
          rows,
          totals: { count: rows.length, mrr: Math.round(totalMrr * 100) / 100, wip, complete },
        };
      }

      // Overall summary
      const allRows = Object.values(sheets).flatMap((s) => s.rows);
      const summary = {
        totalCustomers: allRows.length,
        totalMrr: Math.round(allRows.reduce((s, r) => s + (r.mrr ?? 0), 0) * 100) / 100,
        totalWip: allRows.filter((r) => !['complete', 'dead', 'back to sales'].includes(r.status.toLowerCase())).length,
        totalComplete: allRows.filter((r) => r.status.toLowerCase() === 'complete').length,
        totalDead: allRows.filter((r) => r.status.toLowerCase() === 'dead').length,
        products: Object.keys(sheets),
        lastModified: fs.statSync(DELIVERY_PATH).mtime.toISOString(),
      };

      res.json({ ok: true, data: { summary, sheets } });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to read delivery sheet',
      });
    }
  });

  return router;
}
