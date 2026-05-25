# Data Lineage Map

## Purpose

This document traces how KPI-relevant facts move from origin to presentation.

It distinguishes clearly between:

- **observed lineage** — confirmed by reading code
- **inferred lineage** — probable based on code structure but not end-to-end verified
- **unverified lineage** — hypothesised but not checked

---

## LIN-001: Development Backlog Count

**Status:** Observed (code-level), NOT reconciled against Jira

| Stage | Detail | Confidence |
|-------|--------|------------|
| **Originating fact** | A Jira issue exists in project NT with `current_tier = Development` and is not resolved | Observed |
| **Authority** | Jira Cloud — `customfield_12981` (current_tier) | Observed |
| **Extraction** | `JiraSyncService.fullSync()` / `incrementalSync()` fetches issues via JQL: `project IN (...) AND (statusCategory != Done OR updated >= -7d)`. Stores `current_tier` from `customfield_12981` in `jira_issue_cache`. | Observed |
| **Transformation** | `classifyTier()` maps raw tier string to canonical name. `'development'` → `'Development'`. | Observed |
| **Issue-type filter** | **NONE** — NOVA does not filter by `issuetype`. All issue types (Support, Bug, Task, Sub-task, etc.) with `current_tier = Development` are counted. | Observed |
| **Persistence** | `jira_issue_cache` table in local MSSQL | Observed |
| **Snapshot** | `collectJiraSnapshot()` reads from `jira_issue_cache WHERE status_category != 'Done'`, classifies tier, increments `tierStats.volume` | Observed |
| **Reporting** | Written to `jira_kpi_daily` as `Number of Tickets in Development` | Observed |
| **Reconciliation** | Not performed — no cross-check against live Jira | Observed |

**Governed Definition (D-035):** Every ticket where `current_tier = Development`. No issue-type filter. No status sub-filter beyond excluding Done. This is the authoritative business rule set by Nick.

**Previous Ambiguity — CLOSED:** Whether Development backlog should include only Support issues or all issue types. D-035 resolved this: all issue types count.

### Confirmed Failure Mode: Stale Deleted Tickets in Cache (D-044)

**Discovery date:** 2026-05-20 (WS1-D verification Loop 01 + spot-check)

| Property | Detail |
|----------|--------|
| **Observable gap** | Pipeline reports 278 Development tickets; live Jira has 231. Difference: 47. |
| **Root cause** | `jira-sync-service.ts` never DELETEs rows from `jira_issue_cache`. Deleted Jira tickets (confirmed by spot-check of NT-543, NT-626, NT-18099) persist as phantom rows. |
| **Mechanism** | `fullSync()` uses MERGE (upsert). Deleted tickets are not returned by JQL, so their existing rows are never updated or removed. `incrementalSync()` has the same gap. `syncSingleIssue()` returns silently on 404 without cleanup. |
| **Impact** | Development count inflated by ~20% (47/231). Other tiers may also be affected (not yet quantified). |
| **Classification** | Data defect — cache freshness (G-017) |
| **Recovery** | Targeted DELETE of 47 known stale keys (D-045). Permanent reconciliation fix deferred to WS3 (D-048). |

All 47 stale tickets are listed in `04_evidence/ws1d_verification_report_loop01.md` section 5.2.

### Surface Divergence Analysis (post D-035)

| Surface | Count | Query Path | Alignment to Governed Rule | Classification |
|---------|-------|------------|---------------------------|----------------|
| **NOVA KPI Pipeline** | 275 (Run 01) / 279 (Run 02) | `jira_issue_cache WHERE status_category != 'Done'`, classify by `current_tier`, no issue-type filter | **ALIGNED** — matches governed definition exactly | No defect |
| **Tech Support Wallboard** | 292 | Reads `jira_kpi_daily` via `sumKpis: ['Number of Tickets in Development', 'Number of Tickets in Tier 3']` | **INTENTIONAL CONSOLIDATION** — sums Dev (275) + T3 (17) into one display row labelled "Development — Active Tickets" | Presentation design — not a defect. Label may mislead if read as "Development only". |
| **n8n KpiSnapshot** | 213 | Direct Jira JQL (not via NOVA cache). Last run May 15. JQL not inspected (HDR-3 pending). | **NON-AUTHORITATIVE** — stale by 5 days, possibly narrower JQL (issue-type or status filters) | Non-authoritative comparator. Divergence expected. |
| **JSM Queue** | ~230 | Jira board filter. Operational JQL likely includes status/issue-type restrictions for agent workflow. | **NON-AUTHORITATIVE** — JSM queues serve operational purposes, not KPI reporting | Non-authoritative comparator. Divergence expected. |

**Key Finding:** The NOVA KPI pipeline is the surface closest to the governed definition. The 275→279 drift between Run 01 and Run 02 is normal ticket lifecycle fluctuation, not a defect.

---

## LIN-002: FRT Breach Detection (Shared by P0-003, P0-004, P0-005)

**Status:** ROOT CAUSE RESOLVED — fix applied, awaiting deploy + re-sync

| Stage | Detail | Confidence |
|-------|--------|------------|
| **Originating fact** | Jira SLA field `customfield_14046` ("First Reply Time", SLA ID 76) contains breach status | **Verified** — confirmed via Service Desk API and direct REST API |
| **Authority** | Jira Cloud SLA configuration | **Verified** |
| **Extraction** | `JiraSyncService` fetches with `ALL_FIELDS` list. `customfield_14046` was MISSING from this list (root cause). **Fix applied:** field added to `ALL_FIELDS` in Build Loop 03. After deploy + fullSync, field will populate `fields_json`. | **Fix applied, pending deploy** |
| **Transformation** | `parseSlaField(fields_json, 'customfield_14046')` → `isSlaBreached()`. Parser confirmed compatible — FRT uses identical structure to Resolution SLA. | **Verified** — 20/20 NT tickets parsed correctly from live Jira |
| **Persistence** | Only in `fields_json` (TEXT blob). No dedicated FRT column in `jira_issue_cache`. | Observed |
| **Open Queue path** | `collectJiraSnapshot()` → `parseTicket()` → `parseSlaField(fields_json, 'customfield_14046')` → `isSlaBreached()`. Counts `frtBreached !== null` (totalFrtChecked) and `frtBreached === true` (totalFrtBreached). | Observed |
| **Resolved Today path** | Same parsing, applied to resolved-today subset. | Observed |
| **Per-tier path** | `frtBreached === true` split by `slaActionable` status into actionable/not-actionable buckets. | Observed |
| **Reporting** | Compliance = `(checked - breached) / checked * 100`. Default 100% when `checked === 0`. | Observed |
| **Project presence** | NT: 100% (20/20 sampled). NTPJ: 0% (0/5). Same pattern as Resolution SLA. | **Verified** |
| **FRT goal** | 30 minutes (1800000ms). | **Observed** |

**History:**
- Loop 01 diagnostic: confirmed `customfield_14046` absent from all cached `fields_json` (0/200). Root cause of KF-008, KF-009, KF-012.
- Loop 02: discovered field IS returned by Jira REST API when requested. Root cause: missing from `ALL_FIELDS` in sync service.
- Loop 03: fix applied. Simulated FRT Compliance = 72.3% (50-ticket sample), confirming non-trivial output after deploy.

---

## LIN-003: Resolution SLA Breach Detection

**Status:** Observed (code-level), same parser concerns as LIN-002

| Stage | Detail | Confidence |
|-------|--------|------------|
| **Originating fact** | Jira SLA field `customfield_14048` (Resolution SLA / Problem ticket SLA) | Observed |
| **Authority** | Jira Cloud SLA configuration | Observed |
| **Extraction** | Same as LIN-002 — stored only in `fields_json`, not a dedicated column | Observed |
| **Transformation** | `parseSlaField(fields_json, 'customfield_14048')` → `isSlaBreached()` | Observed |
| **Critical Question** | Same as LIN-002 — is `customfield_14048` actually present in `fields_json`? | **Unverified** |

**Note:** Global "SLA Breached" count (line 458) uses `resBreached` from this field. If field is missing, global SLA breach count may also be wrong.

---

## LIN-004: Tier Mapping and KPI Emission Boundary

**Status:** Observed (code-level)

| Stage | Detail | Confidence |
|-------|--------|------------|
| **Originating fact** | Jira `customfield_12981` (current_tier) determines which tier a ticket belongs to | Observed |
| **Authority** | Jira Cloud — custom field configuration | Observed |
| **Extraction** | Sync stores raw value in `jira_issue_cache.current_tier` | Observed |
| **Transformation** | `classifyTier()` normalises case. Unmapped values → `'Unclassified'`. `null` → `'Unclassified'`. | Observed |
| **CC sub-split** | `ccBucket()` splits `Customer Care` into 3 sub-tiers by request type. If request type doesn't match any bucket, returns `null` → ticket stays as `'Customer Care'` (which is NOT in `ALL_TIERS`). | Observed |
| **Emission guard** | Line 496: `if (stats.volume === 0 && !ALL_TIERS.includes(tier)) continue;` — allows non-governed tiers with volume > 0 to emit | Observed |
| **Ghost emission** | `'Customer Care'` and `'Unclassified'` leak through when: (a) CC ticket has unmapped request type, (b) ticket has null `current_tier` | Observed |

**Root Cause Confirmed:** The emission guard is too permissive. Ghost KPIs are a calculation defect — the guard should be `if (!ALL_TIERS.includes(tier)) continue;` (suppress all non-governed tiers unconditionally).

**CONFIRMED (2026-05-20 diagnostic):** 688/814 open CC tickets (84.8%) have NULL `request_type` (`customfield_13482` is genuinely null in Jira). All are `issuetype = Support`. `ccBucket(null)` returns `null`, leaving these as "Customer Care" (not in `ALL_TIERS`). Tightening the emission guard without fixing `ccBucket()` would make 688 tickets invisible to per-tier KPIs. Additional fallthrough: "Support Request" (1 open), "Technical Projects" (1 open).

---

## Lineage Domains NOT Yet Traced (Out of First Slice)

- CSAT field (`customfield_12802`) → CSAT % calculation
- Escalation log population → escalation/rejection counts
- n8n v4 query logic → full parity comparison
- Agent-level field extraction → agent KPI pipeline
- RAG threshold derivation
- Aged backlog bucket boundaries

---

## Current Status

| Lineage | Status |
|---------|--------|
| LIN-001 (Development count) | Code path observed, issue-type ambiguity identified, business definition needed. n8n JQL not locally discoverable. |
| LIN-002 (FRT breach) | **CONFIRMED DATA DEFECT (2026-05-20):** `customfield_14046` absent from all cached data. FRT field identity unknown. |
| LIN-003 (Resolution SLA) | **CONFIRMED PRESENT (2026-05-20):** `customfield_14048` present in 128/200 open tickets, parser compatible, 27/128 breached. |
| LIN-004 (Tier mapping) | **CONFIRMED (2026-05-20):** Ghost emission root cause confirmed AND 84.8% CC fallthrough quantified. `ccBucket()` fix needed before guard tightening. |

LIN-002 and LIN-003 have been validated against live cached data. LIN-001 requires n8n inspection + business definition. LIN-004 is fully evidenced.

---

## LIN-005: SLA Breach Board — Per-Agent SLA Data (WS5 Scope)

**Status:** Root cause identified (WS5 Loop 01). Discovery-ready.

| Stage | Detail | Confidence |
|-------|--------|------------|
| **Originating fact** | Agent-level ticket counts, SLA breach counts, oldest ticket age | Inferred |
| **Authority** | `dbo.Agent` table in `techservicesjsm` Azure SQL | Observed |
| **Population** | n8n workflow (external) — populates `dbo.Agent` with per-agent snapshots | Inferred (n8n workflow not inspected) |
| **Columns used** | `AgentName`, `AgentSurname`, `TierCode`, `Team`, `OpenTickets_Total`, `OpenTickets_Over2Hours`, `OpenTickets_NoUpdateToday`, `OldestTicketDays`, `SolvedTickets_Today`, `TicketsSnapshotAt` | Observed (`kpi-data.ts:1590-1614`) |
| **Endpoint** | `/api/public/wallboard/breached` | Observed |
| **Client** | `KpiBreachedView.tsx` — sums `OpenTickets_Over2Hours` for "TICKETS OVER SLA" header, takes max `OldestTicketDays` for "WORST OLDEST" | Observed |
| **Divergence** | `OpenTickets_Over2Hours` ≠ Resolution SLA breach count from pipeline. `OldestTicketDays` ≠ pipeline's per-tier oldest actionable. | Confirmed (G-009, G-011) |
| **Pipeline equivalent** | `jira_kpi_daily` contains `SLA Breached` (103), per-tier `over SLA (actionable)`, per-tier `Oldest actionable ticket (days)` — but NOT per-agent breakdowns | Observed |

**Key gap:** The pipeline emits tier-level aggregates. The breach board displays per-agent breakdowns. Repointing to `jira_kpi_daily` would lose per-agent granularity unless the pipeline is extended or the board is redesigned.

---

## LIN-006: Key Accounts / Customer Success — Live Cache Lineage (WS5 Scope)

**Status:** Root cause identified (WS5 Loop 01). Simple fix.

| Stage | Detail | Confidence |
|-------|--------|------------|
| **Originating fact** | Tickets tagged with Key Account or Customer Success customer labels | Inferred |
| **Authority** | `jira_issue_cache` (local MSSQL) | Observed |
| **Cache layer** | `wallboard-live-cache.ts` — in-memory cache refreshed every 5 minutes | Observed |
| **Refresh gate** | `shouldRefresh()` returns `false` on weekends and outside 09:00-17:30 Mon-Fri | Observed |
| **Stale threshold** | `isCacheStale()` uses `THREE_DAYS_MS` — only forces refresh if cache > 3 days old | Observed |
| **Endpoint** | Wallboard routes in `index.ts` | Observed |
| **Divergence** | Data shows "746m old" / "747m old" when viewed outside business hours | Confirmed (G-014) |

**Resolution:** Widen `shouldRefresh()` window or remove business-hours restriction. No data-source or calculation issue.

---

## LIN-007: Trends Queue Size vs Dashboard Open Tickets (WS5 Scope)

**Status:** Root cause identified (WS5 Loop 01). Presentation design decision.

| Stage | Detail | Confidence |
|-------|--------|------------|
| **Dashboard "Open Tickets"** | `parsedOpen.length` in `kpi-pipeline.ts:464` — raw count of ALL open tickets from `jira_issue_cache` | Observed |
| **Trends "Total Queue Size"** | `fetchKpiSumAtDate()` in `trends.ts:294-312` — sums `Number of Tickets in CC%`, `Production%`, `Tier 2%`, `Tier 3%`, `Development%` from `jira_kpi_daily` | Observed |
| **Gap** | 557 - 477 = 80 tickets | Observed |
| **Explanation** | Trends sums only governed-tier KPIs. The 80-ticket gap consists of: ~10 Escalations (ungoverned), ~14 ghost-tier tickets (now suppressed), remainder from CC pattern matching or project/status filter differences | Inferred |

**Classification:** These are intentionally different metrics. Not a defect. Presentation alignment decision deferred.
