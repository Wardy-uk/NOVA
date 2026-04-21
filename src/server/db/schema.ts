import { initPool, closePool, execute } from '../services/database.js';

export async function initializeDatabase(): Promise<void> {
  await initPool();
  await runMigrations();
}

async function runMigrations(): Promise<void> {
  const migrations = [
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
