# Build Status — P2-WP1-ITER1: Phase 2 Capture Observability

**Work package:** `P2-WP1-ITER1`
**Date:** 2026-05-30
**Agent:** Build
**Scope:** Make the existing Phase 2 freeze/capture path directly exercisable and observable. No scope broadening.

---

## Summary

The Phase 2 EOD freeze/capture path was already implemented and wired into the
running server (`KpiEodService`, the `kpi-engine-eod` job, and the `/api/kpi/*`
read surface). The only thing missing for evaluation was an operator-facing way
to **trigger** a freeze on demand — independent of the natural weekday/timezone
EOD window — so frozen writes and idempotent recapture could be observed.

This iteration closes that gap with a bounded change: an explicit `force` mode on
the existing on-demand capture endpoint, plus a single-space force form that was
already present. No legacy behaviour changed; no new metric families, views,
digests, admin UI, or broad backfill were added.

---

## 1. Operator-facing trigger / execution path that now exists

**Endpoint:** `POST /api/kpi/eod-capture` (authenticated, same NOVA JWT as the
rest of `/api/*`; coexists with the unrelated legacy `POST /api/kpi/derived/run`).

It accepts an optional JSON body and exposes three ways to drive the freeze:

| Body | Behaviour |
|------|-----------|
| `{ "force": true }` | **Force-capture ALL active Jira spaces now**, ignoring the weekday / holiday / before-EOD / already-captured gates. This is the single clean call to demonstrate the freeze path off a natural weekday EOD (e.g. on a Saturday). |
| `{ "spaceKey": "NT" }` (optional `"date": "YYYY-MM-DD"`) | Force-capture **one** space now, bypassing the EOD time gate. `date` overrides the report date. |
| *(no body)* | Run the normally-gated cycle — captures only spaces that have actually reached their own EOD and aren't already frozen (unchanged scheduler behaviour). |

The forced paths reuse exactly the same `captureSpace(...)` freeze code as the
scheduled `kpi-engine-eod` job — they only skip the time/weekday gate. So what the
evaluator triggers on demand is the identical write path that runs at 17:30/18:00
in production; nothing about the capture logic is special-cased for evaluation.

The scheduled job (`runEodCycle()` with no options) remains fully gated and
unchanged — forcing is opt-in via the endpoint only.

### Supporting read endpoints (already present) to observe the result

- `GET /api/kpi/daily/:spaceKey/:date` — frozen `kpi_daily` rows for a space (value, target, **rag**).
- `GET /api/kpi/agent/:spaceKey/:date` — frozen `kpi_agent_daily` rows for implemented agent metrics.
- `GET /api/kpi/eod/:date` — `kpi_eod_snapshot` ticket-state aggregation across spaces.
- `GET /api/kpi/daily-report/:date` — full assembled report (reads frozen rows, does not recompute), incl. per-space `ragSummary` and `captured` flag.
- `GET /api/kpi/health` — proves schema/seed/scheduler are live (incl. EOD job run count / last error).

---

## 2. How this lets the evaluator observe frozen writes + idempotent recapture

A self-contained evaluation sequence, runnable any day of the week:

1. **Trigger:** `POST /api/kpi/eod-capture` with `{ "force": true }`.
   - Response lists `captured[]` with per-space `dailyRows`, `agentRows`,
     `eodRows`, `reportDate`, `snapshotTime`, plus `forced: true`.

2. **Observe `kpi_daily` (+ RAG):** `GET /api/kpi/daily/NT/<reportDate>`.
   - Each metric row carries `value`, `target`, and a persisted `rag`
     (`green`/`amber`/`red`, or `null` when no target/neutral direction). RAG is
     computed at capture time from the configurable `kpi_space_metrics`
     (`target_value` + `amber_band` %) joined with metric `direction` — no
     hardcoded targets — and stored on the frozen row (`kpi_daily.rag_status`).

3. **Observe `kpi_agent_daily`:** `GET /api/kpi/agent/NT/<reportDate>`.
   - Per-agent values for the in-scope **implemented** agent metrics only
     (computed metrics with a registered Phase 1 computer). Manual/uncomputable
     metrics are intentionally absent — not silently zero-filled.

4. **Observe `kpi_eod_snapshot`:** `GET /api/kpi/eod/<reportDate>`.
   - Ticket-state groups per space (tier / status / request_type) with
     `ticketCount` and `overSlaCount`.

5. **Idempotent recapture:** re-issue the same `POST … { "force": true }`.
   - `captureSpace` does `DELETE … WHERE space_key AND report_date` then
     re-`INSERT` for `kpi_daily`, `kpi_agent_daily`, and `kpi_eod_snapshot`. So a
     second forced run for the same (space, date) **replaces** rather than
     duplicates: row counts and values converge to one official set. The
     evaluator can diff the two responses / re-read the daily endpoints and
     confirm no duplication and a stable result.

The single-space form (`{ "spaceKey": "NT" }`) gives the same guarantees for one
space if the evaluator wants to isolate a space or pin a specific `date`.

---

## 3. Remaining bounded gaps

- **Live data dependency.** Captured values reflect whatever is currently in the
  NOVA `jira_issue_cache` for each space at trigger time. On a non-working day the
  numbers are "as of now", not a historical weekday close — correct and expected
  for an on-demand demonstration, but the evaluator should judge *write
  behaviour, RAG persistence, and idempotency*, not the business plausibility of a
  weekend value.
- **Agent rows are bounded to implemented computed metrics.** Metrics without a
  Phase 1 computer (and all manual-source metrics) produce no agent rows by
  design; this is in line with the Phase 2 slice and is not a regression.
- **No new historical backfill.** Forcing captures "today" per space timezone (or
  a single explicit `date` for the single-space form). Broad multi-date backfill
  was deliberately left out of scope.

None of these block evaluation of the required Phase 2 capture behaviours.

---

## 4. Legacy non-regression

- No legacy table, route, or job was modified. The clean-sheet system remains
  fully parallel (`kpi_*` tables in the NOVA main pool; legacy KPI pipeline
  untouched).
- The scheduled EOD job's gating logic is unchanged; `force` is reachable only
  through the operator endpoint.
- `tsc -p tsconfig.server.json --noEmit` passes with no errors.

---

## 5. Readiness

**Ready for re-evaluation.** A real operator-facing trigger now exists that lets
the evaluator force the exact production freeze path on any day, observe writes
into `kpi_daily` (with persisted RAG), `kpi_agent_daily`, and `kpi_eod_snapshot`,
and verify idempotent recapture — without waiting for a natural weekday EOD and
without any scope expansion.

### Changed files
- `src/server/services/kpi-engine/kpi-eod.ts` — `runEodCycle(now, { force })` adds an opt-in mode that bypasses the weekday/holiday/before-EOD/already-captured gates (still skips manual spaces, still idempotent); returns `forced` in the result.
- `src/server/routes/kpi-engine.ts` — `POST /api/kpi/eod-capture` reads `force` from the body and documents the three trigger forms.
