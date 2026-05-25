# WS5 Breach Board Fix Report — Loop 02

**Date:** 2026-05-20  
**Scope:** Bounded fixes to `refreshAllAgentMetrics()` population path  
**Status:** IMPLEMENTED — awaiting deploy verification  

---

## 1. Files Changed

| File | Lines Affected | Nature |
|------|---------------|--------|
| `src/server/services/kpi-pipeline.ts` | 954–1086 (`refreshAllAgentMetrics()`) | Three targeted fixes within existing function |

No other files were changed.

---

## 2. Fixes Applied

### A. Development Tier Inclusion

**Before:** `current_tier IN ('Customer Care', 'Production', 'Tier 2', 'Tier 3')` — Development excluded.

**After:** `current_tier IN ('Customer Care', 'Production', 'Tier 2', 'Tier 3', 'Development')` in all three queries:
- `openStats` query (open ticket stats per agent)
- `solvedToday` query (solved tickets today per agent)
- `solvedWeek` query (solved tickets this week per agent)

**Effect:** Development-tier agents will now appear in `dbo.Agent` population, closing gap G-011 where the dashboard showed 197-day oldest ticket (Development tier) but the breach board showed 76 days (Development excluded).

### B. OldestTicketKey Population

**Before:** `OldestTicketKey` was never written by `refreshAllAgentMetrics()`. The UPDATE only set `OldestTicketDays`. The column existed in `dbo.Agent` but was only populated externally (likely n8n).

**After:** Added a correlated subquery to the `openStats` query:

```sql
(SELECT TOP 1 o.issue_key FROM jira_issue_cache o
 WHERE o.assignee_account_id = a.assignee_account_id
   AND o.project_key IN (@p0, ...)
   AND o.status_category != 'Done'
   AND o.current_tier IN ('Customer Care', 'Production', 'Tier 2', 'Tier 3', 'Development')
   AND LOWER(ISNULL(o.request_type, '')) != 'onboarding'
 ORDER BY o.jira_created ASC) AS OldestTicketKey
```

The UPDATE now writes `OldestTicketKey = @oldestKey` alongside `OldestTicketDays`.

The zeroing logic also now sets `OldestTicketKey = NULL` when zeroing agents with no open tickets.

**Approach:** Correlated subquery with `TOP 1 ... ORDER BY jira_created ASC` — gets the issue key of the earliest-created open ticket for that agent, matching the same tier/project/onboarding filters as the outer query.

### C. AccountId Match Observability

**Before:** Single log line: `All agent metrics refreshed: {updated} agents updated from {openStats.length} with open tickets` — no visibility into mismatches.

**After:** Two log lines:

1. **Summary:** `Agent metrics refresh: {openStats.length} agents from cache, {updated} matched in dbo.Agent, {unmatchedAccountIds.length} unmatched`
2. **Detail (conditional):** `Unmatched AccountIds (no dbo.Agent row): {first 10 IDs} (+N more)` — only emitted when unmatched > 0.

The code now tracks `unmatchedAccountIds[]` — any `assignee_account_id` from `jira_issue_cache` where the `UPDATE dbo.Agent WHERE AccountId = @accountId` affected zero rows. This reveals whether zero-output on the breach board is caused by AccountId mismatches between the two tables.

---

## 3. SLA Definition Difference — Inspection (No Change)

### What `sla_breached` in `jira_issue_cache` represents

- **Source field:** `customfield_10010` (Jira "Time to Resolution" SLA)
- **Extraction function:** `extractSlaBreached()` in `jira-sync-service.ts` (lines 607–616)
- **Logic:** Checks `completedCycles` array only. Returns `true` if any completed cycle has `breached === true`. Does NOT check `ongoingCycle`.
- **Result:** A boolean flag that only reflects historically completed SLA cycles, not currently-running breaches.

### What the dashboard's Resolution SLA represents

- **Source field:** `customfield_14048` (Jira "Resolution SLA" — different custom field)
- **Extraction function:** `parseSlaField()` → `isSlaBreached()` in `kpi-pipeline.ts` (lines 70–84, 145–151)
- **Logic:** Checks BOTH `completedCycles` AND `ongoingCycle`. Returns `true` if any cycle has `breached === true` OR `remainingTime.millis < 0`.
- **Result:** A boolean that reflects both historical and currently-running breaches.

### Key differences

| Property | `sla_breached` (breach board path) | Dashboard `resBreached` |
|----------|-----------------------------------|------------------------|
| **Jira field** | `customfield_10010` (Time to Resolution) | `customfield_14048` (Resolution SLA) |
| **Checks ongoing cycle** | No — completed cycles only | Yes — ongoing + completed |
| **Negative remaining time** | Not checked | Treated as breached |
| **Additional filters in breach board** | `status_name NOT IN (Done, Closed, Resolved, WoR, WoP)` AND `due_date IS NULL OR <= today` | None (raw SLA state) |

### Impact

The breach board uses a **narrower** SLA definition than the dashboard:
1. Different Jira custom field entirely (`10010` vs `14048`)
2. Only counts completed-cycle breaches, missing ongoing breaches
3. Applies additional status and due-date filters on top

This means the breach board will systematically undercount breaches compared to the dashboard, even when AccountId matching and tier inclusion are correct. **This is the remaining structural divergence that cannot be fixed by the current loop's changes.**

### Recommendation for next loop

Align the breach board to use the same SLA extraction as the dashboard — either:
- Change `refreshAllAgentMetrics()` to parse `fields_json` with `isSlaBreached(parseSlaField(fields_json, 'customfield_14048'))` instead of relying on the `sla_breached` column, OR
- Update `extractSlaBreached()` in jira-sync-service.ts to check ongoing cycles and use `customfield_14048`

This is a **medium-risk change** that should be evaluated and approved separately.

---

## 4. Verification Performed

- **TypeScript compilation:** `npx tsc --noEmit` — clean, no errors
- **Code review:** All edits are within `refreshAllAgentMetrics()` only. No other functions, routes, or files were modified.
- **SQL correctness:** The correlated subquery for OldestTicketKey uses the same parameter bindings (`@p0`, etc.) as the outer query — MSSQL allows the same named parameter to be referenced multiple times.
- **Zeroing logic:** Both branches (active agents exist / no active agents) now zero `OldestTicketKey = NULL`.

### Not yet verified (requires deploy)

- Whether `dbo.Agent.AccountId` values actually match `jira_issue_cache.assignee_account_id` — the new logging will reveal this on first run
- Whether Development-tier agents have corresponding rows in `dbo.Agent`
- Whether the OldestTicketKey subquery returns the correct issue key

---

## 5. What Remains for Next Loop

| Item | Type | Detail |
|------|------|--------|
| **SLA definition alignment** | Approved inspection, NOT yet implemented | `sla_breached` (customfield_10010, completed-only) ≠ dashboard's `resBreached` (customfield_14048, completed+ongoing). This is the remaining structural cause of breach-count divergence. |
| **AccountId match verification** | Pending deploy | New logging will show how many agents from cache fail to match `dbo.Agent` rows. If many are unmatched, dbo.Agent roster needs AccountId population. |
| **Development tier roster** | Pending deploy | Development agents are now included in queries, but they also need rows in `dbo.Agent` with correct `AccountId` values to appear on the board. |
| **Runtime verification** | Pending | After deploy, check logs for the new `[kpi-pipeline] Agent metrics refresh:` line to confirm data is flowing. |

---

## 6. Summary

Three bounded fixes implemented in `kpi-pipeline.ts:refreshAllAgentMetrics()`:

1. **Development tier** added to all three query tier filters (openStats, solvedToday, solvedWeek)
2. **OldestTicketKey** now populated via correlated subquery and written to `dbo.Agent`
3. **Observability logging** now reports expected/matched/unmatched agent counts with AccountId details

SLA definition difference documented but not changed. The `sla_breached` column uses a different Jira field (`customfield_10010`) and narrower logic (completed cycles only) than the dashboard's `customfield_14048`-based Resolution SLA. This is the remaining structural divergence to address in a future loop.
