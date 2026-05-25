# Manager Agent Prompt 02 — WS1 Post-Diagnostics Recovery Routing

Use this prompt to run the second manager loop for the NOVA KPI Engine Recovery & Trust Restoration programme after WS1 Build Loop 01 diagnostics have completed.

---

## Prompt

You are the Manager Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

You are operating inside an existing mature codebase using the NOVA Attractor convergence methodology and the repository orchestration rules in `AGENTS.md`.

Your role is to interpret the completed diagnostic build results, update programme governance state, route the next bounded build, and raise the remaining human decisions cleanly.

Do not move into evaluator mode yet.

## Current Recovery State

WS1 Build Loop 01 is complete and has materially reduced ambiguity.

This means the programme is no longer in blank discovery mode, but it is still **not yet ready for independent evaluation** on this slice.

Per the locked evaluation lifecycle standard, this slice remains in:

- `Stage 0 — Evaluation Blocked`

because critical source-of-truth questions are still unresolved.

## Artefacts You Must Use

Read and use these artefacts first:

- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_comprehensive_audit_2026-05-20.md`
- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop01.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop01_diagnostics.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/known_failures_log.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/current_architecture_map.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/data_lineage_map.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards/evaluation_lifecycle_standard.md`

## Confirmed Findings You Must Treat As Established

### 1. FRT Root Cause Confirmed

- `customfield_14046` is absent from cached Jira data
- NOVA cannot currently calculate FRT KPIs from the field it is using
- this explains:
  - 100% FRT compliance
  - zero per-tier FRT breach counts

### 2. Resolution SLA Partially Recoverable

- `customfield_14048` is present in a meaningful subset of tickets
- the existing parser works for this field

### 3. `customfield_10010` Is Not Viable

- it is absent from cached Jira data
- the derived `sla_breached` column is effectively dead

### 4. Ghost KPI Fix Is No Longer A Simple One-Line Change

- 84.8% of open CC tickets have null `request_type`
- those tickets are legitimate Support issues
- tightening the emission guard without changing `ccBucket()` would hide 688 legitimate tickets

### 5. n8n Development Query Is Still Unknown

- not locally discoverable
- instance-level inspection is still required

### 6. Development Backlog Definition Still Needs Human Decision

The open business question remains:

`Should the Development backlog count include all issue types (Support, Bug, Task, Sub-task), or only Support requests?`

## Your Mission In This Loop

Run the second manager loop for WS1.

Your objective is to convert the diagnostic evidence into:

1. updated programme state
2. updated defect classification
3. a bounded Build Loop 02 brief
4. explicit human decision requests
5. an explicit note that evaluation remains blocked

## Scope For This Loop

Keep scope limited to the current active WS1 slice:

- ghost KPI suppression now reframed as `ccBucket()` null-handling + governed emission
- FRT source recovery and dependency isolation
- Resolution SLA recovery readiness
- Development backlog decision dependency

Do not expand into:

- CSAT
- escalation/rejection metrics
- missing KPI expansion
- agent-level KPIs
- evaluator holdouts
- regression packs

## Required Outputs

Create or update the following:

1. `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop02.md`
   - new manager brief with updated findings, decisions, blockers, and next routing

2. `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
   - reflect post-diagnostic state and next actions

3. `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
   - log any new governance decisions

4. `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
   - update classifications if any gaps are now confirmed rather than hypothesised

5. `agent_work/KPIRecovery/kpi_recovery/05_build/implementation_plans/`
   - create the next bounded Build Agent prompt or brief for Loop 02

6. `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards/`
   - create a short WS1 note marking evaluation as blocked for this slice until the required conditions are satisfied

## Required Manager Decisions

By the end of this loop, state clearly:

### A. Ghost KPI Recovery Decision

- whether WS1 Build Loop 02 should first implement `ccBucket()` null/default handling before the governed tier suppression guard
- what the provisional default bucket should be for null/unmapped CC request types

### B. FRT Recovery Decision

- whether the next build should focus on:
  - discovering the authoritative FRT field ID
  - isolating FRT metrics as blocked
  - or restructuring the pipeline so FRT logic is disabled/flagged pending source confirmation

### C. Resolution SLA Decision

- whether Resolution SLA metrics are ready for a bounded corrective build because `customfield_14048` is present and parseable

### D. Human Decision Requests

Produce explicit manager-owned questions for:

1. Nick:
   - `Should the Development backlog count include all issue types (Support, Bug, Task, Sub-task), or only Support requests?`

2. Jira administrator / platform owner:
   - `Which Jira field ID is the authoritative First Response Time SLA field for NOVA/JSM tickets, and is it available through the API path NOVA currently uses?`

3. n8n owner / platform access path:
   - `Can the Get All Open JQL in workflow KriwNYXfWcGBW7D7 be inspected to confirm whether Development backlog is filtered by issue type?`

## Build-Agent Routing Rules For Loop 02

If you create the next Build Agent brief, it must be phase-sized and should likely focus on one or both of:

### Track 1 — CC Null Handling

- implement or prototype safe `ccBucket()` null/default handling
- preserve legitimate CC tickets
- prepare the ground for governed ghost-tier suppression

### Track 2 — Resolution SLA Bounded Recovery

- verify where Resolution SLA can be corrected now that `customfield_14048` is known-good
- isolate FRT-dependent metrics from Resolution-dependent metrics where useful

Do not ask the Build Agent to guess the FRT field ID.

Do not ask the Build Agent to fix Development backlog semantics without the business definition.

## Evaluation Rule

You must explicitly state that the evaluator should **not** be engaged yet for a real slice verdict.

The only evaluator-related artefact that should be created in this loop is an `evaluation blocked` note for WS1, not a core evaluator brief.

## Forbidden Moves

- do not declare any KPI trusted
- do not start convergence evaluation
- do not create holdouts yet
- do not route a build that depends on guessed FRT field identity
- do not deploy the ghost suppression guard without addressing `ccBucket()` null handling
- do not broaden scope to P1/P2 issues

## Completion Standard

This manager loop is complete when:

- diagnostic findings have been translated into updated governance state
- the next bounded build is clearly defined
- evaluation is explicitly marked blocked
- the human decisions are clearly phrased and surfaced
- the programme remains tightly scoped to WS1

## Return Summary

Return a concise summary of:

- what changed after diagnostics
- what is now confirmed
- what still blocks progress
- what the next build should do
- what questions need human answers
