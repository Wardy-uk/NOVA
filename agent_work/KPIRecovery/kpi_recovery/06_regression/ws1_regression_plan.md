# WS1 Regression Protection Plan

**Date:** 2026-05-20 (updated: Manager Loop 06)
**Status:** READY FOR EXECUTION — baselines frozen, checks defined, build brief routed
**Purpose:** Define the regression protection required to promote WS1-A/B/C from EVALUATED to REGRESSION PROTECTED

---

## 1. Scope

| Sub-Slice | What Must Not Regress |
|-----------|----------------------|
| WS1-A | Ghost KPIs must not be emitted. Only governed tiers (ALL_TIERS) appear in KPI output. CC null handling must route to CC (Incidents). |
| WS1-B | Resolution SLA compliance must remain plausible (currently ~81%). Source must remain `customfield_14048`. Denominator must exclude tickets without SLA field. |
| WS1-C | FRT compliance must remain non-trivial (not 100%). `customfield_14046` must remain in ALL_FIELDS. Per-tier FRT breach counts must be non-zero for at least some tiers. |

---

## 2. Frozen Baselines

| ID | Sub-Slice | Content | Status |
|----|-----------|---------|--------|
| BF-001 | WS1-A | Ghost suppression — governed tier set, conservation check, emission guard | ✅ FROZEN |
| BF-002 | WS1-B | Resolution SLA — source field, compliance range, denominator rules | ✅ FROZEN |
| BF-003 | WS1-C | FRT recovery — source field, compliance range, per-tier breaches | ✅ FROZEN |
| BF-004 | WS1-A | CC null handling — ccBucket() default, CC (Incidents) volume | ✅ FROZEN |
| BF-005 | All | Cross-check ticket set — 16 Jira tickets from evaluation | ✅ FROZEN |

All baselines are frozen using post-deploy runtime verification + evaluation evidence (D-027).

---

## 3. Regression Check Set

| Check ID | Sub-Slice | Invariant | Pass Condition |
|----------|-----------|-----------|----------------|
| RC-001 | WS1-A | No ghost tier emission | Zero KPI rows for non-governed tiers |
| RC-002 | WS1-A | Governed tier conservation | 7 distinct governed tiers, all populated |
| RC-003 | WS1-A | CC null handling stable | CC (Incidents) volume ≥ 50 |
| RC-004 | WS1-B | Resolution SLA plausible | Compliance between 50% and 95% |
| RC-005 | WS1-C | FRT non-trivial | FRT Compliance < 100% and > 0% |
| RC-006 | WS1-C | Per-tier FRT breaches present | ≥ 4/7 tiers with non-zero breach count |

---

## 4. Execution

| Step | Status | Owner |
|------|--------|-------|
| Define baselines | ✅ DONE | Manager Agent (Loop 06) |
| Define regression checks | ✅ DONE | Manager Agent (Loop 06) |
| Route build execution brief | ✅ DONE | Manager Agent (Loop 06) |
| Write regression script | PENDING | Build Agent |
| Run first regression check | PENDING | Build Agent |
| Produce regression report | PENDING | Build Agent |
| Promote to REGRESSION PROTECTED | PENDING | Manager Agent (after 1 clean run) |

Build execution brief: `06_regression/regression_scripts/ws1_regression_execution_brief.md`
Report contract: `06_regression/regression_reports/ws1_regression_report_contract.md`

---

## 5. Promotion Gate: EVALUATED → REGRESSION PROTECTED (D-030)

| # | Gate Condition | Status |
|---|---------------|--------|
| PG-1 | Baseline artefacts frozen | ✅ DONE |
| PG-2 | Regression check set defined | ✅ DONE |
| PG-3 | Regression check executable | PENDING — build brief routed |
| PG-4 | ≥ 1 clean regression run | PENDING |
| PG-5 | No new blocking gaps | ✅ MET |

---

## 6. Dependencies

| Dependency | Status | Blocks Protection? |
|------------|--------|-------------------|
| `kpi_sql_password` in settings | NOT YET STORED | **NO** (D-028) — fallback via jira_issue_cache |
| May 21 first snapshot | PENDING (tomorrow) | **NO** (D-027) — baseline already frozen |
| Manual fullSync trigger | OPTIONAL | **NO** (D-029) |

---

## 7. Promotion Gate: REGRESSION PROTECTED → TRUSTED

Not yet defined. Will be scoped after REGRESSION PROTECTED is achieved. Expected shape:
- ≥ 3 consecutive clean daily regression runs
- No manual intervention required
- No new gaps discovered
