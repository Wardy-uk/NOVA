# KPI Trends Parity Screen — clean-sheet Trends surface (KPX-WP7)

**Work package:** `KPX-WP7` — clean-sheet Trends parity surface
**Date:** 2026-05-31
**Agent:** Build Agent (Claude Code)
**Basis:** `agent_work/spec/kpi_trends_parity_build_brief.md` + the converged clean-sheet KPI platform (Phase 3 views) and the KPX-WP3/WP4/WP5/WP6 replacement-parity substrate.
**Scope discipline:** Trends parity only. One new read model, one new GET route, one new lazy view + nav tab. No engine / source-provider / EOD changes, no schema/seed/binding/catalogue changes, no holdout consumption, no forbidden tables, no fabricated values, no legacy KPI changes, no Board MI, no wallboard replacement, no broad reporting rebuild.

---

## 0. Summary

A new **Trends** surface ships in the clean-sheet **KPI Platform** area. It delivers the multi-day trend/history behaviour the brief asks for — going **beyond the thin, fixed 7-day sparkline** already carried inline by the Team / QA / Escalations grids:

- a **configurable window** (7 / 14 / 30 / 90 days; default 30),
- a **proper per-metric line chart** with a dashed **target reference line** and point markers,
- a **direction-aware movement summary** per metric (first→latest delta, % change, improving/worsening arrow coloured by the metric's own `direction`, plus min/max and point count),
- an explicit **"Not yet trendable"** section that lists every metric that *cannot* honestly be trended yet, with the reason — and draws **no line** for them.

It reads the clean-sheet `kpi_daily` frozen history **only**, via the existing `KpiViewsService`. It never touches the legacy KPI pipeline, the legacy Trends view's data path, the `techservicesjsm` tables, or any forbidden table.

Server typecheck (`tsc -p tsconfig.server.json --noEmit`) is **clean (0 errors)**. Full typecheck shows the **single pre-existing** error in untouched `kpi-pipeline.ts:1043`; **0 errors in any file touched here** (including the new client view).

---

## 1. Trends parity surface delivered

**New view: `KpiCleanTrendsView`**, reached at **KPI Platform → Trends** (tab inserted between *Escalations Parity* and *Agent Scorecard*). It is per-space (space selector, defaulting to the first Jira space) with a window selector.

For the selected space it renders two clearly separated parts:

1. **Supported trends (cards).** One card per metric that has **≥2 real frozen daily points** in the window. Each card shows: current value (RAG-coloured) + target, the direction-aware delta badge, a full multi-day line chart (with target reference line, shaded area, and an emphasised latest point), the date span, and min/max over the window. This is the "beyond a thin sparkline" treatment: a 360×96 line chart with target context and movement analytics, vs the 80×22 inline sparkline.

2. **Not yet trendable (table).** Every enabled metric that is **not** drawable yet, with an honest state and reason:
   - **`awaiting history`** (amber) — the metric is wired and may even have a current value, but has **<2 frozen daily points** in the window, so there is not enough history to form a multi-day trend. Reason text distinguishes "only one frozen day so far" from "no frozen daily history yet".
   - **`not wired`** (grey) — the metric is a computed metric with **no registered computer** (the platform's existing `unwired` flag), so it can never carry history in this build.

   No metric in this section is drawn a line. A missing or single-point series is never extended, flattened to a straight line, or back-filled.

### Honest states (no fabrication)
- A metric is classified into exactly one of `supported` / `awaiting` / `unsupported` server-side; the client only draws a chart for `supported`.
- The whole space falls back to an honest note when nothing is trendable yet (Jira: "trends appear as EOD freezes accumulate (≥2 frozen days per metric)"; manual: "trends appear once ≥2 days of manual entries exist per metric").
- The delta badge shows `→` (flat) when first == last, and colours green/red strictly by the metric's `direction` (so e.g. a falling `escalation_rate` shows green/improving, a falling FRT-attainment shows red).

---

## 2. Clean-sheet source / data path used

The surface uses the **clean-sheet read path only**, identical in mechanism to the Team Dashboard:

- **New read model:** `KpiViewsService.getTrends(spaceKey, days)` in `src/server/services/kpi-engine/kpi-views.ts`.
  - **History:** frozen `kpi_daily` **space-level rows** (`tier_name IS NULL`) over a clamped window: `report_date >= DATEADD(day, -windowDays, CAST(GETUTCDATE() AS DATE))`, `windowDays` clamped to **2–90** (default 30). This is the same table and the same space-level filter the existing 7-day sparkline history uses — just a wider, configurable window.
  - **Current value (context only):** the same `resolveCurrent()` path as every other Phase 3 view — live `kpi_snapshots` first, then latest frozen `kpi_daily` — purely to label each card; the trend itself is built from the frozen daily series.
  - **Classification:** reuses the existing `unwired` flag (computed metric with no `hasComputer`) for `unsupported`; `awaiting` is purely "<2 real points"; `supported` is "≥2 real points".
  - **Stats:** `computeTrendStats()` derives first/last/min/max/deltaAbs/deltaPct and a direction-aware `improving` flag from the **real** points only.
- **New route:** `GET /api/kpi/trends/:spaceKey?days=N` in `src/server/routes/kpi-engine.ts` → `views.getTrends(...)`, standard `{ ok, data }` envelope, 404 on unknown space, `days` parsed/clamped.
- **Client:** `KpiCleanTrendsView` fetches `/api/kpi/spaces` (space list, as the Team view does) and `/api/kpi/trends/:spaceKey?days=N` only.

No legacy KPI pipeline pool, no `techservicesjsm` direct read, no forbidden table, no engine/EOD/source-provider change. The trended values were computed and frozen upstream by the existing engine + EOD path; this slice is a pure read surface over the clean-sheet store.

### Files changed
- `src/server/services/kpi-engine/kpi-views.ts` — added `TrendStatus`, `TrendPoint`, `TrendStats`, `TrendMetric`, `TrendsSpace` types; `computeTrendStats()` and `getTrends()`. No change to existing methods.
- `src/server/routes/kpi-engine.ts` — added `GET /trends/:spaceKey` (reuses the already-injected `views` dep; no new wiring in `index.ts`).
- `src/client/components/KpiCleanTrendsView.tsx` *(new)* — the Trends parity view (window selector, trend chart, delta badge, awaiting/not-wired table).
- `src/client/App.tsx` — added `'kpic-trends'` to the view union, lazy import, the *Trends* tab under KPI Platform, and the render branch.

No schema, seed, catalogue, binding, engine, source-provider, or legacy KPI changes. No existing API response shape changed.

---

## 3. Which trend families are supported vs honestly unsupported

Trendability here is **data-driven, not metric-name-driven**: any enabled metric that the clean-sheet engine/EOD freezes into `kpi_daily` becomes trendable once it has ≥2 frozen days. So "supported families" = whatever the converged platform currently wires and freezes.

**Currently supported (will trend wherever ≥2 frozen days exist):**
- The **core Jira-computed SLA/volume families** the engine snapshots and EOD-freezes (e.g. FRT/resolution attainment, volume/throughput-style metrics) — these are the same series the existing 7-day sparkline already draws, now over a wider window with analytics.
- The **QA family** wired in KPX-WP3/WP4 — `qa_score_avg`, `golden_rules_avg`.
- The **escalation family** wired across KPX-WP3/WP5/WP6 — `escalation_rate`, and `escalation_accuracy` / `rejection_rate` **once the rejection (bounce-back) capture path has produced values** that EOD-freeze.
- **Manual / non-Jira** metrics promoted into `kpi_daily` — they trend once ≥2 days of manual entries exist.

**Honestly unsupported (surfaced, never trended):**
- **Structurally unwired** computed metrics — those with no registered computer (per KPX-WP3 §4.2, e.g. NT `fcr_rate`, `reopen_rate`, `bug_escalation_ack_hrs`; NTPJ `sprint_velocity`, `sprint_burndown_pct`). Listed as **`not wired`**.
- **Wired-but-insufficient-history** metrics — anything with <2 frozen daily points in the window (including a metric that has a live snapshot but no/one EOD freeze yet, and accuracy/rejection-rate before a captured bounce-back). Listed as **`awaiting history`**.

This split is computed honestly per request, so as the platform wires more families or accumulates more freezes, metrics migrate from the unsupported table into the supported cards automatically — no code change.

---

## 4. What remains bounded or environment-dependent

- **History depth is environment-dependent.** A metric only trends once **≥2 frozen `kpi_daily` days** exist for it. On an environment with little/no EOD-freeze history (e.g. local dev with no `jira_issue_cache`, or a freshly-seeded instance), most or all metrics will correctly appear under **"Not yet trendable → awaiting history"** rather than as charts. That is the expected data-presence gap (consistent with the KPX-WP3/WP4 qualified-pass conditions), not a surface defect — the cards populate the moment a second freeze lands. No further code is needed for trends to appear.
- **Window is bounded** to 2–90 days server-side; the UI offers 7/14/30/90. This is deliberate scope-keeping (a Trends parity slice, not a configurable reporting engine).
- **Space-level only.** Trends are drawn from space-level (`tier_name IS NULL`) daily rows, matching the existing sparkline history. Per-tier and per-agent trend breakdowns are intentionally out of scope for this slice (they would widen it toward a reporting rebuild).
- **Out of scope (unchanged, honest):** legacy `TrendsView` (untouched, still under the separate *Trends* area), Board MI, wallboard replacement, broad KPI redesign. None touched.

---

## 5. Ready for independent evaluation

**Yes — ready for independent behavioural evaluation.** The Trends parity surface is delivered, wired to the clean-sheet `kpi_daily` path only, provides genuine multi-day trend/history behaviour beyond the thin sparkline, surfaces supported trendable metrics honestly, and handles unsupported/unwired families honestly (explicit `awaiting history` / `not wired` states with **no fabricated lines**). Legacy KPI behaviour is untouched and the surface is isolated from the legacy Trends view.

The one bounded caveat for the evaluator: if the eval environment lacks ≥2 days of frozen `kpi_daily` history for a space's metrics, the surface will **correctly** show those metrics under "Not yet trendable → awaiting history" rather than as populated charts — the expected environment/history gap, not a defect. The Escalations proof fixture (`POST /api/kpi/fixtures/escalations`) plus repeated EOD freezes can be used to land multi-day history if a populated demonstration of the supported path is wanted.

### Behavioural check points (running software only)
- `GET /api/kpi/spaces` → space list (drives the selector).
- `GET /api/kpi/trends/NT` → `{ spaceKey, windowDays:30, hasData, supported:[…], unsupported:[…] }`; each `supported` metric has `history` (≥2 points), `trendStatus:'supported'`, and a `stats` object; each `unsupported` metric has `trendStatus:'awaiting'|'unsupported'`, empty-or-short `history`, `stats:null`, and a `trendNote`.
- `GET /api/kpi/trends/NT?days=90` → wider window; `windowDays` reflects the clamp (2–90); out-of-range/garbage `days` falls back to 30.
- `GET /api/kpi/trends/UNKNOWN` → 404.
- UI: **KPI Platform → Trends** renders the window/space selectors, supported-metric trend cards (line + target line + delta badge + min/max), and the "Not yet trendable" table; the legacy **Trends** area view is unchanged.
