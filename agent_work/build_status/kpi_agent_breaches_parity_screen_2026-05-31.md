# Build Status — KPI Agent Breaches Parity Screen (KPX-WP8)

**Date:** 2026-05-31
**Work package:** `KPX-WP8` — Agent Breaches parity-surface delivery
**Agent:** Build Agent (Claude Code)
**Basis:** `agent_work/spec/kpi_agent_breaches_parity_build_brief.md` + the converged clean-sheet KPI platform (Phase 3 views) and the KPX-WP3–WP7 replacement-parity substrate.
**Status:** Complete — ready for independent evaluation
**Scope discipline:** Agent Breaches parity only. One new read model, one new GET route, one new lazy view + nav tab. No engine / source-provider / EOD / schema / seed / binding / catalogue changes, no holdout consumption, no forbidden tables, no fabricated rows, no legacy KPI changes, no raw KPI data grid/export, no Board MI, no wallboard replacement.

---

## 1. What Agent Breaches parity surface was delivered

A new clean-sheet **Agent Breaches** surface ships in the **KPI Platform** area, reached at **KPI Platform → Agent Breaches** (a new tab inserted between *Agent Scorecard* and *Manual Entry*, `view: 'kpic-agent-breaches'`).

Where the legacy Agent-Breaches board (`KpiBreachedView`, `/api/kpi-data/agents`) listed **live per-agent ticket health** — open tickets, open over-2h, not-updated-today, oldest-ticket days, solved-today — the clean-sheet surface re-frames the same intent ("which agents are failing a standard?") around the metrics the clean-sheet platform actually freezes per agent. It is **breach-oriented**, not a ranking (that is the Agent Scorecard's job) and not a general analytics grid.

For each space that carries a breach-evaluable agent metric it renders, for the latest frozen date that has agent rows:

- **Summary chips** — agents breaching, agents at-risk, agents clear, agents assessed.
- **A per-agent breach matrix** — one row per agent, a derived **status** (`Breach` / `At risk` / `Clear` / `No data`), and one RAG-coloured cell per breach-evaluable metric showing the agent's frozen value against that metric's target. Breaching agents sort to the top (most breaches first), then at-risk, then clear.
- **A "breaching only" filter** so a manager can collapse to just the agents failing a target.
- **An explicit "Not supported by the clean-sheet agent path" table** listing the legacy live-queue breach families the clean-sheet agent path cannot honestly produce, each with the reason it is withheld.

### How a "breach" is defined (honest, data-driven)

A metric is **breach-evaluable** only when the clean-sheet platform can judge an agent against a standard: it is **agent-level**, has a **registered computer** (so it can carry a real per-agent value), carries a **target**, and has a **RAG-able direction** (`higher`/`lower`). For each such metric the existing `computeRag` logic decides the per-agent state:

- **red → breach** (failing the target beyond the amber band),
- **amber → at-risk** (within the amber band),
- **green → met**.

An agent's overall status is `breach` if any metric is red, else `at_risk` if any is amber, else `clear` if any is green, else `no_data`. Nothing without a computer/target/direction is ever shown as a breach, and a missing per-agent value renders **"—"**, never a fabricated pass/fail.

---

## 2. Clean-sheet source / data path used

The surface uses the **clean-sheet read path only**, identical in mechanism to the Agent Scorecard:

- **New read model:** `KpiViewsService.getAgentBreaches(date?)` in `src/server/services/kpi-engine/kpi-views.ts`.
  - Reads the frozen **`kpi_agent_daily`** rows (NOVA main pool) for the **most recent frozen date that has agent rows** for the breach-evaluable metrics (≤ an optional `?date=YYYY-MM-DD`). This is the exact same store and resolution the Agent Scorecard/leaderboard uses.
  - Per-agent RAG is computed with the platform's existing `KpiEodService.computeRag(value, target, amberBand, direction)` — no new RAG logic.
  - Breach-evaluable filtering reuses the existing `hasComputer()` registry check plus the binding's `target_value` / `direction` — so the set of judged metrics tracks the seed automatically.
- **New route:** `GET /api/kpi/agent-breaches` in `src/server/routes/kpi-engine.ts` → `views.getAgentBreaches(date)`, standard `{ ok, data }` / `{ ok, error }` envelope, optional `?date=YYYY-MM-DD` validated against `^\d{4}-\d{2}-\d{2}$`.
- **Client:** `src/client/components/KpiCleanAgentBreachesView.tsx` *(new)* fetches `/api/kpi/agent-breaches` only.

It reads **only** the clean-sheet `kpi_*` tables. It does **not** query the legacy KPI pipeline pool, the legacy Agent-Breaches data path (`/api/kpi-data/agents`), the `techservicesjsm` tables, `escalation_log`, or any forbidden table. No evaluator holdouts are consumed. The per-agent values were computed and frozen upstream by the existing engine + EOD path; this slice is a pure read surface over the clean-sheet store.

### Files changed
- `src/server/services/kpi-engine/kpi-views.ts` — added `AgentBreachStatus`, `AgentBreachMetricDef`, `AgentBreachCell`, `AgentBreachRow`, `UnsupportedBreachFamily`, `AgentBreachesSpace`, `AgentBreachesSummary` types; the static `UNSUPPORTED_BREACH_FAMILIES` list; and `getAgentBreaches()`. No change to existing methods.
- `src/server/routes/kpi-engine.ts` — added `GET /agent-breaches` (reuses the already-injected `views` dep; no new wiring in `index.ts`).
- `src/client/components/KpiCleanAgentBreachesView.tsx` *(new)* — the Agent Breaches parity view.
- `src/client/App.tsx` — added `'kpic-agent-breaches'` to the view union, lazy import, the *Agent Breaches* tab under KPI Platform, the render branch, and the `FULL_WIDTH_VIEWS` entry.

No schema, seed, catalogue, binding, engine, source-provider, EOD, or legacy KPI changes. No existing API response shape changed.

---

## 3. Which breach families are supported vs honestly unsupported

Breach coverage is **data-driven, not metric-name-hardcoded**: any agent-level metric the clean-sheet engine computes + EOD-freezes into `kpi_agent_daily` with a target and a RAG-able direction becomes breach-evaluable. Given the converged seed, the supported set is:

**Currently supported (judged for a breach wherever frozen per-agent rows exist):**
- **`frt_compliance`** — First Response SLA % (target 90, higher-is-better) → breach when an agent's FRT attainment is RAG-red.
- **`resolution_compliance`** — Resolution SLA % (target 90, higher-is-better) → breach when resolution attainment is RAG-red.
- **`csat_score`** — CSAT (target 4, higher-is-better) → breach when an agent's CSAT is RAG-red.
- **`resolved_today`** — Tickets Resolved Today (target 15, higher-is-better) → judged as an under-throughput breach where frozen per-agent rows exist.
- **`escalation_accuracy`** (NT only, target 90, higher-is-better) — breach-evaluable **only once** the rejection/bounce-back capture path has produced frozen per-agent accuracy rows (it has a computer and a target); until then it simply has no agent rows to judge and is silently absent rather than shown as a false pass.

These are exactly the agent-level metrics that have **both** a registered computer **and** a target in the seed — the only metrics on which the clean-sheet platform can honestly assert an agent has breached.

**Honestly unsupported — the legacy live-queue breach families (surfaced, never fabricated):**
The legacy Agent-Breaches board's headline columns are per-agent **live queue counts** the clean-sheet agent path does not capture. They are returned in `unsupportedFamilies` and rendered in the "Not supported by the clean-sheet agent path" table:
- **Open tickets over SLA (per agent)** — the clean-sheet per-agent freeze stores SLA *attainment %* (frt/resolution compliance), not a per-agent count of currently-open over-SLA tickets. The EOD ticket-state snapshot (`kpi_eod_snapshot`) holds over-SLA counts grouped by **tier/status/request-type, not by agent**.
- **Tickets not updated today (per agent)** — no clean-sheet per-agent stale/no-update metric is computed or frozen.
- **Oldest open ticket age (per agent)** — `oldest_actionable_hrs` is captured at **space level only**, not per agent.

**Excluded from breach evaluation by design (not a defect):**
- Agent-level metrics with a computer but **no target** (`frt_avg_minutes`, `resolution_avg_minutes`) — without a target there is no honest breach threshold, so they are not asserted as breaches.
- Agent-level metrics with **no computer** (`escalation_rate`, `rejection_rate`, `qa_score_avg`, `golden_rules_avg`, `reopen_rate`) — they can never carry a real per-agent value in this build, so they are not judged (consistent with the KPX-WP1 gap report's 6-computer agent coverage).

This split is computed honestly per request, so as the platform wires more agent-level computers/targets or freezes more days, metrics migrate into the supported matrix automatically — no code change.

---

## 4. What remains bounded or environment-dependent

- **Populated rows are EOD/data dependent.** A space's matrix populates only once **≥1 EOD freeze** has landed `kpi_agent_daily` rows for its breach-evaluable metrics, which in turn requires `jira_issue_cache` ticket rows for that project. On an environment with no agent-daily history yet (e.g. local dev with no cached tickets, or a freshly-seeded instance), the space correctly shows its honest **"… no per-agent values have been captured yet"** note rather than an empty grid of fabricated passes. This is the expected data-presence gap (consistent with the KPX-WP1 qualified-pass conditions), not a surface defect — the matrix fills the moment a freeze lands.
- **Latest-frozen-date semantics.** The surface shows the most recent frozen date with agent rows (optionally ≤ `?date=`), matching the Agent Scorecard. It is a point-in-time breach view, not a multi-day breach history (that would widen toward the Trends/reporting rebuild that is out of scope).
- **Jira-computed spaces only.** Manual / non-Jira teams have no agent-level computed metrics, so they naturally carry no breach-evaluable metric and are omitted — honest, not a gap.
- **The three legacy live-queue families stay unsupported until/unless a per-agent live-queue source is wired** (a separate, larger source-data work item explicitly outside this slice). They are surfaced transparently rather than silently dropped.
- **Out of scope (unchanged, honest):** legacy `KpiBreachedView` / SLA Breach wallboard (untouched, still served by the legacy path), raw KPI data grid/export, Board MI, broad KPI redesign. None touched.

---

## 5. Whether the slice is ready for independent evaluation

**Yes — ready for independent behavioural evaluation.** The Agent Breaches parity surface is delivered, wired to the clean-sheet `kpi_agent_daily` path only, presents per-agent breach-oriented output for the agent-level metrics the platform can honestly judge, handles unsupported breach families and missing agent history honestly (explicit awaiting-data notes and an unsupported-families table, **no fabricated rows**), and is isolated from the legacy KPI / Agent-Breaches system.

### Build verification performed
- `tsc -p tsconfig.server.json --noEmit` — **clean (0 errors)**.
- `tsc -p tsconfig.json --noEmit` — **0 errors in any file touched here** (`kpi-views.ts`, `kpi-engine.ts` route, `KpiCleanAgentBreachesView.tsx`, `App.tsx`); the only reported error is the **single pre-existing** one in untouched `kpi-pipeline.ts:1043`, identical to the KPX-WP7 checkpoint.

### Behavioural check points (running software only)
- `GET /api/kpi/agent-breaches` → `{ generatedAt, unsupportedFamilies:[3 families], spaces:[…] }`; each space has `metricDefs` (breach-evaluable agent metrics + targets), `agents` (each with `status`, `breachCount`, `atRiskCount`, and per-metric `cells` carrying `value`+`rag`), `summary` counts, and `reportDate`.
- A space wired-but-without-frozen-agent-rows → `hasData:false` with an honest awaiting-capture note and empty `agents`.
- `GET /api/kpi/agent-breaches?date=YYYY-MM-DD` → resolves the latest frozen date ≤ that date; malformed dates are ignored (falls back to latest).
- UI: **KPI Platform → Agent Breaches** renders the summary chips, the RAG per-agent breach matrix (breaching agents first), the "breaching only" filter, and the "Not supported by the clean-sheet agent path" table; the legacy SLA Breach board is unchanged.

The one bounded caveat for the evaluator: if the eval environment lacks frozen `kpi_agent_daily` rows for a space's breach-evaluable metrics, that space will **correctly** show its awaiting-capture note rather than a populated matrix — the expected environment/history gap, not a defect.

No evaluator holdouts, scoring logic, or hidden scenarios were read or consumed in producing this slice.
