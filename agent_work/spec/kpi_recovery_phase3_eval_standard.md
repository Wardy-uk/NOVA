# KPI Recovery Phase 3 Evaluation Standard

## Work Package

`P3-WP1`

## Pass Standard

`P3-WP1` passes when:

1. SLT, team, and agent views are observably present
2. those views are observably backed by the clean-sheet KPI data source
3. the new wallboards are observably backed by the clean-sheet KPI data source
4. sparse/manual-team cases are handled honestly
5. legacy KPI behaviour remains materially unaffected

## Qualified Pass Standard

`P3-WP1` may receive a qualified pass when the core view surfaces are observably correct and clean-sheet-backed, even if bounded gaps remain around sparse source data, fallback wallboard metric selection, or limited agent-metric depth.

## Fail Standard

Evaluation fails if any of the following occurs:

- any core Phase 3 view surface is absent
- views or wallboards still depend on legacy KPI sources as their authoritative data path
- sparse/manual-team data is fabricated or misleading
- legacy KPI behaviour is materially regressed
