# WS2-A Build Report: Escalation Pipeline Fix — Loop 02

**Date:** 2026-05-21  
**Status:** FIX APPLIED — awaiting deploy + runtime verification  
**KF Reference:** KF-011

---

## 1. What Changed

### Change 1: Automatic tier-change detection in Jira sync

**File:** `src/server/services/jira-sync-service.ts`  
**Location:** `upsertIssue()`, after the MERGE statement

The `oldRow` query (pre-MERGE) was expanded to also fetch `current_tier` from the cache. After the MERGE writes the new tier value, a comparison detects whether the tier changed. If it did (and both old and new are non-null), a new `escalation_log` row is inserted with:

| Field | Value |
|-------|-------|
| `ticket_key` | The Jira issue key |
| `escalation_type` | `'jira_transition'` |
| `from_tier` | Previous `current_tier` from cache |
| `to_tier` | New `current_tier` from Jira field `customfield_12981` |
| `escalated_by` | Current assignee display name (or `'system'`) |
| `notes` | `Tier change: {old} → {new}` |
| `source` | `'jira_sync'` |
| `created_at` | `GETUTCDATE()` |

**Deduplication:** The INSERT uses a `WHERE NOT EXISTS` guard — it won't create a duplicate if the same `ticket_key + from_tier + to_tier + source='jira_sync'` combination was logged within the last 5 minutes. This prevents double-logging during rapid sync cycles.

**Failure isolation:** Wrapped in try/catch with a `console.warn`. A failed escalation log insert will not break the sync cycle.

**New tickets:** When a ticket is first synced (no `oldRow`), no escalation is logged — that's initial state, not a transition.

### Change 2: Bidirectional recording in backfill

**File:** `src/server/services/escalation-log-service.ts`  
**Location:** `backfillFromChangelog()`, lines 172-175

**Removed:** The upward-only filter:

```typescript
// REMOVED:
const tierRank: Record<string, number> = { T1: 1, T2: 2, T3: 3, Dev: 4 };
if ((tierRank[toTier] ?? 0) <= (tierRank[fromTier] ?? 0)) continue;
```

**Effect:** `backfillFromChangelog()` now records ALL tier changes — both upward (escalations) and downward (rejections). The existing deduplication check (same ticket + from/to + within 5 minutes) is preserved.

The `escalation_type` for backfill entries remains `'jira_transition'` and source remains `'jira_backfill'`, which is consistent with the sync-based entries.

---

## 2. Tier Vocabulary Compatibility

The sync-based path writes raw `customfield_12981` values directly (e.g. `"Tier 2"`, `"Tier 3"`, `"Development"`).

The backfill path writes abbreviated forms from `TIER_PATTERNS` (e.g. `"T2"`, `"T3"`, `"Dev"`).

The KPI queries in `collectEscalationKpis()` already match both forms:

| KPI | Query matches |
|-----|--------------|
| Escalated to Tier 2 | `to_tier IN ('T2', 'Tier 2')` |
| Escalated to Tier 3 | `to_tier IN ('T3', 'Tier 3')` |
| Escalated to Development | `to_tier IN ('Dev', 'Development')` |
| Rejected by Tier 2 | `from_tier IN ('T2', 'Tier 2') AND to_tier IN ('T1', 'Customer Care')` |
| Rejected by Tier 3 | `from_tier IN ('T3', 'Tier 3') AND to_tier IN ('T2', 'Tier 2', 'T1', 'Customer Care')` |
| Rejected by Development | `from_tier IN ('Dev', 'Development') AND to_tier IN ('T3', 'Tier 3', 'T2', 'Tier 2')` |

**No vocabulary mismatch.** Both paths produce values that the KPI queries already handle.

---

## 3. Backfill Behaviour

The backfill endpoint (`POST /api/escalations/backfill`) now records bidirectional tier changes. It can be used to populate historical data for tickets that changed tier before the sync-based detection was deployed.

**Recommendation:** After deploy, run a one-time backfill for the past 90 days to populate historical escalation/rejection data for Trends and historical comparisons.

---

## 4. Compilation

TypeScript compiles cleanly (`npx tsc --noEmit` — zero errors, zero warnings).

---

## 5. Runtime Verification Checklist

After deploy, verify the following:

### Immediate (within 1 sync cycle = 45 seconds)

- [ ] `jira-sync` logs show no new errors related to escalation logging
- [ ] `SELECT TOP 10 * FROM escalation_log WHERE source = 'jira_sync' ORDER BY created_at DESC` returns rows (if any tier changes occurred during the verification window)

### After 1 business day

- [ ] `SELECT COUNT(*) FROM escalation_log WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE)` returns non-zero
- [ ] KPI Dashboard shows non-zero values for "Tickets escalated to Tier 2/3/Development"
- [ ] Check for rejection entries: `SELECT * FROM escalation_log WHERE source = 'jira_sync' AND to_tier IN ('T1', 'Tier 1', 'Customer Care') ORDER BY created_at DESC`
- [ ] Escalation Accuracy % is no longer stuck at 100% (if any rejections occurred)

### After historical backfill

- [ ] Trigger: `POST /api/escalations/backfill` with a 90-day date range
- [ ] Verify: `SELECT CAST(created_at AS DATE) as d, COUNT(*) as cnt FROM escalation_log GROUP BY CAST(created_at AS DATE) ORDER BY d DESC` shows historical distribution
- [ ] Verify: downward tier changes are present: `SELECT * FROM escalation_log WHERE to_tier IN ('T1', 'T2', 'Tier 1', 'Tier 2', 'Customer Care') AND from_tier IN ('T2', 'T3', 'Tier 2', 'Tier 3', 'Dev', 'Development') LIMIT 10`

---

## 6. Files Modified

| File | Change |
|------|--------|
| `src/server/services/jira-sync-service.ts` | Added `current_tier` to pre-MERGE query; added tier-change detection + escalation_log insert after MERGE |
| `src/server/services/escalation-log-service.ts` | Removed upward-only filter in `backfillFromChangelog()` |

No schema changes. No new dependencies. No constructor signature changes.

---

## 7. What This Does NOT Fix

- **CSAT %** (KF-010) — separate defect, out of scope
- **Historical gaps** — the sync-based detection only captures changes going forward. Historical data requires running the backfill endpoint.
- **Tier changes via Jira status transitions that don't update `customfield_12981`** — if a ticket's status changes but the custom field isn't updated, the sync won't detect it. The backfill path (which reads Jira changelog status transitions) covers this case.
