/**
 * Import Training Matrix from XLSX into NOVA's SQLite database.
 *
 * IMPORTANT: Run with the server STOPPED — sql.js is in-memory,
 * and the server will overwrite our changes if it's still running.
 *
 * Usage:
 *   node scripts/import-training-matrix.mjs [path-to-xlsx]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import initSqlJs from 'sql.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'daypilot.db');
const USERS_PATH = path.join(PROJECT_ROOT, 'users.json');
const XLSX_PATH = process.argv[2] || 'C:/Users/NickW/Downloads/Training Matrix - 2026.xlsx';

if (!fs.existsSync(XLSX_PATH)) {
  console.error(`XLSX file not found: ${XLSX_PATH}`);
  process.exit(1);
}

// ── Spreadsheet column name → NOVA username mapping ──
// These must match usernames in users.json (or be created below)
const COLUMN_TO_USERNAME = {
  'Nick Ward':          'nickw',
  'Hiedi':              'heidi.power@nurtur.tech',
  'Naomi':              'naomi.wentworth@nurtur.tech',
  'Zoe':                'zoe.rees@nurtur.tech',
  'Hope':               'hope.goodall@nurtur.tech',
  'Nathan Rutland':     'nathan.rutland@nurtur.tech',
  'Kayleigh Russell':   'kayleigh.russell',
  'Isabel Busk':        'isabel.busk@nurtur.tech',
  'Stephen':            'stephen.mitchell@nurtur.tech',
  'Willem':             'willem.kruger@nurtur.tech',
  'Willem Kruger':      'willem.kruger@nurtur.tech',
  'Arman':              'arman.shazad@nurtur.tech',
  'Abdi':               'abdi.mohamed@nurtur.tech',
  'Luke':               'luke.scaife',
  'Seb':                'seb',
  'Adele':              'adele',
  'Maria':              'maria',
};

// ── Users to create if they don't already exist ──
// First, import all users from the live server CSV export
const CSV_PATH = 'C:/Users/NickW/Downloads/users-export-2026-04-07.csv';
const USERS_TO_CREATE = [];

if (fs.existsSync(CSV_PATH)) {
  // Use a proper CSV parse — roles field may be quoted with commas inside
  const csvText = fs.readFileSync(CSV_PATH, 'utf8').trim();
  const csvRows = [];
  let cur = '', inQuote = false, fields = [], i = 0;
  for (i = csvText.indexOf('\n') + 1; i < csvText.length; i++) {
    const ch = csvText[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { fields.push(cur); cur = ''; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (cur || fields.length) { fields.push(cur); csvRows.push(fields); }
      fields = []; cur = ''; continue;
    }
    cur += ch;
  }
  if (cur || fields.length) { fields.push(cur); csvRows.push(fields); }

  for (const f of csvRows) {
    const [username, displayName, email, roles, , authProvider] = f;
    if (!username?.trim()) continue;
    USERS_TO_CREATE.push({
      username: username.trim(),
      display_name: displayName?.trim() || null,
      email: email?.trim() || null,
      role: roles?.trim() || 'viewer',
      auth_provider: authProvider?.trim() || 'local',
    });
  }
  console.log(`[CSV] Loaded ${USERS_TO_CREATE.length} users from live server export`);
}

// Also add Adele and Maria (not in the live export)
USERS_TO_CREATE.push(
  { username: 'adele', display_name: 'Adele', email: null, role: 'viewer', auth_provider: 'local' },
  { username: 'maria', display_name: 'Maria', email: null, role: 'viewer', auth_provider: 'local' },
);

// ── Load DB ──
const SQL = await initSqlJs();
let db;
if (fs.existsSync(DB_PATH)) {
  const buffer = fs.readFileSync(DB_PATH);
  db = new SQL.Database(buffer);
  console.log('[Import] Loaded existing database');
} else {
  console.error('No database file found. Start the server once first to initialise the schema.');
  process.exit(1);
}

// Ensure training tables exist
db.run(`CREATE TABLE IF NOT EXISTS training_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER DEFAULT 0
)`);
db.run(`CREATE TABLE IF NOT EXISTS training_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, section TEXT DEFAULT '',
  name TEXT NOT NULL, tech_lead TEXT, max_score INTEGER DEFAULT 5, sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (category_id) REFERENCES training_categories(id) ON DELETE CASCADE
)`);
db.run(`CREATE TABLE IF NOT EXISTS training_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  score INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES training_items(id) ON DELETE CASCADE, UNIQUE(item_id, user_id)
)`);

// ── Load users.json ──
const usersData = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
const users = usersData.users || [];
let nextId = usersData.nextId || (users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1);

// Create missing users
for (const def of USERS_TO_CREATE) {
  if (users.find(u => u.username === def.username)) continue;
  const tempPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
  const newUser = {
    id: nextId++,
    username: def.username,
    display_name: def.display_name || null,
    email: def.email || null,
    password_hash: bcrypt.hashSync(tempPassword, 10),
    role: def.role || 'viewer',
    auth_provider: def.auth_provider || 'local',
    provider_id: null,
    team_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  users.push(newUser);
  console.log(`[User] Created "${def.username}" (id=${newUser.id}, "${def.display_name}")`);
}

// Build username → userId lookup
const usernameToId = new Map();
for (const u of users) usernameToId.set(u.username, u.id);

// Validate all mappings resolve
for (const [col, username] of Object.entries(COLUMN_TO_USERNAME)) {
  if (!usernameToId.has(username)) {
    console.error(`[ERROR] Column "${col}" maps to username "${username}" which does not exist in users.json`);
    process.exit(1);
  }
}
console.log(`[Import] All ${Object.keys(COLUMN_TO_USERNAME).length} column mappings resolved\n`);

// ── Clear existing training data (idempotent re-import) ──
db.run(`DELETE FROM training_scores`);
db.run(`DELETE FROM training_items`);
db.run(`DELETE FROM training_categories`);
console.log('[Import] Cleared existing training data\n');

// ── Parse XLSX ──
const wb = XLSX.readFile(XLSX_PATH);

function norm(s) { return String(s || '').trim().replace(/\s+/g, ' '); }

let totalCategories = 0, totalItems = 0, totalScores = 0;

for (let catIdx = 0; catIdx < wb.SheetNames.length; catIdx++) {
  const sheetName = wb.SheetNames[catIdx];
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (data.length < 2) { console.log(`[Skip] "${sheetName}" — no data`); continue; }

  // Insert category
  db.run(`INSERT INTO training_categories (name, sort_order) VALUES (?, ?)`, [sheetName, catIdx]);
  const catId = db.exec(`SELECT id FROM training_categories WHERE name = ?`, [sheetName])[0].values[0][0];
  totalCategories++;
  console.log(`[Category] ${sheetName} (id=${catId})`);

  // Parse header — find person columns
  const headers = data[0].map(h => norm(h));
  const skipCols = new Set(['Knowledge Item', 'Total', 'Team Total Score', 'Tech Lead', 'Udemy', '']);
  const personCols = []; // { colIdx, userId, name }

  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    if (skipCols.has(h)) continue;
    // Try all mappings
    const username = COLUMN_TO_USERNAME[h];
    if (username) {
      personCols.push({ colIdx: c, userId: usernameToId.get(username), name: h });
    }
  }

  // Find tech_lead column
  const techLeadCol = headers.indexOf('Tech Lead');

  console.log(`  ${personCols.length} people columns found`);

  // Parse rows
  let currentSection = '';
  let sortOrder = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const raw = norm(row[0]);
    if (!raw) continue;

    // Skip pure numeric summary rows
    if (/^\d+(\.\d+)?$/.test(raw)) continue;

    // Detect section headers: name ends with ":" AND all person columns are empty
    const allEmpty = personCols.every(p => {
      const v = row[p.colIdx];
      return v === '' || v === undefined || v === null;
    });
    const endsWithColon = raw.endsWith(':');

    if (endsWithColon && allEmpty) {
      currentSection = raw.replace(/:$/, '').trim();
      continue;
    }

    // Also detect section-style headers that don't end with colon but have no scores at all
    // (e.g. "Websites (Services)" in Members Hub) — check if Total col is also empty
    const totalColIdx = headers.indexOf('Total') >= 0 ? headers.indexOf('Total') :
                        headers.indexOf('Team Total Score') >= 0 ? headers.indexOf('Team Total Score') : 1;
    const totalVal = row[totalColIdx];
    if (allEmpty && (totalVal === '' || totalVal === undefined || totalVal === null) && !endsWithColon) {
      // Likely a section header without colon
      currentSection = raw.trim();
      continue;
    }

    const cleanName = raw.replace(/:$/, '').trim();
    if (!cleanName) continue;

    const techLead = techLeadCol >= 0 ? norm(row[techLeadCol]) || null : null;

    // Insert item
    db.run(
      `INSERT INTO training_items (category_id, section, name, tech_lead, max_score, sort_order) VALUES (?, ?, ?, ?, 5, ?)`,
      [catId, currentSection, cleanName, techLead, sortOrder++]
    );
    const itemId = db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
    totalItems++;

    // Insert scores
    for (const pc of personCols) {
      const rawScore = row[pc.colIdx];
      if (rawScore === '' || rawScore === undefined || rawScore === null) continue;
      const score = Number(rawScore);
      if (!Number.isFinite(score) || score < 0) continue;
      const clamped = Math.min(score, 5);

      db.run(
        `INSERT INTO training_scores (item_id, user_id, score, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(item_id, user_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
        [itemId, pc.userId, clamped]
      );
      totalScores++;
    }
  }
}

// ── Save ──
const dbData = db.export();
fs.writeFileSync(DB_PATH, Buffer.from(dbData));
console.log(`\n[Import] Database saved to ${DB_PATH}`);

usersData.users = users;
usersData.nextId = nextId;
fs.writeFileSync(USERS_PATH, JSON.stringify(usersData, null, 2));
console.log(`[Import] Users saved to ${USERS_PATH}`);

console.log(`\n=== Import Summary ===`);
console.log(`Categories: ${totalCategories}`);
console.log(`Items:      ${totalItems}`);
console.log(`Scores:     ${totalScores}`);
console.log(`Users:      ${users.length} total`);

db.close();
console.log('\nDone! Start the server to see the training matrix.');
