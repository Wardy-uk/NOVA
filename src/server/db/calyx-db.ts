import path from 'path';
import { fileURLToPath } from 'url';
import { addBusinessMinutes, toSqliteDatetime } from '../utils/business-hours.js';

// better-sqlite3 is optional — Calyx features degrade gracefully without it
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseConstructor: any = null;
try {
  DatabaseConstructor = (await import('better-sqlite3')).default;
} catch {
  console.warn('[Calyx] better-sqlite3 not available — Calyx features disabled');
}

type DatabaseType = any;

// ── Audit Log Helper ──

export interface AuditEntry {
  entityType: string;
  entityId: number | null;
  action: string;
  actorType: 'agent' | 'requester' | 'system';
  actorId: number | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
  ipAddress?: string;
}

export function auditLog(db: DatabaseType, entry: AuditEntry): void {
  try {
    db.prepare(`
      INSERT INTO calyx_audit_log
        (entity_type, entity_id, action, actor_type, actor_id, changes_json, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      entry.entityType,
      entry.entityId ?? null,
      entry.action,
      entry.actorType,
      entry.actorId ?? null,
      entry.changes ? JSON.stringify(entry.changes) : null,
      entry.ipAddress ?? null
    );
  } catch (err) {
    console.error('[Calyx Audit] Failed to write audit log:', err);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: DatabaseType | null = null;

export function getCalyxDb(): DatabaseType | null {
  if (db) return db;
  if (!DatabaseConstructor) return null;

  const dbPath = process.env.CALYX_DB_PATH ?? path.join(process.cwd(), 'calyx.db');
  db = new DatabaseConstructor(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function initializeCalyxSchema(database: DatabaseType): void {
  // ── Migrate old unprefixed tables to calyx_ prefix ──
  const oldTables = ['teams', 'categories', 'agents', 'sla_policies', 'tickets', 'ticket_events', 'ticket_comments'];
  for (const t of oldTables) {
    try { database.exec(`ALTER TABLE "${t}" RENAME TO "calyx_${t}"`); } catch { /* already renamed or doesn't exist */ }
  }
  // Rename old indexes that referenced unprefixed tables
  const oldIndexes = [
    ['idx_tickets_team', 'idx_calyx_tickets_team'],
    ['idx_tickets_status', 'idx_calyx_tickets_status'],
    ['idx_tickets_priority', 'idx_calyx_tickets_priority'],
    ['idx_tickets_assigned', 'idx_calyx_tickets_assigned'],
    ['idx_ticket_events_ticket', 'idx_calyx_ticket_events_ticket'],
    ['idx_ticket_comments_ticket', 'idx_calyx_ticket_comments_ticket'],
    ['idx_categories_team', 'idx_calyx_categories_team'],
    ['idx_categories_parent', 'idx_calyx_categories_parent'],
  ];
  for (const [oldName] of oldIndexes) {
    try { database.exec(`DROP INDEX IF EXISTS "${oldName}"`); } catch { /* ignore */ }
  }

  // ── Core tables (originally created without prefix) ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS calyx_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES calyx_teams(id),
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES calyx_categories(id),
      level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      team_id INTEGER NOT NULL REFERENCES calyx_teams(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_sla_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      team_id INTEGER REFERENCES calyx_teams(id),
      category_id INTEGER REFERENCES calyx_categories(id),
      priority TEXT NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
      frt_minutes INTEGER NOT NULL,
      resolution_minutes INTEGER NOT NULL,
      business_hours_only INTEGER NOT NULL DEFAULT 1,
      pause_on_waiting INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      team_id INTEGER NOT NULL REFERENCES calyx_teams(id),
      category_id INTEGER REFERENCES calyx_categories(id),
      subcategory_id INTEGER REFERENCES calyx_categories(id),
      item_id INTEGER REFERENCES calyx_categories(id),
      priority TEXT NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'waiting_third_party', 'resolved', 'closed')),
      assigned_agent_id INTEGER REFERENCES calyx_agents(id),
      requester_name TEXT NOT NULL,
      requester_email TEXT NOT NULL,
      sla_policy_id INTEGER REFERENCES calyx_sla_policies(id),
      frt_due_at TEXT,
      resolution_due_at TEXT,
      frt_met_at TEXT,
      resolved_at TEXT,
      first_replied_at TEXT,
      sla_paused_at TEXT,
      sla_pause_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_ticket_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id),
      event_type TEXT NOT NULL,
      from_value TEXT,
      to_value TEXT,
      agent_id INTEGER REFERENCES calyx_agents(id),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_ticket_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id),
      agent_id INTEGER REFERENCES calyx_agents(id),
      body TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_calyx_tickets_team ON calyx_tickets(team_id);
    CREATE INDEX IF NOT EXISTS idx_calyx_tickets_status ON calyx_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_calyx_tickets_priority ON calyx_tickets(priority);
    CREATE INDEX IF NOT EXISTS idx_calyx_tickets_assigned ON calyx_tickets(assigned_agent_id);
    CREATE INDEX IF NOT EXISTS idx_calyx_ticket_events_ticket ON calyx_ticket_events(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_calyx_ticket_comments_ticket ON calyx_ticket_comments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_calyx_categories_team ON calyx_categories(team_id);
    CREATE INDEX IF NOT EXISTS idx_calyx_categories_parent ON calyx_categories(parent_id);
  `);

  // ── Phase 1: New tables ──

  database.exec(`
    CREATE TABLE IF NOT EXISTS calyx_organisations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      sla_policy_id INTEGER REFERENCES calyx_sla_policies(id),
      contact_name TEXT,
      contact_email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_requesters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organisation_id INTEGER REFERENCES calyx_organisations(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      portal_token TEXT,
      portal_token_expires_at TEXT,
      portal_jwt_issued_at TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calyx_requesters_email ON calyx_requesters(email);
    CREATE INDEX IF NOT EXISTS idx_calyx_requesters_token ON calyx_requesters(portal_token);

    CREATE TABLE IF NOT EXISTS calyx_business_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Europe/London',
      mon_start TEXT, mon_end TEXT, mon_enabled INTEGER DEFAULT 1,
      tue_start TEXT, tue_end TEXT, tue_enabled INTEGER DEFAULT 1,
      wed_start TEXT, wed_end TEXT, wed_enabled INTEGER DEFAULT 1,
      thu_start TEXT, thu_end TEXT, thu_enabled INTEGER DEFAULT 1,
      fri_start TEXT, fri_end TEXT, fri_enabled INTEGER DEFAULT 1,
      sat_start TEXT, sat_end TEXT, sat_enabled INTEGER DEFAULT 0,
      sun_start TEXT, sun_end TEXT, sun_enabled INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_business_hours_holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_hours_id INTEGER NOT NULL REFERENCES calyx_business_hours(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_slos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      metric_type TEXT NOT NULL CHECK(metric_type IN (
        'escalation_to_t2','escalation_to_t3','escalation_to_dev',
        'time_to_assign','time_to_first_update','time_to_close','custom'
      )),
      target_minutes INTEGER NOT NULL,
      warning_threshold_pct INTEGER NOT NULL DEFAULT 80,
      applies_to_team_id INTEGER REFERENCES calyx_teams(id),
      applies_to_priority TEXT CHECK(applies_to_priority IN ('P1','P2','P3','P4')),
      applies_to_category_id INTEGER REFERENCES calyx_categories(id),
      business_hours_only INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_ticket_slo_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id) ON DELETE CASCADE,
      slo_id INTEGER NOT NULL REFERENCES calyx_slos(id),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      target_at TEXT NOT NULL,
      warning_at TEXT NOT NULL,
      paused_at TEXT,
      pause_minutes_accumulated INTEGER NOT NULL DEFAULT 0,
      breached INTEGER NOT NULL DEFAULT 0,
      breach_minutes INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calyx_slo_tracking_ticket ON calyx_ticket_slo_tracking(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_calyx_slo_tracking_breached ON calyx_ticket_slo_tracking(breached, completed_at);

    CREATE TABLE IF NOT EXISTS calyx_problems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'identified' CHECK(status IN (
        'identified','in_analysis','known_error','resolved','closed'
      )),
      root_cause TEXT,
      workaround TEXT,
      assigned_agent_id INTEGER REFERENCES calyx_agents(id),
      created_by_agent_id INTEGER NOT NULL REFERENCES calyx_agents(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS calyx_problem_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES calyx_problems(id) ON DELETE CASCADE,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(problem_id, ticket_id)
    );

    CREATE TABLE IF NOT EXISTS calyx_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'normal' CHECK(type IN ('standard','normal','emergency')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
        'draft','submitted','approved','rejected','implementing','complete','cancelled'
      )),
      risk_level TEXT NOT NULL DEFAULT 'low' CHECK(risk_level IN ('low','medium','high','critical')),
      impact_assessment TEXT,
      rollback_plan TEXT,
      requested_by_agent_id INTEGER NOT NULL REFERENCES calyx_agents(id),
      approved_by_agent_id INTEGER REFERENCES calyx_agents(id),
      rejection_reason TEXT,
      scheduled_start_at TEXT,
      scheduled_end_at TEXT,
      actual_start_at TEXT,
      actual_end_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_change_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_id INTEGER NOT NULL REFERENCES calyx_changes(id) ON DELETE CASCADE,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL DEFAULT 'related' CHECK(relationship IN (
        'triggered_by','affected_by','resolved_by','related'
      )),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_kb_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL,
      category_id INTEGER REFERENCES calyx_categories(id),
      team_id INTEGER REFERENCES calyx_teams(id),
      author_agent_id INTEGER NOT NULL REFERENCES calyx_agents(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
      view_count INTEGER NOT NULL DEFAULT 0,
      helpful_count INTEGER NOT NULL DEFAULT 0,
      not_helpful_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calyx_kb_status ON calyx_kb_articles(status);

    CREATE TABLE IF NOT EXISTS calyx_canned_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      team_id INTEGER REFERENCES calyx_teams(id),
      category_id INTEGER REFERENCES calyx_categories(id),
      author_agent_id INTEGER NOT NULL REFERENCES calyx_agents(id),
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_ticket_watchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES calyx_agents(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ticket_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS calyx_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      colour TEXT NOT NULL DEFAULT '#5ec1ca',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_ticket_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES calyx_tags(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ticket_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS calyx_ticket_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id) ON DELETE CASCADE,
      linked_ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL CHECK(link_type IN (
        'related','blocks','blocked_by','duplicate_of','merged_into'
      )),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_csat_surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id),
      requester_id INTEGER REFERENCES calyx_requesters(id),
      survey_token TEXT NOT NULL UNIQUE,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      csat_score INTEGER CHECK(csat_score BETWEEN 1 AND 5),
      xla_score INTEGER CHECK(xla_score BETWEEN 1 AND 5),
      effort_score INTEGER CHECK(effort_score BETWEEN 1 AND 5),
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calyx_csat_token ON calyx_csat_surveys(survey_token);

    CREATE TABLE IF NOT EXISTS calyx_major_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES calyx_tickets(id),
      declared_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      incident_commander_agent_id INTEGER REFERENCES calyx_agents(id),
      impact_statement TEXT NOT NULL,
      stakeholder_comms TEXT NOT NULL DEFAULT '[]',
      post_incident_review TEXT,
      pir_completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_email_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER REFERENCES calyx_tickets(id),
      recipient_email TEXT NOT NULL,
      event_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calyx_email_pending ON calyx_email_queue(status, created_at);

    CREATE TABLE IF NOT EXISTS calyx_service_catalogue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      team_id INTEGER REFERENCES calyx_teams(id),
      category_id INTEGER REFERENCES calyx_categories(id),
      sla_policy_id INTEGER REFERENCES calyx_sla_policies(id),
      slo_ids TEXT NOT NULL DEFAULT '[]',
      request_form_schema TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      contact_name TEXT,
      contact_email TEXT,
      sla_description TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_improvements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN (
        'problem','pir','csat','manual','audit'
      )),
      source_id INTEGER,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN (
        'proposed','approved','in_progress','complete','rejected'
      )),
      owner_agent_id INTEGER REFERENCES calyx_agents(id),
      due_date TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calyx_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('agent','requester','system')),
      actor_id INTEGER,
      changes_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calyx_audit_entity ON calyx_audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_calyx_audit_created ON calyx_audit_log(created_at);
  `);

  // ── ALTER TABLE migrations for existing tables (try/catch = idempotent) ──
  const ticketAlters = [
    'ALTER TABLE calyx_tickets ADD COLUMN requester_id INTEGER REFERENCES calyx_requesters(id)',
    'ALTER TABLE calyx_tickets ADD COLUMN organisation_id INTEGER REFERENCES calyx_organisations(id)',
    'ALTER TABLE calyx_tickets ADD COLUMN major_incident_id INTEGER REFERENCES calyx_major_incidents(id)',
    'ALTER TABLE calyx_tickets ADD COLUMN asset_id TEXT',
    'ALTER TABLE calyx_tickets ADD COLUMN supplier_id INTEGER REFERENCES calyx_suppliers(id)',
    "ALTER TABLE calyx_tickets ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
    'ALTER TABLE calyx_tickets ADD COLUMN merged_into_id INTEGER REFERENCES calyx_tickets(id)',
    'ALTER TABLE calyx_sla_policies ADD COLUMN business_hours_id INTEGER REFERENCES calyx_business_hours(id)',
    'ALTER TABLE calyx_ticket_slo_tracking ADD COLUMN warning_sent INTEGER NOT NULL DEFAULT 0',
  ];
  for (const sql of ticketAlters) {
    try { database.exec(sql); } catch { /* column already exists */ }
  }
}

export function seedCalyxData(database: DatabaseType): void {
  const hasTeams = database.prepare('SELECT COUNT(*) as c FROM calyx_teams').get() as { c: number };
  if (hasTeams.c > 0) return;

  const insertTeam = database.prepare('INSERT INTO calyx_teams (name, slug) VALUES (?, ?)');
  const insertCategory = database.prepare('INSERT INTO calyx_categories (team_id, name, parent_id, level) VALUES (?, ?, ?, ?)');
  const insertAgent = database.prepare('INSERT INTO calyx_agents (name, email, team_id) VALUES (?, ?, ?)');
  const insertSla = database.prepare('INSERT INTO calyx_sla_policies (name, team_id, priority, frt_minutes, resolution_minutes, business_hours_only, pause_on_waiting, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertTicket = database.prepare(`
    INSERT INTO calyx_tickets (reference, title, description, team_id, category_id, priority, status, assigned_agent_id, requester_name, requester_email, sla_policy_id, frt_due_at, resolution_due_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const insertEvent = database.prepare('INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, note) VALUES (?, ?, ?, ?)');

  database.transaction(() => {
    // Teams
    insertTeam.run('Customer Care', 'cc');
    insertTeam.run('Technical Support', 't2');
    insertTeam.run('Digital Design', 'dd');

    // CC categories (team_id=1)
    insertCategory.run(1, 'Billing', null, 1);        // id=1
    insertCategory.run(1, 'Onboarding', null, 1);     // id=2
    insertCategory.run(1, 'General Enquiry', null, 1); // id=3
    insertCategory.run(1, 'Complaint', null, 1);       // id=4

    // T2 categories (team_id=2)
    insertCategory.run(2, 'Bug Report', null, 1);         // id=5
    insertCategory.run(2, 'Integration Issue', null, 1);   // id=6
    insertCategory.run(2, 'Data Query', null, 1);          // id=7
    insertCategory.run(2, 'Access Request', null, 1);      // id=8

    // DD categories (team_id=3)
    insertCategory.run(3, 'Template Design', null, 1);     // id=9
    insertCategory.run(3, 'Brand Assets', null, 1);        // id=10

    // Sample subcategories for T2 > Bug Report
    insertCategory.run(2, 'UI Bug', 5, 2);                // id=11
    insertCategory.run(2, 'API Bug', 5, 2);               // id=12
    insertCategory.run(2, 'Data Bug', 5, 2);              // id=13

    // Agents
    insertAgent.run('Sarah Mitchell', 'sarah.mitchell@nurtur.tech', 1);   // id=1
    insertAgent.run('James Cooper', 'james.cooper@nurtur.tech', 1);       // id=2
    insertAgent.run('Nick Ward', 'nickw@nurtur.tech', 2);                 // id=3
    insertAgent.run('Alex Turner', 'alex.turner@nurtur.tech', 2);         // id=4
    insertAgent.run('Priya Sharma', 'priya.sharma@nurtur.tech', 3);      // id=5

    // SLA Policies (global defaults)
    insertSla.run('P1 - Critical', null, 'P1', 15, 120, 1, 1, 1);       // id=1
    insertSla.run('P2 - High', null, 'P2', 60, 480, 1, 1, 2);          // id=2
    insertSla.run('P3 - Medium', null, 'P3', 240, 2880, 1, 1, 3);      // id=3
    insertSla.run('P4 - Low', null, 'P4', 1440, 7200, 1, 1, 4);        // id=4

    // Sample tickets with realistic SLA deadlines
    const now = new Date();
    const nowStr = toSqliteDatetime(now);

    // CAL-001: P1 in_progress, created 10 min ago — FRT about to breach
    const t1Created = new Date(now.getTime() - 10 * 60000);
    const t1Frt = toSqliteDatetime(addBusinessMinutes(t1Created, 15));
    const t1Res = toSqliteDatetime(addBusinessMinutes(t1Created, 120));
    insertTicket.run('CAL-001', 'Portal login failing for Acme Corp', 'Users at Acme Corp are unable to log in since this morning. Getting 500 errors.', 2, 5, 'P1', 'in_progress', 3, 'John Smith', 'john@acmecorp.com', 1, t1Frt, t1Res);
    insertEvent.run(1, 'created', 'open', 'Ticket created');
    insertEvent.run(1, 'status_change', 'in_progress', 'Assigned to Nick Ward');

    // CAL-002: P3 waiting_customer, created 2 hours ago, SLA paused
    const t2Created = new Date(now.getTime() - 2 * 3600000);
    const t2Frt = toSqliteDatetime(addBusinessMinutes(t2Created, 240));
    const t2Res = toSqliteDatetime(addBusinessMinutes(t2Created, 2880));
    const t2PausedAt = toSqliteDatetime(new Date(now.getTime() - 30 * 60000));
    database.prepare(`
      INSERT INTO calyx_tickets (reference, title, description, team_id, category_id, priority, status, assigned_agent_id, requester_name, requester_email, sla_policy_id, frt_due_at, resolution_due_at, sla_paused_at, sla_pause_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('CAL-002', 'Invoice query for Q4 2025', 'Client requesting breakdown of Q4 2025 invoices for their accounting team.', 1, 1, 'P3', 'waiting_customer', 1, 'Emma Davis', 'emma@clientco.com', 3, t2Frt, t2Res, t2PausedAt, 'waiting_customer', toSqliteDatetime(t2Created), nowStr);
    insertEvent.run(2, 'created', 'open', 'Ticket created');
    insertEvent.run(2, 'status_change', 'waiting_customer', 'Awaiting invoice copies from finance');

    // CAL-003: P3 open, created 5 hours ago — FRT breached (4hr SLA)
    const t3Created = new Date(now.getTime() - 5 * 3600000);
    const t3Frt = toSqliteDatetime(addBusinessMinutes(t3Created, 240));
    const t3Res = toSqliteDatetime(addBusinessMinutes(t3Created, 2880));
    insertTicket.run('CAL-003', 'New email template for spring campaign', 'Need a responsive email template for the spring 2026 marketing campaign.', 3, 9, 'P3', 'open', 5, 'Marketing Team', 'marketing@nurtur.tech', 3, t3Frt, t3Res);
    insertEvent.run(3, 'created', 'open', 'Ticket created');

    // CAL-004: P2 in_progress, created 30 min ago — healthy SLA
    const t4Created = new Date(now.getTime() - 30 * 60000);
    const t4Frt = toSqliteDatetime(addBusinessMinutes(t4Created, 60));
    const t4Res = toSqliteDatetime(addBusinessMinutes(t4Created, 480));
    insertTicket.run('CAL-004', 'Zapier integration not syncing contacts', 'Contacts added via Zapier webhook are not appearing in the CRM. Started 2 days ago.', 2, 6, 'P2', 'in_progress', 4, 'Lisa Park', 'lisa@techstart.io', 2, t4Frt, t4Res);
    insertEvent.run(4, 'created', 'open', 'Ticket created');
    insertEvent.run(4, 'status_change', 'in_progress', 'Investigating webhook logs');

    // CAL-005: P4 resolved, FRT met, resolved
    const t5Created = new Date(now.getTime() - 48 * 3600000);
    const t5Frt = toSqliteDatetime(addBusinessMinutes(t5Created, 1440));
    const t5Res = toSqliteDatetime(addBusinessMinutes(t5Created, 7200));
    const t5FrtMet = toSqliteDatetime(new Date(t5Created.getTime() + 2 * 3600000));
    const t5Resolved = toSqliteDatetime(new Date(t5Created.getTime() + 24 * 3600000));
    database.prepare(`
      INSERT INTO calyx_tickets (reference, title, description, team_id, category_id, priority, status, assigned_agent_id, requester_name, requester_email, sla_policy_id, frt_due_at, resolution_due_at, frt_met_at, first_replied_at, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('CAL-005', 'New starter onboarding - Rachel Green', 'New CC agent starting Monday. Needs system access, training materials, and team introduction.', 1, 2, 'P4', 'resolved', 2, 'HR Department', 'hr@nurtur.tech', 4, t5Frt, t5Res, t5FrtMet, t5FrtMet, t5Resolved, toSqliteDatetime(t5Created), nowStr);
    insertEvent.run(5, 'created', 'open', 'Ticket created');
    insertEvent.run(5, 'status_change', 'in_progress', 'Setting up accounts');
    insertEvent.run(5, 'status_change', 'resolved', 'All access granted and training scheduled');

    // ── Phase 1 seed data: Business Hours ──
    database.prepare(`
      INSERT OR IGNORE INTO calyx_business_hours (id, name, timezone,
        mon_start, mon_end, mon_enabled, tue_start, tue_end, tue_enabled,
        wed_start, wed_end, wed_enabled, thu_start, thu_end, thu_enabled,
        fri_start, fri_end, fri_enabled, sat_enabled, sun_enabled)
      VALUES (1, 'Standard (UK)', 'Europe/London',
        '08:00','18:00',1, '08:00','18:00',1, '08:00','18:00',1,
        '08:00','18:00',1, '08:00','18:00',1, 0, 0)
    `).run();

    // ── Phase 1 seed data: SLOs ──
    const insertSlo = database.prepare(`
      INSERT OR IGNORE INTO calyx_slos (name, description, metric_type, target_minutes, warning_threshold_pct, applies_to_priority, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    insertSlo.run('Escalate to T2 (P1/P2)', 'P1/P2 tickets escalated to T2 within 4 hours if unresolved', 'escalation_to_t2', 240, 80, null);
    insertSlo.run('Assign ticket (P1)', 'P1 tickets assigned within 30 minutes', 'time_to_assign', 30, 75, 'P1');
    insertSlo.run('First update (P1/P2)', 'P1/P2 tickets updated within 1 hour', 'time_to_first_update', 60, 80, null);
    insertSlo.run('Escalate to T2 (P3)', 'P3 tickets escalated to T2 within 8 hours if unresolved', 'escalation_to_t2', 480, 80, 'P3');
    insertSlo.run('Close ticket', 'All tickets reach resolved/closed within SLA resolution target', 'time_to_close', 2880, 80, null);
  })();
}
