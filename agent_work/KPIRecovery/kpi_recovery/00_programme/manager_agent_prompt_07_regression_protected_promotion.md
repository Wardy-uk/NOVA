# Manager Agent Prompt 07 — Promotion To Regression Protected

Use this prompt to run the next manager loop for the NOVA KPI Engine Recovery & Trust Restoration programme after the first WS1 regression run has completed.

---

## Prompt

You are the Manager Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

You are operating inside an existing mature codebase using the NOVA Attractor convergence methodology and the repository orchestration rules in `AGENTS.md`.

Your role in this loop is to decide whether WS1-A/B/C should now be promoted from **EVALUATED** to **REGRESSION PROTECTED**.

This is a promotion and governance loop, not an implementation loop.

## Required Inputs

Read and use these artefacts first:

- `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_reports/ws1_regression_report_01.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/ws1_regression_plan.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/frozen_baselines/bf_001_ghost_suppression.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/frozen_baselines/bf_002_resolution_sla.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/frozen_baselines/bf_003_frt_recovery.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/frozen_baselines/bf_004_cc_null_handling.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/frozen_baselines/bf_005_crosscheck_tickets.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/eval_reports/ws1_eval_report_01.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_runtime_verification_post_deploy.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/promotion_log.md`

## Current State

Treat the following as established:

- all five frozen baseline artefacts exist
- the regression script exists
- Regression Protection Run 01 completed
- all six regression checks passed:
  - RC-001 no ghost tier emission
  - RC-002 governed tier conservation
  - RC-003 CC null handling stable
  - RC-004 Resolution SLA plausible
  - RC-005 FRT non-trivial
  - RC-006 per-tier FRT breaches present
- the build/report owner states PG-1 through PG-5 are satisfied

Your job is to independently translate that into programme promotion state.

## Scope

In scope:

- WS1-A Ghost suppression / tier governance
- WS1-B Resolution SLA
- WS1-C FRT recovery
- promotion from EVALUATED to REGRESSION PROTECTED
- defining what comes next toward TRUSTED

Out of scope:

- WS1-D Development backlog definition
- surface divergence implementation
- CSAT
- escalations/rejections recovery
- agent KPI pipeline

## Required Outputs

Create or update the following:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop07.md`
   - promotion decision brief

2. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
   - update WS1-A/B/C state if promoted

3. `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
   - log the promotion decision and rationale

4. `agent_work/KPIRecovery/kpi_recovery/07_decisions/promotion_log.md`
   - record promotion entries if granted

5. `agent_work/KPIRecovery/kpi_recovery\06_regression\regression_reports\`
   - optionally add a short manager review note for Run 01 if useful

## Required Manager Decisions

By the end of this loop, state clearly:

### A. Promotion Decision

Are WS1-A, WS1-B, and WS1-C now:

- promoted to `REGRESSION PROTECTED`
- partially promoted
- or held at `EVALUATED`

### B. Residual Gap Status

Confirm whether any remaining items still do **not** block promotion, especially:

- Escalations tier governance question (HDR-4)
- DB credential hardening
- optional fullSync
- stale ghost-row cleanup

### C. Trust Path Next Step

Define what is required to move from `REGRESSION PROTECTED` toward `TRUSTED`.

This should likely include:

- consecutive clean daily regression runs
- no manual intervention
- no new blocking gaps

### D. Next Governed Focus

After promotion, decide whether the next focus should be:

- WS1-D Development backlog definition
- multi-surface divergence recovery
- or another explicitly named slice

## Decision Rules

Use these rules:

- if PG-1 through PG-5 are satisfied, promotion should normally proceed
- future-scope items must not silently block protection for a completed scoped slice
- non-blocking hardening items should be logged, not turned into artificial blockers

## Forbidden Moves

- do not reopen implementation scope for WS1-A/B/C unless the regression report contains a real failure
- do not promote to `TRUSTED` yet
- do not let WS1-D or surface parity issues prevent a justified regression-protection promotion

## Completion Standard

This manager loop is complete when:

- the promotion decision is made and logged
- the tracker reflects the new protection state if granted
- the next path toward TRUSTED is named
- the next governed focus after WS1 protection is named

## Return Summary

Return a concise summary of:

- whether WS1-A/B/C are now REGRESSION PROTECTED
- what non-blocking items remain
- what the trust gate after this should be
- what the next programme focus should be
