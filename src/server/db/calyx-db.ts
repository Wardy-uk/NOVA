import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { addBusinessMinutes, toSqliteDatetime } from '../utils/business-hours.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getCalyxDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.CALYX_DB_PATH ?? path.resolve(__dirname, '../../../calyx.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function initializeCalyxSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES categories(id),
      level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sla_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      team_id INTEGER REFERENCES teams(id),
      category_id INTEGER REFERENCES categories(id),
      priority TEXT NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
      frt_minutes INTEGER NOT NULL,
      resolution_minutes INTEGER NOT NULL,
      business_hours_only INTEGER NOT NULL DEFAULT 1,
      pause_on_waiting INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      team_id INTEGER NOT NULL REFERENCES teams(id),
      category_id INTEGER REFERENCES categories(id),
      subcategory_id INTEGER REFERENCES categories(id),
      item_id INTEGER REFERENCES categories(id),
      priority TEXT NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'waiting_third_party', 'resolved', 'closed')),
      assigned_agent_id INTEGER REFERENCES agents(id),
      requester_name TEXT NOT NULL,
      requester_email TEXT NOT NULL,
      sla_policy_id INTEGER REFERENCES sla_policies(id),
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

    CREATE TABLE IF NOT EXISTS ticket_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      event_type TEXT NOT NULL,
      from_value TEXT,
      to_value TEXT,
      agent_id INTEGER REFERENCES agents(id),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ticket_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      agent_id INTEGER REFERENCES agents(id),
      body TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_team ON tickets(team_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
    CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_agent_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_categories_team ON categories(team_id);
    CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
  `);
}

export function seedCalyxData(database: Database.Database): void {
  const hasTeams = database.prepare('SELECT COUNT(*) as c FROM teams').get() as { c: number };
  if (hasTeams.c > 0) return;

  const insertTeam = database.prepare('INSERT INTO teams (name, slug) VALUES (?, ?)');
  const insertCategory = database.prepare('INSERT INTO categories (team_id, name, parent_id, level) VALUES (?, ?, ?, ?)');
  const insertAgent = database.prepare('INSERT INTO agents (name, email, team_id) VALUES (?, ?, ?)');
  const insertSla = database.prepare('INSERT INTO sla_policies (name, team_id, priority, frt_minutes, resolution_minutes, business_hours_only, pause_on_waiting, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertTicket = database.prepare(`
    INSERT INTO tickets (reference, title, description, team_id, category_id, priority, status, assigned_agent_id, requester_name, requester_email, sla_policy_id, frt_due_at, resolution_due_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const insertEvent = database.prepare('INSERT INTO ticket_events (ticket_id, event_type, to_value, note) VALUES (?, ?, ?, ?)');

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
    // P1: 15min FRT, 2hr resolution | P2: 1hr FRT, 8hr resolution | P3: 4hr FRT, 48hr resolution | P4: 1 day FRT, 5 day resolution
    const now = new Date();
    const nowStr = toSqliteDatetime(now);

    // CAL-001: P1 in_progress, created 10 min ago — FRT about to breach
    const t1Created = new Date(now.getTime() - 10 * 60000);
    const t1Str = toSqliteDatetime(t1Created);
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
      INSERT INTO tickets (reference, title, description, team_id, category_id, priority, status, assigned_agent_id, requester_name, requester_email, sla_policy_id, frt_due_at, resolution_due_at, sla_paused_at, sla_pause_reason, created_at, updated_at)
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
      INSERT INTO tickets (reference, title, description, team_id, category_id, priority, status, assigned_agent_id, requester_name, requester_email, sla_policy_id, frt_due_at, resolution_due_at, frt_met_at, first_replied_at, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('CAL-005', 'New starter onboarding - Rachel Green', 'New CC agent starting Monday. Needs system access, training materials, and team introduction.', 1, 2, 'P4', 'resolved', 2, 'HR Department', 'hr@nurtur.tech', 4, t5Frt, t5Res, t5FrtMet, t5FrtMet, t5Resolved, toSqliteDatetime(t5Created), nowStr);
    insertEvent.run(5, 'created', 'open', 'Ticket created');
    insertEvent.run(5, 'status_change', 'in_progress', 'Setting up accounts');
    insertEvent.run(5, 'status_change', 'resolved', 'All access granted and training scheduled');
  })();
}
