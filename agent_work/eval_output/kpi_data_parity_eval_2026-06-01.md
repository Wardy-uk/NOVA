# Evaluation — KPI Data Surface (Clean-Sheet)

**WP:** KPX-WP10
**Date:** 2026-06-01
**Evaluator:** Eval Agent (behavioural, clean-sheet KPI path)
**Method:** Live API observation against the running server (`http://localhost:3001`).
Read-only admin token minted via the established KPX eval-family path (JWT secret read from
the NOVA runtime DB `settings` table — `src=db-settings`, `secretLen 64` — **not** from app
source). Token proven against three known-good clean-sheet reads (`/api/kpi/slt`,
`/api/kpi/spaces`, `/api/kpi/qa-parity` → all `200/ok:true`) before any conclusion was drawn.
No application source, build-status notes, or diffs were inspected. Raw captures retained:
`agent_work/eval_output/_wp10_discover.json` (24-path discovery sweep),
`_wp10_probe.json` (4 datasets × space/window/limit/combined matrices, unknown-dataset and
isolation/regression sweeps), and `_wp10_space.mjs` output (space-param disambiguation).

---

## Verdict: **QUALIFIED PASS**

The clean-sheet KPI Data surface exists at exactly one clean-sheet endpoint
(`/api/kpi/data/:dataset`), exposes **four genuine raw/grid views over clean-sheet tables**
(`daily`→`kpi_daily`, `agent-daily`→`kpi_agent_daily`, `eod-snapshot`→`kpi_eod_snapshot`,
`snapshot`→`kpi_snapshots`), returns **real raw rows with the table's own columns** rather than
derived summaries or legacy data, is **isolated** from the legacy KPI system, and is **honest on
every empty / sparse / truncated / unsupported axis observed**: empty datasets return zero rows
with an explicit "not fabricated" note, truncation is flagged explicitly, and the legacy-only
`agents_live_roster` family is enumerated as unsupported with a reason rather than faked.

The qualification is a **single observable inconsistency, not a fabrication or correctness
defect**: space filtering works only under the query parameter **`spaceKey`**, whereas the
sibling clean-sheet surfaces (e.g. Daily History) filter by **`space`**. A request using
`?space=NT` is silently accepted and returns the **full unfiltered row set** — its only honest
tell is that `spaceKey` echoes `null`. Functionally the surface filters correctly; the risk is a
client built to the sibling convention would see unfiltered data believing it had filtered.

---

## Observed ground truth

`GET /api/kpi/data/:dataset` → `200 / {ok:true}`. Body shape (identical envelope across all four
datasets):

```
data.dataset / datasetLabel / table        — which clean-sheet table is being shown
data.spaceKey      = null | "<KEY>"         — echoes the applied space filter (null = no filter)
data.windowDays    = 30 (default)           — honours ?window= / ?days=
data.rowLimit      = 500 (default)          — honours ?limit=
data.columns[]     = the table's own raw column names (no derived/aggregate columns)
data.rows[]        = raw table rows
data.rowCount      = rows.length
data.truncated     = true|false             — true when rowLimit capped the result
data.note          = null | honest-empty message
data.datasets[]    = the 4 supported dataset descriptors (key/label/table/windowed/description)
data.unsupportedDatasets[] = legacy-only families surfaced honestly, with reason
```

Per-dataset census (unfiltered, default window 30 / limit 500):

| Dataset | Table | rowCount | truncated | Populated? | Note |
|---------|-------|----------|-----------|------------|------|
| `daily` | `kpi_daily` | 4 | false | yes (CS×3, NT×1) | null |
| `agent-daily` | `kpi_agent_daily` | 0 | false | no | "No clean-sheet Agent Daily rows in the last 30 days … (not fabricated)." |
| `eod-snapshot` | `kpi_eod_snapshot` | 0 | false | no | "No clean-sheet EOD Snapshot rows in the last 30 days … (not fabricated)." |
| `snapshot` | `kpi_snapshots` | 500 | **true** | yes (live, 1000+ rows exist) | null |

Sample real raw rows (not placeholders):
- `daily` → `{report_date:"2026-05-29", space_key:"CS", metric_key:"cs_biz_reviews_daily", value:4, target_value:null, rag_status:null}` — a real frozen row carrying the RAG stored at freeze time.
- `snapshot` → `{snapshot_at:"2026-06-01T07:32:58.975Z", space_key:"NT", metric_key:"backlog_age_avg_days", value:19.2}` — a real live-computed value, most-recent-first.

---

## Key questions

### Q1 — Surface exists and loads from the clean-sheet KPI path only — **PASS**
Served at `/api/kpi/data/:dataset` under the clean-sheet `/api/kpi` namespace, `200/ok:true` for
all four supported datasets. The base route without a dataset (`/api/kpi/data`) returns HTML
`404` (a dataset is mandatory). A 24-path discovery sweep found no alias under `/api/kpi-engine/*`
or other clean-sheet paths. The legacy namespace does **not** serve this surface
(`/api/kpi-data/data/daily`, `/api/kpi-data/daily`, `/api/kpi-data/data`, `/api/kpi-data/datasets`
all `404`); `/api/kpi-data/agents` returns `500 "KPI SQL Server not configured"` (the unconfigured
legacy pool) while the clean-sheet surface returned full data — proving no dependency on the
legacy `techservicesjsm` pool.

### Q2 — Real raw/grid views of clean-sheet rows, not derived summaries or legacy data — **PASS**
Each dataset is a true raw grid: `columns` are the underlying table's own column names (e.g.
`daily`: `report_date, space_key, metric_key, display_name, tier_name, value, target_value,
rag_status`; `snapshot`: `snapshot_at, space_key, metric_key, display_name, tier_name, value`),
and `rows` are raw records — not roll-ups, averages, or RAG cards. `daily` carries 4 real frozen
rows with stored RAG; `snapshot` carries real live values across NT/NTPJ/STBY/YO. Each dataset is
bound to a distinct named clean-sheet table (`kpi_daily`, `kpi_agent_daily`, `kpi_eod_snapshot`,
`kpi_snapshots`); no legacy table is read.

### Q3 — Dataset switching, space, window, and row limiting behave honestly — **PASS (with one bounded space-param caveat)**
- **Dataset switching:** Each dataset key selects its own table/columns/rows. Unknown datasets
  (`frt`, `sla`, `breaches`, `trends`, `escalations`, `team`, `foobar`) all return `400
  {ok:false,"unknown dataset '<x>' (daily | agent-daily | eod-snapshot | snapshot)"}` — explicit
  rejection naming the supported set, never a fabricated empty grid. **Honest.**
- **Window:** `?window=1` excludes the only frozen day (`2026-05-29`, 3 days before today) →
  `daily` `rowCount:0`; `?window=7|30|90` include it → `rowCount:4`; `?window=0|-5` clamp to a
  floor of `windowDays:1`; `?window=abc` falls back to default `30`; `?days=7` is a working,
  consistent alias (`windowDays:7`). Row inclusion always reflects which rows actually fall in the
  window — no day invented. **Honest.**
- **Limit / truncation:** `?limit=N` caps `rowCount` to N and sets `truncated:true` when rows were
  actually cut (`snapshot ?limit=1|2|5` → exactly N, `truncated:true`); when the table has fewer
  rows than the limit, `truncated:false` (`daily ?limit=5|1000` → `rowCount:4, truncated:false`);
  `?limit=0|-3` clamp to floor 1; `?limit=abc` falls back to default 500. The default-500
  `snapshot` result correctly reports `truncated:true` because 1000+ rows exist. **Honest.**
- **Space — bounded caveat:** Space filtering **is wired and correct, but only under the param
  `spaceKey`**: `?spaceKey=NT` → `rowCount:1, spaceKey:"NT", rows all NT`; `?spaceKey=CS` →
  `rowCount:3, spaceKey:"CS", rows all CS` (matches the unfiltered distribution CS×3/NT×1
  exactly). However `?space=NT` — the parameter used by sibling clean-sheet surfaces — is
  **silently ignored**: it returns the full unfiltered set with `spaceKey:null`. This is honest
  inasmuch as `spaceKey:null` discloses that no filter was applied, but it is inconsistent with the
  rest of the clean-sheet path and risks a client filtering with `?space=` and unknowingly seeing
  all spaces. (Path forms `/api/kpi/data/daily/NT` and `/api/kpi/data/NT/daily` both `404`.)

### Q4 — Empty, sparse, and truncated states surfaced honestly, not padded or fabricated — **PASS (strong)**
- **Empty:** `agent-daily` and `eod-snapshot` return `rowCount:0, rows:[]` with the table's
  columns still defined and an explicit note — *"No clean-sheet … rows in the last 30 days —
  nothing has been frozen/captured yet in this window (not fabricated)."* No invented rows, no
  zero-filled grid.
- **Sparse:** `daily` returns its real 4 rows only — it does not pad toward the window or limit.
- **Truncated:** `snapshot` (1000+ live rows) returns 500 with `truncated:true` rather than
  silently returning a partial set as if complete; lowering `?limit` reduces `rowCount` and keeps
  `truncated:true`; raising it past the row count flips `truncated:false`. The flag is an honest
  signal of "there is more behind this view".

### Q5 — Unsupported legacy-only data families surfaced honestly, not faked — **PASS (strong)**
Every dataset payload carries `unsupportedDatasets[]` enumerating `agents_live_roster`
("Agents (live ticket-health roster)") with an explicit reason: the legacy Agents tab listed
per-agent **live** queue health, whereas the clean-sheet path freezes per-agent metric *values*
into `kpi_agent_daily` and stores no live per-agent ticket-count roster — *"so there is no honest
raw row to show."* The unsupported family is named and explained, never presented as an empty or
fabricated dataset. Requesting it (or any other legacy name) as a dataset returns the `400
unknown dataset` rejection.

### Q6 — Isolation from the legacy KPI system, no regression — **PASS**
**Isolation:** legacy probes do not serve this surface (`/api/kpi-data/*` all `404`); the legacy
pool is unconfigured (`/api/kpi-data/agents` → `500 "KPI SQL Server not configured"`) yet the
clean-sheet KPI Data surface served full data ⇒ no dependency on `techservicesjsm`.
**Regression:** clean-sheet siblings all healthy — `/api/kpi/slt`, `/api/kpi/qa-parity`,
`/api/kpi/escalations-parity`, `/api/kpi/agent-breaches`, `/api/kpi/spaces`, `/api/kpi/team/NT`,
`/api/kpi/daily-history/NT` all `200/ok:true`.

---

## Material blocker
None. The surface is functional, correctly scoped to the clean-sheet path, honest under empty /
sparse / truncated / unsupported conditions, isolated from the legacy system, and shows real raw
rows from the underlying clean-sheet tables with no fabrication.

## Bounded non-blocking gaps
1. **Space filter uses `spaceKey`, not `space` (inconsistent with sibling surfaces).** `?spaceKey=`
   filters correctly and echoes the applied key; `?space=` is silently ignored and returns the
   full unfiltered set (only tell: `spaceKey:null`). Not a fabrication, but worth aligning the
   param name with the rest of the clean-sheet path — or confirming the real client sends
   `spaceKey` — so a space filter can never silently no-op.
2. **Populated raw-grid behaviour verified only for `daily` and `snapshot`.** In this environment
   `agent-daily` and `eod-snapshot` are entirely empty (one EOD freeze exists, `2026-05-29`), so
   their populated grids, column alignment, and per-row values could not be exercised. They
   degrade honestly to zero rows with a "not fabricated" note; their populated correctness remains
   undemonstrated only because the data does not yet exist (same coverage limit noted in WP8/WP9).
3. **`daily` sparse coverage.** Only 4 frozen rows (CS×3, NT×1) exist, so window/limit interaction
   with a large multi-day `kpi_daily` set is observable only on a thin slice. Honest, not a defect.

## Next best step: **checkpoint this KPI Data slice, then one bounded space-param + populated-grid pass**
The surface is honest, isolated, regression-safe, correctly truncated, and exposes real raw rows
across four clean-sheet datasets with honest empty/unsupported handling. The only behaviour that
falls short of clean parity is the `space` vs `spaceKey` param-name inconsistency — a real but
bounded risk, not a correctness or evidence-integrity defect. **This slice is safe to checkpoint
as-is.**

Before KPI Data parity is considered fully closed, recommend one short hardening pass that:
1. aligns the space filter parameter with the sibling clean-sheet convention (accept `?space=`, or
   confirm the client uses `?spaceKey=`) so a filter request can never silently return all spaces;
2. seeds a minimal disposable set of frozen `kpi_agent_daily` and `kpi_eod_snapshot` rows (and a
   second `kpi_daily` day) and re-runs this probe to confirm the populated raw grids render with
   correct columns, real values, and honest window/limit trimming across more than one day.
If those hold, the KPI Data parity slice can be checkpointed in full. Until then, checkpoint the
honest single-day / isolation / truncation slice and keep the populated multi-dataset path flagged
as partially unverified.
