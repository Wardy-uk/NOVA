-- =============================================================================
-- 001-sqlite-to-mssql.sql
-- Migrates the NOVA SQLite schema (daypilot.db) to Azure SQL / MSSQL
-- =============================================================================
-- Run against NOVA_Dev first, then NOVA (production).
--
-- Type mappings applied:
--   SQLite TEXT        → NVARCHAR(n) or NVARCHAR(MAX) depending on usage
--   SQLite INTEGER     → INT
--   SQLite REAL        → DECIMAL(18,4) for money, FLOAT for scores/ratios
--   SQLite BLOB        → VARBINARY(MAX)
--   AUTOINCREMENT      → IDENTITY(1,1)
--   datetime('now')    → GETUTCDATE()
--   INSERT OR IGNORE   → handled via IF NOT EXISTS or MERGE in app layer
--
-- NOTE: This script is idempotent — every CREATE uses IF NOT EXISTS pattern
-- via the sys.objects check. Safe to re-run.
-- =============================================================================

SET NOCOUNT ON;
GO

-- =============================================================================
-- 1. CORE TABLES
-- =============================================================================

-- tasks
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'tasks') AND type = 'U')
CREATE TABLE tasks (
    id                  NVARCHAR(200)   NOT NULL PRIMARY KEY,
    source              NVARCHAR(50)    NOT NULL,
    source_id           NVARCHAR(200)   NULL,
    source_url          NVARCHAR(2000)  NULL,
    title               NVARCHAR(500)   NOT NULL,
    description         NVARCHAR(MAX)   NULL,
    status              NVARCHAR(50)    DEFAULT 'open',
    priority            INT             DEFAULT 50,
    due_date            NVARCHAR(50)    NULL,
    sla_breach_at       NVARCHAR(50)    NULL,
    category            NVARCHAR(200)   NULL,
    is_pinned           INT             DEFAULT 0,
    snoozed_until       NVARCHAR(50)    NULL,
    last_synced         NVARCHAR(50)    NULL,
    raw_data            NVARCHAR(MAX)   NULL,
    transient           INT             DEFAULT 0,
    user_id             INT             NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- rituals
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'rituals') AND type = 'U')
CREATE TABLE rituals (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    type                NVARCHAR(50)    NOT NULL,
    date                NVARCHAR(50)    NOT NULL,
    conversation        NVARCHAR(MAX)   NULL,
    summary_md          NVARCHAR(MAX)   NULL,
    planned_items       NVARCHAR(MAX)   NULL,
    completed_items     NVARCHAR(MAX)   NULL,
    blockers            NVARCHAR(MAX)   NULL,
    openai_response_id  NVARCHAR(200)   NULL,
    user_id             INT             NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- settings
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'settings') AND type = 'U')
CREATE TABLE settings (
    [key]               NVARCHAR(200)   NOT NULL PRIMARY KEY,
    value               NVARCHAR(MAX)   NULL,
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- users
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'users') AND type = 'U')
CREATE TABLE users (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    username            NVARCHAR(100)   NOT NULL UNIQUE,
    display_name        NVARCHAR(200)   NULL,
    email               NVARCHAR(200)   NULL,
    password_hash       NVARCHAR(500)   NOT NULL,
    role                NVARCHAR(50)    DEFAULT 'viewer',
    auth_provider       NVARCHAR(50)    DEFAULT 'local',
    provider_id         NVARCHAR(200)   NULL,
    team_id             INT             NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- teams
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'teams') AND type = 'U')
CREATE TABLE teams (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    name                NVARCHAR(200)   NOT NULL UNIQUE,
    description         NVARCHAR(MAX)   NULL,
    jira_products       NVARCHAR(MAX)   NULL,
    jira_project_key    NVARCHAR(20)    NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- user_settings
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'user_settings') AND type = 'U')
CREATE TABLE user_settings (
    user_id             INT             NOT NULL,
    [key]               NVARCHAR(200)   NOT NULL,
    value               NVARCHAR(MAX)   NULL,
    updated_at          DATETIME2       DEFAULT GETUTCDATE(),
    PRIMARY KEY (user_id, [key])
);
GO

-- feedback
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'feedback') AND type = 'U')
CREATE TABLE feedback (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    user_id             INT             NOT NULL,
    type                NVARCHAR(50)    NOT NULL,
    title               NVARCHAR(500)   NOT NULL,
    description         NVARCHAR(MAX)   NULL,
    status              NVARCHAR(50)    DEFAULT 'open',
    admin_reply         NVARCHAR(MAX)   NULL,
    admin_reply_at      NVARCHAR(50)    NULL,
    admin_reply_by      INT             NULL,
    task_id             INT             NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- user_task_pins
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'user_task_pins') AND type = 'U')
CREATE TABLE user_task_pins (
    user_id             INT             NOT NULL,
    task_id             NVARCHAR(200)   NOT NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    PRIMARY KEY (user_id, task_id)
);
GO

-- =============================================================================
-- 2. DELIVERY & ONBOARDING
-- =============================================================================

-- delivery_entries
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_entries') AND type = 'U')
CREATE TABLE delivery_entries (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    product             NVARCHAR(200)   NOT NULL,
    account             NVARCHAR(500)   NOT NULL,
    status              NVARCHAR(100)   DEFAULT '',
    onboarder           NVARCHAR(200)   NULL,
    order_date          NVARCHAR(50)    NULL,
    go_live_date        NVARCHAR(50)    NULL,
    predicted_delivery  NVARCHAR(50)    NULL,
    branches            INT             NULL,
    mrr                 DECIMAL(18,4)   NULL,
    incremental         DECIMAL(18,4)   NULL,
    licence_fee         DECIMAL(18,4)   NULL,
    notes               NVARCHAR(MAX)   NULL,
    training_date       NVARCHAR(50)    NULL,
    is_starred          INT             DEFAULT 0,
    star_scope          NVARCHAR(10)    DEFAULT 'me',
    starred_by          INT             NULL,
    onboarding_id       NVARCHAR(50)    NULL,
    sale_type           NVARCHAR(200)   NULL,
    crm_customer_id     INT             NULL,
    azdo_branch_name    NVARCHAR(200)   NULL,
    azdo_pr_url         NVARCHAR(2000)  NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- onboarding_ticket_groups
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_ticket_groups') AND type = 'U')
CREATE TABLE onboarding_ticket_groups (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    name                NVARCHAR(200)   NOT NULL UNIQUE,
    sort_order          INT             DEFAULT 0,
    active              INT             DEFAULT 1,
    display_name        NVARCHAR(200)   NULL,
    traffic_light_group NVARCHAR(200)   NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- onboarding_sale_types
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_sale_types') AND type = 'U')
CREATE TABLE onboarding_sale_types (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    name                NVARCHAR(200)   NOT NULL UNIQUE,
    sort_order          INT             DEFAULT 0,
    active              INT             DEFAULT 1,
    jira_tickets_required INT           DEFAULT 0,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- onboarding_capabilities
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_capabilities') AND type = 'U')
CREATE TABLE onboarding_capabilities (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    name                NVARCHAR(200)   NOT NULL UNIQUE,
    code                NVARCHAR(50)    NULL,
    ticket_group_id     INT             NULL,
    sort_order          INT             DEFAULT 0,
    active              INT             DEFAULT 1,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- onboarding_matrix
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_matrix') AND type = 'U')
CREATE TABLE onboarding_matrix (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    sale_type_id        INT             NOT NULL,
    capability_id       INT             NOT NULL,
    enabled             INT             DEFAULT 1,
    notes               NVARCHAR(MAX)   NULL,
    CONSTRAINT UQ_matrix_sale_cap UNIQUE (sale_type_id, capability_id),
    CONSTRAINT FK_matrix_sale FOREIGN KEY (sale_type_id) REFERENCES onboarding_sale_types(id) ON DELETE CASCADE,
    CONSTRAINT FK_matrix_cap FOREIGN KEY (capability_id) REFERENCES onboarding_capabilities(id) ON DELETE CASCADE
);
GO

-- onboarding_capability_items
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_capability_items') AND type = 'U')
CREATE TABLE onboarding_capability_items (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    capability_id       INT             NOT NULL,
    name                NVARCHAR(500)   NOT NULL,
    is_bolt_on          INT             DEFAULT 0,
    sort_order          INT             DEFAULT 0,
    active              INT             DEFAULT 1,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    CONSTRAINT FK_items_cap FOREIGN KEY (capability_id) REFERENCES onboarding_capabilities(id) ON DELETE CASCADE
);
GO

-- onboarding_runs
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'onboarding_runs') AND type = 'U')
CREATE TABLE onboarding_runs (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    onboarding_ref      NVARCHAR(100)   NOT NULL,
    status              NVARCHAR(50)    NOT NULL DEFAULT 'pending',
    parent_key          NVARCHAR(50)    NULL,
    child_keys          NVARCHAR(MAX)   NULL,
    created_count       INT             DEFAULT 0,
    linked_count        INT             DEFAULT 0,
    error_message       NVARCHAR(MAX)   NULL,
    payload             NVARCHAR(MAX)   NULL,
    dry_run             INT             DEFAULT 0,
    user_id             INT             NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- =============================================================================
-- 3. MILESTONES
-- =============================================================================

-- milestone_templates
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'milestone_templates') AND type = 'U')
CREATE TABLE milestone_templates (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    name                NVARCHAR(200)   NOT NULL,
    day_offset          INT             NOT NULL DEFAULT 0,
    sort_order          INT             DEFAULT 0,
    checklist_json      NVARCHAR(MAX)   DEFAULT '[]',
    active              INT             DEFAULT 1,
    lead_days           INT             DEFAULT 3,
    tickets_enabled     INT             DEFAULT 0,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- delivery_milestones
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_milestones') AND type = 'U')
CREATE TABLE delivery_milestones (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    delivery_id         INT             NOT NULL,
    template_id         INT             NOT NULL,
    template_name       NVARCHAR(200)   NOT NULL,
    target_date         NVARCHAR(50)    NULL,
    actual_date         NVARCHAR(50)    NULL,
    status              NVARCHAR(50)    DEFAULT 'pending',
    checklist_state_json NVARCHAR(MAX)  DEFAULT '[]',
    notes               NVARCHAR(MAX)   NULL,
    workflow_task_created INT           DEFAULT 0,
    workflow_tickets_created INT        DEFAULT 0,
    jira_keys           NVARCHAR(MAX)   NULL,
    assigned_to         INT             NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- milestone_template_ticket_groups
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'milestone_template_ticket_groups') AND type = 'U')
CREATE TABLE milestone_template_ticket_groups (
    template_id         INT             NOT NULL,
    ticket_group_id     INT             NOT NULL,
    PRIMARY KEY (template_id, ticket_group_id),
    CONSTRAINT FK_mttg_template FOREIGN KEY (template_id) REFERENCES milestone_templates(id) ON DELETE CASCADE,
    CONSTRAINT FK_mttg_tg FOREIGN KEY (ticket_group_id) REFERENCES onboarding_ticket_groups(id) ON DELETE CASCADE
);
GO

-- milestone_sale_type_offsets
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'milestone_sale_type_offsets') AND type = 'U')
CREATE TABLE milestone_sale_type_offsets (
    sale_type_id        INT             NOT NULL,
    template_id         INT             NOT NULL,
    day_offset          INT             NOT NULL DEFAULT 0,
    PRIMARY KEY (sale_type_id, template_id),
    CONSTRAINT FK_msto_sale FOREIGN KEY (sale_type_id) REFERENCES onboarding_sale_types(id) ON DELETE CASCADE,
    CONSTRAINT FK_msto_tmpl FOREIGN KEY (template_id) REFERENCES milestone_templates(id) ON DELETE CASCADE
);
GO

-- =============================================================================
-- 4. AUDIT, NOTIFICATIONS
-- =============================================================================

-- audit_log
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'audit_log') AND type = 'U')
CREATE TABLE audit_log (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    user_id             INT             NOT NULL,
    entity_type         NVARCHAR(100)   NOT NULL,
    entity_id           NVARCHAR(200)   NOT NULL,
    action              NVARCHAR(100)   NOT NULL,
    changes_json        NVARCHAR(MAX)   NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- notifications
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'notifications') AND type = 'U')
CREATE TABLE notifications (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    user_id             INT             NOT NULL,
    type                NVARCHAR(100)   NOT NULL,
    title               NVARCHAR(500)   NOT NULL,
    message             NVARCHAR(MAX)   NULL,
    entity_type         NVARCHAR(100)   NULL,
    entity_id           NVARCHAR(200)   NULL,
    read_at             DATETIME2       NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- =============================================================================
-- 5. PROBLEM TICKET DETECTION
-- =============================================================================

-- problem_ticket_alerts
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'problem_ticket_alerts') AND type = 'U')
CREATE TABLE problem_ticket_alerts (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    issue_key           NVARCHAR(50)    NOT NULL UNIQUE,
    project_key         NVARCHAR(20)    NOT NULL,
    summary             NVARCHAR(500)   NOT NULL,
    status              NVARCHAR(100)   NULL,
    priority            NVARCHAR(50)    NULL,
    assignee            NVARCHAR(200)   NULL,
    reporter            NVARCHAR(200)   NULL,
    created_at          NVARCHAR(50)    NULL,
    severity            NVARCHAR(50)    NOT NULL,
    score               INT             NOT NULL,
    fingerprint         NVARCHAR(500)   NOT NULL,
    first_seen          DATETIME2       DEFAULT GETUTCDATE(),
    last_seen           DATETIME2       DEFAULT GETUTCDATE(),
    resolved_at         DATETIME2       NULL,
    sla_remaining_ms    BIGINT          NULL,
    sentiment_score     FLOAT           NULL,
    sentiment_summary   NVARCHAR(MAX)   NULL,
    scan_id             NVARCHAR(100)   NOT NULL
);
GO

-- problem_ticket_alert_reasons
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'problem_ticket_alert_reasons') AND type = 'U')
CREATE TABLE problem_ticket_alert_reasons (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    alert_id            INT             NOT NULL,
    [rule]              NVARCHAR(100)   NOT NULL,
    label               NVARCHAR(200)   NOT NULL,
    weight              INT             NOT NULL,
    detail              NVARCHAR(MAX)   NULL,
    CONSTRAINT FK_pta_reasons_alert FOREIGN KEY (alert_id) REFERENCES problem_ticket_alerts(id) ON DELETE CASCADE
);
GO

-- problem_ticket_ignores
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'problem_ticket_ignores') AND type = 'U')
CREATE TABLE problem_ticket_ignores (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    issue_key           NVARCHAR(50)    NOT NULL,
    ignored_by          NVARCHAR(200)   NOT NULL,
    reason              NVARCHAR(MAX)   NULL,
    fingerprint_at_ignore NVARCHAR(500) NOT NULL,
    ignored_at          DATETIME2       DEFAULT GETUTCDATE(),
    lifted_at           DATETIME2       NULL,
    lifted_reason       NVARCHAR(MAX)   NULL
);
GO

-- problem_ticket_config
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'problem_ticket_config') AND type = 'U')
CREATE TABLE problem_ticket_config (
    [rule]              NVARCHAR(100)   NOT NULL PRIMARY KEY,
    enabled             INT             NOT NULL DEFAULT 1,
    weight              INT             NOT NULL,
    threshold_json      NVARCHAR(MAX)   NULL
);
GO

-- =============================================================================
-- 6. INSTANCE SETUP
-- =============================================================================

-- instance_setup_step_templates
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'instance_setup_step_templates') AND type = 'U')
CREATE TABLE instance_setup_step_templates (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    product             NVARCHAR(50)    NOT NULL,
    step_key            NVARCHAR(100)   NOT NULL,
    step_label          NVARCHAR(200)   NOT NULL,
    sort_order          INT             DEFAULT 0,
    required            INT             DEFAULT 1,
    CONSTRAINT UQ_setup_tmpl_product_key UNIQUE (product, step_key)
);
GO

-- instance_setup_steps
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'instance_setup_steps') AND type = 'U')
CREATE TABLE instance_setup_steps (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    delivery_id         INT             NOT NULL,
    step_key            NVARCHAR(100)   NOT NULL,
    step_label          NVARCHAR(200)   NOT NULL,
    status              NVARCHAR(50)    DEFAULT 'pending',
    result_message      NVARCHAR(MAX)   NULL,
    executed_at         NVARCHAR(50)    NULL,
    executed_by         INT             NULL,
    CONSTRAINT UQ_setup_step_delivery_key UNIQUE (delivery_id, step_key),
    CONSTRAINT FK_setup_steps_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
);
GO

-- setup_execution_runs
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'setup_execution_runs') AND type = 'U')
CREATE TABLE setup_execution_runs (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    delivery_id         INT             NOT NULL,
    started_at          DATETIME2       DEFAULT GETUTCDATE(),
    finished_at         DATETIME2       NULL,
    status              NVARCHAR(50)    DEFAULT 'running',
    started_by          INT             NULL,
    summary             NVARCHAR(MAX)   NULL,
    CONSTRAINT FK_setup_runs_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
);
GO

-- setup_execution_logs
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'setup_execution_logs') AND type = 'U')
CREATE TABLE setup_execution_logs (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    run_id              INT             NOT NULL,
    step_key            NVARCHAR(100)   NOT NULL,
    [timestamp]         DATETIME2       DEFAULT GETUTCDATE(),
    level               NVARCHAR(20)    DEFAULT 'info',
    message             NVARCHAR(MAX)   NOT NULL,
    CONSTRAINT FK_setup_logs_run FOREIGN KEY (run_id) REFERENCES setup_execution_runs(id) ON DELETE CASCADE
);
GO

-- setup_portal_tokens
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'setup_portal_tokens') AND type = 'U')
CREATE TABLE setup_portal_tokens (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    token               NVARCHAR(200)   NOT NULL UNIQUE,
    delivery_id         INT             NOT NULL,
    customer_email      NVARCHAR(200)   NOT NULL,
    customer_name       NVARCHAR(200)   NULL,
    expires_at          DATETIME2       NOT NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    last_accessed       DATETIME2       NULL,
    completed_at        DATETIME2       NULL,
    created_by          INT             NULL,
    progress_json       NVARCHAR(MAX)   DEFAULT '{}',
    CONSTRAINT FK_portal_tokens_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
);
GO

-- =============================================================================
-- 7. DELIVERY EXTENSIONS (branches, brand settings, logos, portals, districts)
-- =============================================================================

-- delivery_branches
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_branches') AND type = 'U')
CREATE TABLE delivery_branches (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    delivery_id         INT             NOT NULL,
    is_default          INT             DEFAULT 0,
    name                NVARCHAR(200)   NOT NULL,
    sales_email         NVARCHAR(200)   NULL,
    sales_phone         NVARCHAR(50)    NULL,
    lettings_email      NVARCHAR(200)   NULL,
    lettings_phone      NVARCHAR(50)    NULL,
    address1            NVARCHAR(200)   NULL,
    address2            NVARCHAR(200)   NULL,
    address3            NVARCHAR(200)   NULL,
    town                NVARCHAR(200)   NULL,
    post_code1          NVARCHAR(20)    NULL,
    post_code2          NVARCHAR(20)    NULL,
    sort_order          INT             DEFAULT 0,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_branch_delivery_name UNIQUE (delivery_id, name),
    CONSTRAINT FK_branches_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
);
GO

-- delivery_brand_settings
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_brand_settings') AND type = 'U')
CREATE TABLE delivery_brand_settings (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    delivery_id         INT             NOT NULL,
    setting_key         NVARCHAR(200)   NOT NULL,
    setting_value       NVARCHAR(MAX)   NULL,
    updated_at          DATETIME2       DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_brand_setting_delivery_key UNIQUE (delivery_id, setting_key),
    CONSTRAINT FK_brand_settings_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
);
GO

-- delivery_logos
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_logos') AND type = 'U')
CREATE TABLE delivery_logos (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    delivery_id         INT             NOT NULL,
    logo_type           INT             NOT NULL,
    logo_label          NVARCHAR(200)   NOT NULL,
    mime_type           NVARCHAR(100)   NOT NULL DEFAULT 'image/png',
    image_data          NVARCHAR(MAX)   NOT NULL,  -- base64 in SQLite, keep as NVARCHAR(MAX)
    file_name           NVARCHAR(200)   NULL,
    file_size           INT             NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_logo_delivery_type UNIQUE (delivery_id, logo_type),
    CONSTRAINT FK_logos_delivery FOREIGN KEY (delivery_id) REFERENCES delivery_entries(id) ON DELETE CASCADE
);
GO

-- delivery_portal_accounts
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_portal_accounts') AND type = 'U')
CREATE TABLE delivery_portal_accounts (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    delivery_id         INT             NOT NULL,
    portal_name         NVARCHAR(200)   NOT NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_portal_delivery_name UNIQUE (delivery_id, portal_name)
);
GO

-- delivery_branch_districts
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_branch_districts') AND type = 'U')
CREATE TABLE delivery_branch_districts (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    branch_id           INT             NOT NULL,
    delivery_id         INT             NOT NULL,
    district_name       NVARCHAR(200)   NOT NULL,
    all_sectors         INT             DEFAULT 0,
    sectors_json        NVARCHAR(MAX)   DEFAULT '[]',
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_district_branch_name UNIQUE (branch_id, district_name),
    CONSTRAINT FK_districts_branch FOREIGN KEY (branch_id) REFERENCES delivery_branches(id) ON DELETE CASCADE
);
GO

-- delivery_welcome_packs
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'delivery_welcome_packs') AND type = 'U')
CREATE TABLE delivery_welcome_packs (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    delivery_id         INT             NOT NULL,
    name                NVARCHAR(200)   NOT NULL,
    snapshot_json       NVARCHAR(MAX)   NOT NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    created_by          NVARCHAR(200)   NULL
);
GO

-- =============================================================================
-- 8. CRM
-- =============================================================================

-- crm_customers
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'crm_customers') AND type = 'U')
CREATE TABLE crm_customers (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    name                NVARCHAR(200)   NOT NULL,
    company             NVARCHAR(200)   NULL,
    sector              NVARCHAR(100)   NULL,
    mrr                 DECIMAL(18,4)   NULL,
    owner               NVARCHAR(200)   NULL,
    rag_status          NVARCHAR(20)    DEFAULT 'green',
    next_review_date    NVARCHAR(50)    NULL,
    contract_start      NVARCHAR(50)    NULL,
    contract_end        NVARCHAR(50)    NULL,
    dynamics_id         NVARCHAR(200)   NULL,
    account_number      NVARCHAR(100)   NULL,
    notes               NVARCHAR(MAX)   NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- crm_reviews
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'crm_reviews') AND type = 'U')
CREATE TABLE crm_reviews (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    customer_id         INT             NOT NULL,
    review_date         NVARCHAR(50)    NOT NULL,
    rag_status          NVARCHAR(20)    NOT NULL,
    outcome             NVARCHAR(MAX)   NULL,
    actions             NVARCHAR(MAX)   NULL,
    reviewer            NVARCHAR(200)   NULL,
    next_review_date    NVARCHAR(50)    NULL,
    notes               NVARCHAR(MAX)   NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- =============================================================================
-- 9. SALES
-- =============================================================================

-- sales_pipeline
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_pipeline') AND type = 'U')
CREATE TABLE sales_pipeline (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    salesperson         NVARCHAR(200)   NOT NULL,
    lead_gen            NVARCHAR(200)   NULL,
    company             NVARCHAR(500)   NOT NULL,
    mrr                 DECIMAL(18,4)   NOT NULL DEFAULT 0,
    product             NVARCHAR(200)   NULL,
    stage               NVARCHAR(100)   NOT NULL,
    demo_date           NVARCHAR(50)    NULL,
    est_close_date      NVARCHAR(50)    NULL,
    next_chase_date     NVARCHAR(50)    NULL,
    contact             NVARCHAR(200)   NULL,
    phone               NVARCHAR(50)    NULL,
    notes               NVARCHAR(MAX)   NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- sales_monthly
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_monthly') AND type = 'U')
CREATE TABLE sales_monthly (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    sale_date           NVARCHAR(50)    NOT NULL,
    lead_gen            NVARCHAR(200)   NULL,
    salesperson         NVARCHAR(200)   NOT NULL,
    product             NVARCHAR(200)   NULL,
    trading_name        NVARCHAR(500)   NULL,
    limited_company     NVARCHAR(500)   NULL,
    company_number      NVARCHAR(50)    NULL,
    email               NVARCHAR(200)   NULL,
    setup_fee           DECIMAL(18,4)   DEFAULT 0,
    licence             DECIMAL(18,4)   DEFAULT 0,
    upsell_mrr          DECIMAL(18,4)   DEFAULT 0,
    postal              DECIMAL(18,4)   DEFAULT 0,
    coms                DECIMAL(18,4)   DEFAULT 0,
    trial_mrr           DECIMAL(18,4)   DEFAULT 0,
    actual_mrr          DECIMAL(18,4)   DEFAULT 0,
    branches            INT             DEFAULT 1,
    existing_vs_new     NVARCHAR(50)    NULL,
    hotbox_ref          INT             NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- sales_targets
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_targets') AND type = 'U')
CREATE TABLE sales_targets (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    salesperson         NVARCHAR(200)   NOT NULL,
    month               NVARCHAR(20)    NOT NULL,
    target_mrr          DECIMAL(18,4)   NOT NULL DEFAULT 0,
    CONSTRAINT UQ_sales_targets_person_month UNIQUE (salesperson, month)
);
GO

-- sales_bookings
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_bookings') AND type = 'U')
CREATE TABLE sales_bookings (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    booked_date         NVARCHAR(50)    NOT NULL,
    salesperson         NVARCHAR(200)   NOT NULL,
    lead_gen            NVARCHAR(200)   NULL,
    team                NVARCHAR(100)   NULL,
    product             NVARCHAR(200)   NULL,
    company             NVARCHAR(500)   NOT NULL,
    email               NVARCHAR(200)   NULL,
    client_type         NVARCHAR(100)   NULL,
    demo_date           NVARCHAR(50)    NULL,
    dm                  NVARCHAR(200)   NULL,
    phone               NVARCHAR(50)    NULL,
    lead_source         NVARCHAR(200)   NULL,
    taken_place         INT             DEFAULT 0,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- sales_taken_place
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_taken_place') AND type = 'U')
CREATE TABLE sales_taken_place (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    demo_date           NVARCHAR(50)    NOT NULL,
    salesperson         NVARCHAR(200)   NOT NULL,
    lead_gen            NVARCHAR(200)   NULL,
    product             NVARCHAR(200)   NULL,
    company             NVARCHAR(500)   NOT NULL,
    email               NVARCHAR(200)   NULL,
    branches            INT             DEFAULT 1,
    dm                  NVARCHAR(200)   NULL,
    est_mrr             DECIMAL(18,4)   DEFAULT 0,
    hwc                 NVARCHAR(200)   NULL,
    in_hotbox           NVARCHAR(10)    DEFAULT 'No',
    client_type         NVARCHAR(100)   NULL,
    notes               NVARCHAR(MAX)   NULL,
    booking_id          INT             NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- sales_lg_kpi
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_lg_kpi') AND type = 'U')
CREATE TABLE sales_lg_kpi (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    person              NVARCHAR(200)   NOT NULL,
    month               NVARCHAR(20)    NOT NULL,
    days_worked         FLOAT           DEFAULT 0,
    calls_kpi           FLOAT           DEFAULT 0,
    calls_actual        FLOAT           DEFAULT 0,
    booked_kpi          FLOAT           DEFAULT 0,
    booked_actual       FLOAT           DEFAULT 0,
    tp_kpi              FLOAT           DEFAULT 0,
    tp_actual           FLOAT           DEFAULT 0,
    sales_count         FLOAT           DEFAULT 0,
    mrr_total           FLOAT           DEFAULT 0,
    CONSTRAINT UQ_lg_kpi_person_month UNIQUE (person, month)
);
GO

-- sales_lg_history
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_lg_history') AND type = 'U')
CREATE TABLE sales_lg_history (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    year                INT             NOT NULL,
    month_num           INT             NOT NULL,
    calls               INT             DEFAULT 0,
    bookings            INT             DEFAULT 0,
    taken_place         INT             DEFAULT 0,
    CONSTRAINT UQ_lg_history_year_month UNIQUE (year, month_num)
);
GO

-- sales_bdm_kpi
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sales_bdm_kpi') AND type = 'U')
CREATE TABLE sales_bdm_kpi (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    person              NVARCHAR(200)   NOT NULL,
    month               NVARCHAR(20)    NOT NULL,
    booked_kpi          FLOAT           DEFAULT 0,
    booked_actual       FLOAT           DEFAULT 0,
    tp_kpi              FLOAT           DEFAULT 0,
    tp_actual           FLOAT           DEFAULT 0,
    sales_kpi           FLOAT           DEFAULT 0,
    sales_actual        FLOAT           DEFAULT 0,
    mrr_kpi             FLOAT           DEFAULT 0,
    mrr_actual          FLOAT           DEFAULT 0,
    target              FLOAT           DEFAULT 0,
    CONSTRAINT UQ_bdm_kpi_person_month UNIQUE (person, month)
);
GO

-- =============================================================================
-- 10. BUSINESS CENTRAL & CONTRACTS
-- =============================================================================

-- bc_customers
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'bc_customers') AND type = 'U')
CREATE TABLE bc_customers (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    bc_id               NVARCHAR(200)   NOT NULL UNIQUE,
    number              NVARCHAR(50)    NULL,
    display_name        NVARCHAR(200)   NOT NULL,
    email               NVARCHAR(200)   NULL,
    phone_number        NVARCHAR(50)    NULL,
    address             NVARCHAR(500)   NULL,
    address_line_2      NVARCHAR(200)   NULL,
    city                NVARCHAR(200)   NULL,
    state               NVARCHAR(100)   NULL,
    country             NVARCHAR(100)   NULL,
    postal_code         NVARCHAR(50)    NULL,
    tax_registration_number NVARCHAR(100) NULL,
    primary_contact_name NVARCHAR(200)  NULL,
    currency_code       NVARCHAR(10)    NULL,
    balance             DECIMAL(18,4)   NULL,
    blocked             NVARCHAR(50)    NULL,
    last_synced         DATETIME2       DEFAULT GETUTCDATE(),
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- contracts
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'contracts') AND type = 'U')
CREATE TABLE contracts (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    bc_customer_id      NVARCHAR(200)   NULL,
    customer_name       NVARCHAR(200)   NOT NULL,
    contract_number     NVARCHAR(100)   NULL,
    title               NVARCHAR(500)   NOT NULL,
    status              NVARCHAR(50)    DEFAULT 'active',
    start_date          NVARCHAR(50)    NULL,
    end_date            NVARCHAR(50)    NULL,
    value               DECIMAL(18,4)   NULL,
    currency            NVARCHAR(10)    DEFAULT 'GBP',
    renewal_type        NVARCHAR(100)   NULL,
    notes               NVARCHAR(MAX)   NULL,
    bc_order_id         NVARCHAR(200)   NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- adobe_sign_agreements
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'adobe_sign_agreements') AND type = 'U')
CREATE TABLE adobe_sign_agreements (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    agreement_id        NVARCHAR(200)   NOT NULL UNIQUE,
    contract_id         INT             NULL,
    template_id         INT             NULL,
    bc_customer_id      NVARCHAR(200)   NULL,
    subscription_contract_no NVARCHAR(50) NULL,
    name                NVARCHAR(500)   NOT NULL,
    status              NVARCHAR(50)    DEFAULT 'DRAFT',
    sender_email        NVARCHAR(200)   NULL,
    signer_emails       NVARCHAR(MAX)   NULL,
    filled_fields       NVARCHAR(MAX)   NULL,
    signed_form_data    NVARCHAR(MAX)   NULL,
    signed_pdf_path     NVARCHAR(500)   NULL,
    signed_at           DATETIME2       NULL,
    created_via_nova    INT             DEFAULT 0,
    adobe_created_date  NVARCHAR(50)    NULL,
    adobe_expiration_date NVARCHAR(50)  NULL,
    signed_document_url NVARCHAR(2000)  NULL,
    raw_data            NVARCHAR(MAX)   NULL,
    synced_at           DATETIME2       NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- =============================================================================
-- 11. SURVEYS
-- =============================================================================

-- surveys
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'surveys') AND type = 'U')
CREATE TABLE surveys (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    title               NVARCHAR(500)   NOT NULL,
    description         NVARCHAR(MAX)   NULL,
    team_name           NVARCHAR(200)   NOT NULL,
    status              NVARCHAR(50)    NOT NULL DEFAULT 'draft',
    start_date          NVARCHAR(50)    NULL,
    end_date            NVARCHAR(50)    NULL,
    invite_send_date    NVARCHAR(50)    NULL,
    reminder_interval_days INT          DEFAULT 2,
    category            NVARCHAR(100)   NULL,
    recurrence_interval_days INT        NULL,
    next_recurrence_date NVARCHAR(50)   NULL,
    parent_survey_id    INT             NULL,
    created_at          DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
    closed_at           DATETIME2       NULL,
    created_by          NVARCHAR(200)   NOT NULL
);
GO

-- survey_questions
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'survey_questions') AND type = 'U')
CREATE TABLE survey_questions (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    survey_id           INT             NOT NULL,
    order_index         INT             NOT NULL,
    question_text       NVARCHAR(MAX)   NOT NULL,
    question_type       NVARCHAR(50)    NOT NULL,
    required            INT             NOT NULL DEFAULT 1,
    CONSTRAINT FK_sq_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
);
GO

-- survey_recipients
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'survey_recipients') AND type = 'U')
CREATE TABLE survey_recipients (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    survey_id           INT             NOT NULL,
    display_name        NVARCHAR(200)   NOT NULL,
    email               NVARCHAR(200)   NOT NULL,
    token               NVARCHAR(200)   NOT NULL UNIQUE,
    invite_sent         INT             NOT NULL DEFAULT 0,
    last_reminder_sent  NVARCHAR(50)    NULL,
    completed           INT             NOT NULL DEFAULT 0,
    completed_at        DATETIME2       NULL,
    CONSTRAINT FK_sr_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
);
GO

-- survey_responses
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'survey_responses') AND type = 'U')
CREATE TABLE survey_responses (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    survey_id           INT             NOT NULL,
    token               NVARCHAR(200)   NOT NULL UNIQUE,
    submitted_at        DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
    answers             NVARCHAR(MAX)   NOT NULL,
    CONSTRAINT FK_sres_survey FOREIGN KEY (survey_id) REFERENCES surveys(id)
);
GO

-- =============================================================================
-- 12. AI APPROVAL QUEUE
-- =============================================================================

-- approval_queue
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'approval_queue') AND type = 'U')
CREATE TABLE approval_queue (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    ticket_id           NVARCHAR(50)    NOT NULL,
    ticket_summary      NVARCHAR(500)   NOT NULL,
    reporter_name       NVARCHAR(200)   NULL,
    reporter_email      NVARCHAR(200)   NULL,
    ai_response_adf     NVARCHAR(MAX)   NULL,
    conversation_json   NVARCHAR(MAX)   NULL,
    kb_sources          NVARCHAR(MAX)   NULL,
    resume_url          NVARCHAR(2000)  NOT NULL,
    status              NVARCHAR(50)    DEFAULT 'pending',
    decided_by          NVARCHAR(200)   NULL,
    decided_at          DATETIME2       NULL,
    edited_response_adf NVARCHAR(MAX)   NULL,
    decline_reason      NVARCHAR(MAX)   NULL,
    priority            NVARCHAR(50)    NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    expires_at          DATETIME2       NOT NULL
);
GO

-- =============================================================================
-- 13. TRAINING MATRIX
-- =============================================================================

-- training_categories
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'training_categories') AND type = 'U')
CREATE TABLE training_categories (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    name                NVARCHAR(200)   NOT NULL UNIQUE,
    sort_order          INT             DEFAULT 0
);
GO

-- training_items
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'training_items') AND type = 'U')
CREATE TABLE training_items (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    category_id         INT             NOT NULL,
    section             NVARCHAR(200)   DEFAULT '',
    name                NVARCHAR(500)   NOT NULL,
    tech_lead           NVARCHAR(200)   NULL,
    max_score           INT             DEFAULT 5,
    sort_order          INT             DEFAULT 0,
    CONSTRAINT FK_ti_category FOREIGN KEY (category_id) REFERENCES training_categories(id) ON DELETE CASCADE
);
GO

-- training_scores
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'training_scores') AND type = 'U')
CREATE TABLE training_scores (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    item_id             INT             NOT NULL,
    user_id             INT             NOT NULL,
    score               INT             DEFAULT 0,
    updated_at          DATETIME2       DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_training_score_item_user UNIQUE (item_id, user_id),
    CONSTRAINT FK_ts_item FOREIGN KEY (item_id) REFERENCES training_items(id) ON DELETE CASCADE
);
GO

-- training_members
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'training_members') AND type = 'U')
CREATE TABLE training_members (
    user_id             INT             PRIMARY KEY,
    sort_order          INT             DEFAULT 0
);
GO

-- =============================================================================
-- 14. DEV REVIEW
-- =============================================================================

-- dev_review_state
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dev_review_state') AND type = 'U')
CREATE TABLE dev_review_state (
    jira_key            NVARCHAR(50)    NOT NULL PRIMARY KEY,
    status              NVARCHAR(50)    NOT NULL DEFAULT 'pending',
    fast_track          INT             NOT NULL DEFAULT 0,
    nova_priority       NVARCHAR(20)    DEFAULT 'normal',
    claimed_by_user_id  INT             NULL,
    claimed_at          DATETIME2       NULL,
    submitted_by_username NVARCHAR(100) NULL,
    team                NVARCHAR(200)   NULL,
    first_seen_at       DATETIME2       DEFAULT GETUTCDATE(),
    last_action_at      DATETIME2       DEFAULT GETUTCDATE(),
    accepted_at         DATETIME2       NULL,
    returned_at         DATETIME2       NULL,
    archived_at         DATETIME2       NULL
);
GO

-- dev_review_thread
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dev_review_thread') AND type = 'U')
CREATE TABLE dev_review_thread (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    jira_key            NVARCHAR(50)    NOT NULL,
    user_id             INT             NOT NULL,
    user_display        NVARCHAR(200)   NOT NULL,
    kind                NVARCHAR(50)    NOT NULL,
    body                NVARCHAR(MAX)   NULL,
    meta_json           NVARCHAR(MAX)   NULL,
    jira_sync_state     NVARCHAR(20)    DEFAULT 'pending',
    jira_sync_error     NVARCHAR(MAX)   NULL,
    jira_comment_id     NVARCHAR(100)   NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE()
);
GO

-- dev_review_outbox
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dev_review_outbox') AND type = 'U')
CREATE TABLE dev_review_outbox (
    id                  INT             IDENTITY(1,1) PRIMARY KEY,
    jira_key            NVARCHAR(50)    NOT NULL,
    op                  NVARCHAR(50)    NOT NULL,
    payload_json        NVARCHAR(MAX)   NOT NULL,
    attempts            INT             NOT NULL DEFAULT 0,
    status              NVARCHAR(50)    NOT NULL DEFAULT 'pending',
    last_error          NVARCHAR(MAX)   NULL,
    created_at          DATETIME2       DEFAULT GETUTCDATE(),
    processed_at        DATETIME2       NULL
);
GO

-- mi_commentary
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'mi_commentary') AND type = 'U')
CREATE TABLE mi_commentary (
    month               NVARCHAR(20)    NOT NULL PRIMARY KEY,
    content             NVARCHAR(MAX)   NULL,
    updated_at          DATETIME2       DEFAULT GETUTCDATE(),
    updated_by_user_id  INT             NULL
);
GO

-- =============================================================================
-- 15. INDEXES
-- =============================================================================
-- Matches every index from schema.ts. Naming convention: IX_<table>_<columns>.
-- Filtered indexes use WHERE clause (MSSQL supports these natively).

-- tasks
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_source' AND object_id = OBJECT_ID('tasks'))
    CREATE NONCLUSTERED INDEX IX_tasks_source ON tasks(source);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_status' AND object_id = OBJECT_ID('tasks'))
    CREATE NONCLUSTERED INDEX IX_tasks_status ON tasks(status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_priority' AND object_id = OBJECT_ID('tasks'))
    CREATE NONCLUSTERED INDEX IX_tasks_priority ON tasks(priority DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_due_date' AND object_id = OBJECT_ID('tasks'))
    CREATE NONCLUSTERED INDEX IX_tasks_due_date ON tasks(due_date);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_sla_breach' AND object_id = OBJECT_ID('tasks'))
    CREATE NONCLUSTERED INDEX IX_tasks_sla_breach ON tasks(sla_breach_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_user' AND object_id = OBJECT_ID('tasks'))
    CREATE NONCLUSTERED INDEX IX_tasks_user ON tasks(user_id);
GO

-- rituals
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_rituals_type_date' AND object_id = OBJECT_ID('rituals'))
    CREATE NONCLUSTERED INDEX IX_rituals_type_date ON rituals(type, date);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_rituals_user' AND object_id = OBJECT_ID('rituals'))
    CREATE NONCLUSTERED INDEX IX_rituals_user ON rituals(user_id);
GO

-- crm_customers
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_crm_customers_rag' AND object_id = OBJECT_ID('crm_customers'))
    CREATE NONCLUSTERED INDEX IX_crm_customers_rag ON crm_customers(rag_status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_crm_customers_next_review' AND object_id = OBJECT_ID('crm_customers'))
    CREATE NONCLUSTERED INDEX IX_crm_customers_next_review ON crm_customers(next_review_date);
GO

-- crm_reviews
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_crm_reviews_customer' AND object_id = OBJECT_ID('crm_reviews'))
    CREATE NONCLUSTERED INDEX IX_crm_reviews_customer ON crm_reviews(customer_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_crm_reviews_date' AND object_id = OBJECT_ID('crm_reviews'))
    CREATE NONCLUSTERED INDEX IX_crm_reviews_date ON crm_reviews(review_date DESC);
GO

-- feedback
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_feedback_user' AND object_id = OBJECT_ID('feedback'))
    CREATE NONCLUSTERED INDEX IX_feedback_user ON feedback(user_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_feedback_status' AND object_id = OBJECT_ID('feedback'))
    CREATE NONCLUSTERED INDEX IX_feedback_status ON feedback(status);
GO

-- user_task_pins
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_user_task_pins_user' AND object_id = OBJECT_ID('user_task_pins'))
    CREATE NONCLUSTERED INDEX IX_user_task_pins_user ON user_task_pins(user_id);
GO

-- delivery_entries
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_product' AND object_id = OBJECT_ID('delivery_entries'))
    CREATE NONCLUSTERED INDEX IX_delivery_product ON delivery_entries(product);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_onboarding_id' AND object_id = OBJECT_ID('delivery_entries'))
    CREATE UNIQUE NONCLUSTERED INDEX IX_delivery_onboarding_id ON delivery_entries(onboarding_id) WHERE onboarding_id IS NOT NULL;
GO

-- onboarding
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_ticket_groups_sort' AND object_id = OBJECT_ID('onboarding_ticket_groups'))
    CREATE NONCLUSTERED INDEX IX_onboarding_ticket_groups_sort ON onboarding_ticket_groups(sort_order);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_caps_group' AND object_id = OBJECT_ID('onboarding_capabilities'))
    CREATE NONCLUSTERED INDEX IX_onboarding_caps_group ON onboarding_capabilities(ticket_group_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_matrix_sale' AND object_id = OBJECT_ID('onboarding_matrix'))
    CREATE NONCLUSTERED INDEX IX_onboarding_matrix_sale ON onboarding_matrix(sale_type_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_matrix_cap' AND object_id = OBJECT_ID('onboarding_matrix'))
    CREATE NONCLUSTERED INDEX IX_onboarding_matrix_cap ON onboarding_matrix(capability_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_items_cap' AND object_id = OBJECT_ID('onboarding_capability_items'))
    CREATE NONCLUSTERED INDEX IX_onboarding_items_cap ON onboarding_capability_items(capability_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_runs_ref' AND object_id = OBJECT_ID('onboarding_runs'))
    CREATE NONCLUSTERED INDEX IX_onboarding_runs_ref ON onboarding_runs(onboarding_ref);
GO

-- milestones
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestones_delivery' AND object_id = OBJECT_ID('delivery_milestones'))
    CREATE NONCLUSTERED INDEX IX_milestones_delivery ON delivery_milestones(delivery_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestones_status' AND object_id = OBJECT_ID('delivery_milestones'))
    CREATE NONCLUSTERED INDEX IX_milestones_status ON delivery_milestones(status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestones_target' AND object_id = OBJECT_ID('delivery_milestones'))
    CREATE NONCLUSTERED INDEX IX_milestones_target ON delivery_milestones(target_date);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestones_workflow' AND object_id = OBJECT_ID('delivery_milestones'))
    CREATE NONCLUSTERED INDEX IX_milestones_workflow ON delivery_milestones(workflow_task_created, status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestone_templates_active' AND object_id = OBJECT_ID('milestone_templates'))
    CREATE NONCLUSTERED INDEX IX_milestone_templates_active ON milestone_templates(active, sort_order);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestone_tmpl_tg' AND object_id = OBJECT_ID('milestone_template_ticket_groups'))
    CREATE NONCLUSTERED INDEX IX_milestone_tmpl_tg ON milestone_template_ticket_groups(template_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_milestone_tg_tmpl' AND object_id = OBJECT_ID('milestone_template_ticket_groups'))
    CREATE NONCLUSTERED INDEX IX_milestone_tg_tmpl ON milestone_template_ticket_groups(ticket_group_id);
GO

-- audit_log
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_entity' AND object_id = OBJECT_ID('audit_log'))
    CREATE NONCLUSTERED INDEX IX_audit_entity ON audit_log(entity_type, entity_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_user' AND object_id = OBJECT_ID('audit_log'))
    CREATE NONCLUSTERED INDEX IX_audit_user ON audit_log(user_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_created' AND object_id = OBJECT_ID('audit_log'))
    CREATE NONCLUSTERED INDEX IX_audit_created ON audit_log(created_at DESC);
GO

-- notifications
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_notif_user' AND object_id = OBJECT_ID('notifications'))
    CREATE NONCLUSTERED INDEX IX_notif_user ON notifications(user_id, read_at);
GO
-- Filtered unique index: deduplicate unread notifications per user/type/entity
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_notif_dedup' AND object_id = OBJECT_ID('notifications'))
    CREATE UNIQUE NONCLUSTERED INDEX IX_notif_dedup ON notifications(user_id, type, entity_id) WHERE read_at IS NULL;
GO

-- problem_ticket_alerts (issue_key already has UNIQUE constraint)
-- problem_ticket_alert_reasons
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pta_reasons_alert' AND object_id = OBJECT_ID('problem_ticket_alert_reasons'))
    CREATE NONCLUSTERED INDEX IX_pta_reasons_alert ON problem_ticket_alert_reasons(alert_id);
GO

-- instance_setup
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_steps_delivery' AND object_id = OBJECT_ID('instance_setup_steps'))
    CREATE NONCLUSTERED INDEX IX_setup_steps_delivery ON instance_setup_steps(delivery_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_templates_product' AND object_id = OBJECT_ID('instance_setup_step_templates'))
    CREATE NONCLUSTERED INDEX IX_setup_templates_product ON instance_setup_step_templates(product, sort_order);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_runs_delivery' AND object_id = OBJECT_ID('setup_execution_runs'))
    CREATE NONCLUSTERED INDEX IX_setup_runs_delivery ON setup_execution_runs(delivery_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_logs_run' AND object_id = OBJECT_ID('setup_execution_logs'))
    CREATE NONCLUSTERED INDEX IX_setup_logs_run ON setup_execution_logs(run_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_setup_portal_delivery' AND object_id = OBJECT_ID('setup_portal_tokens'))
    CREATE NONCLUSTERED INDEX IX_setup_portal_delivery ON setup_portal_tokens(delivery_id);
GO

-- delivery extensions
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_branches_delivery' AND object_id = OBJECT_ID('delivery_branches'))
    CREATE NONCLUSTERED INDEX IX_delivery_branches_delivery ON delivery_branches(delivery_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_brand_settings_delivery' AND object_id = OBJECT_ID('delivery_brand_settings'))
    CREATE NONCLUSTERED INDEX IX_brand_settings_delivery ON delivery_brand_settings(delivery_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_logos_delivery' AND object_id = OBJECT_ID('delivery_logos'))
    CREATE NONCLUSTERED INDEX IX_delivery_logos_delivery ON delivery_logos(delivery_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_portal_accounts_delivery' AND object_id = OBJECT_ID('delivery_portal_accounts'))
    CREATE NONCLUSTERED INDEX IX_portal_accounts_delivery ON delivery_portal_accounts(delivery_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_branch_districts_delivery' AND object_id = OBJECT_ID('delivery_branch_districts'))
    CREATE NONCLUSTERED INDEX IX_branch_districts_delivery ON delivery_branch_districts(delivery_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_branch_districts_branch' AND object_id = OBJECT_ID('delivery_branch_districts'))
    CREATE NONCLUSTERED INDEX IX_branch_districts_branch ON delivery_branch_districts(branch_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_welcome_packs_delivery' AND object_id = OBJECT_ID('delivery_welcome_packs'))
    CREATE NONCLUSTERED INDEX IX_welcome_packs_delivery ON delivery_welcome_packs(delivery_id);
GO

-- sales
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_pipeline_salesperson' AND object_id = OBJECT_ID('sales_pipeline'))
    CREATE NONCLUSTERED INDEX IX_sales_pipeline_salesperson ON sales_pipeline(salesperson);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_pipeline_stage' AND object_id = OBJECT_ID('sales_pipeline'))
    CREATE NONCLUSTERED INDEX IX_sales_pipeline_stage ON sales_pipeline(stage);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_monthly_salesperson' AND object_id = OBJECT_ID('sales_monthly'))
    CREATE NONCLUSTERED INDEX IX_sales_monthly_salesperson ON sales_monthly(salesperson);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_monthly_date' AND object_id = OBJECT_ID('sales_monthly'))
    CREATE NONCLUSTERED INDEX IX_sales_monthly_date ON sales_monthly(sale_date);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_bookings_date' AND object_id = OBJECT_ID('sales_bookings'))
    CREATE NONCLUSTERED INDEX IX_sales_bookings_date ON sales_bookings(booked_date);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_taken_place_date' AND object_id = OBJECT_ID('sales_taken_place'))
    CREATE NONCLUSTERED INDEX IX_sales_taken_place_date ON sales_taken_place(demo_date);
GO

-- surveys
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_surveys_status' AND object_id = OBJECT_ID('surveys'))
    CREATE NONCLUSTERED INDEX IX_surveys_status ON surveys(status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_surveys_category' AND object_id = OBJECT_ID('surveys'))
    CREATE NONCLUSTERED INDEX IX_surveys_category ON surveys(category);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_survey_questions_survey' AND object_id = OBJECT_ID('survey_questions'))
    CREATE NONCLUSTERED INDEX IX_survey_questions_survey ON survey_questions(survey_id, order_index);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_survey_recipients_survey' AND object_id = OBJECT_ID('survey_recipients'))
    CREATE NONCLUSTERED INDEX IX_survey_recipients_survey ON survey_recipients(survey_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_survey_responses_survey' AND object_id = OBJECT_ID('survey_responses'))
    CREATE NONCLUSTERED INDEX IX_survey_responses_survey ON survey_responses(survey_id);
GO

-- approval_queue
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_approval_queue_status' AND object_id = OBJECT_ID('approval_queue'))
    CREATE NONCLUSTERED INDEX IX_approval_queue_status ON approval_queue(status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_approval_queue_ticket' AND object_id = OBJECT_ID('approval_queue'))
    CREATE NONCLUSTERED INDEX IX_approval_queue_ticket ON approval_queue(ticket_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_approval_queue_expires' AND object_id = OBJECT_ID('approval_queue'))
    CREATE NONCLUSTERED INDEX IX_approval_queue_expires ON approval_queue(expires_at);
GO

-- training
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_training_items_category' AND object_id = OBJECT_ID('training_items'))
    CREATE NONCLUSTERED INDEX IX_training_items_category ON training_items(category_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_training_scores_item' AND object_id = OBJECT_ID('training_scores'))
    CREATE NONCLUSTERED INDEX IX_training_scores_item ON training_scores(item_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_training_scores_user' AND object_id = OBJECT_ID('training_scores'))
    CREATE NONCLUSTERED INDEX IX_training_scores_user ON training_scores(user_id);
GO

-- dev_review
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_dev_review_status' AND object_id = OBJECT_ID('dev_review_state'))
    CREATE NONCLUSTERED INDEX IX_dev_review_status ON dev_review_state(status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_dev_review_claimed' AND object_id = OBJECT_ID('dev_review_state'))
    CREATE NONCLUSTERED INDEX IX_dev_review_claimed ON dev_review_state(claimed_by_user_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_dev_review_team' AND object_id = OBJECT_ID('dev_review_state'))
    CREATE NONCLUSTERED INDEX IX_dev_review_team ON dev_review_state(team);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_dev_thread_key' AND object_id = OBJECT_ID('dev_review_thread'))
    CREATE NONCLUSTERED INDEX IX_dev_thread_key ON dev_review_thread(jira_key, created_at DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_dev_thread_sync' AND object_id = OBJECT_ID('dev_review_thread'))
    CREATE NONCLUSTERED INDEX IX_dev_thread_sync ON dev_review_thread(jira_sync_state) WHERE jira_sync_state = 'pending';
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_dev_outbox_status' AND object_id = OBJECT_ID('dev_review_outbox'))
    CREATE NONCLUSTERED INDEX IX_dev_outbox_status ON dev_review_outbox(status, created_at);
GO

-- =============================================================================
-- 16. SEED DATA
-- =============================================================================

-- Problem ticket config defaults (MERGE = idempotent upsert)
MERGE INTO problem_ticket_config AS target
USING (VALUES
    ('sla_breached',      1, 30, '{}'),
    ('sla_near',          1, 20, '{"hoursThreshold":2}'),
    ('stale_comms',       1, 15, '{"daysThreshold":3}'),
    ('ticket_age',        1, 10, '{"daysThreshold":7}'),
    ('ping_pong',         1, 15, '{"reassignThreshold":3,"windowHours":48}'),
    ('reopened',          1, 10, '{}'),
    ('high_priority',     1, 10, '{"priorities":["Highest","High"]}'),
    ('sentiment',         1, 20, '{"negativeThreshold":-0.3}'),
    ('stagnant_status',   1, 10, '{"daysThreshold":5}'),
    ('missed_commitment', 1, 25, '{}'),
    ('no_next_reply',     1, 20, '{"hoursThreshold":4,"staffDomains":["nurtur"]}')
) AS source ([rule], enabled, weight, threshold_json)
ON target.[rule] = source.[rule]
WHEN NOT MATCHED THEN
    INSERT ([rule], enabled, weight, threshold_json)
    VALUES (source.[rule], source.enabled, source.weight, source.threshold_json);
GO

-- Default settings (do not overwrite existing values)
MERGE INTO settings AS target
USING (VALUES
    ('source_weight_jira',      '90'),
    ('source_weight_planner',   '60'),
    ('source_weight_todo',      '50'),
    ('source_weight_monday',    '55'),
    ('source_weight_email',     '40'),
    ('source_weight_calendar',  '70'),
    ('refresh_interval_minutes','5')
) AS source ([key], value)
ON target.[key] = source.[key]
WHEN NOT MATCHED THEN
    INSERT ([key], value) VALUES (source.[key], source.value);
GO

-- BYM instance setup step templates
MERGE INTO instance_setup_step_templates AS target
USING (VALUES
    ('BYM', 'setupBrands',           'Create Brands',             1, 1),
    ('BYM', 'setupTemplates',        'Confirm Email Templates',   2, 1),
    ('BYM', 'setupDirectMail',       'Confirm Direct Mail',       3, 1),
    ('BYM', 'setupLetterhead',       'Confirm Letterhead',        4, 1),
    ('BYM', 'setupBranches',         'Create Branches',           5, 1),
    ('BYM', 'setupDistricts',        'Configure Branch Districts', 6, 0),
    ('BYM', 'setupDeliveryAddresses','Create Delivery Addresses', 6, 1),
    ('BYM', 'setupUsers',            'Create Users',              7, 1),
    ('BYM', 'setupRss',              'Add RSS Feeds',             8, 1),
    ('BYM', 'setupRobocop',          'Add Robocop Settings',      9, 1),
    ('BYM', 'setupScheduledReports', 'Add Scheduled Reports',    10, 1),
    ('BYM', 'setupComponents',       'Add Email Components',     11, 1),
    ('BYM', 'setupAutomatedEmails',  'Add Automated Emails',     12, 1),
    ('BYM', 'setupBuildMilestones',  'Add Build Milestones',     13, 1),
    ('BYM', 'setupBuildPortals',     'Add Build Portals',        14, 1),
    ('BYM', 'setupBuildContent',     'Add Build Content',        15, 1),
    ('BYM', 'setupMatchToCrm',       'Match to CRM',             16, 1)
) AS source (product, step_key, step_label, sort_order, required)
ON target.product = source.product AND target.step_key = source.step_key
WHEN NOT MATCHED THEN
    INSERT (product, step_key, step_label, sort_order, required)
    VALUES (source.product, source.step_key, source.step_label, source.sort_order, source.required);
GO

-- NOTE: Milestone templates are loaded from src/server/data/milestone-templates.json
-- and should be seeded by the application on first run, not by this SQL script,
-- because the JSON data file is the source of truth.

-- counters — atomic sequence-number store. Used today for NOVA-NNNNNNNNNN
-- subscription contract numbers; can hold other sequences in future.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'counters') AND type = 'U')
CREATE TABLE counters (
    name  NVARCHAR(50) NOT NULL PRIMARY KEY,
    value BIGINT       NOT NULL DEFAULT 0
);
GO

-- agreement_field_values — per-field value history for an Adobe agreement.
-- Source='SENDER' rows written at create time, source='SIGNER' at sign time.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'agreement_field_values') AND type = 'U')
CREATE TABLE agreement_field_values (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    agreement_id NVARCHAR(200) NOT NULL,
    field_name   NVARCHAR(200) NOT NULL,
    field_value  NVARCHAR(MAX) NULL,
    source       NVARCHAR(20)  NOT NULL,
    captured_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agreement_field_values_agreement_id')
CREATE INDEX IX_agreement_field_values_agreement_id ON agreement_field_values(agreement_id);
GO

PRINT '=== NOVA MSSQL migration 001 complete ==='
PRINT 'Tables: 63 | Indexes: 70+ | Seed data: problem_ticket_config, settings, setup_templates'
GO
