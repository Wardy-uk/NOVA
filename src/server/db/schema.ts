import initSqlJs, { type Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const DATA_DIR = process.env.DATA_DIR || PROJECT_ROOT;
const DB_PATH = path.join(DATA_DIR, 'daypilot.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 7;

let db: Database | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryRestoreFromBackup(SQL: any): Database | null {
  if (!fs.existsSync(BACKUP_DIR)) return null;

  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('daypilot.db.') && f.endsWith('.bak'))
    .sort()
    .reverse(); // newest first

  for (const backupFile of backups) {
    try {
      const backupPath = path.join(BACKUP_DIR, backupFile);
      const buffer = fs.readFileSync(backupPath);
      if (buffer.length === 0) continue;
      const testDb = new SQL.Database(buffer);
      testDb.exec('SELECT COUNT(*) FROM sqlite_master'); // integrity check
      console.log(`[N.O.V.A] Successfully loaded backup: ${backupFile}`);
      return testDb;
    } catch {
      console.warn(`[N.O.V.A] Backup ${backupFile} is corrupt, trying next...`);
    }
  }
  return null;
}

export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();

  // Load existing database file if it exists
  if (fs.existsSync(DB_PATH)) {
    try {
      const buffer = fs.readFileSync(DB_PATH);
      if (buffer.length === 0) throw new Error('Database file is empty');
      db = new SQL.Database(buffer);
      db.exec('SELECT COUNT(*) FROM sqlite_master'); // integrity check
      return db;
    } catch (err) {
      console.error('[N.O.V.A] Main database file is corrupt or empty:', err instanceof Error ? err.message : err);
      db = null;
      // Try loading from most recent backup
      const restored = tryRestoreFromBackup(SQL);
      if (restored) {
        db = restored;
        console.log('[N.O.V.A] Restored database from backup');
        saveDb(); // write restored DB as the main file
        return db;
      }
      console.error('[N.O.V.A] No valid backups found. Starting with fresh database.');
    }
  }

  db = new SQL.Database();
  return db;
}

export function saveDb(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);

  // Atomic write: write to temp file, then rename
  const tmpPath = DB_PATH + '.tmp';
  try {
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, DB_PATH);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

export function createBackup(): string | null {
  if (!fs.existsSync(DB_PATH)) return null;

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const backupPath = path.join(BACKUP_DIR, `daypilot.db.${dateStr}.bak`);

  // Skip if today's backup already exists
  if (fs.existsSync(backupPath)) return backupPath;

  try {
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`[Backup] Created daily backup: ${backupPath}`);

    // Rotate: delete oldest backups beyond MAX_BACKUPS
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('daypilot.db.') && f.endsWith('.bak'))
      .sort()
      .reverse();

    for (let i = MAX_BACKUPS; i < backups.length; i++) {
      const oldPath = path.join(BACKUP_DIR, backups[i]);
      fs.unlinkSync(oldPath);
      console.log(`[Backup] Rotated out old backup: ${backups[i]}`);
    }

    return backupPath;
  } catch (err) {
    console.error('[Backup] Failed to create backup:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function initializeSchema(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT,
      source_url TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'open',
      priority INTEGER DEFAULT 50,
      due_date TEXT,
      sla_breach_at TEXT,
      category TEXT,
      is_pinned INTEGER DEFAULT 0,
      snoozed_until TEXT,
      last_synced TEXT,
      raw_data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS rituals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      conversation TEXT,
      summary_md TEXT,
      planned_items TEXT,
      completed_items TEXT,
      blockers TEXT,
      openai_response_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS delivery_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product TEXT NOT NULL,
      account TEXT NOT NULL,
      status TEXT DEFAULT '',
      onboarder TEXT,
      order_date TEXT,
      go_live_date TEXT,
      predicted_delivery TEXT,
      branches INTEGER,
      mrr REAL,
      incremental REAL,
      licence_fee REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS crm_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      sector TEXT,
      mrr REAL,
      owner TEXT,
      rag_status TEXT DEFAULT 'green',
      next_review_date TEXT,
      contract_start TEXT,
      contract_end TEXT,
      dynamics_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS crm_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      review_date TEXT NOT NULL,
      rag_status TEXT NOT NULL,
      outcome TEXT,
      actions TEXT,
      reviewer TEXT,
      next_review_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'viewer',
      auth_provider TEXT DEFAULT 'local',
      provider_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS user_task_pins (
      user_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, task_id)
    )
  `);

  // ── Onboarding configuration tables ──

  database.run(`
    CREATE TABLE IF NOT EXISTS onboarding_ticket_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS onboarding_sale_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS onboarding_capabilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT,
      ticket_group_id INTEGER REFERENCES onboarding_ticket_groups(id),
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS onboarding_matrix (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_type_id INTEGER NOT NULL REFERENCES onboarding_sale_types(id) ON DELETE CASCADE,
      capability_id INTEGER NOT NULL REFERENCES onboarding_capabilities(id) ON DELETE CASCADE,
      enabled INTEGER DEFAULT 1,
      notes TEXT,
      UNIQUE(sale_type_id, capability_id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS onboarding_capability_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capability_id INTEGER NOT NULL REFERENCES onboarding_capabilities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_bolt_on INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS onboarding_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      onboarding_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      parent_key TEXT,
      child_keys TEXT,
      created_count INTEGER DEFAULT 0,
      linked_count INTEGER DEFAULT 0,
      error_message TEXT,
      payload TEXT,
      dry_run INTEGER DEFAULT 0,
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Milestone tables ──

  database.run(`
    CREATE TABLE IF NOT EXISTS milestone_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      day_offset INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      checklist_json TEXT DEFAULT '[]',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS delivery_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      template_name TEXT NOT NULL,
      target_date TEXT,
      actual_date TEXT,
      status TEXT DEFAULT 'pending',
      checklist_state_json TEXT DEFAULT '[]',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migrations — add columns that may not exist in older databases
  const migrations: [string, string][] = [
    ['delivery_entries', 'training_date TEXT'],
    ['delivery_entries', 'is_starred INTEGER DEFAULT 0'],
    ['delivery_entries', 'star_scope TEXT DEFAULT \'me\''],
    ['delivery_entries', 'starred_by INTEGER'],
    ['users', 'team_id INTEGER'],
    ['delivery_entries', 'onboarding_id TEXT'],
    ['rituals', 'user_id INTEGER'],
    ['onboarding_capabilities', 'ticket_group_id INTEGER'],
    ['onboarding_sale_types', 'jira_tickets_required INTEGER DEFAULT 0'],
    ['delivery_entries', 'sale_type TEXT'],
    ['tasks', 'transient INTEGER DEFAULT 0'],
    ['feedback', 'admin_reply TEXT'],
    ['feedback', 'admin_reply_at TEXT'],
    ['feedback', 'admin_reply_by INTEGER'],
    ['feedback', 'task_id INTEGER'],
  ];
  // Data migration: consolidate 'user' role → 'viewer'
  try { database.run(`UPDATE users SET role = 'viewer' WHERE role = 'user'`); } catch { /* ignore */ }
  for (const [table, colDef] of migrations) {
    try {
      database.run(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
    } catch {
      // Column already exists — ignore
    }
  }

  // Indexes
  database.run(`CREATE INDEX IF NOT EXISTS idx_delivery_product ON delivery_entries(product)`);
  database.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_onboarding_id ON delivery_entries(onboarding_id) WHERE onboarding_id IS NOT NULL`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_sla_breach ON tasks(sla_breach_at)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_rituals_type_date ON rituals(type, date)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_crm_customers_rag ON crm_customers(rag_status)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_crm_customers_next_review ON crm_customers(next_review_date)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_crm_reviews_customer ON crm_reviews(customer_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_crm_reviews_date ON crm_reviews(review_date DESC)`);
  database.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_user_task_pins_user ON user_task_pins(user_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_rituals_user ON rituals(user_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_ticket_groups ON onboarding_ticket_groups(sort_order)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_caps_group ON onboarding_capabilities(ticket_group_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_matrix_sale ON onboarding_matrix(sale_type_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_matrix_cap ON onboarding_matrix(capability_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_items_cap ON onboarding_capability_items(capability_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_onboarding_runs_ref ON onboarding_runs(onboarding_ref)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_milestones_delivery ON delivery_milestones(delivery_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_milestones_status ON delivery_milestones(status)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_milestones_target ON delivery_milestones(target_date)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_milestone_templates_active ON milestone_templates(active, sort_order)`);

  // Milestone sale type matrix: day offsets per sale type per template
  database.run(`
    CREATE TABLE IF NOT EXISTS milestone_sale_type_offsets (
      sale_type_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      day_offset INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (sale_type_id, template_id),
      FOREIGN KEY (sale_type_id) REFERENCES onboarding_sale_types(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES milestone_templates(id) ON DELETE CASCADE
    )
  `);

  // Seed default milestone templates from file
  const tmplCount = database.exec('SELECT COUNT(*) as c FROM milestone_templates');
  if ((tmplCount[0]?.values[0]?.[0] as number) === 0) {
    try {
      const seedPath = path.join(PROJECT_ROOT, 'src/server/data/milestone-templates.json');
      const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as Array<{
        name: string; day_offset: number; sort_order: number; checklist: string[];
      }>;
      for (const tmpl of seedData) {
        database.run(
          `INSERT INTO milestone_templates (name, day_offset, sort_order, checklist_json) VALUES (?, ?, ?, ?)`,
          [tmpl.name, tmpl.day_offset, tmpl.sort_order, JSON.stringify(tmpl.checklist)]
        );
      }
      console.log(`[N.O.V.A] Seeded ${seedData.length} milestone templates from file`);
    } catch (err) {
      console.error('[N.O.V.A] Failed to seed milestone templates:', err instanceof Error ? err.message : err);
    }
  } else {
    // Backfill checklists for existing templates that have empty checklist_json
    try {
      const seedPath = path.join(PROJECT_ROOT, 'src/server/data/milestone-templates.json');
      const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as Array<{
        name: string; checklist: string[];
      }>;
      for (const tmpl of seedData) {
        database.run(
          `UPDATE milestone_templates SET checklist_json = ? WHERE name = ? AND (checklist_json IS NULL OR checklist_json = '[]')`,
          [JSON.stringify(tmpl.checklist), tmpl.name]
        );
      }
    } catch { /* ignore — file may not exist */ }
  }

  // Seed milestone matrix offsets if empty (populate all active sale types x all active templates with template defaults)
  const matrixCount = database.exec('SELECT COUNT(*) as c FROM milestone_sale_type_offsets');
  if ((matrixCount[0]?.values[0]?.[0] as number) === 0) {
    const stRows = database.exec('SELECT id FROM onboarding_sale_types WHERE active = 1');
    const tmplRows = database.exec('SELECT id, day_offset FROM milestone_templates WHERE active = 1');
    if (stRows.length > 0 && tmplRows.length > 0) {
      let seeded = 0;
      for (const st of stRows[0].values) {
        for (const tmpl of tmplRows[0].values) {
          database.run(
            `INSERT OR IGNORE INTO milestone_sale_type_offsets (sale_type_id, template_id, day_offset) VALUES (?, ?, ?)`,
            [st[0], tmpl[0], tmpl[1]]
          );
          seeded++;
        }
      }
      console.log(`[N.O.V.A] Seeded ${seeded} milestone matrix offsets (${stRows[0].values.length} sale types x ${tmplRows[0].values.length} templates)`);
    }
  }

  // Seed default settings
  const defaults: [string, string][] = [
    ['source_weight_jira', '90'],
    ['source_weight_planner', '60'],
    ['source_weight_todo', '50'],
    ['source_weight_monday', '55'],
    ['source_weight_email', '40'],
    ['source_weight_calendar', '70'],
    ['refresh_interval_minutes', '5'],
  ];

  for (const [key, value] of defaults) {
    database.run(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`,
      [key, value]
    );
  }

  saveDb();
}

// Allow standalone execution for db:reset
const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');

if (isMain) {
  const database = await getDb();
  initializeSchema(database);
  console.log('Database initialized at', DB_PATH);
}
