# KPX-WP9 — Clean-Sheet Daily History Parity Surface (build status)

Date: 2026-05-31
Version: 1.1.232 → 1.1.233

## What was delivered

A clean-sheet **Daily History parity surface** — a per-space, multi-day
historical **grid** (date × metric table), not a sparkline/trend. It is the
day-by-day record of what each KPI was *frozen at*, with the RAG that was stored
at freeze time.

- **Read-model** `KpiViewsService.getDailyHistory(spaceKey, days)` in
  `src/server/services/kpi-engine/kpi-views.ts` (+ new `DailyHistory*` types).
- **API endpoint** `GET /api/kpi/daily-history/:spaceKey` in
  `src/server/routes/kpi-engine.ts` (`createKpiEngineRoutes` factory,
  `{ ok, data }` / `{ ok, error }` shape, `?window=N` with legacy `?days=N`
  alias, clamped 2–180, default 30).
- **Component** `src/client/components/KpiCleanDailyHistoryView.tsx` — space +
  window selectors, a scrollable date × metric grid with sticky date column and
  RAG-tinted cells, an "honestly unsupported" table, and empty/thin-state notes.
- **Wired** into `src/client/App.tsx` as a lazy-loaded view, following the exact
  pattern of the other 10 KpiClean views. View key is `kpic-daily-history` (note:
  the codebase uses the `kpic-*` prefix, not `kpiclean-*`). All five wiring points
  done: lazy import; `View` type union; `AREAS['kpi-platform'].tabs` entry
  (`{ view: 'kpic-daily-history', label: 'Daily History' }`, placed after Trends);
  the `{view === 'kpic-daily-history' && <KpiCleanDailyHistoryView />}` conditional
  render; and `FULL_WIDTH_VIEWS`.
- **Version** bumped `1.1.232 → 1.1.233` in `package.json`.

## Clean-sheet source / data path

Sourced ENTIRELY from the clean-sheet path — the frozen **`kpi_daily`**
space-level rows (`tier_name IS NULL`) in the **NOVA main MSSQL pool**, via the
Phase-1/2 engine + EOD freeze. One windowed query:

```
SELECT metric_key, report_date, value, rag_status
FROM kpi_daily
WHERE space_key = ? AND tier_name IS NULL
  AND report_date >= DATEADD(day, -<window>, CAST(GETUTCDATE() AS DATE))
ORDER BY report_date DESC, metric_key
```

The stored `rag_status` is read straight from the freeze (the grid shows the RAG
as it was that day, not a recomputed one). It never touches the legacy KPI
pipeline, the legacy Daily-History view's path, the techservicesjsm tables, or
any forbidden table. **No backfill / fabrication of any kind.**

## Supported vs honestly unsupported families

**Supported (become a grid column):** any enabled metric that carries ≥1 real
frozen `kpi_daily` row in the window — i.e. every space-level metric the EOD
freeze actually writes (FRT/resolution compliance, CSAT, escalation_rate, QA
family, manual-team metrics promoted into `kpi_daily`, etc.). Columns follow the
space's configured display order.

**Honestly unsupported (listed, never given a column/row):**
- **`unwired`** — computed metric with no registered computer (`hasComputer`
  false): can never carry frozen history in this build.
- **`awaiting`** — wired metric with no frozen row in the window yet.

**Cell-level honesty:** a (date, metric) with no frozen row is absent from the
row and renders "—" — never a fabricated 0 or carried-forward value. Only real
frozen report dates appear as rows; missing/skipped days are simply absent.

**Deliberately out of scope (kept honest, not faked):** per-tier history and the
`kpi_eod_snapshot` ticket-state freeze are NOT folded into this grid — the
surface is scoped to space-level per-metric daily history (Daily History parity),
matching the brief's instruction not to widen into raw export / Board MI /
wallboard replacement.

## Bounded / environment-dependent

- Returns **real data only with a running server + reachable Azure SQL** (NOVA
  main pool); offline it surfaces honest empty/error states, never fabricated rows.
- History depth is **gated by accumulated EOD freezes** — a freshly-seeded
  environment shows the empty/thin-history note until ≥1 EOD freeze per space
  exists. This is expected and surfaced honestly, not worked around.
## Type-check

`tsc -p tsconfig.server.json --noEmit` and client `tsc -p tsconfig.json --noEmit`
both run clean for the new/changed files (no errors in kpi-views.ts, kpi-engine.ts,
KpiCleanDailyHistoryView.tsx, or App.tsx). Full `npm run build` not run (heavy).

## Readiness

Ready for independent evaluation. The slice is additive, isolated from the legacy
KPI system, and honest by construction (real frozen rows only; awaiting/unwired
metrics surfaced, never fabricated). Real grid content depends on a running server
+ Azure SQL with accumulated EOD freezes.
