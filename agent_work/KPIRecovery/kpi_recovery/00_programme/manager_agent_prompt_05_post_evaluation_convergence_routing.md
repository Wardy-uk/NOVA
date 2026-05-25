# Manager Agent Prompt 05 — Post-Evaluation Convergence Routing

Use this prompt to run the next manager loop for the NOVA KPI Engine Recovery & Trust Restoration programme after the first WS1 evaluation has completed.

---

## Prompt

You are the Manager Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

You are operating inside an existing mature codebase using the NOVA Attractor convergence methodology and the repository orchestration rules in `AGENTS.md`.

Your role in this loop is to:

1. incorporate the completed WS1 evaluation verdict
2. classify any remaining gaps as blocking vs non-blocking
3. decide whether WS1-A/B/C are ready for convergence approval, hardening, or retest
4. preserve the scope boundary between completed work and deferred work

## Required Inputs

Read and use these artefacts first:

- `agent_work/KPIRecovery/kpi_recovery/04_eval/eval_reports/ws1_eval_report_01.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards/ws1_ab_evaluator_brief_v1.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_runtime_verification_post_deploy.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/known_failures_log.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_comprehensive_audit_2026-05-20.md`

## Current Evaluation Result

The first WS1 evaluation returned:

- **Overall verdict: PASS**
- **WS1-A: PASS**
- **WS1-B: PASS**
- **WS1-C: PASS**

Known residual issues from the evaluation:

- 10 `Escalations` tier tickets are not governed
- evaluator could not directly verify `jira_kpi_daily` table output because DB credentials were unavailable
- 2 Resolution SLA mismatches appear attributable to stale cache on old Development tickets
- FRT coverage is improving but not yet complete; a full re-sync is recommended

You must decide whether these are:

- non-blocking hardening items within converged scope
- blockers requiring another build/retest
- or deferred future-scope items

## Scope For This Loop

In scope:

- WS1-A Ghost suppression / tier governance
- WS1-B Resolution SLA
- WS1-C FRT recovery
- convergence decision for WS1-A/B/C

Out of scope:

- WS1-D Development backlog definition
- CSAT
- escalations/rejections as full recovery scope
- agent KPI pipeline
- broad dashboard/trends/wallboard parity implementation

You may log out-of-scope items, but do not let them silently block WS1 if they were not part of the governed slice.

## Required Outputs

Create or update the following:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop05.md`
   - post-evaluation manager brief

2. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
   - update sub-slice states and next actions

3. `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
   - log convergence / hardening / deferment decisions

4. `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
   - classify residual gaps as blocking or non-blocking

5. `agent_work/KPIRecovery/kpi_recovery/07_decisions/promotion_log.md`
   - if appropriate, log promotion for WS1-A/B/C to the next trust state

6. `agent_work/KPIRecovery/kpi_recovery/06_regression/`
   - if you decide WS1 is ready, create the first regression-protection planning artefact or brief

## Required Manager Decisions

By the end of this loop, state clearly:

### A. Convergence Decision

Are WS1-A/B/C:

- converged for current scope
- converged with non-blocking hardening items
- or not yet converged

### B. Residual Gap Classification

Classify the following:

1. `Escalations` tier not governed
2. evaluator lack of direct `jira_kpi_daily` DB access
3. 2 stale-cache Resolution SLA mismatches
4. incomplete FRT coverage pending full resync

For each, state:

- blocking vs non-blocking
- current-scope vs future-scope
- whether another build is required now

### C. Hardening Decision

Decide whether the programme should run a small hardening pass now for any of:

- full re-sync to improve FRT coverage
- settings/credential path for evaluator DB access
- cleanup of stale ghost rows

Or whether these should be logged as operational hardening items after convergence.

### D. Promotion Decision

Decide whether:

- WS1-A can be considered converged / protected for current scope
- WS1-B can move beyond `SOURCE DEFINED`
- WS1-C can move beyond `SOURCE DEFINED`

Do not use `TRUSTED` unless it is justified by the programme’s promotion rule.

### E. Next Governed Focus

Decide whether the next focus after WS1 should be:

- WS1 regression protection
- WS1-D Development backlog definition
- multi-surface divergence recovery
- or another explicitly named workstream

## Decision Rules

Use these rules:

- a PASS evaluation does not automatically mean full programme convergence
- non-blocking gaps should not be allowed to endlessly prevent closure of a scoped slice
- out-of-scope issues should be logged, not silently imported into the current slice
- if the remaining issue does not compromise the evaluated behavioural/evidence model, it should usually be treated as non-blocking

## Forbidden Moves

- do not reopen WS1-A/B/C scope just because future-scope issues exist
- do not silently upgrade to `TRUSTED` without following the promotion rule
- do not collapse stale-cache operational issues into a claim that the slice failed if the evaluator already judged them non-systematic
- do not treat the unresolved Development backlog business rule as a blocker for WS1-A/B/C convergence

## Completion Standard

This manager loop is complete when:

- the PASS evaluation is incorporated into governance state
- residual issues are clearly classified
- a convergence or hardening decision exists for WS1-A/B/C
- the next governed focus is clearly named

## Return Summary

Return a concise summary of:

- whether WS1-A/B/C are converged
- what non-blocking gaps remain
- whether a hardening or regression step comes next
- what the next programme focus should be
