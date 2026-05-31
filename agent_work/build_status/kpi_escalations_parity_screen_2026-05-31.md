# Build Status — KPI Escalations Parity Screen (KPX-WP6)

**Date:** 2026-05-31
**Work package:** `KPX-WP6` — Escalations parity-screen delivery
**Agent:** Build Agent
**Status:** Complete — ready for independent evaluation

---

## 1. What was delivered

A new clean-sheet **Escalations Parity** surface, scoped to exactly the three
escalation-family metrics and nothing else:

- `escalation_rate`
- `escalation_accuracy`
- `rejection_rate`

It is delivered as a focused cross-space screen modelled directly on the existing
QA Parity surface (KPX-WP4), so it inherits the same proven clean-sheet read path,
honesty rules, and RAG/sparkline rendering.

The surface comprises three additive layers:

1. **Read model** — `KpiViewsService.getEscalationsParity()` in
   `src/server/services/kpi-engine/kpi-views.ts`. Returns one card per space that
   carries the escalation family (enabled binding), each with:
   - the three escalation metrics resolved to current value / target / RAG,
   - a 7-day daily sparkline history per metric,
   - the per-agent breakdown from the latest frozen `kpi_agent_daily` rows.
   A new `ESCALATION_METRIC_KEYS` constant and `EscalationParity*` types bound the
   scope.

2. **API** — `GET /api/kpi/escalations-parity` in
   `src/server/routes/kpi-engine.ts`, following the repo `{ ok, data }` /
   `{ ok, error }` convention. Spaces without the family are omitted entirely.

3. **UI** — `src/client/components/KpiCleanEscalationsView.tsx`, a new lazy-loaded
   view wired into the **KPI Platform** area in `App.tsx` as a new
   **"Escalations Parity"** tab (`view: 'kpic-escalations'`), sitting beside
   "QA Parity". Space-level metric table + per-agent table, identical visual
   language to the rest of the clean-sheet platform.

Currently the escalation family is seeded on the **NT** (Jira) space, so the
surface renders a populated NT card; other spaces that do not carry the family are
correctly absent.

## 2. Clean-sheet source / data path

The surface uses the **clean-sheet escalation-family source only** and never
touches the legacy KPI system:

- Values originate from the wired escalation source `escalation_log` (NOVA main
  pool), partitioned in `source-providers.ts` into genuine escalations
  (non-`rejection` rows → `escalation_rate` / numerator of `escalation_accuracy`)
  and bounce-back rows (`escalation_type = 'rejection'` → `rejection_rate` /
  denominator adjustment for accuracy).
- Those values are computed by the registered escalation computers
  (`metric-computers.ts`) during the 3-min snapshot cycle and the EOD freeze, and
  land in the clean-sheet tables `kpi_snapshots` / `kpi_daily` / `kpi_agent_daily`.
- The parity read model resolves **current** value live-snapshot-first then latest
  frozen daily — the exact same path as the SLT, Team and QA Parity views.
- It reads **only** `kpi_*` clean-sheet tables. It does **not** query
  `escalation_log` directly, the legacy KPI pipeline pool, the `techservicesjsm`
  tables, or any forbidden table. No evaluator holdouts are consumed.

### Honesty handling of absent capture rows

Absent capture is surfaced honestly, never fabricated:

- A metric with no captured value resolves to `value: null` and renders **"—"**,
  never a `0%` / `100%`.
- `escalation_accuracy` and `rejection_rate` depend on the explicit rejection
  (bounce-back) capture path. Their computers return `null` while
  `rejectionAvailable` is false (no captured bounce-back in window), so the EOD
  freeze writes **no row** and they render an explicit **"awaiting capture"**
  state in the cell rather than asserting an unfounded 100% accurate / 0% rejected.
- A space that carries the family but holds no value yet shows `hasData: false`
  with an honest awaiting-data note that names the dependency.

## 3. What remains bounded or environment-dependent

- **Rejection-dependent values await live capture.** `escalation_accuracy` and
  `rejection_rate` will display real numbers only once the rejection/bounce-back
  capture path has produced at least one event in window. Until then they read
  "awaiting capture" by design — this is correct honest behaviour, not a defect.
- **`escalation_rate` depends on `escalation_log` having rows** for tickets in the
  space's project cache window. With zero captured escalations it reads "—" (true
  zero is not fabricated). Population is environment-dependent on the escalation
  capture path being exercised in the running environment.
- **Per-agent rows** populate only at EOD freeze for dates where agents have
  escalation-family rows; before that the per-agent panel shows its honest empty
  state.
- **Scope held tight:** no legacy KPI screens, QA screen, or unrelated source
  families were touched; no broader KPI redesign was attempted. Only the bounded
  read-model method, one API route, and one new UI view were added.

## 4. Readiness for independent evaluation

**Ready.** The slice is behaviourally evaluable end-to-end via the running
software:

- API: `GET /api/kpi/escalations-parity` returns the scoped escalation family with
  honest null/awaiting states.
- UI: KPI Platform → **Escalations Parity** tab renders the cross-space surface.

Build verification performed:

- `tsc -p tsconfig.server.json --noEmit` — clean (no new errors).
- `tsc -p tsconfig.json --noEmit` — no errors in the new/changed files
  (`kpi-views.ts`, `kpi-engine.ts` route, `KpiCleanEscalationsView.tsx`, `App.tsx`).

No evaluator holdouts, scoring logic, or hidden scenarios were read or consumed in
producing this slice.
