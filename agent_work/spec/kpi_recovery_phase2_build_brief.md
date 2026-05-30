# KPI Recovery Phase 2 Build Brief

## Work Package

`P2-WP1` — EOD and daily-capture delivery.

## Objective

Deliver the clean-sheet Phase 2 slice so the new KPI foundation can freeze official daily values, agent daily values, and EOD ticket-state outputs, and expose the daily-report payload for the thin n8n email trigger.

## Scope Source

The scope source of truth is:

- `C:\Users\NickW\Claude\windows automation\daypilot\KPI-Clean-Sheet-Design.md`

Deliver only the Phase 2 outcomes already defined there. Do not redesign or broaden them.

## Required Behavioural Outcome

At the end of this work package, the new parallel KPI system should be able to:

1. perform EOD capture for UK spaces at 17:30 Europe/London
2. perform EOD capture for STBY at 18:00 Asia/Kolkata
3. write official daily metric rows into `kpi_daily`
4. write agent-level daily rows into `kpi_agent_daily` for implemented agent metrics
5. write EOD ticket-state output into `kpi_eod_snapshot`
6. compute and persist RAG status using configurable targets/bands
7. expose the daily-report payload endpoint the thin n8n trigger is meant to call

## Included Scope

- EOD capture job(s) aligned to the clean-sheet schedule
- capture/freeze logic from snapshot/computation state into:
  - `kpi_daily`
  - `kpi_agent_daily`
  - `kpi_eod_snapshot`
- RAG status computation against configured targets and amber bands
- daily report API endpoint for the new KPI system

## Constraints

- Keep the legacy KPI system untouched and running in parallel.
- Build on the live clean-sheet foundation delivered in Phase 1.
- Do not broaden into Phase 3 views, Phase 4 manual entry/import, AI digests, or admin UI.
- Do not consume evaluator holdouts.
- Keep SLA targets configurable and derived from stored config, not hardcoded.
- Preserve the existing Phase 1 route namespace and do not fold the optional auth-route evidence gap into core delivery.

## Deliverable

Write one markdown completion report to `agent_work/build_status/p2-wp1-eod-daily-2026-05-30.md` that states:

- what was delivered
- what remains incomplete or bounded
- what assumptions were required
- whether the work package is ready for independent evaluation
