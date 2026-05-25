# WS5-B Build Brief — Loop 01: SLA-Definition Alignment

**Date:** 2026-05-20
**Slice:** WS5-B (SLA-definition alignment)
**Scoping authority:** WS5 Manager Brief Loop 08 (D-073, D-074, D-075)
**Status:** READY FOR BUILD AGENT

---

## 1. Objective

Align the breach board's SLA breach counting to use the same Jira field and cycle logic as the KPI Dashboard.

**Current state:** `refreshAllAgentMetrics()` in `kpi-pipeline.ts:967-970` computes `OpenTickets_Over2Hours` using the `sla_breached` column, which is populated from `customfield_10010` (dead field). Result: always 0.

**Target state:** `refreshAllAgentMetrics()` computes `OpenTickets_Over2Hours` using `parseSlaField(fields_json, 'customfield_14048')` → `isSlaBreached()` — the same functions used by the dashboard.

---

## 2. Approved Change

### File: `src/server/services/kpi-pipeline.ts`

### Function: `refreshAllAgentMetrics()` (currently lines 948–1087)

### Change shape

1. **Modify the openStats SQL query** (lines 963–987):
   - Remove the `SUM(CASE WHEN sla_breached = 1 ...)` aggregate
   - Change from GROUP BY to per-ticket SELECT
   - Include `fields_json`, `status_name`, `due_date` in the SELECT
   - Keep the existing WHERE filters (project, status_category, assignee, tier, onboarding)

2. **Add TypeScript aggregation** after the query:
   - Group results by `assignee_account_id`
   - For each ticket, compute SLA breach: `isSlaBreached(parseSlaField(ticket.fields_json, 'customfield_14048'))`
   - Apply the status/due_date operational filters (same as current SQL CASE):
     - `status_name NOT IN ('Done', 'Closed', 'Resolved', 'Waiting on Requestor', 'Waiting on Partner')`
     - `due_date IS NULL OR due_date <= today`
   - Count `OpenTickets_Over2Hours` per agent as: tickets where SLA is breached AND status/due_date filters pass
   - Compute `OpenTickets_Total`, `OpenTickets_NoUpdateToday`, `OldestTicketDays`, `OldestTicketKey` per agent (same logic as current SQL)

3. **No changes to other queries** (solvedToday, solvedWeek remain grouped — they don't use SLA fields)

4. **No changes to the UPDATE logic** (lines 1025–1078 — still writes to `dbo.Agent` per agent)

### Design confirmation needed

Before implementing, confirm: **retain or remove the status/due_date filters on the SLA breach count?**

- **Default (recommended):** RETAIN — breach board shows actionable breaches per agent
- **Alternative:** REMOVE — breach board matches dashboard raw SLA breach count exactly

If in doubt, retain. The manager brief (D-076) recommends retention.

---

## 3. Functions to reuse (do NOT rewrite)

- `parseSlaField(fieldsJson, fieldName)` — kpi-pipeline.ts:145-151
- `isSlaBreached(slaField)` — kpi-pipeline.ts:70-84

Both are already trusted (WS1-B TRUSTED, D-042).

---

## 4. Scope constraints

- ONLY modify `refreshAllAgentMetrics()` in `kpi-pipeline.ts`
- Do NOT change `extractSlaBreached()` in `jira-sync-service.ts`
- Do NOT change the `sla_breached` column or sync behaviour
- Do NOT change the solvedToday or solvedWeek queries
- Do NOT change the UPDATE or zeroing logic (unless the TypeScript interface changes require it)
- Do NOT touch the dashboard path (`collectJiraSnapshot`)
- Do NOT touch WS5-A fixes (Development tier, OldestTicketKey, observability logging)

---

## 5. Verification requirements

### Build-time

- TypeScript compilation: `npx tsc --noEmit` must pass
- Code review: only `refreshAllAgentMetrics()` changed
- Logic review: `isSlaBreached()` applied to same tickets as current query, with same operational filters

### Runtime (post-deploy)

| # | Check | Method | Expected |
|---|-------|--------|----------|
| RV-5 | `OpenTickets_Over2Hours` non-zero | Query `dbo.Agent` for any agent with `OpenTickets_Over2Hours > 0` | At least several agents show non-zero (was previously all 0) |
| RV-6 | Breach board TICKETS OVER SLA aligns with dashboard | Compare sum of `OpenTickets_Over2Hours` across all agents vs dashboard "SLA Breached" count | Should be in the same order of magnitude. Exact match not expected due to status/due_date filters. |
| RV-7 | No WS5-A regression | Check Development agent visibility, OldestTicketKey population, WORST OLDEST value | Must match WS5-A regression baselines (BF-006, BF-007, BF-008) |
| RV-8 | No WS1 regression | Run `_eval_ws1_regression.mjs` — all 6 checks PASS | RC-001 through RC-006 PASS |

---

## 6. Expected outcome

After this fix:
- Breach board "TICKETS OVER SLA" will reflect actual Resolution SLA breaches from `customfield_14048`
- Per-agent `OpenTickets_Over2Hours` will be non-zero for agents with breached tickets
- G-009 SLA-definition component will be resolved
- G-011 SLA-definition component will be resolved (OldestTicketDays already uses correct tickets from WS5-A, SLA count now aligned)
