# Build Agent Prompt 02 — WS1-C FRT Recovery

Use this prompt for the next Build Agent loop in the NOVA KPI Engine Recovery & Trust Restoration programme.

---

## Prompt

You are the Build Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

You are working inside an existing mature codebase using the repository orchestration rules in `AGENTS.md`.

Your role is to execute a tightly bounded corrective build for **WS1-C: FRT Recovery**.

Do not treat this as a general KPI sweep.

## Current State

WS1 has now split into sub-slices:

- **WS1-A:** Ghost suppression / CC tier visibility
- **WS1-B:** Resolution SLA source verification
- **WS1-C:** FRT recovery
- **WS1-D:** Development backlog definition/parity

WS1-A and WS1-B are already on the path to partial evaluation.

Your task is only to advance **WS1-C**.

## Inputs You Must Read First

- `agent_work/KPIRecovery/kpi_recovery/03_workstreams/ws1_source_of_truth/ws1_manager_brief_loop03.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/implementation_plans/ws1_build_loop03_frt_recovery.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop02.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop02_resolution_sla.md`
- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`

## Confirmed Facts

Treat the following as established:

- `customfield_14046` is the authoritative First Reply Time SLA field
- Jira returns `customfield_14046` when explicitly requested
- NOVA cache lacks FRT data only because `customfield_14046` is missing from `ALL_FIELDS` in `jira-sync-service.ts`
- this is a bounded acquisition fix, not a formula-design problem
- do not touch Development backlog logic
- do not change Resolution SLA logic unless an unexpected defect is discovered

## Mission

Execute the FRT recovery build described in:

`agent_work/KPIRecovery/kpi_recovery/05_build/implementation_plans/ws1_build_loop03_frt_recovery.md`

The core goals are:

1. add `customfield_14046` to the Jira sync field list
2. ensure a full re-sync path is executed or clearly documented
3. verify FRT data now lands in cached `fields_json`
4. verify the existing parser can read the FRT field structure
5. verify FRT KPI outputs stop defaulting to trivial values

## In Scope

- updating `jira-sync-service.ts`
- any minimal associated code change required to fetch/store the FRT field
- safe re-sync execution or safe documented re-sync procedure
- verification queries / scripts
- factual build reporting

## Out Of Scope

- changing FRT KPI formulas unless the field-structure proof forces it
- Development backlog count
- Resolution SLA logic redesign
- CSAT, escalation, agent metrics, derived KPIs
- evaluator brief creation
- regression baseline creation

## Required Outputs

Create or update:

1. `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop03_frt.md`
   - factual report of what changed and what was verified

2. `agent_work/KPIRecovery/kpi_recovery/05_build/fixes_applied/`
   - only if you add a small fix record worth retaining

3. `agent_work/KPIRecovery/kpi_recovery/01_discovery/current_architecture_map.md`
   - only if the re-sync path or cache acquisition path needs factual clarification

4. `agent_work/KPIRecovery/kpi_recovery/01_discovery/data_lineage_map.md`
   - only if FRT lineage is now materially more explicit

## Required Report Sections

Your report should include:

1. Change applied
2. Re-sync method used
3. FRT field presence verification
4. Parser compatibility findings
5. KPI output verification
6. Unexpected findings
7. Remaining blockers
8. Recommendation for manager next step

## Success Standard

This build loop is complete when:

- `customfield_14046` is included in `ALL_FIELDS`
- the cache has been refreshed enough to evidence FRT field presence
- FRT field structure is confirmed compatible with the current parser, or any incompatibility is explicitly documented
- at least one post-refresh KPI output shows FRT metrics are no longer trivial default values

## Reporting Rules

- distinguish clearly between evidence and inference
- do not self-certify trust or convergence
- if the re-sync cannot be fully executed in this environment, document exactly what remains to be run and what evidence is still missing
