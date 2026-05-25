# Manager Agent Prompt 06 — Regression Protection Activation

Use this prompt to run the next manager loop for the NOVA KPI Engine Recovery & Trust Restoration programme after WS1-A/B/C have been evaluated and marked converged-with-hardening.

---

## Prompt

You are the Manager Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

You are operating inside an existing mature codebase using the NOVA Attractor convergence methodology and the repository orchestration rules in `AGENTS.md`.

Your role in this loop is to move WS1-A/B/C from **EVALUATED** toward **REGRESSION PROTECTED**.

This loop is not about reopening the slice. It is about freezing the verified state, defining repeatable checks, and creating the promotion gate for protection.

## Required Inputs

Read and use these artefacts first:

- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop05.md`
- `agent_work/KPIRecovery/kpi_recovery/06_regression/ws1_regression_plan.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/eval_reports/ws1_eval_report_01.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_runtime_verification_post_deploy.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/promotion_log.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_comprehensive_audit_2026-05-20.md`

## Current State

Treat the following as established:

- WS1-A, WS1-B, and WS1-C all passed independent evaluation
- they are currently promoted to **EVALUATED**
- they are **not yet TRUSTED**
- the next gate is regression protection

Known non-blocking hardening items remain:

- optional fullSync to improve FRT coverage
- optional cleanup of stale ghost rows
- evaluator DB access hardening
- `Escalations` tier governance question (HDR-4), which is future-scope unless it breaks the protected model

## Scope For This Loop

In scope:

- WS1-A ghost suppression / tier governance
- WS1-B Resolution SLA
- WS1-C FRT recovery
- regression baseline freezing
- regression script / repeatable check routing
- regression gate definition

Out of scope:

- WS1-D Development backlog definition
- multi-surface divergence implementation work
- CSAT
- escalation / rejection metric recovery
- agent-level KPI pipeline

## Required Outputs

Create or update the following:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop06.md`
   - manager brief for regression protection activation

2. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
   - update WS1-A/B/C state and next actions

3. `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
   - log regression-protection decisions

4. `agent_work/KPIRecovery/kpi_recovery/07_decisions/promotion_log.md`
   - if appropriate later, prepare for promotion to REGRESSION PROTECTED

5. `agent_work/KPIRecovery/kpi_recovery/06_regression/frozen_baselines/`
   - define or create the baseline artefact records to freeze

6. `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_scripts/`
   - create the next build/execution brief for regression checks

7. `agent_work/KPIRecovery/kpi_recovery/06_regression/regression_reports/`
   - create the placeholder/report contract for the first regression run

## Required Manager Decisions

By the end of this loop, state clearly:

### A. Baseline Freeze Decision

Which concrete artefacts become the baseline set for WS1 protection?

At minimum decide whether to freeze:

- post-deploy runtime verification report
- evaluation report
- current KPI outputs or snapshot extracts
- representative sampled Jira cross-check tickets

### B. Regression Check Set

Define the minimum regression set for WS1-A/B/C.

It should cover at least:

- no ghost KPI re-emission
- governed tier conservation still holds
- Resolution SLA remains plausible and denominator-safe
- FRT remains non-trivial and not all-zero / not 100%

### C. Hardening Gate

Decide whether any of the current non-blocking items must be completed before regression protection can be granted, especially:

- fullSync for FRT coverage
- stale ghost row cleanup
- DB credential hardening

### D. Promotion Gate

Define the exact gate for moving from **EVALUATED** to **REGRESSION PROTECTED**.

Example shape:

- baseline frozen
- regression script or repeatable check defined
- at least two clean regression runs
- no protected-behaviour regressions

### E. Next Focus After Protection

Confirm whether the next governed focus after WS1 protection should be:

- WS1-D Development backlog definition
- surface divergence recovery
- or another explicitly named slice

## Routing Rules

If you create a build/execution brief from this loop, it should be for regression verification only.

Do not reopen implementation scope unless regression design itself reveals a real blocker.

The next execution brief may target:

- collecting and freezing baseline artefacts
- running the regression query/check set
- producing the first regression report

## Decision Rules

Use these rules:

- a slice can be converged without yet being regression protected
- non-blocking hardening items should not automatically prevent baseline freezing unless they undermine the protected model
- if the behaviour is stable enough to be rechecked repeatably, protection work should proceed

## Forbidden Moves

- do not reopen WS1-A/B/C implementation scope unless a true blocker appears
- do not promote to TRUSTED yet
- do not let future-scope items silently block WS1 protection
- do not start surface divergence implementation work until WS1 protection routing is clear

## Completion Standard

This manager loop is complete when:

- the regression baseline set is defined
- the regression check set is defined
- the promotion gate to REGRESSION PROTECTED is explicit
- the next execution brief for regression verification is ready

## Return Summary

Return a concise summary of:

- what will be frozen as baseline
- what the regression checks are
- whether any hardening item still blocks protection
- what must happen next to grant REGRESSION PROTECTED
