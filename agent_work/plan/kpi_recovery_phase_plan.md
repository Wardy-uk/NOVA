# KPI Recovery Phase Plan

## Delivery Order

1. Phase 0: prerequisite audit of live `jira_issue_cache` field coverage and `/api/kpi/*` route-prefix safety.
2. Manager review of Phase 0 findings.
3. If prerequisites fail, route a bounded prerequisite blocker-closure brief before Phase 1.
4. Re-review closure evidence and decide whether Phase 0 is cleared.
5. If prerequisites pass, issue Phase 1 foundation build brief as a single work package.
6. After Build completion of Phase 1, issue evaluation criteria and protected holdouts separately.
7. Route iteration briefs only if evaluation finds scoped behavioural gaps.

## Scope Boundaries

- The clean-sheet design in `KPI-Clean-Sheet-Design.md` is the scope source of truth.
- No redesign of schema, architecture, schedules, or API surface.
- No feature creep beyond the specified KPI platform and its defined phases.
- Old KPI system remains untouched and running in parallel unless the spec explicitly says otherwise.

## Phase 0 Output Expectation

- One factual build-status report that states:
  - which required `jira_issue_cache` fields are present
  - which required fields are missing
  - whether `/api/kpi/*` collides with existing routes
  - whether Phase 1 is unblocked or blocked

## Current Phase 0 Classification

- `P0-WP1` completed with a blocked outcome.
- `P0-WP2` cleared both Phase 0 blockers.
- NTPJ story points are confirmed as `customfield_11706` and now enter the sync payload.
- `/api/kpi/*` remains viable for the new KPI API family.
- `resolutiondate` exposure was also added during blocker closure and should be treated as a ready Phase 1 input.

## Phase 1 Planned Shape

- Single work package covering the clean-sheet Phase 1 foundation slice:
  - new `kpi_*` tables in the NOVA database
  - seed data for spaces, metrics, space-metric bindings, and tiers
  - business-hours engine
  - pluggable metric computation framework
  - 3-minute snapshot scheduler
  - backfill scripts from legacy tables into the new `kpi_*` schema

## Current Active Build Slice

`P1-WP1` is the active build slice. It remains intentionally broad only to the exact extent already locked in by the clean-sheet spec's Phase 1 definition.

## Current Evaluation Posture

- `P1-WP1` is ready for independent evaluation.
- Evaluation should validate only the observable Phase 1 foundation outcomes:
  - new parallel schema presence
  - seed/config presence
  - business-hours correctness
  - computation-path availability
  - snapshot execution path
  - delivered backfill behaviour
  - legacy non-regression
- Bounded residual gaps already declared by Build should be tested for honest classification, not silently absorbed into scope.

## Current Iteration Posture

- `P1-WP1` failed evaluation because the foundation was observably absent and silently non-operational at runtime.
- The next slice is intentionally narrow: restore observable activation of the already-scoped Phase 1 foundation.
- Do not expand into new metrics, views, manual entry, digests, or broader backfill during this iteration.

## Current Re-Evaluation Posture

- `P1-WP1-ITER1` claims to have restored activation, route reachability, scheduler registration, and honest init surfacing.
- Re-evaluation should confirm that the prior failure mode is actually gone in runtime, not just claimed in logs or code comments.
- Re-evaluation should still judge the broader Phase 1 foundation outcome, but with first attention on:
  - schema creation
  - seed presence
  - `/api/kpi/*` reachability
  - snapshot-job observability
  - explicit success/failure surfacing

## Next Delivery Slice

`P2-WP1` is the next governed work package and should cover only the clean-sheet Phase 2 outcomes already locked in by the spec:

- EOD capture job for UK spaces and STBY
- writes into `kpi_daily`, `kpi_agent_daily`, and `kpi_eod_snapshot`
- RAG status computation
- daily report payload endpoint for the thin n8n email trigger

This slice should not absorb:

- manual-entry flows
- dashboard/view delivery
- AI digests
- admin UI
- optional auth-route evidence cleanup from Phase 1

## Current Evaluation Posture

- `P2-WP1` is ready for independent evaluation.
- Evaluation should validate only the observable Phase 2 outcomes:
  - EOD capture behaviour for UK spaces and STBY
  - writes into `kpi_daily`, `kpi_agent_daily`, and `kpi_eod_snapshot`
  - configurable RAG behaviour
  - daily-report payload availability
  - idempotent recapture behaviour
  - legacy non-regression

## Current Iteration Posture

- `P2-WP1` failed evaluation because the core freeze/write path was not directly observable in the available runtime window.
- The next slice is intentionally narrow: make the Phase 2 capture path operator-triggerable and therefore behaviourally testable on demand.
- Do not expand into Phase 3, manual-entry/import, digests, or broad backfill during this iteration.

## Current Re-Evaluation Posture

- `P2-WP1-ITER1` claims to have fixed trigger semantics, not the freeze logic itself.
- Re-evaluation should verify that forced capture now drives the real freeze path and lands observable rows in the frozen tables.
- Re-evaluation should explicitly test idempotent recapture using the forced path.

## Next Delivery Slice

`P2-RP1` is the next governed slice.

It should protect, not expand, the now-converged Phase 2 behaviour:

- forced capture writes `kpi_daily`
- forced capture writes `kpi_agent_daily`
- forced capture writes `kpi_eod_snapshot`
- `daily-report/:date` reflects frozen outputs
- repeated capture remains idempotent
- gated scheduler does not inflate forced rows
- legacy KPI behaviour remains untouched

## Current Regression Evaluation Posture

- `P2-RP1` is ready for independent regression evaluation.
- Evaluation should validate only the protected Phase 2 invariants:
  - forced capture frozen writes
  - daily-report fidelity to frozen outputs
  - idempotent repeated capture
  - gated scheduler non-inflation
  - legacy non-regression
- The sentinel-date harness is an implementation choice; the evaluator should judge only the observable protected behaviour and restoration discipline.

## Next Delivery Slice

`P3-WP1` is the next governed slice and should cover only the clean-sheet Phase 3 outcomes already locked in by the spec:

- SLT cross-space dashboard view
- team dashboard view
- agent scorecard view
- rewiring wallboards to the clean-sheet KPI data source

This slice should not absorb:

- manual-entry/import flows
- AI digests
- admin UI
- optional auth-route process cleanup

## Current Evaluation Posture

- `P4-WP1` is ready for independent evaluation.
- Evaluation should validate only the observable Phase 4 outcomes:
  - manual entry UI behaviour for non-Jira teams
  - any-date select/edit flow
  - prefill of existing and promoted values
  - value-type validation
  - promotion into `kpi_daily`
  - spreadsheet import dry-run and real import behaviour
  - honest reporting of unmapped/rejected rows
  - legacy non-regression

## Next Delivery Slice

`P4-WP1` is the active governed slice and should cover only the clean-sheet Phase 4 outcomes already locked in by the spec:

- manual entry UI for non-Jira teams
- spreadsheet import endpoint and parser
- historical/manual promotion into `kpi_manual_entries` and `kpi_daily`

This slice should not absorb:

- AI digests
- admin UI
- broader Phase 3 polish
- optional auth-process cleanup

## Current Iteration Posture

- `P4-WP1` failed evaluation because the manual write/import capability was absent at runtime even though manual-team read surfaces existed.
- The next slice is intentionally narrow: restore route mounting and observable write/import behaviour for the already-scoped Phase 4 capability.
- Do not broaden into Phase 5, broader view polish, or auth-process cleanup during this iteration.
