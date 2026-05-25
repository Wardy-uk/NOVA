# Evaluator Agent Prompt 02 — WS1-D Development Backlog Count

Use this prompt now.

WS1-D has been promoted to `SOURCE DEFINED` after bounded cache-freshness recovery. The next lifecycle step is **independent evaluation**.

---

## Prompt

You are the **Evaluator Agent** for the NOVA KPI Engine Recovery & Trust Restoration programme.

Your role in this loop is to perform an **independent behavioural evaluation** of **WS1-D Development backlog count**.

You are evaluating the running system and live/queryable data behaviour, not the code.

## Your Responsibilities

- assess whether the Development backlog KPI now behaves consistently with its governed definition
- use live/runtime evidence only
- avoid reading source code, implementation notes, or build-status details that would bias the evaluation
- report exact evidence, verdict, and residual risk neutrally

## Governed Definition

Development backlog =

> every ticket where `current_tier = Development`

No issue-type filter. No extra status filter beyond excluding `Done`.

## Required Inputs

- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_inventory.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/decision_log.md`
- `agent_work/KPIRecovery/kpi_recovery/07_decisions/gap_classification_log.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1d_cache_recovery_report_loop02.md`
- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop11_ws1d_source_defined.md`

Do not read source code or build-status notes beyond what is necessary from the manager-routed evidence above.

## Evaluation Objective

Determine whether the Development backlog KPI is now:

1. consistent with the governed definition
2. within acceptable parity tolerance against live Jira
3. free from evidence of the prior stale-cache inflation problem

## Required Checks

Perform and report on these checks:

1. **Dashboard / pipeline value check**
   - obtain the current Development backlog KPI value from the runtime/reporting surface or query path available to you

2. **Live Jira parity check**
   - obtain the live Jira count for:
   - `project = NT AND statusCategory != Done AND "Current Tier" = "Development"`
   - compare against the runtime/pipeline value

3. **Tolerance check**
   - verify the difference is within `<= 5`

4. **Deleted-ticket recovery check**
   - use the prior evidence set to assess whether the stale deleted-ticket inflation has been credibly removed

5. **Residual-risk check**
   - state whether any remaining risk is:
   - blocking
   - non-blocking
   - or deferred to WS3

## Pass / Fail Standard

### PASS

- runtime/pipeline Development count is within `<= 5` of live Jira
- evidence is consistent with the governed definition
- no fresh sign of deleted-ticket inflation reappearing in this evaluation window

### FAIL

- parity difference exceeds `5`
- source behaviour contradicts the governed definition
- or the deleted-ticket issue appears unresolved or recurring already

### QUALIFIED PASS

- parity is acceptable
- but a residual structural risk remains that does not invalidate current behaviour

## Out Of Scope

- wallboard label wording
- JSM queue parity
- n8n comparator parity
- permanent reconciliation design in `jira-sync-service.ts`
- broader multi-surface divergence work

## Required Output

Write:

- `agent_work/KPIRecovery/kpi_recovery/04_eval/eval_reports/ws1d_eval_report_01.md`

Include:

1. evaluation date/time
2. evidence sources used
3. governed definition under test
4. runtime/pipeline Development count
5. live Jira count
6. difference and tolerance assessment
7. verdict: PASS / QUALIFIED PASS / FAIL
8. residual risks
9. recommendation for Manager Agent next step

## Completion Standard

This loop is complete when the evaluation report is written and the verdict is explicit.

