# KPI Recovery Phase 5 Build Brief

## Work Package

`P5-WP1` — AI digest, config admin, health monitoring, and final KPI polish.

## Objective

Deliver the clean-sheet Phase 5 slice so the new KPI platform can generate digests, expose configuration/admin controls, surface health status, and complete the planned n8n simplification.

## Scope Source

The scope source of truth is:

- `C:\Users\NickW\Claude\windows automation\daypilot\KPI-Clean-Sheet-Design.md`

Deliver only the Phase 5 outcomes already defined there. Do not redesign or broaden them.

## Required Behavioural Outcome

At the end of this work package, the new parallel KPI system should be able to:

1. generate AI digests per space
2. generate a cross-space SLT digest
3. expose a config admin UI for:
   - spaces
   - metrics
   - tiers
   - holidays
   - health
   - import
4. expose health monitoring for the clean-sheet KPI engine
5. leave the old n8n logic reduced to the thin trigger pattern described in the clean-sheet design

## Included Scope

- AI digest generation and storage in `kpi_digests`
- cross-space SLT digest generation
- config/admin UI for the clean-sheet KPI platform
- health monitoring/dashboard for the clean-sheet KPI platform
- any bounded n8n-facing adjustments required to complete the thin-trigger model

## Constraints

- Keep the legacy KPI system untouched and running in parallel unless the clean-sheet spec explicitly calls for reducing old n8n logic to a thin trigger only.
- Build on the converged Phase 1–4 substrate and Regression Protected Phase 2 slice.
- Do not consume evaluator holdouts.
- Keep bounded polish inside the explicit Phase 5 areas: digests, admin/config, health, and thin-trigger completion.
- Do not reopen earlier converged slices unless the Phase 5 scope genuinely requires it.

## Notes From Prior Phases

- Manual-entry/import is now converged but still has bounded real-workbook mapping variance.
- Phase 3 wallboards still rely on honest fallback selection because no seed rows yet set `show_on_wallboard = 1`.
- Snapshot sparsity and manual-team display gaps should be surfaced honestly through health/admin surfaces rather than hidden.

## Deliverable

Write one markdown completion report to `agent_work/build_status/p5-wp1-final-slice-2026-05-30.md` that states:

- what was delivered
- what remains incomplete or bounded
- what assumptions were required
- whether the work package is ready for independent evaluation
