# WS1 Build Loop 03 — FRT Field Inclusion + Verification

**Date:** 2026-05-20
**Workstream:** WS1 — Source of Truth Validation
**Loop:** Build Loop 03
**Manager Brief Reference:** `ws1_manager_brief_loop03.md`
**Decision References:** D-013 (MD-C)

---

## Objective

Add `customfield_14046` (First Reply Time SLA) to the Jira sync field list so that FRT data populates `fields_json` in `jira_issue_cache`. Then verify FRT metrics begin producing real values.

This build does NOT:
- change FRT KPI calculation formulas
- change the denominator methodology
- touch Development backlog logic
- touch Resolution SLA logic (already verified)
- create regression baselines or holdouts

---

## Background

Build Loop 02 discovered that `customfield_14046` IS returned by the Jira REST API when explicitly requested. It was absent from cached data solely because the field is not listed in the `ALL_FIELDS` array in `jira-sync-service.ts`.

Service Desk API confirmation:
- SLA ID 76 = "First Reply Time" → `customfield_14046`
- SLA ID 78 = "Resolution" → `customfield_14048` (already working)

The existing `isSlaBreached()` parser handles the same structure for both fields.

---

## Step 1: Add `customfield_14046` to `ALL_FIELDS`

**File:** `src/server/services/jira-sync-service.ts`
**Location:** `ALL_FIELDS` array (lines 19-42)

Add:
```typescript
'customfield_14046', // First Reply Time SLA
```

Place it adjacent to `customfield_14048` for clarity.

### Optional Housekeeping

Consider removing `customfield_10010` from `ALL_FIELDS` if present, since it is confirmed dead (not returned by REST API, `sla_breached` column always false). This is not recovery-critical but reduces noise.

If `customfield_10010` is removed:
- The `sla_breached` and `sla_breach_time` columns in `jira_issue_cache` will stop being populated (they already contain no useful data)
- No KPI logic depends on these columns
- This is safe but optional — do not block the FRT fix on this decision

---

## Step 2: Trigger Full Re-Sync

After deploying the field addition, a full re-sync is needed to populate `fields_json` with `customfield_14046` for existing tickets.

Options (in order of preference):
1. **Restart the server** — `JiraSyncService.fullSync()` runs on startup, which will re-fetch all issues with the updated field list
2. **Wait for natural incremental sync** — will only update tickets modified since last sync; older tickets won't get FRT data until they're next updated in Jira
3. **Call the sync API endpoint** — if one exists, trigger a manual full sync

**Recommended:** Option 1 (restart). A full sync is needed because FRT data must be present for ALL open tickets, not just recently updated ones. Incremental sync would leave a data gap.

---

## Step 3: Verify FRT Data Presence

After full re-sync completes, verify that `customfield_14046` is now present in `fields_json`.

### Verification Query

```sql
SELECT TOP 10
  issue_key,
  JSON_VALUE(fields_json, '$.customfield_14046.name') AS frt_name,
  JSON_VALUE(fields_json, '$.customfield_14046.ongoingCycle.breached') AS frt_ongoing_breached
FROM jira_issue_cache
WHERE status_category != 'Done'
  AND project = 'NT'
ORDER BY jira_updated DESC
```

**Expected:** `frt_name` should be "First Reply Time" for NT project tickets. Some tickets may have `null` if they genuinely lack FRT SLA (check against NTPJ/YO pattern from Resolution SLA — those projects may also lack FRT config).

### Absence Pattern Check

```sql
SELECT
  project,
  COUNT(*) AS total,
  SUM(CASE WHEN JSON_VALUE(fields_json, '$.customfield_14046') IS NOT NULL THEN 1 ELSE 0 END) AS has_frt,
  SUM(CASE WHEN JSON_VALUE(fields_json, '$.customfield_14046') IS NULL THEN 1 ELSE 0 END) AS missing_frt
FROM jira_issue_cache
WHERE status_category != 'Done'
GROUP BY project
```

**Expected:** NT tickets should mostly have FRT. NTPJ/YO may lack it (same pattern as Resolution SLA).

---

## Step 4: Verify Parser Compatibility

Sample 5 tickets with known FRT breaches and confirm `isSlaBreached()` returns `true`.

### Diagnostic Approach

```javascript
// For a sampled ticket:
const frt = parseSlaField(fieldsJson, 'customfield_14046');
const breached = isSlaBreached(frt);
console.log({ frt_present: frt !== null, breached });
```

**Expected:** The structure should match Resolution SLA (`completedCycles`, `ongoingCycle`, `breached`, `remainingTime.millis`). The parser is already proven for this structure via the Resolution SLA cross-check.

---

## Step 5: Verify KPI Output

After one `collectJiraSnapshot()` run with populated FRT data:

1. **FRT Compliance % (Open Queue)** should no longer be 100% (was defaulting due to `totalFrtChecked === 0`)
2. **FRT Compliance % (Resolved Today)** should reflect real resolved-today FRT data
3. **Per-tier FRT breach counts** should no longer be 0 for all tiers
4. **FRT Breaches (Resolved Today)** should reflect real data

### Verification Query

```sql
SELECT kpi, count
FROM jira_kpi_daily
WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
  AND kpi LIKE '%FRT%'
ORDER BY kpi
```

**Expected:** FRT Compliance % should be < 100% for at least one metric. Per-tier FRT breach counts should be > 0 for at least some tiers.

---

## Step 6: Cross-Check Against Resolution SLA Pattern

Compare the FRT absence/presence pattern against the already-verified Resolution SLA pattern:

| Metric | Resolution SLA (known) | FRT SLA (expected) |
|--------|----------------------|-------------------|
| NT presence | ~100% | ~100% (same SLA project) |
| NTPJ presence | ~0% | ~0% (likely same) |
| YO presence | ~0% | ~0% (likely same) |
| Parser compatible | ✓ | Expected ✓ |

If the patterns diverge significantly, document the discrepancy before proceeding.

---

## Build Report Requirements

At completion, produce:
`agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop03_frt.md`

Include:
- Field addition confirmed (line reference)
- Re-sync method and completion
- FRT data presence verification (sample + project breakdown)
- Parser compatibility confirmation
- KPI output verification (FRT Compliance %, per-tier counts)
- Cross-check against Resolution SLA pattern
- Any unexpected findings
- Whether FRT is now ready for evaluation addendum

---

## Scope Boundary

This build is complete when:
- `customfield_14046` is in `ALL_FIELDS`
- A full re-sync has populated the field in `fields_json`
- FRT data presence is verified
- Parser compatibility is confirmed
- At least one KPI snapshot run shows non-trivial FRT values

Do not proceed to:
- FRT formula changes (not expected to be needed)
- Development count changes (blocked by HDR-1)
- Regression baseline creation (premature)
- Evaluator brief updates (manager responsibility, not build)
