# Current Architecture Map

## Purpose

This document is the working discovery map for how KPI data currently moves through NOVA.

It is intentionally provisional. No architectural assumption here should be treated as verified until traced to evidence.

---

## Provisional System Layers

1. Jira operational records
2. ingestion / extraction logic
3. workflow automation and orchestration
4. SQL persistence / transformed storage
5. snapshot generation
6. KPI calculation / query layer
7. NOVA reporting surfaces
8. Grafana and external reporting consumers
9. evidence exports / packs

---

## Concrete Component Map (P0 Scope)

### Component: `JiraSyncService` (`services/jira-sync-service.ts`)

**Role:** Jira → local MSSQL ingestion

| Property | Detail |
|----------|--------|
| **Trigger** | `fullSync()` on startup; `incrementalSync()` every ~45 seconds |
| **Source** | Jira Cloud REST API v3 (`POST /rest/api/3/search/jql`) |
| **JQL (full)** | `project IN (...) AND (statusCategory != Done OR updated >= -7d) ORDER BY updated DESC` |
| **JQL (incremental)** | `project IN (...) AND updated >= "{since_time}" ORDER BY updated ASC` |
| **Fields fetched** | `fields=*all` — all standard + custom fields |
| **Target** | `jira_issue_cache` table (local MSSQL) |
| **Key columns extracted** | `issue_key`, `status_name`, `status_category`, `current_tier` (from `customfield_12981`), `request_type` (from `customfield_13482`), `issuetype_name`, `resolution_name`, `sla_breached` (from `customfield_10010`), `sla_breach_time`, `assignee_*`, timestamps |
| **Blob column** | `fields_json` — stores full Jira fields JSON for later parsing |
| **SLA field handling** | Extracts `customfield_10010` → `sla_breached` / `sla_breach_time` columns. Does NOT extract `customfield_14046` (FRT) or `customfield_14048` (Resolution) to dedicated columns — these are only accessible via `fields_json` parsing. |
| **Issue-type handling** | Stores `issuetype_name` but does NOT filter by issue type during sync. All issue types synced. |

### Component: `KpiPipeline.collectJiraSnapshot()` (`services/kpi-pipeline.ts`)

**Role:** Local MSSQL → KPI calculation → remote `jira_kpi_daily`

| Property | Detail |
|----------|--------|
| **Trigger** | Scheduled — runs periodically (timer in `index.ts`) |
| **Source** | `jira_issue_cache` (local MSSQL), `approval_queue`, `escalation_log` |
| **Open tickets query** | `SELECT ... FROM jira_issue_cache WHERE {project_filter} AND status_category != 'Done'` |
| **Resolved today query** | `SELECT ... FROM jira_issue_cache WHERE {project_filter} AND resolution_name IS NOT NULL AND CAST(jira_updated AS DATE) = CAST(GETUTCDATE() AS DATE) AND status_category = 'Done'` |
| **Issue-type filter** | **NONE** — all issue types included |
| **Onboarding filter** | Excludes tickets where `request_type = 'onboarding'` |
| **Tier classification** | `classifyTier()` → `ccBucket()` → assigns to one of 7 governed tiers or fallback |
| **SLA parsing** | `parseSlaField(fields_json, 'customfield_14046')` for FRT, `parseSlaField(fields_json, 'customfield_14048')` for Resolution |
| **Metrics emitted** | ~74 legitimate KPIs (6 global, 5 SLA compliance, 49 per-tier, escalation, AI, WTD) + 14 ghost |
| **Target** | `jira_kpi_daily` / `jira_kpi_dailyUAT` (remote Azure SQL — `techservicesjsm` database) |
| **Write method** | MERGE upsert by `(CreatedAt, kpi)` — same-day re-runs overwrite |

### Component: `KpiSnapshot` (n8n v4 — external)

**Role:** n8n's KPI calculation and persistence (the comparison baseline)

| Property | Detail |
|----------|--------|
| **System** | n8n workflow on Pi / cloud instance |
| **Source** | Direct Jira JQL queries (not via NOVA's cache) |
| **Target** | `KpiSnapshot` table in `techservicesjsm` Azure SQL |
| **Known differences** | May filter by `issuetype = 'Support'`; may use different SLA field; produces ~105 team KPIs + ~30 per agent |
| **Status** | Still running in production; acts as comparison baseline for NOVA KPIs |
| **Verification** | n8n v4 workflow query logic NOT yet inspected in this recovery loop |

### Component: `jira_kpi_daily` Table (Azure SQL)

**Role:** Persistence target for NOVA KPIs

| Property | Detail |
|----------|--------|
| **Database** | `techservicesjsm` (Azure SQL) |
| **Columns** | `CreatedAt` (DATE), `kpi` (NVARCHAR(100)), `kpiGroup` (NVARCHAR(100)), `count` (FLOAT), `target` (FLOAT), `direction` (NVARCHAR(50)), `rag` (INT) |
| **Write frequency** | Overwritten on each `collectJiraSnapshot()` run for current date |
| **Safety rule** | Read-write via dedicated KPI pool. Global CLAUDE.md safety rules apply — never touch JiraSlaRaw, JiraTickets, etc. |

---

## Critical Architecture Questions (P0 Scope)

| # | Question | Status |
|---|----------|--------|
| AQ-1 | Does `fields_json` in `jira_issue_cache` contain `customfield_14046` and `customfield_14048`? | **ANSWERED (2026-05-20):** `customfield_14046` (FRT) is ABSENT — not in `ALL_FIELDS` array (sync never requests it). Jira REST API DOES return it when asked. `customfield_14048` (Resolution) is PRESENT in 579/1226 open tickets, verified 8/8 against live Jira. |
| AQ-2 | Is `customfield_10010` (extracted to `sla_breached` column) the same SLA as `customfield_14046`, or a different SLA clock? | **ANSWERED (2026-05-20):** `customfield_10010` is not returned by Jira REST API (confirmed UNDEFINED on direct request). It's a dead field. The actual SLA fields are: `customfield_14046` (First Reply Time, SLA ID 76) and `customfield_14048` (Resolution, SLA ID 78). `sla_breached` column is useless. |
| AQ-3 | Does n8n v4 filter Development tickets by `issuetype`? | **UNVERIFIED** — n8n v4 workflow not stored locally. Requires n8n instance inspection. |
| AQ-4 | Are there CC tickets with request types not handled by `ccBucket()`? | **ANSWERED (2026-05-20):** YES — 688/814 open CC tickets (84.8%) have NULL `request_type`. All are `issuetype = Support`. Additionally, "Support Request" (1) and "Technical Projects" (1) fall through. |
| AQ-5 | What is the `resolved_at` column situation? Audit notes it was reverted to `jira_updated`. | Partially known — recent commit `bcde0b9` reverted |

---

## Development Backlog Count — Surface Architecture (WS1-D Scope)

### Surface 1: NOVA KPI Pipeline → `jira_kpi_daily`

| Property | Detail |
|----------|--------|
| **Component** | `KpiPipeline.collectJiraSnapshot()` in `services/kpi-pipeline.ts` |
| **Query** | `SELECT ... FROM jira_issue_cache WHERE status_category != 'Done'` (lines 327-334) |
| **Tier classification** | `classifyTier(current_tier)` maps raw tier → canonical name. `'development'` → `'Development'`. |
| **Issue-type filter** | NONE — all issue types counted |
| **Onboarding filter** | Excludes `request_type = 'onboarding'` |
| **Output** | Writes `Number of Tickets in Development` to `jira_kpi_daily` via MERGE upsert |
| **Governed alignment** | **MATCHES D-035** — every ticket where `current_tier = Development` |

### Surface 2: Tech Support Wallboard

| Property | Detail |
|----------|--------|
| **Component** | `app.get('/wallboard/tech-support', ...)` in `index.ts` (line ~2562) |
| **Data source** | Reads from `jira_kpi_daily` (same table as Surface 1) |
| **Query** | `SELECT kpi, [count], rag FROM dbo.jira_kpi_daily WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)` (line ~2385) |
| **Display logic** | Uses `sumKpis: ['Number of Tickets in Development', 'Number of Tickets in Tier 3']` to produce a consolidated "Development — Active Tickets" row |
| **Result** | 275 (Dev) + 17 (T3) = 292 |
| **Governed alignment** | **INTENTIONAL CONSOLIDATION** — not a defect. The wallboard design consolidates Dev+T3 for operational display. Label may need review for clarity. |

### Surface 3: KPI Dashboard (frontend)

| Property | Detail |
|----------|--------|
| **Component** | `KpiDashboardView.tsx` (lines 115-175) |
| **Data source** | `/api/admin/kpi-data/team-snapshot` → reads `jira_kpi_daily` |
| **Display logic** | Shows `Number of Tickets in Development` as a separate row. No consolidation. |
| **Result** | 275 (matches pipeline exactly) |
| **Governed alignment** | **ALIGNED** — displays the pipeline value directly |

### Surface 4: n8n KpiSnapshot (external)

| Property | Detail |
|----------|--------|
| **Component** | n8n workflow (external, not in NOVA codebase) |
| **Data source** | Direct Jira JQL (bypasses NOVA cache) |
| **Output** | `KpiSnapshot` table in `techservicesjsm` |
| **Last run** | May 15, 2026 (5 days stale) |
| **JQL** | Not inspected (HDR-3 pending) |
| **Governed alignment** | **NON-AUTHORITATIVE** — external comparator only |

### Surface 5: JSM Queue

| Property | Detail |
|----------|--------|
| **Component** | Jira Service Management board filter |
| **Query** | Operational JQL (not under NOVA control) |
| **Governed alignment** | **NON-AUTHORITATIVE** — serves agent workflow, not KPI reporting |

---

## Cache Deletion / Refresh Handling (WS1-D Discovery)

**Status:** Structural gap confirmed (2026-05-20, D-044)

| Aspect | Current Behaviour | Impact |
|--------|-------------------|--------|
| **fullSync()** | MERGE upsert only — never DELETEs rows from `jira_issue_cache`. Deleted Jira tickets are not returned by JQL, so their cache rows persist indefinitely. | Phantom rows inflate tier counts. Confirmed: 47 deleted Development tickets remain in cache (pipeline 278 vs Jira 231). |
| **incrementalSync()** | MERGE upsert only — fetches tickets updated since last sync. Deleted tickets produce no "updated" event, so they are never revisited. | Same as fullSync — no deletion path. |
| **syncSingleIssue()** | Calls `getIssue()` which returns `null` on 404. Handler: `if (!issue) return;` — silently skips without cleanup. | Even when a specific deleted ticket is requested, the stale row is not removed. |
| **DB schema** | No `is_deleted`, `deleted_at`, or `is_active` column in `jira_issue_cache`. | No audit trail for deletions. No soft-delete mechanism. |
| **Cache queries** | `jira-cache-queries.ts` has no cleanup, purge, or reconciliation methods. | No application-level path to remove stale rows. |
| **Recovery** | Targeted DELETE of 47 known stale keys (D-045). Permanent reconciliation fix deferred to WS3 (D-048). | Immediate fix is manual; structural prevention requires code change. |

---

## Per-Surface Data-Source Boundaries (WS5 Discovery)

**Status:** Mapped 2026-05-20 (WS5 Loop 01)

This section documents which data source each user-visible surface reads from, and where boundaries create divergence.

### Surface Map

| Surface | Endpoint | Primary Data Source | Populated By | Refresh Cycle |
|---------|----------|-------------------|--------------|---------------|
| **KPI Dashboard** | `/api/admin/kpi-data/team-snapshot` | `jira_kpi_daily` (Azure SQL) | NOVA KPI pipeline (`collectJiraSnapshot()`) | Every pipeline timer run |
| **SLA Breach Board** | `/api/public/wallboard/breached` | `dbo.Agent` (Azure SQL) | n8n agent sync workflow (external) | n8n schedule (unknown frequency) |
| **KPI Breach Board** | `/api/public/wallboard/team-kpis` | `jira_kpi_daily` (Azure SQL) | NOVA KPI pipeline | Every pipeline timer run |
| **Tech Support Wallboard** | Server-rendered (`/wallboard/tech-support`) | `jira_kpi_daily` (Azure SQL) | NOVA KPI pipeline | Every pipeline timer run |
| **Customer Care Wallboard** | Server-rendered (`/wallboard/cc`) | `jira_kpi_daily` (Azure SQL) | NOVA KPI pipeline | Every pipeline timer run |
| **Key Accounts Wallboard** | Server-rendered (live cache) | `jira_issue_cache` (local MSSQL) via `wallboard-live-cache.ts` | Jira sync service | 5-min interval, business hours only (09:00-17:30 Mon-Fri) |
| **Customer Success Wallboard** | Server-rendered (live cache) | `jira_issue_cache` (local MSSQL) via `wallboard-live-cache.ts` | Jira sync service | 5-min interval, business hours only |
| **Trends / Checkpoint** | `/api/trends/checkpoint` | `jira_kpi_daily` (Azure SQL, historical) | NOVA KPI pipeline (historical rows) | Daily snapshots, 4-day lookback window |

### Data-Source Boundary Diagram

```
Jira Cloud
    │
    ├──→ JiraSyncService ──→ jira_issue_cache (local MSSQL)
    │                              │
    │                              ├──→ KPI Pipeline ──→ jira_kpi_daily (Azure SQL)
    │                              │                          │
    │                              │                          ├──→ KPI Dashboard
    │                              │                          ├──→ KPI Breach Board
    │                              │                          ├──→ Tech Support Wallboard
    │                              │                          ├──→ Customer Care Wallboard
    │                              │                          └──→ Trends (historical lookback)
    │                              │
    │                              └──→ wallboard-live-cache ──→ Key Accounts Wallboard
    │                                                         └──→ Customer Success Wallboard
    │
    └──→ n8n workflows (external) ──→ dbo.Agent (Azure SQL)
                                          │
                                          └──→ SLA Breach Board  ← DIVERGENT SOURCE
```

### Key Boundary: `dbo.Agent` vs `jira_kpi_daily`

The SLA Breach Board is the **only wallboard** that reads from `dbo.Agent` instead of `jira_kpi_daily`. This creates the G-009 and G-011 divergences. All other wallboards read from the pipeline-authoritative `jira_kpi_daily` or directly from `jira_issue_cache`.

### Key Boundary: Live Cache vs Pipeline Snapshots

Key Accounts and Customer Success wallboards bypass `jira_kpi_daily` entirely — they read directly from `jira_issue_cache` via a dedicated live cache service. This cache only refreshes during business hours, creating G-014 (12+ hours stale outside 09:00-17:30).

### Key Boundary: Trends Historical Lookback

Trends reads from `jira_kpi_daily` but uses a `TOP 1 ... ORDER BY CreatedAt DESC` query with a 4-day lookback window (`fetchKpiSumAtDate()` in `trends.ts:294-312`). This means Trends reflects the most recent daily snapshot, not real-time data. After WS1 fixes, Trends and Dashboard should converge within 1 pipeline cycle.

---

## Known Architectural Risk Areas

- state drift between Jira and SQL (incremental sync has ~30s look-back; missed updates possible)
- **no deletion handling — deleted Jira tickets persist as phantom rows in `jira_issue_cache` indefinitely** (confirmed by WS1-D spot-check, D-044)
- SLA field stored only in JSON blob — no schema enforcement, no validation on read
- `isSlaBreached()` assumes specific JSON structure (`completedCycles`, `ongoingCycle`) — confirmed compatible with `customfield_14048` (Resolution SLA). FRT field (`customfield_14046`) is absent entirely.
- `customfield_10010` in `ALL_FIELDS` is dead — not returned by Jira API, `sla_breached` column is always false
- 84.8% of CC tickets have null `request_type` — `ccBucket()` drops them to ungovemed "Customer Care" tier
- calculation logic entirely in TypeScript — no SQL-level aggregation, no reproducible query
- KPI emission guard too permissive — allows ungoverned tiers to emit
- no reconciliation step — NOVA never compares its output to Jira source
- `jira_updated` used as proxy for resolution date — may cause timing errors

---

## Discovery Completion Criteria

This map is considered mature enough for first build routing when:

- each layer has an owner or code location reference ✅ (done for P0 components)
- each major handoff has an evidence path ✅ (lineage map populated)
- major ambiguity points are logged in the assumptions register or failures log ✅
- AQ-1 through AQ-4 are answered
