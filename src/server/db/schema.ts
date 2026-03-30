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
    try { fs.unlinkSync(DB_PATH); } catch { /* ignore if not exists */ }
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
    ['milestone_templates', 'lead_days INTEGER DEFAULT 3'],
    ['delivery_milestones', 'workflow_task_created INTEGER DEFAULT 0'],
    ['delivery_milestones', 'workflow_tickets_created INTEGER DEFAULT 0'],
    ['delivery_milestones', 'jira_keys TEXT'],
    ['delivery_entries', 'crm_customer_id INTEGER'],
    ['crm_customers', 'account_number TEXT'],
    ['tasks', 'user_id INTEGER'],
    ['delivery_milestones', 'assigned_to INTEGER'],
    ['milestone_templates', 'tickets_enabled INTEGER DEFAULT 0'],
    ['onboarding_ticket_groups', 'display_name TEXT'],
    ['onboarding_ticket_groups', 'traffic_light_group TEXT'],
  ];
  // Data migration: consolidate 'user' role → 'viewer'
  try { database.run(`UPDATE users SET role = 'viewer' WHERE role = 'user'`); } catch { /* ignore */ }
  // NOTE: task user_id assignment is handled in index.ts after milestone resync
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
  database.run(`CREATE INDEX IF NOT EXISTS idx_milestones_workflow ON delivery_milestones(workflow_task_created, status)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id)`);

  // Milestone-to-ticket-group linking: which ticket groups trigger at which milestone stage
  database.run(`
    CREATE TABLE IF NOT EXISTS milestone_template_ticket_groups (
      template_id INTEGER NOT NULL,
      ticket_group_id INTEGER NOT NULL,
      PRIMARY KEY (template_id, ticket_group_id),
      FOREIGN KEY (template_id) REFERENCES milestone_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_group_id) REFERENCES onboarding_ticket_groups(id) ON DELETE CASCADE
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_milestone_tmpl_tg ON milestone_template_ticket_groups(template_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_milestone_tg_tmpl ON milestone_template_ticket_groups(ticket_group_id)`);

  // Audit log — who changed what and when
  database.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      changes_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`);

  // Notifications — alerts for SLA breaches, overdue milestones, etc.
  database.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      entity_type TEXT,
      entity_id TEXT,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at)`);
  database.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedup ON notifications(user_id, type, entity_id) WHERE read_at IS NULL`);

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

  // ── Problem Ticket Detection tables ──

  database.run(`
    CREATE TABLE IF NOT EXISTS problem_ticket_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT NOT NULL UNIQUE,
      project_key TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT,
      priority TEXT,
      assignee TEXT,
      reporter TEXT,
      created_at TEXT,
      severity TEXT NOT NULL,
      score INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      sla_remaining_ms INTEGER,
      sentiment_score REAL,
      sentiment_summary TEXT,
      scan_id TEXT NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS problem_ticket_alert_reasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL REFERENCES problem_ticket_alerts(id) ON DELETE CASCADE,
      rule TEXT NOT NULL,
      label TEXT NOT NULL,
      weight INTEGER NOT NULL,
      detail TEXT
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS problem_ticket_ignores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT NOT NULL,
      ignored_by TEXT NOT NULL,
      reason TEXT,
      fingerprint_at_ignore TEXT NOT NULL,
      ignored_at TEXT NOT NULL DEFAULT (datetime('now')),
      lifted_at TEXT,
      lifted_reason TEXT
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS problem_ticket_config (
      rule TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      weight INTEGER NOT NULL,
      threshold_json TEXT
    )
  `);

  // Seed default problem ticket config
  const ptcCount = database.exec('SELECT COUNT(*) as c FROM problem_ticket_config');
  if ((ptcCount[0]?.values[0]?.[0] as number) === 0) {
    const defaults: Array<{ rule: string; weight: number; threshold_json: string }> = [
      { rule: 'sla_breached', weight: 30, threshold_json: '{}' },
      { rule: 'sla_near', weight: 20, threshold_json: '{"hoursThreshold":2}' },
      { rule: 'stale_comms', weight: 15, threshold_json: '{"daysThreshold":3}' },
      { rule: 'ticket_age', weight: 10, threshold_json: '{"daysThreshold":7}' },
      { rule: 'ping_pong', weight: 15, threshold_json: '{"reassignThreshold":3,"windowHours":48}' },
      { rule: 'reopened', weight: 10, threshold_json: '{}' },
      { rule: 'high_priority', weight: 10, threshold_json: '{"priorities":["Highest","High"]}' },
      { rule: 'sentiment', weight: 20, threshold_json: '{"negativeThreshold":-0.3}' },
      { rule: 'stagnant_status', weight: 10, threshold_json: '{"daysThreshold":5}' },
      { rule: 'missed_commitment', weight: 25, threshold_json: '{}' },
    ];
    for (const d of defaults) {
      database.run(
        'INSERT INTO problem_ticket_config (rule, weight, threshold_json) VALUES (?, ?, ?)',
        [d.rule, d.weight, d.threshold_json]
      );
    }
  }

  // Backfill missed_commitment rule for existing DBs
  database.run(
    `INSERT OR IGNORE INTO problem_ticket_config (rule, weight, threshold_json) VALUES ('missed_commitment', 25, '{}')`,
  );

  // Backfill no_next_reply rule for existing DBs
  database.run(
    `INSERT OR IGNORE INTO problem_ticket_config (rule, weight, threshold_json) VALUES ('no_next_reply', 20, '{"hoursThreshold":4,"staffDomains":["nurtur"]}')`,
  );

  // Seed default milestone templates from file
  const tmplCount = database.exec('SELECT COUNT(*) as c FROM milestone_templates');
  if ((tmplCount[0]?.values[0]?.[0] as number) === 0) {
    try {
      const seedPath = path.join(PROJECT_ROOT, 'src/server/data/milestone-templates.json');
      const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as Array<{
        name: string; day_offset: number; sort_order: number; checklist: string[]; tickets_enabled?: boolean;
      }>;
      for (const tmpl of seedData) {
        database.run(
          `INSERT INTO milestone_templates (name, day_offset, sort_order, checklist_json, tickets_enabled) VALUES (?, ?, ?, ?, ?)`,
          [tmpl.name, tmpl.day_offset, tmpl.sort_order, JSON.stringify(tmpl.checklist), tmpl.tickets_enabled ? 1 : 0]
        );
      }
      console.log(`[N.O.V.A] Seeded ${seedData.length} milestone templates from file`);
    } catch (err) {
      console.error('[N.O.V.A] Failed to seed milestone templates:', err instanceof Error ? err.message : err);
    }
  } else {
    // Backfill: insert missing templates + update checklists for existing ones
    try {
      const seedPath = path.join(PROJECT_ROOT, 'src/server/data/milestone-templates.json');
      const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as Array<{
        name: string; day_offset: number; sort_order: number; checklist: string[]; tickets_enabled?: boolean;
      }>;
      for (const tmpl of seedData) {
        // Insert if this template name doesn't exist yet
        const exists = database.exec(`SELECT 1 FROM milestone_templates WHERE name = ?`, [tmpl.name]);
        if (exists.length === 0 || exists[0].values.length === 0) {
          database.run(
            `INSERT INTO milestone_templates (name, day_offset, sort_order, checklist_json, tickets_enabled) VALUES (?, ?, ?, ?, ?)`,
            [tmpl.name, tmpl.day_offset, tmpl.sort_order, JSON.stringify(tmpl.checklist), tmpl.tickets_enabled ? 1 : 0]
          );
          console.log(`[N.O.V.A] Backfilled milestone template: ${tmpl.name}`);
        } else {
          // Backfill empty checklists on existing templates
          database.run(
            `UPDATE milestone_templates SET checklist_json = ? WHERE name = ? AND (checklist_json IS NULL OR checklist_json = '[]')`,
            [JSON.stringify(tmpl.checklist), tmpl.name]
          );
        }
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

  // ── Instance Setup tables (Onboarding.Tool integration) ──

  database.run(`
    CREATE TABLE IF NOT EXISTS instance_setup_step_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product TEXT NOT NULL,
      step_key TEXT NOT NULL,
      step_label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      required INTEGER DEFAULT 1,
      UNIQUE(product, step_key)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS instance_setup_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL REFERENCES delivery_entries(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      step_label TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      result_message TEXT,
      executed_at TEXT,
      executed_by INTEGER,
      UNIQUE(delivery_id, step_key)
    )
  `);

  database.run(`CREATE INDEX IF NOT EXISTS idx_setup_steps_delivery ON instance_setup_steps(delivery_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_setup_templates_product ON instance_setup_step_templates(product, sort_order)`);

  // Seed default BYM setup step templates
  const setupTmplCount = database.exec('SELECT COUNT(*) as c FROM instance_setup_step_templates');
  if ((setupTmplCount[0]?.values[0]?.[0] as number) === 0) {
    const bymSteps: Array<{ key: string; label: string; sort: number }> = [
      { key: 'setupBrands', label: 'Create Brands', sort: 1 },
      { key: 'setupTemplates', label: 'Confirm Email Templates', sort: 2 },
      { key: 'setupDirectMail', label: 'Confirm Direct Mail', sort: 3 },
      { key: 'setupLetterhead', label: 'Confirm Letterhead', sort: 4 },
      { key: 'setupBranches', label: 'Create Branches', sort: 5 },
      { key: 'setupDeliveryAddresses', label: 'Create Delivery Addresses', sort: 6 },
      { key: 'setupUsers', label: 'Create Users', sort: 7 },
      { key: 'setupRss', label: 'Add RSS Feeds', sort: 8 },
      { key: 'setupRobocop', label: 'Add Robocop Settings', sort: 9 },
      { key: 'setupScheduledReports', label: 'Add Scheduled Reports', sort: 10 },
      { key: 'setupComponents', label: 'Add Email Components', sort: 11 },
      { key: 'setupAutomatedEmails', label: 'Add Automated Emails', sort: 12 },
      { key: 'setupBuildMilestones', label: 'Add Build Milestones', sort: 13 },
      { key: 'setupBuildPortals', label: 'Add Build Portals', sort: 14 },
      { key: 'setupBuildContent', label: 'Add Build Content', sort: 15 },
      { key: 'setupMatchToCrm', label: 'Match to CRM', sort: 16 },
    ];
    for (const s of bymSteps) {
      database.run(
        `INSERT INTO instance_setup_step_templates (product, step_key, step_label, sort_order) VALUES (?, ?, ?, ?)`,
        ['BYM', s.key, s.label, s.sort]
      );
    }
    console.log(`[N.O.V.A] Seeded ${bymSteps.length} BYM instance setup step templates`);
  }

  // ── Phase 2: Delivery Branches ──
  database.run(`
    CREATE TABLE IF NOT EXISTS delivery_branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL REFERENCES delivery_entries(id) ON DELETE CASCADE,
      is_default INTEGER DEFAULT 0,
      name TEXT NOT NULL,
      sales_email TEXT,
      sales_phone TEXT,
      lettings_email TEXT,
      lettings_phone TEXT,
      address1 TEXT,
      address2 TEXT,
      address3 TEXT,
      town TEXT,
      post_code1 TEXT,
      post_code2 TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(delivery_id, name)
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_delivery_branches_delivery ON delivery_branches(delivery_id)`);

  // ── Phase 2: Delivery Brand Settings (key-value per delivery) ──
  database.run(`
    CREATE TABLE IF NOT EXISTS delivery_brand_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL REFERENCES delivery_entries(id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      setting_value TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(delivery_id, setting_key)
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_brand_settings_delivery ON delivery_brand_settings(delivery_id)`);

  // ── Phase 3: Delivery Logos (base64 in DB) ──
  database.run(`
    CREATE TABLE IF NOT EXISTS delivery_logos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL REFERENCES delivery_entries(id) ON DELETE CASCADE,
      logo_type INTEGER NOT NULL,
      logo_label TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'image/png',
      image_data TEXT NOT NULL,
      file_name TEXT,
      file_size INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(delivery_id, logo_type)
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_delivery_logos_delivery ON delivery_logos(delivery_id)`);

  // ── Phase 4: AzDO columns on delivery_entries ──
  try { database.run(`ALTER TABLE delivery_entries ADD COLUMN azdo_branch_name TEXT`); } catch { /* already exists */ }
  try { database.run(`ALTER TABLE delivery_entries ADD COLUMN azdo_pr_url TEXT`); } catch { /* already exists */ }

  // ── Phase 5: Setup Execution Runs ──
  database.run(`
    CREATE TABLE IF NOT EXISTS setup_execution_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL REFERENCES delivery_entries(id) ON DELETE CASCADE,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT DEFAULT 'running',
      started_by INTEGER REFERENCES users(id),
      summary TEXT
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_setup_runs_delivery ON setup_execution_runs(delivery_id)`);

  // ── Phase 5: Setup Execution Logs ──
  database.run(`
    CREATE TABLE IF NOT EXISTS setup_execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES setup_execution_runs(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      level TEXT DEFAULT 'info',
      message TEXT NOT NULL
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_setup_logs_run ON setup_execution_logs(run_id)`);

  // ── Phase 6: Customer Setup Portal Tokens ──
  database.run(`
    CREATE TABLE IF NOT EXISTS setup_portal_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      delivery_id INTEGER NOT NULL REFERENCES delivery_entries(id) ON DELETE CASCADE,
      customer_email TEXT NOT NULL,
      customer_name TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed TEXT,
      completed_at TEXT,
      created_by INTEGER REFERENCES users(id),
      progress_json TEXT DEFAULT '{}'
    )
  `);
  database.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_token ON setup_portal_tokens(token)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_setup_portal_delivery ON setup_portal_tokens(delivery_id)`);

  // ── Build tab tables (portal accounts + branch districts) ──
  database.run(`
    CREATE TABLE IF NOT EXISTS delivery_portal_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL,
      portal_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(delivery_id, portal_name)
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_portal_accounts_delivery ON delivery_portal_accounts(delivery_id)`);

  database.run(`
    CREATE TABLE IF NOT EXISTS delivery_branch_districts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES delivery_branches(id) ON DELETE CASCADE,
      delivery_id INTEGER NOT NULL,
      district_name TEXT NOT NULL,
      all_sectors INTEGER DEFAULT 0,
      sectors_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(branch_id, district_name)
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_branch_districts_delivery ON delivery_branch_districts(delivery_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_branch_districts_branch ON delivery_branch_districts(branch_id)`);

  // Welcome pack snapshots
  database.run(`
    CREATE TABLE IF NOT EXISTS delivery_welcome_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_welcome_packs_delivery ON delivery_welcome_packs(delivery_id)`);

  // ── Sales Hotbox ──────────────────────────────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS sales_pipeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson TEXT NOT NULL,
      lead_gen TEXT,
      company TEXT NOT NULL,
      mrr REAL NOT NULL DEFAULT 0,
      product TEXT,
      stage TEXT NOT NULL,
      demo_date TEXT,
      est_close_date TEXT,
      next_chase_date TEXT,
      contact TEXT,
      phone TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_sales_pipeline_salesperson ON sales_pipeline(salesperson)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_sales_pipeline_stage ON sales_pipeline(stage)`);

  database.run(`
    CREATE TABLE IF NOT EXISTS sales_monthly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_date TEXT NOT NULL,
      lead_gen TEXT,
      salesperson TEXT NOT NULL,
      product TEXT,
      trading_name TEXT,
      limited_company TEXT,
      company_number TEXT,
      email TEXT,
      setup_fee REAL DEFAULT 0,
      licence REAL DEFAULT 0,
      upsell_mrr REAL DEFAULT 0,
      postal REAL DEFAULT 0,
      coms REAL DEFAULT 0,
      trial_mrr REAL DEFAULT 0,
      actual_mrr REAL DEFAULT 0,
      branches INTEGER DEFAULT 1,
      existing_vs_new TEXT,
      hotbox_ref INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_sales_monthly_salesperson ON sales_monthly(salesperson)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_sales_monthly_date ON sales_monthly(sale_date)`);

  database.run(`
    CREATE TABLE IF NOT EXISTS sales_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson TEXT NOT NULL,
      month TEXT NOT NULL,
      target_mrr REAL NOT NULL DEFAULT 0,
      UNIQUE(salesperson, month)
    )
  `);

  // ── Demo Bookings ───────────────────────────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS sales_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booked_date TEXT NOT NULL,
      salesperson TEXT NOT NULL,
      lead_gen TEXT,
      team TEXT,
      product TEXT,
      company TEXT NOT NULL,
      email TEXT,
      client_type TEXT,
      demo_date TEXT,
      dm TEXT,
      phone TEXT,
      lead_source TEXT,
      taken_place INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_sales_bookings_date ON sales_bookings(booked_date)`);

  // ── Taken Place ────────────────────────────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS sales_taken_place (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      demo_date TEXT NOT NULL,
      salesperson TEXT NOT NULL,
      lead_gen TEXT,
      product TEXT,
      company TEXT NOT NULL,
      email TEXT,
      branches INTEGER DEFAULT 1,
      dm TEXT,
      est_mrr REAL DEFAULT 0,
      hwc TEXT,
      in_hotbox TEXT DEFAULT 'No',
      client_type TEXT,
      notes TEXT,
      booking_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_sales_taken_place_date ON sales_taken_place(demo_date)`);

  // ── Lead Gen Monthly KPIs ──────────────────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS sales_lg_kpi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person TEXT NOT NULL,
      month TEXT NOT NULL,
      days_worked REAL DEFAULT 0,
      calls_kpi REAL DEFAULT 0,
      calls_actual REAL DEFAULT 0,
      booked_kpi REAL DEFAULT 0,
      booked_actual REAL DEFAULT 0,
      tp_kpi REAL DEFAULT 0,
      tp_actual REAL DEFAULT 0,
      sales_count REAL DEFAULT 0,
      mrr_total REAL DEFAULT 0,
      UNIQUE(person, month)
    )
  `);
  // Add columns if upgrading from older schema
  for (const col of ['booked_actual', 'tp_actual', 'sales_count', 'mrr_total']) {
    try { database.run(`ALTER TABLE sales_lg_kpi ADD COLUMN ${col} REAL DEFAULT 0`); } catch { /* already exists */ }
  }

  // ── Lead Gen Historical Monthly Totals (team-wide) ──────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS sales_lg_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month_num INTEGER NOT NULL,
      calls INTEGER DEFAULT 0,
      bookings INTEGER DEFAULT 0,
      taken_place INTEGER DEFAULT 0,
      UNIQUE(year, month_num)
    )
  `);

  // ── BDM KPI Targets ────────────────────────────────────────────────────
  database.run(`
    CREATE TABLE IF NOT EXISTS sales_bdm_kpi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person TEXT NOT NULL,
      month TEXT NOT NULL,
      booked_kpi REAL DEFAULT 0,
      booked_actual REAL DEFAULT 0,
      tp_kpi REAL DEFAULT 0,
      tp_actual REAL DEFAULT 0,
      sales_kpi REAL DEFAULT 0,
      sales_actual REAL DEFAULT 0,
      mrr_kpi REAL DEFAULT 0,
      mrr_actual REAL DEFAULT 0,
      target REAL DEFAULT 0,
      UNIQUE(person, month)
    )
  `);
  // Add columns if upgrading from older schema
  for (const col of ['booked_actual', 'tp_actual', 'sales_actual', 'mrr_actual', 'target']) {
    try { database.run(`ALTER TABLE sales_bdm_kpi ADD COLUMN ${col} REAL DEFAULT 0`); } catch { /* already exists */ }
  }

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

  // ── Business Central / Contracts ──

  database.run(`
    CREATE TABLE IF NOT EXISTS bc_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bc_id TEXT UNIQUE NOT NULL,
      number TEXT,
      display_name TEXT NOT NULL,
      email TEXT,
      phone_number TEXT,
      address TEXT,
      city TEXT,
      country TEXT,
      currency_code TEXT,
      balance REAL,
      blocked TEXT,
      last_synced TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bc_customer_id TEXT,
      customer_name TEXT NOT NULL,
      contract_number TEXT,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      start_date TEXT,
      end_date TEXT,
      value REAL,
      currency TEXT DEFAULT 'GBP',
      renewal_type TEXT,
      notes TEXT,
      bc_order_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Adobe Sign: contract templates with dynamic field schemas ──
  database.run(`
    CREATE TABLE IF NOT EXISTS contract_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      fields_schema TEXT,
      adobe_library_doc_id TEXT,
      file_data BLOB,
      file_name TEXT,
      file_mime TEXT,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Adobe Sign: agreement tracking ──
  database.run(`
    CREATE TABLE IF NOT EXISTS adobe_sign_agreements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agreement_id TEXT UNIQUE NOT NULL,
      contract_id INTEGER,
      template_id INTEGER,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'DRAFT',
      sender_email TEXT,
      signer_emails TEXT,
      filled_fields TEXT,
      created_via_nova INTEGER DEFAULT 0,
      adobe_created_date TEXT,
      adobe_expiration_date TEXT,
      signed_document_url TEXT,
      raw_data TEXT,
      synced_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

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
