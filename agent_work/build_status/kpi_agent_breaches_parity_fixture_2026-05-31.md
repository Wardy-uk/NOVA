# KPX-WP8A — Agent Breaches Parity Proof Fixture — Build Status

**Work package:** KPX-WP8A
**Date:** 2026-05-31
**Status:** Implemented, server typechecks clean (0 errors). Ready for independent behavioural evaluation.

## What was added

A tightly-bounded, disposable fixture that proves the **populated** Agent Breaches
parity path through the real clean-sheet data path, then cleans itself back out.

### New service — `KpiAgentBreachFixtureService`

`src/server/services/kpi-engine/kpi-agent-breach-fixture.ts`. Three operations,
all scoped to a single disposable space `__ABFX` / Jira project `ZZABFX`:

- **`seed()`** —
  1. inserts the disposable space `__ABFX` into `kpi_spaces` (Jira space, active);
  2. binds exactly one breach-evaluable agent-level metric, `resolved_today`, in
     `kpi_space_metrics` with `target_value = 5`, `amber_band = 40`;
  3. inserts 11 tickets into `jira_issue_cache` (project `ZZABFX`), each resolved
     "today" and assigned to one of three fixture agents in differing volumes:
     - Fixture Agent Clear  → 6 tickets resolved today
     - Fixture Agent At-Risk → 4 tickets resolved today
     - Fixture Agent Breach → 1 ticket resolved today
  4. drives the **live engine + EOD freeze** (`engine.computeSpaceMetrics` +
     `engine.writeSnapshots`, then `eod.captureSpace`) so the per-agent values
     land in `kpi_agent_daily` exactly as production freezes them.
- **`teardown()`** — exhaustive, bounded delete of every fixture row.
- **`status()`** — presence + row counts + the *intended* band breakdown (design
  intent only; the actual classification is observed via the live surface).

### New routes

`src/server/routes/kpi-engine.ts` (mounted under `/api/kpi`):

- `GET  /api/kpi/fixtures/agent-breaches` → fixture status (row counts).
- `POST /api/kpi/fixtures/agent-breaches` `{ action: 'seed' | 'teardown' | 'status' }`.

### Wiring

Instantiated in `initKpiFoundation` (`src/server/services/kpi-engine/index.ts`)
as `agentBreachFixture`, added to the `KpiFoundation` interface and the
re-export, and passed into `createKpiEngineRoutes` from `src/server/index.ts`,
alongside the existing Phase 1–5 services and the Escalations fixture (KPX-WP6A).

## How it exercises real Agent Breaches populated behaviour

It fabricates **no** per-agent breach/at-risk/clear result. It inserts only real
**source** rows (a real space + real `jira_issue_cache` tickets) and lets the
unchanged production code compute everything:

- The same Phase-1 computer (`resolved_today`) the Agent Scorecard uses produces
  each agent's value at EOD freeze via `KpiEodService.captureSpace` →
  `kpi_agent_daily`.
- The same surface under test, `KpiViewsService.getAgentBreaches`
  (`GET /api/kpi/agent-breaches`), reads those frozen rows and applies the same
  RAG logic to derive each agent's status.

Because `resolved_today` is direction `higher` with `target = 5` and
`amber_band = 40 %` (band = 2 → green ≥ 5, amber [3,5), red < 3), the three
agents' real computed values place one agent in **each** band purely from volume:

| Agent | resolved_today (real) | RAG | Agent Breaches status |
|---|---|---|---|
| Fixture Agent Clear | 6 | green | **clear / met** |
| Fixture Agent At-Risk | 4 | amber | **at-risk** |
| Fixture Agent Breach | 1 | red | **breach** |

So after `seed()`, `GET /api/kpi/agent-breaches` returns the `__ABFX` card with
`summary.agentsBreaching = 1`, `agentsAtRisk = 1`, `agentsClear = 1` — satisfying
required outcomes 2, 3 and 4 from real data.

`resolved_today` was chosen deliberately over the SLA-compliance metrics: it is
agent-level, has a registered computer, carries a target and a RAG-able
direction, and depends only on the same-day ticket count — no business-hours
arithmetic or comment-timing setup — so the three bands are produced
deterministically by ticket volume alone.

## How cleanup / teardown is performed

`teardown()` (and `POST { action: 'teardown' }`) deletes every fixture row,
bounded strictly to the fixture's own keys — it never touches a real space or
real ticket:

- `jira_issue_cache` where `project_key = 'ZZABFX'`
- every `kpi_*` table keyed on `space_key = '__ABFX'`: `kpi_snapshots`,
  `kpi_daily`, `kpi_agent_daily`, `kpi_eod_snapshot`, `kpi_tier_definitions`,
  `kpi_holidays`, `kpi_space_metrics`, `kpi_spaces`.

After teardown the space no longer exists, so the Agent Breaches surface omits it
and the platform's honest empty-state behaviour is fully restored (outcome 5).
`seed()` is idempotent — it clears its own prior rows first, so a re-seed rebuilds
from scratch and repeated runs leave no residue.

## Honest empty-state preserved

When the fixture is absent, nothing changes: `__ABFX` simply does not exist, so it
never appears on any surface and every real space is untouched. No real space's
breach evaluation is altered, and the existing `unsupportedFamilies` honesty
(legacy live-queue breach families surfaced as unsupported, never invented) is
unchanged.

## Constraints honoured

- **No evaluator holdouts consumed** — no eval criteria, holdout scenarios, or
  eval output were read; the fixture only adds a source-data proof path.
- **No fabricated breach results** — per-agent breach/at-risk/clear states are
  computed by the real `resolved_today` computer + RAG logic from real source
  rows; the fixture writes no `kpi_agent_daily` / breach-status rows directly.
- **Tightly focused & self-cleaning** — one metric, one disposable space, one
  small ticket set, exhaustive bounded teardown.
- **Additive only** — no legacy KPI code, no broad redesign, no unrelated source
  families touched.

## Remaining bounded gap

- The fixture proves the breach surface via a single breach-evaluable metric
  (`resolved_today`). Multi-metric per-agent breach rows (e.g. an agent red on
  one metric and amber on another in the same card) are not exercised; the WP8A
  scope is one agent in each band, which this satisfies.
- Only **today** is frozen. `resolved_today` is by definition a same-day count,
  so writing multiple historical days would imply false history; the Agent
  Breaches surface reads the latest frozen date, which today provides. This is a
  deliberate honesty choice, not a defect.
- Behavioural confirmation (live `seed` → observe `/api/kpi/agent-breaches` →
  `teardown`) requires the running server with the NOVA MSSQL pool available;
  that exercise is the evaluator's, not self-certified here.

## Readiness for independent evaluation

**Ready.** The slice is implemented, wired end-to-end, and the server build
typechecks with zero errors. An evaluator can, against the running clean-sheet
platform and using clean-sheet endpoints only:

1. `POST /api/kpi/fixtures/agent-breaches { "action": "seed" }`
2. `GET  /api/kpi/agent-breaches` → observe the `__ABFX` card with one breaching,
   one at-risk, and one clear agent (real computed values).
3. `POST /api/kpi/fixtures/agent-breaches { "action": "teardown" }` → confirm
   `__ABFX` is gone and the honest empty state is restored.
