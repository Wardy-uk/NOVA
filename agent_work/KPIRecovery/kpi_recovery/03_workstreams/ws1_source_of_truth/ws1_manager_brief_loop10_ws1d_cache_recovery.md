# WS1-D Manager Brief — Loop 10 (Cache Freshness Recovery)

## 1. Context

WS1-D verification (Loop 01) confirmed the pipeline logic matches D-035 exactly. The 47-ticket discrepancy between pipeline (278) and live Jira (231) was resolved by spot-check: NT-543, NT-626, and NT-18099 are **deleted in Jira** (D-044). The remaining WS1-D problem is stale cache representation — not a definition, permission, or calculation defect.

This brief converts that finding into a bounded cache-freshness recovery slice.

---

## 2. Root Cause: No Deletion Handling in Jira Sync

Code inspection of `jira-sync-service.ts` confirms:

| Method | Behaviour | Deletion Handling |
|--------|-----------|-------------------|
| `fullSync()` (lines 104-174) | Fetches open + recently-closed tickets via JQL, MERGE upserts into `jira_issue_cache` | **NONE** — never DELETEs rows. Deleted Jira tickets are never returned by JQL, so they persist indefinitely. |
| `incrementalSync()` (lines 176-228) | Fetches tickets updated since last sync, MERGE upserts | **NONE** — same problem. Deleted tickets have no "updated" event the sync can see. |
| `syncSingleIssue()` (lines 230-245) | Fetches one issue by key. If Jira returns 404, calls `getIssue()` which returns `null`. | **Silently skips** — `if (!issue) return;` at line 233. Does NOT remove the stale row. |
| DB schema (`schema.ts` lines 567-636) | `jira_issue_cache` table definition | **No soft-delete columns** — no `is_deleted`, `deleted_at`, or `is_active` field. |
| Cache queries (`jira-cache-queries.ts`) | All query methods | **No cleanup/purge methods** exist. |

**Consequence:** Any Jira ticket that is deleted after being synced into `jira_issue_cache` remains as a phantom row forever. The 47 stale Development tickets are a manifestation of this structural gap.

---

## 3. Scope of Impact

### 3.1 Confirmed Impact on WS1-D

- Pipeline reports 278 Development tickets; live Jira has 231
- Difference: 47 stale/deleted tickets inflating the Development count by ~20%
- All 47 tickets return "does not exist" when queried individually via Jira API

### 3.2 Potential Broader Impact (NOT in recovery scope)

The deletion-handling gap affects ALL tiers, not just Development. Other tier counts in the regression checks (RC-001 through RC-006) may also be slightly inflated by stale deleted tickets in other tiers. However:

- WS1-A/B/C are already TRUSTED with regression protection — their checks test structural invariants (tier conservation, SLA plausibility ranges), not exact counts
- The stale ticket problem does not invalidate ghost suppression, SLA compliance percentages, or FRT breach detection
- Broader cache integrity is WS3 scope

**This recovery loop addresses only the WS1-D Development count accuracy.**

---

## 4. Recovery Options Analysis

### Option A: Full Re-Sync Only

| Property | Detail |
|----------|--------|
| **Action** | Trigger `fullSync()` and hope that deleted tickets fall out |
| **Will it work?** | **NO.** `fullSync()` uses MERGE (upsert). It never DELETEs rows. Deleted tickets are not returned by the JQL query, so they are simply never touched — they persist as-is. |
| **Verdict** | **REJECTED** — does not address the root cause |

### Option B: Targeted Stale-Entry Cleanup (DELETE known stale keys)

| Property | Detail |
|----------|--------|
| **Action** | DELETE the 47 identified stale ticket rows from `jira_issue_cache` by issue key |
| **Will it work?** | **YES** — immediately fixes the Development count for the known 47 tickets |
| **Limitation** | Point-in-time fix only. New deletions in Jira will re-accumulate stale rows. Does not prevent recurrence. |
| **Risk** | Low — the tickets are confirmed deleted in Jira. Removing them from cache is correct. |
| **Verdict** | **VIABLE as immediate recovery step** |

### Option C: Deletion-Handling Code Path (Reconciliation)

| Property | Detail |
|----------|--------|
| **Action** | Add reconciliation logic to `fullSync()` that compares the set of issue keys returned by Jira against the set of issue keys in `jira_issue_cache`, and removes rows for keys that Jira no longer returns |
| **Will it work?** | **YES** — structurally prevents stale-entry accumulation |
| **Limitation** | Larger code change. Must handle edge cases (pagination, project scope, timing windows). |
| **Risk** | Medium — reconciliation logic touching the cache table needs care. Could inadvertently remove valid tickets if JQL pagination is incomplete. |
| **Verdict** | **VIABLE as permanent fix, but exceeds smallest credible recovery step** |

---

## 5. Manager Decisions

### D-045: First recovery step is targeted stale-entry cleanup (Option B), not code change

**Rationale:** The programme standard is smallest credible recovery step. Option B directly addresses the 47 known stale tickets with a bounded SQL DELETE. Option C (reconciliation code) is the correct permanent fix but is a larger change that belongs in WS3 (SQL integrity) scope, not WS1-D.

**Sequence:**
1. Build Agent executes targeted DELETE of 47 stale keys from `jira_issue_cache`
2. Verify Development count drops to ~231 (±5 for sync timing)
3. Cross-check against live Jira JQL
4. If parity achieved, promote WS1-D forward

### D-046: Post-recovery verification evidence required for WS1-D promotion

To promote WS1-D from UNTRUSTED, the following evidence must be produced after cleanup:

| # | Evidence Required |
|---|-------------------|
| VE-1 | Post-cleanup pipeline Development count (from `jira_issue_cache`) |
| VE-2 | Live Jira JQL count (same query as verification Loop 01) |
| VE-3 | Difference ≤ 5 tickets (sync timing tolerance) |
| VE-4 | Confirmation that the 47 stale rows are no longer present |
| VE-5 | Existing regression checks RC-001 through RC-006 still PASS (no collateral damage) |

If all five evidence items are satisfied, WS1-D may be promoted to **SOURCE DEFINED**.

### D-047: Cache-freshness recovery remains within WS1 scope (not WS3)

**Rationale:** The targeted cleanup is a data correction for a specific WS1-D trust issue. It does not require schema changes, code changes, or broader SQL integrity work. The permanent reconciliation fix (Option C) should be logged as a WS3 input when WS3 is activated, but it does not block WS1-D promotion.

### D-048: Permanent reconciliation fix logged as WS3 input

The structural gap — no deletion handling in `jira-sync-service.ts` — should be addressed in WS3 (SQL and snapshot integrity). This includes:

- Adding reconciliation logic to `fullSync()` to detect and remove rows for tickets no longer in Jira
- Optionally adding a `deleted_at` soft-delete column for audit trail
- Evaluating whether `incrementalSync()` should also check for 404s and mark/remove stale rows

This is explicitly NOT in WS1-D scope. WS1-D is resolved once the targeted cleanup restores count parity.

---

## 6. Gap Classification Update

The WS1-D remainder is classified as:

| Field | Value |
|-------|-------|
| Gap ID | G-017 (NEW) |
| Observable Gap | `jira_issue_cache` contains 47 rows for Jira tickets that have been deleted, inflating the Development count from 231 to 278 |
| Primary Class | **Data defect** — stale cache entries |
| Root Cause | No deletion handling in `jira-sync-service.ts` (fullSync/incrementalSync never DELETE rows) |
| Recovery Action | Targeted DELETE of 47 known stale issue keys |
| Prevention | Reconciliation logic in fullSync (WS3 scope) |

---

## 7. Completion Standard Assessment

| Criterion | Met? |
|-----------|------|
| WS1-D remainder translated into bounded recovery slice | YES — targeted cleanup of 47 stale keys |
| Next build brief ready | YES — `ws1d_build_brief_loop02_cache_recovery.md` |
| Post-recovery verification evidence explicit | YES — VE-1 through VE-5 defined |
| Recovery step decision stated | YES — D-045 (Option B: targeted cleanup) |
| Promotion evidence defined | YES — D-046 |
| Scope boundary maintained | YES — D-047 (WS1), D-048 (WS3 input logged) |

**Loop 10 is COMPLETE.**
