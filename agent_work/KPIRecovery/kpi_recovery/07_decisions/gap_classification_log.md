# Gap Classification Log

## Purpose

This log records validated gaps using the agreed primary defect classes.

---

## Classes

- calculation defect
- data defect
- workflow defect
- source-of-truth ambiguity
- presentation/reporting defect

---

## Pipeline Gaps (WS1 Scope)

| Date | Gap ID | Observable Gap | Primary Class | Scope | Status |
|------|--------|----------------|---------------|-------|--------|
| 2026-05-20 | G-001 | KPI trust degradation acknowledged at programme start | Source-of-truth ambiguity | Cross-programme | OPEN |
| 2026-05-20 | G-002 | Ghost KPI emission: 14 KPIs for ungoverned tiers | Calculation defect | Per-tier KPI emission | **EVALUATED — PASS** (D-022). Emission guard working. 14 stale rows are MERGE artefacts, will not be recreated. |
| 2026-05-20 | G-003 | Development backlog count four-way divergence (275 / 292 / 230 / 213) | **RECLASSIFIED** — see G-003 detail below | Development volume metric | **RECLASSIFIED** (D-035 resolved HDR-1) |
| 2026-05-20 | G-004 | FRT Compliance % stuck at 100% — `customfield_14046` not in ALL_FIELDS | Data defect | FRT metrics | **EVALUATED — PASS** (D-022). FRT recovered to 68% compliance. All 7 tiers show breaches. |
| 2026-05-20 | G-005 | SLA field identity mapping | Source-of-truth ambiguity | SLA field governance | **RESOLVED** — SLA ID 76 = FRT = `customfield_14046`, SLA ID 78 = Resolution = `customfield_14048`, `customfield_10010` = dead |
| 2026-05-20 | G-006 | Resolved-today uses `jira_updated` as proxy for resolution timestamp | Calculation defect | Resolved-today metrics | OPEN — known, deferred |
| 2026-05-20 | G-007 | ccBucket() null request_type fallthrough (688/814 CC tickets) | Calculation defect | CC tier sub-splitting | **EVALUATED — PASS** (D-022). Null-RT tickets now route to CC (Incidents). CC (Incidents) jumped from 30→91. |
| 2026-05-20 | G-008 | `customfield_10010` in ALL_FIELDS is dead | Data defect | SLA column housekeeping | CONFIRMED — low priority |

---

## Multi-Surface Divergence Gaps (Post-WS1 Scope)

| Date | Gap ID | Observable Gap | Primary Class | Scope | Status |
|------|--------|----------------|---------------|-------|--------|
| 2026-05-20 | G-009 | SLA Breach Board shows 0 while KPI Dashboard shows SLA Breached = 103 | **RECLASSIFIED** — data-source divergence (`dbo.Agent` vs `jira_kpi_daily`) | Wallboard SLA breach board | **FULLY RESOLVED** — WS5-A TRUSTED (D-072), WS5-B TRUSTED (D-089). Population-path and SLA-definition both aligned and trusted. Lineage: LIN-005. |
| 2026-05-20 | G-010 | Tech Support Wallboard shows Development = 292, Dashboard = 275, JSM ~230, n8n 213 | **RECLASSIFIED** — presentation design (wallboard sums Dev+T3 intentionally) | Wallboard Development count | **RESOLVED** — 292 = Dev(275) + T3(17) via `sumKpis`. Not a defect. Label clarity review optional. |
| 2026-05-20 | G-011 | SLA Breach Board "WORST OLDEST" = 76 days vs Dashboard "Oldest Development" = 197 days | **RECLASSIFIED** — data-source divergence (same root cause as G-009) | Wallboard oldest definition | **FULLY RESOLVED** — WS5-A TRUSTED (D-072, WORST OLDEST recovered 76d→198d), WS5-B TRUSTED (D-089). SLA-definition component trusted. Lineage: LIN-005. |
| 2026-05-20 | G-012 | Trends shows FRT Compliance MTD = 69.3% while Dashboard shows 100% | Source divergence + data defect | Cross-surface FRT | **MONITORING** (D-057). Dashboard FRT now 68% post-WS1-C fix. Trends MTD 69.3% is plausibly aligned. Monitor 2-3 pipeline cycles to confirm convergence. No build needed. |
| 2026-05-20 | G-013 | Trends shows Total Queue Size = 477 vs Dashboard Open Tickets = 557 (80 ticket gap) | **RECLASSIFIED** — intentional methodology difference (D-058) | Cross-surface queue size | **PRESENTATION DESIGN DECISION**. Dashboard counts ALL open tickets; Trends sums governed-tier KPIs only. 80-ticket gap = ungoverned tiers + ghost exclusions. Not a defect. Lineage: LIN-007. |
| 2026-05-20 | G-014 | Key Accounts and Customer Success wallboards show "Data is 746/747m old" (12+ hours stale) | Workflow defect | Wallboard cache refresh | **FULLY RESOLVED** — `shouldRefresh()` business-hours gate removed, deployed, and runtime-verified. Both wallboards now show fresh data with no stale warning. Optional after-hours spot-check remains belt-and-braces only. Lineage: LIN-006. |
| 2026-05-20 | G-015 | KPI Breach Board shows TOTAL KPIS = 88 (includes 14 ghosts), RED = 36 (inflated by ~6 ghost KPIs) | Calculation defect (secondary to G-002) | Wallboard ghost inflation | **RESOLVED** — ghost suppression deployed, emission guard confirmed working. 14 stale rows will not be recreated. |
| 2026-05-20 | G-016 | 10 tickets with current_tier = 'Escalations' excluded from all KPI output | Data gap | Tier governance | DEFERRED to WS2+ (D-024). Requires business decision HDR-4. |

---

## G-003 Reclassification Detail (post D-035)

**Previous classification:** Source-of-truth ambiguity — no agreed definition of "Development backlog".

**New classification (post D-035):** The four-way divergence decomposes into four independent classifications:

| Surface | Previous Count | Classification | Status |
|---------|---------------|----------------|--------|
| **NOVA KPI Pipeline** (→ Dashboard) | 275 | **No defect** — matches governed rule exactly (`current_tier = Development`, all issue types, `status_category != 'Done'`) | **ALIGNED** |
| **Tech Support Wallboard** | 292 | **Presentation design** — intentionally sums Dev + T3 via `sumKpis` config. Not a calculation defect. | **RESOLVED** (see G-010) |
| **n8n KpiSnapshot** | 213 | **Non-authoritative comparator** — stale (May 15), possibly narrower JQL. Not a recovery target. | **CLOSED as non-authoritative** |
| **JSM Queue** | ~230 | **Non-authoritative comparator** — operational queue filter, not a KPI surface. | **CLOSED as non-authoritative** |

**Net impact:** G-003 source-of-truth ambiguity is **RESOLVED**. The NOVA KPI pipeline already implements the governed definition correctly. No code change required for Development backlog count alignment.

**Spot-check outcome:** `NT-543`, `NT-626`, and `NT-18099` were checked in Jira and are all deleted.

**Updated conclusion:** WS1-D is no longer a parity ambiguity. The remaining issue is a **data defect** in cache freshness: deleted Jira tickets remain represented in the cache-backed Development count.

**Next step:** Route a bounded cache-freshness recovery loop (re-sync / stale-entry cleanup / deletion handling verification). No change to the governed Development backlog definition is required.

---

## Cache Freshness Gap (WS1-D Recovery Scope)

| Date | Gap ID | Observable Gap | Primary Class | Scope | Status |
|------|--------|----------------|---------------|-------|--------|
| 2026-05-20 | G-017 | `jira_issue_cache` contained 46 rows for deleted Jira tickets, inflating Development count from 231 to 278 (~20% inflation) | Data defect — stale cache entries | WS1-D cache recovery | **RESOLVED (point-in-time)** — 46 stale rows deleted. Post-cleanup 232 vs live Jira 231 (diff: 1). Structural prevention deferred to WS3 (D-048). |

### G-017 Detail

**Root cause:** `jira-sync-service.ts` has no deletion handling. `fullSync()` and `incrementalSync()` only MERGE (upsert) — they never DELETE rows. `syncSingleIssue()` silently skips 404s without removing the stale row. The DB schema has no soft-delete columns.

**Evidence:**
- WS1-D verification (Loop 01): pipeline 278 vs live Jira 231 = 47 surplus
- Spot-check (D-044): NT-543, NT-626, NT-18099 confirmed deleted in Jira
- All 47 tickets listed in `04_evidence/ws1d_verification_report_loop01.md` section 5.2

**Recovery plan:**
- ~~Immediate: targeted DELETE of 46 known stale issue keys from `jira_issue_cache` (D-045)~~ — **DONE** (Loop 02 build)
- Permanent: reconciliation logic in `fullSync()` to detect and remove rows for tickets no longer in Jira (D-048, deferred to WS3)

**Promotion evidence (D-046):** All five items satisfied (D-049). Post-cleanup 232 vs live Jira 231 (diff: 1). 0 stale rows remaining. RC-001–RC-006 6/6 PASS. WS1-D promoted to SOURCE DEFINED.
