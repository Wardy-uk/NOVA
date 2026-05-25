# WS1 Manager Brief — Loop 06: Regression Protection Activation

**Date:** 2026-05-20
**Loop:** Manager Loop 06
**Trigger:** WS1-A/B/C at EVALUATED — regression protection is the gate to TRUSTED
**Status:** REGRESSION PROTECTION ROUTING ISSUED

---

## 1. Purpose

This loop converts the regression plan (Loop 05) from PLANNING to READY FOR EXECUTION. It defines:

- what is frozen as baseline
- what the regression checks are
- the execution brief for the build agent
- the promotion gate to REGRESSION PROTECTED

This loop does NOT reopen WS1-A/B/C implementation scope.

---

## 2. Inputs Consumed

| Source | Content | Key Extract |
|--------|---------|-------------|
| `ws1_manager_brief_loop05.md` | Post-evaluation convergence | WS1-A/B/C converged, non-blocking hardening items listed |
| `ws1_regression_plan.md` | Regression plan (PLANNING) | Baselines B-001/002/003 defined, script spec, promotion gate |
| `ws1_eval_report_01.md` | Independent evaluation | PASS all three, 16 Jira cross-check tickets, residual gaps classified |
| `ws1_runtime_verification_post_deploy.md` | Post-deploy runtime evidence | FRT 68%, CC (Incidents) 91, ghost emission guard working, Resolution SLA 81% |
| `programme_tracker.md` | Programme state | WS1-A/B/C = EVALUATED, regression state = PLANNING |
| `kpi_comprehensive_audit_2026-05-20.md` | Original audit | 88 KPIs (74 legitimate + 14 ghost), multi-surface divergence |

---

## 3. Manager Decision A — Baseline Freeze Set

The following artefacts constitute the frozen baseline for WS1-A/B/C. Once frozen, these are reference points — any future regression is measured against them.

### Baseline Artefact Set

| ID | Artefact | Type | Content | Location |
|----|----------|------|---------|----------|
| BF-001 | Ghost suppression baseline | Value snapshot | Expected: 0 KPI rows for non-governed tiers. Governed tier list = ALL_TIERS (7). Total governed KPI count = 74 (post-ghost removal). | `06_regression/frozen_baselines/bf_001_ghost_suppression.md` |
| BF-002 | Resolution SLA baseline | Value snapshot | Resolution Compliance % (Open Queue) = 81% ±5%. SLA Breached count ~101. Source = `customfield_14048`. Denominator excludes NTPJ/YO (no SLA config). | `06_regression/frozen_baselines/bf_002_resolution_sla.md` |
| BF-003 | FRT recovery baseline | Value snapshot | FRT Compliance % (Open Queue) = 68%. Per-tier breach counts non-zero for ≥4/7 tiers. Source = `customfield_14046`. Field present in ALL_FIELDS. | `06_regression/frozen_baselines/bf_003_frt_recovery.md` |
| BF-004 | CC null-handling baseline | Value snapshot | CC (Incidents) ≥ 80 (was 91 post-fix, was 30 pre-fix). ccBucket() returns 'CC (Incidents)' for null request_type. | `06_regression/frozen_baselines/bf_004_cc_null_handling.md` |
| BF-005 | Cross-check ticket set | Reference set | 16 tickets from evaluation (8 SLA + 8 FRT). Ticket keys, expected states, match results. | `06_regression/frozen_baselines/bf_005_crosscheck_tickets.md` |

### What Is NOT Frozen

- Exact KPI values (these drift organically as tickets change)
- FRT coverage percentage (59.4% → growing, not a protected invariant)
- Specific ticket counts per tier (volume changes daily)
- Stale ghost rows in today's data (cosmetic, not recreated tomorrow)

### Freeze Timing

Baselines BF-001 through BF-004 use values from the evaluation report and runtime verification as their reference points. They do NOT require a May 21 snapshot to be frozen — the post-deploy verified values are the known-good state. The May 21 snapshot is a confirmation check (regression run 1), not a freeze precondition.

**Decision D-027:** Baselines are frozen now using post-deploy runtime verification + evaluation evidence. The first regression run (May 21 snapshot) tests against these frozen values rather than establishing them.

Rationale: Waiting for May 21 to freeze baselines creates unnecessary delay. The runtime verification and independent evaluation already established the known-good state with high confidence. The May 21 snapshot is the first regression check, not the baseline itself.

---

## 4. Manager Decision B — Regression Check Set

Six regression checks cover the protected invariants for WS1-A/B/C:

| Check ID | Sub-Slice | Invariant | Pass Condition | Fail Signal |
|----------|-----------|-----------|----------------|-------------|
| RC-001 | WS1-A | No ghost tier emission | Zero KPI rows where tier component ∉ ALL_TIERS | Any row for "Customer Care" (raw), "Unclassified", "Escalations", or other ungoverned tier |
| RC-002 | WS1-A | Governed tier conservation | Exactly 7 distinct tier components in KPI output | Tier count ≠ 7, or any governed tier missing entirely |
| RC-003 | WS1-A | CC null-handling stable | CC (Incidents) volume ≥ 50 | CC (Incidents) drops below 50 (would indicate null-RT tickets lost again) |
| RC-004 | WS1-B | Resolution SLA plausible | Resolution Compliance % (Open Queue) between 50% and 95% | Compliance = 100% (field lost) or < 50% (systematic error) or absent |
| RC-005 | WS1-C | FRT non-trivial | FRT Compliance % (Open Queue) < 100% and > 0% | FRT = 100% (field dropped from ALL_FIELDS or parser broken) or = 0% (systematic error) |
| RC-006 | WS1-C | Per-tier FRT breaches present | ≥ 4 of 7 governed tiers have non-zero FRT breach count (actionable OR not-actionable) | Fewer than 4 tiers with breaches (FRT data loss or parser regression) |

### Check Execution Paths

**Primary path (preferred):** Direct query of `jira_kpi_daily` in TechSupportJSM database. Requires `kpi_sql_password` in NOVA settings.

**Fallback path (if DB credential unavailable):** Query `jira_issue_cache` in NOVA MSSQL database (same approach evaluator used). All six checks can be verified at cache level:

| Check | Fallback Query |
|-------|---------------|
| RC-001 | `SELECT DISTINCT classifyTier(current_tier) FROM jira_issue_cache WHERE status_category != 'Done'` — verify all map to ALL_TIERS |
| RC-002 | Count distinct governed tiers from cache |
| RC-003 | Count CC tickets where `request_type IS NULL` — verify they resolve to CC (Incidents) |
| RC-004 | Parse `customfield_14048` from `fields_json` for NT tickets — compute compliance |
| RC-005 | Parse `customfield_14046` from `fields_json` for NT tickets — compute compliance |
| RC-006 | Count per-tier FRT breaches from parsed `customfield_14046` |

**Decision D-028:** The DB credential is NOT a blocker for regression protection. The fallback path through `jira_issue_cache` covers all six invariants. The DB credential is a hardening item that improves verification depth but does not gate protection.

---

## 5. Manager Decision C — Hardening Gate

| Hardening Item | Blocks Protection? | Rationale |
|----------------|-------------------|-----------|
| fullSync for FRT coverage | **NO** | FRT coverage at 59.4% is a sync lag, not a regression signal. The invariant is "FRT ≠ 100%", not "FRT coverage = 100%". Coverage improves organically. |
| Stale ghost row cleanup | **NO** | 14 stale rows from today's pre-deploy snapshot are cosmetic. They will not be recreated on May 21. The regression check (RC-001) verifies non-recreation, not cleanup. |
| DB credential (`kpi_sql_password`) | **NO** | Fallback path via `jira_issue_cache` covers all regression checks. Credential improves depth but does not gate protection. |
| Escalations tier governance (HDR-4) | **NO** | Escalations is a data gap deferred to WS2+. The emission guard correctly excludes them. This is future scope, not a regression of the current protected model. |

**Decision D-029:** No hardening items block regression protection. All four are quality-of-life improvements that should proceed independently but do not gate the EVALUATED → REGRESSION PROTECTED promotion.

---

## 6. Manager Decision D — Promotion Gate

### Gate Definition: EVALUATED → REGRESSION PROTECTED

WS1-A/B/C may be promoted from EVALUATED to REGRESSION PROTECTED when ALL of the following are met:

| # | Gate Condition | Evidence Required |
|---|---------------|-------------------|
| PG-1 | Baseline artefacts frozen | BF-001 through BF-005 exist with concrete values |
| PG-2 | Regression check set defined | RC-001 through RC-006 documented with pass/fail logic |
| PG-3 | Regression check executable | Script or manual execution procedure exists and has been tested |
| PG-4 | ≥ 1 clean regression run | At least one post-freeze regression run returns PASS on all 6 checks |
| PG-5 | No new blocking gaps | No gap discovered since evaluation that would invalidate the protected model |

**Decision D-030:** The promotion gate requires ONE clean regression run, not two. Rationale: The evaluation already served as the independent verification. The regression run confirms stability, not correctness — one clean run is sufficient for REGRESSION PROTECTED. The subsequent TRUSTED promotion (which requires ongoing stability) will be governed by a separate, stricter gate.

### Gate: REGRESSION PROTECTED → TRUSTED

This gate is NOT defined in this loop. It will be defined after REGRESSION PROTECTED is achieved. Expected shape:
- ≥ 3 consecutive clean daily regression runs
- No manual intervention required to maintain green
- No new gaps discovered

---

## 7. Manager Decision E — Next Focus After Protection

**Decision D-031:** After WS1-A/B/C achieve REGRESSION PROTECTED:

1. **If HDR-1 is answered:** Scope WS1-D (Development backlog definition) as the immediate next build
2. **If HDR-1 is still pending:** Begin surface divergence discovery for G-009 through G-014 (the 6 remaining open cross-surface gaps). This does NOT mean starting implementation — it means a discovery loop to classify root causes and determine which gaps share infrastructure with WS1.
3. **Regardless:** Begin accumulating daily regression runs toward the TRUSTED gate

---

## 8. Execution Brief Routing

This loop routes one execution brief:

**Brief:** `ws1_regression_execution_brief.md`
**Target:** Build Agent
**Scope:** Freeze baselines, create regression check script, run first regression check, produce first regression report

The brief is located at `06_regression/regression_scripts/ws1_regression_execution_brief.md`.

The build agent should:
1. Create the 5 frozen baseline artefact files (BF-001 through BF-005) using values from the eval report and runtime verification
2. Write the regression check script (`ws1_regression_check.mjs`)
3. Run the script against current NOVA data
4. Produce the first regression report

---

## 9. Artefacts Updated This Loop

| Artefact | Action |
|----------|--------|
| `ws1_manager_brief_loop06.md` | Created — this file |
| `programme_tracker.md` | Updated — regression state advanced to READY FOR EXECUTION |
| `decision_log.md` | Added D-027 through D-031 |
| `promotion_log.md` | Prepared — REGRESSION PROTECTED gate defined, not yet promoted |
| `06_regression/frozen_baselines/` | Baseline records defined (BF-001 through BF-005) |
| `06_regression/regression_scripts/ws1_regression_execution_brief.md` | Build brief created |
| `06_regression/regression_reports/ws1_regression_report_contract.md` | Report contract created |

---

## 10. Loop 06 Summary

Baselines are defined and frozen using post-deploy runtime verification + evaluation evidence (D-027). Six regression checks cover ghost suppression, tier conservation, CC null handling, Resolution SLA plausibility, FRT non-triviality, and per-tier FRT breaches (D-028). No hardening items block protection (D-029). The promotion gate requires one clean regression run (D-030). An execution brief has been routed to the build agent to freeze baselines, write the regression script, and produce the first regression report.
