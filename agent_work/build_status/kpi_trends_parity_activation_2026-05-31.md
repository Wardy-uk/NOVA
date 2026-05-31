# KPI Trends Parity Activation — runtime/build activation recovery (KPX-WP7A)

**Work package:** `KPX-WP7A` — make the already-scoped clean-sheet Trends surface genuinely reachable and observable in the runtime used for evaluation.
**Date:** 2026-05-31
**Agent:** Build Agent (Claude Code)
**Basis:** `agent_work/spec/kpi_trends_parity_activation_build_brief.md` + the prior KPX-WP7 surface (`agent_work/build_status/kpi_trends_parity_screen_2026-05-31.md`).
**Scope discipline:** Runtime activation / observability of the existing Trends surface ONLY. No Trends feature redesign, no new trend families, no engine/source-provider/EOD/schema/seed changes, no read-model logic changes, no legacy KPI changes, no Board MI, no wallboard replacement, no holdout consumption, no forbidden tables. This slice changed **no source code** — the fix is a build-artifact refresh.

---

## 0. Summary

The KPX-WP7 Trends surface was correctly built in **source** and is correctly served by the **dev (`tsx`) runtime** — but it was **absent from the compiled `dist/` build artifact** that the production/evaluated runtime (`npm start` → `node dist/server/server/index.js`) actually runs. The stale `dist/` predated WP4 (QA), WP6 (Escalations) and WP7 (Trends), so the canonical `GET /api/kpi/trends/:spaceKey` route did not exist in the evaluated runtime at all — a 404 — even though it existed and worked in source.

The fix is a **rebuild only** (no source edit): re-running the canonical build chain recompiled the route, the read model, and the client view into `dist/`. The route is now proven live against the **built artifact itself**, started exactly as `npm start` starts it.

- Root cause: **stale compiled artifact**, not a source defect and not a broken build. The build pipeline is green; it simply had never been re-run after the WP4/6/7 source landed.
- Fix: ran `npm run build`; `dist/` refreshed and now contains `/trends/:spaceKey`, `getTrends`, the full Phase 4–7 surface, and the `KpiCleanTrendsView` client chunk.
- Proof: started `node dist/server/server/index.js` (the `npm start` artifact) on an isolated port and hit the route — `200` with the honest payload, window clamp, genuine `404` on unknown space, and an SPA-fallback control confirming real routing.
- Honest behaviour and non-regression preserved; no source touched.

---

## 1. Route / runtime activation issue found

The Trends surface exists end-to-end **in source** and serves correctly in the **dev runtime**:

- Source route: `GET /trends/:spaceKey` in `src/server/routes/kpi-engine.ts` → `views.getTrends(spaceKey, days)`.
- Source read model: `KpiViewsService.getTrends()` in `src/server/services/kpi-engine/kpi-views.ts`.
- Source client view: `src/client/components/KpiCleanTrendsView.tsx`, wired into `App.tsx` (view union `'kpic-trends'`, lazy import, **KPI Platform → Trends** nav tab, render branch).
- Verified against the **running `tsx` dev server (port 3001)** — which `Get-CimInstance` confirms is `tsx … src/server/index.ts` (i.e. running from source): `GET /api/kpi/trends/NT` → `200`, honest `supported=0 / unsupported=26`, `?days=90` → `windowDays=90`, `GET /api/kpi/trends/UNKNOWNXYZ` → `404 Unknown space`. The route works in source.

**The gap is in the compiled artifact.** The production/evaluated runtime does not run source — `package.json` `start` is `node dist/server/server/index.js`, fed by `npm run build` (`… && tsc -p tsconfig.server.json`). The `dist/` on disk was last compiled **2026-05-30 18:35**, before the WP4/WP6/WP7 source was added. Inspecting that stale artifact:

| Stale `dist/server/server/routes/kpi-engine.js` (2026-05-30) | Present? |
|---|---|
| `/spaces`, `/health`, `/slt`, `/team/:spaceKey`, `/leaderboard/:spaceKey`, `/manual…`, `/import` (Phase 1–4) | yes |
| `GET /trends/:spaceKey` (KPX-WP7) | **no (0 matches)** |
| `/escalations-parity` (KPX-WP6) | **no (0 matches)** |
| `/qa-parity` (KPX-WP4) | **no (0 matches)** |
| `getTrends` in compiled `kpi-views.js` | **no (0 matches)** |

So any runtime started from that `dist/` (the canonical/evaluated runtime) returned **404** for `/api/kpi/trends/:spaceKey` — the route was never compiled in. The prior WP7 report looked complete because it validated source/dev, where the route is genuinely live; the stale build artifact was the unobserved activation gap. This is the runtime analogue of the KPX-WP5A escalation-router case — there the cause was a conditional mount in source; here the cause is a stale compiled artifact — same observable symptom (route 404 in the evaluated runtime), different root cause.

Note: the build pipeline is **not** broken — re-running it succeeds cleanly (§2). The artifact had simply gone stale relative to source.

---

## 2. What was changed to make the Trends surface observable

**No source code was changed.** The only action was to rebuild the artifact the evaluated runtime runs:

- Ran the canonical build: `npm run build` (`cd nova-mcp && npm run build && cd .. && vite build && vite build --config vite.widget.config.ts && tsc -p tsconfig.server.json`). Completed **exit 0** (client bundle, widget bundle, and server `tsc` emit all succeeded).
- `dist/` refreshed to **2026-05-31 16:45**. Post-build verification of the compiled artifact:
  - `dist/server/server/routes/kpi-engine.js` now contains `router.get('/trends/:spaceKey'` (and `/escalations-parity`, `/qa-parity` — the full Phase 4–7 surface).
  - `dist/server/server/services/kpi-engine/kpi-views.js` now contains `getTrends`.
  - `dist/client/assets/KpiCleanTrendsView-*.js` now exists and references the `/api/kpi/trends/` fetch (the client view is compiled into the served bundle).

`dist/` is a gitignored local build artifact, so this refreshed build persists **on disk** for the local evaluated runtime — which is exactly what `npm start` serves. The build being green means it also stays current for anyone who re-runs `npm run build`.

---

## 3. How runtime observability now proves the route is live

To prove the **built** runtime (not just source/dev) serves the route, the compiled server was started exactly as `npm start` starts it — `node dist/server/server/index.js` with `PORT=3091` (an isolated port, so the dev server on 3001 was undisturbed) — and probed authenticated (admin). A genuinely-fake path is included as a control so a `200`/JSON-`404` cannot be mistaken for a blanket gate artefact:

| Request (authenticated, **built `dist/` runtime, :3091**) | Result | Meaning |
|---|---|---|
| `GET /api/kpi/health` | **200** `{ok:true}` | Clean-sheet foundation live in the built runtime |
| `GET /api/kpi/spaces` | **200** `{ok:true}` | Space list (drives the Trends selector) live |
| `GET /api/kpi/trends/NT` | **200** `{ok:true, windowDays:30, supported:0, unsupported:26}` | **Canonical Trends route live in the built runtime** |
| `GET /api/kpi/trends/NT?days=90` | **200** `windowDays:90` | Window parameter honoured |
| `GET /api/kpi/trends/NT?days=5000` | **200** `windowDays:90` | Window clamp (2–90) working — not a fabricated wider window |
| `GET /api/kpi/escalations-parity` | **200** `{ok:true}` | Sibling WP6 surface also restored by the rebuild |
| `GET /api/kpi/qa-parity` | **200** `{ok:true}` | Sibling WP4 surface also restored by the rebuild |
| `GET /api/kpi/trends/UNKNOWNXYZ` | **404** `{ok:false, error:"Unknown space"}` | Genuine route-level validation (JSON envelope) — route is matching, then validating |
| `GET /api/kpi/FAKE-control-route` | **404** (SPA `index.html`) | Control: a truly unrouted path falls through to the SPA fallback → the `200`/JSON-`404` above are **real routing**, not gate noise |

This directly clears the activation question: `GET /api/kpi/trends/:spaceKey` returns a real, route-matched response from the **compiled artifact the evaluated runtime runs**, with the honest WP7 payload shape (`supported` / `unsupported` split, `windowDays` clamp), not a 404.

### Behaviour preserved + non-regression

- **Honest empty state preserved.** `supported=0 / unsupported=26` for NT is the WP7-designed honesty behaviour, not a defect: the environment has `<2` frozen `kpi_daily` days per metric, so every metric is correctly classified `awaiting history` / `not wired` with **no fabricated line**. Cards populate the moment a second EOD freeze lands.
- **Clean-sheet siblings non-regressed** in the built runtime: `slt`, `team`, `qa-parity`, `escalations-parity`, `health` all `200`.
- **Legacy KPI untouched** — no source changed, so the legacy `TrendsView` / `POST /api/kpi/derived/run` / `kpi-pipeline` paths are byte-for-byte unchanged.
- The transient :3091 proof instance was **stopped** after verification; the dev server on :3001 remained healthy throughout (`/api/kpi/health` → `200`).

---

## 4. Remaining bounded gap

- **History depth is environment-dependent (unchanged from WP7).** With `<2` frozen `kpi_daily` days per metric in this environment, the Trends surface correctly shows metrics under "Not yet trendable → awaiting history / not wired" rather than as populated charts. This is the expected data-presence gap, not a route/runtime defect — the route is live and returns the honest classification. To demonstrate a populated `supported` trend, accumulate ≥2 EOD freezes (e.g. repeated `POST /api/kpi/eod-capture` across dates, optionally with the WP6A escalations fixture for a populated family).
- **`dist/` is a gitignored local artifact.** The fix is the refreshed on-disk build, which the evaluated runtime (`npm start`) serves directly. It persists for the local instance; re-running `npm run build` (verified green) keeps it current. No deploy/CI change is in scope for this phase.
- No other gap: the Trends route, its read model, and its client chunk are all present and behaving in the built runtime.

---

## 5. Ready for independent evaluation?

**Yes.** The single activation blocker — the canonical `GET /api/kpi/trends/:spaceKey` route missing from the compiled `dist/` that the evaluated runtime runs — is resolved by rebuilding the artifact (no source change). The route is proven live against the **built** runtime started exactly as `npm start` starts it, returns the honest WP7 payload (with window clamp and genuine unknown-space `404`), a control path confirms the response is real routing, and the WP7 honest-empty-state behaviour plus the clean-sheet/legacy surfaces are non-regressed.

### Suggested re-eval checks (running software only)

1. Start the evaluated runtime from the build (`npm start`, or its existing launch) and authenticate.
2. `GET /api/kpi/trends/NT` → `200` with `{ windowDays:30, supported:[…], unsupported:[…] }` (not `404`).
3. `GET /api/kpi/trends/NT?days=90` → `windowDays:90`; `?days=5000` → clamps to `90`; garbage `days` → falls back to `30`.
4. `GET /api/kpi/trends/UNKNOWNXYZ` → `404 Unknown space`; a clearly-fake `/api/kpi/<random>` → SPA fallback (confirms the above is real routing).
5. UI: **KPI Platform → Trends** renders the space/window selectors and, per metric, either a supported trend card (≥2 frozen days) or an honest "Not yet trendable" row — never a fabricated line. Legacy **Trends** area unchanged.
