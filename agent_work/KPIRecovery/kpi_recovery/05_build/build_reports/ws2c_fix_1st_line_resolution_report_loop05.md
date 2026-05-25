# WS2-C-FIX-02: 1st Line Resolution Rate % Formula Correction — Loop 05

**Date:** 2026-05-21  
**File changed:** `src/server/services/kpi-pipeline.ts`  
**Scope:** Single formula correction within `collectDerivedKpis()`  
**Status:** IMPLEMENTED — compiles clean

---

## 1. What Changed

### Before (request-type based — wrong)

```typescript
const ccResolved = resolvedRows.filter(r =>
  ccRequestTypes.includes((r.request_type || '').toLowerCase())
).length;
const firstLineRate = totalResolved > 0
  ? Math.round((ccResolved / totalResolved) * 100) : 0;
```

This measured **what percentage of resolved tickets had CC request types** — a request-type composition metric, not a resolution metric. A ticket escalated to Tier 3 but originally filed as an "incident" still counted as "1st line resolved".

### After (tier-based — correct)

```typescript
const firstLineResolved = resolvedRows.filter(r =>
  classifyTier(r.current_tier) === 'Customer Care'
).length;
const firstLineRate = totalResolved > 0
  ? Math.round((firstLineResolved / totalResolved) * 100) : 0;
```

This measures **what percentage of resolved tickets were still at Customer Care tier when resolved** — a genuine 1st-line resolution rate. A ticket that escalated to Tier 2+ before resolution is correctly excluded from the numerator.

### Why the new formula is correct

- `current_tier` tracks the Jira "Current Tier" field (`customfield_14046` mapped via `jira-sync-service.ts`), which reflects the tier the ticket is at when resolved
- `classifyTier()` normalises the raw field to one of: Customer Care, Production, Tier 2, Tier 3, Development, Unclassified (defined in `TIER_MAP` at line 86–92)
- A ticket resolved at `Customer Care` tier was handled by the first line without escalation — this IS the definition of 1st-line resolution
- The `current_tier` field was already SELECTed in the query but unused; no schema or query change needed

### Diagnostic log updated

```
Before: "X resolved-today tickets found (Y CC-tier), 1st Line Rate = Z%"
After:  "X resolved-today tickets found (Y resolved at Customer Care tier), 1st Line Rate = Z%"
```

---

## 2. What Did NOT Change

| Item | Status |
|------|--------|
| SQL query | Unchanged — already selects `current_tier` |
| `ccRequestTypes` array | Kept — still used by FCR calculation at line 798 |
| Denominator | Unchanged — all resolved-today (excl. onboarding) |
| MERGE write to `jira_kpi_daily` | Unchanged |
| Target (60) and direction | Unchanged |
| FCR Rate % | Untouched |
| Bug Escalation-to-Ack | Untouched |
| CSAT % (Derived) | Untouched |
| Schedule / trigger | Untouched |

---

## 3. Compilation

```
npx tsc --noEmit → clean (no output, exit 0)
```

No new type errors introduced. The change uses `classifyTier()` which is already defined and used elsewhere in the same file (line 371).

---

## 4. Expected Value Change

### Previous runtime value (loop 03)

`1st Line Resolution Rate % = 43` — this was CC request-type share of resolved-today.

### Expected new value after deploy

The new value will likely be **different** (possibly higher or lower) because:
- Some CC-type tickets escalate beyond Customer Care → these will be **excluded** from the numerator (lowering the rate)
- Some non-CC-type tickets may be resolved at Customer Care tier → these will be **included** (raising the rate)
- Tickets with `current_tier = NULL` (Unclassified) will be excluded from the numerator

The exact new value depends on the day's resolution mix. The value being different is the correct outcome — it now measures what it claims to measure.

---

## 5. Deploy & Runtime Verification Checklist

After deploying to prod:

- [ ] **Trigger manually:** `POST /api/kpi/derived/run` (admin auth)
- [ ] **Check response:** should return `{"ok":true,"data":{"message":"Derived KPIs collected","duration_ms":...}}`
- [ ] **Query daily history:** `GET /api/kpi-data/daily-history?days=1` — find `1st Line Resolution Rate %`
- [ ] **Verify non-zero:** value should be a sensible percentage (likely 20–80% range)
- [ ] **Check diagnostic log:** look for `"X resolved-today tickets found (Y resolved at Customer Care tier)"` — confirms the new code path ran
- [ ] **Compare to yesterday:** if yesterday's value was 43 (CC-share), today's value being different confirms the formula change took effect
- [ ] **Spot-check:** pick 2–3 resolved-today tickets from Jira, verify their `current_tier` matches whether they'd be counted

---

## 6. Known Remaining Defect (Out of Scope)

The `jira_updated` date filter (line 743) still uses update-date rather than resolution-date. This is a shared defect with the Solved Today metric (P0 audit finding #3) and should be addressed as a cross-cutting fix, not within this slice.

---

## Completion Checklist

- [x] Formula changed from request-type to tier-based classification
- [x] New formula correctly matches intended business meaning of "1st line resolution"
- [x] `classifyTier()` reused — no new functions or dependencies
- [x] `ccRequestTypes` retained for downstream FCR use
- [x] Code compiles clean (`tsc --noEmit` passed)
- [x] Diagnostic log message updated to reflect new logic
- [x] Deploy verification steps documented
