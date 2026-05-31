# Build Status — KPX-WP6A: Escalations Parity Populated-Path Proof Fixture

**Date:** 2026-05-31
**Work package:** KPX-WP6A
**Author:** Build Agent

## Summary

Added a tightly-bounded, disposable fixture path that proves the **populated**
Escalations parity behaviour end-to-end through the **real clean-sheet data
path**, then cleans itself back out. No escalation-family values are fabricated:
the fixture inserts real *source* rows (a disposable Jira space + tickets +
`escalation_log` events) and lets the live engine compute the family exactly as
production does.

## What was added

### New service — `src/server/services/kpi-engine/kpi-fixture.ts`

`KpiEscalationFixtureService` with four operations, all scoped to a single
disposable space `__ESCFX` / Jira project `ZZESCFX`:

- **`seed({ withRejection? })`** — (re)builds the fixture:
  1. inserts the disposable space into `kpi_spaces` (`is_jira_space=1`) and
     enables exactly the three escalation-family bindings in `kpi_space_metrics`
     (`escalation_rate`, `escalation_accuracy`, `rejection_rate`);
  2. inserts 5 tickets into `jira_issue_cache` (project `ZZESCFX`, open, recent,
     split across 2 fixture agents);
  3. inserts 2 genuine `escalation_log` events (type `manual`, one per agent);
  4. recomputes through the live engine — writes a current snapshot
     (`engine.computeSpaceMetrics` → `engine.writeSnapshots`) and freezes 7
     trailing days via `eod.captureSpace` (→ `kpi_daily`, `kpi_agent_daily`,
     `kpi_eod_snapshot`).
- **`addRejection()`** — captures a real bounce-back (`escalation_log` type
  `rejection`) on top of an existing seed, then recomputes. This is the
  transition demonstrator.
- **`teardown()`** — exhaustively deletes every fixture row across all touched
  tables, bounded strictly to the fixture space/project.
- **`status()`** — reports presence + row counts.

### Wiring

- Constructed in `initKpiFoundation` and exposed on the `KpiFoundation` object
  (`escalationFixture`), alongside the other Phase 1–5 services.
- Routes added to `src/server/routes/kpi-engine.ts`:
  - `GET  /api/kpi/fixtures/escalations` — current fixture status.
  - `POST /api/kpi/fixtures/escalations` with `{ action: 'seed' | 'add-rejection' | 'teardown' | 'status', withRejection? }`.

## How it exercises real populated behaviour

The fixture deliberately uses **only** the production compute path — the same
`escalation_rate` / `escalation_accuracy` / `rejection_rate` computers, the same
`source-providers.ts` escalation fetch (joining `escalation_log` to
`jira_issue_cache` by `ticket_key`), the same snapshot and EOD-freeze code, and
the same `getEscalationsParity()` read model. The fixture supplies real rows; the
engine produces the numbers.

Designed observable progression (all from `GET /api/kpi/escalations-parity`):

1. **After `seed`** — `escalation_rate` resolves to a **real populated %**
   (2 escalations across 5 tickets → 40.0%), with a live snapshot value, a
   7-day daily history, and a per-agent breakdown (Agent A 1/3 = 33.3%,
   Agent B 1/2 = 50.0%). `escalation_accuracy` and `rejection_rate` honestly
   read **"—"** (awaiting capture) because no bounce-back exists yet — the
   computers return `null` so no snapshot/daily row is written.
2. **After `add-rejection`** — one real `rejection` event is captured, so
   `escalation_accuracy` and `rejection_rate` **transition from "—" to real
   values** (accuracy = (2−1)/2 = 50.0%, rejection_rate = 1/5 = 20.0%), at
   space level, in 7-day history, and per agent.
3. The 7-day history and per-agent breakdown populate purely from clean-sheet
   `kpi_daily` / `kpi_agent_daily` outputs written by `eod.captureSpace`.

## How cleanup / teardown is performed

`teardown()` issues bounded `DELETE`s for the fixture space/project across
`escalation_log` (`ticket_key LIKE 'ZZESCFX-%'`), `jira_issue_cache`
(`project_key = 'ZZESCFX'`), and every `kpi_*` table keyed on
`space_key = '__ESCFX'` (`kpi_snapshots`, `kpi_daily`, `kpi_agent_daily`,
`kpi_eod_snapshot`, `kpi_tier_definitions`, `kpi_holidays`, `kpi_space_metrics`,
`kpi_spaces`). After teardown the Escalations parity surface omits the fixture
space and every real space is unchanged — honest null/awaiting behaviour
restored. `seed` is itself idempotent (full rebuild), so a re-seed never leaves
stale rows.

## Honesty / safety properties

- No fabricated metric values — only real source rows; the engine computes the
  family.
- Preserves honest null/awaiting behaviour when the fixture is absent (real
  spaces untouched; parity view simply omits the missing fixture space).
- Does not consume or reference evaluator holdouts.
- Touches no legacy KPI pipeline, no `techservicesjsm`, no forbidden table — all
  writes are on the NOVA main pool clean-sheet tables.

## Remaining bounded gap

- While the fixture is **present**, the 3-minute snapshot job and the EOD cycle
  may also pick up the fixture space during its compute window and write
  additional (real, correct) snapshot/daily rows for it. This is harmless and is
  fully removed by `teardown`, but it means the fixture is intended to be seeded,
  evaluated, and torn down within a session rather than left resident.
- History rows for the trailing 7 days carry the same computed value per day
  (the escalation source is window-independent), so the sparkline is flat — it
  proves history *populates* from clean-sheet output, not day-over-day variance.

## Build verification

- `npx tsc -p tsconfig.json --noEmit` — no new errors in the touched files. The
  only reported error is pre-existing and unrelated (`kpi-pipeline.ts:1043`).

## Ready for independent evaluation?

**Yes.** The populated Escalations parity path is now exercisable and disposable
via `POST /api/kpi/fixtures/escalations` (`seed` → `add-rejection` → `teardown`)
and observable via `GET /api/kpi/escalations-parity`, with honest null/awaiting
behaviour preserved before capture and after teardown.
