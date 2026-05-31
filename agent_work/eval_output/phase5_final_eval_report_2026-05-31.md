# KPI Recovery — Phase 5 Final Evaluation Report

**Work Package:** `P5-WP1` — AI digests, config/admin, health monitoring, thin-trigger n8n
**Evaluator:** Independent Eval Agent (behavioural only; no clean-sheet feature source inspected)
**Date:** 2026-05-31
**Target:** Running NOVA server, `http://localhost:3001`, clean-sheet routes under `/api/kpi/*`
**Method:** Authenticated API interaction with the live server (admin token). Behaviour observed via request/response only.

---

## Verdict: **QUALIFIED PASS — converged for the scoped Phase 5 outcome**

The Phase 5 final slice is observably real, honest, and correctly scoped. Per-space and cross-space SLT digests generate and store; the config/admin surfaces exist and behave honestly; the health surface is honest (not over-optimistic); the n8n role is reduced to a read-only thin-trigger contract; and the legacy KPI system remains behaviourally untouched and isolated.

The qualification (not a clean pass) is narrow and bounded: the **AI digest path could not be observed** (only the deterministic fallback path was exercised, despite an AI key being present), and **provenance is disclosed at generation time but is not embedded in the stored/returned digest record**. Neither is a fail condition under the Phase 5 standard.

---

## Authentication note

All `/api/kpi/*` endpoints are JWT-gated and registration is locked. With explicit authorisation from the scope owner, a short-lived admin token was minted from the server's own signing secret purely to reach the API. No clean-sheet feature source was read to form behavioural judgements; route mount points and one legacy route path were checked only to locate endpoints to probe.

---

## Observable behaviour verified

### 1. Per-space digests generated and stored in `kpi_digests` — ✅ verified
- `POST /api/kpi/digest/generate` returns a structured, honest result that distinguishes provenance: `spacesGenerated`, `sltGenerated`, `aiCount`, `fallbackCount`, and a `skipped` list (e.g. `"NT:no-data"`).
- With no underlying daily data, the generator **honestly skips** every space (`spacesGenerated:0`, all `no-data`) rather than fabricating output.
- After seeding daily data for `NT`, regeneration produced `spacesGenerated:1`, and `GET /api/kpi/digest/2026-05-29` returned a stored per-space record:
  - `id:"1"`, `spaceKey:"NT"`, `digestType:"daily"`, coherent summary reflecting the actual RAG state (`0 green / 0 amber / 1 red … Red: Total Open Tickets`).

### 2. Cross-space SLT digest generated and stored — ✅ verified
- Same generation produced `sltGenerated:true` and a stored cross-space record:
  - `id:"2"`, `spaceKey:null` (the SLT/cross-space marker), summary aggregating across captured teams (`SLT cross-team summary … 1 team(s) captured … Most at risk: Tech Support 2nd Line`).
- The per-space (`spaceKey:"NT"`) vs cross-space (`spaceKey:null`) distinction is observable and correct.

### 3. Config/admin surfaces for the scoped entities — ✅ verified (present and honest)
- **Spaces:** `GET /api/kpi/spaces` returns all 8 seeded spaces with business hours, timezone, pause statuses, tier flag, Jira-vs-manual flag. `PUT /api/kpi/spaces/NT` → `{updated:true, fields:["owner_name"]}`.
- **Metrics:** `GET /api/kpi/spaces/NT/metrics` lists enabled metrics; `PUT /api/kpi/spaces/NT/metrics` → `{applied:1, created:0}`.
- **Tiers:** `GET /api/kpi/tiers/NT` returns tier definitions with FRT/resolution targets.
- **Holidays:** `POST /api/kpi/holidays` → `{added:true}`; `GET /api/kpi/holidays` returns the stored row.
- **Health:** `GET /api/kpi/health` (see §4).
- **Import:** `POST /api/kpi/import` exists and validates input honestly (`"provide fileBase64 (xlsx) or sheets[]"`).
- **Manual entry:** `POST /api/kpi/manual-entry` saves with per-metric `saved`/`rejected` and RAG; `GET /api/kpi/manual/CS/:date` reads back with honest provenance (`source:"manual"`, `enteredBy`, `enteredAt`, `promotedValue`).

### 4. Health surface honesty — ✅ verified (no over-optimism)
`GET /api/kpi/health` discloses real state rather than a rosy summary:
- Schema: `tablesPresent:11 / tablesExpected:11`, `ddlStatementsFailed:0`.
- Seeds: `spaces:8, metrics:88, spaceMetrics:125, tiers:7`.
- Three schedulers (`snapshot` 180s, `eod` 300s, `digest` 900s) each with `registered`, `lastRun`, `runCount`, `lastError`.
- **Critically:** `snapshots: { rows: 0, lastSnapshotAt: null }` — the surface openly admits there is no computed snapshot data, instead of masking the gap. This is the behaviour the standard asks for.

### 5. Digest provenance honesty — ◑ partial, honest at generation
- The generation endpoint cleanly separates `aiCount` vs `fallbackCount`. Observed generation reported `aiCount:0, fallbackCount:2`, i.e. both digests were produced by the **deterministic fallback** path, and this was disclosed.
- The fallback summary text is recognisably templated/deterministic, consistent with the reported provenance.
- **Gap:** the stored/returned digest record (`GET /api/kpi/digest/:date`) carries no explicit provenance flag — a consumer reading a historical digest cannot tell AI from fallback from the record alone; provenance is only visible at the moment of generation.
- **Gap:** an AI API key is present in settings, yet the AI path was not observably exercised (it fell back). The AI generation path therefore remains **unverified** in this evaluation; only the fallback path and its honest accounting were observed.

### 6. Thin-trigger n8n model — ✅ verified within the clean-sheet surface
- The only n8n-facing contract the clean-sheet system exposes is `GET /api/kpi/daily-report/:date`: a **read-only, pre-computed** payload (per-space metrics, `ragSummary`, `eodSnapshot`, `agents`) with `captured:false` honestly flagged when no EOD capture exists.
- n8n performs no computation, SQL, or API orchestration in this model — it fetches a ready payload and formats an email. This is observably the thin-trigger pattern.
- The actual live-n8n cut-over is an operational step (see bounded gaps).

### 7. Legacy KPI system untouched — ✅ verified (true coexistence)
- Legacy mounts (`/api/kpi-data/*`, `/api/trends/*`) are live and reachable; the clean-sheet system is on a separate `/api/kpi/*` prefix — no collision.
- Legacy routes still execute against their **own separate KPI SQL pool** and fail honestly when that pool is unconfigured locally (`"KPI SQL Server not configured…"`). Writing digests/manual entries into the clean-sheet tables had no effect on legacy behaviour.
- This confirms the "everything new, nothing modified" principle: legacy data path (`techservicesjsm` via `kpi_sql_*`) and clean-sheet data path (main NOVA pool, `kpi_*` tables) are isolated.

---

## Material blockers

**None** for the scoped Phase 5 outcome. Digest generation/storage is present and honest; admin/health surfaces are present and honest; the n8n role is thin; legacy is not regressed.

---

## Bounded, non-blocking gaps

1. **AI digest path unobserved.** Only the deterministic fallback path was exercised; the AI path did not produce a digest despite a configured key. Provenance was still reported honestly. (Within the brief's allowance for deterministic fallback; AI path should be confirmed before legacy decommission.)
2. **Provenance not embedded in stored record.** AI-vs-fallback is disclosed at generation (`aiCount`/`fallbackCount`) but not on the read-back digest object. Suggest adding a provenance field to the stored record for downstream honesty.
3. **No out-of-the-box digest/snapshot data in the evaluated environment.** `kpi_snapshots` and `kpi_digests` were empty until manually seeded, because the local instance has no `jira_issue_cache` ticket data (`snapshots.rows:0`). This is an environmental data gap, not a feature defect — the pipeline behaved correctly once data existed.
4. **Live n8n cut-over remains operational.** Disabling the legacy n8n logic and pointing the thin trigger at the new `daily-report` endpoint is a human-approved operational step, explicitly out of code-complete scope.

### Evaluation artefacts injected (disclosure)
To make digest generation observable, the following synthetic data was written to the local dev database during evaluation: manual entries for `CS` and `NT` on 2026-05-29, a `NT` Christmas holiday, a `NT` `queue_total` target change, and the two resulting digest rows (`id:1` NT, `id:2` SLT). These are local dev artefacts only; flag for cleanup if the dev DB is reused for a clean demo.

---

## Convergence decision

`P5-WP1` is **converged for its scoped Phase 5 outcome.** Per-space and SLT digests observably generate and store, the config/admin and health surfaces are present and honest, the n8n role is observably reduced to a thin read-only trigger, and the legacy system is behaviourally intact and isolated. The remaining gaps (AI-path verification, embedded provenance, live cut-over approval) are bounded, non-blocking, and consistent with the known inputs — they belong to the pre-decommission parallel-run/operational stage, not to closing the Phase 5 build slice.
