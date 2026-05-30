# KPI Recovery — Phase 3 Views Evaluation Report

- **Work Package:** `P3-WP1`
- **Date:** 2026-05-30
- **Evaluator:** Independent evaluator session (behavioural only — no source inspection used to judge correctness)
- **Method:** Running NOVA API exercised over HTTP against the locally-running server (`localhost:3001`), which connected to the live NOVA Azure SQL database (`bym-asqlep01/NOVA`). Authenticated session used to reach protected endpoints. Clean-sheet, legacy, and wallboard surfaces probed and their rendered output inspected.

## Verdict

**QUALIFIED PASS — `P3-WP1` is converged for its scoped Phase 3 outcome.**

All four core view surfaces (SLT, team, agent, clean-sheet wallboards) are observably present, observably backed by the clean-sheet KPI data source, and handle sparse/empty/manual states honestly. The legacy KPI system remains behaviourally intact and bound to its own separate data path. The qualifier reflects bounded, pre-declared non-blocking gaps only — chiefly that no computed snapshot values have yet been captured in this environment, so populated (non-null) metric values could not be observed flowing end-to-end through the views.

---

## Evidence by Evaluation Question

### 1. SLT view — exists and uses clean-sheet data, not legacy
**Verified.** `GET /api/kpi/slt` returns 200 with a cross-space payload covering all 8 spaces. Each space carries clean-sheet attributes (`spaceKey`, `isJiraSpace`, `hasData`, per-space `metrics` with `target`/`rag`/`source`). NTPJ correctly surfaces its bespoke metrics (`story_points_completed`, `sprint_velocity`) that no other space shows — confirming per-space clean-sheet configuration, not a flat legacy feed. **Decisive independence proof:** the SLT view returned healthy data at the same time the legacy KPI SQL pool was unavailable (see Q7), so the SLT view cannot be drawing on the legacy data path.

### 2. Team dashboard per space — exists and uses clean-sheet data
**Verified.** Per-space surfaces all respond 200:
- `GET /api/kpi/spaces/NT/metrics` → enabled metric definitions with targets/config for the space.
- `GET /api/kpi/snapshot/NT` → `{ space:"NT", values:[] }` (honest empty).
- `GET /api/kpi/daily/NT/2026-05-30` → structured payload with `captured:false`, empty `metrics`, `ragSummary {green:0,amber:0,red:0,none:0}`, and an `eodSnapshot` block.
Data shape is clean-sheet (`kpi_*`) throughout; targets (e.g. FRT/Resolution = 90, queue_total = 30, queue_over_sla = 0) flow from per-space config.

### 3. Agent scorecard — exists and uses clean-sheet data
**Verified.** `GET /api/kpi/leaderboard/NT` returns 200 with clean-sheet agent-level `metricDefs` (`frt_compliance`, `resolution_compliance`, `frt_avg_minutes`, `resolution_avg_minutes`, `resolved_today`, …) plus targets and direction. `GET /api/kpi/agent/NT/2026-05-30` returns `{ space:"NT", date:"…", agents:[] }` — present and honest (no fabricated agents). Agent-metric breadth is bounded to the already-implemented agent metrics, as expected.

### 4. New wallboards genuinely backed by the clean-sheet source
**Verified.** Clean-sheet wallboards render at `GET /wallboard/kpi/:space` (HTTP 200, server-rendered HTML):
- NT and STBY render as "live clean-sheet metrics".
- Every clean-sheet wallboard footer explicitly states **"Source: clean-sheet kpi_* (NOVA)"**.
- Unknown space (`/wallboard/kpi/BOGUS`) returns HTTP 404 "Unknown space: BOGUS" — honest rejection, no blank-but-200 fabrication.
The clean-sheet wallboards rendered correctly while the legacy KPI SQL pool was disconnected, confirming they do not depend on the legacy path.

### 5. STBY and manual/non-Jira teams show honest sparse/manual states
**Verified — no fabrication observed anywhere.**
- Manual/non-Jira teams (COMMS, CS, KAM, ONBOARD): `isJiraSpace:false`, `hasData:false`, `metrics:[]`, note: *"Manual / non-Jira team — KPIs captured via manual entry (not in computed scope yet)."* The CS wallboard renders the same manual-state message.
- Jira spaces with no captured data (NT, NTPJ, STBY, YO): `hasData:false`, metric `value:null`, `rag:null`, `asOf:null`, note: *"No clean-sheet data captured yet for this space (sync coverage may be sparse)."* STBY behaves identically (honest sparse), and its EOD snapshot time is correctly `18:00` (India end-of-day) vs `17:30` for UK spaces.
- Values are explicitly `null` rather than zero-as-data or invented numbers; targets are shown but clearly separated from (absent) values.

### 6. Wallboard metric fallback behaves honestly given no `show_on_wallboard = 1` seed rows
**Verified as honest.** With no metrics flagged for the wallboard and no captured data, the clean-sheet wallboards display the explicit no-data / manual-state message rather than fabricating tiles or values. The fallback degrades to an honest "No clean-sheet data captured yet" state. (The specific metric-tile *selection* under fallback could not be observed populated because there is no captured data yet — recorded as a bounded gap, not a failure.)

### 7. Legacy KPI system remains behaviourally untouched
**Verified.** Legacy server-rendered wallboards remain mounted and bound to their own legacy data path:
- `/wallboard/key-accounts` → 200 (renders)
- `/wallboard/customer-success` → 200 (renders)
- `/wallboard/tech-support` → 500 **"Error: KPI SQL not connected"** — i.e. it still depends on the legacy KPI SQL pool (`techservicesjsm`), which is credential-less in this local environment.
This is the cleanest possible coexistence proof: the legacy wallboard fails *because* it still uses the legacy pool, while clean-sheet surfaces in the parallel namespaces (`/api/kpi/*`, `/wallboard/kpi/*`) succeed *because* they use the new `kpi_*` source. The two systems are observably separate, with no namespace collision. The legacy 500 is an environment artifact (missing local creds), **not** a regression introduced by Phase 3.

---

## Engine / Data-Source Health (observed, supporting evidence)

`GET /api/kpi/health` reported: clean-sheet initialised, schema `11/11` tables present, `0` DDL failures; seeds `8 spaces / 88 metrics / 125 space-metrics / 7 tiers`; snapshot scheduler registered (`runCount:1`); EOD scheduler registered (`runCount:0`); `snapshots.rows: 0`; `dbError:null`. This confirms the clean-sheet foundation is live in the NOVA database and the views are reading from it.

---

## Material Blocker

**None.** No core Phase 3 view surface is absent; no view or wallboard depends on a legacy KPI source as its authoritative path; no sparse/manual data is fabricated; legacy behaviour is not regressed.

## Bounded Non-Blocking Gaps

1. **No captured computed values in this environment.** All Jira spaces report `hasData:false` and `snapshots.rows:0`, so populated (non-null) metric values were not observed flowing end-to-end through SLT/team/agent/wallboard. Wiring and honest empty-state handling were fully verified; live value rendering was not. This is consistent with the pre-declared "sparse/absent source data" input and is a Phase 1/2 capture concern, not a Phase 3 view defect.
2. **Wallboard fallback metric *selection* unobservable.** With no `show_on_wallboard = 1` seed rows and no captured data, the fallback correctly shows a no-data state; the specific metrics it would surface once data exists could not be observed. Pre-declared bounded input.
3. **Agent-metric depth bounded** to the already-implemented agent metrics — expected per scope.
4. **Minor inconsistency (cosmetic, non-blocking):** `GET /api/kpi/daily/CS/2026-05-30` (manual team) returns `data:null`, whereas the equivalent Jira-space daily returns a structured `captured:false` object. Both are honest "no data" signals; the shapes differ. Worth normalising but not misleading.

## Scope Discipline

Evaluation stayed within the Phase 3 slice. Phase 4 (manual entry/import), Phase 5 (digests/polish/admin UI), and optional auth-process cleanup were not assessed.

---

## Convergence Statement

`P3-WP1` **is converged** for its scoped Phase 3 outcome: the intended SLT, team, agent, and wallboard views exist, are genuinely backed by the clean-sheet KPI data source, handle sparse/empty/manual cases honestly, and coexist with an untouched legacy KPI system. Grade is **qualified pass** solely because the bounded, pre-declared gaps above (chiefly the absence of captured computed values in this environment) meant non-null value rendering could not be directly observed. These are explicitly non-blocking per the evaluation brief and do not affect convergence of the Phase 3 view layer.

### Evaluation note (environment)
To reach the auth-gated APIs, the running server was restarted once with a fixed `JWT_SECRET` and an admin token was minted (authorised by the scope owner for this session). No application data or KPI tables were modified by the evaluation. A normal restart (without the evaluation env var) restores standard auth behaviour.
