import { Router } from 'express';
import { z } from 'zod';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import type { OnboardingConfigQueries } from '../db/queries.js';
import type { AreaAccessGuard } from '../middleware/auth.js';

const XLSX_PATH = path.resolve('OnboardingMatix.xlsx');

export function createOnboardingConfigRoutes(
  configQueries: OnboardingConfigQueries,
  requireAreaAccess?: AreaAccessGuard,
): Router {
  const router = Router();
  const writeGuard = requireAreaAccess ? requireAreaAccess('onboarding', 'edit') : (_req: any, _res: any, next: any) => next();

  // ── Ticket Groups ──

  router.get('/ticket-groups', (_req, res) => {
    res.json({ ok: true, data: configQueries.getAllTicketGroups() });
  });

  router.post('/ticket-groups', writeGuard, (req, res) => {
    const parsed = z.object({ name: z.string().min(1), sort_order: z.number().optional() }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    try {
      const id = configQueries.createTicketGroup(parsed.data.name, parsed.data.sort_order);
      res.json({ ok: true, data: { id } });
    } catch (err) {
      res.status(409).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create ticket group' });
    }
  });

  router.put('/ticket-groups/:id', writeGuard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = z.object({
      name: z.string().min(1).optional(),
      sort_order: z.number().optional(),
      active: z.number().min(0).max(1).optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    configQueries.updateTicketGroup(id, parsed.data);
    res.json({ ok: true });
  });

  router.delete('/ticket-groups/:id', writeGuard, (req, res) => {
    configQueries.deleteTicketGroup(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ── Sale Types ──

  router.get('/sale-types', (_req, res) => {
    res.json({ ok: true, data: configQueries.getAllSaleTypes() });
  });

  router.post('/sale-types', writeGuard, (req, res) => {
    const parsed = z.object({ name: z.string().min(1), sort_order: z.number().optional() }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    try {
      const id = configQueries.createSaleType(parsed.data.name, parsed.data.sort_order);
      res.json({ ok: true, data: { id } });
    } catch (err) {
      res.status(409).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create sale type' });
    }
  });

  router.put('/sale-types/:id', writeGuard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = z.object({
      name: z.string().min(1).optional(),
      sort_order: z.number().optional(),
      active: z.number().min(0).max(1).optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    configQueries.updateSaleType(id, parsed.data);
    res.json({ ok: true });
  });

  router.delete('/sale-types/:id', writeGuard, (req, res) => {
    configQueries.deleteSaleType(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ── Capabilities ──

  router.get('/capabilities', (_req, res) => {
    res.json({ ok: true, data: configQueries.getAllCapabilities() });
  });

  router.post('/capabilities', writeGuard, (req, res) => {
    const parsed = z.object({
      name: z.string().min(1),
      code: z.string().optional(),
      sort_order: z.number().optional(),
      ticket_group_id: z.number().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    try {
      const id = configQueries.createCapability(parsed.data.name, parsed.data.code, parsed.data.sort_order, parsed.data.ticket_group_id);
      res.json({ ok: true, data: { id } });
    } catch (err) {
      res.status(409).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create capability' });
    }
  });

  router.put('/capabilities/:id', writeGuard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = z.object({
      name: z.string().min(1).optional(),
      code: z.string().optional(),
      sort_order: z.number().optional(),
      active: z.number().min(0).max(1).optional(),
      ticket_group_id: z.number().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    configQueries.updateCapability(id, parsed.data);
    res.json({ ok: true });
  });

  router.delete('/capabilities/:id', writeGuard, (req, res) => {
    configQueries.deleteCapability(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ── Items ──

  router.get('/capabilities/:id/items', (req, res) => {
    const capId = parseInt(req.params.id, 10);
    res.json({ ok: true, data: configQueries.getItemsForCapability(capId) });
  });

  router.post('/capabilities/:id/items', writeGuard, (req, res) => {
    const capId = parseInt(req.params.id, 10);
    const parsed = z.object({
      name: z.string().min(1),
      is_bolt_on: z.boolean().optional(),
      sort_order: z.number().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    const id = configQueries.createItem(capId, parsed.data.name, parsed.data.is_bolt_on, parsed.data.sort_order);
    res.json({ ok: true, data: { id } });
  });

  router.put('/items/:id', writeGuard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = z.object({
      name: z.string().min(1).optional(),
      is_bolt_on: z.number().min(0).max(1).optional(),
      sort_order: z.number().optional(),
      active: z.number().min(0).max(1).optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    configQueries.updateItem(id, parsed.data);
    res.json({ ok: true });
  });

  router.delete('/items/:id', writeGuard, (req, res) => {
    configQueries.deleteItem(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ── Matrix ──

  router.get('/matrix', (_req, res) => {
    res.json({ ok: true, data: configQueries.getFullMatrix() });
  });

  router.put('/matrix', writeGuard, (req, res) => {
    const parsed = z.object({
      updates: z.array(z.object({
        sale_type_id: z.number(),
        capability_id: z.number(),
        enabled: z.boolean(),
        notes: z.string().nullable().optional(),
      })),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    configQueries.batchUpdateMatrix(parsed.data.updates);
    res.json({ ok: true });
  });

  // ── Import from xlsx ──

  router.post('/import-xlsx', writeGuard, (_req, res) => {
    if (!fs.existsSync(XLSX_PATH)) {
      res.status(404).json({ ok: false, error: `File not found: ${XLSX_PATH}` });
      return;
    }

    try {
      const wb = XLSX.readFile(XLSX_PATH);
      const stats = importFromWorkbook(wb, configQueries);
      res.json({ ok: true, data: stats });
    } catch (err) {
      console.error('[Onboarding] Import failed:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Import failed' });
    }
  });

  return router;
}

// ── xlsx import logic ──

interface ImportStats {
  ticketGroups: number;
  saleTypes: number;
  capabilities: number;
  matrixCells: number;
  items: number;
  skippedRows: string[];
}

// Sheet 2 "Ticket Configuration" column headers → Sheet 1 capability names
const SHEET2_TO_CAP: Record<string, string> = {
  'BreifYourMarket': 'BYM',
  'BriefYourMarket': 'BYM',
  'Datawarehouse (inc replicator etc)': 'Data Warehouse / Contact Feed',
  'Datawarehouse': 'Data Warehouse / Contact Feed',
  'Build': 'Build',
  'Leadpro': 'Leadpro Dashboard',
  'Members Hub': 'Members Hub (Not active)',
  'Referrals': '',  // no direct match — skip
  'EcoSystem': 'EcoSystem Log in',
};

export function importFromWorkbook(wb: XLSX.WorkBook, queries: OnboardingConfigQueries): ImportStats {
  queries.clearAll();

  const stats: ImportStats = { ticketGroups: 0, saleTypes: 0, capabilities: 0, matrixCells: 0, items: 0, skippedRows: [] };
  const saleTypeMap = new Map<string, number>();
  const capabilityMap = new Map<string, number>();
  const ticketGroupMap = new Map<string, number>();

  // ── Sheet 1: "Matrix per Sale" ──
  // New structure:
  //   Row 0: "Parent Product" label at col C/D+, skip
  //   Row 1: Ticket type group headers (merged cells, fill-forward)
  //   Row 2: Individual capability names
  //   Row 3+: Sale types in col B, "Jira Tickets Required" in col C, X marks in col D+
  const matrixSheet = wb.Sheets['Matrix per Sale'];
  if (matrixSheet) {
    const raw: unknown[][] = XLSX.utils.sheet_to_json(matrixSheet, { header: 1 });
    if (raw.length < 4) return stats;

    const row1 = raw[1] as (string | undefined)[];  // ticket group headers
    const row2 = raw[2] as (string | undefined)[];  // capability names

    // Determine the first data column (where capabilities start)
    // Cols: A=index 0 (label?), B=index 1 (sale type), C=index 2 (jira flag?), D+=index 3+ (capabilities)
    // Find the first column with a capability name in row 2
    let dataStartCol = 3; // default: col D
    for (let col = 1; col < (row2?.length ?? 0); col++) {
      const val = String(row2?.[col] ?? '').trim();
      if (val && col >= 3) { dataStartCol = col; break; }
    }

    // Build ticket groups from row 1 (fill-forward for merged cells)
    let currentGroupName = '';
    const colToGroup: string[] = [];
    for (let col = 0; col < Math.max(row1?.length ?? 0, row2?.length ?? 0, 40); col++) {
      const h = String(row1?.[col] ?? '').trim();
      if (h && h !== 'Parent Product' && col >= dataStartCol) currentGroupName = h;
      colToGroup[col] = col >= dataStartCol ? currentGroupName : '';
    }

    // Create ticket groups
    const seenGroups = new Set<string>();
    let groupSortOrder = 0;
    for (let col = dataStartCol; col < colToGroup.length; col++) {
      const gName = colToGroup[col];
      if (!gName || seenGroups.has(gName)) continue;
      seenGroups.add(gName);
      const gId = queries.createTicketGroup(gName, groupSortOrder++);
      ticketGroupMap.set(gName, gId);
      stats.ticketGroups++;
    }

    // Create capabilities from row 2, linked to their ticket group
    for (let col = dataStartCol; col < (row2?.length ?? 0); col++) {
      const name = String(row2?.[col] ?? '').trim();
      if (!name) continue;
      if (!capabilityMap.has(name)) {
        const groupName = colToGroup[col];
        const groupId = groupName ? ticketGroupMap.get(groupName) : undefined;
        const id = queries.createCapability(name, undefined, col - dataStartCol, groupId);
        capabilityMap.set(name, id);
        stats.capabilities++;
      }
    }

    // Process sale type rows (row 3+)
    for (let row = 3; row < raw.length; row++) {
      const cells = raw[row] as (string | number | undefined)[];
      // Sale type name in col B (index 1)
      const saleTypeName = String(cells[1] ?? '').trim();
      if (!saleTypeName) continue;

      // Jira tickets required flag in col C (index 2): "y" / "Y" → 1
      const jiraFlag = String(cells[2] ?? '').trim().toLowerCase();
      const jiraTicketsRequired = (jiraFlag === 'y' || jiraFlag === 'yes') ? 1 : 0;

      // Count X marks for this row
      let xCount = 0;
      for (let col = dataStartCol; col < (row2?.length ?? 0); col++) {
        const val = String(cells[col] ?? '').trim().toLowerCase();
        if (val === 'x' || val === 'own' || val === 'majority' || val.startsWith('x ') || val === 'nnnn') {
          xCount++;
        }
      }

      if (xCount === 0) {
        stats.skippedRows.push(saleTypeName);
        continue;
      }

      if (!saleTypeMap.has(saleTypeName)) {
        const id = queries.createSaleType(saleTypeName, row, jiraTicketsRequired);
        saleTypeMap.set(saleTypeName, id);
        stats.saleTypes++;
      }
      const saleTypeId = saleTypeMap.get(saleTypeName)!;

      // Map X marks to matrix cells
      for (let col = dataStartCol; col < (row2?.length ?? 0); col++) {
        const capName = String(row2?.[col] ?? '').trim();
        if (!capName || !capabilityMap.has(capName)) continue;

        const cellVal = String(cells[col] ?? '').trim().toLowerCase();
        if (!cellVal) continue;

        const isEnabled = cellVal === 'x' || cellVal === 'own' || cellVal === 'majority' ||
                         cellVal.startsWith('x ') || cellVal === 'nnnn';
        const notes = (cellVal !== 'x' && cellVal !== '') ? String(cells[col] ?? '').trim() : null;

        if (isEnabled || notes) {
          queries.setMatrixCell(saleTypeId, capabilityMap.get(capName)!, isEnabled, notes !== 'x' ? notes : null);
          stats.matrixCells++;
        }
      }
    }
  }

  // ── Sheet 2: "Ticket Configuration" ──
  // Structure:
  //   Row 0 (or 1): Column headers mapping to capability names via SHEET2_TO_CAP
  //   Rows 1-17: Standard checklist items (vertical lists per column)
  //   Bolt-on divider row: contains "Bolt On" label or repeated column headers
  //   Rows after divider: Bolt-on items
  const itemsSheet = wb.Sheets['Ticket Configuration'] || wb.Sheets['Items per Product'];
  if (itemsSheet) {
    const raw: unknown[][] = XLSX.utils.sheet_to_json(itemsSheet, { header: 1 });
    if (raw.length < 3) return stats;

    // Row 0 may be a title row (e.g. "BriefYourMarket Standard Delivery") — detect & skip
    // The real header row has multiple non-empty cells matching SHEET2_TO_CAP keys
    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(3, raw.length); r++) {
      const row = raw[r] as (string | undefined)[];
      const nonEmpty = row?.filter(c => String(c ?? '').trim()).length ?? 0;
      if (nonEmpty >= 3) { headerRowIdx = r; break; }
    }
    const headerRow = raw[headerRowIdx] as (string | undefined)[];

    // Helper: resolve a capability ID from Sheet 2 header name
    function getCapIdFromSheet2Name(sheet2Name: string): number | null {
      if (!sheet2Name) return null;
      // Try direct mapping first
      const mappedName = SHEET2_TO_CAP[sheet2Name];
      if (mappedName === '') return null; // explicitly unmapped (e.g. Referrals)
      const targetName = mappedName || sheet2Name;
      if (capabilityMap.has(targetName)) return capabilityMap.get(targetName)!;
      // Try fuzzy match — sheet2 name as substring of capability name
      for (const [capName, capId] of capabilityMap.entries()) {
        if (capName.toLowerCase().includes(sheet2Name.toLowerCase()) ||
            sheet2Name.toLowerCase().includes(capName.toLowerCase())) {
          return capId;
        }
      }
      return null;
    }

    // Find the bolt-on divider row
    const itemsStartRow = headerRowIdx + 1;
    let boltOnStartRow = raw.length; // default: no bolt-ons
    for (let row = itemsStartRow; row < raw.length; row++) {
      const cells = raw[row] as (string | undefined)[];
      for (let col = 0; col < (cells?.length ?? 0); col++) {
        const label = String(cells?.[col] ?? '').trim().toLowerCase();
        if (label.includes('bolt on') || label.includes('bolt-on')) {
          boltOnStartRow = row;
          break;
        }
      }
      if (boltOnStartRow < raw.length) break;
      // Also check for repeated headers (bolt-on section starts with repeated column names)
      let repeatHeaders = 0;
      for (let col = 0; col < (cells?.length ?? 0); col++) {
        const val = String(cells?.[col] ?? '').trim();
        const colHeader = String(headerRow?.[col] ?? '').trim();
        if (val && colHeader && val === colHeader) repeatHeaders++;
      }
      if (repeatHeaders >= 2) {
        boltOnStartRow = row;
        break;
      }
    }

    const skipPatterns = [/^bolt.?on/i, /^\(no admin/i, /^\*link only/i, /^note:/i];
    const shouldSkip = (v: string) => skipPatterns.some(p => p.test(v));

    // Process each column
    for (let col = 0; col < (headerRow?.length ?? 0); col++) {
      const sheet2Name = String(headerRow?.[col] ?? '').trim();
      if (!sheet2Name) continue;

      const capId = getCapIdFromSheet2Name(sheet2Name);
      if (capId === null) continue;

      let sortOrder = 0;

      // Standard items (rows after header to boltOnStartRow-1)
      for (let row = itemsStartRow; row < boltOnStartRow; row++) {
        const cells = raw[row] as (string | undefined)[];
        const val = String(cells?.[col] ?? '').trim();
        if (!val || val === sheet2Name || shouldSkip(val)) continue;
        queries.createItem(capId, val, false, sortOrder++);
        stats.items++;
      }

      // Bolt-on items (rows after boltOnStartRow, skip the divider row itself)
      for (let row = boltOnStartRow + 1; row < raw.length; row++) {
        const cells = raw[row] as (string | undefined)[];
        const val = String(cells?.[col] ?? '').trim();
        if (!val || val === sheet2Name || shouldSkip(val)) continue;
        queries.createItem(capId, val, true, sortOrder++);
        stats.items++;
      }
    }
  }

  return stats;
}
