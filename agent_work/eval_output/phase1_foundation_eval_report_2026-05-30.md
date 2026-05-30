# P1-WP1 — Clean-Sheet KPI Foundation: Independent Phase 1 Evaluation

**Work package:** P1-WP1 (KPI Recovery — clean-sheet foundation slice)
**Evaluation date:** 2026-05-30
**Evaluator mode:** Observable behaviour only. No source code was read to *grade* the implementation; source was touched only operationally (to locate the route mount path and the JWT-secret resolution line so the running service could be exercised). Verdict rests on the running system's data substrate, runtime logs, and HTTP service responses.
**Environment probed:** dev checkout, branch `nova-codex`; NOVA main MSSQL pool (`bym-asqlep01` / database `NOVA`) via the app's own `NOVA_SQL_CONNECTION`; server booted from the working tree via `tsx watch`.

---

## Verdict: **FAIL**

P1-WP1 is **not converged** for its scoped Phase 1 foundation outcome. The clean-sheet KPI foundation is **not observably present or operational** in the running system. Its initialiser runs but produces **no schema, no seeded configuration, no snapshot scheduler, and no served introspection routes**, and surfaces **no error** while doing so — i.e. it fails silently rather than within a declared, bounded gap.

The single redeeming observation is that the failure is correctly **isolated from the legacy KPI system**, which remains fully intact. So the "do not regress legacy" constraint holds — but only because the new substrate effectively does nothing.

---

## How this was tested

1. Confirmed no NOVA HTTP server was running, then **booted the server twice** from the working tree (the second boot with a known `JWT_SECRET` passed as an environment variable — no file/code change — so an authenticated evaluator token could be minted).
2. Connected directly to the **NOVA main MSSQL pool** (the pool the foundation is documented to target and where the `jira_issue_cache` cache-path lives) and inventoried tables, row counts, and `create_date`.
3. Scanned the **full server startup logs** (stdout + stderr) for foundation init, seeding, scheduler registration, business-hours, and backfill activity.
4. Minted a valid JWT (id=1 `nickw`, admin) and issued **authenticated** requests to the foundation's documented mount (`/api/kpi/*`).
5. Verified legacy KPI data/services were untouched.

---

## Findings against the seven observable questions

### Q1 — Is there a new, separate `kpi_*` foundation present and queryable, without displacing legacy?
**NO (present in tree, not operational).** The foundation code physically exists but **uncommitted** in the working tree (`src/server/routes/kpi-engine.ts`, `src/server/services/kpi-engine/`, wired via a modified `src/server/index.ts`). `tsx watch` loaded it on boot. Result in the NOVA pool: **0 `kpi_*` tables**, **0 tables of any name created on either boot date (2026-05-30)**, and **0** tables matching space / metric / tier / binding / business-hour / backfill concepts. The cache path it is meant to read — `jira_issue_cache` — **is** present and live (2107 rows, actively growing via jira auto-sync), confirming the correct database was probed. The foundation simply never provisioned itself.

### Q2 — Are the expected spaces, metric definitions, space bindings, and NT tier definitions observable?
**NO.** No configuration tables exist; no seeding occurred (startup logs contain no seed/space/metric/tier activity); nothing is queryable at the data or service layer.

### Q3 — Does the business-hours engine produce correct observable outcomes via exposed execution paths?
**NO / NOT EXERCISABLE.** No business-hours tables, no init, and no reachable execution path produced any output. There is nothing observable to validate boundary behaviour against.

### Q4 — Can the new computation path produce snapshot data for implemented metrics from the NOVA-side cache?
**NO.** No snapshot tables, no computed rows, no execution observed. The NOVA-side cache is present and healthy but is **not being consumed** by any foundation computer.

### Q5 — Does the snapshot execution path run on demand or on schedule without colliding with legacy?
**NO.** The in-code design documents a **"3-min snapshot job"**, but **no such job was registered** at boot. The only schedulers that registered were the unrelated `ProblemTicketScanner` (15 min) and `jira` auto-sync (5 min). No collision occurs — because nothing runs.

### Q6 — Do the delivered backfill paths behave correctly for the included legacy sources?
**NO / NOT EXERCISABLE.** No backfill execution, no backfilled rows, no backfill tables, no backfill log activity.

### Q7 — Are residual gaps honestly bounded rather than hidden as silent failures?
**NO — this is the central failure.** The brief's "Known Non-Blocking Inputs" describe a world where the foundation **exists and is queryable** but some data legitimately reads empty (NTPJ zero story points, STBY empty cache, a sync cycle pending, some metrics intentionally uncomputed, partial backfill). The **observed** state is materially worse: the foundation is **entirely absent from the running system** — no schema, no config, no scheduler — and its initialiser completes **without throwing and without logging anything**. The graceful `try/catch` around init (`[kpi-engine] foundation init failed (legacy KPI unaffected)`) **did not fire** (its message is absent from stderr), so this is not even a caught-and-reported failure — it is a silent no-op. The gap is therefore **hidden, not bounded.**

---

## Material blocker

**The foundation initialiser silently produces nothing.** On a full boot from the working tree against the correct (connected, operational) NOVA pool:
- it creates **no `kpi_*` schema** (the documented deliverable);
- it seeds **no** spaces/metrics/tiers/bindings;
- it registers **no** snapshot job;
- the documented introspection routes at `/api/kpi/*` return **HTTP 404** under a **valid authenticated token** (confirmed not a 401 auth artifact); and
- **no success and no failure** is logged — the isolation `catch` never fired, so the absence is invisible to an operator reading logs.

This blocks every scoped Phase 1 outcome (schema operability, seeded config, business-hours validation, computation, scheduling, backfill). It is not a data-emptiness condition; it is a structural non-initialisation.

---

## Bounded / non-blocking observations (in the evaluator's favour where due)

- **Legacy KPI system is intact (no regression).** `sales_lg_kpi` = 166 rows (unchanged), `jira_issue_cache` = 2107 rows (live, growing via auto-sync), legacy pipeline files and routes untouched, no tables altered or dropped. The "must not displace legacy" constraint is satisfied.
- **Failure is correctly isolated.** The foundation is wrapped so that its non-initialisation cannot harm the legacy surface. The design intent (parallel, isolated substrate) is sound even though the slice is non-functional.
- **Work is genuinely in-progress, not abandoned.** The `kpi-engine` route + service tree exists and is wired into bootstrap; this reads as an incomplete WP rather than a missing one.
- **The legacy "KPI SQL Server: missing credentials" message is a red herring** for this verdict: that warning concerns the *legacy* `techservicesjsm` pipeline pool. The clean-sheet foundation is documented (and scoped by the brief) to target the **NOVA main pool**, which was connected and fully operational during the test — so absent KPI-pool credentials are **not** the cause of the empty foundation.

---

## Evaluation limitations (stated for honesty)

- **Authenticated introspection routes were probed at inferred paths** (`/api/kpi/spaces`, `/api/kpi/metrics`, `/api/kpi/tiers`, etc.); all returned 404 under a valid token. It is possible the router exposes different sub-paths. **This does not affect the verdict**, which rests on the path-independent data-layer fact that init created **no schema** and registered **no scheduler** in the correct, connected pool.
- The JWT signing secret is randomly regenerated per boot when unset, so external authentication required relaunching the server with a known secret (operational test setup only; no application logic or config file was modified, and the server was returned to its prior stopped state afterwards).
- Internal init source was deliberately **not** read to diagnose the root cause, per the evaluator mandate; the report characterises the **observable** outcome (silent non-completion), not the internal mechanism.

---

## Convergence statement

**P1-WP1 is NOT converged.** No scoped Phase 1 foundation outcome is observably met: no operable `kpi_*` schema, no seeded space/metric/tier configuration, no business-hours observability, no computation output, no snapshot scheduling, no backfill behaviour. The one passing dimension (legacy coexistence / no regression) passes trivially because the new substrate makes no observable changes at all.

**Recommended gate to re-evaluate:** the foundation initialiser must, on boot against the NOVA pool, (a) create the `kpi_*` schema, (b) seed the scoped spaces/metrics/tiers/bindings, (c) register the snapshot job, and (d) log a clear success **or** a clear, surfaced failure — so that any residual data-emptiness becomes a genuinely *bounded, declared* gap rather than a silent absence. Until then this slice is a fail.
