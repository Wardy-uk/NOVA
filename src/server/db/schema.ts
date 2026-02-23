import initSqlJs, { type Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../../daypilot.db');

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();

  // Load existing database file if it exists
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  return db;
}

export function saveDb(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
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
      role TEXT DEFAULT 'user',
      auth_provider TEXT DEFAULT 'local',
      provider_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Indexes
  database.run(`CREATE INDEX IF NOT EXISTS idx_delivery_product ON delivery_entries(product)`);
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
