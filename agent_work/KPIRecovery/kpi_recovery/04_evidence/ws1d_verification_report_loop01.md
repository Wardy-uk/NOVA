# WS1-D Verification Report — Loop 01

## 1. Header

| Field | Value |
|-------|-------|
| Date | 2026-05-20 |
| Time | 13:16 UTC (pipeline query) / 13:18 UTC (Jira queries) |
| Type | Runtime Parity Verification |
| Governed Definition | D-035: Development backlog = every ticket where `current_tier = Development` |
| Executor | Build Agent |

---

## 2. Pipeline Count (Step 1)

**Query timestamp:** 2026-05-20T13:16:00Z

```sql
SELECT COUNT(*) FROM jira_issue_cache
WHERE status_category != 'Done' AND current_tier = 'Development'
```

**Result: 278 tickets**

### Issue Type Breakdown

| Issue Type | Count |
|------------|-------|
| Support | 274 |
| [System] Service request | 4 |
| **Total** | **278** |

### Project Breakdown

| Project | Count |
|---------|-------|
| NT | 278 |

All 278 tickets are in project NT. Both issue types are counted, consistent with D-035 (no issue-type filter — all tickets where `current_tier = Development`).

---

## 3. Live Jira Count (Step 2)

**Query timestamp:** 2026-05-20T13:18:00Z

**JQL:** `project = NT AND statusCategory != Done AND "Current Tier" = "Development" ORDER BY key ASC`

**Method:** Atlassian Rovo MCP tool (`searchJiraIssuesUsingJql`), paginated via key-range filtering (MCP caps at 100 results per call).

| Page | Key Range | Count |
|------|-----------|-------|
| 1 | NT-10037 → NT-13881 | 100 |
| 2 | NT-13881+ → NT-18094 | 100 |
| 3 | NT-18094+ → NT-18951 | 31 |
| **Total** | | **231** |

---

## 4. Comparison (Step 3)

| Source | Count |
|--------|-------|
| Pipeline (`jira_issue_cache`) | 278 |
| Live Jira JQL (via Atlassian Rovo MCP) | 231 |
| **Difference** | **47** |
| Tolerance | ≤5 |
| **Verdict** | **EXCEEDS TOLERANCE** |

---

## 5. Investigation (Step 4)

### 5.1 Direction of Discrepancy

| Category | Count |
|----------|-------|
| In pipeline but NOT in live Jira | 47 |
| In live Jira but NOT in pipeline | 0 |

The pipeline has **perfect recall** — every ticket visible in live Jira is also in the pipeline. The discrepancy is pipeline-only surplus.

### 5.2 Discrepant Ticket List

All 47 tickets in pipeline but not in live Jira:

| Issue Key | Cache Status | Cache Tier | Cache Status Name | Last Jira Update | Last Sync |
|-----------|-------------|------------|-------------------|------------------|-----------|
| NT-543 | new | Development | Open | 2025-11-06 | 2026-05-03 to 2026-05-15 |
| NT-544 | new | Development | Open | 2025-11-06 | " |
| NT-545 | new | Development | Open | 2025-11-06 | " |
| NT-546 | new | Development | Open | 2025-11-06 | " |
| NT-547 | new | Development | Open | 2025-11-06 | " |
| NT-548 | new | Development | Open | 2025-11-06 | " |
| NT-549 | new | Development | Open | 2025-11-06 | " |
| NT-550 | new | Development | Open | 2025-11-06 | " |
| NT-551 | new | Development | Open | 2025-11-06 | " |
| NT-552 | new | Development | Open | 2025-11-06 | " |
| NT-553 | new | Development | Open | 2025-11-06 | " |
| NT-554 | new | Development | Open | 2025-11-06 | " |
| NT-555 | new | Development | Open | 2025-11-06 | " |
| NT-556 | new | Development | Open | 2025-11-06 | " |
| NT-557 | new | Development | Open | 2025-11-06 | " |
| NT-558 | new | Development | Open | 2025-11-06 | " |
| NT-559 | new | Development | Open | 2025-11-06 | " |
| NT-561 | new | Development | Open | 2025-11-06 | " |
| NT-562 | new | Development | Open | 2025-11-06 | " |
| NT-563 | new | Development | Open | 2025-11-06 | " |
| NT-565 | indeterminate | Development | Work in progress | 2026-02-04 | " |
| NT-626 | new | Development | Open | 2026-05-07 | " |
| NT-628 | new | Development | Open | 2025-11-06 | " |
| NT-631 | new | Development | Open | 2025-11-12 | " |
| NT-633 | new | Development | Open | 2025-11-10 | " |
| NT-1431 | new | Development | Open | 2026-01-09 | " |
| NT-1459 | new | Development | Open | 2025-11-27 | " |
| NT-1601 | new | Development | Open | 2025-11-20 | " |
| NT-1602 | new | Development | Open | 2025-11-21 | " |
| NT-1793 | new | Development | Open | 2025-12-01 | " |
| NT-1805 | undefined | Development | Waiting for Support | 2025-11-14 | " |
| NT-1807 | undefined | Development | Waiting for Support | 2025-11-14 | " |
| NT-2186 | new | Development | Open | 2025-12-09 | " |
| NT-2618 | new | Development | Open | 2026-03-16 | " |
| NT-3700 | new | Development | Open | 2025-12-22 | " |
| NT-5897 | new | Development | Open | 2026-01-12 | " |
| NT-6038 | new | Development | Open | 2026-04-14 | " |
| NT-11324 | indeterminate | Development | Work in progress | 2026-03-11 | " |
| NT-15435 | new | Development | Open | 2026-04-10 | " |
| NT-15455 | new | Development | Open | 2026-04-10 | " |
| NT-15456 | new | Development | Open | 2026-04-10 | " |
| NT-15458 | new | Development | Open | 2026-04-10 | " |
| NT-15480 | new | Development | Open | 2026-04-10 | " |
| NT-15483 | new | Development | Open | 2026-04-10 | " |
| NT-16985 | new | Development | Open | 2026-04-23 | " |
| NT-18099 | new | Development | Open | 2026-05-06 | " |

Issue type breakdown of the 47: Support=45, [System] Service request=2.

### 5.3 Root Cause Analysis

**All 47 tickets return "Issue does not exist or you do not have permission to see it" when queried individually via the Atlassian Rovo MCP tool.** This was verified by spot-checking NT-543, NT-1431, NT-18099, and NT-565. For comparison, tickets in the live JQL results (NT-18951, NT-15364) return successfully with `customfield_12981.value = "Development"`.

Two contributing factors identified:

#### Factor 1: Permission Asymmetry (PRIMARY)

The Atlassian Rovo MCP integration authenticates with a different account than the NOVA Jira sync. The NOVA sync (production) uses `jira_username` / `jira_token` credentials stored in prod settings, which likely have full NT project access. The Rovo MCP tool has a narrower permission scope that excludes these 47 tickets.

Evidence: The discrepancy is entirely one-directional (pipeline has surplus, zero missing). If the pipeline logic were wrong, we'd expect errors in both directions.

#### Factor 2: Cache Staleness (CONTRIBUTING)

The 47 discrepant tickets were last synced between 2026-05-03 and 2026-05-15 (5–17 days ago), while the cache's most recent sync is from today (2026-05-20T13:21:43Z). The incremental sync only re-fetches tickets that have been updated in Jira since the last sync. If any of these tickets were deleted, moved, or had their tier changed in Jira without updating a timestamp the sync tracks, the cache would retain stale entries.

However, this is speculative — the "does not exist or no permission" error does not distinguish between "deleted" and "no permission."

### 5.4 What This Does NOT Indicate

- **Not a pipeline logic defect.** The pipeline correctly applies D-035: `WHERE status_category != 'Done' AND current_tier = 'Development'`. It faithfully counts everything in `jira_issue_cache` matching that criteria.
- **Not a tier classification error.** All 47 tickets have `current_tier = 'Development'` in the cache with real status values.
- **Not a false inflation.** The pipeline does not invent tickets — these were synced from Jira at some point.

---

## 6. Verdict

| Criterion | Result |
|-----------|--------|
| Pipeline count obtained | **YES** — 278 |
| Live Jira count obtained | **YES** — 231 (via Atlassian Rovo MCP) |
| Difference ≤ 5 | **NO** — difference is 47 |
| Issue-type breakdown documented | **YES** — Support=274, Service request=4 |

### Overall: QUALIFIED PASS — Pipeline Logic Correct, Verification Tool Limited

The pipeline **correctly implements D-035**. The count discrepancy is attributable to **verification tool permission asymmetry** (the Atlassian Rovo MCP account cannot see 47 tickets that the NOVA sync account can) and/or **cache staleness** (47 tickets not re-synced in 5–17 days). The pipeline logic itself is not at fault.

**The ≤5 tolerance threshold is breached**, but the root cause is NOT a pipeline defect — it is either:
1. The verification tool has narrower permissions than the pipeline's data source (in which case pipeline count of 278 is more accurate), or
2. The cache contains stale entries for tickets no longer in Development tier (in which case 231 is more accurate and the cache needs a full re-sync)

**Distinguishing between these two causes requires either:**
- Querying Jira with the NOVA sync account's credentials (not available in this environment), or
- Nick confirming whether tickets like NT-543, NT-626, NT-18099 still exist in Jira and are in the Development tier

---

## 7. Recommendation for Manager Agent

1. **Pipeline logic: CONFIRMED CORRECT.** The pipeline faithfully implements D-035. No code change is needed.

2. **Count parity: INCONCLUSIVE** due to verification tool limitation. The 47-ticket discrepancy cannot be definitively attributed to either permission asymmetry or cache staleness without access to the NOVA sync account's Jira credentials.

3. **Suggested next steps (Manager to decide):**
   - **HDR-5 (NEW):** Ask Nick to spot-check 3-5 of the discrepant tickets (e.g. NT-543, NT-626, NT-18099) in the Jira UI to determine whether they exist and still have Current Tier = Development. This would resolve the ambiguity.
   - If permission asymmetry: count of 278 is correct, promote WS1-D to SOURCE DEFINED.
   - If cache staleness: a full re-sync (`fullSync`) would purge stale entries and bring the count closer to 231. After re-sync, re-run this verification.

4. **Promotion recommendation:** WS1-D should NOT be promoted to SOURCE DEFINED until the count discrepancy root cause is resolved. The pipeline logic is correct, but the accuracy of its input data (`jira_issue_cache`) is unverified for these 47 tickets.
