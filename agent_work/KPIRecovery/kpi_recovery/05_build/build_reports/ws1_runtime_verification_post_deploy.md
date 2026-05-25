# WS1 Runtime Verification — Post-Deploy Report

**Date:** 2026-05-20
**Workstream:** WS1 — Source of Truth Validation
**Loop:** Build Loop 04 (Deploy + Runtime Verification)
**Status:** VERIFIED — all three fixes confirmed working at runtime

---

## 1. Deployment Performed

| Step | Status | Evidence |
|------|--------|----------|
| Code changes verified in place | ✅ DONE | `kpi-pipeline.ts` (ccBucket, emission guard), `jira-sync-service.ts` (ALL_FIELDS) |
| TypeScript build (`npm run build`) | ✅ DONE | Clean — no errors |
| Git commit | ✅ DONE | `fecb02c` — "fix(kpi): ghost suppression, FRT field acquisition, CC null handling" |
| Push to GitHub (`origin`) | ✅ DONE | `nova-codex` branch |
| Push to Azure DevOps (`azdo`) | ✅ DONE | `nova-codex` branch |
| Server restart / deploy | ✅ DONE | Nick triggered deploy. Old PID 114036 → new PID 281924. |

---

## 2. Restart / Sync Evidence

| Evidence | Result |
|----------|--------|
| Old NOVA PID (114036) | Gone — process no longer exists |
| New NOVA PID | 281924, listening on port 3069 |
| fullSync completion | Confirmed — tier volumes stabilised across multiple snapshot cycles |
| Snapshot cycles observed | At least 2 post-deploy snapshots (90s startup trigger + 10-min timer) |

---

## 3. Snapshot-Cycle Evidence

| Timestamp | FRT Compliance | CC (Incidents) | Customer Care (ghost) | Notes |
|-----------|---------------|----------------|----------------------|-------|
| Pre-deploy (today) | 100% | ~30 | 66 | Old code, pre-deploy snapshot |
| +2 min post-deploy | 68% | 89 | 66 (stale) | Partial sync — 90s startup snapshot fired before fullSync completed |
| +20 min post-deploy | 68% | 91 | 66 (stale) | Full sync complete, multiple cycles run |

The FRT value changed dramatically (100→68) confirming new code is running. CC (Incidents) jumped from 30→91 confirming ccBucket null handling fix. Ghost values are frozen (stale rows, see Section 4).

---

## 4. Ghost KPI Verification (WS1-A) — ✅ CONFIRMED WORKING

### Emission Guard: WORKING

The emission guard `if (!ALL_TIERS.includes(tier)) continue;` is confirmed active. Evidence:

| Check | Pre-Deploy | Post-Deploy | Status |
|-------|-----------|-------------|--------|
| Governed tiers sum | N/A | **531** | Matches Open Tickets minus 10 Unclassified |
| Open Tickets | 543 (pre) | **541** | Minor organic change |
| Governed sum + Unclassified | N/A | 531 + 10 = **541** | **Exact match** — no ghost tiers in active output |
| Ghost rows updated? | N/A | **No** — values frozen at pre-deploy levels | Guard prevents MERGE from writing ghost rows |

### Why 14 Ghost Rows Still Exist in Today's Data

The MERGE upsert matches on `(date, kpi_name)`. When the new code stops emitting a KPI, the MERGE has nothing to match — the old row persists untouched. These 14 ghost rows are artifacts from the pre-deploy snapshot that ran earlier today. They are **stale, frozen data**.

**Tomorrow's first snapshot will NOT create these rows.** The ghost rows will naturally not exist for May 21.

### CC Reclassification (ccBucket fix): WORKING

| Metric | May 19 (pre-fix) | May 20 (post-fix) | Change |
|--------|-----------------|-------------------|--------|
| CC (Incidents) | 30 | **91** | +61 — null-RT tickets migrated |
| CC (Service Requests) | 35 | **41** | +6 organic |
| CC (TPJ) | 22 | **19** | -3 organic |
| CC governed subtotal | 87 | **151** | +64 — real CC ticket visibility restored |

### Historical Context: Ghost Regression

| Date | CC (Incidents) | Customer Care (ghost) |
|------|---------------|----------------------|
| May 17 | 57 | 0 |
| May 18 | 58 | 0 |
| May 19 | 30 | 69 ← **ghost appeared** |
| May 20 | 91 | 66 (stale) ← **fix deployed** |

The Customer Care ghost first appeared on May 19 (correlating with CC Incidents dropping from 58→30). Our fix corrected the regression.

### Cleanup Recommendation

To remove the 14 stale ghost rows from today's data:

```sql
DELETE FROM jira_kpi_daily
WHERE CAST(createdAt AS DATE) = CAST(GETUTCDATE() AS DATE)
  AND (kpi LIKE '%Customer Care%' OR kpi LIKE '%Unclassified%')
```

This is optional — rows will naturally not be recreated tomorrow.

---

## 5. Resolution SLA Stability (WS1-B) — ✅ CONFIRMED STABLE

| Metric | Pre-Deploy | Post-Deploy | Status |
|--------|-----------|-------------|--------|
| Resolution Compliance % (Open Queue) | 82% | **81%** | ✅ Stable (minor organic drift) |
| Resolution Compliance % (Resolved Today) | — | **88%** | ✅ Normal |
| SLA Breached | 99 | **101** | ✅ Stable (organic) |
| Resolution Breaches (Resolved Today) | — | **2** | ✅ Normal |

No code changes touched Resolution SLA. Stability confirmed.

---

## 6. FRT Runtime Verification (WS1-C) — ✅ CONFIRMED RECOVERED

| Metric | Pre-Deploy | Post-Deploy | Simulation Predicted | Status |
|--------|-----------|-------------|---------------------|--------|
| FRT Compliance % (Open Queue) | 100% | **68%** | ~72.3% | ✅ Real value, consistent with simulation |
| FRT Compliance % (Resolved Today) | 100% | **59%** | — | ✅ Real value |
| FRT Breaches (Resolved Today) | 0 | **7** | — | ✅ Non-zero |

### Per-Tier FRT Breaches (Post-Deploy)

| Tier | Actionable | Not Actionable | Status |
|------|-----------|----------------|--------|
| Development | **29** | **10** | ✅ Highest as expected (30-min FRT goal) |
| Tier 2 | **17** | **0** | ✅ Non-zero |
| CC Service Requests | **7** | **2** | ✅ Non-zero |
| CC (TPJ) | **5** | **0** | ✅ Non-zero |
| Tier 3 | **4** | **1** | ✅ Non-zero |
| CC Incidents | **2** | **1** | ✅ Non-zero |
| Production | **1** | **1** | ✅ Non-zero |

All governed tiers show real FRT breach data. Development has the most breaches (consistent with 30-minute FRT goal and escalation patterns).

### WS1-C Trust State: **SOURCE DEFINED**

All promotion criteria from Manager Decision MD-C (Loop 04 brief) are met:
1. ✅ Code deployed (server restarted, fullSync completed)
2. ✅ `customfield_14046` present in cache (FRT data flowing)
3. ✅ FRT Compliance % (Open Queue) is no longer 100% (now 68%)
4. ✅ Per-tier FRT breach counts are non-zero for 7/7 governed tiers

---

## 7. Unexpected Findings

1. **Ghost rows persist as MERGE artifacts.** The `jira_kpi_daily` MERGE upsert cannot delete rows that the code no longer emits. This is a design limitation, not a bug. Consider adding a pre-snapshot cleanup step: `DELETE FROM jira_kpi_daily WHERE CAST(createdAt AS DATE) = @today AND kpi LIKE '%Customer Care%' OR kpi LIKE '%Unclassified%'` — or more robustly, delete all rows for today before inserting the fresh snapshot.

2. **Customer Care ghost was a May 19 regression.** The ghost tier first appeared on May 19, not earlier. CC (Incidents) simultaneously dropped from 58→30. This correlates with recent KPI pipeline commits that may have introduced a ccBucket regression.

3. **10 Unclassified tickets are genuinely unclassified.** These have `current_tier = NULL` in Jira (not Customer Care). They correctly get tier 'Unclassified' from `classifyTier()` and are correctly suppressed from KPI emission by the guard. The 10-ticket gap between governed sum (531) and Open Tickets (541) is accounted for.

4. **90-second startup snapshot fires before fullSync.** The `setTimeout(() => collectJiraSnapshot(), 90_000)` fires 90 seconds after server start, but fullSync takes ~5 minutes. The first snapshot uses partially-synced cache data. Consider delaying the startup snapshot or gating it on sync completion.

---

## 8. Verification Status Summary

| Sub-Slice | Code Verified | Deployed | Runtime Verified | Trust State |
|-----------|--------------|----------|-----------------|-------------|
| WS1-A: Ghost suppression | ✅ | ✅ | ✅ Emission guard working, ghost rows stale | **VERIFIED** |
| WS1-B: Resolution SLA | ✅ | ✅ | ✅ 81% stable, no regression | **SOURCE DEFINED** |
| WS1-C: FRT recovery | ✅ | ✅ | ✅ 68% compliance, all tiers show breaches | **SOURCE DEFINED** |
| WS1-D: Dev backlog | N/A | N/A | N/A | BLOCKED (HDR-1) |

---

## 9. Next Steps

1. **Optional:** Clean up 14 stale ghost rows from today with DELETE query
2. **Execute** `ws1_ab_evaluator_brief_v1.md` — WS1-A + WS1-B are ready for formal evaluation
3. **Create** WS1-C evaluation addendum with observed FRT values (68% compliance, per-tier breaches)
4. **Monitor** tomorrow's first snapshot to confirm ghost rows are not recreated (expected: clean)
5. **Deferred:** WS1-D (Development backlog) — still blocked by HDR-1
