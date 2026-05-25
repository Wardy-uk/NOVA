# WS5 Manager Brief — Loop 08: WS5-B SLA-Definition Alignment Scoping

**Date:** 2026-05-20
**Loop type:** Scoping (new governed slice)
**Prior loop:** Loop 07 (WS5-A TRUSTED promotion)
**Status:** WS5-B SCOPED → BOUNDED IMPLEMENTATION NEXT

---

## 1. Problem Statement

The SLA Breach Board's "TICKETS OVER SLA" count is structurally diverged from the KPI Dashboard's "SLA Breached" count because they use **different Jira fields, different extraction logic, and different cycle scope**.

| Property | Breach Board (`refreshAllAgentMetrics`) | Dashboard (`collectJiraSnapshot`) |
|----------|----------------------------------------|----------------------------------|
| **Jira field** | `customfield_10010` (dead — Jira no longer returns it) | `customfield_14048` (Resolution SLA, active) |
| **Extraction** | `extractSlaBreached()` in jira-sync-service.ts:607 → `sla_breached` column | `parseSlaField(fields_json, 'customfield_14048')` → `isSlaBreached()` in kpi-pipeline.ts:70-84 |
| **Cycle scope** | `completedCycles` only | `completedCycles` + `ongoingCycle` |
| **Negative remaining** | Not checked | Treated as breached (`remainingTime.millis < 0`) |
| **Additional SQL filters** | Status NOT IN (Done, Closed, Resolved, WoR, WoP) AND (due_date IS NULL OR <= today) | None (raw SLA state) |
| **Result** | `OpenTickets_Over2Hours` → `dbo.Agent` → breach board | `SLA Breached` → `jira_kpi_daily` → dashboard |

**Root cause:** `sla_breached` column is populated from `customfield_10010`, which is a dead Jira field (confirmed AQ-2). Every value is `false`. The breach board therefore systematically undercounts to zero.

This is the structural divergence that WS5-A could not address — WS5-A fixed population-path issues (Development inclusion, OldestTicketKey, observability) while explicitly deferring SLA-definition alignment (D-059, D-062).

---

## 2. Scope Boundary

### In scope

- Align `refreshAllAgentMetrics()` SLA breach counting to use `customfield_14048` via the already-trusted `isSlaBreached()` function
- Decide whether to retain the breach board's additional status/due_date filters (operational meaning)
- Verify alignment with dashboard after fix

### Out of scope

- WS5-A (TRUSTED — do not reopen)
- Wallboard parity beyond breach board (G-013, G-014 are independent)
- n8n retirement or `dbo.Agent` ownership redesign
- `extractSlaBreached()` / `sla_breached` column cleanup (dead code removal is WS3 housekeeping)
- WS3 structural cleanup (D-048)
- Breach board UI redesign

---

## 3. Fix Shape Assessment

### Option A: Restructure `refreshAllAgentMetrics()` to parse `fields_json` in TypeScript (RECOMMENDED)

**Approach:** Change the openStats SQL query to fetch per-ticket rows (not grouped). Compute SLA breach per ticket in TypeScript using the existing `parseSlaField()` + `isSlaBreached()` functions. Aggregate per-agent in code.

| Pro | Con |
|-----|-----|
| Reuses already-trusted `isSlaBreached()` (proven in WS1-B) | Requires restructuring the openStats query from GROUP BY to per-ticket |
| No sync dependency — works immediately | ~500 rows instead of ~20, but trivial for MSSQL |
| Single source of truth for SLA breach definition | Slightly more TypeScript code |
| No re-sync required | |

### Option B: Update `extractSlaBreached()` in jira-sync-service.ts

**Approach:** Change `extractSlaBreached()` to read `customfield_14048` from `fields_json` instead of `customfield_10010`, and add ongoingCycle + negative-remaining checks. Requires full re-sync to repopulate `sla_breached` column.

| Pro | Con |
|-----|-----|
| Minimal SQL change (existing CASE still works) | Couples fix to sync service |
| `sla_breached` column becomes useful again | Requires full re-sync to take effect |
| | Still maintains a separate extraction path from dashboard |
| | Two extraction functions doing the same thing in different places |

### Option C: Support two distinct SLA concepts intentionally

**Approach:** Document that breach board and dashboard measure different things and declare both valid.

| Pro | Con |
|-----|-----|
| No code change | Cannot work — `customfield_10010` is dead, so breach board SLA is broken regardless |

**Verdict:** Option C is not viable because `customfield_10010` returns no data. Option A is recommended because it produces a single SLA breach definition shared between dashboard and breach board, using the already-trusted function. Option B is viable but creates unnecessary coupling.

---

## 4. Design Decision: Status/Due-Date Filters

The breach board's SQL (kpi-pipeline.ts:967-970) applies additional filters beyond SLA breach:

```sql
AND a.status_name NOT IN ('Done','Closed','Resolved','Waiting on Requestor','Waiting on Partner')
AND (a.due_date IS NULL OR a.due_date <= CAST(GETUTCDATE() AS DATE))
```

These serve an operational purpose: the breach board shows per-agent **actionable** SLA breaches (not tickets parked with customer or not yet due). The dashboard shows **all** SLA breaches for compliance reporting.

**Recommendation:** Retain the status/due_date filters. The breach board and dashboard measure related but intentionally different things:
- Dashboard = "how many tickets have breached SLA?" (compliance metric)
- Breach board = "how many actionable tickets per agent are over SLA?" (operational metric)

Both should use the same SLA field and cycle logic (`customfield_14048`, completed + ongoing). The operational filters are a layer above the SLA definition, not part of it.

**This decision should be confirmed at the start of the build loop.**

---

## 5. Decisions

### D-073: WS5-B problem statement defined

WS5-B addresses the SLA-definition divergence between the breach board and dashboard. The breach board reads `sla_breached` (populated from dead `customfield_10010`, completed-cycles-only). The dashboard reads `customfield_14048` via `isSlaBreached()` (completed + ongoing cycles, negative remaining time). The `sla_breached` column always returns false because `customfield_10010` is dead, making `OpenTickets_Over2Hours` structurally zero.

### D-074: Next WS5-B loop is bounded implementation (not discovery)

The divergence is fully characterized. Both code paths are identified. The trusted `isSlaBreached()` function exists and is proven. No open questions block implementation. One design decision (retain status/due_date filters) should be confirmed at build start but has a clear default.

### D-075: Recommended fix shape is Option A — TypeScript-side `fields_json` parsing in `refreshAllAgentMetrics()`

Reuses the trusted `isSlaBreached()` function. Avoids sync dependency. Produces a single SLA breach definition shared between dashboard and breach board. Requires restructuring the openStats query from GROUP BY to per-ticket rows, with TypeScript aggregation.

### D-076: Status/due_date filters should be retained (default recommendation, confirm at build)

The breach board serves an operational purpose (per-agent actionable breaches). The dashboard serves a compliance purpose (all breaches). Both should share the same SLA field and cycle logic, but the breach board's additional filters are valid operational layering, not a divergence.

### D-077: `sla_breached` column and `extractSlaBreached()` cleanup deferred to WS3

After WS5-B, the `sla_breached` column becomes unused by both the breach board (new path) and the dashboard (never used it). Cleanup belongs in WS3 dead-code/schema housekeeping, not WS5-B.

---

## 6. Gap Register Updates

| Gap | Previous Status | New Status |
|-----|----------------|------------|
| G-009 | SPLIT: WS5-A BUILD COMPLETE, WS5-B NEW SLICE | **WS5-B SCOPED — bounded implementation next (D-074, D-075)** |
| G-011 | SPLIT: WS5-A BUILD COMPLETE, WS5-B NEW SLICE | **WS5-B SCOPED — SLA-definition component addressed by same fix** |

---

## 7. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| n8n also writes `OpenTickets_Over2Hours` to `dbo.Agent`, overwriting NOVA's corrected values | Low — NOVA already writes this column every pipeline cycle | NOVA's `refreshAllAgentMetrics()` runs frequently and would re-overwrite. If n8n conflict suspected, check `TicketsSnapshotAt` timestamps post-deploy. |
| `customfield_14048` absent for some tickets | Known — 579/1226 open tickets have the field (AQ-1). NTPJ tickets lack it. | `isSlaBreached()` returns `null` when field is absent (treated as "no breach data"). Matches dashboard behaviour. |
| Restructured query returns more rows | Negligible — ~500 rows vs ~20 grouped. MSSQL handles this trivially. | No mitigation needed. |

---

## 8. Programme State Update

| Item | Before | After |
|------|--------|-------|
| WS5-B state | NEW SLICE (unscoped) | **SCOPED — bounded implementation ready** |
| G-009 WS5-B component | Unscoped | Scoped, build brief ready |
| G-011 WS5-B component | Unscoped | Scoped, same fix addresses both |
| Next action | NA-38 (scope WS5-B) | NA-45 (execute WS5-B build) |

---

## 9. Next Actions

| # | Action | Type | Owner | Status |
|---|--------|------|-------|--------|
| NA-38 | ~~Scope WS5-B SLA-definition alignment~~ | ~~Programme~~ | ~~Manager Agent~~ | **DONE** (this loop) |
| NA-44 | ~~Scope WS5-B SLA-definition alignment~~ | ~~Programme~~ | ~~Manager Agent~~ | **DONE** (duplicate of NA-38) |
| NA-45 | Execute WS5-B build: restructure `refreshAllAgentMetrics()` to use `isSlaBreached(parseSlaField(fields_json, 'customfield_14048'))` | Build | Build Agent | **READY** |
| NA-46 | After NA-45: runtime verification — compare breach board TICKETS OVER SLA with dashboard SLA Breached | Verification | Build Agent | BLOCKED on NA-45 |
| NA-47 | After NA-46: WS5-B trust lifecycle (SOURCE DEFINED → EVALUATED → REGRESSION PROTECTED → TRUSTED) | Programme | Manager Agent | BLOCKED on NA-46 |

---

## 10. Completion Standard Assessment

| Criterion | Met? |
|-----------|------|
| WS5-B defined as clean standalone slice | YES — problem statement (D-073), scope boundary, fix shape (D-075) |
| Next loop type explicit | YES — bounded implementation (D-074) |
| First handoff ready | YES — build brief produced (`ws5b_build_brief_loop01.md`) |
| Blocking uncertainty stated | NONE — all questions answered, one design confirmation at build start |

**Loop 08 is COMPLETE.**
