# KPI Trends Parity — Window Hardening Build Status — 2026-05-31

**Work Package:** `KPX-WP7B` — Trends window-parameter hardening
**Agent:** Build Agent
**Scope:** Window parameter handling for the clean-sheet Trends route only. No redesign, no synthetic history, no legacy changes.

---

## Defect found

The clean-sheet Trends route `GET /api/kpi/trends/:spaceKey` read the window from the **wrong query parameter**.

- The route parsed `req.query.days` only.
- The canonical programme contract (and the prior evaluator probes) use `?window=N`.
- Result: every `?window=N` request found no `days` param → fell through to the `NaN → 30` default, so `data.windowDays` was **always 30 regardless of the requested window**. Invalid values (`999`, `0`, `-5`, `abc`) were likewise silently absorbed as the default.

The service-layer read model (`KpiViews.getTrends`) was **not** the problem — it already clamped its `days` argument to `[2, 90]`. The defect was purely that the route never passed the requested window through to it. (Note: the existing clean-sheet client `KpiCleanTrendsView.tsx` sends `?days=`, which is why the in-app selector appeared to work while the canonical `?window=` contract did not.)

## What was changed

A single, route-only change in `src/server/routes/kpi-engine.ts` (the `/trends/:spaceKey` handler). No change to the service/read model, classification logic, or any legacy code.

The window is now parsed honestly and consistently:

- Accept `?window=N` as the **canonical** parameter, with `?days=N` kept as a **legacy alias** (preserves the existing in-app client without a client change). `window` takes precedence when both are present.
- Parse the value as an integer. **Any finite integer is clamped into the supported `[2, 90]` range.** Anything unparseable or absent falls back to the default of 30.
- The applied window is echoed back as `data.windowDays`, so an out-of-range request is clamped **transparently** (the response truthfully states the window actually used) rather than silently swallowed.

The route doc comment was updated to document `?window=N` (with the `?days=` alias). Nothing else was touched.

## How the route now behaves (verified against the running server)

Probed live via `GET /api/kpi/trends/NT` (admin token, `127.0.0.1:3001`):

| Request | Status | `windowDays` | Behaviour |
| --- | --- | --- | --- |
| `?window=7` | 200 | **7** | honoured |
| `?window=14` | 200 | **14** | honoured |
| `?window=30` | 200 | **30** | honoured |
| `?window=90` | 200 | **90** | honoured |
| `?window=999` | 200 | **90** | clamped to max, transparently |
| `?window=0` | 200 | **2** | clamped to min |
| `?window=-5` | 200 | **2** | clamped to min |
| `?window=abc` | 200 | **30** | unparseable → honest default |
| (no window) | 200 | **30** | default |
| `?days=7` (legacy alias) | 200 | **7** | honoured |
| unknown space `?window=7` | 404 | — | `{ok:false, error:"Unknown space"}` |

**Supported values** (7/14/30/90) are now honoured exactly. **Invalid values** are clamped consistently — every finite integer maps into `[2,90]`, and unparseable input falls back to 30 — and the clamp is honest because the applied value is reported in `windowDays`.

## Preserved behaviour

- **Awaiting-history / not-wired classification:** unchanged. The service read model and its `supported` / `awaiting` / `unsupported(unwired)` classification and honesty notes were not modified. No fabricated multi-day trend is produced where history (≥2 frozen days) still does not exist — the change only governs the size of the lookback window, not whether a trend is drawn.
- **Legacy isolation:** unchanged. No legacy KPI route, view, or table was touched; the surface remains under `/api/kpi/*`.
- **Auth gate:** unchanged (still enforced; unauthenticated → 401).

## Remaining bounded gap

- **Supported multi-day rendering remains unobservable in this environment.** No metric in any space yet has ≥2 frozen EOD days, so the `supported` path still cannot be exercised with real data. This is environmental data accumulation (a second EOD freeze has not occurred), explicitly **out of scope** for this WP, and was not addressed — no synthetic history was generated. Confirming a real `awaiting → supported` transition still depends on a second EOD freeze and a follow-up evaluation.

## Readiness for independent evaluation

**Ready.** The concrete window-handling defect is closed: supported window values are honoured, invalid values are clamped honestly and consistently with the applied value echoed back, and the awaiting/not-wired behaviour and legacy isolation are preserved. The slice is focused on window behaviour only and is ready for an independent behavioural re-evaluation.
