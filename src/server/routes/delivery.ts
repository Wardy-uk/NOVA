import { Router } from 'express';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const DELIVERY_PATH = process.env.DELIVERY_XLSX_PATH || path.join(
  process.env.HOME || process.env.USERPROFILE || '',
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

import type { DeliveryQueries, MilestoneQueries, TaskQueries } from '../db/queries.js';
import type { SharePointSync } from '../services/sharepoint-sync.js';
import type { AreaAccessGuard } from '../middleware/auth.js';
import { syncMilestoneToTask, syncDeliveryMilestonesToTasks } from './milestones.js';

export function createDeliveryRoutes(deliveryQueries?: DeliveryQueries, spSync?: SharePointSync, milestoneQueries?: MilestoneQueries, taskQueries?: TaskQueries, requireAreaAccess?: AreaAccessGuard): Router {
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
    const writeGuard = requireAreaAccess ? requireAreaAccess('onboarding', 'edit') : (_req: any, _res: any, next: any) => next();

    // My Focus: starred-for-me + entries assigned to me with overdue milestones
    router.get('/entries/my-focus', (req, res) => {
      const userId = req.user?.id as number | undefined;
      const username = req.user?.username as string | undefined;
      if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
      const names: string[] = [];
      if (username) {
        names.push(username);
        const alphaOnly = username.replace(/[^a-z]/gi, '');
        if (alphaOnly.length > 3) names.push(alphaOnly.slice(0, -1));
      }
      const entries = deliveryQueries.getMyFocus(userId, names);

      // Enrich with milestone progress if available
      if (milestoneQueries && entries.length > 0) {
        const ids = entries.map(e => e.id);
        const milestoneSummary = milestoneQueries.getOverdueSummaryByDelivery(ids);
        const nextPending = milestoneQueries.getNextPendingByDelivery(ids);
        const enriched = entries.map(e => ({
          ...e,
          milestone_summary: milestoneSummary.get(e.id) ?? null,
          next_milestone: nextPending.get(e.id) ?? null,
        }));
        res.json({ ok: true, data: enriched });
      } else {
        res.json({ ok: true, data: entries });
      }
    });

    router.get('/entries', (req, res) => {
      const product = req.query.product as string | undefined;
      res.json({ ok: true, data: deliveryQueries.getAll(product) });
    });

    router.post('/entries', writeGuard, (req, res) => {
      const { product, account, status, onboarder, order_date, go_live_date,
        predicted_delivery, training_date, branches, mrr, incremental, licence_fee, sale_type, is_starred, notes } = req.body;
      if (!product || !account) {
        res.status(400).json({ ok: false, error: 'product and account are required' });
        return;
      }
      const star_scope = req.body.star_scope ?? 'all';
      const userId = req.user?.id ?? null;
      // Prevent duplicates — return existing entry if same product+account
      const existing = deliveryQueries.findByProductAccount(product, account);
      if (existing) {
        // If caller wants it starred, star the existing entry
        if (is_starred && !existing.is_starred) {
          deliveryQueries.update(existing.id, { is_starred: 1, star_scope, starred_by: userId });
        }
        res.json({ ok: true, data: deliveryQueries.getById(existing.id) });
        return;
      }
      const id = deliveryQueries.create({
        product, account, status: status ?? '', onboarder, order_date, go_live_date,
        predicted_delivery, training_date: training_date ?? null,
        branches: branches ?? null, mrr: mrr ?? null,
        incremental: incremental ?? null, licence_fee: licence_fee ?? null,
        sale_type: sale_type ?? null,
        is_starred: is_starred ?? 0, star_scope, starred_by: is_starred ? userId : null,
        notes,
      });

      // Auto-create milestones if we have a start date
      // Only create a task for the first milestone (day 0) — the workflow engine handles the rest progressively
      if (milestoneQueries && taskQueries && order_date) {
        try {
          const milestones = milestoneQueries.createForDelivery(id, order_date, sale_type ?? undefined);
          if (milestones.length > 0) {
            const first = milestones[0];
            syncMilestoneToTask(first, account, taskQueries);
            milestoneQueries.markWorkflowTaskCreated(first.id);
          }
        } catch (err) {
          console.error('[Delivery] Milestone auto-creation failed:', err instanceof Error ? err.message : err);
        }
      }

      res.json({ ok: true, data: deliveryQueries.getById(id) });
    });

    // POST /entries/import-xlsx — bulk import all xlsx rows to DB (skips existing, auto-assigns IDs)
    router.post('/entries/import-xlsx', writeGuard, (_req, res) => {
      try {
        if (!fs.existsSync(DELIVERY_PATH)) {
          res.status(404).json({ ok: false, error: 'Delivery spreadsheet not found' });
          return;
        }
        const loaded = loadWorkbook();
        let created = 0;
        let skipped = 0;
        let milestonesCreated = 0;
        let sheetsProcessed = 0;

        for (const sheetName of PRODUCT_SHEETS) {
          const sheet = loaded[sheetName] as SheetResult | undefined;
          if (!sheet || sheet.rows.length === 0) continue;
          sheetsProcessed++;

          for (const row of sheet.rows) {
            if (!row.account) continue;

            // Skip if already in DB
            const existing = deliveryQueries.findByProductAccount(sheetName, row.account);
            if (existing) {
              skipped++;
              continue;
            }

            const id = deliveryQueries.create({
              product: sheetName,
              account: row.account,
              status: row.status || 'Not Started',
              onboarder: row.onboarder || null,
              order_date: row.orderDate || null,
              go_live_date: row.goLiveDate || null,
              predicted_delivery: row.predictedDelivery || null,
              training_date: null,
              branches: row.branches ?? null,
              mrr: row.mrr ?? null,
              incremental: row.incremental ?? null,
              licence_fee: row.licenceFee ?? null,
              sale_type: null,
              is_starred: 0,
              star_scope: 'me',
              starred_by: null,
              notes: row.notes || null,
            });
            created++;

            // Auto-create milestones for imported entries with an order date
            if (milestoneQueries && taskQueries && row.orderDate) {
              try {
                milestoneQueries.createForDelivery(id, row.orderDate);
                syncDeliveryMilestonesToTasks(id, row.account, milestoneQueries, taskQueries);
                milestonesCreated++;
              } catch (err) {
                console.error(`[Delivery] Milestone creation failed for ${row.account}:`, err instanceof Error ? err.message : err);
              }
            }
          }
        }

        res.json({
          ok: true,
          data: { created, skipped, milestonesCreated, sheetsProcessed },
        });
      } catch (err) {
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Import failed',
        });
      }
    });

    // POST /entries/backfill-milestones — create milestones for all entries that don't have any
    router.post('/entries/backfill-milestones', writeGuard, (_req, res) => {
      if (!milestoneQueries || !taskQueries) {
        res.status(500).json({ ok: false, error: 'Milestone system not available' });
        return;
      }
      try {
        const allEntries = deliveryQueries.getAll();
        let created = 0;
        let skipped = 0;
        for (const entry of allEntries) {
          const existing = milestoneQueries.getByDelivery(entry.id);
          if (existing.length > 0) { skipped++; continue; }
          const startDate = entry.order_date || entry.go_live_date || new Date().toISOString().split('T')[0];
          milestoneQueries.createForDelivery(entry.id, startDate);
          syncDeliveryMilestonesToTasks(entry.id, entry.account, milestoneQueries, taskQueries);
          created++;
        }
        res.json({ ok: true, data: { created, skipped } });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Backfill failed' });
      }
    });

    // DELETE /entries/duplicates — one-time cleanup
    router.delete('/entries/duplicates', writeGuard, (_req, res) => {
      const removed = deliveryQueries.deleteDuplicates();
      res.json({ ok: true, data: { removed } });
    });

    // POST /entries/backfill-ids — assign onboarding IDs to entries that don't have one
    router.post('/entries/backfill-ids', writeGuard, (_req, res) => {
      const count = deliveryQueries.backfillOnboardingIds();
      res.json({ ok: true, data: { backfilled: count } });
    });

    router.patch('/entries/:id/star', (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      const toggled = deliveryQueries.toggleStar(id, req.user?.id);
      if (!toggled) { res.status(404).json({ ok: false, error: 'Entry not found' }); return; }
      res.json({ ok: true, data: deliveryQueries.getById(id) });
    });

    router.put('/entries/:id', writeGuard, (req, res) => {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      const updated = deliveryQueries.update(id, req.body);
      if (!updated) { res.status(404).json({ ok: false, error: 'Entry not found' }); return; }
      res.json({ ok: true, data: deliveryQueries.getById(id) });
    });

    router.delete('/entries/:id', writeGuard, (req, res) => {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      const deleted = deliveryQueries.delete(id);
      if (!deleted) { res.status(404).json({ ok: false, error: 'Entry not found' }); return; }
      res.json({ ok: true });
    });
  }

  // SharePoint sync (manual-only)
  if (spSync) {
    const syncWriteGuard = requireAreaAccess ? requireAreaAccess('onboarding', 'edit') : (_req: any, _res: any, next: any) => next();

    router.get('/sync/status', (_req, res) => {
      res.json({
        ok: true,
        data: {
          available: spSync.isAvailable(),
          tools: spSync.getAvailableTools(),
        },
      });
    });

    router.get('/sync/debug', (_req, res) => {
      res.json({ ok: true, data: spSync.getDebugInfo() });
    });

    router.post('/sync/pull', syncWriteGuard, async (_req, res) => {
      try {
        const result = await spSync.pull();
        res.json({ ok: result.errors.length === 0, data: result });
      } catch (err) {
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : 'SharePoint pull failed',
        });
      }
    });

    router.post('/sync/push', syncWriteGuard, async (_req, res) => {
      try {
        const result = await spSync.push();
        res.json({ ok: result.errors.length === 0, data: result });
      } catch (err) {
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : 'SharePoint push failed',
        });
      }
    });
  }

  return router;
}
