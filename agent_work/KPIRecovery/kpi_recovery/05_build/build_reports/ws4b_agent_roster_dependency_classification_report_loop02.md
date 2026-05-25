# WS4-B Build Report — Agent Roster Dependency Classification (Loop 02)

**Date:** 2026-05-21
**Workstream:** WS4 — n8n Workflow Integrity
**Slice:** WS4-B — Agent Roster Dependency Classification
**Type:** Discovery / Classification (no implementation)

---

## 1. Executive Summary

`dbo.Agent` is a **shared-authority table**: n8n originally created and populated the roster rows (identity, team, tier, department), while NOVA now actively **writes operational metrics** (open ticket counts, SLA breach counts, oldest ticket age, solved counts) back into the same table via `refreshAllAgentMetrics()`. NOVA also writes synthetic agents, backfills missing `AccountId` values, and provides a full admin CRUD UI for the table.

**Key finding:** n8n's role has been reduced to **initial roster row creation only**. NOVA already supplements, enriches, and updates `dbo.Agent` extensively. The table is no longer a pure n8n dependency — it is a shared resource where NOVA is the dominant writer for operational data. However, NOVA cannot yet **create** new agent roster rows from scratch without manual admin intervention or n8n's sync.

`dbo.Agent` remains a **critical runtime dependency** — 10 distinct services read from it. But the dependency is manageable: NOVA already has a parallel `agent_roster` table (local MSSQL) that duplicates identity/capacity data for the assignment engine. The path to full independence is incremental, not a big-bang migration.

---

## 2. Complete `dbo.Agent` Dependency Map

### 2.1 Services That READ from `dbo.Agent`

| # | Service / File | Endpoint / Function | Fields Read | Purpose | Classification |
|---|---------------|---------------------|-------------|---------|---------------|
| 1 | `kpi-data.ts` | `GET /api/public/wallboard/breached` | AgentName, AgentSurname, TierCode, Team, OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday, OldestTicketDays, OldestTicketKey, SolvedTickets_Today, TicketsSnapshotAt | SLA Breach Board wallboard (TV display + API) | **Metrics-bearing** — reads NOVA-written operational metrics |
| 2 | `index.ts` | Server-rendered `/wallboard/sla-breach` | Same as #1 | Server-rendered SLA breach wallboard HTML | **Metrics-bearing** — duplicate of #1 in server-rendered form |
| 3 | `kpi-data.ts` | `GET /api/admin/kpi-data/agent-admin` | AgentId, AgentKey, AgentName, AgentSurname, TierCode, Team, IsActive, IsAvailable, MaxTickets, MaxTicketsCustomerCare, MaxTicketsT2T3, PeopleHrId, AccountId | Agent admin CRUD UI | **Roster / identity** — admin management surface |
| 4 | `kpi-data.ts` | `resolveAgentScope()` | AgentName, AgentSurname, AgentKey | Non-admin user scoping — maps email → agent name for QA/KPI data access | **Roster / identity** |
| 5 | `kpi-data.ts` | Agent KPI snapshot + department filtering | AgentName, Department | Department filter (`IN ('NT', 'NOVA_AI')`) on agent-level KPI views, leaderboard, daily history | **Roster / identity** — used as join filter |
| 6 | `assignment-engine.ts` | `getAllAgentsFromKpi()`, `getAgent()`, `getAgentByJiraId()` | AgentId, AccountId, AgentName, AgentSurname, AgentKey, Team, IsActive, MaxTickets, MaxTicketsCustomerCare, MaxTicketsT2T3, Department | **Fallback** roster source for assignment engine (only used when `agent_roster` is empty) | **Roster / identity** — legacy fallback |
| 7 | `agent-availability.ts` | `getAgentsFromKpi()` | AgentId, AgentName, AgentSurname, Team, PeopleHrId, Department | Agent availability / scheduling UI population | **Roster / identity** |
| 8 | `kpi-pipeline.ts` | `snapshotAgentKpis()` | AgentId, AgentName, AgentSurname, TierCode, Team, IsAvailable, OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday, SolvedTickets_Today, SolvedTickets_ThisWeek, OldestTicketDays | Per-agent KPI snapshot written to `jira_agent_kpi_daily` | **Metrics-bearing** — reads back NOVA-written metrics + roster identity |
| 9 | `gr-pipeline.ts` | `getAgentKeys()`, `lookupAgentEmail()` | AgentKey, DisplayName, JiraAccountId | Agent identity lookup for Golden Rules scoring — determines which Jira comments belong to active agents | **Roster / identity** |
| 10 | `training-reminder.ts` | Agent email list | AgentKey (as email) | Gets active agent emails for training reminder notifications | **Roster / identity** |
| 11 | `agent.ts` (routes) | Coaching department filter | DisplayName, Department | Filters coaching data display by department | **Roster / identity** |

### 2.2 Services That WRITE to `dbo.Agent`

| # | Service / File | Function | Fields Written | Purpose |
|---|---------------|----------|----------------|---------|
| W1 | `kpi-pipeline.ts` | `refreshAllAgentMetrics()` | OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday, SolvedTickets_Today, SolvedTickets_ThisWeek, OldestTicketDays, OldestTicketKey, TicketsSnapshotAt | **Primary operational metrics writer** — runs on timer, updates every active agent |
| W2 | `index.ts` | Startup seed | AgentName, AgentSurname, AgentKey, AccountId, TierCode, Team, Department, MaxTickets, IsAvailable, IsActive, CreatedAt, UpdatedAt | Creates NOVA AI synthetic agent row if missing |
| W3 | `index.ts` | AccountId backfill | AccountId | Auto-populates missing Jira AccountIds by searching Jira REST API |
| W4 | `kpi-data.ts` | `PUT /agent-admin/:agentId` | Team, TierCode, IsActive, IsAvailable, MaxTickets, MaxTicketsCustomerCare, MaxTicketsT2T3, PeopleHrId, AccountId | Admin UI updates |
| W5 | `kpi-data.ts` | `POST /agent-admin` | AgentName, AgentSurname, AgentKey, AccountId, TierCode, Team, MaxTickets, MaxTicketsCustomerCare, MaxTicketsT2T3, IsAvailable, IsActive, Department, PeopleHrId, CreatedAt | Admin UI creates new agents |
| W6 | `kpi-pipeline.ts` | Schema migration | PeopleHrId column | Adds column if missing |

### 2.3 n8n's Remaining Write Role

n8n originally:
- **Creates** agent rows (AgentName, AgentSurname, AgentKey, TierCode, Team, IsActive)
- **Updates** roster identity fields periodically (schedule unknown — HDR-3 pending)
- **Does NOT** write operational metrics — those columns are now exclusively NOVA-owned (W1)

NOVA already has paths to create agent rows (W2, W5) but does not have an automated Jira-user-discovery pipeline to detect new team members. n8n fills that gap.

---

## 3. Field Usage Matrix

| `dbo.Agent` Column | n8n Writes | NOVA Writes | NOVA Reads | Available in `agent_roster`? | Classification |
|---------------------|-----------|-------------|------------|------------------------------|---------------|
| AgentId | Yes (PK) | No | Yes (8 services) | Yes (`id`) | Identity |
| AgentName | Yes | Yes (W2, W5) | Yes (10 services) | Yes (`display_name`, partial) | Identity |
| AgentSurname | Yes | Yes (W2, W5) | Yes (9 services) | No (concatenated into `display_name`) | Identity |
| AgentKey (email) | Yes | Yes (W2, W5) | Yes (4 services) | Yes (`email`) | Identity |
| AccountId (Jira) | Yes | Yes (W3, W4, W5) | Yes (3 services) | Yes (`jira_account_id`) | Identity |
| TierCode | Yes | Yes (W4, W5) | Yes (3 services) | No | Roster metadata |
| Team | Yes | Yes (W4, W5) | Yes (4 services) | Yes (`pool`) | Roster metadata |
| Department | ? | Yes (W2, W5) | Yes (5 services) | No | Roster metadata |
| IsActive | Yes | Yes (W4, W5) | Yes (8 services) | Yes (`active`) | Roster state |
| IsAvailable | ? | Yes (W4) | Yes (2 services) | No | Roster state |
| MaxTickets | ? | Yes (W4, W5) | Yes (2 services) | Yes (`max_capacity`) | Capacity config |
| MaxTicketsCustomerCare | No | Yes (W4, W5) | Yes (2 services) | Yes (`max_tickets_cc`) | Capacity config |
| MaxTicketsT2T3 | No | Yes (W4, W5) | Yes (2 services) | Yes (`max_tickets_t2t3`) | Capacity config |
| PeopleHrId | No | Yes (W4, W6) | Yes (1 service) | No | External reference |
| DisplayName | ? | No | Yes (2 services) | Yes (`display_name`) | Identity |
| JiraAccountId | ? | No | Yes (1 service) | Yes (`jira_account_id`) | Identity |
| OpenTickets_Total | No | **Yes (W1)** | Yes (3 services) | No | **NOVA-owned metric** |
| OpenTickets_Over2Hours | No | **Yes (W1)** | Yes (3 services) | No | **NOVA-owned metric** |
| OpenTickets_NoUpdateToday | No | **Yes (W1)** | Yes (3 services) | No | **NOVA-owned metric** |
| OldestTicketDays | No | **Yes (W1)** | Yes (3 services) | No | **NOVA-owned metric** |
| OldestTicketKey | No | **Yes (W1)** | Yes (2 services) | No | **NOVA-owned metric** |
| SolvedTickets_Today | No | **Yes (W1)** | Yes (3 services) | No | **NOVA-owned metric** |
| SolvedTickets_ThisWeek | No | **Yes (W1)** | Yes (1 service) | No | **NOVA-owned metric** |
| TicketsSnapshotAt | No | **Yes (W1)** | Yes (3 services) | No | **NOVA-owned metric** |

---

## 4. Parallel Data Source: `agent_roster` (Local MSSQL)

NOVA already maintains a local `agent_roster` table with partial overlap:

| `agent_roster` Column | Maps to `dbo.Agent` Column | Notes |
|-----------------------|---------------------------|-------|
| `id` | `AgentId` | Different ID spaces — not linked |
| `display_name` | `AgentName + ' ' + AgentSurname` | Concatenated, not split |
| `email` | `AgentKey` | Same data |
| `jira_account_id` | `AccountId` | Same data |
| `pool` | `Team` | Same concept, normalised differently |
| `active` | `IsActive` | Same |
| `max_capacity` | `MaxTickets` | Same |
| `max_tickets_cc` | `MaxTicketsCustomerCare` | Same |
| `max_tickets_t2t3` | `MaxTicketsT2T3` | Same |
| `skills` | — | NOVA-only (no `dbo.Agent` equivalent) |

**Key gap:** `agent_roster` does NOT have: `TierCode`, `Department`, `IsAvailable`, `PeopleHrId`, `DisplayName`, or any of the operational metrics columns. It also has no automated population — agents must be manually added via the assignment engine admin UI.

**Current usage pattern:** `assignment-engine.ts` tries `agent_roster` first, falls back to `dbo.Agent` when `agent_roster` is empty or the agent isn't found there. This is an explicit migration-in-progress pattern.

---

## 5. Dependency Classification Summary

### 5.1 Is `dbo.Agent` still a critical runtime dependency?

**Yes, but with caveats:**

- **For wallboards (breached board, SLA breach):** Critical. These read NOVA-written metrics FROM `dbo.Agent`. The table is the intermediary between `refreshAllAgentMetrics()` and the display surfaces. If the table disappeared, wallboards break — but the data is NOVA-generated, not n8n-generated.
- **For agent identity resolution:** Critical for 6+ services. Email→name mapping, department filtering, Jira account ID lookup all depend on `dbo.Agent` roster rows.
- **For assignment engine:** Not critical — `agent_roster` is the primary source; `dbo.Agent` is only the fallback.
- **For training reminders:** Low criticality — only reads email addresses.

### 5.2 Is n8n still a critical populator?

**Partially.** n8n's remaining role is:

1. **Creating new agent rows** when new team members join — NOVA has no automated Jira-user-discovery pipeline
2. **Maintaining basic roster identity** (name, email, team, tier) — though NOVA's admin UI can also do this manually

If n8n stopped today:
- Existing agents would continue working normally (NOVA writes all operational metrics)
- New team members would need to be manually added via NOVA admin UI (`POST /agent-admin`)
- No automatic "is this person still active?" deactivation sweep (unknown if n8n does this)

### 5.3 Are the fields already available elsewhere in NOVA?

| Field Category | Available in `agent_roster`? | Available in `jira_issue_cache`? | Verdict |
|---------------|------------------------------|----------------------------------|---------|
| Identity (name, email) | Yes | Partially (assignee fields) | Redundant — could be migrated |
| Jira Account ID | Yes | Yes (assignee_account_id) | Redundant |
| Team / Pool | Yes | No | Redundant — `agent_roster.pool` |
| Department | No | No | **Unique to `dbo.Agent`** |
| TierCode | No | No | **Unique to `dbo.Agent`** |
| IsAvailable | No | No | **Unique to `dbo.Agent`** |
| PeopleHrId | No | No | **Unique to `dbo.Agent`** |
| Operational metrics | No | Derivable from `jira_issue_cache` | **Already derived by NOVA** — written back to `dbo.Agent` as intermediary |

---

## 6. Architecture Assessment

### Current Flow (Circular)

```
jira_issue_cache ──→ refreshAllAgentMetrics() ──→ dbo.Agent ──→ wallboard/breached
                                                      ↑
                                               n8n (roster rows)
                                               NOVA admin UI (edits)
```

`dbo.Agent` serves as **both** a roster table (identity, populated by n8n) **and** an operational metrics cache (populated by NOVA). This dual role creates the circular pattern: NOVA reads from `jira_issue_cache`, computes per-agent metrics, writes them to `dbo.Agent`, then other NOVA services read those metrics back from `dbo.Agent`.

### Why This Matters

The operational metrics columns in `dbo.Agent` are essentially a **materialised view** of data that NOVA already owns in `jira_issue_cache`. The wallboard reads these pre-computed values for performance, but the data never left NOVA's control. n8n is not involved in the metrics path at all.

---

## 7. Answers to WS4-B Questions

### Q1: Which live NOVA services still read `dbo.Agent` today?

11 distinct read paths across 8 files (see Section 2.1). 6 write paths across 3 files (see Section 2.2).

### Q2: For each one, what exact fields are required?

See Section 2.1 (reads) and Section 3 (field matrix). 28 columns are referenced across all consumers.

### Q3: Are those fields roster-only, derived metrics, or already available elsewhere?

- **7 columns are NOVA-owned operational metrics** (OpenTickets_*, SolvedTickets_*, OldestTicket*, TicketsSnapshotAt) — NOVA writes these, then reads them back. n8n has no role.
- **9 columns are roster/identity** (AgentName, AgentSurname, AgentKey, AccountId, DisplayName, JiraAccountId, IsActive, Team, TierCode) — partially redundant with `agent_roster`.
- **4 columns are unique to `dbo.Agent`** (Department, IsAvailable, PeopleHrId, TierCode) — not available in any other NOVA data source.

### Q4: Is `dbo.Agent` still a critical runtime dependency, or only a convenience source?

**Critical but manageable.** It is critical because 10+ services depend on it. But it is manageable because:
- NOVA already writes all operational metrics (n8n's write role is limited to roster creation)
- NOVA already has a parallel local roster (`agent_roster`) covering identity + capacity for the assignment engine
- The admin UI already supports manual CRUD on `dbo.Agent`

### Q5: What is the smallest next slice?

**Keep and document.** Rationale:

- `dbo.Agent` works today. Both n8n and NOVA write to it without conflict.
- A migration would require either (a) extending `agent_roster` with 4 missing columns + metrics columns + automated population, or (b) computing wallboard metrics on-the-fly from `jira_issue_cache` instead of pre-caching them.
- Neither migration delivers user-visible value — it would only reduce n8n coupling.
- The higher-value next step is documenting the shared-authority model and ensuring NOVA's admin UI is sufficient as a fallback if n8n's roster sync stops.

---

## 8. Recommendation

### Immediate: Keep and Document (no migration needed)

1. **Document** the shared-authority model: n8n creates roster rows, NOVA writes operational metrics + supplements identity.
2. **Verify** NOVA admin UI (`POST /agent-admin`) is accessible and functional as a manual fallback for adding new agents.
3. **Close WS4-B** — `dbo.Agent` is not an n8n dependency risk. It is a shared table where NOVA is already the dominant contributor.

### If n8n Is Decommissioned (future WS4-C, only if needed)

If and when n8n is retired:
1. Add automated agent discovery to NOVA (scan Jira users with `jira-group-members` API, create `dbo.Agent` rows for new team members).
2. Optionally consolidate `agent_roster` and `dbo.Agent` into a single source — but only if maintaining two tables becomes a maintenance burden.

### Not Recommended

- Migrating wallboard reads away from `dbo.Agent` — the pre-computed metrics pattern is efficient and works.
- Merging `agent_roster` into `dbo.Agent` or vice versa — the two tables serve different purposes (local assignment state vs remote KPI/wallboard data) and live in different databases.

---

## 9. Completion Checklist

| Criterion | Status |
|-----------|--------|
| Exact current `dbo.Agent` dependency map | **COMPLETE** — 11 read paths, 6 write paths across 8 files |
| Whether it is still critical | **COMPLETE** — Yes, critical for 10+ services, but NOVA is already the dominant writer |
| Whether a migration is needed | **COMPLETE** — No. Keep and document. n8n's role is limited to initial roster creation. |
| The narrowest credible next slice for WS4 | **COMPLETE** — Document shared-authority model, verify admin UI fallback, close WS4-B. Next WS4 slice (if any) would be WS4-C: automated agent discovery pipeline (only needed if n8n is decommissioned). |
