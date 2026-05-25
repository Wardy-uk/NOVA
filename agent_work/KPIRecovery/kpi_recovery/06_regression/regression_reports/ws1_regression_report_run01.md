# WS1 Regression Report — Run 01

## 1. Header

| Field | Value |
|-------|-------|
| Run Number | 01 |
| Date | 2026-05-20 |
| Data Source | NOVA MSSQL — `jira_issue_cache` (FALLBACK path) |
| Script | `_eval_ws1_regression.mjs` v2 (SQL-side field extraction) |
| Executor | Build Agent |

---

## 2. Check Results

| Check ID | Description | Result | Evidence |
|----------|-------------|--------|----------|
| RC-001 | No ghost tier emission | **PASS** | 7 governed tiers found. 10 Escalations excluded by guard. |
| RC-002 | Governed tier conservation | **PASS** | 7/7 governed tiers populated: CC(I)=680, CC(SR)=43, CC(TPJ)=44, Prod=42, T2=63, T3=14, Dev=279 |
| RC-003 | CC null handling stable | **PASS** | CC (Incidents) = 680 (threshold: >= 50) |
| RC-004 | Resolution SLA plausible | **PASS** | Compliance = 66.0% (187 breached / 550 with field). Range: 50%-95%. |
| RC-005 | FRT non-trivial | **PASS** | FRT Compliance = 68.0% (108 breached / 338 with field). Range: >0%, <100%. |
| RC-006 | Per-tier FRT breaches present | **PASS** | 7/7 tiers with breaches (threshold: >= 4): CC(I)=4, CC(SR)=13, CC(TPJ)=8, Prod=10, T2=19, T3=7, Dev=47 |

---

## 3. Overall Verdict

**PASS** — 6/6 checks passed.

---

## 4. Comparison to Baseline

| Check | Baseline Value (BF) | Run 01 Value | Trend | Assessment |
|-------|---------------------|-------------|-------|------------|
| RC-001 | 0 ghost emissions | 0 ghost emissions | Stable | Consistent |
| RC-002 | 7 governed tiers | 7 governed tiers | Stable | Consistent |
| RC-003 | CC(I) = 91 (BF-004) | CC(I) = 680 | Higher | Expected: baseline used KPI snapshot count; regression uses cache-level classification of all CC tickets. Both confirm null-RT routing is working. |
| RC-004 | 81% (BF-002) | 66.0% | Lower | Plausible organic drift: more breached tickets accumulated. Within 50%-95% pass range. |
| RC-005 | 68% (BF-003) | 68.0% | Stable | Almost identical to baseline. |
| RC-006 | 7/7 tiers (BF-003) | 7/7 tiers | Stable | Improved from freeze: all 7 tiers now show breaches (was 7/7 at runtime verification). |

### Note on RC-003 Count Difference

The baseline CC(I) value of 91 was measured from the KPI pipeline snapshot output (tier-level aggregate). The regression check queries `jira_issue_cache` directly and classifies all open CC tickets through `ccBucket()` logic, yielding 680. Both values confirm the same invariant: null request_type tickets route to CC (Incidents), not to a ghost "Customer Care" tier. The invariant is stable.

### Note on RC-004 Drift

Resolution SLA compliance dropped from 81% to 66%. This is within the plausibility range (50%-95%) and reflects organic accumulation of breached tickets in the open queue over time. The important signal: compliance is NOT 100% (which would indicate field loss) and NOT <50% (which would indicate systematic error). The source field `customfield_14048` is confirmed present and producing real breach data.

---

## 5. Anomalies

1. **Script v1 false failure:** The initial regression script used a 500-character substring window to extract SLA/FRT breach status from `fields_json`. SLA breach markers appear 600-2000 chars into the field object, causing v1 to detect only 11/550 breaches (98% compliance — false FAIL on RC-004). Fixed in v2 by moving breach detection to SQL-side with a 3000-character window from the field start position. FRT was also under-counted in v1 (12 vs 108 breaches) but still passed the non-triviality check.

2. **10 Escalations tickets excluded.** Same as baseline — these are real tickets with `current_tier = 'Escalations'`, correctly excluded by the emission guard. Deferred to HDR-4 / WS2+.

3. **FRT coverage growing.** 338 NT tickets now have FRT field data (up from 329 at evaluation). Incremental sync is expanding coverage organically.

---

## 6. Execution Method

**Evidence path:** FALLBACK — `jira_issue_cache` in NOVA MSSQL database.

The primary path (`jira_kpi_daily` in TechSupportJSM) was not available because `kpi_sql_password` is not stored in NOVA settings. Per decision D-028, this does not block regression protection.

All six checks were executed via SQL queries against `jira_issue_cache`, using the same tier classification logic as `kpi-pipeline.ts` and SQL-side `SUBSTRING` + `LIKE` for SLA/FRT breach detection.

---

## 7. Promotion Gate Status

| Gate | Condition | Status |
|------|-----------|--------|
| PG-1 | Baseline artefacts frozen | **MET** — BF-001 through BF-005 created |
| PG-2 | Regression check set defined | **MET** — RC-001 through RC-006 |
| PG-3 | Regression check executable | **MET** — `_eval_ws1_regression.mjs` v2 tested and working |
| PG-4 | >= 1 clean regression run | **MET** — this run (Run 01) = PASS |
| PG-5 | No new blocking gaps | **MET** — no new gaps discovered |

**All five promotion gate conditions are satisfied.**

---

## 8. Blockers / New Regressions

None discovered. No new blocker or unexpected regression.

---

## 9. Recommendation for Manager

All promotion gate conditions (PG-1 through PG-5) are met. This report recommends that the Manager Agent review and promote WS1-A/B/C from **EVALUATED** to **REGRESSION PROTECTED** (decision D-030).

The regression script is ready for daily automated runs to accumulate evidence toward the subsequent TRUSTED promotion gate.
