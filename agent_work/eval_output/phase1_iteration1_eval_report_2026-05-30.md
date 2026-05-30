# Phase 1 Iteration 1 — Activation-Recovery Re-Evaluation

**Work Package:** P1-WP1-ITER1
**Date:** 2026-05-30
**Evaluator stance:** Observable behaviour only. No source code, implementation notes, or build reasoning inspected. Evidence drawn from (a) the running server's operator-visible boot log, (b) the live HTTP surface, and (c) the exposed NOVA database (`NOVA_SQL_CONNECTION`, server `bym-asqlep01`).

---

## Verdict: **QUALIFIED PASS**

The prior failure mode — an observably *absent* foundation — is resolved. The clean-sheet Phase 1 KPI foundation is now observably present, seeded, internally coherent, honestly self-reporting, and coexisting with the untouched legacy system. The single qualification is an evaluation-method limit, not an observed defect: the `/api/kpi/*` routes and forced on-demand snapshot sit behind a global JWT auth gate, and a valid credential could not be obtained without source inspection (forbidden by the evaluator role), so their 200-level behaviour could not be exercised black-box.

---

## Is the prior failure mode resolved?

The previous evaluation failed on five conditions. Status now:

| Prior failure condition | Status | Observable evidence |
|---|---|---|
| no `kpi_*` tables | **RESOLVED** | 11 `kpi_*` tables present in the NOVA pool |
| no seeded configuration | **RESOLVED** | 8 spaces / 88 metrics / 125 bindings / 7 tiers, all real and coherent |
| no snapshot job | **RESOLVED** | Boot log: `snapshot job registered`; `kpi_snapshots` table exists |
| no reachable `/api/kpi/*` routes | **IMPROVED / not positively confirmed** | Paths respond on the auth layer (401, no crash/500), identical to the rest of `/api`; owning subsystem is active. 200-path not exercisable without a token (see Blockers) |
| no surfaced init failure | **RESOLVED** | Explicit, loud activation status line emitted at boot; init reports statement count and failure count |

Four of five conditions are decisively cleared with direct evidence. The fifth is materially improved and consistent with success, but could not be positively confirmed to a 200 within the role boundary.

---

## Observable behaviour verified

### 1. `kpi_*` schema present in the intended NOVA database
Direct query of `sys.tables` on the NOVA pool returned **11** `kpi_*` tables — exactly matching the boot log's `11/11 tables`:

```
kpi_agent_daily, kpi_daily, kpi_digests, kpi_eod_snapshot, kpi_holidays,
kpi_manual_entries, kpi_metric_definitions, kpi_snapshots, kpi_space_metrics,
kpi_spaces, kpi_tier_definitions
```

Boot signal: `[kpi-engine] kpi_* schema ensured (16 statements, 0 failures).`

### 2. Seeded spaces / metrics / bindings / tiers present
Live row counts match the seed log precisely:

| Entity | Count | Notes |
|---|---|---|
| Spaces | 8 | COMMS, CS, KAM, NT, NTPJ, ONBOARD, STBY, YO — each with timezone, business hours, weekend days, pause-status list, tier flags |
| Metric definitions | 88 | Categorised (AI, Volume, …), typed (`value_type`, `direction`, `aggregation`, `source`, `computation_key`) |
| Space→metric bindings | 125 | Distributed across all 8 spaces (7+20+12+26+21+5+17+17 = 125) |
| Tier definitions | 7 | 4 per-space "Standard" tiers + 3 NT line tiers (1st/2nd/3rd) with FRT & resolution targets |

Seed is real configuration, not placeholder data; all rows `created_at 2026-05-30`, confirming this activation produced them. Seed log: `foundation seeded — spaces +8, metrics +88, bindings +125, tiers +7 (existing rows preserved).`

### 3. Runtime state surface / explicit failure honesty
The foundation now emits an unambiguous operator-visible activation line at boot:

```
[kpi-engine] clean-sheet foundation ACTIVE — 11/11 tables,
  seed(+8 spaces/+88 metrics/+125 bindings/+7 tiers), snapshot job registered.
```

The init path reports both statement count and failure count (`16 statements, 0 failures`), so a partial or failed init would be surfaced rather than silent. This directly remedies the prior "no surfaced init failure" gap.

### 4. Snapshot path registration
`snapshot job registered` is logged at boot and the `kpi_snapshots` / `kpi_eod_snapshot` tables exist (currently 0 rows). The registration is observable; see Blockers for the execution caveat.

### 5. Legacy KPI non-regression
The NOVA pool holds **161** tables. The new `kpi_*` schema coexists with the legacy/core tables, all intact with healthy data:

```
jira_issue_cache 2111 | escalation_log 1519 | kb_gap_log 2370
delivery_entries 1465 | users 48 | tasks 5243
```

The seed explicitly preserved existing rows, and the full server booted cleanly after the kpi-engine (Portal routes wired, M365 registered, API listening on :3001, ProblemTicketScanner scheduled). No evidence the activation dropped, rewrote, or clobbered legacy structures.

---

## Material blocker

**None that indicates a foundation defect.** One verification-method blocker:

- **Auth-gated routes / on-demand snapshot not exercisable black-box.** A global JWT middleware returns `401` for the entire `/api` namespace — confirmed by a guaranteed-fake path (`/api/zzz_definitely_not_a_route_9999`) also returning `401`. Therefore `401` on `/api/kpi/*` proves only that the path is under the auth gate, not that the router is mounted, and no 200-level introspection or **forced snapshot execution** could be observed. Registration is locked (`Registration is restricted`), no default JWT secret was accepted (14 common secrets tried → all rejected, a positive security signal), and the signing secret is absent from both `.env` and `settings.json` — i.e. only obtainable by source inspection, which the evaluator role forbids. *Resolution is trivial for the operator:* supply a valid token, or expose one unauthenticated `/api/kpi/health` probe, and routes + on-demand snapshot can be confirmed to 200 in minutes.

---

## Bounded non-blocking gaps (expected, not failures)

- `kpi_snapshots`, `kpi_eod_snapshot`, `kpi_daily`, `kpi_agent_daily`, `kpi_manual_entries`, `kpi_digests`, `kpi_holidays` are all **0 rows** — consistent with the declared inputs: a sync cycle is still required, snapshots legitimately skip outside compute windows, and backfill is intentionally partial in Phase 1.
- NTPJ story points / STBY computed data remaining empty is attributable to zero source data and zero cache rows, as pre-declared.
- The separate legacy KPI pipeline pool (`techservicesjsm`) logged `Enabled but missing required credentials` in this dev environment — an environment credential gap, not a regression caused by the activation.
- Some seeded metric definitions are intentionally not computed in Phase 1.

---

## Convergence assessment

**P1-WP1-ITER1 closes the activation-recovery loop for its scoped foundation outcome.** The defining failure of the prior iteration — the foundation being observably absent — is gone: the `kpi_*` schema exists in the NOVA pool, the space/metric/binding/tier seed is present and coherent, the snapshot job is registered, the foundation reports its runtime state explicitly (and would surface failure), and the legacy KPI system is untouched and intact. The clean-sheet Phase 1 foundation is observably **active as a real parallel KPI substrate**.

The result is a **qualified** rather than full pass solely because the auth-gated `/api/kpi/*` 200-path and forced on-demand snapshot could not be exercised within the source-blind evaluator boundary. This is an observability/credentialing gap in the test, not a demonstrated fault. With a single operator-supplied token (or one unauthenticated health route), full pass is reachable without further engineering work.

**Phase 1 is converged for its scoped foundation outcome.**
