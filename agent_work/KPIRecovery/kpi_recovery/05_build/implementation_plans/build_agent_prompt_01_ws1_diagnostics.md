# Build Agent Prompt 01 — WS1 Diagnostic Instrumentation

Use this prompt for the next phase-sized Build Agent loop in the NOVA KPI Engine Recovery & Trust Restoration programme.

---

## Prompt

You are the Build Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

You are working inside an existing mature codebase using the repository orchestration rules in `AGENTS.md`.

Your role is to perform bounded discovery and instrumentation work only for this loop.

Do not treat this as a broad KPI fix sprint.

## Programme Context

The current KPI system is not yet trusted. The Manager Agent has completed WS1 Loop 01 and determined that the immediate next step is a read-only discovery and instrumentation pass before broader fixes are routed.

This loop exists to reduce ambiguity around:

- SLA field identity and field presence in cached Jira data
- Customer Care request-type coverage that affects the ghost KPI fix
- n8n Development query parity, if easily discoverable from the local codebase

## Inputs You Must Read First

- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop01.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_comprehensive_audit_2026-05-20.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/known_failures_log.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/current_architecture_map.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/data_lineage_map.md`

## Scope For This Loop

This loop contains three bounded tasks.

### Task A — SLA Field Diagnostic

Goal:
Determine which SLA-related custom fields are actually present in cached Jira records and whether the KPI pipeline is reading the correct ones.

Required outcome:

- sample 5-10 tickets with known or likely SLA breach conditions
- inspect the cached `fields_json` payload for those tickets
- record which custom fields are present among likely SLA candidates, including but not limited to:
  - `customfield_10010`
  - `customfield_14046`
  - `customfield_14048`
- note whether the payload shape appears compatible with the current parser
- do not guess final field authority unless the evidence is explicit

### Task B — Customer Care Request-Type Audit

Goal:
Determine whether tightening the ghost KPI emission guard would hide legitimate CC tickets because `ccBucket()` fails to map some valid request types.

Required outcome:

- list distinct request-type values for tickets currently landing in CC-tier paths
- identify which request types map cleanly into governed CC sub-buckets
- identify which request types fall through to parent `Customer Care` or null / unclassified behaviour
- quantify the size of the fallthrough where possible

### Task C — Optional n8n Development Query Inspection

Goal:
If the local codebase contains the relevant n8n workflow definition, determine whether the Development backlog query filters by issue type.

Required outcome:

- inspect local workflow/config files only if readily available
- capture the exact Development backlog filter or JQL if found
- if not locally discoverable, report that clearly without inventing it

This task is lower priority than Tasks A and B.

## Explicit Non-Scope

Do not do any of the following in this loop:

- do not deploy the ghost KPI emission fix yet
- do not change KPI calculation logic yet
- do not change Development backlog logic yet
- do not implement missing KPIs
- do not work on CSAT, agent-level KPIs, escalation counts, derived KPIs, or digest/report features
- do not redesign architecture

## Allowed Work

You may:

- inspect code
- inspect local SQL schemas, cached records, and configuration
- add temporary or controlled diagnostic instrumentation if needed
- run safe read-only queries or scripts
- create factual artefacts in the KPI recovery workspace

If you add any temporary instrumentation, keep it minimal and document it clearly.

## Required Outputs

Create or update the following:

1. `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop01_diagnostics.md`
   - factual summary of what you inspected
   - what you found
   - what remains blocked

2. `agent_work/KPIRecovery/kpi_recovery/05_build/fixes_applied/`
   - only if you actually add a small diagnostic patch worth tracking

3. `agent_work/KPIRecovery/kpi_recovery/01_discovery/current_architecture_map.md`
   - update only if you confirm concrete architecture details not already recorded

4. `agent_work/KPIRecovery/kpi_recovery/01_discovery/data_lineage_map.md`
   - update only if you confirm concrete lineage details from inspection

5. `agent_work/KPIRecovery/kpi_recovery/01_discovery/known_failures_log.md`
   - update only if a suspected failure can be sharpened with new factual evidence

## Required Reporting Structure

In your build report, include these sections:

1. Work completed
2. SLA diagnostic findings
3. CC request-type audit findings
4. n8n Development query findings
5. Confirmed blockers
6. Recommended next manager action

## Key Questions You Are Trying To Answer

1. Are `customfield_14046` and `customfield_14048` actually present in cached Jira records?
2. Is `customfield_10010` the only SLA-like field consistently present?
3. Does the current parser appear structurally compatible with the real cached field shape?
4. Are there legitimate Customer Care request types that currently fall outside governed CC buckets?
5. Is there local evidence that n8n filters Development backlog by issue type?

## Business Definition Request For Nick

Do not answer this yourself.

Your report should restate this open manager question exactly as an unresolved dependency:

`Should the Development backlog count include all issue types (Support, Bug, Task, Sub-task), or only Support requests?`

## Completion Standard

This build loop is complete when:

- the SLA field ambiguity is reduced with direct evidence from cached records
- the CC request-type fallthrough risk is evidenced
- the Development query parity question is answered if locally discoverable
- the report is factual, bounded, and ready for the next manager decision

## Output Style

- keep reporting factual and implementation-aware
- do not self-certify KPI correctness
- distinguish evidence from inference
- if something cannot be confirmed locally, say so plainly
