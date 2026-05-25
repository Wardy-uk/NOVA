# Manager Agent Prompt 10 — TRUSTED Promotion for WS1-A/B/C

Use this prompt now.

WS1-A/B/C have:

- passed independent evaluation
- passed regression protection
- passed **3 consecutive clean regression runs**
- had **no code changes** between runs

This loop is for the final manager review and trust-promotion decision.

---

## Prompt

You are the Manager Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

Your role in this loop is to decide whether **WS1-A, WS1-B, and WS1-C** should now be promoted from `REGRESSION PROTECTED` to `TRUSTED`.

Do not reopen already-converged implementation unless fresh evidence requires it.

---

## Required Inputs

- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/promotion_log.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/eval_reports/ws1_eval_report_01.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/ws1_regression_plan.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_reports/ws1_regression_report_run01.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_reports/ws1_regression_report_run02.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_reports/ws1_regression_report_run03.md`
- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop07.md`
- latest WS1-D manager brief for context only

---

## Current Gate Context

The governing trust decisions now on record are:

- `D-032`: WS1-A/B/C promoted to `REGRESSION PROTECTED`
- `D-033`: `TRUSTED` requires **3 consecutive clean regression runs** + no manual intervention + no new blocking gaps + manager review
- `D-036`: same-day runs may count if they are against fresh runtime/snapshot states and there were no code changes between runs

Run status now reported:

- Run 01: PASS
- Run 02: PASS
- Run 03: PASS

No code changes occurred between runs, and fresh runtime drift was observed.

---

## Required Outputs

Create or update:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop09_trusted_promotion.md`
   - final manager review for `TRUSTED` promotion

2. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
   - promote WS1-A/B/C if justified
   - update regression accumulation state
   - update next active governed focus

3. `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
   - record the `TRUSTED` promotion decision

4. `agent_work/KPIRecovery/kpi_recovery/07_decisions/promotion_log.md`
   - add `REGRESSION PROTECTED -> TRUSTED` entries if granted

5. `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
   - only if any residual non-blocking item needs reclassification

---

## Required Manager Decisions

By the end of this loop, state clearly:

1. Whether WS1-A, WS1-B, and WS1-C are promoted to `TRUSTED`
2. Whether any residual item still prevents trust promotion
3. Whether WS1 is now operationally closed except for WS1-D
4. What the next active governed focus becomes immediately after this decision

---

## Promotion Test

Assess the trust gate explicitly:

- TG-1: 3 consecutive clean regression runs
- TG-2: no manual intervention required to keep green
- TG-3: no new blocking gaps discovered
- TG-4: manager review of accumulated evidence

Do not invent additional hidden gates.

If all are satisfied, promote.

---

## Scope Boundary

Do not let these delay a justified `TRUSTED` promotion unless they became blocking:

- WS1-D Development backlog verification
- optional wallboard labeling review
- Escalations tier governance (HDR-4)
- DB credential hardening
- optional fullSync
- stale ghost row cleanup

These are separate follow-on concerns unless new evidence proves otherwise.

---

## Completion Standard

This loop is complete when:

- the final trust-promotion decision is written
- programme state is updated
- promotion is logged if granted
- the next governed focus after WS1-A/B/C trust is named explicitly

