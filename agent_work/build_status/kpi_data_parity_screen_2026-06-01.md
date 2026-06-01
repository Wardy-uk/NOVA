# KPX-WP10 — Clean-Sheet KPI Data Parity Surface (build status)

Date: 2026-06-01
Version: 1.1.233 → 1.1.234

## What KPI Data parity surface was delivered

A clean-sheet **KPI Data** surface — a **raw/grid-style row inspector** over the
clean-sheet KPI *output* tables. It is the parity replacement for the legacy
"KPI Data Explorer" (which reads the legacy pipeline via `/api/kpi-data/*`).
Where the SLT / Team / QA / Trends / Daily-History views summarise into cards,
charts, and date×metric grids, this surface exposes the **underlying frozen / live
rows directly**, as stored, so they can be inspected.

It is a dataset switch (four tabs) + space filter + window selector over a single
raw table view:

- **Read-model** `KpiViewsService.getKpiData(dataset, { spaceKey?, window?, limit? })`
  in `src/server/services/kpi-engine/kpi-views.ts` (+ new `KpiDataDataset`,
  `KpiDataColumn`, `KpiDataDatasetInfo`, `UnsupportedDataFamily`, `KpiDataResult`
  types). Returns the raw rows of one dataset with real column metadata, an honest
  empty/sparse note, the supported-dataset registry, and the honestly-unsupported
  legacy-family list.
- **API endpoint** `GET /api/kpi/data/:dataset` in
  `src/server/routes/kpi-engine.ts` (`createKpiEngineRoutes` factory,
  `{ ok, data }` / `{ ok, error }` shape). `:dataset` ∈
  `daily | agent-daily | eod-snapshot | snapshot`; unknown → 400.
  `?spaceKey=` filters to one space (omitted = all spaces), `?window=N`
  (legacy `?days=N` alias) bounds the date window (default 30, clamped 1–180),
  `?limit=N` caps rows (default 500, max 2000).
- **Component** `src/client/components/KpiCleanDataView.tsx` — dataset tabs,
  space filter (incl. "All spaces"), window selector, a sticky-header scrollable
  raw table, row-count + truncation banner, honest empty-state note, and an
  "honestly unsupported legacy tab" table.
- **Wired** into `src/client/App.tsx` following the exact pattern of the other 11
  KpiClean views. View key is `kpic-data`. All five wiring points done: lazy
  import; `View` type union; `AREAS['kpi-platform'].tabs` entry
  (`{ view: 'kpic-data', label: 'KPI Data' }`, placed after Daily History);
  the `{view === 'kpic-data' && <KpiCleanDataView />}` conditional render; and
  `FULL_WIDTH_VIEWS` (a raw row grid wants full width).
- **Version** bumped `1.1.233 → 1.1.234` in `package.json`.

## Clean-sheet source / data path

Sourced ENTIRELY from the clean-sheet path — the clean-sheet KPI **output** tables
in the **NOVA main MSSQL pool**, exactly four datasets, one per real table:

| Dataset | Table | What it is |
| --- | --- | --- |
| `daily` | `kpi_daily` | Frozen space/tier daily metric values + RAG stored at freeze time |
| `agent-daily` | `kpi_agent_daily` | Frozen per-agent daily metric values (agent-level metrics) |
| `eod-snapshot` | `kpi_eod_snapshot` | Frozen EOD ticket-state rows by tier/status/request-type + over-SLA counts |
| `snapshot` | `kpi_snapshots` | Live computed snapshot values written each snapshot cycle |

Each query is a single windowed, row-capped `SELECT TOP (N)` against one table,
ordered most-recent-first. The only join is a `LEFT JOIN kpi_metric_definitions`
to add the human-readable `display_name` alongside the raw `metric_key`. It never
touches the legacy KPI pipeline, the legacy `/api/kpi-data/*` route family, the
techservicesjsm tables, or any forbidden table. **No backfill / fabrication.**

## Supported vs honestly unsupported row/column families

**Supported (real datasets with real columns):** the four tables above. Every
column shown is a real column of its underlying table —
- `daily`: report_date, space_key, metric_key, display_name, tier_name, value,
  target_value, rag_status
- `agent-daily`: report_date, space_key, agent_id, agent_name, metric_key,
  display_name, value
- `eod-snapshot`: snapshot_date, snapshot_time, space_key, tier_name, status,
  request_type, ticket_count, over_sla_count
- `snapshot`: snapshot_at, space_key, metric_key, display_name, tier_name, value

No column is invented; values are rendered as stored (numbers trimmed of float
noise only, RAG shown as-is). A null/empty cell renders "—", never a fabricated 0.

**Honestly unsupported (listed, never given a dataset/rows):**
- **Agents (live ticket-health roster)** — the legacy KPI-Data "Agents" tab lists
  per-agent LIVE queue health (open total, open >2h, stale, solved today/week,
  availability). The clean-sheet path freezes per-agent metric *values* into
  `kpi_agent_daily` (exposed as the Agent Daily dataset) — it does not store a
  per-agent live ticket-count roster, so there is no honest raw row to show. This
  is surfaced in an explicit "Not in the clean-sheet output" table (mirroring the
  unsupported-family pattern already used by Agent Breaches), never faked.

**Empty / not-yet-frozen handling:** a dataset with no rows in the window returns
an empty `rows` array with an explicit server note ("No clean-sheet … rows …
nothing has been frozen/captured yet in this window (not fabricated)") rather than
a placeholder row. The row cap is reported honestly (`truncated` + a banner) when
more rows exist than the limit.

## What remains bounded or environment-dependent

- Returns **real rows only with a running server + reachable Azure SQL** (NOVA
  main pool); offline/unreachable it surfaces an honest error or empty note, never
  fabricated rows.
- Row volume is **gated by accumulated freezes / snapshots** — a freshly-seeded
  environment shows the empty/not-yet-frozen note for `daily` / `agent-daily` /
  `eod-snapshot` until ≥1 EOD freeze exists, and for `snapshot` until ≥1 snapshot
  cycle has run within the window. Expected and surfaced honestly.
- Output is deliberately **window- and row-capped** (default 30 days / 500 rows,
  max 180 days / 2000 rows) to keep this a focused KPI Data parity inspector
  rather than an open-ended analytics/export workbench. No CSV/export tooling,
  Board MI, or wallboard work was added (out of scope per brief).

## Type-check

`tsc -p tsconfig.server.json --noEmit` and client `tsc -p tsconfig.json --noEmit`
both run clean for the new/changed files (no errors in kpi-views.ts, kpi-engine.ts,
KpiCleanDataView.tsx, or App.tsx). Full `npm run build` not run (heavy).

## Readiness

Ready for independent evaluation. The slice is additive, isolated from the legacy
KPI system, and honest by construction (real frozen/live rows only; empty/sparse
states surfaced, the one legacy live-roster family listed as unsupported, never
fabricated). Real grid content depends on a running server + Azure SQL with
accumulated freezes/snapshots.
