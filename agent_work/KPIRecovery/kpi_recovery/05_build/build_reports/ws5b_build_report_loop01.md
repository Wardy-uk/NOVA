# WS5-B Build Report — Loop 01: SLA-Definition Alignment

**Date:** 2026-05-20
**Build brief:** `ws5b_build_brief_loop01.md`
**Status:** BUILD COMPLETE — AWAITING DEPLOY + RUNTIME VERIFICATION

---

## 1. What was changed

### File: `src/server/services/kpi-pipeline.ts`

### Function: `refreshAllAgentMetrics()` (lines 948–1044 post-edit)

**Diff stats:** 1 file changed, 80 insertions, 23 deletions.

### Change summary

1. **Replaced grouped SQL query with per-ticket SELECT** (lines 954–979):
   - Removed `GROUP BY a.assignee_account_id` and all `SUM(CASE ...)` / `MAX(...)` aggregates
   - Removed the correlated subquery for `OldestTicketKey`
   - Now returns individual ticket rows with: `assignee_account_id`, `assignee_display`, `issue_key`, `status_name`, `due_date`, `jira_created`, `jira_updated`, `fields_json`
   - WHERE clause unchanged: same project filter, `status_category != 'Done'`, non-null assignee, tier inclusion, onboarding exclusion

2. **Added TypeScript aggregation loop** (lines 981–1044):
   - Groups tickets by `assignee_account_id` using a `Map`
   - `OpenTickets_Total`: count of tickets per agent (same as SQL `COUNT(*)`)
   - `OpenTickets_Over2Hours`: uses `parseSlaField(ticket.fields_json, 'customfield_14048')` → `isSlaBreached()` — the **same trusted functions** used by the KPI Dashboard (`collectJiraSnapshot`). Operational filters retained:
     - Status NOT IN ('Done', 'Closed', 'Resolved', 'Waiting on Requestor', 'Waiting on Partner')
     - Due date is NULL or ≤ today
   - `OpenTickets_NoUpdateToday`: `jira_updated` date < today (same logic as SQL `CAST(jira_updated AS DATE) < CAST(GETUTCDATE() AS DATE)`)
   - `OldestTicketDays` / `OldestTicketKey`: tracks max age + corresponding key (same logic as SQL `MAX(DATEDIFF(...))` + correlated subquery)

3. **No other changes.** solvedToday, solvedWeek queries untouched. UPDATE logic untouched. Zeroing logic untouched.

### Design decision

**Retained** status/due_date operational filters on SLA breach count, per D-076 recommendation. Breach board shows actionable breaches per agent.

---

## 2. Build-time verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS — zero errors |
| Only `refreshAllAgentMetrics()` changed | PASS — diff confined to lines 954–1044 |
| `isSlaBreached()` reused (not rewritten) | PASS — called at line 1020, defined at line 70 |
| `parseSlaField()` reused (not rewritten) | PASS — called at line 1019, defined at line 145 |
| solvedToday/solvedWeek queries untouched | PASS |
| UPDATE logic untouched | PASS |
| Zeroing logic untouched | PASS |
| Dashboard path (`collectJiraSnapshot`) untouched | PASS |
| WS5-A fixes untouched | PASS — Development tier, OldestTicketKey subquery, observability logging not modified |

---

## 3. Logic equivalence analysis

| Metric | Before (SQL) | After (TypeScript) | Equivalent? |
|--------|-------------|-------------------|-------------|
| `OpenTickets_Total` | `COUNT(*)` per agent | Loop counter per agent | YES |
| `OpenTickets_Over2Hours` | `SUM(CASE WHEN sla_breached = 1 AND status NOT IN (...) AND due_date filter)` — reads dead `sla_breached` column from `customfield_10010` | `isSlaBreached(parseSlaField(fields_json, 'customfield_14048'))` with same status + due_date filters | FIXED — now uses live Resolution SLA field |
| `OpenTickets_NoUpdateToday` | `SUM(CASE WHEN CAST(jira_updated) < today)` | `jira_updated.slice(0,10) < todayStr` | YES |
| `OldestTicketDays` | `MAX(DATEDIFF(day, jira_created, GETUTCDATE()))` | `Math.floor((now - created) / 86400000)` | YES (minor rounding difference possible, ±1 day) |
| `OldestTicketKey` | Correlated subquery: `TOP 1 ORDER BY jira_created ASC` | Tracked during loop: key with max age | YES (same result: oldest ticket's key) |

---

## 4. Runtime verification requirements (post-deploy)

| # | Check | Method | Expected |
|---|-------|--------|----------|
| RV-5 | `OpenTickets_Over2Hours` non-zero | Query `dbo.Agent` for any agent with `OpenTickets_Over2Hours > 0` | At least several agents show non-zero (was previously all 0) |
| RV-6 | Breach board TICKETS OVER SLA aligns with dashboard | Compare sum of `OpenTickets_Over2Hours` across all agents vs dashboard "SLA Breached" count | Same order of magnitude. Exact match not expected due to status/due_date filters. |
| RV-7 | No WS5-A regression | Check Development agent visibility, OldestTicketKey population, WORST OLDEST value | Must match WS5-A baselines (BF-006, BF-007, BF-008) |
| RV-8 | No WS1 regression | Run `_eval_ws1_regression.mjs` — all 6 checks PASS | RC-001 through RC-006 PASS |

---

## 5. Defects resolved

| ID | Description | Resolution |
|----|-------------|------------|
| G-009 | SLA-definition alignment (breach board) | `OpenTickets_Over2Hours` now computed from `customfield_14048` via `parseSlaField` + `isSlaBreached`, matching dashboard logic |
| G-011 | SLA-definition alignment (OldestTicketDays context) | OldestTicketDays already correct from WS5-A; SLA breach count now aligned, completing the fix |

---

## 6. What's next

Deploy to prod, run RV-5 through RV-8, then mark G-009 and G-011 as resolved.
