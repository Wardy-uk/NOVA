/**
 * Direct import of OnboardingMatrix.xlsx into the SQLite database.
 * Bypasses the HTTP API to avoid auth complexity.
 * Run: node scripts/import-onboarding.mjs
 */
import initSqlJs from 'sql.js';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../daypilot.db');
const XLSX_PATH = path.resolve(__dirname, '../OnboardingMatix.xlsx');

// Mapping from "Items per Product" group names → Sheet 1 capability names
const GROUP_TO_CAP = {
  'Hub': 'Members Hub (Not active)',
  'Lead Pro': 'Leadpro Dashboard',
  'Template sites': 'Build',
  'BYM': 'BYM',
  'Yomdel': 'Yomdel',
};

// Standard Delivery sub-column headers → Sheet 1 capability names
const STD_DELIVERY_TO_CAP = {
  'BYM': 'BYM',
  'Datawarehouse (inc replicator etc)': 'Data Warehouse / Contact Feed',
  'Build': 'Build',
  'Leadpro': 'Leadpro Dashboard',
  'Members Hub': 'Members Hub (Not active)',
  'Referrals': '',  // no direct match
  'EcoSystem': 'EcoSystem Log in',
};

async function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`File not found: ${XLSX_PATH}`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  // Create tables if they don't exist
  db.run(`CREATE TABLE IF NOT EXISTS onboarding_sale_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS onboarding_capabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    code TEXT,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS onboarding_matrix (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_type_id INTEGER NOT NULL REFERENCES onboarding_sale_types(id) ON DELETE CASCADE,
    capability_id INTEGER NOT NULL REFERENCES onboarding_capabilities(id) ON DELETE CASCADE,
    enabled INTEGER DEFAULT 1,
    notes TEXT,
    UNIQUE(sale_type_id, capability_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS onboarding_capability_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capability_id INTEGER NOT NULL REFERENCES onboarding_capabilities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_bolt_on INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS onboarding_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    onboarding_ref TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    parent_key TEXT, child_keys TEXT,
    created_count INTEGER DEFAULT 0, linked_count INTEGER DEFAULT 0,
    error_message TEXT, payload TEXT,
    dry_run INTEGER DEFAULT 0, user_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_matrix_sale ON onboarding_matrix(sale_type_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_matrix_cap ON onboarding_matrix(capability_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_items_cap ON onboarding_capability_items(capability_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_runs_ref ON onboarding_runs(onboarding_ref)`);
  console.log('Tables ensured.');

  // Clear existing data
  console.log('Clearing existing onboarding data...');
  db.run(`DELETE FROM onboarding_capability_items`);
  db.run(`DELETE FROM onboarding_matrix`);
  db.run(`DELETE FROM onboarding_capabilities`);
  db.run(`DELETE FROM onboarding_sale_types`);

  const wb = XLSX.readFile(XLSX_PATH);
  const stats = { saleTypes: 0, capabilities: 0, matrixCells: 0, items: 0, skippedRows: [] };
  const saleTypeMap = new Map();
  const capabilityMap = new Map();

  function createCapability(name, sortOrder) {
    db.run(`INSERT INTO onboarding_capabilities (name, sort_order) VALUES (?, ?)`, [name, sortOrder ?? 0]);
    const id = db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
    capabilityMap.set(name, id);
    stats.capabilities++;
    return id;
  }

  function createSaleType(name, sortOrder) {
    db.run(`INSERT INTO onboarding_sale_types (name, sort_order) VALUES (?, ?)`, [name, sortOrder ?? 0]);
    const id = db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
    saleTypeMap.set(name, id);
    stats.saleTypes++;
    return id;
  }

  function setMatrixCell(stId, capId, enabled, notes) {
    db.run(
      `INSERT INTO onboarding_matrix (sale_type_id, capability_id, enabled, notes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(sale_type_id, capability_id) DO UPDATE SET enabled = excluded.enabled, notes = COALESCE(excluded.notes, notes)`,
      [stId, capId, enabled ? 1 : 0, notes ?? null]
    );
    stats.matrixCells++;
  }

  function createItem(capId, name, isBoltOn, sortOrder) {
    db.run(
      `INSERT INTO onboarding_capability_items (capability_id, name, is_bolt_on, sort_order) VALUES (?, ?, ?, ?)`,
      [capId, name, isBoltOn ? 1 : 0, sortOrder ?? 0]
    );
    stats.items++;
  }

  // ── Sheet 1: "Matrix per Sale" ──
  console.log('\n=== Sheet 1: Matrix per Sale ===');
  const matrixSheet = wb.Sheets['Matrix per Sale'];
  if (matrixSheet) {
    const raw = XLSX.utils.sheet_to_json(matrixSheet, { header: 1 });
    const headerRow = raw[0] || [];

    // Create capabilities from column headers
    for (let col = 1; col < headerRow.length; col++) {
      const name = String(headerRow[col] ?? '').trim();
      if (!name) continue;
      if (!capabilityMap.has(name)) {
        createCapability(name, col);
        console.log(`  Capability: "${name}"`);
      }
    }
    console.log(`  → ${stats.capabilities} capabilities created`);

    // Process sale type rows — skip any row with 0 X marks
    for (let row = 1; row < raw.length; row++) {
      const cells = raw[row] || [];
      const name = String(cells[0] ?? '').trim();
      if (!name) continue;

      let xCount = 0;
      for (let col = 1; col < headerRow.length; col++) {
        const val = String(cells[col] ?? '').trim().toLowerCase();
        if (val === 'x' || val === 'own' || val === 'majority' || val.startsWith('x ') || val === 'nnnn') {
          xCount++;
        }
      }

      if (xCount === 0) {
        stats.skippedRows.push(name);
        continue;
      }

      if (!saleTypeMap.has(name)) {
        createSaleType(name, row);
      }
      const stId = saleTypeMap.get(name);

      for (let col = 1; col < headerRow.length; col++) {
        const capName = String(headerRow[col] ?? '').trim();
        if (!capName || !capabilityMap.has(capName)) continue;

        const cellVal = String(cells[col] ?? '').trim().toLowerCase();
        if (!cellVal) continue;

        const isEnabled = cellVal === 'x' || cellVal === 'own' || cellVal === 'majority' ||
                         cellVal.startsWith('x ') || cellVal === 'nnnn';
        const notes = (cellVal !== 'x' && cellVal !== '') ? String(cells[col] ?? '').trim() : null;

        if (isEnabled || notes) {
          setMatrixCell(stId, capabilityMap.get(capName), isEnabled, notes !== 'x' ? notes : null);
        }
      }
    }
    console.log(`  → ${stats.saleTypes} sale types created`);
    console.log(`  → ${stats.matrixCells} matrix cells created`);
    if (stats.skippedRows.length > 0) {
      console.log(`  → Skipped (0 X marks): ${stats.skippedRows.join(', ')}`);
    }
  }

  // ── Sheet 2: "Items per Product" ──
  console.log('\n=== Sheet 2: Items per Product ===');
  const itemsSheet = wb.Sheets['Items per Product'];
  if (itemsSheet) {
    const raw = XLSX.utils.sheet_to_json(itemsSheet, { header: 1 });
    const headerRow0 = raw[0] || [];
    const headerRow1 = raw[1] || [];

    // Build column → group mapping (fill-forward for merged cells)
    let currentGroup = '';
    const colToGroup = [];
    const maxCols = Math.max(headerRow0.length || 0, headerRow1.length || 0, 40);
    for (let col = 0; col < maxCols; col++) {
      const h0 = String(headerRow0[col] ?? '').trim();
      if (h0) currentGroup = h0;
      colToGroup[col] = currentGroup;
    }

    console.log(`  Groups found: ${[...new Set(colToGroup.filter(g => g))].join(', ')}`);

    // Find bolt-on divider row
    let boltOnStartRow = raw.length;
    for (let row = 2; row < raw.length; row++) {
      const cells = raw[row] || [];
      const label = String(cells[0] ?? '').trim().toLowerCase();
      if (label.includes('bolt on') || label.includes('bolt-on')) {
        boltOnStartRow = row;
        console.log(`  Bolt-on divider at row ${row}: "${String(cells[0] ?? '').trim()}"`);
        break;
      }
      // Check for repeated sub-category headers (indicates bolt-on section)
      let repeatHeaders = 0;
      for (let col = 30; col < (cells.length || 0); col++) {
        const val = String(cells[col] ?? '').trim();
        const colHeader = String(headerRow1[col] ?? '').trim();
        if (val && val === colHeader && colToGroup[col] === 'Standard Delivery') repeatHeaders++;
      }
      if (repeatHeaders >= 2) {
        boltOnStartRow = row;
        console.log(`  Bolt-on section detected at row ${row} (repeated headers)`);
        break;
      }
    }

    // 1. Non-Standard Delivery items (Row 1 column headers as custom add-ons)
    console.log('\n  --- Custom/Add-on Items (Row 1) ---');
    for (let col = 1; col < colToGroup.length; col++) {
      const group = colToGroup[col];
      if (!group || group === 'Standard Delivery') continue;

      const itemName = String(headerRow1[col] ?? '').trim();
      if (!itemName || itemName === 'Custom Items - options') continue;

      const targetCapName = GROUP_TO_CAP[group];
      if (!targetCapName) {
        console.log(`  [SKIP] No mapping for group "${group}" → item "${itemName}"`);
        continue;
      }

      const capId = capabilityMap.get(targetCapName);
      if (!capId) {
        console.log(`  [SKIP] Capability "${targetCapName}" not found → item "${itemName}"`);
        continue;
      }

      createItem(capId, itemName, false, col);
      console.log(`  ${group} → ${targetCapName}: "${itemName}"`);
    }

    // 2. Standard Delivery items (rows 2+ in cols 32-38)
    console.log('\n  --- Standard Delivery Items ---');
    for (let col = 0; col < colToGroup.length; col++) {
      if (colToGroup[col] !== 'Standard Delivery') continue;

      const subCategoryName = String(headerRow1[col] ?? '').trim();
      if (!subCategoryName) continue;

      const targetCapName = STD_DELIVERY_TO_CAP[subCategoryName];
      if (!targetCapName) {
        console.log(`  [SKIP] No mapping for Standard Delivery sub-category "${subCategoryName}"`);
        continue;
      }

      const capId = capabilityMap.get(targetCapName);
      if (!capId) {
        console.log(`  [SKIP] Capability "${targetCapName}" not found for sub-category "${subCategoryName}"`);
        continue;
      }

      let sortOrder = 0;
      const stdItems = [];
      const boltOnItems = [];

      // Items to skip (labels/notes, not actual deliverables)
      const skipPatterns = [
        /^bolt.?on/i,
        /^\(no admin/i,
        /^\*link only/i,
        /^note:/i,
      ];
      function shouldSkip(val) {
        return skipPatterns.some(p => p.test(val));
      }

      // Standard items (rows 2 to boltOnStartRow-1)
      for (let row = 2; row < boltOnStartRow; row++) {
        const cells = raw[row] || [];
        const val = String(cells[col] ?? '').trim();
        if (!val || val === subCategoryName || shouldSkip(val)) continue;
        stdItems.push(val);
        createItem(capId, val, false, sortOrder++);
      }

      // Bolt-on items (rows after divider)
      for (let row = boltOnStartRow + 1; row < raw.length; row++) {
        const cells = raw[row] || [];
        const val = String(cells[col] ?? '').trim();
        if (!val || val === subCategoryName || shouldSkip(val)) continue;
        boltOnItems.push(val);
        createItem(capId, val, true, sortOrder++);
      }

      console.log(`  ${subCategoryName} → ${targetCapName}: ${stdItems.length} std + ${boltOnItems.length} bolt-on`);
      if (stdItems.length > 0) console.log(`    Standard: ${stdItems.join(', ')}`);
      if (boltOnItems.length > 0) console.log(`    Bolt-on: ${boltOnItems.join(', ')}`);
    }
  }

  // Save
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log('\n=== Import Complete ===');
  console.log(`  Sale types: ${stats.saleTypes}`);
  console.log(`  Capabilities: ${stats.capabilities}`);
  console.log(`  Matrix cells: ${stats.matrixCells}`);
  console.log(`  Items: ${stats.items}`);

  // Verify by re-opening and counting
  const SQL2 = await initSqlJs();
  const db2 = new SQL2.Database(fs.readFileSync(DB_PATH));

  console.log('\n=== Verification ===');
  for (const table of ['onboarding_sale_types', 'onboarding_capabilities', 'onboarding_matrix', 'onboarding_capability_items']) {
    const count = db2.exec(`SELECT COUNT(*) FROM ${table}`)[0].values[0][0];
    console.log(`  ${table}: ${count} rows`);
  }

  // Show items per capability
  console.log('\n=== Items per Capability ===');
  const itemResults = db2.exec(`
    SELECT c.name, COUNT(i.id) as cnt,
           SUM(CASE WHEN i.is_bolt_on = 0 THEN 1 ELSE 0 END) as std,
           SUM(CASE WHEN i.is_bolt_on = 1 THEN 1 ELSE 0 END) as bolt
    FROM onboarding_capabilities c
    LEFT JOIN onboarding_capability_items i ON i.capability_id = c.id
    GROUP BY c.id
    HAVING cnt > 0
    ORDER BY c.sort_order
  `);
  if (itemResults.length > 0) {
    for (const row of itemResults[0].values) {
      console.log(`  ${row[0]}: ${row[1]} items (${row[2]} standard, ${row[3]} bolt-on)`);
    }
  }

  // Show sample matrix — first 5 sale types with their capabilities
  console.log('\n=== Sample Matrix (first 5 sale types) ===');
  const sampleResults = db2.exec(`
    SELECT st.name as sale_type,
           GROUP_CONCAT(c.name, ', ') as capabilities
    FROM onboarding_sale_types st
    JOIN onboarding_matrix m ON m.sale_type_id = st.id AND m.enabled = 1
    JOIN onboarding_capabilities c ON c.id = m.capability_id
    GROUP BY st.id
    ORDER BY st.sort_order
    LIMIT 5
  `);
  if (sampleResults.length > 0) {
    for (const row of sampleResults[0].values) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
  }

  db2.close();
}

main().catch(err => { console.error(err); process.exit(1); });
