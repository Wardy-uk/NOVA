# KPI Recovery Phase 4 Evaluation Brief

## Work Package

`P4-WP1` — Independent evaluation of manual entry and spreadsheet import delivery.

## Evaluator Role Boundary

Evaluate observable behaviour only. Do not inspect source code, implementation notes, or build reasoning. Judge what the running system accepts, stores, promotes, and reports.

## Objective

Determine whether the clean-sheet KPI platform now supports honest manual entry and Daily KPI Tracker import for non-Jira teams, including promotion into official daily values.

## Scope

Evaluate only the Phase 4 slice:

- manual entry UI for CS, KAM, ONBOARD, and COMMS
- any-date select/edit behaviour
- prefill of stored/promoted values
- value-type validation
- persistence into `kpi_manual_entries`
- promotion into `kpi_daily`
- spreadsheet import endpoint/parser behaviour
- dry-run preview and unmapped/rejected reporting
- coexistence with the untouched legacy KPI system

Do not expand into:

- Phase 5 digests/polish
- admin UI
- broader dashboard polish beyond whether promoted manual values are honestly represented

## Observable Evaluation Questions

1. Can a user select any relevant manual team and any date, then view/edit the day’s metric values?
2. Are existing stored/promoted values prefilled rather than lost?
3. Does validation match metric `value_type` behaviourally?
4. Do valid saves land in `kpi_manual_entries`?
5. Do valid saves also promote into `kpi_daily` with target/RAG where appropriate?
6. Does tracker import support dry-run preview before writing?
7. Does real import land rows in `kpi_manual_entries` and promote into `kpi_daily`?
8. Are unmapped/rejected rows reported honestly rather than silently dropped or fabricated?
9. Does the legacy KPI system remain behaviourally untouched?

## Known Bounded Non-Blocking Inputs

- The real Tracker workbook may not yet have been used, so live label/layout variance is a legitimate evaluation focus.
- Manual values may not yet be surfaced through all later-phase dashboards; this slice is about entry/import and promotion, not full downstream polish.
- Honest blanks, unmapped labels, or rejected rows are acceptable if they are reported clearly.

These are not automatic failures if the core manual entry/import and promotion behaviour is observably correct.

## Deliverable

Write one markdown report to `agent_work/eval_output/phase4_manual_import_eval_report_2026-05-30.md` that states:

- pass / qualified pass / fail
- what observable behaviour was verified
- any material blocker
- any bounded non-blocking gap
- whether `P4-WP1` is converged for its scoped Phase 4 outcome
