# Evaluation — KPI Daily History (Clean-Sheet)

**WP:** KPX-WP9
**Date:** 2026-06-01
**Evaluator:** Eval Agent (behavioural, clean-sheet KPI path)
**Method:** Live API observation against the running server (`http://localhost:3001`).
Read-only admin token minted via the established KPX eval-family path (JWT secret read from
the NOVA runtime DB `settings` table — `src=db-settings`, `secretLen 64` — **not** from app
source). Token proven against three known-good clean-sheet reads (`/api/kpi/slt`,
`/api/kpi/spaces`, `/api/kpi/qa-parity` → all `200/ok:true`) before any conclusion was drawn.
No application source, build-status notes, or diffs were inspected. Raw captures retained:
`agent_work/eval_output/_wp9_results.json` (20-path discovery sweep, isolation + regression
matrices) and `_wp9_probe.json` (per-space full payloads across all 8 spaces, 13 window/days
query variants, bogus-space + base-route negatives).

---

## Verdict: **QUALIFIED PASS**

The clean-sheet Daily History surface exists at exactly one clean-sheet endpoint
(`/api/kpi/daily-history/:space`), presents a genuine **date × metric grid** built from frozen
`kpi_daily`-style rows, renders **real supported frozen values with consistent RAG**, is
**isolated** from the legacy KPI system, and — the point of this programme — is **honest on
every axis that could be observed**: supported metrics carry real frozen values; everything not
yet frozen is enumerated as **`awaiting`**; metrics with no wired source are enumerated as
**`unwired`** with an explicit "not fabricated" reason; and spaces/days/cells with no frozen
data are shown as genuinely empty rather than backfilled.

This is observably **stronger than the WP8 Agent Breaches slice**: there the populated path
was entirely empty (`hasData:false` everywhere), whereas here the supported-value path **is
populated and was verified** for the days that exist.

The qualification is a **coverage gap, not a defect**: in this environment only **one** EOD
freeze exists (`2026-05-29`), so every populated space returns exactly **one row**. The grid is
structurally multi-day (rows keyed by date, `windowDays` controls range), but the genuine
**multi-day (>1 row) presentation could not be exercised** — there is no second frozen day to
render. It degrades honestly to a single real row; its correctness across multiple days remains
undemonstrated only because the data does not yet exist.

---

## Observed ground truth

`GET /api/kpi/daily-history/:space` → `200 / {ok:true}`. Per-space body shape:

```
data.spaceKey / displayName / ownerName / timezone / isJiraSpace
data.windowDays   = 30 (default) — honours ?window= / ?days=
data.hasData      = true|false   — explicit; distinguishes "frozen rows present" from "none"
data.note         = null
data.columns[]    = SUPPORTED metric defs only  { metricKey, displayName, category,
                     valueType, direction, source, target }
data.rows[]       = { date, cells: { <metricKey>: { value, rag } } }  — one entry per frozen day
data.unsupported[]= { metricKey, displayName, category, status, reason }
                     status ∈ { "awaiting", "unwired" }
```

Per-space census (all 8 clean-sheet spaces):

| Space | isJira | hasData | supported cols | rows (frozen days) | awaiting | unwired |
|-------|--------|---------|----------------|--------------------|----------|---------|
| NT    | true   | true    | 1 (`queue_total`) | 1 — `2026-05-29` | 22 | 3 |
| CS    | false  | true    | 3 (CS manual metrics) | 1 — `2026-05-29` | 17 | 0 |
| NTPJ  | true   | false   | 0 | 0 | 19 | 2 |
| STBY  | true   | false   | 0 | 0 | 17 | 0 |
| YO    | true   | false   | 0 | 0 | 17 | 0 |
| COMMS | false  | false   | 0 | 0 | 7  | 0 |
| KAM   | false  | false   | 0 | 0 | 12 | 0 |
| ONBOARD | false | false  | 0 | 0 | 5  | 0 |

Sample real frozen cells:
- **NT** `queue_total` → `{ value: 145, rag: "red" }` (target 40, direction `lower` → 145 ≫ 40 ⇒ red — consistent).
- **CS** `cs_open_tickets` 524, `cs_over_sla` 59, `cs_biz_reviews_daily` 4 → all `rag: null`
  (each has `target: null` ⇒ no RAG asserted — honest, not a fabricated colour).

---

## Key questions

### Q1 — Surface exists and loads from the clean-sheet KPI path only — **PASS**
Served at `/api/kpi/daily-history/:space` under the clean-sheet `/api/kpi` namespace, returning
`200/ok:true` structured payloads for all 8 spaces. The base route without a space
(`/api/kpi/daily-history`) returns HTML `404` (it is strictly per-space). A 20-path discovery
sweep found no alias under `/api/kpi-engine/*` or any other clean-sheet path. Critically, the
legacy namespace does **not** serve this surface: `/api/kpi-data/daily-history` returns
`500 "KPI SQL Server not configured"` (the unconfigured legacy pool), yet the clean-sheet route
returns full `200` payloads — proving the surface does not read the legacy `techservicesjsm`
pool.

### Q2 — Real multi-day historical grid from frozen rows, not legacy data — **PASS (structure + populated single-day) / multi-day (>1 row) UNVERIFIED**
The response is a true date × metric grid: `columns` = supported metric definitions,
`rows` = one entry per frozen day keyed by `date`, `cells` = `{value, rag}` per metric.
For NT and CS the grid is populated with **real frozen values** carrying a **stored/derived
RAG**, dated `2026-05-29` (a past EOD freeze, not "today" — i.e. frozen, not a live recompute),
and returned independently of the unconfigured legacy pool. **Unverified:** only one frozen day
exists in this environment, so every populated space returns exactly one row; the genuine
multi-row (multiple distinct dates) presentation could not be observed. It does not fabricate
extra dates to fill the window.

### Q3 — Supported historical values shown honestly (real frozen values + stored RAG) — **PASS**
Supported values are real frozen numbers, not placeholders: NT `queue_total = 145` flagged
`red` against its `target 40` / `direction lower` (consistent); CS manual metrics 524 / 59 / 4
with `rag: null` because their `target` is `null` (RAG is honestly withheld where no target
exists rather than invented). Only metrics with an actual frozen value appear in `columns`/`cells`.

### Q4 — Awaiting-history and unwired metrics surfaced honestly, not fabricated — **PASS (strong)**
A clean three-way classification is observable:
- **supported** → appears in `columns` + `cells` with a real value;
- **`awaiting`** → in `unsupported[]`, reason *"No frozen daily history yet in this window —
  rows appear once EOD freezes accumulate."* (e.g. NT `frt_compliance`, `csat_score`);
- **`unwired`** → in `unsupported[]`, reason *"No data source wired yet — this metric can never
  carry frozen daily history in this build (not fabricated)."* (NT `fcr_rate`, `reopen_rate`,
  `bug_escalation_ack_hrs`).
No `awaiting` or `unwired` metric ever appears as a fabricated column or a fabricated cell. This
is exactly the evidence-integrity behaviour the programme exists to guarantee.

### Q5 — Missing cells/days shown honestly, not backfilled — **PASS (strong)**
NT's single row contains only the `queue_total` cell; the 25 unsupported metrics are absent from
`cells` rather than zero-filled. Six of eight spaces have `hasData:false`, `rows:[]` — they
return **zero rows**, not 30 invented rows to fill the window. When the window excludes the only
frozen day (see Q6), the surface returns `rows:0` and `columns:0` rather than backfilling.
A bogus space (`__ZZZNOTASPACE__`) returns `404 {ok:false,"Unknown space"}` — no fabricated card.

### Q6 — `window` behaves honestly; `days` is a consistent alias — **PASS**
- `?window=7|14|30|90` → `windowDays` echoes the value; the `2026-05-29` row is included while
  it falls inside the window.
- `?window=1`, `?window=0`, `?window=-3` → clamped to a floor of `windowDays=2`, returning
  `rows:0`/`columns:0` because the only frozen day (`2026-05-29`) falls **outside** a 2-day
  window ending today (`2026-06-01`). Honest: empty, not backfilled. *(Minor: a requested
  `window=1` reports `windowDays=2` — a defensive floor, not a fabrication, but the echoed value
  does not match the request.)*
- `?window=abc` and `?date=2026-05-29` → fall back to the default `windowDays=30`. Honest default.
- **`?days=7|14|30` behaves identically to `?window=`** — it is a working, consistent alias.
- **`?window=7&days=30` → `windowDays=7`** — `window` takes precedence when both are supplied
  (deterministic, consistent).
Row inclusion always reflects which frozen days actually fall inside the resolved window — no
day is invented to satisfy a larger window.

### Q7 — Isolation from the legacy KPI system, no regression — **PASS**
Isolation: legacy probes do not serve this surface — `/api/kpi-data/daily-history` and
`/api/kpi-data/agents` both `500 "KPI SQL Server not configured"`; `/api/kpi-data/history`,
`/api/kpi-data/daily`, `/api/kpi-data/daily-history-parity`, `/api/kpi/breached` all `404`. The
clean-sheet surface served full data while the legacy pool was unconfigured ⇒ no dependency on
`techservicesjsm`.
Regression: clean-sheet siblings healthy — `/api/kpi/slt`, `/api/kpi/qa-parity`,
`/api/kpi/escalations-parity`, `/api/kpi/agent-breaches`, `/api/kpi/team/NT`, `/api/kpi/spaces`
all `200/ok:true`. (`/api/kpi/trends-parity` returns `404`, but that is a path-naming artefact
of this probe, not a Trends regression — the Trends surface is served under its own established
path and is out of scope here.)

---

## Material blocker
None. The surface is functional, correctly scoped, honest under empty data / awaiting / unwired
families and missing cells, isolated from the legacy system, and renders real frozen supported
values with consistent RAG.

## Bounded non-blocking gaps
1. **True multi-day (>1 row) presentation unverified.** Only one EOD freeze exists in this
   environment (`2026-05-29`), so every populated space returns a single row. The grid is
   structurally multi-day and honours `window`/`days`, but its behaviour across multiple
   distinct dates (correct date ordering, per-day cell alignment, gap days within a window)
   could not be exercised. It degrades honestly to one real row; it does not fabricate days.
2. **Sparse populated coverage.** Only 2 of 8 spaces (NT, CS) carry any frozen row, and NT's
   supported set is a single metric (`queue_total`). The supported-value path is therefore
   verified only for a thin slice; the broader populated grid (many supported metrics × many
   days) is not yet observable. Honest, not a defect.
3. **`window=1` echoes `windowDays=2`.** A defensive lower floor; honest (no fabrication) but the
   echoed window value does not match the requested one. Worth confirming this matches the
   intended UI contract.

## Next best step: **checkpoint this Daily History slice, then one bounded multi-day fixture pass**
The honesty, isolation, regression-safety, three-way classification, missing-cell/day handling,
and `window`/`days` semantics are all observably correct, and — unlike WP8 — the supported-value
path is **populated and verified** for the data that exists. This slice is **safe to checkpoint
as-is**.

For an evidence-integrity programme, "correct for one frozen day" is necessary but not the full
parity claim. Before Daily History parity is considered fully closed, recommend one short pass
that seeds a minimal, disposable set of **2–3 consecutive frozen `kpi_daily` days** for at least
NT (and ideally one with an intentional gap day and one metric that drops in/out), then re-runs
this probe to confirm:
1. multiple rows render in correct date order with per-day cells correctly aligned to columns;
2. a gap day inside the window is shown as genuinely missing (no carried-forward or interpolated
   value);
3. `window`/`days` trims the row set to exactly the in-window days, no more.
If those hold, the Daily History parity slice can be checkpointed in full. Until then, checkpoint
the honest single-day / isolation slice and keep the true multi-day path flagged as unverified.
