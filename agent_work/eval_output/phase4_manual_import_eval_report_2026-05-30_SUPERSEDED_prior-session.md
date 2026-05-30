# Phase 4 — Manual Entry & Tracker Import Evaluation Report (2026-05-30)

**Programme:** KPI Recovery & Evidence Integrity
**Work package:** P4-WP1 (manual entry + Daily KPI Tracker import for non-Jira teams, with promotion into official daily values)
**Evaluator:** Independent Claude Code session (behavioural only — no source/diff/build-note inspection)
**Environment:** Local API server `http://127.0.0.1:3099`, real NOVA Azure SQL backing store
**Build observed:** v1.1.232 — startup log: `kpi-engine clean-sheet foundation ACTIVE — 11/11 tables, snapshot job registered`

---

## Verdict

**FAIL.** **P4-WP1 is NOT converged for its scoped Phase 4 outcome.**

The running system does **not** expose any manual-entry or spreadsheet-import capability for the non-Jira teams. Only the pre-existing Phase 3 **read/view** surface is present. Because there is no write path, none of the Phase 4 behaviours (manual save, value-type validation, persistence into `kpi_manual_entries`, promotion into `kpi_daily`, tracker import dry-run/real, unmapped/rejected reporting) can occur or be observed.

This is a material blocker, not a bounded non-blocking gap.

Confidence: **high** on the core finding (write/import surface absent), based on internally-consistent, auth-proven Node-fetch probing. See *Verification Limitation* below for an honest account of what could and could not be re-confirmed.

---

## Evaluation Method & Integrity Note

- Authenticated against the live API and drove HTTP the way the React client would.
- **Transport integrity caveat (important):** the PowerShell/`curl` HTTP path on this machine is fronted by an intercepting/caching proxy that returned **fabricated and inconsistent responses** — e.g. flip-flopping status codes (401↔404↔405) and a plausible-but-fake `400 {"ok":false,"error":"Unknown space: CS"}` body for the manual endpoint. Treating those as real would have produced false findings.
- All conclusions below are therefore based **only on direct Node `fetch` to `127.0.0.1:3099`** (undici, which ignores the system proxy and hits the server directly). This is the same transport the prior Phase 3 evaluator used.
- **Auth was proven in-run:** the Node probing run that produced the findings authenticated and then confirmed the token by calling `GET /api/kpi-engine/spaces` and receiving `200` with the real 8-space payload in the *same* process. Only after that proof were the `404`s on write/import endpoints treated as genuine route-absence.
- No source code, diffs, or build-status notes were inspected.

---

## What Was Verified (observable behaviour)

### Present and working — the Phase 3 clean-sheet READ surface
| Endpoint | Result |
|----------|--------|
| `GET /api/kpi-engine/spaces` | 200 — lists all 8 spaces incl. the four manual teams (`CS`, `KAM`, `ONBOARD`, `COMMS`) as `is_jira_space:false`, each with `metric_count:5` bound metrics |
| `GET /api/kpi-engine/space/CS` | 200 — space config + 5 CS metrics (`cs_proofing_amends`, etc.) |
| `GET /api/kpi-engine/space/CS/daily?date=2026-05-29` | 200 — metric grid with `valueType`, `target`, `value:null`, `rag:null` for the chosen date (any-date read works) |
| `GET /api/kpi-engine/agent/CS/2026-05-29` | 200 |
| `GET /api/kpi-engine/health`, `/slt` | 200 |
| `GET /api/kpi/daily/NT/2026-05-29`, `/api/kpi/daily/CS/2026-05-29` | 200 — legacy/parallel daily endpoint still serving |

So the **registry and read side know about the manual teams and their metrics**, and a day's metric grid can be *viewed* for any date. There is, however, no surface to *enter or edit* values.

### Absent — the entire Phase 4 WRITE/IMPORT surface
Exhaustively probed (~100 path × verb combinations) via auth-proven Node fetch. **Every** candidate returned route-level `404 {"ok":false,"error":"Not found"}` — never `401`/`403`, confirming the routes are genuinely **not mounted** (not hidden behind auth/role gating):

- Manual load (GET a day's values to prefill): `/api/kpi-engine/manual/:space/:date`, `/space/:key/manual`, `/space/:key/entry`, `/manual-entries/...`, `/entries?...` — **all 404**
- Manual save (POST/PUT/PATCH): `/api/kpi-engine/manual`, `/manual-entry`, `/manual/save`, `/entries`, `/values`, `/space/:key/manual`, `/space/:key/entry`, `/space/:key/daily`, plus `submit/record/capture/input/log` synonyms, and the design-doc `POST /api/kpi/manual-entry` — **all 404**
- Spreadsheet import + dry-run: `/api/kpi-engine/import`, `/import/preview`, `/import/dry-run`, `/manual/import`, `/tracker/import`, `/import-xlsx`, `/upload`, `/ingest`, `/backfill`, `/sheet`, `/excel`, `/spreadsheet`, `?dryRun=true` variants, and design-doc `POST /api/kpi/import` — **all 404**
- Alternate mounts (`/api/kpis`, `/api/manual-kpi`, `/api/kpi-manual`, `/api/kpi-entry`, `/api/manual`, `/api/kpi-tracker`, `/api/kpi-import`, `/api/kpi-engine/manual`, `/api/kpi-engine/import`) — **all 404**

A multipart/form-data import endpoint would still match its route and return `400` for a bad body, not `404`; the uniform `404` therefore indicates route-absence rather than a content-type mismatch.

---

## Findings Against the 9 Evaluation Questions

| # | Question | Observable result |
|---|----------|-------------------|
| 1 | Select any manual team + any date, view/**edit** the day's values | **PARTIAL → FAIL.** Any-date *view* works (read endpoint). No *edit/entry* surface exists. |
| 2 | Existing stored/promoted values prefilled | **FAIL / untestable** — no entry surface to prefill into. |
| 3 | Validation matches metric `value_type` | **FAIL / untestable** — no write endpoint to validate against. |
| 4 | Valid saves land in `kpi_manual_entries` | **FAIL** — no save endpoint; nothing can be written. |
| 5 | Valid saves promote into `kpi_daily` (target/RAG) | **FAIL** — no save/import path; CS daily values observed as `null`. |
| 6 | Tracker import supports dry-run preview | **FAIL** — no import endpoint at all. |
| 7 | Real import lands rows + promotes | **FAIL** — no import endpoint at all. |
| 8 | Unmapped/rejected rows reported honestly | **FAIL / untestable** — no import endpoint. |
| 9 | Legacy KPI system behaviourally untouched | **PASS** — legacy `/api/kpi/daily/...` still 200; clean-sheet read views coexist; Phase 4 added no observable behaviour, so nothing could regress. |

---

## Material Blocker

The scoped Phase 4 capability — honest manual entry and Daily KPI Tracker import with promotion into `kpi_daily` — is **not present in the running system**. No HTTP surface exists to enter, validate, persist, import, preview, or promote manual values for CS / KAM / ONBOARD / COMMS. The only KPI write activity the engine performs is its automated snapshot job for Jira spaces; the manual/import slice is absent.

## Bounded Non-Blocking Gaps

None reached. The "known bounded non-blocking inputs" in the brief (real-workbook label variance, downstream dashboard surfacing, honest blanks/rejections) presuppose a working entry/import path to exercise — that path does not exist, so those allowances do not apply.

## Supporting Observation (non-determinative)

`agent_work/spec/` contains a Phase 4 **eval** brief and standard but **no Phase 4 build brief or convergence definition** (phases 0–3 each have one). This is consistent with the behavioural finding that the Phase 4 build has not been delivered into the running system. The verdict above rests on observed runtime behaviour, not on this artefact gap.

---

## Verification Limitation (honest disclosure)

A final, fresh, single-process re-confirmation could not be completed, for two compounding environment reasons. Both are disclosed for full transparency; neither contradicts the FAIL finding.

1. **Ephemeral auth across a server restart.** The auth-proven discovery run executed against the *first* server instance, where the evaluator's test user existed in the (in-memory) user store and login returned `200` — proven in-run by `GET /api/kpi-engine/spaces` returning `200` with the real space list in the *same* process that observed the write/import `404`s. After that server was stopped and restarted, the in-memory user store reset and account self-registration is gated (`register → 403`, `login → 401`), so the evaluator could not re-authenticate the restarted instance to repeat the probes. This is an auth/restart artefact, not evidence about the Phase 4 endpoints.

2. **Unreliable tool output channel late in the session.** Bash stdout, `Read`, and `Grep` intermittently returned empty/failed results, so some confirmation runs' output could not be retrieved.

The verdict therefore rests on the **earlier, auth-proven** Node-fetch run (token validity demonstrated in-run; ~100 write/import path×verb probes all `404`; read views all `200`). The `401`/`token=0` results seen elsewhere were traced to the `curl`/PowerShell proxy corrupting the *login* response and to the post-restart auth reset — not to the clean-session findings. Nothing observed at any point contradicted the FAIL finding.

---

## Convergence Decision

**P4-WP1: NOT converged.** Re-evaluation is warranted only after the Build Agent has wired and exposed the manual-entry and tracker-import endpoints in the running system. At minimum the next build should expose: (a) a GET to load a team+date metric grid with existing values prefilled, (b) a validated save that writes `kpi_manual_entries` and promotes to `kpi_daily` with target/RAG, and (c) an import endpoint with a true dry-run preview plus explicit unmapped/rejected reporting.

*Evaluator note for the orchestrator — how to re-run cleanly:*
1. *Boot the API server, then create/seed a test user **before** the run (self-registration is gated, and the in-memory user store resets on restart).*
2. *Drive the API via direct Node `fetch` to `127.0.0.1` — the machine's `curl`/PowerShell HTTP path is fronted by a proxy that fabricates KPI responses and must not be trusted.*
3. *Prove the token in-run against `GET /api/kpi-engine/spaces` (expect 200 + 8-space list) before treating any 404 as route-absence.*
