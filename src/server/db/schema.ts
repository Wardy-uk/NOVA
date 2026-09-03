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
       role NVARCHAR(500) NOT NULL DEFAULT 'viewer',
       auth_provider NVARCHAR(50) NOT NULL DEFAULT 'local',
       provider_id NVARCHAR(200) NULL,
       team_id INT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_users_username UNIQUE (username)
     );`,

    `ALTER TABLE users ALTER COLUMN role NVARCHAR(500) NOT NULL;`,

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

    // Centralised error log — one place for errors across every subsystem, so
    // failures (especially business-critical ones) are visible/queryable instead
    // of scattered through stdout. Written via services/error-log.ts logError().
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'error_log') AND type = 'U')
     CREATE TABLE error_log (
       id BIGINT IDENTITY(1,1) PRIMARY KEY,
       occurred_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       source NVARCHAR(100) NOT NULL,
       severity NVARCHAR(20) NOT NULL DEFAULT 'error',
       message NVARCHAR(MAX) NOT NULL,
       stack NVARCHAR(MAX) NULL,
       context NVARCHAR(MAX) NULL,
       entity_ref NVARCHAR(200) NULL,
       resolved BIT NOT NULL DEFAULT 0,
       resolved_at DATETIME2 NULL
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_error_log_occurred')
     CREATE INDEX IX_error_log_occurred ON error_log (occurred_at DESC);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_error_log_source_sev')
     CREATE INDEX IX_error_log_source_sev ON error_log (source, severity, occurred_at DESC);`,

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
       conversation_state NVARCHAR(MAX) NOT NULL DEFAULT '{}',
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

    `IF COL_LENGTH('kb_gap_log', 'assigned_to') IS NULL
     ALTER TABLE kb_gap_log ADD assigned_to NVARCHAR(100) NULL;`,

    `IF COL_LENGTH('kb_gap_log', 'jira_ticket_key') IS NULL
     ALTER TABLE kb_gap_log ADD jira_ticket_key NVARCHAR(20) NULL;`,

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

    // Per-pool capacity columns (n8n parity: MaxTicketsCustomerCare, MaxTicketsT2T3)
    `IF COL_LENGTH('agent_roster', 'max_tickets_cc') IS NULL
     ALTER TABLE agent_roster ADD max_tickets_cc INT NULL;`,
    `IF COL_LENGTH('agent_roster', 'max_tickets_t2t3') IS NULL
     ALTER TABLE agent_roster ADD max_tickets_t2t3 INT NULL;`,

    // WP-19: Assignment state — round-robin state per agent (keyed by dbo.Agent.AgentId from KPI DB)
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_assignment_state') AND type = 'U')
     CREATE TABLE agent_assignment_state (
       agent_id INT NOT NULL PRIMARY KEY,
       is_current_agent BIT NOT NULL DEFAULT 0,
       last_assigned_at DATETIME2 NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

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

    // Business severity / blast-radius (LLM-assessed, one row per open ticket, cached)
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ticket_severity') AND type = 'U')
     CREATE TABLE ticket_severity (
       ticket_key NVARCHAR(20) NOT NULL PRIMARY KEY,
       severity NVARCHAR(10) NOT NULL DEFAULT 'low',
       impact_score INT NOT NULL DEFAULT 0,
       rationale NVARCHAR(500) NULL,
       content_hash NVARCHAR(16) NULL,
       model NVARCHAR(60) NULL,
       computed_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

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

    // ── Dev Review tables ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dev_review_state') AND type = 'U')
     CREATE TABLE dev_review_state (
       jira_key NVARCHAR(30) NOT NULL PRIMARY KEY,
       status NVARCHAR(30) NOT NULL DEFAULT 'pending',
       fast_track BIT NOT NULL DEFAULT 0,
       nova_priority NVARCHAR(10) NOT NULL DEFAULT 'normal',
       claimed_by_user_id INT NULL,
       claimed_at DATETIME2 NULL,
       submitted_by_username NVARCHAR(200) NULL,
       first_seen_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       last_action_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       accepted_at DATETIME2 NULL,
       returned_at DATETIME2 NULL,
       archived_at DATETIME2 NULL,
       team NVARCHAR(100) NULL
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dev_review_thread') AND type = 'U')
     CREATE TABLE dev_review_thread (
       id INT IDENTITY(1,1) PRIMARY KEY,
       jira_key NVARCHAR(30) NOT NULL,
       user_id INT NOT NULL,
       user_display NVARCHAR(200) NOT NULL,
       kind NVARCHAR(20) NOT NULL DEFAULT 'comment',
       body NVARCHAR(MAX) NULL,
       meta_json NVARCHAR(MAX) NULL,
       jira_sync_state NVARCHAR(10) NOT NULL DEFAULT 'pending',
       jira_sync_error NVARCHAR(MAX) NULL,
       jira_comment_id NVARCHAR(100) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dev_review_outbox') AND type = 'U')
     CREATE TABLE dev_review_outbox (
       id INT IDENTITY(1,1) PRIMARY KEY,
       jira_key NVARCHAR(30) NOT NULL,
       op NVARCHAR(20) NOT NULL,
       payload_json NVARCHAR(MAX) NOT NULL,
       attempts INT NOT NULL DEFAULT 0,
       status NVARCHAR(10) NOT NULL DEFAULT 'pending',
       last_error NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       processed_at DATETIME2 NULL
     );`,

    // ── User-Teams many-to-many ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'user_teams') AND type = 'U')
     CREATE TABLE user_teams (
       user_id INT NOT NULL,
       team_id INT NOT NULL,
       PRIMARY KEY (user_id, team_id)
     );`,

    // Migrate legacy team_id data into user_teams
    `INSERT INTO user_teams (user_id, team_id)
     SELECT id, team_id FROM users
     WHERE team_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM user_teams ut WHERE ut.user_id = users.id AND ut.team_id = users.team_id);`,

    // ── People / Agent Development Plans ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_development_plans') AND type = 'U')
     CREATE TABLE agent_development_plans (
       id INT IDENTITY(1,1) PRIMARY KEY,
       agent_name NVARCHAR(200) NOT NULL,
       plan_period NVARCHAR(100) NULL,
       role_title NVARCHAR(200) NULL,
       function_name NVARCHAR(200) NULL,
       role_clarity NVARCHAR(MAX) NULL,
       strengths NVARCHAR(MAX) NULL,
       important_context NVARCHAR(MAX) NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'active',
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_development_goals') AND type = 'U')
     CREATE TABLE agent_development_goals (
       id INT IDENTITY(1,1) PRIMARY KEY,
       plan_id INT NOT NULL,
       title NVARCHAR(500) NOT NULL,
       description NVARCHAR(MAX) NULL,
       measure_description NVARCHAR(MAX) NULL,
       metric_key NVARCHAR(100) NULL,
       metric_target FLOAT NULL,
       target_date NVARCHAR(20) NULL,
       status NVARCHAR(30) NOT NULL DEFAULT 'not_started',
       sort_order INT NOT NULL DEFAULT 0
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_training_items') AND type = 'U')
     CREATE TABLE agent_training_items (
       id INT IDENTITY(1,1) PRIMARY KEY,
       plan_id INT NOT NULL,
       title NVARCHAR(500) NOT NULL,
       description NVARCHAR(MAX) NULL,
       target_date NVARCHAR(20) NULL,
       completed BIT NOT NULL DEFAULT 0,
       completed_at DATETIME2 NULL,
       sort_order INT NOT NULL DEFAULT 0
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_121_snapshots') AND type = 'U')
     CREATE TABLE agent_121_snapshots (
       id INT IDENTITY(1,1) PRIMARY KEY,
       agent_name NVARCHAR(200) NOT NULL,
       snapshot_date NVARCHAR(20) NOT NULL,
       metrics_json NVARCHAR(MAX) NULL,
       goals_json NVARCHAR(MAX) NULL,
       prep_json NVARCHAR(MAX) NULL,
       transcript_md NVARCHAR(MAX) NULL,
       notes NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_121_actions') AND type = 'U')
     CREATE TABLE agent_121_actions (
       id INT IDENTITY(1,1) PRIMARY KEY,
       snapshot_id INT NULL,
       agent_name NVARCHAR(200) NOT NULL,
       description NVARCHAR(MAX) NOT NULL,
       owner NVARCHAR(200) NULL,
       due_date NVARCHAR(20) NULL,
       status NVARCHAR(30) NOT NULL DEFAULT 'open',
       completed_at DATETIME2 NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_dev_plans_agent')
     CREATE INDEX IX_agent_dev_plans_agent ON agent_development_plans (agent_name, status);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_dev_goals_plan')
     CREATE INDEX IX_agent_dev_goals_plan ON agent_development_goals (plan_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_training_plan')
     CREATE INDEX IX_agent_training_plan ON agent_training_items (plan_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_121_snapshots_agent')
     CREATE INDEX IX_agent_121_snapshots_agent ON agent_121_snapshots (agent_name, snapshot_date DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_121_actions_agent')
     CREATE INDEX IX_agent_121_actions_agent ON agent_121_actions (agent_name, status);`,

    `IF COL_LENGTH('agent_development_plans', 'manager_status') IS NULL
     ALTER TABLE agent_development_plans ADD manager_status NVARCHAR(50) NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_agent_goals_plan')
     ALTER TABLE agent_development_goals ADD CONSTRAINT FK_agent_goals_plan
       FOREIGN KEY (plan_id) REFERENCES agent_development_plans(id) ON DELETE CASCADE;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_agent_training_plan')
     ALTER TABLE agent_training_items ADD CONSTRAINT FK_agent_training_plan
       FOREIGN KEY (plan_id) REFERENCES agent_development_plans(id) ON DELETE CASCADE;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_agent_actions_snapshot')
     ALTER TABLE agent_121_actions ADD CONSTRAINT FK_agent_actions_snapshot
       FOREIGN KEY (snapshot_id) REFERENCES agent_121_snapshots(id) ON DELETE SET NULL;`,

    // ── 1-2-1 Closed Loop (sessions / scheduling) ──
    // Canonical agent key = agent_development_plans.agent_name (full display name).
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_121_sessions') AND type = 'U')
     CREATE TABLE agent_121_sessions (
       id INT IDENTITY(1,1) PRIMARY KEY,
       agent_name NVARCHAR(200) NOT NULL,
       scheduled_date NVARCHAR(20) NOT NULL,
       status NVARCHAR(30) NOT NULL DEFAULT 'scheduled',
       prep_snapshot_id INT NULL,
       agent_submission_json NVARCHAR(MAX) NULL,
       agent_submitted_at DATETIME2 NULL,
       outlook_event_id NVARCHAR(200) NULL,
       plaud_recording_id NVARCHAR(200) NULL,
       notes_text NVARCHAR(MAX) NULL,
       completed_at DATETIME2 NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_121_sessions_agent')
     CREATE INDEX IX_agent_121_sessions_agent ON agent_121_sessions (agent_name, scheduled_date DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_121_sessions_status')
     CREATE INDEX IX_agent_121_sessions_status ON agent_121_sessions (status, scheduled_date);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_agent_121_sessions_snapshot')
     ALTER TABLE agent_121_sessions ADD CONSTRAINT FK_agent_121_sessions_snapshot
       FOREIGN KEY (prep_snapshot_id) REFERENCES agent_121_snapshots(id) ON DELETE SET NULL;`,

    // Tie actions to a session cycle (in addition to the snapshot FK).
    `IF COL_LENGTH('agent_121_actions', 'session_id') IS NULL
     ALTER TABLE agent_121_actions ADD session_id INT NULL;`,

    // ── Transcript-claimed completions ──
    //
    // The Plaud transcript is the source of what a 1-2-1 agreed, including which actions
    // were closed. But a model hearing "yeah I got that done" must NOT be able to write
    // `delivered` on its own: that number feeds the delivery rate, and a mishearing would
    // inflate it while silently dropping a real commitment, with nothing to surface it.
    //
    // So the transcript writes status 'claimed', which sits OUTSIDE the delivery rate,
    // and stage 1 of the NEXT 1-2-1 asks Nick to confirm it with the person in the room.
    // Confirm → 'delivered'. Reject → back to 'carried_over'.
    `IF COL_LENGTH('agent_121_actions', 'claim_evidence') IS NULL
     ALTER TABLE agent_121_actions ADD claim_evidence NVARCHAR(1000) NULL;`,
    // Which session's transcript made the claim — so the question can be asked as
    // "closed per the 1-2-1 on <date>" rather than a bare assertion.
    `IF COL_LENGTH('agent_121_actions', 'claim_session_id') IS NULL
     ALTER TABLE agent_121_actions ADD claim_session_id INT NULL;`,
    `IF COL_LENGTH('agent_121_actions', 'claimed_at') IS NULL
     ALTER TABLE agent_121_actions ADD claimed_at DATETIME2 NULL;`,

    // When the session's transcript was read. Marks the sweep's work done so it does not
    // re-run an LLM call over every historic 1-2-1 every hour.
    `IF COL_LENGTH('agent_121_sessions', 'extracted_at') IS NULL
     ALTER TABLE agent_121_sessions ADD extracted_at DATETIME2 NULL;`,

    // The transcript itself, once approved. NOVA's own Plaud MCP connection has never
    // been authorised in prod, and NEURO already syncs every Plaud note into the vault
    // reliably — so the transcript arrives over the NEURO bridge instead, and is stored
    // here rather than re-fetched. Keyed on the same `plaud_id` the vault note carries,
    // so both systems still identify a recording the same way.
    `IF COL_LENGTH('agent_121_sessions', 'transcript_text') IS NULL
     ALTER TABLE agent_121_sessions ADD transcript_text NVARCHAR(MAX) NULL;`,

    // ── Transcript candidates: detected, NOT applied ──
    //
    // A transcript landing in the vault must never bind itself to a 1-2-1. Attribution is
    // a guess — Plaud names recordings by timestamp, and a three-hander mentions people
    // who were not the subject — so a wrong auto-bind writes one person's conversation
    // onto another person's permanent record, and the extractor would then close THEIR
    // actions from it. Detection is cheap and reversible; binding is neither. So NEURO
    // proposes, this table holds the proposal, and nothing touches a session until Nick
    // approves it.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_121_transcript_candidates') AND type = 'U')
     CREATE TABLE agent_121_transcript_candidates (
       id INT IDENTITY(1,1) PRIMARY KEY,
       plaud_id NVARCHAR(100) NOT NULL,
       agent_name NVARCHAR(200) NULL,
       meeting_date NVARCHAR(20) NULL,
       title NVARCHAR(500) NULL,
       note_path NVARCHAR(500) NULL,
       transcript_text NVARCHAR(MAX) NULL,
       -- How NEURO decided who this belongs to, shown to Nick so he can judge the
       -- proposal rather than take it on trust.
       attribution NVARCHAR(200) NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'pending',
       session_id INT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       resolved_at DATETIME2 NULL
     );`,
    // One row per recording, so a re-push of the same note updates rather than piles up.
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_121_transcript_candidate_plaud')
     CREATE UNIQUE INDEX UX_121_transcript_candidate_plaud ON agent_121_transcript_candidates (plaud_id);`,

    // What a human needs to judge the proposal. The first cut showed a title, a date and
    // "no transcript text", which is not enough to decide whether a recording belongs on
    // someone's permanent record — so approving it was a guess, which defeats the point
    // of asking. Plaud's own summary names the participants and says what was discussed.
    `IF COL_LENGTH('agent_121_transcript_candidates', 'participants') IS NULL
     ALTER TABLE agent_121_transcript_candidates ADD participants NVARCHAR(500) NULL;`,
    `IF COL_LENGTH('agent_121_transcript_candidates', 'duration_minutes') IS NULL
     ALTER TABLE agent_121_transcript_candidates ADD duration_minutes INT NULL;`,
    `IF COL_LENGTH('agent_121_transcript_candidates', 'summary_excerpt') IS NULL
     ALTER TABLE agent_121_transcript_candidates ADD summary_excerpt NVARCHAR(2000) NULL;`,
    // The TIME the recording started, not just its date. Nick runs several 1-2-1s on the
    // same day, so a date alone does not identify which conversation a card is — and the
    // whole point of the card is to decide exactly that.
    `IF COL_LENGTH('agent_121_transcript_candidates', 'started_at') IS NULL
     ALTER TABLE agent_121_transcript_candidates ADD started_at NVARCHAR(30) NULL;`,

    // Per-agent 1-2-1 cadence in days (default monthly). Override per agent in §B2.
    `IF COL_LENGTH('agent_development_plans', 'one21_cadence_days') IS NULL
     ALTER TABLE agent_development_plans ADD one21_cadence_days INT NULL;`,

    // Unguessable token for the agent's day-before prep submission form (Phase 2).
    `IF COL_LENGTH('agent_121_sessions', 'submit_token') IS NULL
     ALTER TABLE agent_121_sessions ADD submit_token NVARCHAR(64) NULL;`,

    // Idempotent email dedup (mirrors standup_email_log).
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_121_email_log') AND type = 'U')
     CREATE TABLE agent_121_email_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       session_id INT NULL,
       agent_name NVARCHAR(200) NOT NULL,
       kind NVARCHAR(40) NOT NULL,
       dedup_key NVARCHAR(100) NOT NULL,
       sent_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_agent_121_email_log_dedup')
     CREATE UNIQUE INDEX UX_agent_121_email_log_dedup ON agent_121_email_log (kind, dedup_key);`,

    // One-off repair: Sebastian Broome's 17 Jun 1-2-1 was sitting on Abdi Mohamed's record.
    //
    // The old Scan Plaud flow suggested an agent from the recording title and took the
    // answer, so recording 12c84bd6… was assigned to Abdi. The vault note is unambiguous —
    // `people:` and Plaud's own participant list are Nick Ward and Sebastian Broome, no
    // Abdi. Two consequences: Sebastian's last 1-2-1 read as 7 Apr and he showed as
    // overdue, and because an attached recording counts as resolved, NEURO would never
    // offer the transcript again. Deleting the row frees the recording, and the next sweep
    // re-offers it as a candidate for approval — with the transcript this time, so the
    // actions can actually be extracted.
    //
    // The session is spurious rather than a real 1-2-1 that got the wrong recording:
    // assignPlaudToAgent always INSERTs a fresh session dated to the recording, this row's
    // date matches the recording exactly, its id sits out of date order between Abdi's
    // 18 Jun and 7 May sessions, and Abdi has his own genuine 18 Jun session alongside it.
    //
    // Pinned to the exact row, so re-running matches nothing and a similar-looking session
    // elsewhere is untouched. The NOT EXISTS guard means that if anybody has written an
    // action against it since, the row stays and this becomes a no-op rather than orphaning
    // their work.
    `DELETE FROM agent_121_sessions
     WHERE plaud_recording_id = '12c84bd68b0937f3978814788fe200ae'
       AND agent_name = 'Abdi Mohamed'
       AND LEFT(scheduled_date, 10) = '2026-06-17'
       AND NOT EXISTS (
         SELECT 1 FROM agent_121_actions a
         WHERE a.session_id = agent_121_sessions.id OR a.claim_session_id = agent_121_sessions.id
       );`,

    // One-off repair: Stephen Mitchell's 2 Jul session, stranded by his 18 Aug recording.
    //
    // Approving a recording lands it on its own row, and until now nothing closed the
    // half-finished wizard session behind it. The overview reads STATUS off the oldest
    // OPEN session rather than the last held one, so his card read "Last 18 Aug" and
    // "Stalled — 2 Jul" at the same time. approveCandidate now clears stalled sessions as
    // it attaches; this catches the one that was already approved before that shipped.
    //
    // Pinned to the row: in_progress on that date with no recording of its own. A
    // `scheduled` session in the past is deliberately untouched — that is genuinely
    // overdue, which is a real thing to look at, not debris.
    `UPDATE agent_121_sessions
     SET status = 'abandoned'
     WHERE agent_name = 'Stephen Mitchell'
       AND LEFT(scheduled_date, 10) = '2026-07-02'
       AND status = 'in_progress'
       AND plaud_recording_id IS NULL;`,

    // One-off repair: put Naomi Wentworth's 18 Aug transcript back in the approval queue.
    //
    // It was rejected by mis-click while clearing the backfill batch, and a rejection is
    // permanent by design — NEURO reads the resolved list and never re-offers it, so the
    // transcript would have sat in the vault unreachable and Naomi would have stayed on
    // 30 Apr forever. There is no undo in the UI; this is it.
    //
    // Guarded on the recording id and on it still being rejected, so re-running after it
    // has been approved (or rejected again on purpose) does nothing.
    `UPDATE agent_121_transcript_candidates
     SET status = 'pending', resolved_at = NULL, session_id = NULL
     WHERE plaud_id = 'bb7426627d360b97ee343b8f1f6ab22e'
       AND status = 'rejected';`,

    // ── Jira Issue Cache ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'jira_issue_cache') AND type = 'U')
     CREATE TABLE jira_issue_cache (
       issue_key       NVARCHAR(30)  NOT NULL PRIMARY KEY,
       jira_id         NVARCHAR(20)  NOT NULL,
       project_key     NVARCHAR(10)  NOT NULL,
       summary         NVARCHAR(500) NULL,
       description_text NVARCHAR(MAX) NULL,
       description_adf NVARCHAR(MAX) NULL,
       status_name     NVARCHAR(100) NULL,
       status_category NVARCHAR(50)  NULL,
       priority_name   NVARCHAR(50)  NULL,
       issuetype_name  NVARCHAR(100) NULL,
       resolution_name NVARCHAR(100) NULL,
       assignee_account_id NVARCHAR(200) NULL,
       assignee_display    NVARCHAR(200) NULL,
       assignee_email      NVARCHAR(200) NULL,
       reporter_account_id NVARCHAR(200) NULL,
       reporter_display    NVARCHAR(200) NULL,
       reporter_email      NVARCHAR(200) NULL,
       jira_created    DATETIME2     NULL,
       jira_updated    DATETIME2     NULL,
       due_date        DATE          NULL,
       current_tier    NVARCHAR(100) NULL,
       nurtur_product  NVARCHAR(200) NULL,
       request_type    NVARCHAR(200) NULL,
       tldr_text       NVARCHAR(MAX) NULL,
       agent_summary_text   NVARCHAR(MAX) NULL,
       troubleshooting_text NVARCHAR(MAX) NULL,
       escalation_reason_text NVARCHAR(MAX) NULL,
       expected_outcome_text  NVARCHAR(MAX) NULL,
       issue_environment_text NVARCHAR(MAX) NULL,
       development_details_text NVARCHAR(MAX) NULL,
       resolution_type NVARCHAR(200) NULL,
       sla_breach_time DATETIME2     NULL,
       sla_breached    BIT           NOT NULL DEFAULT 0,
       labels          NVARCHAR(1000) NULL,
       issue_links_json NVARCHAR(MAX) NULL,
       fields_json     NVARCHAR(MAX) NULL,
       synced_at       DATETIME2     NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_project_status')
     CREATE INDEX IX_jira_cache_project_status ON jira_issue_cache (project_key, status_category)
       INCLUDE (issue_key, summary, assignee_display, priority_name, jira_updated);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_status_updated')
     CREATE INDEX IX_jira_cache_status_updated ON jira_issue_cache (status_category, jira_updated DESC)
       INCLUDE (issue_key, project_key, summary);`,

    // Covering variant of the index above, adding assignee_display. Any "resolved
    // in a window, grouped by agent" query (CSAT adoption is the live one) matched
    // IX_jira_cache_status_updated on the keys and then paid a key lookup PER ROW
    // into the clustered index — which is 395MB for 6,954 rows, because every row
    // carries fields_json + the ADF bodies. ~1,700 random lookups into that is more
    // I/O than the database has to give: measured 24 Aug 2026 with data IO pinned
    // at 100% on an S0, the adoption query did not finish in 120s.
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_status_updated_agent')
     CREATE INDEX IX_jira_cache_status_updated_agent ON jira_issue_cache (status_category, jira_updated DESC)
       INCLUDE (issue_key, assignee_display, summary, status_name);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_assignee')
     CREATE INDEX IX_jira_cache_assignee ON jira_issue_cache (assignee_email)
       INCLUDE (issue_key, summary, status_name, priority_name);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_reporter')
     CREATE INDEX IX_jira_cache_reporter ON jira_issue_cache (reporter_email)
       WHERE reporter_email IS NOT NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_tier')
     CREATE INDEX IX_jira_cache_tier ON jira_issue_cache (current_tier)
       INCLUDE (issue_key, summary, status_name, nurtur_product, jira_updated);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_updated')
     CREATE INDEX IX_jira_cache_updated ON jira_issue_cache (jira_updated DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_created')
     CREATE INDEX IX_jira_cache_created ON jira_issue_cache (jira_created DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_product')
     CREATE INDEX IX_jira_cache_product ON jira_issue_cache (nurtur_product)
       WHERE nurtur_product IS NOT NULL;`,

    // Breach-by-queue for the NEURO flow signals. Without this, "which queue was
    // the ticket sitting in when it breached" — the Support Review's headline
    // measure — is a full scan of a wide table and dies on the 30s request
    // timeout every time. None of the eight indexes above touches sla_breached
    // or sla_breach_time.
    //
    // Deliberately NOT filtered on `sla_breached = 1`, though that would be
    // smaller: a filtered index is silently ignored when a connection's SET
    // options do not match, and a performance cliff that reappears without an
    // error is the exact failure this reporting chain must not have.
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_sla_breach')
     CREATE INDEX IX_jira_cache_sla_breach ON jira_issue_cache (sla_breached, sla_breach_time DESC)
       INCLUDE (current_tier);`,

    // resolved_at — populated from Jira's resolutiondate field during sync
    `IF COL_LENGTH('jira_issue_cache', 'resolved_at') IS NULL
     ALTER TABLE jira_issue_cache ADD resolved_at DATETIME2 NULL;`,

    // status_category_changed_at — Jira's statuscategorychangedate, i.e. when the
    // ticket last moved between status CATEGORIES. For a ticket currently in Done
    // this is the moment it was solved.
    //
    // This exists because neither of the obvious columns can date a solve:
    // `resolved_at` (resolutiondate) is NULL on effectively every NOVA close —
    // NOVA moves tickets to Resolved without setting the `resolution` field — and
    // is set on only ~30% of human closes. `jira_updated` is set by ANY edit, so
    // dating solves by it counts every later touch of an already-closed ticket as
    // a fresh solve. Jira stamps this field on the move into Done regardless of
    // whether `resolution` was set, so it dates both cases correctly.
    `IF COL_LENGTH('jira_issue_cache', 'status_category_changed_at') IS NULL
     ALTER TABLE jira_issue_cache ADD status_category_changed_at DATETIME2 NULL;`,

    // Rejection Reason (customfield_13216), mandatory on the "Submit for
    // Rejection to ..." transition screen.
    //
    // Cached so the sync can tell whether it CHANGED on a given pass. That is
    // the discriminator that matters: the field persists once set, so its mere
    // presence proves a ticket was rejected at some point, not that the move
    // being logged right now was a rejection. A tier move accompanied by a fresh
    // reason went through the rejection screen; one without it did not.
    `IF COL_LENGTH('jira_issue_cache', 'rejection_reason_text') IS NULL
     ALTER TABLE jira_issue_cache ADD rejection_reason_text NVARCHAR(500) NULL;`,

    // last_public_comment on jira_issue_cache — populated by jira sync from comment cache
    `IF COL_LENGTH('jira_issue_cache', 'last_public_comment') IS NULL
     ALTER TABLE jira_issue_cache ADD last_public_comment NVARCHAR(MAX) NULL;`,
    `IF COL_LENGTH('jira_issue_cache', 'last_public_comment_updated_at') IS NULL
     ALTER TABLE jira_issue_cache ADD last_public_comment_updated_at DATETIME2 NULL;`,

    // ── Jira Comment Cache ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'jira_comment_cache') AND type = 'U')
     CREATE TABLE jira_comment_cache (
       jira_comment_id NVARCHAR(50)  NOT NULL PRIMARY KEY,
       issue_key       NVARCHAR(30)  NOT NULL,
       author_account_id NVARCHAR(200) NULL,
       author_display  NVARCHAR(200) NULL,
       author_email    NVARCHAR(200) NULL,
       body_text       NVARCHAR(MAX) NULL,
       body_adf        NVARCHAR(MAX) NULL,
       is_public       BIT           NOT NULL DEFAULT 1,
       jira_created    DATETIME2     NOT NULL,
       jira_updated    DATETIME2     NOT NULL,
       synced_at       DATETIME2     NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_comment_issue')
     CREATE INDEX IX_jira_comment_issue ON jira_comment_cache (issue_key, jira_created DESC);`,

    // CSAT adoption flag — set at sync time so we never LIKE-scan comment bodies at
    // query time (100k+ rows with large ADF bodies make that a >90s full scan).
    // NOT NULL DEFAULT 0 is a metadata-only add; no historical comment has a CSAT link.
    `IF COL_LENGTH('jira_comment_cache', 'has_csat_link') IS NULL
     ALTER TABLE jira_comment_cache ADD has_csat_link BIT NOT NULL DEFAULT 0;`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_comment_csat')
     CREATE INDEX IX_jira_comment_csat ON jira_comment_cache (issue_key, is_public) WHERE has_csat_link = 1;`,

    // ── Jira Sync State ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'jira_sync_state') AND type = 'U')
     CREATE TABLE jira_sync_state (
       id              INT IDENTITY(1,1) PRIMARY KEY,
       sync_type       NVARCHAR(50)  NOT NULL,
       project_key     NVARCHAR(10)  NOT NULL,
       last_synced_at  DATETIME2     NOT NULL,
       issues_synced   INT           NOT NULL DEFAULT 0,
       comments_synced INT           NOT NULL DEFAULT 0,
       duration_ms     INT           NULL,
       error           NVARCHAR(MAX) NULL,
       created_at      DATETIME2     NOT NULL DEFAULT GETUTCDATE()
     );`,

    // ── WP-23b: Ticket Lifecycle columns on agent_ticket_state ──
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'lifecycle')
     ALTER TABLE agent_ticket_state ADD lifecycle NVARCHAR(50) NOT NULL DEFAULT 'new';`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'assignee')
     ALTER TABLE agent_ticket_state ADD assignee NVARCHAR(200) NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'assignee_name')
     ALTER TABLE agent_ticket_state ADD assignee_name NVARCHAR(200) NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'last_comment_id')
     ALTER TABLE agent_ticket_state ADD last_comment_id NVARCHAR(100) NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'last_triage_decision_id')
     ALTER TABLE agent_ticket_state ADD last_triage_decision_id INT NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'last_respond_decision_id')
     ALTER TABLE agent_ticket_state ADD last_respond_decision_id INT NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'comment_count')
     ALTER TABLE agent_ticket_state ADD comment_count INT NOT NULL DEFAULT 0;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'last_transition_at')
     ALTER TABLE agent_ticket_state ADD last_transition_at DATETIME2 NOT NULL DEFAULT GETUTCDATE();`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'last_agent_action_at')
     ALTER TABLE agent_ticket_state ADD last_agent_action_at DATETIME2 NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'last_customer_reply_at')
     ALTER TABLE agent_ticket_state ADD last_customer_reply_at DATETIME2 NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'approval_id')
     ALTER TABLE agent_ticket_state ADD approval_id INT NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_ticket_state') AND name = 'approval_submitted_at')
     ALTER TABLE agent_ticket_state ADD approval_submitted_at DATETIME2 NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_ticket_state_lifecycle')
     CREATE INDEX IX_agent_ticket_state_lifecycle ON agent_ticket_state (lifecycle);`,

    // ── Agent Suggestions table ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_suggestions') AND type = 'U')
     CREATE TABLE agent_suggestions (
       id INT IDENTITY(1,1) PRIMARY KEY,
       type NVARCHAR(20) NOT NULL,
       suggestion_key NVARCHAR(200) NOT NULL,
       suggestion_json NVARCHAR(MAX) NOT NULL,
       evidence_json NVARCHAR(MAX) NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'pending',
       dismissed_hash NVARCHAR(64) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    // Allow NULL on conversation_state — it was NOT NULL with no default, causing INSERT failures
    `ALTER TABLE agent_ticket_state ALTER COLUMN conversation_state NVARCHAR(MAX) NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_suggestions_type_status')
     CREATE INDEX IX_agent_suggestions_type_status ON agent_suggestions (type, status, created_at DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_suggestions') AND name = 'snoozed_until')
     ALTER TABLE agent_suggestions ADD snoozed_until DATETIME2 NULL;`,

    `IF COL_LENGTH('problem_ticket_alerts', 'last_analysed_at') IS NULL
     ALTER TABLE problem_ticket_alerts ADD last_analysed_at DATETIME2 NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sso_pending_states')
     CREATE TABLE sso_pending_states (
       state NVARCHAR(64) PRIMARY KEY,
       verifier NVARCHAR(200) NOT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    // ── Risk Alerting: Flagged tickets ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_flagged_tickets') AND type = 'U')
     CREATE TABLE agent_flagged_tickets (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key NVARCHAR(30) NOT NULL,
       risk_score INT NOT NULL,
       risk_factors NVARCHAR(MAX) NOT NULL,
       summary NVARCHAR(500) NULL,
       assignee NVARCHAR(200) NULL,
       reporter NVARCHAR(200) NULL,
       priority NVARCHAR(50) NULL,
       flagged_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       reviewed_at DATETIME2 NULL,
       reviewed_by NVARCHAR(100) NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'pending',
       last_notified_score INT NOT NULL DEFAULT 0
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_flagged_tickets_status')
     CREATE INDEX IX_agent_flagged_tickets_status ON agent_flagged_tickets (status, risk_score DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_flagged_tickets_key')
     CREATE UNIQUE INDEX IX_agent_flagged_tickets_key ON agent_flagged_tickets (ticket_key) WHERE status != 'dismissed';`,

    // ── Flagged tickets: dismiss_reason + dismissed_at (May 2026) ──
    `IF COL_LENGTH('agent_flagged_tickets', 'dismiss_reason') IS NULL
     ALTER TABLE agent_flagged_tickets ADD dismiss_reason NVARCHAR(200) NULL;`,
    `IF COL_LENGTH('agent_flagged_tickets', 'dismissed_at') IS NULL
     ALTER TABLE agent_flagged_tickets ADD dismissed_at DATETIME2 NULL;`,

    // ── Account-level risk intelligence (Jun 2026) ──────────────────────────
    // Per-CUSTOMER risk (churn / formal complaint / termination), distinct from
    // the per-TICKET risk in agent_flagged_tickets. See agent_work/ba/account-risk-spec.md.

    // Domain → customer map. The backbone of customer resolution: only ~14% of
    // tickets carry a structured identifier (BC Account Number, Instance URL,
    // JSM Organization), but 99% have a reporter email. Seeded from bc_customers
    // email domains + the known at-risk accounts; grows as tickets are resolved.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_customer_domains') AND type = 'U')
     CREATE TABLE agent_customer_domains (
       id INT IDENTITY(1,1) PRIMARY KEY,
       customer_ref NVARCHAR(100) NOT NULL,        -- canonical key, e.g. BC number 'CU0001155'
       customer_source NVARCHAR(20) NOT NULL DEFAULT 'bc',  -- 'bc' | 'crm' | 'manual'
       customer_name NVARCHAR(200) NULL,
       domain NVARCHAR(255) NOT NULL,              -- lower-cased; e.g. 'acenproperties.co.uk'
       domain_type NVARCHAR(20) NOT NULL DEFAULT 'email',   -- 'email' | 'instance_url' | 'website'
       confidence TINYINT NOT NULL DEFAULT 100,    -- AI-inferred mappings score lower
       is_verified BIT NOT NULL DEFAULT 0,
       is_network BIT NOT NULL DEFAULT 0,          -- umbrella domain (Guild/PFG/EweMove)
       source_note NVARCHAR(200) NULL,
       added_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_agent_customer_domains UNIQUE (domain, domain_type)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_customer_domains_ref')
     CREATE INDEX IX_agent_customer_domains_ref ON agent_customer_domains (customer_ref);`,

    // Per-customer risk profile.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_account_risk') AND type = 'U')
     CREATE TABLE agent_account_risk (
       id INT IDENTITY(1,1) PRIMARY KEY,
       customer_ref NVARCHAR(100) NOT NULL,
       customer_source NVARCHAR(20) NOT NULL DEFAULT 'bc',
       customer_name NVARCHAR(200) NOT NULL,
       bc_number NVARCHAR(50) NULL,
       primary_domain NVARCHAR(255) NULL,
       risk_score INT NOT NULL DEFAULT 0,
       risk_tier TINYINT NOT NULL DEFAULT 0,       -- 0 Normal .. 4 Critical
       has_formal_complaint BIT NOT NULL DEFAULT 0,
       has_termination BIT NOT NULL DEFAULT 0,
       has_active_refund BIT NOT NULL DEFAULT 0,
       has_open_escalation BIT NOT NULL DEFAULT 0,
       is_network_account BIT NOT NULL DEFAULT 0,
       needs_manual_resolution BIT NOT NULL DEFAULT 0,
       total_ticket_count INT NOT NULL DEFAULT 0,
       first_ticket_date DATETIME2 NULL,
       last_ticket_date DATETIME2 NULL,
       last_score_update DATETIME2 NULL,
       notes NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_agent_account_risk_ref UNIQUE (customer_ref)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_account_risk_tier')
     CREATE INDEX IX_agent_account_risk_tier ON agent_account_risk (risk_tier DESC, risk_score DESC);`,

    // Individual ticket-linked signal events that feed the score.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_account_risk_signals') AND type = 'U')
     CREATE TABLE agent_account_risk_signals (
       id INT IDENTITY(1,1) PRIMARY KEY,
       customer_ref NVARCHAR(100) NOT NULL,
       ticket_key NVARCHAR(30) NOT NULL,
       project_key NVARCHAR(10) NOT NULL,
       signal_type NVARCHAR(80) NOT NULL,          -- 'formal_complaint', 'termination', ...
       signal_weight INT NOT NULL,
       is_active BIT NOT NULL DEFAULT 1,           -- 0 once ticket resolved/closed
       evidence_text NVARCHAR(500) NULL,
       detected_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       ticket_created_at DATETIME2 NULL,
       ticket_status NVARCHAR(60) NULL,
       CONSTRAINT UQ_agent_account_risk_signal UNIQUE (ticket_key, signal_type)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_account_risk_signals_ref')
     CREATE INDEX IX_agent_account_risk_signals_ref ON agent_account_risk_signals (customer_ref, is_active);`,

    // Audit trail of score/tier changes.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_account_risk_history') AND type = 'U')
     CREATE TABLE agent_account_risk_history (
       id INT IDENTITY(1,1) PRIMARY KEY,
       customer_ref NVARCHAR(100) NOT NULL,
       previous_score INT NOT NULL,
       new_score INT NOT NULL,
       previous_tier TINYINT NOT NULL,
       new_tier TINYINT NOT NULL,
       trigger_ticket_key NVARCHAR(30) NULL,
       change_reason NVARCHAR(500) NULL,
       changed_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_account_risk_history_ref')
     CREATE INDEX IX_agent_account_risk_history_ref ON agent_account_risk_history (customer_ref, changed_at DESC);`,

    // Nightly reconciliation ledger. Each in-scope project/day: total tickets vs
    // resolved-to-a-customer. status='complete' days are sealed and never re-checked.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_risk_recon_days') AND type = 'U')
     CREATE TABLE agent_risk_recon_days (
       id INT IDENTITY(1,1) PRIMARY KEY,
       project_key NVARCHAR(10) NOT NULL,
       recon_date DATE NOT NULL,
       total_tickets INT NOT NULL DEFAULT 0,
       resolved_tickets INT NOT NULL DEFAULT 0,
       status NVARCHAR(20) NOT NULL DEFAULT 'partial',  -- 'partial' | 'complete'
       last_checked_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_agent_risk_recon_day UNIQUE (project_key, recon_date)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_risk_recon_days_status')
     CREATE INDEX IX_agent_risk_recon_days_status ON agent_risk_recon_days (status, recon_date);`,

    // AI customer inference cache (account-risk step 2). One row per ticket the AI has tried
    // to attribute, so each ticket is inferred once (not re-done every nightly rollup). The
    // rollup reads this as a resolution source; a budgeted batch populates it.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_ticket_customer_inference') AND type = 'U')
     CREATE TABLE agent_ticket_customer_inference (
       ticket_key NVARCHAR(30) NOT NULL PRIMARY KEY,
       customer_ref NVARCHAR(100) NULL,        -- matched registry ref, or NULL if extracted but unmatched
       customer_name NVARCHAR(200) NULL,
       extracted_name NVARCHAR(200) NULL,      -- what the model read out of the ticket
       extracted_url NVARCHAR(255) NULL,
       confidence TINYINT NOT NULL DEFAULT 0,  -- 0-100 (model x registry match)
       method NVARCHAR(30) NOT NULL DEFAULT 'ai',
       inferred_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ticket_cust_inference_ref')
     CREATE INDEX IX_ticket_cust_inference_ref ON agent_ticket_customer_inference (customer_ref);`,

    // Work queue for AI customer inference. The rollup enqueues unresolved tickets (fast);
    // a background worker drains it in small chunks, surviving restarts (the inline batch
    // was getting killed by deploys). Rows are deleted once the ticket is inferred + cached.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_inference_queue') AND type = 'U')
     CREATE TABLE agent_inference_queue (
       ticket_key NVARCHAR(30) NOT NULL PRIMARY KEY,
       summary NVARCHAR(500) NULL,
       description NVARCHAR(2000) NULL,
       queued_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    // ── Issue Router (AgentBrain) — cross-customer issue cards POSTed in by Liam's router ──
    // Replaces NOVA's home-grown ticket→customer attribution: AgentBrain already classifies +
    // attributes across JSM + Zendesk. One row per issue (upsert on signature); customer_share
    // is also exploded into agent_issue_customers so the per-customer at-risk view is a GROUP BY.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_issue_cards') AND type = 'U')
     CREATE TABLE agent_issue_cards (
       signature NVARCHAR(120) NOT NULL PRIMARY KEY,   -- iss-<hash>, stable identity across runs
       route NVARCHAR(30) NULL,                        -- bug_external|ux_friction|missing_feature|docs_gap|uncertain
       confidence FLOAT NULL,                          -- 0.0-1.0
       severity NVARCHAR(20) NULL,                     -- optional (if AgentBrain adds it)
       title NVARCHAR(500) NULL,
       problem_statement NVARCHAR(MAX) NULL,
       customer_count INT NULL,
       frequency_label NVARCHAR(300) NULL,
       trend NVARCHAR(20) NULL,                         -- new|growing|stable
       first_seen DATETIME2 NULL,
       last_seen DATETIME2 NULL,
       reasoning NVARCHAR(MAX) NULL,
       customer_share NVARCHAR(MAX) NULL,               -- raw JSON
       citing_tickets NVARCHAR(MAX) NULL,               -- raw JSON
       last_action NVARCHAR(30) NULL,                   -- send_dashboard|update_dashboard
       received_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_issue_cards_route')
     CREATE INDEX IX_agent_issue_cards_route ON agent_issue_cards (route, trend);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_issue_customers') AND type = 'U')
     CREATE TABLE agent_issue_customers (
       id INT IDENTITY(1,1) PRIMARY KEY,
       signature NVARCHAR(120) NOT NULL,
       customer NVARCHAR(255) NOT NULL,
       ticket_count INT NOT NULL DEFAULT 0,
       pct FLOAT NULL,
       CONSTRAINT UQ_agent_issue_customers UNIQUE (signature, customer)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_issue_customers_customer')
     CREATE INDEX IX_agent_issue_customers_customer ON agent_issue_customers (customer);`,

    // citing_tickets exploded — lets the agent triage flag map a ticket → the cross-customer issue(s) it belongs to.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_issue_tickets') AND type = 'U')
     CREATE TABLE agent_issue_tickets (
       id INT IDENTITY(1,1) PRIMARY KEY,
       signature NVARCHAR(120) NOT NULL,
       ticket_key NVARCHAR(60) NOT NULL,
       source NVARCHAR(20) NULL,                 -- jsm | zendesk
       CONSTRAINT UQ_agent_issue_tickets UNIQUE (signature, ticket_key)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_issue_tickets_key')
     CREATE INDEX IX_agent_issue_tickets_key ON agent_issue_tickets (ticket_key);`,

    // ── Performance indexes (audit Apr 2026) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_decisions_ticket_created')
     CREATE INDEX IX_agent_decisions_ticket_created ON agent_decisions (ticket_id, created_at DESC)
       INCLUDE (action, confidence, outcome, inputs);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_llm_calls_created')
     CREATE INDEX IX_agent_llm_calls_created ON agent_llm_calls (created_at DESC)
       INCLUDE (provider, model, estimated_cost, call_type, ticket_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_llm_calls_ticket')
     CREATE INDEX IX_agent_llm_calls_ticket ON agent_llm_calls (ticket_id, created_at DESC)
       INCLUDE (estimated_cost, call_type);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_ticket_state_lifecycle_transition')
     CREATE INDEX IX_agent_ticket_state_lifecycle_transition ON agent_ticket_state (lifecycle, last_transition_at DESC)
       INCLUDE (ticket_id, assignee, comment_count);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_comment_cache_issue_author')
     CREATE INDEX IX_jira_comment_cache_issue_author ON jira_comment_cache (issue_key, author_account_id)
       INCLUDE (is_public, jira_created);`,

    // ── Dev Review indexes ──
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_dev_review_state_status')
     CREATE INDEX IX_dev_review_state_status ON dev_review_state (status)
       INCLUDE (claimed_by_user_id, fast_track, team, first_seen_at);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_dev_review_thread_comment_lookup')
     CREATE INDEX IX_dev_review_thread_comment_lookup ON dev_review_thread (jira_key, jira_comment_id)
       WHERE jira_comment_id IS NOT NULL;`,

    `IF COL_LENGTH('dev_review_state', 'work_item_key') IS NULL
     ALTER TABLE dev_review_state ADD work_item_key NVARCHAR(50) NULL;`,

    // ITIL classification columns on ticket_classifications
    `IF COL_LENGTH('ticket_classifications', 'ticket_type') IS NULL
     ALTER TABLE ticket_classifications ADD ticket_type NVARCHAR(30) NULL;`,
    `IF COL_LENGTH('ticket_classifications', 'impact') IS NULL
     ALTER TABLE ticket_classifications ADD impact NVARCHAR(20) NULL;`,
    `IF COL_LENGTH('ticket_classifications', 'urgency') IS NULL
     ALTER TABLE ticket_classifications ADD urgency NVARCHAR(20) NULL;`,
    `IF COL_LENGTH('ticket_classifications', 'priority_matrix') IS NULL
     ALTER TABLE ticket_classifications ADD priority_matrix NVARCHAR(5) NULL;`,

    // WP-23k: Hybrid shadow mode
    `IF COL_LENGTH('approval_queue', 'action_type') IS NULL
     ALTER TABLE approval_queue ADD action_type NVARCHAR(50) NULL DEFAULT 'draft_response';`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'hybrid_action_log') AND type = 'U')
     CREATE TABLE hybrid_action_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       action_id NVARCHAR(50) NOT NULL,
       source_ticket_key NVARCHAR(100) NOT NULL,
       created_ticket_key NVARCHAR(100) NULL,
       status NVARCHAR(50) NOT NULL DEFAULT 'completed',
       detail NVARCHAR(MAX) NULL,
       pre_empted BIT NOT NULL DEFAULT 0,
       pre_emption_reason NVARCHAR(500) NULL,
       approval_id INT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_hybrid_action_log_ticket')
     CREATE INDEX IX_hybrid_action_log_ticket ON hybrid_action_log (source_ticket_key, created_at DESC);`,

    // ── Daily briefings ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'daily_briefings') AND type = 'U')
     CREATE TABLE daily_briefings (
       id INT IDENTITY(1,1) PRIMARY KEY,
       user_id INT NULL,
       role_type NVARCHAR(20) NOT NULL,
       briefing_date DATE NOT NULL,
       content_json NVARCHAR(MAX) NOT NULL,
       generated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       dismissed_at DATETIME2 NULL
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_daily_briefings_user_date')
     CREATE INDEX IX_daily_briefings_user_date ON daily_briefings (user_id, briefing_date DESC);`,

    // ── KB article drafts ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kb_article_drafts') AND type = 'U')
     CREATE TABLE kb_article_drafts (
       id INT IDENTITY(1,1) PRIMARY KEY,
       gap_id INT NULL,
       title NVARCHAR(500) NOT NULL,
       body NVARCHAR(MAX) NOT NULL,
       category NVARCHAR(100) NULL,
       labels NVARCHAR(500) NULL,
       status NVARCHAR(20) NOT NULL DEFAULT 'draft',
       confluence_page_id NVARCHAR(100) NULL,
       confluence_url NVARCHAR(500) NULL,
       created_by INT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       published_at DATETIME2 NULL
     );`,

    // ── AI comparison log (shadow mode: NOVA vs n8n) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ai_comparison_log') AND type = 'U')
     CREATE TABLE ai_comparison_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key NVARCHAR(30) NOT NULL,
       nova_action NVARCHAR(50) NULL,
       n8n_action NVARCHAR(50) NULL,
       nova_confidence FLOAT NULL,
       agreement BIT NOT NULL DEFAULT 0,
       diff_summary NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ai_comparison_log_ticket')
     CREATE INDEX IX_ai_comparison_log_ticket ON ai_comparison_log (ticket_key, created_at DESC);`,

    // ── AI improvement signals (human edits to AI drafts) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ai_improvement_signals') AND type = 'U')
     CREATE TABLE ai_improvement_signals (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key NVARCHAR(30) NOT NULL,
       signal_type NVARCHAR(30) NOT NULL,
       ai_output NVARCHAR(MAX) NULL,
       human_output NVARCHAR(MAX) NULL,
       diff_summary NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    // ── Agent achievements (gamification) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_achievements') AND type = 'U')
     CREATE TABLE agent_achievements (
       id INT IDENTITY(1,1) PRIMARY KEY,
       user_id INT NOT NULL,
       achievement_type NVARCHAR(100) NOT NULL,
       detail NVARCHAR(500) NULL,
       earned_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_achievements_user')
     CREATE INDEX IX_agent_achievements_user ON agent_achievements (user_id, earned_at DESC);`,

    // ── Agent streaks (gamification) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_streaks') AND type = 'U')
     CREATE TABLE agent_streaks (
       id INT IDENTITY(1,1) PRIMARY KEY,
       user_id INT NOT NULL,
       streak_type NVARCHAR(100) NOT NULL,
       current_count INT NOT NULL DEFAULT 0,
       best_count INT NOT NULL DEFAULT 0,
       last_date DATE NULL,
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_agent_streaks_user_type')
     CREATE UNIQUE INDEX UX_agent_streaks_user_type ON agent_streaks (user_id, streak_type);`,

    // ── Processed comments dedup (survives restarts) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'processed_comments') AND type = 'U')
     CREATE TABLE processed_comments (
       comment_id NVARCHAR(100) NOT NULL PRIMARY KEY,
       processed_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_processed_comments_at')
     CREATE INDEX IX_processed_comments_at ON processed_comments (processed_at);`,

    `IF COL_LENGTH('approval_queue', 'source') IS NULL
     ALTER TABLE approval_queue ADD source NVARCHAR(20) NULL DEFAULT 'n8n_ai';`,

    `UPDATE approval_queue SET source = 'nova_ai'
     WHERE source IS NULL AND resume_url LIKE '%/api/public/agent/approval-callback%';`,

    `UPDATE approval_queue SET source = 'n8n_ai'
     WHERE source IS NULL;`,

    // WP-60: SLA warning tracking on approval_queue
    `IF COL_LENGTH('approval_queue', 'warned_at') IS NULL
     ALTER TABLE approval_queue ADD warned_at DATETIME2 NULL;`,

    // n8n comment tracking on jira_issue_cache — populated by jira sync from comment cache
    `IF COL_LENGTH('jira_issue_cache', 'last_n8n_comment') IS NULL
     ALTER TABLE jira_issue_cache ADD last_n8n_comment NVARCHAR(MAX) NULL;`,
    `IF COL_LENGTH('jira_issue_cache', 'last_n8n_comment_at') IS NULL
     ALTER TABLE jira_issue_cache ADD last_n8n_comment_at DATETIME2 NULL;`,
    `IF COL_LENGTH('jira_issue_cache', 'last_n8n_comment_author') IS NULL
     ALTER TABLE jira_issue_cache ADD last_n8n_comment_author NVARCHAR(255) NULL;`,

    // n8n raw excerpt on ai_comparison_log
    `IF COL_LENGTH('ai_comparison_log', 'n8n_raw_excerpt') IS NULL
     ALTER TABLE ai_comparison_log ADD n8n_raw_excerpt NVARCHAR(MAX) NULL;`,

    // v2 parser columns on ai_comparison_log (multi-signal ground truth)
    `IF COL_LENGTH('ai_comparison_log', 'n8n_recommended_tier') IS NULL
     ALTER TABLE ai_comparison_log ADD n8n_recommended_tier NVARCHAR(100) NULL;`,
    `IF COL_LENGTH('ai_comparison_log', 'n8n_posted_reply') IS NULL
     ALTER TABLE ai_comparison_log ADD n8n_posted_reply BIT NOT NULL DEFAULT 0;`,
    `IF COL_LENGTH('ai_comparison_log', 'n8n_assigned') IS NULL
     ALTER TABLE ai_comparison_log ADD n8n_assigned BIT NOT NULL DEFAULT 0;`,
    `IF COL_LENGTH('ai_comparison_log', 'parser_version') IS NULL
     ALTER TABLE ai_comparison_log ADD parser_version INT NOT NULL DEFAULT 1;`,

    // organisation_name on jira_issue_cache — for key accounts wallboard filtering
    `IF COL_LENGTH('jira_issue_cache', 'organisation_name') IS NULL
     ALTER TABLE jira_issue_cache ADD organisation_name NVARCHAR(200) NULL;`,

    `IF COL_LENGTH('jira_issue_cache', 'no_reply') IS NULL
     ALTER TABLE jira_issue_cache ADD no_reply BIT NOT NULL DEFAULT 0;`,

    // KB gap status extensions for article workflow
    `IF COL_LENGTH('kb_gap_log', 'confluence_url') IS NULL
     ALTER TABLE kb_gap_log ADD confluence_url NVARCHAR(500) NULL;`,

    // WP-30: Escalation audit log
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'escalation_log') AND type = 'U')
     CREATE TABLE escalation_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key NVARCHAR(30) NOT NULL,
       escalation_type NVARCHAR(30) NOT NULL,
       from_tier NVARCHAR(50) NULL,
       to_tier NVARCHAR(50) NULL,
       reason_code NVARCHAR(50) NULL,
       reason_label NVARCHAR(200) NULL,
       escalated_by NVARCHAR(100) NULL,
       assigned_to NVARCHAR(200) NULL,
       notes NVARCHAR(MAX) NULL,
       decision_id INT NULL,
       source NVARCHAR(20) NOT NULL DEFAULT 'manual',
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_escalation_log_ticket')
     CREATE INDEX IX_escalation_log_ticket ON escalation_log (ticket_key, created_at DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_escalation_log_date')
     CREATE INDEX IX_escalation_log_date ON escalation_log (created_at DESC, escalation_type);`,

    // WP-23j: Add agent_id to gamification tables for Azure SQL bridge
    `IF COL_LENGTH('agent_achievements', 'agent_id') IS NULL
     ALTER TABLE agent_achievements ADD agent_id INT NULL;`,

    `IF COL_LENGTH('agent_streaks', 'agent_id') IS NULL
     ALTER TABLE agent_streaks ADD agent_id INT NULL;`,

    // ── Backlog Kanban ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'backlog_columns') AND type = 'U')
     CREATE TABLE backlog_columns (
       id INT IDENTITY(1,1) PRIMARY KEY,
       title NVARCHAR(100) NOT NULL,
       sort_order INT NOT NULL DEFAULT 0,
       color NVARCHAR(7) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'backlog_items') AND type = 'U')
     CREATE TABLE backlog_items (
       id INT IDENTITY(1,1) PRIMARY KEY,
       column_id INT NOT NULL,
       title NVARCHAR(200) NOT NULL,
       description NVARCHAR(MAX) NULL,
       wp_ref NVARCHAR(20) NULL,
       effort NVARCHAR(50) NULL,
       type NVARCHAR(30) NULL,
       priority INT NOT NULL DEFAULT 0,
       created_by NVARCHAR(100) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       completed_at DATETIME2 NULL,
       blocked_reason NVARCHAR(500) NULL,
       CONSTRAINT FK_backlog_items_column FOREIGN KEY (column_id) REFERENCES backlog_columns(id)
     );`,

    `IF NOT EXISTS (SELECT 1 FROM backlog_columns)
     BEGIN
       INSERT INTO backlog_columns (title, sort_order, color) VALUES ('Backlog', 0, '#6366f1');
       INSERT INTO backlog_columns (title, sort_order, color) VALUES ('This Sprint', 1, '#f59e0b');
       INSERT INTO backlog_columns (title, sort_order, color) VALUES ('In Progress', 2, '#3b82f6');
       INSERT INTO backlog_columns (title, sort_order, color) VALUES ('Done', 3, '#22c55e');
       INSERT INTO backlog_columns (title, sort_order, color) VALUES ('Parked', 4, '#6b7280');
     END;`,

    // ── KB Retrieval: chunks table ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kb_chunks') AND type = 'U')
     CREATE TABLE kb_chunks (
       id              BIGINT IDENTITY(1,1) PRIMARY KEY,
       source          VARCHAR(32)  NOT NULL,
       source_doc_id   VARCHAR(512) NOT NULL,
       doc_path        NVARCHAR(1024) NOT NULL,
       doc_title       NVARCHAR(512) NOT NULL,
       doc_url         NVARCHAR(1024) NOT NULL,
       chunk_index     INT NOT NULL,
       heading_path    NVARCHAR(1024) NULL,
       content         NVARCHAR(MAX) NOT NULL,
       token_count     INT NOT NULL,
       embedding       VARBINARY(MAX) NOT NULL,
       embedding_model VARCHAR(64) NOT NULL,
       content_hash    CHAR(64) NOT NULL,
       last_seen_at    DATETIME2 NOT NULL,
       created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kb_chunks_source')
     CREATE INDEX IX_kb_chunks_source ON kb_chunks (source, source_doc_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kb_chunks_last_seen')
     CREATE INDEX IX_kb_chunks_last_seen ON kb_chunks (last_seen_at);`,

    // ── KB Retrieval: sync runs table ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kb_sync_runs') AND type = 'U')
     CREATE TABLE kb_sync_runs (
       id              BIGINT IDENTITY(1,1) PRIMARY KEY,
       source          VARCHAR(32) NOT NULL,
       started_at      DATETIME2 NOT NULL,
       completed_at    DATETIME2 NULL,
       status          VARCHAR(16) NOT NULL,
       docs_seen       INT NOT NULL DEFAULT 0,
       chunks_added    INT NOT NULL DEFAULT 0,
       chunks_updated  INT NOT NULL DEFAULT 0,
       chunks_deleted  INT NOT NULL DEFAULT 0,
       error_message   NVARCHAR(MAX) NULL
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kb_sync_runs_source_started')
     CREATE INDEX IX_kb_sync_runs_source_started ON kb_sync_runs (source, started_at DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'kb_sync_runs') AND name = 'diagnostics')
     ALTER TABLE kb_sync_runs ADD diagnostics NVARCHAR(MAX) NULL;`,

    // ── AI Learnings (human-directed feedback for AI agent) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ai_learnings') AND type = 'U')
     CREATE TABLE ai_learnings (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key NVARCHAR(30) NOT NULL,
       category NVARCHAR(100) NULL,
       organisation NVARCHAR(200) NULL,
       ai_draft NVARCHAR(MAX) NULL,
       learning NVARCHAR(MAX) NOT NULL,
       tags NVARCHAR(500) NULL,
       submitted_by NVARCHAR(100) NOT NULL,
       active BIT NOT NULL DEFAULT 1,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF COL_LENGTH('ai_learnings', 'last_applied_at') IS NULL
     ALTER TABLE ai_learnings ADD last_applied_at DATETIME2 NULL;`,

    `IF COL_LENGTH('ai_learnings', 'apply_count') IS NULL
     ALTER TABLE ai_learnings ADD apply_count INT NOT NULL DEFAULT 0;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ai_learnings_active')
     CREATE INDEX IX_ai_learnings_active ON ai_learnings (active, category, created_at DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ai_learnings_org')
     CREATE INDEX IX_ai_learnings_org ON ai_learnings (organisation, active);`,

    // ── Agent events spine (My Tickets foundation) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_events') AND type = 'U')
     CREATE TABLE agent_events (
       id BIGINT IDENTITY(1,1) PRIMARY KEY,
       event_type VARCHAR(64) NOT NULL,
       ticket_key VARCHAR(32) NULL,
       agent_id VARCHAR(64) NULL,
       payload NVARCHAR(MAX) NOT NULL,
       created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       INDEX ix_agent_events_type_created (event_type, created_at DESC),
       INDEX ix_agent_events_ticket_created (ticket_key, created_at DESC),
       INDEX ix_agent_events_agent_created (agent_id, created_at DESC)
     );`,

    // ── Agent Next Update + Agent Last Updated columns on jira_issue_cache ──
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'jira_issue_cache') AND name = 'agent_next_update')
     ALTER TABLE jira_issue_cache ADD agent_next_update DATETIME2 NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'jira_issue_cache') AND name = 'agent_last_updated')
     ALTER TABLE jira_issue_cache ADD agent_last_updated DATETIME2 NULL;`,

    // WP-56: Prompt versioning — stamp which prompt version produced each decision/call
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_llm_calls') AND name = 'prompt_version')
     ALTER TABLE agent_llm_calls ADD prompt_version VARCHAR(64) NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_decisions') AND name = 'prompt_version')
     ALTER TABLE agent_decisions ADD prompt_version VARCHAR(64) NULL;`,

    `UPDATE agent_llm_calls SET prompt_version = 'pre-versioning' WHERE prompt_version IS NULL;`,
    `UPDATE agent_decisions SET prompt_version = 'pre-versioning' WHERE prompt_version IS NULL;`,

    // WP-55: PII redaction logging
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_llm_calls') AND name = 'redactions')
     ALTER TABLE agent_llm_calls ADD redactions NVARCHAR(MAX) NULL;`,

    // WP-62: Drift detection snapshots
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_drift_snapshots') AND type = 'U')
     CREATE TABLE agent_drift_snapshots (
       id INT IDENTITY(1,1) PRIMARY KEY,
       snapshot_date DATE NOT NULL,
       period_days INT NOT NULL DEFAULT 7,
       call_type NVARCHAR(50) NOT NULL,
       prompt_version VARCHAR(64) NULL,
       provider NVARCHAR(20) NULL,
       accept_rate FLOAT NULL,
       latency_p95_ms INT NULL,
       cost_per_decision FLOAT NULL,
       baseline_accept_rate FLOAT NULL,
       baseline_latency_p95_ms INT NULL,
       baseline_cost_per_decision FLOAT NULL,
       severity NVARCHAR(16) NOT NULL DEFAULT 'none',
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_drift_snapshots_date')
     CREATE INDEX IX_agent_drift_snapshots_date ON agent_drift_snapshots (snapshot_date DESC, call_type);`,

    // call_type on agent_decisions — needed by drift detector to segment metrics
    `IF COL_LENGTH('agent_decisions', 'call_type') IS NULL
     ALTER TABLE agent_decisions ADD call_type NVARCHAR(50) NULL;`,
    `UPDATE agent_decisions SET call_type = action WHERE call_type IS NULL;`,

    // ── Ticket defers (My Tickets defer system) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ticket_defers') AND type = 'U')
     CREATE TABLE ticket_defers (
       id BIGINT IDENTITY(1,1) PRIMARY KEY,
       ticket_key VARCHAR(32) NOT NULL,
       agent_id VARCHAR(64) NOT NULL,
       reason VARCHAR(64) NOT NULL,
       deferred_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       resurface_at DATETIME2 NOT NULL,
       note NVARCHAR(500) NULL,
       resolved_at DATETIME2 NULL,
       resolved_by VARCHAR(64) NULL,
       INDEX ix_ticket_defers_agent_active (agent_id, resolved_at),
       INDEX ix_ticket_defers_resurface (resurface_at, resolved_at)
     );`,

    // resolved_by on agent_decisions — track human vs system for stats filtering
    `IF COL_LENGTH('agent_decisions', 'resolved_by') IS NULL
     ALTER TABLE agent_decisions ADD resolved_by NVARCHAR(100) NULL;`,

    // Auto-rule enable/disable overrides (WP-70)
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'auto_rule_overrides') AND type = 'U')
     CREATE TABLE auto_rule_overrides (
       rule_id VARCHAR(100) PRIMARY KEY,
       enabled BIT NOT NULL DEFAULT 1,
       disabled_by VARCHAR(100) NULL,
       disabled_at DATETIME2 NULL,
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF COL_LENGTH('dev_review_thread', 'body_adf') IS NULL
     ALTER TABLE dev_review_thread ADD body_adf NVARCHAR(MAX) NULL;`,

    // Quick-win detection columns on agent_decisions
    `IF COL_LENGTH('agent_decisions', 'quick_win_type') IS NULL
     ALTER TABLE agent_decisions ADD quick_win_type NVARCHAR(30) NULL;`,

    `IF COL_LENGTH('agent_decisions', 'quick_win_confidence') IS NULL
     ALTER TABLE agent_decisions ADD quick_win_confidence FLOAT NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_decisions_quick_win')
     CREATE INDEX IX_agent_decisions_quick_win ON agent_decisions (quick_win_type) WHERE quick_win_type IS NOT NULL;`,

    // Quick-win auto-close execution tracking
    `IF COL_LENGTH('agent_decisions', 'quick_win_executed') IS NULL
     ALTER TABLE agent_decisions ADD quick_win_executed BIT NOT NULL DEFAULT 0;`,

    `IF COL_LENGTH('agent_decisions', 'quick_win_executed_at') IS NULL
     ALTER TABLE agent_decisions ADD quick_win_executed_at DATETIME2 NULL;`,

    `IF COL_LENGTH('agent_decisions', 'pre_close_status') IS NULL
     ALTER TABLE agent_decisions ADD pre_close_status NVARCHAR(100) NULL;`,

    `IF COL_LENGTH('agent_decisions', 'quick_win_undone') IS NULL
     ALTER TABLE agent_decisions ADD quick_win_undone BIT NOT NULL DEFAULT 0;`,

    `IF COL_LENGTH('agent_decisions', 'quick_win_undone_at') IS NULL
     ALTER TABLE agent_decisions ADD quick_win_undone_at DATETIME2 NULL;`,

    `IF COL_LENGTH('agent_decisions', 'quick_win_undone_by') IS NULL
     ALTER TABLE agent_decisions ADD quick_win_undone_by NVARCHAR(100) NULL;`,

    // ── A1: Eval suite — labelled decisions + eval run history ──
    `IF COL_LENGTH('agent_decisions', 'eval_label') IS NULL
     ALTER TABLE agent_decisions ADD eval_label NVARCHAR(20) NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_eval_runs') AND type = 'U')
     CREATE TABLE agent_eval_runs (
       id INT IDENTITY(1,1) PRIMARY KEY,
       run_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       run_type NVARCHAR(20) NOT NULL DEFAULT 'eval',
       sample_size INT NOT NULL,
       matched INT NOT NULL,
       accept_rate DECIMAL(5,2) NOT NULL,
       baseline_rate DECIMAL(5,2) NULL,
       delta DECIMAL(5,2) NULL,
       prompt_version NVARCHAR(100) NULL,
       model_override NVARCHAR(100) NULL,
       details NVARCHAR(MAX) NULL,
       run_by NVARCHAR(100) NULL
     );`,

    // ── A2: Critic gate columns on agent_decisions ──
    `IF COL_LENGTH('agent_decisions', 'critic_approved') IS NULL
     ALTER TABLE agent_decisions ADD critic_approved BIT NULL;`,

    `IF COL_LENGTH('agent_decisions', 'critic_reason') IS NULL
     ALTER TABLE agent_decisions ADD critic_reason NVARCHAR(500) NULL;`,

    `IF COL_LENGTH('agent_decisions', 'critic_model') IS NULL
     ALTER TABLE agent_decisions ADD critic_model NVARCHAR(100) NULL;`,

    // ── B1: Approval SLA tracking ──
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_approvals') AND name = 'sla_breached_at')
     BEGIN TRY ALTER TABLE agent_approvals ADD sla_breached_at DATETIME2 NULL; END TRY BEGIN CATCH END CATCH;`,

    // ── D1: Cross-ticket pattern library ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_patterns') AND type = 'U')
     CREATE TABLE agent_patterns (
       id INT IDENTITY(1,1) PRIMARY KEY,
       category NVARCHAR(100) NOT NULL,
       symptom_hash VARCHAR(64) NULL,
       symptom NVARCHAR(MAX) NULL,
       resolution NVARCHAR(MAX) NULL,
       observed_count INT NOT NULL DEFAULT 1,
       success_rate DECIMAL(5,2) NULL,
       last_observed DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       source_tickets NVARCHAR(MAX) NULL
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_patterns_category')
     CREATE INDEX IX_agent_patterns_category ON agent_patterns (category, observed_count DESC);`,

    // ── E1: A/B testing framework ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_ab_tests') AND type = 'U')
     CREATE TABLE agent_ab_tests (
       id INT IDENTITY(1,1) PRIMARY KEY,
       name NVARCHAR(100) NOT NULL,
       test_type NVARCHAR(20) NOT NULL,
       variant_a NVARCHAR(MAX) NULL,
       variant_b NVARCHAR(MAX) NULL,
       split_percentage INT NOT NULL DEFAULT 50,
       metric NVARCHAR(50) NOT NULL DEFAULT 'accept_rate',
       min_sample INT NOT NULL DEFAULT 100,
       status NVARCHAR(20) NOT NULL DEFAULT 'active',
       started_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       completed_at DATETIME2 NULL,
       results NVARCHAR(MAX) NULL
     );`,

    `IF COL_LENGTH('agent_decisions', 'ab_test_id') IS NULL
     ALTER TABLE agent_decisions ADD ab_test_id INT NULL;`,

    `IF COL_LENGTH('agent_decisions', 'ab_variant') IS NULL
     ALTER TABLE agent_decisions ADD ab_variant CHAR(1) NULL;`,

    // ── E2: Customer memory archive (for eviction) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_customer_memory_archive') AND type = 'U')
     CREATE TABLE agent_customer_memory_archive (
       id INT IDENTITY(1,1) PRIMARY KEY,
       account_id NVARCHAR(100) NOT NULL,
       patterns NVARCHAR(MAX) NOT NULL,
       archived_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       original_created_at DATETIME2 NULL,
       original_last_updated DATETIME2 NULL
     );`,

    // ── E4: Shadow model comparison ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_model_comparisons') AND type = 'U')
     CREATE TABLE agent_model_comparisons (
       id INT IDENTITY(1,1) PRIMARY KEY,
       call_type NVARCHAR(50) NOT NULL,
       primary_model NVARCHAR(100) NOT NULL,
       shadow_model NVARCHAR(100) NOT NULL,
       primary_action NVARCHAR(50) NULL,
       shadow_action NVARCHAR(50) NULL,
       actions_match BIT NULL,
       primary_confidence FLOAT NULL,
       shadow_confidence FLOAT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    // WP-RR: Add project_key to assignment log for multi-project round robin
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_assignment_log') AND name = 'project_key')
     ALTER TABLE agent_assignment_log ADD project_key NVARCHAR(10) NOT NULL DEFAULT 'NT';`,

    // ── A1: Backfill eval labels from existing approval data ──
    `UPDATE agent_decisions SET eval_label = 'correct'
     WHERE eval_label IS NULL AND approval_status = 'approved';`,

    `UPDATE agent_decisions SET eval_label = 'incorrect'
     WHERE eval_label IS NULL AND approval_status = 'declined';`,

    // ── Notifications table (H1) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'nova_notifications') AND type = 'U')
     CREATE TABLE nova_notifications (
       id INT IDENTITY(1,1) PRIMARY KEY,
       user_id INT NOT NULL,
       type VARCHAR(50) NOT NULL,
       title NVARCHAR(200) NOT NULL,
       body NVARCHAR(500) NULL,
       ticket_key VARCHAR(20) NULL,
       reference_id VARCHAR(50) NULL,
       [read] BIT DEFAULT 0,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_nova_notifications_user')
     CREATE INDEX IX_nova_notifications_user ON nova_notifications(user_id, [read], created_at DESC);`,

    // ── Triage tuning table (N1) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_triage_tuning') AND type = 'U')
     CREATE TABLE agent_triage_tuning (
       id INT IDENTITY(1,1) PRIMARY KEY,
       bucket VARCHAR(30) NOT NULL,
       pattern_description NVARCHAR(500) NULL,
       ticket_count INT NULL,
       example_ticket_keys NVARCHAR(500) NULL,
       suggested_fix NVARCHAR(1000) NULL,
       applied BIT DEFAULT 0,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    // ── Impact snapshots table (O1) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_impact_snapshots') AND type = 'U')
     CREATE TABLE agent_impact_snapshots (
       id INT IDENTITY(1,1) PRIMARY KEY,
       period_start DATE NOT NULL,
       period_end DATE NOT NULL,
       autonomous_resolution_rate FLOAT NULL,
       deflection_rate FLOAT NULL,
       queue_hours_saved FLOAT NULL,
       approval_rate FLOAT NULL,
       reversal_rate FLOAT NULL,
       assignment_automation_rate FLOAT NULL,
       kb_coverage_delta FLOAT NULL,
       escalation_accuracy FLOAT NULL,
       raw_data NVARCHAR(MAX) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    // ── KB drafts rejection columns (L1) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'kb_article_drafts') AND name = 'rejected_at')
     ALTER TABLE kb_article_drafts ADD rejected_at DATETIME2 NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'kb_article_drafts') AND name = 'rejection_reason')
     ALTER TABLE kb_article_drafts ADD rejection_reason NVARCHAR(500) NULL;`,

    // ── P5: nova_settings (settings store migration) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'nova_settings') AND type = 'U')
     CREATE TABLE nova_settings (
       setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
       setting_value NVARCHAR(MAX) NULL,
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    // ── P5: teams table extensions (department, manager) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'teams') AND name = 'department')
     ALTER TABLE teams ADD department NVARCHAR(100) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'teams') AND name = 'manager_user_id')
     ALTER TABLE teams ADD manager_user_id INT NULL;`,

    // Seed default teams if empty
    `IF NOT EXISTS (SELECT 1 FROM teams WHERE name = '2nd Line Technical Support')
     INSERT INTO teams (name, department, description) VALUES
       ('2nd Line Technical Support', 'Technical', 'T2 support team');`,
    `IF NOT EXISTS (SELECT 1 FROM teams WHERE name = '1st Line Customer Care')
     INSERT INTO teams (name, department, description) VALUES
       ('1st Line Customer Care', 'Support', 'CC front-line support');`,
    `IF NOT EXISTS (SELECT 1 FROM teams WHERE name = 'Digital Design')
     INSERT INTO teams (name, department, description) VALUES
       ('Digital Design', 'Digital', 'Digital design team');`,

    // ── P5: assignment_log — assignment_reason column ──
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_assignment_log') AND name = 'assignment_reason')
     ALTER TABLE agent_assignment_log ADD assignment_reason NVARCHAR(200) NULL;`,

    // ── P5: agent_decisions — novel type + learning columns ──
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_decisions') AND name = 'is_novel_type')
     ALTER TABLE agent_decisions ADD is_novel_type BIT DEFAULT 0;`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_decisions') AND name = 'learning_acquired_at')
     ALTER TABLE agent_decisions ADD learning_acquired_at DATETIME2 NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'agent_decisions') AND name = 'escalation_risk')
     ALTER TABLE agent_decisions ADD escalation_risk VARCHAR(20) NULL;`,

    // ── P5: Escalation predictions ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_escalation_predictions') AND type = 'U')
     CREATE TABLE agent_escalation_predictions (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key VARCHAR(20) NOT NULL,
       probability FLOAT NOT NULL,
       features_json NVARCHAR(MAX) NULL,
       reasoning NVARCHAR(MAX) NULL,
       predicted_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       actual_outcome VARCHAR(20) NULL,
       correct BIT NULL,
       resolved_at DATETIME2 NULL
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_esc_pred_ticket')
     CREATE INDEX IX_esc_pred_ticket ON agent_escalation_predictions(ticket_key);`,

    // ── P5: Incidents ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_incidents') AND type = 'U')
     CREATE TABLE agent_incidents (
       id INT IDENTITY(1,1) PRIMARY KEY,
       incident_key VARCHAR(20) NULL,
       summary NVARCHAR(500) NOT NULL,
       root_cause NVARCHAR(500) NULL,
       ticket_count INT NOT NULL,
       ticket_keys NVARCHAR(MAX) NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'open',
       detected_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       resolved_at DATETIME2 NULL,
       created_by VARCHAR(20) NOT NULL DEFAULT 'nova_ai'
     );`,

    // ── P5: SLA interventions log ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_sla_interventions') AND type = 'U')
     CREATE TABLE agent_sla_interventions (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key VARCHAR(20) NOT NULL,
       sla_type VARCHAR(30) NOT NULL,
       minutes_remaining INT NOT NULL,
       intervention_type VARCHAR(30) NOT NULL,
       detail NVARCHAR(500) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sla_interv_ticket')
     CREATE INDEX IX_sla_interv_ticket ON agent_sla_interventions(ticket_key, created_at);`,

    // ── P5: KB article usage tracking ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kb_article_usage') AND type = 'U')
     CREATE TABLE kb_article_usage (
       id INT IDENTITY(1,1) PRIMARY KEY,
       article_id VARCHAR(100) NOT NULL,
       article_title NVARCHAR(200) NULL,
       ticket_key VARCHAR(20) NOT NULL,
       used_in_response BIT NOT NULL DEFAULT 0,
       retrieved_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kb_usage_article')
     CREATE INDEX IX_kb_usage_article ON kb_article_usage(article_id, retrieved_at);`,

    // ── P5: KB article health ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kb_article_health') AND type = 'U')
     CREATE TABLE kb_article_health (
       id INT IDENTITY(1,1) PRIMARY KEY,
       article_id VARCHAR(100) NOT NULL,
       article_title NVARCHAR(200) NULL,
       space_key VARCHAR(10) NULL,
       status VARCHAR(20) NOT NULL,
       last_updated DATE NULL,
       usage_count_30d INT NULL,
       usage_count_90d INT NULL,
       drift_score FLOAT NULL,
       checked_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    // ── P5 Theme 2+3: Training signals, briefings, capacity, cross-functional ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_training_signals') AND type = 'U')
     CREATE TABLE agent_training_signals (
       id INT IDENTITY(1,1) PRIMARY KEY,
       agent_id VARCHAR(100) NOT NULL,
       agent_name NVARCHAR(100) NULL,
       signal_type VARCHAR(30) NOT NULL,
       request_type NVARCHAR(100) NULL,
       component NVARCHAR(100) NULL,
       metric_value FLOAT NULL,
       team_average FLOAT NULL,
       recommendation NVARCHAR(1000) NULL,
       example_tickets NVARCHAR(500) NULL,
       kb_article_link NVARCHAR(500) NULL,
       actioned BIT NOT NULL DEFAULT 0,
       generated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_training_signals_agent')
     CREATE INDEX IX_training_signals_agent ON agent_training_signals(agent_id, generated_at DESC);`,

    // ⚠ ORPHANED, deliberately. Nothing reads or writes this table since 2026-08-27:
    // Briefing121Service was a second 1-2-1 prep generator that never actually ran (it
    // was keyed on a display name where a Jira account id was needed, and held zero rows
    // in its whole life). Its useful signals now live in services/one21-prep-signals.ts,
    // folded into the prep that the day-before job really sends. Kept rather than
    // dropped — the migration is idempotent and an empty table costs nothing, whereas a
    // DROP in a startup migration is a destructive step nobody asked for.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_121_briefings') AND type = 'U')
     CREATE TABLE agent_121_briefings (
       id INT IDENTITY(1,1) PRIMARY KEY,
       manager_user_id INT NOT NULL,
       agent_id VARCHAR(100) NOT NULL,
       agent_name NVARCHAR(100) NULL,
       period_start DATE NULL,
       period_end DATE NULL,
       content_json NVARCHAR(MAX) NULL,
       generated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_121_briefings_agent')
     CREATE INDEX IX_121_briefings_agent ON agent_121_briefings(agent_id, generated_at DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'ops_meeting_packs') AND type = 'U')
     CREATE TABLE ops_meeting_packs (
       id INT IDENTITY(1,1) PRIMARY KEY,
       generated_by INT NULL,
       period_start DATE NULL,
       period_end DATE NULL,
       content_json NVARCHAR(MAX) NULL,
       generated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_capacity_forecasts') AND type = 'U')
     CREATE TABLE agent_capacity_forecasts (
       id INT IDENTITY(1,1) PRIMARY KEY,
       forecast_date DATE NOT NULL,
       day_of_week INT NULL,
       predicted_volume INT NULL,
       confidence_low INT NULL,
       confidence_high INT NULL,
       actual_volume INT NULL,
       team_capacity INT NULL,
       surplus_deficit INT NULL,
       generated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_capacity_forecast_date')
     CREATE INDEX IX_capacity_forecast_date ON agent_capacity_forecasts(forecast_date);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_cross_functional_signals') AND type = 'U')
     CREATE TABLE agent_cross_functional_signals (
       id INT IDENTITY(1,1) PRIMARY KEY,
       signal_type VARCHAR(30) NOT NULL,
       component NVARCHAR(100) NULL,
       title NVARCHAR(200) NULL,
       detail NVARCHAR(MAX) NULL,
       ticket_count INT NULL,
       customer_count INT NULL,
       trend VARCHAR(20) NULL,
       recommendation NVARCHAR(500) NULL,
       period_start DATE NULL,
       period_end DATE NULL,
       generated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cross_func_type')
     CREATE INDEX IX_cross_func_type ON agent_cross_functional_signals(signal_type, generated_at DESC);`,

    // kb_gap_log — add confluence_page_id for loop closure tracking
    `IF COL_LENGTH('kb_gap_log', 'confluence_page_id') IS NULL
     ALTER TABLE kb_gap_log ADD confluence_page_id VARCHAR(100) NULL;`,

    `IF COL_LENGTH('kb_gap_log', 'article_title') IS NULL
     ALTER TABLE kb_gap_log ADD article_title NVARCHAR(500) NULL;`,

    `IF COL_LENGTH('kb_gap_log', 'source') IS NULL
     ALTER TABLE kb_gap_log ADD source NVARCHAR(50) NULL;`,

    `IF COL_LENGTH('kb_gap_log', 'query_text') IS NULL
     ALTER TABLE kb_gap_log ADD query_text NVARCHAR(1000) NULL;`,

    // kb_article_health — add article_url for linking
    `IF COL_LENGTH('kb_article_health', 'article_url') IS NULL
     ALTER TABLE kb_article_health ADD article_url NVARCHAR(500) NULL;`,

    // kb_article_health + kb_article_usage — widen article_id from VARCHAR(100) to NVARCHAR(500)
    `IF COL_LENGTH('kb_article_health', 'article_id') IS NOT NULL
     ALTER TABLE kb_article_health ALTER COLUMN article_id NVARCHAR(500) NOT NULL;`,

    `IF COL_LENGTH('kb_article_usage', 'article_id') IS NOT NULL
     ALTER TABLE kb_article_usage ALTER COLUMN article_id NVARCHAR(500) NOT NULL;`,

    // ── P6: Customer Portal ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_organisations') AND type = 'U')
     CREATE TABLE portal_organisations (
       id INT IDENTITY(1,1) PRIMARY KEY,
       external_id NVARCHAR(255) NOT NULL UNIQUE,
       name NVARCHAR(255) NOT NULL,
       domain NVARCHAR(255) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_users') AND type = 'U')
     CREATE TABLE portal_users (
       id INT IDENTITY(1,1) PRIMARY KEY,
       external_id NVARCHAR(255) NOT NULL UNIQUE,
       org_id INT NOT NULL REFERENCES portal_organisations(id),
       email NVARCHAR(255) NOT NULL,
       display_name NVARCHAR(255) NOT NULL,
       avatar_url NVARCHAR(500) NULL,
       role NVARCHAR(50) DEFAULT 'requester',
       last_login DATETIME2 DEFAULT GETUTCDATE(),
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF COL_LENGTH('portal_users', 'refresh_token') IS NULL
     ALTER TABLE portal_users ADD refresh_token NVARCHAR(2000) NULL;`,

    `IF COL_LENGTH('portal_users', 'token_expires_at') IS NULL
     ALTER TABLE portal_users ADD token_expires_at DATETIME2 NULL;`,

    `IF COL_LENGTH('portal_users', 'password_hash') IS NULL
     ALTER TABLE portal_users ADD password_hash NVARCHAR(255) NULL;`,

    `IF COL_LENGTH('portal_users', 'auth_type') IS NULL
     ALTER TABLE portal_users ADD auth_type NVARCHAR(20) NOT NULL CONSTRAINT DF_portal_users_auth_type DEFAULT 'oidc';`,

    `IF COL_LENGTH('portal_users', 'access_state') IS NULL
     ALTER TABLE portal_users ADD access_state NVARCHAR(20) NOT NULL CONSTRAINT DF_portal_users_access_state DEFAULT 'active';`,

    `IF COL_LENGTH('portal_users', 'disabled_at') IS NULL
     ALTER TABLE portal_users ADD disabled_at DATETIME2 NULL;`,

    `IF COL_LENGTH('portal_users', 'removed_at') IS NULL
     ALTER TABLE portal_users ADD removed_at DATETIME2 NULL;`,

    `UPDATE portal_users
     SET auth_type = CASE
       WHEN external_id LIKE 'nova-user-%' THEN 'internal'
       WHEN auth_type IS NULL OR auth_type = '' THEN 'oidc'
       ELSE auth_type
     END
     WHERE auth_type IS NULL
        OR auth_type = ''
        OR (external_id LIKE 'nova-user-%' AND auth_type <> 'internal');`,

    `UPDATE portal_users
     SET access_state = 'active'
     WHERE access_state IS NULL OR access_state = '';`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_chat_sessions') AND type = 'U')
     CREATE TABLE portal_chat_sessions (
       id INT IDENTITY(1,1) PRIMARY KEY,
       portal_user_id INT NOT NULL REFERENCES portal_users(id),
       jira_issue_key NVARCHAR(50) NULL,
       status NVARCHAR(50) DEFAULT 'active',
       started_at DATETIME2 DEFAULT GETUTCDATE(),
       ended_at DATETIME2 NULL,
       metadata NVARCHAR(MAX) NULL
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_chat_messages') AND type = 'U')
     CREATE TABLE portal_chat_messages (
       id INT IDENTITY(1,1) PRIMARY KEY,
       session_id INT NOT NULL REFERENCES portal_chat_sessions(id),
       role NVARCHAR(20) NOT NULL,
       content NVARCHAR(MAX) NOT NULL,
       metadata NVARCHAR(MAX) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_form_submissions') AND type = 'U')
     CREATE TABLE portal_form_submissions (
       id INT IDENTITY(1,1) PRIMARY KEY,
       portal_user_id INT NOT NULL REFERENCES portal_users(id),
       jira_issue_key NVARCHAR(50) NULL,
       form_data NVARCHAR(MAX) NOT NULL,
       category NVARCHAR(255) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_analytics') AND type = 'U')
     CREATE TABLE portal_analytics (
       id INT IDENTITY(1,1) PRIMARY KEY,
       event_type NVARCHAR(50) NOT NULL,
       portal_user_id INT NULL,
       org_id INT NULL,
       metadata NVARCHAR(MAX) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_analytics_event')
     CREATE INDEX IX_portal_analytics_event ON portal_analytics(event_type, created_at);`,

    // BC Account Number on portal_organisations — customer key for the
    // Onboarding/Support dashboards. Scopes jira_issue_cache by customfield_14626.
    `IF COL_LENGTH('portal_organisations', 'bc_account_number') IS NULL
     ALTER TABLE portal_organisations ADD bc_account_number NVARCHAR(100) NULL;`,

    // Reporter identities that also belong to this customer (mirrors the
    // "reporter IN (...)" branch of the source JQL). Newline/comma-separated list
    // of emails, display names, or account ids — matched against reporter_* cols.
    `IF COL_LENGTH('portal_organisations', 'scope_reporters') IS NULL
     ALTER TABLE portal_organisations ADD scope_reporters NVARCHAR(MAX) NULL;`,

    // Marks a portal user as a "head office" contact to auto-include whenever an
    // Onboarding Request is set up for their org.
    `IF COL_LENGTH('portal_users', 'include_in_setup') IS NULL
     ALTER TABLE portal_users ADD include_in_setup BIT NOT NULL CONSTRAINT DF_portal_users_include_setup DEFAULT 0;`,

    // Per-org portal feature toggles. Get Help + KB default on (existing behaviour);
    // the customer Support/Onboarding dashboards default off (opt-in per customer).
    `IF COL_LENGTH('portal_organisations', 'feat_get_help') IS NULL
     ALTER TABLE portal_organisations ADD feat_get_help BIT NOT NULL CONSTRAINT DF_portal_org_get_help DEFAULT 1;`,
    `IF COL_LENGTH('portal_organisations', 'feat_kb') IS NULL
     ALTER TABLE portal_organisations ADD feat_kb BIT NOT NULL CONSTRAINT DF_portal_org_kb DEFAULT 1;`,
    `IF COL_LENGTH('portal_organisations', 'feat_support') IS NULL
     ALTER TABLE portal_organisations ADD feat_support BIT NOT NULL CONSTRAINT DF_portal_org_support DEFAULT 0;`,
    `IF COL_LENGTH('portal_organisations', 'feat_onboarding') IS NULL
     ALTER TABLE portal_organisations ADD feat_onboarding BIT NOT NULL CONSTRAINT DF_portal_org_onboarding DEFAULT 0;`,
    // Guild / Fine & Country "Raise a Ticket" intake — opt-in per customer.
    `IF COL_LENGTH('portal_organisations', 'feat_raise_ticket') IS NULL
     ALTER TABLE portal_organisations ADD feat_raise_ticket BIT NOT NULL CONSTRAINT DF_portal_org_raise_ticket DEFAULT 0;`,

    // Per-org onboarding escalation policy (JSON: enabled, workingDays, levels[]).
    // Configured by org admins; drives scheduled progress updates + escalations.
    `IF COL_LENGTH('portal_organisations', 'escalation_policy') IS NULL
     ALTER TABLE portal_organisations ADD escalation_policy NVARCHAR(MAX) NULL;`,

    // Dedup / audit log for the escalation engine — one row per (org, ticket,
    // level day, kind) so each level fires exactly once per onboarding.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_escalation_log') AND type = 'U')
     CREATE TABLE onboarding_escalation_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       org_id INT NOT NULL,
       ticket_key NVARCHAR(50) NOT NULL,
       level_day INT NOT NULL,
       kind NVARCHAR(30) NOT NULL,
       recipients NVARCHAR(MAX) NULL,
       fired_at DATETIME2 DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_onboarding_escalation UNIQUE (org_id, ticket_key, level_day, kind)
     );`,

    // Which routes the "Raise a Ticket" top-of-form selector offers this org.
    // CSV of {support, development, onboarding}. NULL/empty → the default pair
    // (support,development) so existing orgs behave exactly as before.
    `IF COL_LENGTH('portal_organisations', 'support_routes') IS NULL
     ALTER TABLE portal_organisations ADD support_routes NVARCHAR(200) NULL;`,

    // One-time backfill: the code default is now Support-only, but orgs that were
    // already live on the Raise-a-Ticket form (feat_raise_ticket = 1) before this
    // column existed relied on the old support+development default. Pin them to
    // both so their behaviour is unchanged. Only fills NULLs — never overrides an
    // admin's explicit choice, and won't re-run once set.
    `UPDATE portal_organisations
     SET support_routes = 'support,development'
     WHERE feat_raise_ticket = 1 AND support_routes IS NULL;`,

    // Per-org branding — auto-suggested from the org's website, admin-editable,
    // applied to the portal shell (logo, primary/secondary colours, font).
    `IF COL_LENGTH('portal_organisations', 'brand_website_url') IS NULL
     ALTER TABLE portal_organisations ADD brand_website_url NVARCHAR(500) NULL;`,
    `IF COL_LENGTH('portal_organisations', 'brand_logo_url') IS NULL
     ALTER TABLE portal_organisations ADD brand_logo_url NVARCHAR(MAX) NULL;`,
    `IF COL_LENGTH('portal_organisations', 'brand_primary') IS NULL
     ALTER TABLE portal_organisations ADD brand_primary NVARCHAR(20) NULL;`,
    `IF COL_LENGTH('portal_organisations', 'brand_secondary') IS NULL
     ALTER TABLE portal_organisations ADD brand_secondary NVARCHAR(20) NULL;`,
    `IF COL_LENGTH('portal_organisations', 'brand_font') IS NULL
     ALTER TABLE portal_organisations ADD brand_font NVARCHAR(100) NULL;`,

    // Shared address(es) copied on every ticket raised for this org (added as
    // JSM request participants alongside any user-entered CC). Comma-separated.
    `IF COL_LENGTH('portal_organisations', 'support_cc_email') IS NULL
     ALTER TABLE portal_organisations ADD support_cc_email NVARCHAR(400) NULL;`,

    // Guild/BYM onboarding (backlog #8) — per-org enable toggles (set by the
    // portal admin in Portal Admin → Org) + org recipient config (set by the
    // org's own admin on the "Onboarding Configuration" portal page, JSON:
    // { inboxEmail, digestRecipients, intsNudgeEmail, intsLeadEmail, intsManagerEmail }).
    `IF COL_LENGTH('portal_organisations', 'guild_onboarding_enabled') IS NULL
     ALTER TABLE portal_organisations ADD guild_onboarding_enabled BIT NOT NULL CONSTRAINT DF_portal_org_guild_ob DEFAULT 0;`,
    `IF COL_LENGTH('portal_organisations', 'guild_digest_enabled') IS NULL
     ALTER TABLE portal_organisations ADD guild_digest_enabled BIT NOT NULL CONSTRAINT DF_portal_org_guild_digest DEFAULT 0;`,
    `IF COL_LENGTH('portal_organisations', 'guild_ints_escalations_enabled') IS NULL
     ALTER TABLE portal_organisations ADD guild_ints_escalations_enabled BIT NOT NULL CONSTRAINT DF_portal_org_guild_ints DEFAULT 0;`,
    `IF COL_LENGTH('portal_organisations', 'onboarding_config') IS NULL
     ALTER TABLE portal_organisations ADD onboarding_config NVARCHAR(MAX) NULL;`,
    // Archive hides an inactive org from the Portal Admin list without deleting
    // it — deletion has to unpick every dependent row and times out on big orgs.
    `IF COL_LENGTH('portal_organisations', 'archived') IS NULL
     ALTER TABLE portal_organisations ADD archived BIT NOT NULL CONSTRAINT DF_portal_org_archived DEFAULT 0;`,
    // eXp "new agent joining" onboarding (NT-24880) — a simplified sibling of the
    // Guild pipeline: one submission per agent, QA + Onboarding ticket pair.
    `IF COL_LENGTH('portal_organisations', 'exp_onboarding_enabled') IS NULL
     ALTER TABLE portal_organisations ADD exp_onboarding_enabled BIT NOT NULL CONSTRAINT DF_portal_org_exp_ob DEFAULT 0;`,

    // Portal escalations — links an original ticket to the Escalation request a
    // manager raised from it, so the portal can show/open the escalation.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_escalations') AND type = 'U')
     CREATE TABLE portal_escalations (
       id INT IDENTITY(1,1) PRIMARY KEY,
       original_key NVARCHAR(30) NOT NULL,
       escalation_key NVARCHAR(30) NOT NULL,
       org_id INT NULL,
       created_by_email NVARCHAR(255) NULL,
       reason NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_escalations_original')
     CREATE INDEX IX_portal_escalations_original ON portal_escalations (original_key);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_org_jira_mapping') AND type = 'U')
     CREATE TABLE portal_org_jira_mapping (
       id INT IDENTITY(1,1) PRIMARY KEY,
       org_id INT NOT NULL REFERENCES portal_organisations(id),
       jira_organisation_id NVARCHAR(255) NULL,
       jira_email_domain NVARCHAR(255) NULL,
       CONSTRAINT UQ_portal_org_jira_mapping UNIQUE(org_id)
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_kb_articles') AND type = 'U')
     CREATE TABLE portal_kb_articles (
       id INT IDENTITY(1,1) PRIMARY KEY,
       confluence_page_id NVARCHAR(50) NOT NULL UNIQUE,
       title NVARCHAR(500) NOT NULL,
       body_html NVARCHAR(MAX) NOT NULL,
       body_text NVARCHAR(MAX) NOT NULL,
       category NVARCHAR(255) NULL,
       labels NVARCHAR(500) NULL,
       published_at DATETIME2 NOT NULL,
       updated_at DATETIME2 NOT NULL,
       view_count INT DEFAULT 0,
       helpful_yes INT DEFAULT 0,
       helpful_no INT DEFAULT 0,
       synced_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_chat_sessions_user')
     CREATE INDEX IX_portal_chat_sessions_user ON portal_chat_sessions(portal_user_id, started_at DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_chat_messages_session')
     CREATE INDEX IX_portal_chat_messages_session ON portal_chat_messages(session_id, created_at);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_users_org')
     CREATE INDEX IX_portal_users_org ON portal_users(org_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_users_email_auth')
     CREATE INDEX IX_portal_users_email_auth ON portal_users(email, auth_type, access_state);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_kb_articles_category')
     CREATE INDEX IX_portal_kb_articles_category ON portal_kb_articles(category);`,

    // ── Quality Hardening Phase 1 ──

    // Gap 1: Escalation Policy Log
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_escalation_policy_log') AND type = 'U')
     CREATE TABLE agent_escalation_policy_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key VARCHAR(20) NOT NULL,
       original_action VARCHAR(30) NOT NULL,
       final_action VARCHAR(30) NOT NULL,
       evidence_score FLOAT NOT NULL,
       policy_result VARCHAR(20) NOT NULL,
       reason NVARCHAR(500),
       suggestion VARCHAR(30),
       evaluated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    // Gap 7: Cross-functional signals — actionable workflow columns
    `IF COL_LENGTH('agent_cross_functional_signals', 'owner') IS NULL
     ALTER TABLE agent_cross_functional_signals ADD owner NVARCHAR(100) NULL;`,
    `IF COL_LENGTH('agent_cross_functional_signals', 'status') IS NULL
     ALTER TABLE agent_cross_functional_signals ADD status VARCHAR(20) DEFAULT 'new';`,
    `IF COL_LENGTH('agent_cross_functional_signals', 'jira_ticket_key') IS NULL
     ALTER TABLE agent_cross_functional_signals ADD jira_ticket_key VARCHAR(20) NULL;`,
    `IF COL_LENGTH('agent_cross_functional_signals', 'actioned_at') IS NULL
     ALTER TABLE agent_cross_functional_signals ADD actioned_at DATETIME2 NULL;`,
    `IF COL_LENGTH('agent_cross_functional_signals', 'outcome') IS NULL
     ALTER TABLE agent_cross_functional_signals ADD outcome NVARCHAR(500) NULL;`,
    `IF COL_LENGTH('agent_cross_functional_signals', 'volume_after') IS NULL
     ALTER TABLE agent_cross_functional_signals ADD volume_after INT NULL;`,

    // Gap 8: Tuning Signals
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agent_tuning_signals') AND type = 'U')
     CREATE TABLE agent_tuning_signals (
       id INT IDENTITY(1,1) PRIMARY KEY,
       category NVARCHAR(100) NOT NULL,
       signal_type VARCHAR(30) NOT NULL,
       bias_instruction NVARCHAR(500) NOT NULL,
       strength FLOAT NOT NULL,
       sample_size INT NOT NULL,
       active BIT DEFAULT 1,
       generated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    // Gap 6: KB effectiveness columns
    `IF COL_LENGTH('portal_kb_articles', 'deflection_count') IS NULL
     ALTER TABLE portal_kb_articles ADD deflection_count INT DEFAULT 0;`,
    `IF COL_LENGTH('portal_kb_articles', 'failed_deflection_count') IS NULL
     ALTER TABLE portal_kb_articles ADD failed_deflection_count INT DEFAULT 0;`,

    // Full-text catalog and index for KB article search
    `IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'portal_kb_ft_catalog')
     CREATE FULLTEXT CATALOG portal_kb_ft_catalog;`,
    `IF NOT EXISTS (SELECT 1 FROM sys.fulltext_indexes WHERE object_id = OBJECT_ID('portal_kb_articles'))
     BEGIN
       DECLARE @pk_name NVARCHAR(128);
       SELECT @pk_name = i.name FROM sys.indexes i
       WHERE i.object_id = OBJECT_ID('portal_kb_articles') AND i.is_primary_key = 1;
       IF @pk_name IS NOT NULL
         EXEC('CREATE FULLTEXT INDEX ON portal_kb_articles(title, body_text) KEY INDEX ' + @pk_name + ' ON portal_kb_ft_catalog WITH CHANGE_TRACKING AUTO');
     END;`,

    // Gap 4: Portal chat session metadata column
    `IF COL_LENGTH('portal_chat_sessions', 'metadata') IS NULL
     ALTER TABLE portal_chat_sessions ADD metadata NVARCHAR(MAX) NULL;`,

    // Portal chat message metadata (for summary cards etc.)
    `IF COL_LENGTH('portal_chat_messages', 'metadata') IS NULL
     ALTER TABLE portal_chat_messages ADD metadata NVARCHAR(MAX) NULL;`,

    // Per-decision time saved tracking
    `IF COL_LENGTH('agent_decisions', 'estimated_minutes_saved') IS NULL
     ALTER TABLE agent_decisions ADD estimated_minutes_saved FLOAT NULL;`,

    // BC Account Number on jira_issue_cache
    `IF COL_LENGTH('jira_issue_cache', 'bc_account_number') IS NULL
     ALTER TABLE jira_issue_cache ADD bc_account_number NVARCHAR(100) NULL;`,

    // Snag 13: Route approvals to assigned agent's My Tickets
    `IF COL_LENGTH('approval_queue', 'assigned_agent') IS NULL
     ALTER TABLE approval_queue ADD assigned_agent NVARCHAR(200) NULL;`,

    // CSAT surveys
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'portal_csat_surveys')
     CREATE TABLE portal_csat_surveys (
       id INT IDENTITY(1,1) PRIMARY KEY,
       token NVARCHAR(64) NOT NULL UNIQUE,
       jira_issue_key NVARCHAR(50) NOT NULL,
       portal_user_id INT NULL REFERENCES portal_users(id),
       org_id INT NULL,
       csat_score INT NULL,
       ease_score INT NULL,
       effort_score INT NULL,
       comment NVARCHAR(MAX) NULL,
       sent_at DATETIME2 DEFAULT GETUTCDATE(),
       responded_at DATETIME2 NULL,
       expires_at DATETIME2 NOT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    // CSAT lifecycle context — captured at the moment the rating is submitted, so
    // ratings taken at any ticket state/age become signal (trends across lifecycle).
    `IF COL_LENGTH('portal_csat_surveys', 'ticket_status') IS NULL
     ALTER TABLE portal_csat_surveys ADD ticket_status NVARCHAR(100) NULL;`,
    `IF COL_LENGTH('portal_csat_surveys', 'ticket_status_category') IS NULL
     ALTER TABLE portal_csat_surveys ADD ticket_status_category NVARCHAR(50) NULL;`,
    `IF COL_LENGTH('portal_csat_surveys', 'ticket_resolved') IS NULL
     ALTER TABLE portal_csat_surveys ADD ticket_resolved BIT NULL;`,
    `IF COL_LENGTH('portal_csat_surveys', 'ticket_created') IS NULL
     ALTER TABLE portal_csat_surveys ADD ticket_created DATETIME2 NULL;`,
    `IF COL_LENGTH('portal_csat_surveys', 'ticket_resolved_at') IS NULL
     ALTER TABLE portal_csat_surveys ADD ticket_resolved_at DATETIME2 NULL;`,
    `IF COL_LENGTH('portal_csat_surveys', 'ticket_age_hours') IS NULL
     ALTER TABLE portal_csat_surveys ADD ticket_age_hours INT NULL;`,

    // Re-rating: a customer may change their mind or fix a mis-tap. The live
    // columns hold the CURRENT rating; these keep the original so a change of
    // heart is visible rather than silently overwritten.
    // Every CSAT read joins surveys to tickets by issue key, and the table had no
    // index on it — only the PK on id and the unique token. Small (3MB) but the
    // join sits inside queries that are already fighting for I/O.
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_csat_surveys_issue')
     CREATE INDEX IX_portal_csat_surveys_issue ON portal_csat_surveys (jira_issue_key)
       INCLUDE (csat_score, responded_at);`,

    `IF COL_LENGTH('portal_csat_surveys', 'first_csat_score') IS NULL
     ALTER TABLE portal_csat_surveys ADD first_csat_score INT NULL;`,
    `IF COL_LENGTH('portal_csat_surveys', 'first_responded_at') IS NULL
     ALTER TABLE portal_csat_surveys ADD first_responded_at DATETIME2 NULL;`,
    `IF COL_LENGTH('portal_csat_surveys', 'revision_count') IS NULL
     ALTER TABLE portal_csat_surveys ADD revision_count INT NOT NULL DEFAULT 0;`,

    // ── Multi-org membership ──
    // portal_users.org_id remains the user's HOME org (the one they land in, and the
    // one they can write to). This table adds any *additional* orgs they may switch
    // into. Internal staff don't need rows here — they get read-only view-as access
    // to every org (see portal-org-membership.ts). Rows are for genuine membership,
    // e.g. a customer group whose person legitimately oversees several brands.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_user_orgs') AND type = 'U')
     CREATE TABLE portal_user_orgs (
       id INT IDENTITY(1,1) PRIMARY KEY,
       portal_user_id INT NOT NULL REFERENCES portal_users(id),
       org_id INT NOT NULL REFERENCES portal_organisations(id),
       role NVARCHAR(50) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_portal_user_orgs UNIQUE (portal_user_id, org_id)
     );`,

    // ── Assignment retry queue — unassigned tickets queued for automatic retry ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'assignment_retry_queue') AND type = 'U')
     CREATE TABLE assignment_retry_queue (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_key NVARCHAR(50) NOT NULL,
       pool NVARCHAR(20) NOT NULL DEFAULT 'cc',
       project_key NVARCHAR(20) NOT NULL DEFAULT 'NT',
       retry_count INT NOT NULL DEFAULT 0,
       max_retries INT NOT NULL DEFAULT 5,
       last_error NVARCHAR(500) NULL,
       resolved BIT NOT NULL DEFAULT 0,
       resolved_reason NVARCHAR(100) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_retry_queue_ticket UNIQUE (ticket_key)
     );`,

    // ── Delivery entries (was only in 001-sqlite-to-mssql.sql, never in startup migrations) ──
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_entries') AND type = 'U')
     CREATE TABLE delivery_entries (
       id INT IDENTITY(1,1) PRIMARY KEY,
       product NVARCHAR(200) NOT NULL,
       account NVARCHAR(500) NOT NULL,
       status NVARCHAR(100) DEFAULT '',
       onboarder NVARCHAR(200) NULL,
       order_date NVARCHAR(50) NULL,
       go_live_date NVARCHAR(50) NULL,
       predicted_delivery NVARCHAR(50) NULL,
       branches INT NULL,
       mrr DECIMAL(18,4) NULL,
       incremental DECIMAL(18,4) NULL,
       licence_fee DECIMAL(18,4) NULL,
       notes NVARCHAR(MAX) NULL,
       training_date NVARCHAR(50) NULL,
       is_starred INT DEFAULT 0,
       star_scope NVARCHAR(10) DEFAULT 'me',
       starred_by INT NULL,
       onboarding_id NVARCHAR(50) NULL,
       sale_type NVARCHAR(200) NULL,
       crm_customer_id INT NULL,
       azdo_branch_name NVARCHAR(200) NULL,
       azdo_pr_url NVARCHAR(2000) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    // Per-term target field: the exact Adobe form-field name this term should merge
    // into (e.g. 'Contract Terms BYM'). Lets different pre-approved terms land in
    // different fields. NULL = fall back to the prefix behaviour (any field starting
    // with the configured terms prefix), preserving the original single-blob model.
    `IF COL_LENGTH('contract_terms', 'target_field') IS NULL
     ALTER TABLE contract_terms ADD target_field NVARCHAR(300) NULL;`,

    // Extra BC customer fields used to pre-populate Adobe Sign contract templates
    // (REG NO, address line 2, postcode, county/state, primary contact name).
    `IF COL_LENGTH('bc_customers', 'address_line_2') IS NULL
     ALTER TABLE bc_customers ADD address_line_2 NVARCHAR(200) NULL;`,
    `IF COL_LENGTH('bc_customers', 'postal_code') IS NULL
     ALTER TABLE bc_customers ADD postal_code NVARCHAR(50) NULL;`,
    `IF COL_LENGTH('bc_customers', 'state') IS NULL
     ALTER TABLE bc_customers ADD state NVARCHAR(100) NULL;`,
    `IF COL_LENGTH('bc_customers', 'tax_registration_number') IS NULL
     ALTER TABLE bc_customers ADD tax_registration_number NVARCHAR(100) NULL;`,
    `IF COL_LENGTH('bc_customers', 'primary_contact_name') IS NULL
     ALTER TABLE bc_customers ADD primary_contact_name NVARCHAR(200) NULL;`,
    // Company registration number (Companies House-style — separate from VAT).
    // Populated from BC's 'registrationNumber' (Invoicing fast-tab) OR
    // 'companyRegistrationNumber' (Credit Control) — sync coalesces the two.
    `IF COL_LENGTH('bc_customers', 'company_registration_number') IS NULL
     ALTER TABLE bc_customers ADD company_registration_number NVARCHAR(100) NULL;`,

    // Post-sign capture columns on adobe_sign_agreements. Set when an agreement
    // transitions to SIGNED — used as the raw material for downstream BC write-back.
    //   bc_customer_id      — BC customer this agreement is for (set at create time, never null after sign)
    //   signed_form_data    — JSON: {fieldName: value} parsed from Adobe's formData CSV
    //   signed_pdf_path     — local path to combinedDocument PDF, relative to data dir
    //   signed_at           — timestamp the transition was detected (NOVA-side, not Adobe-side)
    `IF COL_LENGTH('adobe_sign_agreements', 'bc_customer_id') IS NULL
     ALTER TABLE adobe_sign_agreements ADD bc_customer_id NVARCHAR(200) NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'signed_form_data') IS NULL
     ALTER TABLE adobe_sign_agreements ADD signed_form_data NVARCHAR(MAX) NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'signed_pdf_path') IS NULL
     ALTER TABLE adobe_sign_agreements ADD signed_pdf_path NVARCHAR(500) NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'signed_at') IS NULL
     ALTER TABLE adobe_sign_agreements ADD signed_at DATETIME2 NULL;`,

    // Subscription contract number assigned at agreement-create time. Format
    // 'NOVA-NNNNNNNNNN' (10-digit zero-padded counter from the counters table).
    // Drives the BC subscription import write later.
    `IF COL_LENGTH('adobe_sign_agreements', 'subscription_contract_no') IS NULL
     ALTER TABLE adobe_sign_agreements ADD subscription_contract_no NVARCHAR(50) NULL;`,

    // BC subscription import tracking. bc_imported_at is set when the post-sign
    // (or manual) handler successfully writes the agreement's header row to BC's
    // importedCustomerSubscriptionContracts staging table. bc_import_error stores
    // the last failure message so the wizard / admin can see what went wrong and
    // retry. Both stay NULL on a fresh agreement.
    `IF COL_LENGTH('adobe_sign_agreements', 'bc_imported_at') IS NULL
     ALTER TABLE adobe_sign_agreements ADD bc_imported_at DATETIME2 NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'bc_import_error') IS NULL
     ALTER TABLE adobe_sign_agreements ADD bc_import_error NVARCHAR(MAX) NULL;`,

    // Contract-approval hold columns. When a sender types CUSTOM contract terms
    // (free text into a 'contract terms…' field, as opposed to picking pre-approved
    // terms) and the Contract Approvals integration is enabled, the agreement is NOT
    // sent to Adobe immediately. Instead a held row is written here with a synthetic
    // agreement_id ('PENDING-…'), status 'OUT_FOR_APPROVAL', and the full intended
    // create-agreement payload in approval_payload. A webhook fires to Power Automate;
    // the callback releases (→ Adobe, agreement_id rewritten to the real id, status
    // 'OUT_FOR_SIGNATURE', approval_status 'APPROVED') or rejects (status
    // 'APPROVAL_REJECTED'). approval_token is the unguessable capability used in the
    // webhook + callback. All NULL for normally-sent agreements.
    `IF COL_LENGTH('adobe_sign_agreements', 'approval_token') IS NULL
     ALTER TABLE adobe_sign_agreements ADD approval_token NVARCHAR(100) NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'approval_status') IS NULL
     ALTER TABLE adobe_sign_agreements ADD approval_status NVARCHAR(20) NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'approval_payload') IS NULL
     ALTER TABLE adobe_sign_agreements ADD approval_payload NVARCHAR(MAX) NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'approval_terms_text') IS NULL
     ALTER TABLE adobe_sign_agreements ADD approval_terms_text NVARCHAR(MAX) NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'approval_requested_by') IS NULL
     ALTER TABLE adobe_sign_agreements ADD approval_requested_by NVARCHAR(200) NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'approval_requested_at') IS NULL
     ALTER TABLE adobe_sign_agreements ADD approval_requested_at DATETIME2 NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'approval_decided_by') IS NULL
     ALTER TABLE adobe_sign_agreements ADD approval_decided_by NVARCHAR(200) NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'approval_decided_at') IS NULL
     ALTER TABLE adobe_sign_agreements ADD approval_decided_at DATETIME2 NULL;`,
    `IF COL_LENGTH('adobe_sign_agreements', 'approval_note') IS NULL
     ALTER TABLE adobe_sign_agreements ADD approval_note NVARCHAR(MAX) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_adobe_sign_agreements_approval_token')
     CREATE INDEX IX_adobe_sign_agreements_approval_token ON adobe_sign_agreements(approval_token) WHERE approval_token IS NOT NULL;`,

    // Manual availability overrides: 'manual' rows are never overwritten by the
    // People HR sync, so a same-day correction survives until the date rolls over.
    `IF COL_LENGTH('agent_availability', 'source') IS NULL
     ALTER TABLE agent_availability ADD source NVARCHAR(20) NOT NULL DEFAULT 'peoplehr';`,
    `IF COL_LENGTH('agent_availability', 'set_by') IS NULL
     ALTER TABLE agent_availability ADD set_by NVARCHAR(100) NULL;`,

    // Atomic counters for NOVA-generated sequence numbers (e.g. subscription
    // contract numbers). Use BCQueries.nextCounterValue to increment + read in
    // one MERGE statement so concurrent agreement creates never collide.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'counters') AND type = 'U')
     CREATE TABLE counters (
       name  NVARCHAR(50) NOT NULL PRIMARY KEY,
       value BIGINT       NOT NULL DEFAULT 0
     );`,

    // Per-field record of every value captured for an Adobe agreement.
    // Written at SEND time (source=SENDER) by the create-agreement route, and at
    // SIGN time (source=SIGNER) by the post-sign handler. This is the
    // authoritative store for BC subscription mapping — never rely on Adobe's
    // formData CSV directly.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agreement_field_values') AND type = 'U')
     CREATE TABLE agreement_field_values (
       id           INT IDENTITY(1,1) PRIMARY KEY,
       agreement_id NVARCHAR(200) NOT NULL,
       field_name   NVARCHAR(200) NOT NULL,
       field_value  NVARCHAR(MAX) NULL,
       source       NVARCHAR(20)  NOT NULL,
       captured_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agreement_field_values_agreement_id')
     CREATE INDEX IX_agreement_field_values_agreement_id ON agreement_field_values(agreement_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_product' AND object_id = OBJECT_ID('delivery_entries'))
     CREATE NONCLUSTERED INDEX IX_delivery_product ON delivery_entries(product);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_onboarding_id' AND object_id = OBJECT_ID('delivery_entries'))
     CREATE UNIQUE NONCLUSTERED INDEX IX_delivery_onboarding_id ON delivery_entries(onboarding_id) WHERE onboarding_id IS NOT NULL;`,

    // ══════════════════════════════════════════════════════════════════════════
    // Tables from 001-sqlite-to-mssql.sql that were never in startup migrations
    // ══════════════════════════════════════════════════════════════════════════

    // ── Core tables ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'tasks') AND type = 'U')
     CREATE TABLE tasks (
       id NVARCHAR(200) NOT NULL PRIMARY KEY,
       source NVARCHAR(50) NOT NULL,
       source_id NVARCHAR(200) NULL,
       source_url NVARCHAR(2000) NULL,
       title NVARCHAR(500) NOT NULL,
       description NVARCHAR(MAX) NULL,
       status NVARCHAR(50) DEFAULT 'open',
       priority INT DEFAULT 50,
       due_date NVARCHAR(50) NULL,
       sla_breach_at NVARCHAR(50) NULL,
       category NVARCHAR(200) NULL,
       is_pinned INT DEFAULT 0,
       snoozed_until NVARCHAR(50) NULL,
       last_synced NVARCHAR(50) NULL,
       raw_data NVARCHAR(MAX) NULL,
       transient INT DEFAULT 0,
       user_id INT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_source' AND object_id = OBJECT_ID('tasks'))
     CREATE NONCLUSTERED INDEX IX_tasks_source ON tasks(source);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_status' AND object_id = OBJECT_ID('tasks'))
     CREATE NONCLUSTERED INDEX IX_tasks_status ON tasks(status);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_priority' AND object_id = OBJECT_ID('tasks'))
     CREATE NONCLUSTERED INDEX IX_tasks_priority ON tasks(priority DESC);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_due_date' AND object_id = OBJECT_ID('tasks'))
     CREATE NONCLUSTERED INDEX IX_tasks_due_date ON tasks(due_date);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_sla_breach' AND object_id = OBJECT_ID('tasks'))
     CREATE NONCLUSTERED INDEX IX_tasks_sla_breach ON tasks(sla_breach_at);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_user' AND object_id = OBJECT_ID('tasks'))
     CREATE NONCLUSTERED INDEX IX_tasks_user ON tasks(user_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'rituals') AND type = 'U')
     CREATE TABLE rituals (
       id INT IDENTITY(1,1) PRIMARY KEY,
       type NVARCHAR(50) NOT NULL,
       date NVARCHAR(50) NOT NULL,
       conversation NVARCHAR(MAX) NULL,
       summary_md NVARCHAR(MAX) NULL,
       planned_items NVARCHAR(MAX) NULL,
       completed_items NVARCHAR(MAX) NULL,
       blockers NVARCHAR(MAX) NULL,
       openai_response_id NVARCHAR(200) NULL,
       user_id INT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_rituals_type_date' AND object_id = OBJECT_ID('rituals'))
     CREATE NONCLUSTERED INDEX IX_rituals_type_date ON rituals(type, date);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_rituals_user' AND object_id = OBJECT_ID('rituals'))
     CREATE NONCLUSTERED INDEX IX_rituals_user ON rituals(user_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'settings') AND type = 'U')
     CREATE TABLE settings (
       [key] NVARCHAR(200) NOT NULL PRIMARY KEY,
       value NVARCHAR(MAX) NULL,
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'teams') AND type = 'U')
     CREATE TABLE teams (
       id INT IDENTITY(1,1) PRIMARY KEY,
       name NVARCHAR(200) NOT NULL UNIQUE,
       description NVARCHAR(MAX) NULL,
       jira_products NVARCHAR(MAX) NULL,
       jira_project_key NVARCHAR(20) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'feedback') AND type = 'U')
     CREATE TABLE feedback (
       id INT IDENTITY(1,1) PRIMARY KEY,
       user_id INT NOT NULL,
       type NVARCHAR(50) NOT NULL,
       title NVARCHAR(500) NOT NULL,
       description NVARCHAR(MAX) NULL,
       status NVARCHAR(50) DEFAULT 'open',
       admin_reply NVARCHAR(MAX) NULL,
       admin_reply_at NVARCHAR(50) NULL,
       admin_reply_by INT NULL,
       task_id INT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_feedback_user' AND object_id = OBJECT_ID('feedback'))
     CREATE NONCLUSTERED INDEX IX_feedback_user ON feedback(user_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_feedback_status' AND object_id = OBJECT_ID('feedback'))
     CREATE NONCLUSTERED INDEX IX_feedback_status ON feedback(status);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'user_task_pins') AND type = 'U')
     CREATE TABLE user_task_pins (
       user_id INT NOT NULL,
       task_id NVARCHAR(200) NOT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       PRIMARY KEY (user_id, task_id)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_user_task_pins_user' AND object_id = OBJECT_ID('user_task_pins'))
     CREATE NONCLUSTERED INDEX IX_user_task_pins_user ON user_task_pins(user_id);`,

    // ── Onboarding ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_ticket_groups') AND type = 'U')
     CREATE TABLE onboarding_ticket_groups (
       id INT IDENTITY(1,1) PRIMARY KEY,
       name NVARCHAR(200) NOT NULL UNIQUE,
       sort_order INT DEFAULT 0,
       active INT DEFAULT 1,
       display_name NVARCHAR(200) NULL,
       traffic_light_group NVARCHAR(200) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_ticket_groups_sort' AND object_id = OBJECT_ID('onboarding_ticket_groups'))
     CREATE NONCLUSTERED INDEX IX_onboarding_ticket_groups_sort ON onboarding_ticket_groups(sort_order);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_sale_types') AND type = 'U')
     CREATE TABLE onboarding_sale_types (
       id INT IDENTITY(1,1) PRIMARY KEY,
       name NVARCHAR(200) NOT NULL UNIQUE,
       sort_order INT DEFAULT 0,
       active INT DEFAULT 1,
       jira_tickets_required INT DEFAULT 0,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_capabilities') AND type = 'U')
     CREATE TABLE onboarding_capabilities (
       id INT IDENTITY(1,1) PRIMARY KEY,
       name NVARCHAR(200) NOT NULL UNIQUE,
       code NVARCHAR(50) NULL,
       ticket_group_id INT NULL,
       sort_order INT DEFAULT 0,
       active INT DEFAULT 1,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_caps_group' AND object_id = OBJECT_ID('onboarding_capabilities'))
     CREATE NONCLUSTERED INDEX IX_onboarding_caps_group ON onboarding_capabilities(ticket_group_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_matrix') AND type = 'U')
     CREATE TABLE onboarding_matrix (
       id INT IDENTITY(1,1) PRIMARY KEY,
       sale_type_id INT NOT NULL,
       capability_id INT NOT NULL,
       enabled INT DEFAULT 1,
       notes NVARCHAR(MAX) NULL,
       CONSTRAINT UQ_matrix_sale_cap UNIQUE (sale_type_id, capability_id),
       CONSTRAINT FK_matrix_sale FOREIGN KEY (sale_type_id) REFERENCES onboarding_sale_types(id) ON DELETE CASCADE,
       CONSTRAINT FK_matrix_cap FOREIGN KEY (capability_id) REFERENCES onboarding_capabilities(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_matrix_sale' AND object_id = OBJECT_ID('onboarding_matrix'))
     CREATE NONCLUSTERED INDEX IX_onboarding_matrix_sale ON onboarding_matrix(sale_type_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_matrix_cap' AND object_id = OBJECT_ID('onboarding_matrix'))
     CREATE NONCLUSTERED INDEX IX_onboarding_matrix_cap ON onboarding_matrix(capability_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_capability_items') AND type = 'U')
     CREATE TABLE onboarding_capability_items (
       id INT IDENTITY(1,1) PRIMARY KEY,
       capability_id INT NOT NULL,
       name NVARCHAR(500) NOT NULL,
       is_bolt_on INT DEFAULT 0,
       sort_order INT DEFAULT 0,
       active INT DEFAULT 1,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       CONSTRAINT FK_items_cap FOREIGN KEY (capability_id) REFERENCES onboarding_capabilities(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_items_cap' AND object_id = OBJECT_ID('onboarding_capability_items'))
     CREATE NONCLUSTERED INDEX IX_onboarding_items_cap ON onboarding_capability_items(capability_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_runs') AND type = 'U')
     CREATE TABLE onboarding_runs (
       id INT IDENTITY(1,1) PRIMARY KEY,
       onboarding_ref NVARCHAR(100) NOT NULL,
       status NVARCHAR(50) NOT NULL DEFAULT 'pending',
       parent_key NVARCHAR(50) NULL,
       child_keys NVARCHAR(MAX) NULL,
       created_count INT DEFAULT 0,
       linked_count INT DEFAULT 0,
       error_message NVARCHAR(MAX) NULL,
       payload NVARCHAR(MAX) NULL,
       dry_run INT DEFAULT 0,
       user_id INT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_runs_ref' AND object_id = OBJECT_ID('onboarding_runs'))
     CREATE NONCLUSTERED INDEX IX_onboarding_runs_ref ON onboarding_runs(onboarding_ref);`,

    // ── Guild/BYM onboarding records ──
    // One row per customer onboarding set-up (backlog #8). Replaces the manual
    // "BYM Onboarding Status.xlsx" Guild tracker: holds the submission + invoice
    // dates, office/branch, the auto-created parent QA + 7 child Jira keys, and
    // the staff-edited manual fields. The 30-day SLA clock runs from
    // submission_date. `channel` scopes the pipeline (Guild only for now).
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_records') AND type = 'U')
     CREATE TABLE onboarding_records (
       id INT IDENTITY(1,1) PRIMARY KEY,
       onboarding_ref NVARCHAR(100) NOT NULL,
       channel NVARCHAR(50) NOT NULL DEFAULT 'guild',
       org_id INT NULL,
       portal_submission_id INT NULL,
       office_name NVARCHAR(300) NULL,
       branch_name NVARCHAR(300) NULL,
       submission_date DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       invoice_commencement_date DATE NULL,
       parent_key NVARCHAR(50) NULL,
       child_keys NVARCHAR(MAX) NULL,
       manual_fields NVARCHAR(MAX) NULL,
       status NVARCHAR(50) NOT NULL DEFAULT 'pending',
       error_message NVARCHAR(MAX) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_records_ref' AND object_id = OBJECT_ID('onboarding_records'))
     CREATE UNIQUE NONCLUSTERED INDEX IX_onboarding_records_ref ON onboarding_records(onboarding_ref);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_records_org' AND object_id = OBJECT_ID('onboarding_records'))
     CREATE NONCLUSTERED INDEX IX_onboarding_records_org ON onboarding_records(org_id);`,
    // Two-stage model (backlog #8 revision): application (step 1, no tickets) →
    // setup form (step 2, creates QA + 7 children). SLA runs 30 days from
    // setup_date. plan_type: 'standard' | 'multi'. *_data hold the captured forms.
    `IF COL_LENGTH('onboarding_records', 'stage') IS NULL
     ALTER TABLE onboarding_records ADD stage NVARCHAR(20) NOT NULL CONSTRAINT DF_onboarding_records_stage DEFAULT 'setup';`,
    `IF COL_LENGTH('onboarding_records', 'plan_type') IS NULL
     ALTER TABLE onboarding_records ADD plan_type NVARCHAR(20) NULL;`,
    `IF COL_LENGTH('onboarding_records', 'setup_date') IS NULL
     ALTER TABLE onboarding_records ADD setup_date DATETIME2 NULL;`,
    `IF COL_LENGTH('onboarding_records', 'application_data') IS NULL
     ALTER TABLE onboarding_records ADD application_data NVARCHAR(MAX) NULL;`,
    `IF COL_LENGTH('onboarding_records', 'setup_data') IS NULL
     ALTER TABLE onboarding_records ADD setup_data NVARCHAR(MAX) NULL;`,
    // Email of the portal user who submitted — the QA/child tickets are raised
    // on behalf of this person (JSM raiseOnBehalfOf), not the NOVA service account.
    `IF COL_LENGTH('onboarding_records', 'reporter_email') IS NULL
     ALTER TABLE onboarding_records ADD reporter_email NVARCHAR(300) NULL;`,

    // ── Milestones ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'milestone_templates') AND type = 'U')
     CREATE TABLE milestone_templates (
       id INT IDENTITY(1,1) PRIMARY KEY,
       name NVARCHAR(200) NOT NULL,
       day_offset INT NOT NULL DEFAULT 0,
       sort_order INT DEFAULT 0,
       checklist_json NVARCHAR(MAX) DEFAULT '[]',
       active INT DEFAULT 1,
       lead_days INT DEFAULT 3,
       tickets_enabled INT DEFAULT 0,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestone_templates_active' AND object_id = OBJECT_ID('milestone_templates'))
     CREATE NONCLUSTERED INDEX IX_milestone_templates_active ON milestone_templates(active, sort_order);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_milestones') AND type = 'U')
     CREATE TABLE delivery_milestones (
       id INT IDENTITY(1,1) PRIMARY KEY,
       delivery_id INT NOT NULL,
       template_id INT NOT NULL,
       template_name NVARCHAR(200) NOT NULL,
       target_date NVARCHAR(50) NULL,
       actual_date NVARCHAR(50) NULL,
       status NVARCHAR(50) DEFAULT 'pending',
       checklist_state_json NVARCHAR(MAX) DEFAULT '[]',
       notes NVARCHAR(MAX) NULL,
       workflow_task_created INT DEFAULT 0,
       workflow_tickets_created INT DEFAULT 0,
       jira_keys NVARCHAR(MAX) NULL,
       assigned_to INT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestones_delivery' AND object_id = OBJECT_ID('delivery_milestones'))
     CREATE NONCLUSTERED INDEX IX_milestones_delivery ON delivery_milestones(delivery_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestones_status' AND object_id = OBJECT_ID('delivery_milestones'))
     CREATE NONCLUSTERED INDEX IX_milestones_status ON delivery_milestones(status);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestones_target' AND object_id = OBJECT_ID('delivery_milestones'))
     CREATE NONCLUSTERED INDEX IX_milestones_target ON delivery_milestones(target_date);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestones_workflow' AND object_id = OBJECT_ID('delivery_milestones'))
     CREATE NONCLUSTERED INDEX IX_milestones_workflow ON delivery_milestones(workflow_task_created, status);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'milestone_template_ticket_groups') AND type = 'U')
     CREATE TABLE milestone_template_ticket_groups (
       template_id INT NOT NULL,
       ticket_group_id INT NOT NULL,
       PRIMARY KEY (template_id, ticket_group_id),
       CONSTRAINT FK_mttg_template FOREIGN KEY (template_id) REFERENCES milestone_templates(id) ON DELETE CASCADE,
       CONSTRAINT FK_mttg_tg FOREIGN KEY (ticket_group_id) REFERENCES onboarding_ticket_groups(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestone_tmpl_tg' AND object_id = OBJECT_ID('milestone_template_ticket_groups'))
     CREATE NONCLUSTERED INDEX IX_milestone_tmpl_tg ON milestone_template_ticket_groups(template_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestone_tg_tmpl' AND object_id = OBJECT_ID('milestone_template_ticket_groups'))
     CREATE NONCLUSTERED INDEX IX_milestone_tg_tmpl ON milestone_template_ticket_groups(ticket_group_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'milestone_sale_type_offsets') AND type = 'U')
     CREATE TABLE milestone_sale_type_offsets (
       sale_type_id INT NOT NULL,
       template_id INT NOT NULL,
       day_offset INT NOT NULL DEFAULT 0,
       PRIMARY KEY (sale_type_id, template_id),
       CONSTRAINT FK_msto_sale FOREIGN KEY (sale_type_id) REFERENCES onboarding_sale_types(id) ON DELETE CASCADE,
       CONSTRAINT FK_msto_tmpl FOREIGN KEY (template_id) REFERENCES milestone_templates(id) ON DELETE CASCADE
     );`,

    // ── Audit & Notifications ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'audit_log') AND type = 'U')
     CREATE TABLE audit_log (
       id INT IDENTITY(1,1) PRIMARY KEY,
       user_id INT NOT NULL,
       entity_type NVARCHAR(100) NOT NULL,
       entity_id NVARCHAR(200) NOT NULL,
       action NVARCHAR(100) NOT NULL,
       changes_json NVARCHAR(MAX) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_entity' AND object_id = OBJECT_ID('audit_log'))
     CREATE NONCLUSTERED INDEX IX_audit_entity ON audit_log(entity_type, entity_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_user' AND object_id = OBJECT_ID('audit_log'))
     CREATE NONCLUSTERED INDEX IX_audit_user ON audit_log(user_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_created' AND object_id = OBJECT_ID('audit_log'))
     CREATE NONCLUSTERED INDEX IX_audit_created ON audit_log(created_at DESC);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'notifications') AND type = 'U')
     CREATE TABLE notifications (
       id INT IDENTITY(1,1) PRIMARY KEY,
       user_id INT NOT NULL,
       type NVARCHAR(100) NOT NULL,
       title NVARCHAR(500) NOT NULL,
       message NVARCHAR(MAX) NULL,
       entity_type NVARCHAR(100) NULL,
       entity_id NVARCHAR(200) NULL,
       read_at DATETIME2 NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_notif_user' AND object_id = OBJECT_ID('notifications'))
     CREATE NONCLUSTERED INDEX IX_notif_user ON notifications(user_id, read_at);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_notif_dedup' AND object_id = OBJECT_ID('notifications'))
     CREATE UNIQUE NONCLUSTERED INDEX IX_notif_dedup ON notifications(user_id, type, entity_id) WHERE read_at IS NULL;`,

    // ── Problem Ticket Detection ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'problem_ticket_alerts') AND type = 'U')
     CREATE TABLE problem_ticket_alerts (
       id INT IDENTITY(1,1) PRIMARY KEY,
       issue_key NVARCHAR(50) NOT NULL UNIQUE,
       project_key NVARCHAR(20) NOT NULL,
       summary NVARCHAR(500) NOT NULL,
       status NVARCHAR(100) NULL,
       priority NVARCHAR(50) NULL,
       assignee NVARCHAR(200) NULL,
       reporter NVARCHAR(200) NULL,
       created_at NVARCHAR(50) NULL,
       severity NVARCHAR(50) NOT NULL,
       score INT NOT NULL,
       fingerprint NVARCHAR(500) NOT NULL,
       first_seen DATETIME2 DEFAULT GETUTCDATE(),
       last_seen DATETIME2 DEFAULT GETUTCDATE(),
       resolved_at DATETIME2 NULL,
       sla_remaining_ms BIGINT NULL,
       sentiment_score FLOAT NULL,
       sentiment_summary NVARCHAR(MAX) NULL,
       scan_id NVARCHAR(100) NOT NULL
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'problem_ticket_alert_reasons') AND type = 'U')
     CREATE TABLE problem_ticket_alert_reasons (
       id INT IDENTITY(1,1) PRIMARY KEY,
       alert_id INT NOT NULL,
       [rule] NVARCHAR(100) NOT NULL,
       label NVARCHAR(200) NOT NULL,
       weight INT NOT NULL,
       detail NVARCHAR(MAX) NULL,
       CONSTRAINT FK_pta_reasons_alert FOREIGN KEY (alert_id) REFERENCES problem_ticket_alerts(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pta_reasons_alert' AND object_id = OBJECT_ID('problem_ticket_alert_reasons'))
     CREATE NONCLUSTERED INDEX IX_pta_reasons_alert ON problem_ticket_alert_reasons(alert_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'problem_ticket_ignores') AND type = 'U')
     CREATE TABLE problem_ticket_ignores (
       id INT IDENTITY(1,1) PRIMARY KEY,
       issue_key NVARCHAR(50) NOT NULL,
       ignored_by NVARCHAR(200) NOT NULL,
       reason NVARCHAR(MAX) NULL,
       fingerprint_at_ignore NVARCHAR(500) NOT NULL,
       ignored_at DATETIME2 DEFAULT GETUTCDATE(),
       lifted_at DATETIME2 NULL,
       lifted_reason NVARCHAR(MAX) NULL
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'problem_ticket_config') AND type = 'U')
     CREATE TABLE problem_ticket_config (
       [rule] NVARCHAR(100) NOT NULL PRIMARY KEY,
       enabled INT NOT NULL DEFAULT 1,
       weight INT NOT NULL,
       threshold_json NVARCHAR(MAX) NULL
     );`,

    // ── Instance Setup ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'instance_setup_step_templates') AND type = 'U')
     CREATE TABLE instance_setup_step_templates (
       id INT IDENTITY(1,1) PRIMARY KEY,
       product NVARCHAR(50) NOT NULL,
       step_key NVARCHAR(100) NOT NULL,
       step_label NVARCHAR(200) NOT NULL,
       sort_order INT DEFAULT 0,
       required INT DEFAULT 1,
       CONSTRAINT UQ_setup_tmpl_product_key UNIQUE (product, step_key)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_templates_product' AND object_id = OBJECT_ID('instance_setup_step_templates'))
     CREATE NONCLUSTERED INDEX IX_setup_templates_product ON instance_setup_step_templates(product, sort_order);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'instance_setup_steps') AND type = 'U')
     CREATE TABLE instance_setup_steps (
       id INT IDENTITY(1,1) PRIMARY KEY,
       delivery_id INT NOT NULL,
       step_key NVARCHAR(100) NOT NULL,
       step_label NVARCHAR(200) NOT NULL,
       status NVARCHAR(50) DEFAULT 'pending',
       result_message NVARCHAR(MAX) NULL,
       executed_at NVARCHAR(50) NULL,
       executed_by INT NULL,
       CONSTRAINT UQ_setup_step_delivery_key UNIQUE (delivery_id, step_key),
       CONSTRAINT FK_setup_steps_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_steps_delivery' AND object_id = OBJECT_ID('instance_setup_steps'))
     CREATE NONCLUSTERED INDEX IX_setup_steps_delivery ON instance_setup_steps(delivery_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'setup_execution_runs') AND type = 'U')
     CREATE TABLE setup_execution_runs (
       id INT IDENTITY(1,1) PRIMARY KEY,
       delivery_id INT NOT NULL,
       started_at DATETIME2 DEFAULT GETUTCDATE(),
       finished_at DATETIME2 NULL,
       status NVARCHAR(50) DEFAULT 'running',
       started_by INT NULL,
       summary NVARCHAR(MAX) NULL,
       CONSTRAINT FK_setup_runs_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_runs_delivery' AND object_id = OBJECT_ID('setup_execution_runs'))
     CREATE NONCLUSTERED INDEX IX_setup_runs_delivery ON setup_execution_runs(delivery_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'setup_execution_logs') AND type = 'U')
     CREATE TABLE setup_execution_logs (
       id INT IDENTITY(1,1) PRIMARY KEY,
       run_id INT NOT NULL,
       step_key NVARCHAR(100) NOT NULL,
       [timestamp] DATETIME2 DEFAULT GETUTCDATE(),
       level NVARCHAR(20) DEFAULT 'info',
       message NVARCHAR(MAX) NOT NULL,
       CONSTRAINT FK_setup_logs_run FOREIGN KEY (run_id) REFERENCES setup_execution_runs(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_logs_run' AND object_id = OBJECT_ID('setup_execution_logs'))
     CREATE NONCLUSTERED INDEX IX_setup_logs_run ON setup_execution_logs(run_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'setup_portal_tokens') AND type = 'U')
     CREATE TABLE setup_portal_tokens (
       id INT IDENTITY(1,1) PRIMARY KEY,
       token NVARCHAR(200) NOT NULL UNIQUE,
       delivery_id INT NOT NULL,
       customer_email NVARCHAR(200) NOT NULL,
       customer_name NVARCHAR(200) NULL,
       expires_at DATETIME2 NOT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       last_accessed DATETIME2 NULL,
       completed_at DATETIME2 NULL,
       created_by INT NULL,
       progress_json NVARCHAR(MAX) DEFAULT '{}',
       CONSTRAINT FK_portal_tokens_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_portal_delivery' AND object_id = OBJECT_ID('setup_portal_tokens'))
     CREATE NONCLUSTERED INDEX IX_setup_portal_delivery ON setup_portal_tokens(delivery_id);`,

    // ── Delivery Extensions ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_branches') AND type = 'U')
     CREATE TABLE delivery_branches (
       id INT IDENTITY(1,1) PRIMARY KEY,
       delivery_id INT NOT NULL,
       is_default INT DEFAULT 0,
       name NVARCHAR(200) NOT NULL,
       sales_email NVARCHAR(200) NULL,
       sales_phone NVARCHAR(50) NULL,
       lettings_email NVARCHAR(200) NULL,
       lettings_phone NVARCHAR(50) NULL,
       address1 NVARCHAR(200) NULL,
       address2 NVARCHAR(200) NULL,
       address3 NVARCHAR(200) NULL,
       town NVARCHAR(200) NULL,
       post_code1 NVARCHAR(20) NULL,
       post_code2 NVARCHAR(20) NULL,
       sort_order INT DEFAULT 0,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_branch_delivery_name UNIQUE (delivery_id, name),
       CONSTRAINT FK_branches_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_branches_delivery' AND object_id = OBJECT_ID('delivery_branches'))
     CREATE NONCLUSTERED INDEX IX_delivery_branches_delivery ON delivery_branches(delivery_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_brand_settings') AND type = 'U')
     CREATE TABLE delivery_brand_settings (
       id INT IDENTITY(1,1) PRIMARY KEY,
       delivery_id INT NOT NULL,
       setting_key NVARCHAR(200) NOT NULL,
       setting_value NVARCHAR(MAX) NULL,
       updated_at DATETIME2 DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_brand_setting_delivery_key UNIQUE (delivery_id, setting_key),
       CONSTRAINT FK_brand_settings_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_brand_settings_delivery' AND object_id = OBJECT_ID('delivery_brand_settings'))
     CREATE NONCLUSTERED INDEX IX_brand_settings_delivery ON delivery_brand_settings(delivery_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_logos') AND type = 'U')
     CREATE TABLE delivery_logos (
       id INT IDENTITY(1,1) PRIMARY KEY,
       delivery_id INT NOT NULL,
       logo_type INT NOT NULL,
       logo_label NVARCHAR(200) NOT NULL,
       mime_type NVARCHAR(100) NOT NULL DEFAULT 'image/png',
       image_data NVARCHAR(MAX) NOT NULL,
       file_name NVARCHAR(200) NULL,
       file_size INT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_logo_delivery_type UNIQUE (delivery_id, logo_type),
       CONSTRAINT FK_logos_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_logos_delivery' AND object_id = OBJECT_ID('delivery_logos'))
     CREATE NONCLUSTERED INDEX IX_delivery_logos_delivery ON delivery_logos(delivery_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_portal_accounts') AND type = 'U')
     CREATE TABLE delivery_portal_accounts (
       id INT IDENTITY(1,1) PRIMARY KEY,
       delivery_id INT NOT NULL,
       portal_name NVARCHAR(200) NOT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_portal_delivery_name UNIQUE (delivery_id, portal_name)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_accounts_delivery' AND object_id = OBJECT_ID('delivery_portal_accounts'))
     CREATE NONCLUSTERED INDEX IX_portal_accounts_delivery ON delivery_portal_accounts(delivery_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_branch_districts') AND type = 'U')
     CREATE TABLE delivery_branch_districts (
       id INT IDENTITY(1,1) PRIMARY KEY,
       branch_id INT NOT NULL,
       delivery_id INT NOT NULL,
       district_name NVARCHAR(200) NOT NULL,
       all_sectors INT DEFAULT 0,
       sectors_json NVARCHAR(MAX) DEFAULT '[]',
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_district_branch_name UNIQUE (branch_id, district_name),
       CONSTRAINT FK_districts_branch FOREIGN KEY (branch_id) REFERENCES delivery_branches(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_branch_districts_delivery' AND object_id = OBJECT_ID('delivery_branch_districts'))
     CREATE NONCLUSTERED INDEX IX_branch_districts_delivery ON delivery_branch_districts(delivery_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_branch_districts_branch' AND object_id = OBJECT_ID('delivery_branch_districts'))
     CREATE NONCLUSTERED INDEX IX_branch_districts_branch ON delivery_branch_districts(branch_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_welcome_packs') AND type = 'U')
     CREATE TABLE delivery_welcome_packs (
       id INT IDENTITY(1,1) PRIMARY KEY,
       delivery_id INT NOT NULL,
       name NVARCHAR(200) NOT NULL,
       snapshot_json NVARCHAR(MAX) NOT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       created_by NVARCHAR(200) NULL
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_welcome_packs_delivery' AND object_id = OBJECT_ID('delivery_welcome_packs'))
     CREATE NONCLUSTERED INDEX IX_welcome_packs_delivery ON delivery_welcome_packs(delivery_id);`,

    // ── CRM ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'crm_customers') AND type = 'U')
     CREATE TABLE crm_customers (
       id INT IDENTITY(1,1) PRIMARY KEY,
       name NVARCHAR(200) NOT NULL,
       company NVARCHAR(200) NULL,
       sector NVARCHAR(100) NULL,
       mrr DECIMAL(18,4) NULL,
       owner NVARCHAR(200) NULL,
       rag_status NVARCHAR(20) DEFAULT 'green',
       next_review_date NVARCHAR(50) NULL,
       contract_start NVARCHAR(50) NULL,
       contract_end NVARCHAR(50) NULL,
       dynamics_id NVARCHAR(200) NULL,
       account_number NVARCHAR(100) NULL,
       notes NVARCHAR(MAX) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_crm_customers_rag' AND object_id = OBJECT_ID('crm_customers'))
     CREATE NONCLUSTERED INDEX IX_crm_customers_rag ON crm_customers(rag_status);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_crm_customers_next_review' AND object_id = OBJECT_ID('crm_customers'))
     CREATE NONCLUSTERED INDEX IX_crm_customers_next_review ON crm_customers(next_review_date);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'crm_reviews') AND type = 'U')
     CREATE TABLE crm_reviews (
       id INT IDENTITY(1,1) PRIMARY KEY,
       customer_id INT NOT NULL,
       review_date NVARCHAR(50) NOT NULL,
       rag_status NVARCHAR(20) NOT NULL,
       outcome NVARCHAR(MAX) NULL,
       actions NVARCHAR(MAX) NULL,
       reviewer NVARCHAR(200) NULL,
       next_review_date NVARCHAR(50) NULL,
       notes NVARCHAR(MAX) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_crm_reviews_customer' AND object_id = OBJECT_ID('crm_reviews'))
     CREATE NONCLUSTERED INDEX IX_crm_reviews_customer ON crm_reviews(customer_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_crm_reviews_date' AND object_id = OBJECT_ID('crm_reviews'))
     CREATE NONCLUSTERED INDEX IX_crm_reviews_date ON crm_reviews(review_date DESC);`,

    // ── Sales ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_pipeline') AND type = 'U')
     CREATE TABLE sales_pipeline (
       id INT IDENTITY(1,1) PRIMARY KEY,
       salesperson NVARCHAR(200) NOT NULL,
       lead_gen NVARCHAR(200) NULL,
       company NVARCHAR(500) NOT NULL,
       mrr DECIMAL(18,4) NOT NULL DEFAULT 0,
       product NVARCHAR(200) NULL,
       stage NVARCHAR(100) NOT NULL,
       demo_date NVARCHAR(50) NULL,
       est_close_date NVARCHAR(50) NULL,
       next_chase_date NVARCHAR(50) NULL,
       contact NVARCHAR(200) NULL,
       phone NVARCHAR(50) NULL,
       notes NVARCHAR(MAX) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_pipeline_salesperson' AND object_id = OBJECT_ID('sales_pipeline'))
     CREATE NONCLUSTERED INDEX IX_sales_pipeline_salesperson ON sales_pipeline(salesperson);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_pipeline_stage' AND object_id = OBJECT_ID('sales_pipeline'))
     CREATE NONCLUSTERED INDEX IX_sales_pipeline_stage ON sales_pipeline(stage);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_monthly') AND type = 'U')
     CREATE TABLE sales_monthly (
       id INT IDENTITY(1,1) PRIMARY KEY,
       sale_date NVARCHAR(50) NOT NULL,
       lead_gen NVARCHAR(200) NULL,
       salesperson NVARCHAR(200) NOT NULL,
       product NVARCHAR(200) NULL,
       trading_name NVARCHAR(500) NULL,
       limited_company NVARCHAR(500) NULL,
       company_number NVARCHAR(50) NULL,
       email NVARCHAR(200) NULL,
       setup_fee DECIMAL(18,4) DEFAULT 0,
       licence DECIMAL(18,4) DEFAULT 0,
       upsell_mrr DECIMAL(18,4) DEFAULT 0,
       postal DECIMAL(18,4) DEFAULT 0,
       coms DECIMAL(18,4) DEFAULT 0,
       trial_mrr DECIMAL(18,4) DEFAULT 0,
       actual_mrr DECIMAL(18,4) DEFAULT 0,
       branches INT DEFAULT 1,
       existing_vs_new NVARCHAR(50) NULL,
       hotbox_ref INT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_monthly_salesperson' AND object_id = OBJECT_ID('sales_monthly'))
     CREATE NONCLUSTERED INDEX IX_sales_monthly_salesperson ON sales_monthly(salesperson);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_monthly_date' AND object_id = OBJECT_ID('sales_monthly'))
     CREATE NONCLUSTERED INDEX IX_sales_monthly_date ON sales_monthly(sale_date);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_targets') AND type = 'U')
     CREATE TABLE sales_targets (
       id INT IDENTITY(1,1) PRIMARY KEY,
       salesperson NVARCHAR(200) NOT NULL,
       month NVARCHAR(20) NOT NULL,
       target_mrr DECIMAL(18,4) NOT NULL DEFAULT 0,
       CONSTRAINT UQ_sales_targets_person_month UNIQUE (salesperson, month)
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_bookings') AND type = 'U')
     CREATE TABLE sales_bookings (
       id INT IDENTITY(1,1) PRIMARY KEY,
       booked_date NVARCHAR(50) NOT NULL,
       salesperson NVARCHAR(200) NOT NULL,
       lead_gen NVARCHAR(200) NULL,
       team NVARCHAR(100) NULL,
       product NVARCHAR(200) NULL,
       company NVARCHAR(500) NOT NULL,
       email NVARCHAR(200) NULL,
       client_type NVARCHAR(100) NULL,
       demo_date NVARCHAR(50) NULL,
       dm NVARCHAR(200) NULL,
       phone NVARCHAR(50) NULL,
       lead_source NVARCHAR(200) NULL,
       taken_place INT DEFAULT 0,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_bookings_date' AND object_id = OBJECT_ID('sales_bookings'))
     CREATE NONCLUSTERED INDEX IX_sales_bookings_date ON sales_bookings(booked_date);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_taken_place') AND type = 'U')
     CREATE TABLE sales_taken_place (
       id INT IDENTITY(1,1) PRIMARY KEY,
       demo_date NVARCHAR(50) NOT NULL,
       salesperson NVARCHAR(200) NOT NULL,
       lead_gen NVARCHAR(200) NULL,
       product NVARCHAR(200) NULL,
       company NVARCHAR(500) NOT NULL,
       email NVARCHAR(200) NULL,
       branches INT DEFAULT 1,
       dm NVARCHAR(200) NULL,
       est_mrr DECIMAL(18,4) DEFAULT 0,
       hwc NVARCHAR(200) NULL,
       in_hotbox NVARCHAR(10) DEFAULT 'No',
       client_type NVARCHAR(100) NULL,
       notes NVARCHAR(MAX) NULL,
       booking_id INT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_taken_place_date' AND object_id = OBJECT_ID('sales_taken_place'))
     CREATE NONCLUSTERED INDEX IX_sales_taken_place_date ON sales_taken_place(demo_date);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_lg_kpi') AND type = 'U')
     CREATE TABLE sales_lg_kpi (
       id INT IDENTITY(1,1) PRIMARY KEY,
       person NVARCHAR(200) NOT NULL,
       month NVARCHAR(20) NOT NULL,
       days_worked FLOAT DEFAULT 0,
       calls_kpi FLOAT DEFAULT 0,
       calls_actual FLOAT DEFAULT 0,
       booked_kpi FLOAT DEFAULT 0,
       booked_actual FLOAT DEFAULT 0,
       tp_kpi FLOAT DEFAULT 0,
       tp_actual FLOAT DEFAULT 0,
       sales_count FLOAT DEFAULT 0,
       mrr_total FLOAT DEFAULT 0,
       CONSTRAINT UQ_lg_kpi_person_month UNIQUE (person, month)
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_lg_history') AND type = 'U')
     CREATE TABLE sales_lg_history (
       id INT IDENTITY(1,1) PRIMARY KEY,
       year INT NOT NULL,
       month_num INT NOT NULL,
       calls INT DEFAULT 0,
       bookings INT DEFAULT 0,
       taken_place INT DEFAULT 0,
       CONSTRAINT UQ_lg_history_year_month UNIQUE (year, month_num)
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_bdm_kpi') AND type = 'U')
     CREATE TABLE sales_bdm_kpi (
       id INT IDENTITY(1,1) PRIMARY KEY,
       person NVARCHAR(200) NOT NULL,
       month NVARCHAR(20) NOT NULL,
       booked_kpi FLOAT DEFAULT 0,
       booked_actual FLOAT DEFAULT 0,
       tp_kpi FLOAT DEFAULT 0,
       tp_actual FLOAT DEFAULT 0,
       sales_kpi FLOAT DEFAULT 0,
       sales_actual FLOAT DEFAULT 0,
       mrr_kpi FLOAT DEFAULT 0,
       mrr_actual FLOAT DEFAULT 0,
       target FLOAT DEFAULT 0,
       CONSTRAINT UQ_bdm_kpi_person_month UNIQUE (person, month)
     );`,

    // ── Business Central & Contracts ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'bc_customers') AND type = 'U')
     CREATE TABLE bc_customers (
       id INT IDENTITY(1,1) PRIMARY KEY,
       bc_id NVARCHAR(200) NOT NULL UNIQUE,
       number NVARCHAR(50) NULL,
       display_name NVARCHAR(200) NOT NULL,
       email NVARCHAR(200) NULL,
       phone_number NVARCHAR(50) NULL,
       address NVARCHAR(500) NULL,
       city NVARCHAR(200) NULL,
       country NVARCHAR(100) NULL,
       currency_code NVARCHAR(10) NULL,
       balance DECIMAL(18,4) NULL,
       blocked NVARCHAR(50) NULL,
       last_synced DATETIME2 DEFAULT GETUTCDATE(),
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'contracts') AND type = 'U')
     CREATE TABLE contracts (
       id INT IDENTITY(1,1) PRIMARY KEY,
       bc_customer_id NVARCHAR(200) NULL,
       customer_name NVARCHAR(200) NOT NULL,
       contract_number NVARCHAR(100) NULL,
       title NVARCHAR(500) NOT NULL,
       status NVARCHAR(50) DEFAULT 'active',
       start_date NVARCHAR(50) NULL,
       end_date NVARCHAR(50) NULL,
       value DECIMAL(18,4) NULL,
       currency NVARCHAR(10) DEFAULT 'GBP',
       renewal_type NVARCHAR(100) NULL,
       notes NVARCHAR(MAX) NULL,
       bc_order_id NVARCHAR(200) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'contract_templates') AND type = 'U')
     CREATE TABLE contract_templates (
       id INT IDENTITY(1,1) PRIMARY KEY,
       name NVARCHAR(200) NOT NULL,
       description NVARCHAR(MAX) NULL,
       category NVARCHAR(100) NULL,
       fields_schema NVARCHAR(MAX) NULL,
       adobe_library_doc_id NVARCHAR(200) NULL,
       file_data VARBINARY(MAX) NULL,
       file_name NVARCHAR(200) NULL,
       file_mime NVARCHAR(100) NULL,
       status NVARCHAR(50) DEFAULT 'active',
       created_by INT NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'adobe_sign_agreements') AND type = 'U')
     CREATE TABLE adobe_sign_agreements (
       id INT IDENTITY(1,1) PRIMARY KEY,
       agreement_id NVARCHAR(200) NOT NULL UNIQUE,
       contract_id INT NULL,
       template_id INT NULL,
       name NVARCHAR(500) NOT NULL,
       status NVARCHAR(50) DEFAULT 'DRAFT',
       sender_email NVARCHAR(200) NULL,
       signer_emails NVARCHAR(MAX) NULL,
       filled_fields NVARCHAR(MAX) NULL,
       created_via_nova INT DEFAULT 0,
       adobe_created_date NVARCHAR(50) NULL,
       adobe_expiration_date NVARCHAR(50) NULL,
       signed_document_url NVARCHAR(2000) NULL,
       raw_data NVARCHAR(MAX) NULL,
       synced_at DATETIME2 NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_at DATETIME2 DEFAULT GETUTCDATE()
     );`,

    // ── Surveys ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'surveys') AND type = 'U')
     CREATE TABLE surveys (
       id INT IDENTITY(1,1) PRIMARY KEY,
       title NVARCHAR(500) NOT NULL,
       description NVARCHAR(MAX) NULL,
       team_name NVARCHAR(200) NOT NULL,
       status NVARCHAR(50) NOT NULL DEFAULT 'draft',
       start_date NVARCHAR(50) NULL,
       end_date NVARCHAR(50) NULL,
       invite_send_date NVARCHAR(50) NULL,
       reminder_interval_days INT DEFAULT 2,
       category NVARCHAR(100) NULL,
       recurrence_interval_days INT NULL,
       next_recurrence_date NVARCHAR(50) NULL,
       parent_survey_id INT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       closed_at DATETIME2 NULL,
       created_by NVARCHAR(200) NOT NULL
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_surveys_status' AND object_id = OBJECT_ID('surveys'))
     CREATE NONCLUSTERED INDEX IX_surveys_status ON surveys(status);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_surveys_category' AND object_id = OBJECT_ID('surveys'))
     CREATE NONCLUSTERED INDEX IX_surveys_category ON surveys(category);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'survey_questions') AND type = 'U')
     CREATE TABLE survey_questions (
       id INT IDENTITY(1,1) PRIMARY KEY,
       survey_id INT NOT NULL,
       order_index INT NOT NULL,
       question_text NVARCHAR(MAX) NOT NULL,
       question_type NVARCHAR(50) NOT NULL,
       required INT NOT NULL DEFAULT 1,
       CONSTRAINT FK_sq_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_survey_questions_survey' AND object_id = OBJECT_ID('survey_questions'))
     CREATE NONCLUSTERED INDEX IX_survey_questions_survey ON survey_questions(survey_id, order_index);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'survey_recipients') AND type = 'U')
     CREATE TABLE survey_recipients (
       id INT IDENTITY(1,1) PRIMARY KEY,
       survey_id INT NOT NULL,
       display_name NVARCHAR(200) NOT NULL,
       email NVARCHAR(200) NOT NULL,
       token NVARCHAR(200) NOT NULL UNIQUE,
       invite_sent INT NOT NULL DEFAULT 0,
       last_reminder_sent NVARCHAR(50) NULL,
       completed INT NOT NULL DEFAULT 0,
       completed_at DATETIME2 NULL,
       CONSTRAINT FK_sr_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_survey_recipients_survey' AND object_id = OBJECT_ID('survey_recipients'))
     CREATE NONCLUSTERED INDEX IX_survey_recipients_survey ON survey_recipients(survey_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'survey_responses') AND type = 'U')
     CREATE TABLE survey_responses (
       id INT IDENTITY(1,1) PRIMARY KEY,
       survey_id INT NOT NULL,
       token NVARCHAR(200) NOT NULL UNIQUE,
       submitted_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       answers NVARCHAR(MAX) NOT NULL,
       CONSTRAINT FK_sres_survey FOREIGN KEY (survey_id) REFERENCES surveys(id)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_survey_responses_survey' AND object_id = OBJECT_ID('survey_responses'))
     CREATE NONCLUSTERED INDEX IX_survey_responses_survey ON survey_responses(survey_id);`,

    // ── Survey anonymity ──
    // survey_responses.token used to hold the same value as survey_recipients.token,
    // so a single join re-identified every answer. The column is dropped outright and
    // the recipient's token is erased once they submit, so the link cannot be rebuilt
    // by anyone holding the database. Cost: a respondent can no longer be shown their
    // own answers back. That is the trade-off for the anonymity we promise in the invite.
    `IF COL_LENGTH('survey_responses', 'token') IS NOT NULL
     BEGIN
       DECLARE @uq_resp sysname = (
         SELECT TOP(1) kc.name FROM sys.key_constraints kc
           JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE kc.parent_object_id = OBJECT_ID('survey_responses') AND kc.type = 'UQ' AND c.name = 'token');
       IF @uq_resp IS NOT NULL EXEC('ALTER TABLE survey_responses DROP CONSTRAINT [' + @uq_resp + ']');
       EXEC('ALTER TABLE survey_responses DROP COLUMN token');
     END`,

    // Recipient tokens are erased on completion, so the column must allow NULL and the
    // uniqueness constraint has to become a filtered index (a plain UNIQUE permits one NULL).
    `IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('survey_recipients') AND name = 'token' AND is_nullable = 0)
     BEGIN
       DECLARE @uq_rcpt sysname = (
         SELECT TOP(1) kc.name FROM sys.key_constraints kc
           JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE kc.parent_object_id = OBJECT_ID('survey_recipients') AND kc.type = 'UQ' AND c.name = 'token');
       IF @uq_rcpt IS NOT NULL EXEC('ALTER TABLE survey_recipients DROP CONSTRAINT [' + @uq_rcpt + ']');
       EXEC('ALTER TABLE survey_recipients ALTER COLUMN token NVARCHAR(200) NULL');
     END`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_survey_recipients_token' AND object_id = OBJECT_ID('survey_recipients'))
     CREATE UNIQUE NONCLUSTERED INDEX UX_survey_recipients_token ON survey_recipients(token) WHERE token IS NOT NULL;`,

    // Erase tokens already spent on historical responses, so the promise is not
    // "anonymous from today" with an identifiable back catalogue sitting behind it.
    `UPDATE survey_recipients SET token = NULL WHERE completed = 1 AND token IS NOT NULL;`,

    // Timing correlation re-identifies just as well as a token when a handful of people
    // respond: both timestamps are coarsened to the day, historically and going forward.
    `UPDATE survey_recipients SET completed_at = CAST(CAST(completed_at AS DATE) AS DATETIME2)
      WHERE completed_at IS NOT NULL AND CAST(completed_at AS TIME) <> '00:00:00';`,
    `UPDATE survey_responses SET submitted_at = CAST(CAST(submitted_at AS DATE) AS DATETIME2)
      WHERE CAST(submitted_at AS TIME) <> '00:00:00';`,

    // ── AI Approval Queue ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'approval_queue') AND type = 'U')
     CREATE TABLE approval_queue (
       id INT IDENTITY(1,1) PRIMARY KEY,
       ticket_id NVARCHAR(50) NOT NULL,
       ticket_summary NVARCHAR(500) NOT NULL,
       reporter_name NVARCHAR(200) NULL,
       reporter_email NVARCHAR(200) NULL,
       ai_response_adf NVARCHAR(MAX) NULL,
       conversation_json NVARCHAR(MAX) NULL,
       kb_sources NVARCHAR(MAX) NULL,
       resume_url NVARCHAR(2000) NOT NULL,
       status NVARCHAR(50) DEFAULT 'pending',
       decided_by NVARCHAR(200) NULL,
       decided_at DATETIME2 NULL,
       edited_response_adf NVARCHAR(MAX) NULL,
       decline_reason NVARCHAR(MAX) NULL,
       priority NVARCHAR(50) NULL,
       created_at DATETIME2 DEFAULT GETUTCDATE(),
       expires_at DATETIME2 NOT NULL
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_approval_queue_status' AND object_id = OBJECT_ID('approval_queue'))
     CREATE NONCLUSTERED INDEX IX_approval_queue_status ON approval_queue(status);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_approval_queue_ticket' AND object_id = OBJECT_ID('approval_queue'))
     CREATE NONCLUSTERED INDEX IX_approval_queue_ticket ON approval_queue(ticket_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_approval_queue_expires' AND object_id = OBJECT_ID('approval_queue'))
     CREATE NONCLUSTERED INDEX IX_approval_queue_expires ON approval_queue(expires_at);`,

    // ── Training Matrix ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'training_categories') AND type = 'U')
     CREATE TABLE training_categories (
       id INT IDENTITY(1,1) PRIMARY KEY,
       name NVARCHAR(200) NOT NULL UNIQUE,
       sort_order INT DEFAULT 0
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'training_items') AND type = 'U')
     CREATE TABLE training_items (
       id INT IDENTITY(1,1) PRIMARY KEY,
       category_id INT NOT NULL,
       section NVARCHAR(200) DEFAULT '',
       name NVARCHAR(500) NOT NULL,
       tech_lead NVARCHAR(200) NULL,
       max_score INT DEFAULT 5,
       sort_order INT DEFAULT 0,
       CONSTRAINT FK_ti_category FOREIGN KEY (category_id) REFERENCES training_categories(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_training_items_category' AND object_id = OBJECT_ID('training_items'))
     CREATE NONCLUSTERED INDEX IX_training_items_category ON training_items(category_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'training_scores') AND type = 'U')
     CREATE TABLE training_scores (
       id INT IDENTITY(1,1) PRIMARY KEY,
       item_id INT NOT NULL,
       user_id INT NOT NULL,
       score INT DEFAULT 0,
       updated_at DATETIME2 DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_training_score_item_user UNIQUE (item_id, user_id),
       CONSTRAINT FK_ts_item FOREIGN KEY (item_id) REFERENCES training_items(id) ON DELETE CASCADE
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_training_scores_item' AND object_id = OBJECT_ID('training_scores'))
     CREATE NONCLUSTERED INDEX IX_training_scores_item ON training_scores(item_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_training_scores_user' AND object_id = OBJECT_ID('training_scores'))
     CREATE NONCLUSTERED INDEX IX_training_scores_user ON training_scores(user_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'training_members') AND type = 'U')
     CREATE TABLE training_members (
       user_id INT PRIMARY KEY,
       sort_order INT DEFAULT 0
     );`,

    // ── MI Commentary ──

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'mi_commentary') AND type = 'U')
     CREATE TABLE mi_commentary (
       month NVARCHAR(20) NOT NULL PRIMARY KEY,
       content NVARCHAR(MAX) NULL,
       updated_at DATETIME2 DEFAULT GETUTCDATE(),
       updated_by_user_id INT NULL
     );`,

    // ── Seed data: problem_ticket_config defaults ──
    `MERGE INTO problem_ticket_config AS target
     USING (VALUES
       ('sla_breached', 1, 30, '{}'),
       ('sla_near', 1, 20, '{"hoursThreshold":2}'),
       ('stale_comms', 1, 15, '{"daysThreshold":3}'),
       ('ticket_age', 1, 10, '{"daysThreshold":7}'),
       ('ping_pong', 1, 15, '{"reassignThreshold":3,"windowHours":48}'),
       ('reopened', 1, 10, '{}'),
       ('high_priority', 1, 10, '{"priorities":["Highest","High"]}'),
       ('sentiment', 1, 20, '{"negativeThreshold":-0.3}'),
       ('stagnant_status', 1, 10, '{"daysThreshold":5}'),
       ('missed_commitment', 1, 25, '{}'),
       ('no_next_reply', 1, 20, '{"hoursThreshold":4,"staffDomains":["nurtur"]}')
     ) AS source ([rule], enabled, weight, threshold_json)
     ON target.[rule] = source.[rule]
     WHEN NOT MATCHED THEN
       INSERT ([rule], enabled, weight, threshold_json)
       VALUES (source.[rule], source.enabled, source.weight, source.threshold_json);`,

    // ── Seed data: default settings ──
    `MERGE INTO settings AS target
     USING (VALUES
       ('source_weight_jira', '90'),
       ('source_weight_planner', '60'),
       ('source_weight_todo', '50'),
       ('source_weight_monday', '55'),
       ('source_weight_email', '40'),
       ('source_weight_calendar', '70'),
       ('refresh_interval_minutes', '5')
     ) AS source ([key], value)
     ON target.[key] = source.[key]
     WHEN NOT MATCHED THEN
       INSERT ([key], value) VALUES (source.[key], source.value);`,

    // ── Seed data: BYM instance setup step templates ──
    `MERGE INTO instance_setup_step_templates AS target
     USING (VALUES
       ('BYM', 'setupBrands', 'Create Brands', 1, 1),
       ('BYM', 'setupTemplates', 'Confirm Email Templates', 2, 1),
       ('BYM', 'setupDirectMail', 'Confirm Direct Mail', 3, 1),
       ('BYM', 'setupLetterhead', 'Confirm Letterhead', 4, 1),
       ('BYM', 'setupBranches', 'Create Branches', 5, 1),
       ('BYM', 'setupDistricts', 'Configure Branch Districts', 6, 0),
       ('BYM', 'setupDeliveryAddresses', 'Create Delivery Addresses', 6, 1),
       ('BYM', 'setupUsers', 'Create Users', 7, 1),
       ('BYM', 'setupRss', 'Add RSS Feeds', 8, 1),
       ('BYM', 'setupRobocop', 'Add Robocop Settings', 9, 1),
       ('BYM', 'setupScheduledReports', 'Add Scheduled Reports', 10, 1),
       ('BYM', 'setupComponents', 'Add Email Components', 11, 1),
       ('BYM', 'setupAutomatedEmails', 'Add Automated Emails', 12, 1),
       ('BYM', 'setupBuildMilestones', 'Add Build Milestones', 13, 1),
       ('BYM', 'setupBuildPortals', 'Add Build Portals', 14, 1),
       ('BYM', 'setupBuildContent', 'Add Build Content', 15, 1),
       ('BYM', 'setupMatchToCrm', 'Match to CRM', 16, 1)
     ) AS source (product, step_key, step_label, sort_order, required)
     ON target.product = source.product AND target.step_key = source.step_key
     WHEN NOT MATCHED THEN
       INSERT (product, step_key, step_label, sort_order, required)
       VALUES (source.product, source.step_key, source.step_label, source.sort_order, source.required);`,

    // Per-template override list of fields that should be treated as
    // "signer fills" in the New Contract wizard, regardless of what Adobe's
    // form-fields API says the assignee is. Lets the sender mark additional
    // fields as signer-only via a UI button. template_id is the Adobe library
    // document id (string). Adobe-side signer fields stay signer-only
    // independent of this table — overrides only ADD to the signer panel,
    // they can't move signer fields back into NOVA's input list.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'template_field_signer_overrides') AND type = 'U')
     CREATE TABLE template_field_signer_overrides (
       id           INT IDENTITY(1,1) PRIMARY KEY,
       template_id  NVARCHAR(200) NOT NULL,
       field_name   NVARCHAR(300) NOT NULL,
       created_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
       created_by   INT           NULL,
       CONSTRAINT UQ_template_field_signer_override UNIQUE (template_id, field_name)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_template_field_signer_overrides_template')
     CREATE INDEX IX_template_field_signer_overrides_template ON template_field_signer_overrides(template_id);`,

    // ── Daily team standup (accountability loop) ──
    // One session per calendar date. brief_json holds the pre-standup Jira brief,
    // plaud_* fields hold the imported recording, notes_text holds extracted notes
    // and the appended accountability report.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'standup_sessions') AND type = 'U')
     CREATE TABLE standup_sessions (
       id                INT IDENTITY(1,1) PRIMARY KEY,
       date              NVARCHAR(10)  NOT NULL,
       brief_json        NVARCHAR(MAX) NULL,
       plaud_recording_id NVARCHAR(200) NULL,
       transcript_text   NVARCHAR(MAX) NULL,
       notes_text        NVARCHAR(MAX) NULL,
       status            NVARCHAR(20)  NOT NULL DEFAULT 'pending',
       created_at        DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_standup_sessions_date UNIQUE (date)
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'standup_submissions') AND type = 'U')
     CREATE TABLE standup_submissions (
       id                INT IDENTITY(1,1) PRIMARY KEY,
       session_id        INT           NOT NULL,
       agent_name        NVARCHAR(200) NOT NULL,
       submitted_at      DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
       ticket_count      INT           NULL,
       over_5_count      INT           NULL,
       oldest_ticket     NVARCHAR(50)  NULL,
       oldest_age        INT           NULL,
       blockers          NVARCHAR(MAX) NULL,
       commitments_json  NVARCHAR(MAX) NULL,
       notes             NVARCHAR(MAX) NULL,
       CONSTRAINT UQ_standup_submissions_session_agent UNIQUE (session_id, agent_name)
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_standup_submissions_session')
     CREATE INDEX IX_standup_submissions_session ON standup_submissions(session_id);`,

    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'standup_commitments') AND type = 'U')
     CREATE TABLE standup_commitments (
       id                INT IDENTITY(1,1) PRIMARY KEY,
       submission_id     INT           NOT NULL,
       session_id        INT           NOT NULL,
       agent_name        NVARCHAR(200) NOT NULL,
       commitment_text   NVARCHAR(MAX) NOT NULL,
       status            NVARCHAR(20)  NOT NULL DEFAULT 'pending',
       reviewed_at       DATETIME2     NULL,
       review_note       NVARCHAR(MAX) NULL,
       created_at        DATETIME2     NOT NULL DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_standup_commitments_session')
     CREATE INDEX IX_standup_commitments_session ON standup_commitments(session_id);`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_standup_commitments_submission')
     CREATE INDEX IX_standup_commitments_submission ON standup_commitments(submission_id);`,

    // Tracks morning-prompt sends so the 09:00 job is idempotent within a day.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'standup_email_log') AND type = 'U')
     CREATE TABLE standup_email_log (
       id                INT IDENTITY(1,1) PRIMARY KEY,
       session_id        INT           NOT NULL,
       agent_name        NVARCHAR(200) NOT NULL,
       sent_at           DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_standup_email_log_session_agent UNIQUE (session_id, agent_name)
     );`,

    // Manual escalation: split escalation_reasons into two kinds.
    // 'capability' = the agent cannot progress it (SOP-002 troubleshooting applies).
    // 'urgency'    = the agent could progress it, but it needs to jump the queue.
    // requires_troubleshooting is meaningless for urgency reasons, hence 0 on all of them.
    `IF COL_LENGTH('escalation_reasons', 'reason_kind') IS NULL
     ALTER TABLE escalation_reasons ADD reason_kind NVARCHAR(20) NOT NULL DEFAULT 'capability';`,

    // These three predate the split and were already urgency-shaped (requires_troubleshooting = 0).
    `UPDATE escalation_reasons SET reason_kind = 'urgency'
      WHERE reason_code IN ('customer_request','sla_risk','security')
        AND reason_kind <> 'urgency';`,

    // NB: kept alongside customer_request and sla_risk by decision (15 Aug) rather than
    // retiring those two, so exec_ask ~ customer_request and deadline ~ sla_risk are
    // near-synonyms. Expect by_reason stats to split across the pairs.
    `IF NOT EXISTS (SELECT 1 FROM escalation_reasons WHERE reason_code = 'commercial')
     INSERT INTO escalation_reasons
       (reason_code, label, requires_troubleshooting, troubleshooting_checklist, sort_order, reason_kind)
     VALUES
       ('commercial',      'Commercial — renewal, upsell or contract risk',      0, NULL,  9, 'urgency'),
       ('customer_impact', 'Customer impact — blocking their operation',         0, NULL, 10, 'urgency'),
       ('reputational',    'Reputational — complaint risk or visible failure',   0, NULL, 11, 'urgency'),
       ('deadline',        'External deadline — customer or third-party date',   0, NULL, 12, 'urgency'),
       ('exec_ask',        'Requested by SLT or an account manager',             0, NULL, 13, 'urgency');`,

    // Closure tracking: jira-sync-service stamps these when it sees the ticket close,
    // so "did escalating actually change anything" is answerable without a join.
    `IF COL_LENGTH('escalation_log', 'resolved_at') IS NULL
     ALTER TABLE escalation_log ADD resolved_at DATETIME2 NULL;`,

    `IF COL_LENGTH('escalation_log', 'minutes_to_resolve') IS NULL
     ALTER TABLE escalation_log ADD minutes_to_resolve INT NULL;`,

    // A dispute is a row of its own (escalation_type = 'dispute') pointing back at
    // the escalation it contests, so "which escalations get pushed back on" is a
    // join rather than a string search through notes.
    `IF COL_LENGTH('escalation_log', 'disputes_escalation_id') IS NULL
     ALTER TABLE escalation_log ADD disputes_escalation_id INT NULL;`,

    // Daily failed-jobs ticket. One row per UK day — the unique constraint on
    // ticket_date is what makes the job idempotent, so a restart or an overlapping
    // tick can't raise a second ticket for the same day.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'failed_jobs_ticket_log') AND type = 'U')
     CREATE TABLE failed_jobs_ticket_log (
       id           INT IDENTITY(1,1) PRIMARY KEY,
       ticket_date  DATE          NOT NULL,
       issue_key    NVARCHAR(30)  NULL,
       agent_id     INT           NULL,
       agent_name   NVARCHAR(200) NULL,
       reassigned   BIT           NOT NULL DEFAULT 0,
       note         NVARCHAR(400) NULL,
       created_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT UQ_failed_jobs_ticket_log_date UNIQUE (ticket_date)
     );`,

    // ── KB gap register (clustered topics) ──
    // kb_gap_log stays the raw append-only log: one row per ticket per triage. The
    // register above it groups those rows into TOPICS by embedding similarity, because
    // grouping on the LLM's free-text suggested_title split "product cancellation"
    // across 8 near-identical rows and buried the real volume.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'kb_gap_clusters') AND type = 'U')
     CREATE TABLE kb_gap_clusters (
       id                 INT IDENTITY(1,1) PRIMARY KEY,
       canonical_title    NVARCHAR(500)  NOT NULL,
       category           NVARCHAR(100)  NULL,
       -- Brief fields: written by an LLM pass over the whole cluster, not per ticket.
       why_needed         NVARCHAR(MAX)  NULL,
       outline_json       NVARCHAR(MAX)  NULL,
       audience           NVARCHAR(50)   NULL,
       brief_generated_at DATETIME2      NULL,
       -- Centroid of member embeddings + count, so new gaps join incrementally
       -- without re-reading every member vector.
       centroid           VARBINARY(MAX) NULL,
       member_count       INT            NOT NULL DEFAULT 0,
       embedding_model    NVARCHAR(100)  NULL,
       status             NVARCHAR(30)   NOT NULL DEFAULT 'open',
       assigned_to        NVARCHAR(100)  NULL,
       jira_ticket_key    NVARCHAR(20)   NULL,
       confluence_url     NVARCHAR(500)  NULL,
       draft_id           INT            NULL,
       first_seen         DATETIME2      NULL,
       last_seen          DATETIME2      NULL,
       created_at         DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
       updated_at         DATETIME2      NOT NULL DEFAULT GETUTCDATE()
     );`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kb_gap_clusters_status')
     CREATE INDEX IX_kb_gap_clusters_status ON kb_gap_clusters (status, member_count DESC);`,

    `IF COL_LENGTH('kb_gap_log', 'cluster_id') IS NULL
     ALTER TABLE kb_gap_log ADD cluster_id INT NULL;`,

    `IF COL_LENGTH('kb_gap_log', 'embedding') IS NULL
     ALTER TABLE kb_gap_log ADD embedding VARBINARY(MAX) NULL;`,

    `IF COL_LENGTH('kb_gap_log', 'embedding_model') IS NULL
     ALTER TABLE kb_gap_log ADD embedding_model NVARCHAR(100) NULL;`,

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_kb_gap_log_cluster')
     CREATE INDEX IX_kb_gap_log_cluster ON kb_gap_log (cluster_id) WHERE cluster_id IS NOT NULL;`,

    // Portal chat KB misses. Deliberately no message text — the transcript is already
    // in portal_chat_messages, and copying raw inbound email here duplicated customer
    // PII into a register people browse.
    `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'portal_kb_miss_log') AND type = 'U')
     CREATE TABLE portal_kb_miss_log (
       id         INT IDENTITY(1,1) PRIMARY KEY,
       session_id INT           NOT NULL,
       category   NVARCHAR(100) NULL,
       created_at DATETIME2     NOT NULL DEFAULT GETUTCDATE()
     );`,
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
