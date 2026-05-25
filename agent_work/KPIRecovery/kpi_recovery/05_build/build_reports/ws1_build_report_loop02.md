# WS1 Build Report — Loop 02

**Date:** 2026-05-20
**Workstream:** WS1 — Source of Truth Validation
**Loop:** Build Loop 02
**Status:** COMPLETE

---

## Track 1: CC Null Handling + Ghost KPI Suppression

### Changes Applied

**File:** `src/server/services/kpi-pipeline.ts`

| Change | Line | Before | After |
|--------|------|--------|-------|
| `ccBucket()` return type | 100 | `string \| null` | `string` |
| `ccBucket()` default return | 105 | `return null` | `return 'CC (Incidents)'` |
| Emission guard | 496 | `if (stats.volume === 0 && !ALL_TIERS.includes(tier)) continue;` | `if (!ALL_TIERS.includes(tier)) continue;` |

### TypeScript Compilation

`npx tsc --noEmit` passes with no errors.

### Expected Behaviour After Deploy

1. **688 CC tickets with null `request_type`** now route to `CC (Incidents)` instead of falling through to ungoverned "Customer Care" tier
2. **2 tickets with unmapped types** ("Support Request", "Technical Projects") also route to `CC (Incidents)`
3. **Ghost KPIs eliminated**: No rows emitted for "Customer Care" or "Unclassified" tiers — emission guard now unconditionally suppresses non-governed tiers
4. **CC (Incidents) volume increase**: Expected ~688 ticket increase (absorbing previously unmapped CC tickets)
5. **All 7 governed tiers continue emitting**: `ALL_TIERS` initialisation at line 401-403 pre-seeds all governed tiers, so zero-volume tiers still emit

### Verification Criteria (Post-Deploy)

- [ ] `jira_kpi_daily` has no rows with KPI names containing "Customer Care" or "Unclassified" for today's date
- [ ] `CC (Incidents)` volume ≈ 688 + previous ~34 = ~722
- [ ] `CC (Service Requests)` volume unchanged (~44)
- [ ] `CC (TPJ)` volume unchanged (~46)
- [ ] Sum of all CC sub-tier volumes ≈ 814 (total open CC)
- [ ] All 7 governed tiers present in output

---

## Track 2: Resolution SLA Verification

Full details in `ws1_build_report_loop02_resolution_sla.md`.

### Summary

| Check | Result |
|-------|--------|
| Breached tickets match (5/5) | ✓ All match |
| Not-breached tickets match (3/3) | ✓ All match |
| Parser compatibility | ✓ `isSlaBreached()` works correctly |
| Absence explained | ✓ NTPJ/YO projects lack SLA config — expected |
| Denominator methodology | ✓ Excludes absent tickets — correct |
| Computed compliance | 82.4% — matches NOVA daily output |

**Resolution SLA is recommended for SOURCE DEFINED status.**

### Unexpected Discovery: FRT Root Cause

The Jira cross-check revealed that `customfield_14046` (First Reply Time) **IS returned by the Jira REST API** when explicitly requested. It was absent from cached data because **`customfield_14046` is not included in the `ALL_FIELDS` array** in `jira-sync-service.ts`.

This is a one-line fix: add `'customfield_14046', // First Reply Time SLA` to `ALL_FIELDS` (line 19-42). After a full re-sync, FRT data will populate `fields_json` and all FRT metrics should begin producing real data.

Service Desk API enumeration confirmed:
- SLA ID 76 = "First Reply Time" → `customfield_14046`
- SLA ID 78 = "Resolution" → `customfield_14048`
- `customfield_10010` is not returned by the REST API — it's a dead field

---

## Updated Blocker State

| # | Blocker | Status | Resolution |
|---|---------|--------|------------|
| B-1 | FRT custom field ID unknown | **RESOLVED** | `customfield_14046` confirmed as FRT. Absent from `ALL_FIELDS` — one-line fix. |
| B-2 | 84.8% of CC tickets have null request_type | **RESOLVED** | `ccBucket()` now defaults to `CC (Incidents)` |
| B-3 | n8n Development JQL not inspected | OPEN | Not locally discoverable; n8n instance inspection needed |
| B-4 | Business definition: Development backlog scope | OPEN | Decision from Nick |

---

## Remaining Human Decisions

### HDR-1 (from Manager Brief)

> **Should the Development backlog count include all issue types (Support, Bug, Task, Sub-task), or only Support requests?**

This cannot be resolved by code inspection. It is a business definition.

### HDR-2 (from Manager Brief — NOW RESOLVABLE)

> **Which Jira custom field is the authoritative FRT SLA?**

**Answer:** `customfield_14046` = "First Reply Time" (SLA ID 76). Confirmed via Service Desk API and direct REST API check. This decision no longer requires Nick's input — it can be resolved by adding the field to `ALL_FIELDS`.

---

## Recommended Next Actions

1. **Deploy Track 1** — ghost KPI suppression is ready. Verify post-deploy against the criteria above.

2. **Add `customfield_14046` to `ALL_FIELDS`** — this is a trivial fix that unblocks all FRT metrics. Consider adding in the same deploy. After deploy, trigger a full Jira re-sync to populate the field.

3. **After re-sync, verify FRT data** — sample `fields_json` to confirm `customfield_14046` is now present. Run the same parser compatibility check from Loop 01.

4. **Advance Resolution SLA to SOURCE DEFINED** — evidence supports this.

5. **Hold on Development count** — still blocked by HDR-1 and B-3.

---

## Diagnostic Artefacts (Disposable)

| File | Purpose |
|------|---------|
| `_diag_sla_cc_audit.mjs` | Loop 01 initial audit |
| `_diag_sla_deep.mjs` | Loop 01 deep scan (timed out) |
| `_diag_sla_deep2.mjs` | Loop 01 deep scan v2 |
| `_diag_resolution_sla_verify.mjs` | Loop 02 Track 2 Parts 1-3 |
| `_diag_jira_crosscheck.mjs` | Loop 02 Track 2 Part 4 + FRT discovery |

All can be deleted after manager review.
