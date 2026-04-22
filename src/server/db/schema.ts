import { initPool, closePool, execute } from '../services/database.js';

export async function initializeDatabase(): Promise<void> {
  await initPool();
  await runMigrations();
}

async function runMigrations(): Promise<void> {
  const migrations = [
    // ── Users table (migrated from file-based users.json) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'users') AND type = 'U')
     CREATE TABLE users (
       id INT IDENTITY(1,1) PRIMARY KEY,
       username NVARCHAR(100) NOT NULL,
       display_name NVARCHAR(200) NULL,
       email NVARCHAR(200) NULL,
       password_hash NVARCHAR(200) NOT NULL DEFAULT '',
       role NVARCHAR(100) NOT NULL DEFAULT 'viewer',
       auth_provider NVARCHAR(50) NOT NULL DEFAULT 'local',
       provider_id NVARCHAR(200) NULL,
       team_id INT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_users_username UNIQUE (username)
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'user_settings') AND type = 'U')
     CREATE TABLE user_settings (
       id INT IDENTITY(1,1) PRIMARY KEY,
       user_id INT NOT NULL,
       [key] NVARCHAR(100) NOT NULL,
       value NVARCHAR(MAX) NULL,
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_user_settings_user_key UNIQUE (user_id, [key])
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'teams') AND name = 'jira_project_key')
     ALTER TABLE teams ADD jira_project_key NVARCHAR(20) NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_llm_calls') AND type = 'U')
     CREATE TABLE agent_llm_calls (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_id NVARCHAR(100) NULL,
       call_type NVARCHAR(50) NOT NULL,
       provider NVARCHAR(20) NOT NULL,
       model NVARCHAR(60) NOT NULL,
       input_tokens INT NULL,
       output_tokens INT NULL,
       latency_ms INT NOT NULL,
       success BIT NOT NULL DEFAULT 1,
       error NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_decisions') AND type = 'U')
     CREATE TABLE agent_decisions (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_id NVARCHAR(100) NOT NULL,
       event_type NVARCHAR(50) NOT NULL,
       inputs NVARCHAR(MAX) NULL,
       reasoning NVARCHAR(MAX) NULL,
       output NVARCHAR(MAX) NULL,
       action NVARCHAR(50) NOT NULL,
       confidence FLOAT NULL,
       provider NVARCHAR(20) NULL,
       model NVARCHAR(60) NULL,
       approval_required BIT NOT NULL DEFAULT 0,
       approval_status NVARCHAR(20) NULL,
       outcome NVARCHAR(MAX) NULL,
       latency_ms INT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       resolved_at DATETIME2 NULL
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND type = 'U')
     CREATE TABLE agent_ticket_state (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_id NVARCHAR(100) NOT NULL,
       conversation_state NVARCHAR(MAX) NOT NULL,
       last_event_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_agent_ticket_state_ticket UNIQUE (ticket_id)
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_customer_memory') AND type = 'U')
     CREATE TABLE agent_customer_memory (
       id INT IDENTITY(1,1) PRIMARY KEY,
       account_id NVARCHAR(100) NOT NULL,
       patterns NVARCHAR(MAX) NOT NULL,
       last_updated DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_agent_customer_memory_account UNIQUE (account_id)
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_decisions') AND name = 'shadow_mode')
     ALTER TABLE agent_decisions ADD shadow_mode BIT NOT NULL DEFAULT 0;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_config') AND type = 'U')
     CREATE TABLE agent_config (
       id INT IDENTITY(1,1) PRIMARY KEY,
       config_key NVARCHAR(100) NOT NULL,
       config_value NVARCHAR(MAX) NOT NULL,
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_agent_config_key UNIQUE (config_key)
     );`,

    // WP-09: Autonomy engine — per-category allow-list
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_autonomy') AND type = 'U')
     CREATE TABLE agent_autonomy (
       id INT IDENTITY(1,1) PRIMARY KEY,
       category NVARCHAR(200) NOT NULL,
       sub_category NVARCHAR(200) NULL,
       enabled BIT NOT NULL DEFAULT 0,
       min_confidence DECIMAL(3,2) NOT NULL DEFAULT 0.90,
       min_accept_rate DECIMAL(5,2) NOT NULL DEFAULT 90.0,
       min_qa_score DECIMAL(3,1) NOT NULL DEFAULT 4.0,
       min_decisions INT NOT NULL DEFAULT 50,
       autonomous_actions NVARCHAR(MAX) NOT NULL DEFAULT '["draft_response"]',
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_by NVARCHAR(100) NULL,
       CONSTRAINT UQ_agent_autonomy_category UNIQUE (category, sub_category)
     );`,

    // WP-09: Alert log
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_alerts') AND type = 'U')
     CREATE TABLE agent_alerts (
       id INT IDENTITY(1,1) PRIMARY KEY,
       alert_type NVARCHAR(50) NOT NULL,
       severity NVARCHAR(20) NOT NULL DEFAULT 'warning',
       title NVARCHAR(500) NOT NULL,
       detail NVARCHAR(MAX) NULL,
       ticket_key NVARCHAR(100) NULL,
       acknowledged BIT NOT NULL DEFAULT 0,
       acknowledged_by NVARCHAR(100) NULL,
       acknowledged_at DATETIME2 NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    // WP-09: Queue snapshots for volume spike detection
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_queue_snapshots') AND type = 'U')
     CREATE TABLE agent_queue_snapshots (
       id INT IDENTITY(1,1) PRIMARY KEY,
       snapshot_hour INT NOT NULL,
       snapshot_dow INT NOT NULL,
       total_open INT NOT NULL,
       total_created INT NOT NULL DEFAULT 0,
       sla_at_risk INT NOT NULL DEFAULT 0,
       unassigned INT NOT NULL DEFAULT 0,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_alerts_type_created')
     CREATE INDEX IX_agent_alerts_type_created ON agent_alerts (alert_type, created_at DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_queue_snapshots_hour_dow')
     CREATE INDEX IX_agent_queue_snapshots_hour_dow ON agent_queue_snapshots (snapshot_hour, snapshot_dow);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_autonomy_category')
     CREATE INDEX IX_agent_autonomy_category ON agent_autonomy (category);`,

    // KB gap log — passive gap tracking from triage
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kb_gap_log') AND type = 'U')
     CREATE TABLE kb_gap_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_id NVARCHAR(20) NOT NULL,
       category NVARCHAR(100) NULL,
       suggested_title NVARCHAR(500) NULL,
       reason NVARCHAR(1000) NULL,
       status NVARCHAR(50) NOT NULL DEFAULT 'open',
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       resolved_at DATETIME2 NULL
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kb_gap_log_status')
     CREATE INDEX IX_kb_gap_log_status ON kb_gap_log (status, created_at DESC);`,

    // WP-14: Coaching engine — per-ticket QA scoring and nudges
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_coaching') AND type = 'U')
     CREATE TABLE agent_coaching (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_id NVARCHAR(20) NOT NULL,
       agent_user_id INT NOT NULL,
       nudge_type NVARCHAR(50) NULL,
       golden_rule_scores NVARCHAR(MAX) NULL,
       message NVARCHAR(MAX) NULL,
       delivered BIT NOT NULL DEFAULT 0,
       delivery_method NVARCHAR(20) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_coaching_agent')
     CREATE INDEX IX_agent_coaching_agent ON agent_coaching (agent_user_id, created_at DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_coaching_ticket')
     CREATE INDEX IX_agent_coaching_ticket ON agent_coaching (ticket_id, created_at DESC);`,

    // WP-14: Decision scoring — per-decision quality signals
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_decision_scores') AND type = 'U')
     CREATE TABLE agent_decision_scores (
       id INT IDENTITY(1,1) PRIMARY KEY,
       decision_id INT NOT NULL,
       signal_type NVARCHAR(50) NOT NULL,
       signal_value NVARCHAR(200) NULL,
       scored_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_decision_scores_decision')
     CREATE INDEX IX_agent_decision_scores_decision ON agent_decision_scores (decision_id);`,

    // WP-19: Agent roster — who's in each assignment pool
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_roster') AND type = 'U')
     CREATE TABLE agent_roster (
       id INT IDENTITY(1,1) PRIMARY KEY,
       jira_account_id NVARCHAR(200) NOT NULL,
       display_name NVARCHAR(200) NOT NULL,
       email NVARCHAR(200) NULL,
       pool NVARCHAR(50) NOT NULL DEFAULT 'cc',
       skills NVARCHAR(MAX) NULL,
       max_capacity INT NOT NULL DEFAULT 15,
       active BIT NOT NULL DEFAULT 1,
       is_current_agent BIT NOT NULL DEFAULT 0,
       last_assigned_at DATETIME2 NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_roster_pool_active')
     CREATE INDEX IX_agent_roster_pool_active ON agent_roster (pool, active) INCLUDE (jira_account_id, display_name, max_capacity, last_assigned_at);`,

    // WP-19: Assignment log — every assignment decision
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_assignment_log') AND type = 'U')
     CREATE TABLE agent_assignment_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key NVARCHAR(20) NOT NULL,
       pool NVARCHAR(50) NOT NULL,
       assigned_to NVARCHAR(200) NOT NULL,
       reason NVARCHAR(500) NULL,
       open_ticket_count INT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    // WP-19: Agent availability — daily availability snapshots
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_availability') AND type = 'U')
     CREATE TABLE agent_availability (
       id INT IDENTITY(1,1) PRIMARY KEY,
       roster_id INT NOT NULL,
       available_date DATE NOT NULL,
       status NVARCHAR(30) NOT NULL DEFAULT 'available',
       reason NVARCHAR(200) NULL,
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_agent_availability_roster_date UNIQUE (roster_id, available_date)
     );`,

    // WP-18: Ticket classification results
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ticket_classifications') AND type = 'U')
     CREATE TABLE ticket_classifications (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key NVARCHAR(20) NOT NULL,
       classification_type NVARCHAR(30) NOT NULL DEFAULT 'resolved',
       category NVARCHAR(200) NULL,
       sub_category NVARCHAR(200) NULL,
       software_area NVARCHAR(200) NULL,
       problem_type NVARCHAR(200) NULL,
       root_cause NVARCHAR(500) NULL,
       confidence FLOAT NULL,
       provider NVARCHAR(20) NULL,
       model NVARCHAR(60) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ticket_classifications_key')
     CREATE INDEX IX_ticket_classifications_key ON ticket_classifications (ticket_key, classification_type);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ticket_classifications_category')
     CREATE INDEX IX_ticket_classifications_category ON ticket_classifications (category, created_at DESC);`,

    // WP-18: Trend analysis snapshots
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ticket_trend_snapshots') AND type = 'U')
     CREATE TABLE ticket_trend_snapshots (
       id INT IDENTITY(1,1) PRIMARY KEY,
       snapshot_date DATE NOT NULL,
       category NVARCHAR(200) NOT NULL,
       ticket_count INT NOT NULL DEFAULT 0,
       avg_resolution_hours FLOAT NULL,
       escalation_rate FLOAT NULL,
       reopen_rate FLOAT NULL,
       trend_direction NVARCHAR(20) NULL,
       narrative NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ticket_trend_snapshots_date')
     CREATE INDEX IX_ticket_trend_snapshots_date ON ticket_trend_snapshots (snapshot_date DESC, category);`,

    // WP-13: Escalation reasons config
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'escalation_reasons') AND type = 'U')
     CREATE TABLE escalation_reasons (
       id INT IDENTITY(1,1) PRIMARY KEY,
       reason_code NVARCHAR(50) NOT NULL,
       label NVARCHAR(200) NOT NULL,
       requires_troubleshooting BIT NOT NULL DEFAULT 1,
       troubleshooting_checklist NVARCHAR(MAX) NULL,
       sort_order INT NOT NULL DEFAULT 0,
       active BIT NOT NULL DEFAULT 1
     );`,

    // WP-13: Seed escalation reasons (SOP-002 aligned)
    `IF NOT EXISTS (SELECT 1 FROM escalation_reasons WHERE reason_code = 'complexity')
     INSERT INTO escalation_reasons (reason_code, label, requires_troubleshooting, troubleshooting_checklist, sort_order) VALUES
       ('complexity', 'Technical complexity beyond T1 scope', 1, '["Reproduced the issue","Checked KB for known solutions","Gathered logs/screenshots","Identified affected component"]', 1),
       ('access', 'Requires elevated access or permissions', 1, '["Confirmed the access requirement","Verified current permission level","Documented what access is needed"]', 2),
       ('third_party', 'Third-party integration issue', 1, '["Identified the third-party system","Checked integration status page","Gathered error logs from both sides"]', 3),
       ('data_issue', 'Data correction or database change required', 1, '["Identified the data discrepancy","Documented expected vs actual values","Confirmed scope of affected records"]', 4),
       ('recurring', 'Recurring issue requiring root cause analysis', 1, '["Linked previous related tickets","Documented pattern/frequency","Noted any recent changes"]', 5),
       ('customer_request', 'Customer specifically requested escalation', 0, NULL, 6),
       ('sla_risk', 'SLA at risk — needs specialist attention', 0, NULL, 7),
       ('security', 'Security or compliance concern', 0, '["Documented the security concern","Assessed data exposure risk"]', 8);`,

    // WP-12: People HR Calendar Sync
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_team_calendar') AND type = 'U')
     CREATE TABLE agent_team_calendar (
       id INT IDENTITY(1,1) PRIMARY KEY,
       employee_name NVARCHAR(200) NOT NULL,
       employee_email NVARCHAR(200) NULL,
       team NVARCHAR(100) NULL,
       absence_type VARCHAR(50) NOT NULL,
       start_date DATE NOT NULL,
       end_date DATE NOT NULL,
       is_half_day BIT DEFAULT 0,
       half_day_period VARCHAR(10) NULL,
       synced_at DATETIME2 DEFAULT GETUTCDATE(),
       source_id VARCHAR(100) NULL
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_calendar_source' AND object_id = OBJECT_ID(N'agent_team_calendar'))
     CREATE UNIQUE INDEX idx_calendar_source ON agent_team_calendar(source_id) WHERE source_id IS NOT NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_calendar_dates' AND object_id = OBJECT_ID(N'agent_team_calendar'))
     CREATE INDEX idx_calendar_dates ON agent_team_calendar(start_date, end_date);`,

    // WP-22: Operational workflow tables
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'product_cancellation_log') AND type = 'U')
     CREATE TABLE product_cancellation_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       d365_account_id NVARCHAR(100) NOT NULL,
       account_name NVARCHAR(200) NULL,
       product_name NVARCHAR(200) NULL,
       jira_key NVARCHAR(20) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'abuse_reports') AND type = 'U')
     CREATE TABLE abuse_reports (
       id INT IDENTITY(1,1) PRIMARY KEY,
       reporter_email NVARCHAR(200) NOT NULL,
       reporter_name NVARCHAR(200) NOT NULL,
       account_name NVARCHAR(200) NULL,
       category NVARCHAR(100) NOT NULL,
       description NVARCHAR(MAX) NOT NULL,
       evidence_urls NVARCHAR(MAX) NULL,
       severity VARCHAR(20) NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'open',
       jira_key NVARCHAR(20) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'call_reviews') AND type = 'U')
     CREATE TABLE call_reviews (
       id INT IDENTITY(1,1) PRIMARY KEY,
       agent_name NVARCHAR(200) NOT NULL,
       customer_name NVARCHAR(200) NULL,
       ticket_key NVARCHAR(20) NULL,
       transcript NVARCHAR(MAX) NULL,
       summary NVARCHAR(MAX) NULL,
       sentiment VARCHAR(20) NULL,
       satisfaction_score INT NULL,
       performance_score INT NULL,
       concerns NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_llm_calls') AND name = 'estimated_cost')
     ALTER TABLE agent_llm_calls ADD estimated_cost DECIMAL(10,6) NULL;`,
  ];
  for (const sql of migrations) {
    try { await execute(sql); } catch (e) { console.warn('[schema] Migration warning:', e); }
  }
}

export async function shutdownDatabase(): Promise<void> {
  await closePool();
}

export function saveDb(): void {
  // No-op: MSSQL writes are immediately durable.
}

export function createBackup(): string | null {
  // No-op: MSSQL handles its own backups.
  return null;
}
