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

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jira_cache_assignee')
     CREATE INDEX IX_jira_cache_assignee ON jira_issue_cache (assignee_email)
       INCLUDE (issue_key, summary, status_name, priority_name);`,

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
       read BIT DEFAULT 0,
       created_at DATETIME2 DEFAULT GETUTCDATE()
     );`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_nova_notifications_user')
     CREATE INDEX IX_nova_notifications_user ON nova_notifications(user_id, read, created_at DESC);`,

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

    // kb_article_health — add article_url for linking
    `IF COL_LENGTH('kb_article_health', 'article_url') IS NULL
     ALTER TABLE kb_article_health ADD article_url NVARCHAR(500) NULL;`,

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

    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_kb_articles_category')
     CREATE INDEX IX_portal_kb_articles_category ON portal_kb_articles(category);`,
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
