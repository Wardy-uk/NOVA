# G-014 Wallboard Cache Refresh — Build Report Loop 01

**Date:** 2026-05-21
**Status:** Implementation complete, awaiting runtime verification

---

## 1. File(s) Changed

| File | Lines affected |
|------|---------------|
| `src/server/services/wallboard-live-cache.ts` | Lines 60–67 (replaced with single-line function) |

No other files were modified. No data model, KPI logic, wallboard presentation, or breach-board changes.

## 2. Exact Logic Changed

**Before** — `shouldRefresh()` blocked all cache refreshes outside Mon–Fri 09:00–17:30:

```typescript
function shouldRefresh(): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;   // blocked weekends
  const h = now.getHours();
  const m = now.getMinutes();
  return (h > 9 || (h === 9 && m >= 0)) && (h < 17 || (h === 17 && m <= 30));  // blocked outside 09:00–17:30
}
```

**After** — `shouldRefresh()` always returns `true`:

```typescript
function shouldRefresh(): boolean {
  return true;
}
```

The call site in `refreshAll()` is unchanged — `if (!force && !shouldRefresh()) return;` — but the guard now never blocks.

## 3. Was the Restriction Removed or Widened?

**Removed entirely.** The wallboard live cache now refreshes on the same 5-minute cadence 24/7/365. This matches the behaviour of the standard wallboards (Tech Support, SLA Breach) which have no time gating.

The `isCacheStale()` 3-day forced-refresh fallback remains in place but is now effectively redundant since normal refreshes will always fire. It was left in as a harmless safety net.

## 4. Verification Performed

- **Type check:** `npx tsc --noEmit` passes with zero errors after the change.
- **Code review:** Confirmed `shouldRefresh()` is only called from `refreshAll()` at line 76. No other callers exist in the codebase.
- **Scope check:** No changes to `classifyQueue()`, `isKeyAccount()`, `emptySnapshot()`, the SQL query, or the cache data structure. The fix is purely a timing/scheduling change.

## 5. Deploy / Runtime Verification Needed

After next deploy:

1. **Check logs** for `[wallboard-live-cache] refreshed` entries appearing outside business hours (evenings/weekends).
2. **Load Key Accounts wallboard** outside 09:00–17:30 — `updatedAt` timestamp should be within the last 5 minutes.
3. **Load Customer Success wallboard** — same check.
4. **Confirm no increase in DB load** — the query hits `jira_issue_cache` which is already indexed and lightweight. The additional ~14 hours/day of refreshes (nights + weekends) should have negligible impact at 5-minute intervals.

## 6. Verdict

**G-014 is ready for runtime verification.** The fix is minimal (7 lines replaced with 1), type-checks clean, and changes only *when* the cache refreshes — not *what* it caches. The next step is a deploy and observation of after-hours refresh behaviour.
