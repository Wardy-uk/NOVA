# Manager Agent Prompt 03 — WS1 Partial Evaluation Path And FRT Recovery Routing

Use this prompt to run the third manager loop for the NOVA KPI Engine Recovery & Trust Restoration programme after WS1 Build Loop 02 has completed.

---

## Prompt

You are the Manager Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

You are operating inside an existing mature codebase using the NOVA Attractor convergence methodology and the repository orchestration rules in `AGENTS.md`.

Your role in this loop is to:

1. incorporate the completed Build Loop 02 evidence
2. update governance and trust-state progression
3. route the next bounded FRT recovery build
4. decide whether part of WS1 is now ready for the first real evaluator brief

## Current State

WS1 Build Loop 02 is complete and materially changed the programme state:

- ghost KPI suppression changes are implemented and compile cleanly
- Resolution SLA is cross-checked against live Jira and now has strong evidence
- the FRT root cause is no longer ambiguous
- Development backlog definition is still externally blocked

This means WS1 is no longer fully blocked as a single monolithic slice.

You should now treat WS1 as potentially split into:

- **WS1-A:** tier governance / ghost suppression / CC visibility
- **WS1-B:** Resolution SLA source verification
- **WS1-C:** FRT recovery
- **WS1-D:** Development backlog definition/parity

## Artefacts You Must Read First

- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop02.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop02.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop02_resolution_sla.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/known_failures_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards/evaluation_lifecycle_standard.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards\evaluator_brief_template.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards/ws1_evaluation_blocked_note.md`

## Confirmed Findings You Must Treat As Established

### 1. Ghost Suppression Build Is Complete

- `ccBucket()` now defaults to `CC (Incidents)`
- non-governed tiers are now suppressed by unconditional guard
- build compiles cleanly
- this area is now waiting for independent runtime/evidence validation, not further design debate

### 2. Resolution SLA Is Verified At Source Level

- `customfield_14048` matches live Jira 8/8 sampled tickets
- parser is compatible
- absence pattern is explained by project-level SLA configuration
- denominator methodology is correct
- computed compliance matches NOVA daily output

### 3. FRT Root Cause Is Now Known

- `customfield_14046` is the authoritative FRT field
- it is available from Jira when explicitly requested
- it is absent from cache only because `jira-sync-service.ts` does not request it in `ALL_FIELDS`
- this is now a bounded corrective build, not a discovery problem

### 4. Development Backlog Is Still Blocked

- still requires Nick's business definition
- still benefits from n8n query inspection if available

## Your Mission In This Loop

Run Manager Loop 03 for WS1.

Your objective is to:

1. update WS1 state from “diagnostic recovery” to “partial evaluable + continued build”
2. promote the appropriate parts of WS1 toward evaluation readiness
3. create the next bounded build brief for FRT field inclusion and re-sync planning
4. decide whether the first real evaluator brief should now be created for a partial WS1 slice

## Scope For This Loop

Stay within WS1 only.

Focus on:

- ghost KPI suppression readiness for evaluation
- Resolution SLA source-defined progression
- FRT corrective routing
- Development backlog remaining blocked

Do not expand into:

- CSAT
- escalation/rejection
- agent KPI pipeline
- missing KPI expansion
- regression protection decisions

## Required Outputs

Create or update the following:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop03.md`
   - new manager brief reflecting post-Build-02 state

2. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
   - update the active recovery slice and trust progression

3. `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
   - log any new state or lifecycle decisions

4. `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
   - update if any gap is now resolved or reclassified

5. `agent_work/KPIRecovery/kpi_recovery/05_build/implementation_plans/`
   - create the next bounded Build Loop 03 brief for FRT recovery

6. `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards/`
   - either:
     - update the blocked note to reflect a partial unblocking path, or
     - create the first real partial evaluator brief for the now-testable subset

## Required Manager Decisions

By the end of this loop, state clearly:

### A. Ghost Suppression Status

- whether ghost suppression is now ready for independent evaluation after deployment/runtime visibility
- what evidence the evaluator should check

### B. Resolution SLA Status

- whether Resolution SLA should now be advanced to `SOURCE DEFINED`
- whether it is also ready for inclusion in the first evaluator brief

### C. FRT Routing

- create a bounded next build that:
  - adds `customfield_14046` to `ALL_FIELDS`
  - defines what sync/re-sync/backfill step is required next
  - defines what evidence will confirm FRT is now present in cache

### D. Partial Evaluator Decision

Decide whether the first real evaluator brief should now be created for:

- ghost suppression / CC tier visibility
- Resolution SLA correctness

while explicitly excluding:

- FRT metrics
- Development backlog count

### E. Development Backlog Block

Keep this blocked until:

- Nick answers the business definition question
- optionally, n8n query parity is inspected

## Guidance On Evaluator Engagement

You are now allowed to consider the first real evaluator brief, but only for the subset that is stable enough.

Use this rule:

- if ghost suppression changes are implemented and observable through the real runtime/output path, that subset may be evaluable
- if Resolution SLA has a stable source and corroborated values, it may be evaluable
- if FRT still requires the field-inclusion build, do not include it
- if Development backlog still lacks a business rule, do not include it

This would be a **partial WS1 evaluator brief**, not a full WS1 convergence brief.

## Build-Agent Routing Rules For Loop 03

If you create the next Build Agent brief, it must be tightly bounded to FRT recovery:

- add `customfield_14046` to `jira-sync-service.ts`
- describe whether a full re-sync, backfill, or targeted refresh is needed
- verify the field now lands in cached `fields_json`
- do not change FRT KPI formulas yet unless necessary
- do not mix in Development logic

## Forbidden Moves

- do not mark WS1 fully converged
- do not mark FRT trusted
- do not include Development backlog in the first evaluator brief
- do not broaden into P1/P2 slices
- do not create holdouts beyond the evaluator-brief stage yet unless the subset is truly ready

## Completion Standard

This manager loop is complete when:

- Build Loop 02 results are incorporated into governance state
- FRT recovery has a concrete next build brief
- a clear decision is made about partial evaluator engagement
- Development backlog remains explicitly blocked rather than silently deferred

## Return Summary

Return a concise summary of:

- what parts of WS1 are now evaluable
- what parts remain blocked
- what Build Loop 03 should do
- whether the first partial evaluator brief should now be created
