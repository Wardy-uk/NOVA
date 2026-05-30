# P4-WP1 — Manual Entry & Spreadsheet Import — Build Completion Report

**Work package:** `P4-WP1` (KPI Recovery Phase 4 — manual entry for non-Jira teams + Daily KPI Tracker import/backfill)
**Date:** 2026-05-30
**Agent:** Build Agent (Claude Code)
**Build state:** `tsc -p tsconfig.server.json` → 0 errors. `vite build` → success (new lazy chunk `KpiCleanManualView` emitted). Parser logic verified with a synthetic Daily KPI Tracker grid.

---

## 1. What was delivered

All work is **new, additive, and parallel**. It builds directly on the converged
Phase 1 foundation (`KpiEngine`, `kpi_*` tables), the Regression-Protected Phase 2
slice (`KpiEodService` — reused for RAG + `kpi_daily` promotion), and the converged
Phase 3 views. The legacy KPI system — n8n workflow, `techservicesjsm` tables,
`kpi-pipeline.ts`, `/api/kpi-data/*`, `/api/trends/*`, and all legacy KPI/wallboard
views — was **not touched** and continues running in parallel.

### New parser — `src/server/services/kpi-engine/kpi-tracker-parser.ts`

A pure, dependency-free parser for the **Daily KPI Tracker** spreadsheet format
that operates on a 2-D grid (so it is testable in isolation and reusable from
either a server-side `XLSX.read()` or a pre-parsed sheet).

- **Label → metric mapping** is built from the design §4.4 "Spreadsheet Row"
  column, **scoped per space** (`SPREADSHEET_LABELS[space][metric] = [...labels]`)
  because several labels collide across CS and KAM (e.g. *"Cancellations processed
  (value)"*, *"put on hold - quantity"*). Matching is tolerant (lower-cased,
  punctuation/`£`/`%`-stripped, whitespace-collapsed).
- **Team-section detection** (`Customer Success` / `Key Accounts` / `Onboarding` /
  `Comms Managed`) sets the active space as the parser walks rows, so the same
  label resolves to the correct team's metric.
- **Date-header detection** picks the row with the most date-parseable cells and
  maps each dated column → ISO `report_date`. `parseCellDate` handles JS `Date`
  (Excel `cellDates`), Excel serials, ISO, and UK `dd/mm/yyyy`.
- **Value parsing** (`parseCellValue`) strips `£`/`,`/`%`, and scales a 0–1
  fraction to a percentage **only** for percentage metrics.
- **Honesty:** unmappable labels are returned in `unmapped` (with the active space)
  — never guessed; blank / non-numeric cells yield **no entry** (a real `0` is
  preserved, a blank is not turned into 0); rows with no team context are reported.

### New service — `src/server/services/kpi-engine/kpi-manual.ts` (`KpiManualService`)

The Phase 4 write path. Reuses the Phase 1 engine for space/metric config and the
Phase 2 `computeRag()` for RAG.

| Required outcome | How it is delivered |
|---|---|
| **1. Manual entry UI for CS / KAM / ONBOARD / COMMS** | `getEntryForm(space, date)` returns every enabled metric for the space + its `value_type`, target, and current state (see new React view below). |
| **2. Any date, not just today** | The form is parameterised by `:date`; the client date-picker defaults to today but accepts any past date (capped at today). |
| **3. Pre-fill existing values** | `getEntryForm` joins `kpi_manual_entries` for that (space, date) and seeds each field; it also returns the promoted `kpi_daily` value + RAG so the round-trip is visible. |
| **4. Validate by `value_type`** | `validateValue()` enforces: `integer` (whole, ≥0), `percentage` (0–100), `currency` (≥0, 2dp), `duration_minutes` (≥0), `decimal` (any finite). Blank = skip (not an error, not a 0). |
| **5. Save into `kpi_manual_entries`** | `saveEntries()` upserts (delete+insert) per `(space, metric, date)` under the existing unique constraint, recording `entered_by`, `source`, `notes`. |
| **6. Promote into `kpi_daily`** | Each saved value is also upserted into `kpi_daily` (space-level row, `tier_name NULL`) with the denormalised `target_value` and computed `rag_status`. |
| **7. Spreadsheet import endpoint + parser** | `importTracker()` parses one or more sheet grids and bulk save+promotes (`source = 'import'`); supports `dryRun` (parse/preview without writing). |
| **8. Historical backfill → `kpi_manual_entries` → `kpi_daily`** | Import groups parsed entries by `(space, date)` and runs them through the **same** save+promote path, so backfilled history lands in both tables identically to live entry. |

### New API endpoints — `src/server/routes/kpi-engine.ts` (existing `/api/kpi/*` family)

| Endpoint | Purpose |
|---|---|
| `GET /api/kpi/manual/:spaceKey/:date` | Entry form: enabled metrics + pre-filled stored values + promoted daily values. 404 unknown space, 400 bad date. |
| `POST /api/kpi/manual-entry` | Save manual values. Batch `{ spaceKey, date, entries:[{metricKey,value,notes?}] }` or single `{ spaceKey, metricKey, date, value }`. Validates, saves, promotes. Returns `{ saved[], rejected[] }`. |
| `POST /api/kpi/import` | Daily KPI Tracker import. Accepts `{ fileBase64 }` (server parses **all sheets** via `xlsx`, already a repo dependency) **or** `{ sheets:[{name,rows}] }`. Optional `{ spaceKey }` forces a single-team sheet, `{ dryRun:true }` previews. Returns parse + save summary incl. `unmapped` / `rejected` / `warnings`. |

All follow the repo `{ ok, data }` / `{ ok, error }` convention; date params validated `YYYY-MM-DD`. `entered_by` is taken from `req.user.username` when an auth layer has populated it, else null. No collision with legacy `POST /api/kpi/derived/run`.

### Foundation wiring

`KpiManualService` is constructed in `initKpiFoundation()`, exposed on `KpiFoundation.manual`, and passed to the route factory from `index.ts` — same unconditional-mount pattern as Phases 1–3.

### New React view — `src/client/components/KpiCleanManualView.tsx`

Lazy-loaded, wired as a new **"Manual Entry"** tab inside the existing **KPI
Platform** area (additive: new `View` member `kpic-manual`, tab entry, lazy import,
render block, `FULL_WIDTH_VIEWS` entry). No legacy view/area touched.

- Space selector (defaults to the first non-Jira team) + **any-date** picker.
- Metric grid: type hint, target, a numeric input pre-filled from stored values,
  and a "Promoted (daily)" column showing the `kpi_daily` value + RAG after save.
- **Save & Promote** posts only non-blank fields; surfaces saved/rejected counts.
- **Daily KPI Tracker Import** panel: file picker, optional force-team selector,
  **Preview (dry-run)** and **Import (write)** buttons, and a summary showing dates
  detected, spaces touched, and expandable unmapped-label / rejected-value lists.

---

## 2. What remains incomplete or bounded

- **Spreadsheet column/section layout is inferred, not confirmed against the real
  file.** I did not have the actual Daily KPI Tracker workbook. The parser is built
  to the design §4.4 row labels and tolerant matching, and is deliberately
  **honest** about misses: any label it can't map is reported in `unmapped` rather
  than guessed. The **dry-run preview** exists precisely so a real file can be
  validated (and the label aliases extended) before any write. Extending
  `SPREADSHEET_LABELS` is data-only and needs no logic change.
- **Phase 3 SLT/Team views were intentionally NOT modified.** Promoted manual
  values are observable via the manual form's "Promoted (daily)" column and would
  require a Phase 3 view change to also surface on the team dashboard (which still
  shows the honest "captured via manual entry" note for non-Jira spaces). That edit
  was treated as out-of-scope to avoid broadening into Phase 5 polish and to protect
  the Regression-Protected/converged earlier slices. Note: the existing
  `GET /api/kpi/daily/:space/:date` reads via the Phase 2 daily-report, which filters
  to Jira spaces — so for manual spaces the authoritative observable read is the new
  `GET /api/kpi/manual/:space/:date` form (which returns the promoted value + RAG).
- **Percentage fraction scaling is heuristic.** A percentage cell in 0–1 is scaled
  ×100; a value already in 0–100 is left as-is. Documented in code; flagged here as
  the one place a real file should be spot-checked during the dry-run.
- **Clearing an existing value is not a first-class action.** A blank field is
  skipped (so an existing stored value is left intact, never zeroed). Explicit
  deletion of a previously-entered value is not in this slice.
- **No Phase 5 scope added:** no AI digest, no admin/config UI, no EOD-snapshot
  replacement view. Manual-entry + import behaviour only.

---

## 3. Assumptions required

1. **`/api/kpi/*` is reachable for writes** the same way Phases 1–3 read it; the new
   write endpoints capture `entered_by` from `req.user` when present and otherwise
   record null/`'import'` — no new auth layer was introduced.
2. **`xlsx` parsing happens server-side** from a base64 upload (the package is
   already a repo dependency and is used the same way by the Delivery/Onboarding
   importers). This makes `POST /api/kpi/import` a true "accepts an Excel file"
   endpoint without adding `multer`. A pre-parsed `sheets[]` form is also accepted.
3. **Promotion target = the per-space binding.** `kpi_daily` rows written from
   manual values carry the `target_value`/`amber_band`/`direction` from
   `kpi_space_metrics` + `kpi_metric_definitions`, identical to the Phase 2 EOD
   freeze — so manual and computed daily rows are RAG-comparable.
4. **Manual rows are space-level** (`tier_name NULL`); non-Jira teams have no tiers
   in the seed, so this matches the data model.
5. **Validation bands** (percentage 0–100, currency/integer/duration ≥0, integer
   whole) are reasonable defaults consistent with the metric catalogue; they are in
   one place (`validateValue`) and easy to adjust if a metric legitimately exceeds
   100% etc.

---

## 4. Readiness for independent evaluation

**Ready for independent behavioural evaluation.**

- Server build clean (`tsc -p tsconfig.server.json`, 0 errors); client `vite build`
  succeeds with the new `KpiCleanManualView` chunk emitted. (The pre-existing legacy
  `kpi-pipeline.ts` type note, surfaced only under the root tsconfig, is unrelated
  and untouched per the parallel-run constraint.)
- The foundation mounts unconditionally, so the new endpoints and view are live
  wherever the NOVA main pool is reachable.

### Suggested evaluation entry points (behavioural, no code inspection needed)

1. **Manual entry round-trip** — UI **KPI Platform → Manual Entry** (or
   `GET /api/kpi/manual/CS/2026-05-28`). Pick a non-Jira team (CS/KAM/ONBOARD/COMMS)
   and **any past date**, enter values, **Save & Promote**. Confirm the form reloads
   with the values pre-filled and the "Promoted (daily)" column populated with the
   value + RAG.
2. **Validation** — enter a decimal in an integer metric, `150` in a percentage, or
   a negative in a currency metric; confirm the value is rejected with a reason and
   not written. Confirm a **blank** field is left as `—` and never saved as `0`.
3. **Edit existing date** — re-open the same space/date; confirm prior values
   pre-fill and a re-save replaces (does not duplicate) rows.
4. **Import dry-run** — upload a Daily KPI Tracker workbook with **Preview**;
   confirm detected dates, spaces touched, and any unmapped labels are listed and
   **nothing is written**. Then **Import (write)** and confirm `entriesSaved` and
   that the entered dates now pre-fill in the manual form.
5. **Honesty checks** — confirm a row with an unknown label appears under
   "unmapped" rather than being silently dropped or mis-assigned, and that a real
   `0` in the sheet is imported as `0` while blanks are skipped.
6. **Parallel-run check** — confirm the legacy **KPIs** area and `/api/kpi-data/*`
   are unchanged, and that the Phase 1–3 endpoints/views still behave as before.
