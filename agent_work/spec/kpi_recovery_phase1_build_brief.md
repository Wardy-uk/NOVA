# KPI Recovery Phase 1 Build Brief

## Work Package

`P1-WP1` — Clean-sheet KPI foundation delivery.

## Objective

Deliver the complete Phase 1 foundation slice defined in `KPI-Clean-Sheet-Design.md` so the new KPI platform can begin producing governed data in parallel with the untouched legacy KPI system.

## Scope Source

The scope source of truth is:

- `C:\Users\NickW\Claude\windows automation\daypilot\KPI-Clean-Sheet-Design.md`

Do not redesign or expand it. Deliver only what Phase 1 already defines.

## Required Behavioural Outcome

At the end of this work package, the repository and runtime should contain a new, separate KPI foundation that can:

1. store KPI data in new `kpi_*` tables in the NOVA database
2. represent the defined spaces, metrics, per-space metric configuration, and NT tiers
3. compute business-hours-based SLA timings for the defined Jira spaces
4. execute pluggable metric computation for enabled metrics using the NOVA-side cache path
5. capture recurring snapshots on the defined Phase 1 cadence
6. backfill new `kpi_*` tables from the specified legacy sources without altering the legacy system

## Included Scope

Deliver the Phase 1 foundation slice as specified:

- all new `kpi_*` database tables in the NOVA database using the main MSSQL pool
- seed data for:
  - spaces
  - metric definitions
  - space-metric bindings
  - tier definitions
- business hours engine
- metric computation framework with pluggable computers
- snapshot scheduler on the defined 3-minute cycle
- backfill scripts from legacy tables into the new `kpi_*` schema

## Critical Constraints

- Everything new. Do not modify existing KPI tables, routes, views, or components unless a tightly bounded prerequisite already cleared in Phase 0 requires coexistence handling.
- The old KPI system must remain running in parallel and behaviourally untouched.
- New tables must live in the NOVA database via `services/database.ts`, not the KPI pipeline pool.
- Never reference forbidden tables:
  - `JiraSlaRaw`
  - `JiraSlaRawArchive`
  - `JiraSlaRawArchiveOld`
  - `JiraSlaRawOld`
  - `JiraTickets`
  - `JiraTicketsArchive`
  - `JiraTicketsUAT`
- All new tables must use the `kpi_` prefix.
- SLA targets must remain configurable, not hardcoded.
- CS/KAM ticket classification must follow the design rule:
  - `Key_Account` or `Enterprise_Account` label means KAM
  - absence of both means CS

## Phase 0 Inputs Now Available

The following prerequisite findings are cleared and should be treated as active inputs:

- NTPJ story points source of truth is `customfield_11706`
- `/api/kpi/*` remains a viable namespace for the clean-sheet KPI API family
- `resolutiondate` exposure has been added to the sync path

The following are not blockers, but should be handled honestly in the completion report if they affect completeness:

- NTPJ story points are currently zero in source Jira data
- STBY currently has zero cache rows
- a sync cycle is required before newly added fields fully populate the cache

## Deliverable

Write one markdown completion report to `agent_work/build_status/` for `P1-WP1` that states:

- what was delivered
- what remains incomplete or blocked
- what assumptions were required
- whether the work package is ready for independent evaluation

## Out of Scope

- Phase 2 EOD and daily capture behaviour
- manual-entry UI
- spreadsheet import flow
- dashboard/view delivery
- AI digests
- config admin UI

## Manager Decision Rule

`P1-WP1` moves to evaluation only when the Build Agent reports that the complete foundation slice is present as a coherent new parallel system, with any residual gaps explicitly listed and bounded.
