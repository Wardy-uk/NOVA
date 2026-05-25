# WS1 Build Loop 02 — Implementation Brief

**Date:** 2026-05-20
**Workstream:** WS1 — Source of Truth Validation
**Loop:** Build Loop 02
**Manager Brief Reference:** `ws1_manager_brief_loop02.md`
**Decision References:** D-008, D-009, D-011

---

## Objective

Execute two bounded tracks that advance the P0 KPI recovery without depending on unresolved human decisions.

This build does NOT:
- discover or guess the FRT field ID
- change the Development backlog count logic
- touch CSAT, escalation, or agent-level KPIs
- create evaluation holdouts or regression packs

---

## Track 1: CC Null Handling + Ghost KPI Suppression

**Priority:** HIGH — unblocks ghost KPI fix
**File:** `src/server/services/kpi-pipeline.ts`
**Dependencies:** None — can proceed immediately

### Step 1: Update `ccBucket()` (lines 100-106)

Current:
```typescript
function ccBucket(requestType: string | null): string | null {
  const rt = (requestType || '').toLowerCase();
  if (['incident', 'chat', 'ai request', 'emailed request', 'gdpr'].includes(rt)) return 'CC (Incidents)';
  if (rt === 'service request') return 'CC (Service Requests)';
  if (rt === 'tpj request') return 'CC (TPJ)';
  return null;
}
```

Required change:
```typescript
function ccBucket(requestType: string | null): string {
  const rt = (requestType || '').toLowerCase();
  if (['incident', 'chat', 'ai request', 'emailed request', 'gdpr'].includes(rt)) return 'CC (Incidents)';
  if (rt === 'service request') return 'CC (Service Requests)';
  if (rt === 'tpj request') return 'CC (TPJ)';
  return 'CC (Incidents)';
}
```

Changes:
- Return type changes from `string | null` to `string`
- Default return changes from `null` to `'CC (Incidents)'`
- This handles: null request_type (688 tickets), "Support Request" (1), "Technical Projects" (1), and any future unmapped types

### Step 2: Update `classifyTier()` / `parseTicket()` if needed

Check whether the `ccBucket()` caller in `parseTicket()` (line 372) handles the return correctly now that it never returns null:

```typescript
const ccTier = rawTier === 'Customer Care' ? ccBucket(t.request_type) : null;
const tier = ccTier ?? rawTier;
```

Since `ccBucket()` now always returns a string, `ccTier` will always be a non-null string when `rawTier === 'Customer Care'`. The `??` fallback to `rawTier` will never trigger for CC tickets. This is correct behaviour — no change needed here.

### Step 3: Tighten emission guard (line 496)

Current:
```typescript
if (stats.volume === 0 && !ALL_TIERS.includes(tier)) continue;
```

Required change:
```typescript
if (!ALL_TIERS.includes(tier)) continue;
```

This suppresses ALL non-governed tiers unconditionally. With Step 1 complete, no legitimate tickets should be classified under non-governed tiers.

### Verification Criteria

After both changes:

1. **No ghost KPIs emitted:** Query `jira_kpi_daily` after next snapshot — no rows with KPI names containing "Customer Care" or "Unclassified" as a tier
2. **CC (Incidents) volume increases:** Should increase by ~688 compared to pre-fix run (absorbing formerly null-RT tickets)
3. **Total CC ticket coverage:** Sum of CC (Incidents) + CC (Service Requests) + CC (TPJ) volumes should equal total open CC-tier tickets (currently 814)
4. **No tier dropped:** All 7 tiers in `ALL_TIERS` should still emit KPIs (even if volume is 0 — the `ALL_TIERS` initialisation at line 401-403 ensures this)

### What NOT To Do

- Do not change `ALL_TIERS` — the 7 governed tiers are correct
- Do not add logging for "tickets dropped by emission guard" — with the guard tightened, any dropped tier is by design
- Do not change `classifyTier()` — the raw tier classification is correct; the issue was only in `ccBucket()` null handling

---

## Track 2: Resolution SLA Verification

**Priority:** MEDIUM — advances Resolution SLA toward SOURCE DEFINED trust state
**Files:** `src/server/services/kpi-pipeline.ts` (read-only verification), diagnostic script
**Dependencies:** None — can proceed immediately

### Step 1: Sample Verification

For 5-10 open tickets with known Resolution SLA breaches:

1. Query `jira_issue_cache` for tickets where `customfield_14048` in `fields_json` shows breach
2. Cross-check against Jira (either via Jira REST API or Jira UI) — confirm the same tickets show as Resolution SLA breached in Jira
3. Document any discrepancies

### Step 2: Absence Analysis

For the 72/200 tickets missing `customfield_14048`:

1. Check whether these tickets have issue types that typically lack SLA goals (e.g., Sub-task, Epic)
2. Check whether these are from projects that don't have Resolution SLA configured
3. Determine whether the absence is expected or a data gap

### Step 3: Denominator Verification

For the Resolution Compliance % metrics:

1. Confirm that `totalResChecked` (line 434) only counts tickets where `resBreached !== null` — meaning tickets without the field are correctly excluded from the denominator
2. Confirm this is the intended methodology — should tickets without the SLA field be excluded (current behaviour) or counted as "not breached"?

### Step 4: Document Findings

Write a short verification report at:
`agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop02_resolution_sla.md`

Include:
- Sample ticket cross-check results
- Absence analysis findings
- Denominator methodology note
- Recommendation on whether Resolution SLA can be advanced to SOURCE DEFINED

### Verification Criteria

1. At least 5 tickets with Resolution SLA breach confirmed to match between cache and Jira
2. The 72/200 absence is explained (expected vs data gap)
3. Resolution Compliance % methodology is documented and defensible

### What NOT To Do

- Do not change the Resolution SLA calculation code unless a defect is found during verification
- Do not extend verification to FRT fields — FRT is blocked
- Do not create regression baselines yet — this is verification, not promotion

---

## Build Report Requirements

At completion, produce:
`agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop02.md`

Include:
- What was changed (Track 1)
- What was verified (Track 2)
- Any unexpected findings
- Whether ghost KPIs are suppressed (Track 1 success criteria)
- Whether Resolution SLA is verified (Track 2 findings)
- Updated blocker state
- Remaining human decisions still needed

---

## Scope Boundary

This build is complete when Track 1 and Track 2 are done. Do not proceed to:
- FRT recovery (blocked by HDR-2)
- Development count changes (blocked by HDR-1)
- Evaluation brief creation (blocked — Stage 0)
- Missing KPI expansion (out of scope)
