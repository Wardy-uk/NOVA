# Schema Fix: Full MSSQL Bootstrap — All Missing Tables from 001-sqlite-to-mssql.sql

**Date:** 2026-05-18
**Status:** Fix applied — typecheck passes (only pre-existing agent-loop.ts error)

## Root cause

When NOVA migrated from SQLite to MSSQL, all table definitions were placed in `src/server/migrations/001-sqlite-to-mssql.sql` — a standalone script meant to be run manually against the database. However, `src/server/db/schema.ts` (which runs automatically at every startup via `initializeDatabase()`) was never updated to include these tables. Only tables created *after* the MSSQL migration (agent/AI/portal tables) were added directly to schema.ts.

This means fresh MSSQL instances (like `nova_eval`) boot with ~50% of the schema missing. The first query against any missing table crashes startup.

## What was added (51 tables, 67 indexes, 3 seed data MERGE statements)

### Core (6 tables + 10 indexes)
- `tasks` + 6 indexes (source, status, priority, due_date, sla_breach, user)
- `rituals` + 2 indexes (type_date, user)
- `settings`
- `teams`
- `feedback` + 2 indexes (user, status)
- `user_task_pins` + 1 index (user)

### Onboarding (6 tables + 5 indexes)
- `onboarding_ticket_groups` + 1 index (sort)
- `onboarding_sale_types`
- `onboarding_capabilities` + 1 index (group)
- `onboarding_matrix` + 2 indexes (sale, cap) — FK to sale_types/capabilities
- `onboarding_capability_items` + 1 index (cap) — FK to capabilities
- `onboarding_runs` + 1 index (ref)

### Milestones (4 tables + 7 indexes)
- `milestone_templates` + 1 index (active)
- `delivery_milestones` + 4 indexes (delivery, status, target, workflow)
- `milestone_template_ticket_groups` + 2 indexes — FK to templates/ticket_groups
- `milestone_sale_type_offsets` — FK to sale_types/templates

### Audit & Notifications (2 tables + 5 indexes)
- `audit_log` + 3 indexes (entity, user, created)
- `notifications` + 2 indexes (user, dedup filtered unique)

### Problem Ticket Detection (4 tables + 1 index)
- `problem_ticket_alerts`
- `problem_ticket_alert_reasons` + 1 index — FK to alerts
- `problem_ticket_ignores`
- `problem_ticket_config`

### Instance Setup (5 tables + 5 indexes)
- `instance_setup_step_templates` + 1 index
- `instance_setup_steps` + 1 index — FK to delivery_entries
- `setup_execution_runs` + 1 index — FK to delivery_entries
- `setup_execution_logs` + 1 index — FK to setup_execution_runs
- `setup_portal_tokens` + 1 index — FK to delivery_entries

### Delivery Extensions (6 tables + 7 indexes)
- `delivery_branches` + 1 index — FK to delivery_entries
- `delivery_brand_settings` + 1 index — FK to delivery_entries
- `delivery_logos` + 1 index — FK to delivery_entries
- `delivery_portal_accounts` + 1 index
- `delivery_branch_districts` + 2 indexes — FK to delivery_branches
- `delivery_welcome_packs` + 1 index

### CRM (2 tables + 4 indexes)
- `crm_customers` + 2 indexes (rag, next_review)
- `crm_reviews` + 2 indexes (customer, date)

### Sales (8 tables + 6 indexes)
- `sales_pipeline` + 2 indexes (salesperson, stage)
- `sales_monthly` + 2 indexes (salesperson, date)
- `sales_targets`
- `sales_bookings` + 1 index (date)
- `sales_taken_place` + 1 index (date)
- `sales_lg_kpi`
- `sales_lg_history`
- `sales_bdm_kpi`

### Business Central & Contracts (4 tables)
- `bc_customers`
- `contracts`
- `contract_templates`
- `adobe_sign_agreements`

### Surveys (4 tables + 4 indexes)
- `surveys` + 2 indexes (status, category)
- `survey_questions` + 1 index — FK to surveys
- `survey_recipients` + 1 index — FK to surveys
- `survey_responses` + 1 index — FK to surveys

### AI Approval Queue (1 table + 3 indexes)
- `approval_queue` + 3 indexes (status, ticket, expires)

### Training Matrix (4 tables + 3 indexes)
- `training_categories`
- `training_items` + 1 index — FK to categories
- `training_scores` + 2 indexes — FK to items
- `training_members`

### Other (1 table)
- `mi_commentary`

### Seed Data (3 MERGE statements)
- `problem_ticket_config` defaults (11 rules)
- `settings` defaults (7 source weights + refresh interval)
- `instance_setup_step_templates` BYM defaults (17 steps)

## Intentionally NOT added

- **`users` table** — already exists in schema.ts (line 12), with slightly different column set (schema.ts version is the canonical one with additional columns like `delivery_method`)
- **`user_settings` table** — already exists in schema.ts (line 30)
- **`dev_review_state`, `dev_review_thread`, `dev_review_outbox`** — already exist in schema.ts (lines 410-456)
- **`delivery_entries`** — added in the previous fix (already in schema.ts)
- **`SET NOCOUNT ON`** — server-level directive, not needed in JS-driven migrations
- **`PRINT` statements** — diagnostic only, not needed
- **`GO` batch separators** — not valid in parameterised queries; each statement is its own array entry

## Why this is safe

1. Every CREATE TABLE uses `IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(...))` — identical pattern to every other migration in schema.ts
2. Every CREATE INDEX uses `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = ...)` — same pattern
3. MERGE seed statements use `WHEN NOT MATCHED` — never overwrite existing data
4. Existing NOVA instances that already have these tables (from running 001-sqlite-to-mssql.sql) will skip every statement — zero impact
5. Table definitions are copied verbatim from the migration file — no invented or modified schema
6. All migrations run inside the existing `try/catch` loop that logs warnings and continues
7. No behavioural changes to any routes, services, or portal logic
8. TypeScript typecheck passes (only pre-existing agent-loop.ts error, unrelated)

## Expected impact on fresh evaluation databases

A fresh `nova_eval` database will now have the complete NOVA schema created automatically on first startup. No manual SQL script execution required. All feature areas (delivery, onboarding, milestones, CRM, sales, surveys, training, problem tickets, etc.) will have their backing tables ready.

## Remaining known runtime blockers

1. **SQL auth not configured** — local SQL Express is in Windows-auth-only mode and the `nova_app` login doesn't exist. Need to either:
   - Enable mixed-mode auth and create the `nova_app` login + `nova_eval` database
   - Or configure `NOVA_SQL_CONNECTION` with a valid Windows-auth connection string
   - SQL Browser service is stopped, so named instance `localhost\SQLEXPRESS` resolution fails — use `localhost` with port 1433 directly

2. **Pre-existing TS error** — `agent-loop.ts:1193` has `Property 'name' does not exist on type '{}'` — unrelated to schema changes, predates this work

## Category

Migration gap — one-off migration script was never integrated into the idempotent startup migration path. Now fully reconciled.
