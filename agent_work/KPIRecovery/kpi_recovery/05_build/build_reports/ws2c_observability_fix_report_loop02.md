# WS2-C-FIX-01: Derived KPI Observability Fix — Loop 02 Report

**Date:** 2026-05-21  
**Scope:** Remove silent failure swallowing, add diagnostic logging, add manual trigger  
**Status:** COMPLETE — code compiles, ready for runtime verification

---

## 1. Silent Failure Path Changed

**File:** `src/server/index.ts:1524` (now 1524 in current state)

**Before:**
```typescript
kpiPipeline.collectDerivedKpis().catch(() => {});
```

**After:**
```typescript
kpiPipeline.collectDerivedKpis().catch(err => console.error('[kpi-pipeline] Derived KPIs startup failed:', err instanceof Error ? err.message : err));
```

The startup call (120s after boot) now logs any error instead of swallowing it. The scheduled path (17:30 weekdays) already had error visibility via the job registry — no change needed there.

Note: the inner `catch` at `kpi-pipeline.ts:859` already logs `'[kpi-pipeline] Derived KPIs failed: ...'` and writes to `pipeline_monitor_runs`. The startup `.catch(() => {})` was the only path that made errors invisible.

---

## 2. Diagnostic Logging Added

**File:** `src/server/services/kpi-pipeline.ts` — inside `collectDerivedKpis()`

Four new `console.log` lines added at key checkpoints:

| Checkpoint | Log message | Purpose |
|------------|------------|---------|
| Method entry | `Derived KPIs: starting collection for {date}` | Confirms execution started and which date is being computed |
| After resolved-today query | `Derived KPIs: {N} resolved-today tickets found ({M} CC-tier), 1st Line Rate = {X}%` | Shows whether data exists, what the CC split looks like |
| After CSAT scan | `Derived KPIs: CSAT — {N} rated tickets from {M} resolved, derived {X}%` | Exposes whether CSAT field data is present |
| After comment loop | `Derived KPIs: comments fetched for {N}/{M} tickets — FCR {a}/{b} ({X}%), Bug Ack samples: {N}, avg {X}h` | Shows comment-fetch success rate, FCR/Bug Ack intermediate values |

The existing per-ticket `console.warn` for comment-fetch failures (line ~815) was already present and adequate — no change needed.

The existing success log `Derived KPIs written: {N} metrics` (line ~852) remains unchanged.

---

## 3. Manual Trigger Route

**File:** `src/server/index.ts` — inline route after kpiPipeline instantiation

**Endpoint:** `POST /api/kpi/derived/run`  
**Auth:** `requireRole('admin')` — admin-only  
**Behaviour:** Calls `kpiPipeline.collectDerivedKpis()` synchronously, returns success/failure with duration.

**Success response:**
```json
{ "ok": true, "data": { "message": "Derived KPIs collected", "duration_ms": 8432 } }
```

**Error response:**
```json
{ "ok": false, "error": "getKpiPool: MSSQL connection failed" }
```

**Usage:** `curl -X POST http://localhost:3001/api/kpi/derived/run -H "Authorization: Bearer <token>"`

Logs `[kpi-pipeline] Manual derived KPI run triggered` at invocation and `[kpi-pipeline] Manual derived KPI run failed: ...` on error.

---

## 4. Compilation

TypeScript `tsc --noEmit` passes with zero errors.

---

## 5. Runtime Verification Checklist

The following should be checked with a running server:

- [ ] **Startup logging:** Restart server, wait 120s, check console for `[kpi-pipeline] Derived KPIs: starting collection for ...` — confirms the method runs and logs
- [ ] **Startup error visibility:** If MSSQL pool isn't ready at 120s, console should show `[kpi-pipeline] Derived KPIs startup failed: ...` instead of silence
- [ ] **Manual trigger:** `POST /api/kpi/derived/run` with admin token returns `{ ok: true }` and console shows all 4 diagnostic lines
- [ ] **Data written:** After manual trigger, query `SELECT * FROM jira_kpi_daily WHERE kpiGroup = 'Derived' AND CAST(CreatedAt AS DATE) = CAST(GETUTCDATE() AS DATE)` — should show 4 rows
- [ ] **Diagnostic values sensible:** Check that resolved-today count is non-zero (if run during business hours), and that FCR/CSAT/Bug Ack intermediate values match expectations

---

## Files Changed

| File | Change |
|------|--------|
| `src/server/index.ts` | Replaced `.catch(() => {})` with error-logging catch; added `POST /api/kpi/derived/run` route |
| `src/server/services/kpi-pipeline.ts` | Added 4 diagnostic `console.log` lines inside `collectDerivedKpis()` |

No calculation logic was changed. No schedules were changed. No new dependencies.
