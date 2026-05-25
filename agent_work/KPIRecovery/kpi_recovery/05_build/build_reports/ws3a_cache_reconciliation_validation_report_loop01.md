# WS3-A Cache Reconciliation Validation Report — Loop 01

## 1. Header

| Field | Value |
|-------|-------|
| Date | 2026-05-21 |
| Type | Build-side validation / design-constraint analysis |
| Governing Decision | D-048: Permanent deletion-handling fix logged as WS3 input |
| Prior Evidence | WS1-D Loop 02: 46 stale deleted tickets removed manually from `jira_issue_cache` |
| Executor | Build Agent |

---

## 2. Current Failure Mechanism

### Root Cause

`jira-sync-service.ts` never deletes rows from `jira_issue_cache`. All three sync paths are upsert-only:

| Sync Path | Method | Deletion Handling |
|-----------|--------|-------------------|
| `fullSync()` (line 105) | Fetches open + recently-closed issues via JQL, then `MERGE ... WHEN MATCHED THEN UPDATE ... WHEN NOT MATCHED THEN INSERT` per issue | **None.** Issues deleted in Jira are simply absent from the JQL result set. Absent issues are neither updated nor removed — their stale rows persist indefinitely. |
| `incrementalSync()` (line 177) | Fetches issues updated since `lastSyncAt` via JQL, same MERGE upsert | **None.** Same problem. Deleted issues have no `updated` timestamp to trigger re-fetch. They silently remain in cache. |
| `syncSingleIssue()` (line 231) | Calls `getIssue(issueKey)`. If the Jira REST API returns 404 (deleted issue), the client returns `null` and the method returns early (`if (!issue) return;`) | **None.** The 404 is silently swallowed. The stale row is not deleted. |

### Accumulation Dynamics

- Jira ticket deletions are rare but non-zero. The WS1-D evidence showed 46 deleted tickets accumulated over the life of the project.
- The JQL in `fullSync()` is `statusCategory != Done OR updated >= -7d`. Deleted issues match neither clause, so they never appear in the result set.
- There is no periodic reconciliation sweep, no `synced_at` freshness check, and no soft-delete flag.
- The `synced_at` column (updated to `GETUTCDATE()` on every upsert) could theoretically be used to detect stale rows, but no code currently reads it for that purpose.

---

## 3. Affected Code Paths

### Direct Sync Paths (where the fix would go)

| File | Function | Lines | Role |
|------|----------|-------|------|
| `jira-sync-service.ts` | `fullSync()` | 105–175 | Primary candidate for reconciliation sweep |
| `jira-sync-service.ts` | `syncSingleIssue()` | 231–246 | Candidate for 404-driven hard delete |
| `jira-sync-service.ts` | `upsertIssue()` | 248–467 | MERGE statement — sets `synced_at = GETUTCDATE()` |

### Downstream Consumers of `jira_issue_cache`

28 service files and 6 route files read from `jira_issue_cache`. The highest-impact consumers are:

| Consumer | Query Pattern | Impact of Row Removal |
|----------|---------------|----------------------|
| `kpi-pipeline.ts` | Multiple `SELECT ... FROM jira_issue_cache WHERE status_category != 'Done'` queries for tier counts, SLA metrics, FRT metrics, CC bucketing | **Safe.** Removing a deleted ticket reduces counts correctly. These are point-in-time aggregations — they don't track individual row identity across runs. |
| `wallboard-live-cache.ts` | `SELECT ... FROM jira_issue_cache` for breach board population | **Safe.** Same aggregation pattern. |
| `escalation-log-service.ts` | Reads `jira_issue_cache` for tier-change detection | **Safe.** `escalation_log` rows are independent once written. Removing the source cache row doesn't affect historical logs. |
| `assignment-engine.ts` | Reads cache for round-robin assignment | **Safe.** Only considers active open tickets. Deleted tickets should not be assignable. |
| `agent-loop.ts`, `observer.ts`, `risk-scorer.ts`, etc. | Read cache for AI agent context | **Safe.** Removing stale rows improves data quality. |
| `jira_kpi_daily` (Azure SQL snapshot) | KPI pipeline writes daily snapshots via MERGE into `jira_kpi_daily` | **Safe.** Snapshots are aggregated KPI values, not per-ticket rows. Removing a stale ticket from cache reduces next day's counts, which is the correct behaviour. Historical snapshots are unaffected. |

**Key finding: No downstream consumer assumes rows persist forever or tracks individual cache row identity across pipeline runs.** All consumers use aggregation queries (COUNT, SUM, GROUP BY) or per-ticket point-in-time reads. Removal of a deleted ticket's row is the correct semantic action in every case.

---

## 4. Can the Fix Be Done Without Schema Change?

**Yes.**

The existing `synced_at` column (already present on every row, updated to `GETUTCDATE()` on every upsert) provides sufficient infrastructure for a reconciliation sweep. No new columns are required.

The reconciliation logic is:

1. During `fullSync()`, before or after the upsert loop, record the sync timestamp.
2. After all upserts complete, delete rows where `synced_at < sync_start_timestamp` AND the row belongs to a project in scope.

This works because `fullSync()` fetches ALL open + recently-closed issues. Any row that wasn't touched by the upsert loop is either:
- A deleted ticket (correct to remove), or
- A "Done" ticket older than 7 days (correct to age out of cache — these are closed and not needed for KPI counts)

No schema migration. No new column. No soft-delete flag.

---

## 5. Fix Shape Assessment

### Option A: Reconciliation Sweep During `fullSync()` — RECOMMENDED

**Mechanism:** After all upserts complete in `fullSync()`, run:
```sql
DELETE FROM jira_issue_cache
WHERE project_key IN (<configured projects>)
  AND synced_at < @syncStartTimestamp
```

**Strengths:**
- Catches all deletions in a single pass
- Uses existing `synced_at` column — no schema change
- Self-healing: runs on every full sync (server startup)
- Handles both ticket deletions AND tickets moved to other projects
- Bounded blast radius: only affects rows from configured projects

**Risks:**
- If `fullSync()` partially fails (fetches only some issues), the sweep could incorrectly delete rows that simply weren't fetched. **Mitigation:** Only run the sweep if the upsert loop completed without fatal error, and optionally gate on a minimum issue count threshold.
- Done tickets older than 7 days will be swept. This is actually correct behaviour — they're not needed for open-ticket KPIs, and historical data is already captured in `jira_kpi_daily` snapshots.

### Option B: 404-Driven Hard Delete During `syncSingleIssue()` — COMPLEMENTARY

**Mechanism:** In `syncSingleIssue()`, when `getIssue()` returns `null` (404), delete the cache row:
```typescript
if (!issue) {
  await execute('DELETE FROM jira_issue_cache WHERE issue_key = ?', [issueKey]);
  return;
}
```

**Strengths:**
- Catches individual deletions immediately when a specific ticket is re-synced
- Trivial change (2 lines)

**Limitations:**
- Only fires when something explicitly calls `syncSingleIssue()` for a deleted ticket
- Does not catch bulk deletions or tickets deleted between syncs
- Not a standalone solution — needs Option A for comprehensive coverage

### Option C: Soft-Delete Flag — NOT RECOMMENDED

**Mechanism:** Add `is_deleted BIT DEFAULT 0` column, set to 1 instead of deleting rows. Filter all reads with `WHERE is_deleted = 0`.

**Reasons to reject:**
- Requires schema change (ALTER TABLE + column addition)
- Requires modifying 28+ service files and 6+ route files to add the filter
- No downstream consumer needs soft-delete semantics — there is no "undo delete" or audit trail requirement for cache rows
- The cache is a derived copy of Jira, not a source of truth — soft-delete adds complexity without value

### Recommendation

**Option A (reconciliation sweep) as the primary fix, with Option B (404 hard delete) as a complementary improvement.** Together they provide both batch and real-time deletion handling with no schema change and minimal code surface.

---

## 6. Whether Schema Change Is Actually Required

**No.** The `synced_at` column already provides the timestamp needed for reconciliation. No new columns, tables, or indexes are required.

---

## 7. Narrowest Credible Next Implementation Slice

### WS3-A-BUILD-01: Reconciliation Sweep in `fullSync()`

**Scope:**
1. Record `syncStartTimestamp` at the top of `fullSync()`
2. After the upsert loop completes (and only if no fatal error), execute a bounded DELETE:
   ```sql
   DELETE FROM jira_issue_cache
   WHERE project_key IN (<configured projects>)
     AND synced_at < @syncStartTimestamp
   ```
3. Log the number of reconciled (deleted) rows
4. Add the 404-driven delete in `syncSingleIssue()` as part of the same change

**File changes:** `jira-sync-service.ts` only (single file)

**Safety gates:**
- Only sweep after a successful upsert pass (not on error)
- Optional: require minimum issue count (e.g., `issueCount >= 50`) before sweeping, to avoid wiping the cache if Jira returns an empty result due to API failure
- Log the count of swept rows for observability

**What this does NOT include:**
- Comment cache cleanup (could be added later but is lower priority)
- Schema changes (not needed)
- Downstream query modifications (not needed)
- KPI pipeline changes (not needed)

**Estimated change size:** ~15 lines added to `fullSync()`, ~3 lines added to `syncSingleIssue()`

---

## 8. Verdict

### Current Failure Mechanism
The sync path in `jira-sync-service.ts` only upserts. Deleted Jira tickets persist indefinitely in `jira_issue_cache`, inflating KPI counts and polluting all downstream consumers.

### Affected Code Paths
Three sync functions (`fullSync`, `incrementalSync`, `syncSingleIssue`) — all upsert-only. 34 downstream files read from the cache but none depend on row permanence.

### Safest Minimal Permanent Fix Shape
Reconciliation sweep at the end of `fullSync()` using the existing `synced_at` column, complemented by 404-driven delete in `syncSingleIssue()`. No schema change required.

### Schema Change Required?
**No.**

### Exact Next Implementation Slice
WS3-A-BUILD-01: Add reconciliation sweep to `fullSync()` + 404 delete to `syncSingleIssue()`. Single file change (`jira-sync-service.ts`), ~18 lines, with a safety gate on minimum issue count to prevent accidental cache wipe.
