# WS3-A Reconciliation Fix Report — Loop 02

## 1. Header

| Field | Value |
|-------|-------|
| Date | 2026-05-21 |
| Type | Bounded implementation build |
| Governing Decision | D-133, D-134: Approved fix shape from WS3-A validation report |
| Prior Evidence | ws3a_cache_reconciliation_validation_report_loop01.md |
| File Changed | `src/server/services/jira-sync-service.ts` (single file) |
| Executor | Build Agent |

---

## 2. What Was Changed

### Change A: Reconciliation Sweep in `fullSync()` (lines 143–163)

After the upsert loop completes and `fullSyncDone` is set to `true`, a new reconciliation sweep runs:

```sql
DELETE FROM jira_issue_cache
WHERE project_key IN (?, ?)
  AND synced_at < ?
```

The sweep deletes all rows from configured projects whose `synced_at` timestamp is older than the sync start time. Since `fullSync()` touches every issue in the JQL result set (updating `synced_at` via the MERGE statement), any row NOT touched must be either:

- A ticket deleted from Jira (correct to remove)
- A "Done" ticket older than 7 days no longer in the JQL window (correct to age out)

The number of swept rows is logged for observability.

### Change B: 404-Driven Hard Delete in `syncSingleIssue()` (lines 259–262)

When `getIssue()` returns `null` (Jira API 404 — issue no longer exists), the cache row is now deleted:

```typescript
if (!issue) {
  await execute('DELETE FROM jira_issue_cache WHERE issue_key = ?', [issueKey]);
  console.log(`[jira-sync] Deleted confirmed-missing issue ${issueKey} from cache`);
  return;
}
```

Previously, the `null` return was silently swallowed and the stale row persisted.

---

## 3. Safety Guard for Full-Sync Sweep

| Guard | Value | Rationale |
|-------|-------|-----------|
| Minimum issue count | `issueCount >= 50` | Prevents the sweep from running if the Jira API returns an empty or partial result (e.g. API timeout, auth failure, rate limit). The production cache has 500+ issues, so 50 is a conservative floor. |
| Only after successful upsert pass | Sweep runs after `this.fullSyncDone = true` and `this.consecutiveErrors = 0` | The sweep is inside the `try` block, after all upserts complete. If `fullSync()` throws before reaching the sweep, it does not execute. |
| Project-scoped | `WHERE project_key IN (...)` | Only sweeps rows belonging to configured projects. Cannot affect rows from other projects that might exist in the cache. |
| Non-fatal on error | `try/catch` around sweep | If the DELETE itself fails, it logs a warning and does not crash the sync. |
| Skip logging | Logs when skipped with reason | If fewer than 50 issues were upserted, the skip is logged with the actual count and threshold for diagnostic visibility. |

---

## 4. Does `syncSingleIssue()` Now Delete Confirmed-Missing Tickets?

**Yes.** When `getIssue(issueKey)` returns `null` (indicating a 404 from the Jira REST API), the method now executes `DELETE FROM jira_issue_cache WHERE issue_key = ?` before returning. The deletion is logged with the issue key.

---

## 5. Compile / Verification Result

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** — zero errors, zero warnings |
| Lines added | ~22 lines (reconciliation sweep) + 3 lines (404 delete) = ~25 lines total |
| Lines removed | 0 |
| Files changed | 1 (`jira-sync-service.ts`) |
| Schema changes | None |
| Downstream changes | None |

---

## 6. What Runtime Verification Should Prove Next

| RV | Check | How to Verify |
|----|-------|---------------|
| RV-1 | Reconciliation sweep runs on server startup (full sync) | Look for `[jira-sync] Reconciliation sweep: removed N stale rows` in server logs after restart |
| RV-2 | Sweep count is credible | The swept count should be small (0–50 range) on a healthy cache; a very large number would indicate a problem |
| RV-3 | Sweep does not wipe active tickets | After sweep, verify KPI dashboard counts haven't dropped unexpectedly vs pre-deploy baseline |
| RV-4 | 404 delete works for known-deleted tickets | Call `syncSingleIssue('NT-543')` (a known-deleted ticket from WS1-D evidence) and verify the log shows `Deleted confirmed-missing issue NT-543 from cache` |
| RV-5 | No regression in existing sync behaviour | Incremental sync continues to run on the 45s timer with no errors; KPI dashboard and wallboards show consistent data |

---

## 7. Scope Compliance

| Boundary | Compliant? |
|----------|-----------|
| No schema changes | Yes |
| No snapshot-table redesign | Yes |
| No KPI maths modification | Yes |
| No n8n changes | Yes |
| No unrelated dead code cleanup | Yes |
| Single file change | Yes |
