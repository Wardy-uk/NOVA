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

    `ALTER TABLE problem_ticket_alerts ADD last_analysed_at DATETIME2 NULL;`,

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
