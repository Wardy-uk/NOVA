# Evaluation — KPI Agent Breaches (Clean-Sheet)

**WP:** KPX-WP8
**Date:** 2026-05-31
**Evaluator:** Eval Agent (behavioural, clean-sheet KPI path)
**Method:** Live API observation against the running server (`http://localhost:3001`).
Read-only admin token minted via the established KPX eval-family path (JWT secret read from
the NOVA runtime DB `settings` table — `src=db-settings`, secretLen 64 — not from app source).
Token proven against three known-good clean-sheet reads (`/api/kpi/slt`, `/api/kpi/spaces`,
`/api/kpi/qa-parity` → all `200/ok:true`) before any conclusion was drawn. No application
source, build notes, or diffs inspected. Raw captures retained:
`agent_work/eval_output/_wp8_results.json` (full payload, 20-endpoint discovery sweep,
8 query variants, isolation + regression matrices) and `_wp8_summary.txt`.

> Environment note: this session's stdout/file-read channel delivered output in delayed bulk
> flushes. Every finding below rests on the persisted `_wp8_results.json`, re-confirmed via a
> separate structural summariser (`_wp8_summary.txt`). Nothing here is asserted from a single
> unverified read.

---

## Verdict: **QUALIFIED PASS**

The clean-sheet Agent Breaches surface exists at exactly one clean-sheet endpoint, is
isolated from the legacy KPI system, regresses nothing on the clean-sheet side, and — the
point of this programme — is **honest on every axis that could be observed**: supported
breach-evaluable metrics are exposed with breach thresholds; unsupported legacy breach
families are **explicitly enumerated with reasons rather than fabricated**; and spaces with no
captured agent-level frozen rows report **zero breaches with an explicit not-captured flag**,
never invented breaches.

The qualification is a **coverage gap, not a defect**: in this environment **no per-agent
frozen rows are captured** (`hasData:false`, `agents:[]` for every space), so the *populated*
breach path — actual per-agent values flagged breaching / at-risk / clear, `breachesByMetric`
populated, RAG/threshold logic firing — **could not be exercised**. It fails safe to an honest
empty state, but its correct-when-populated behaviour remains unverified.

A second, smaller bounded observation: the `space` / `period` / `date` query parameters have
**no observable effect** (every variant returns the identical full space set). This is honest
(no fabrication) but means the surface is a fixed multi-space snapshot, not a filtered query.

---

## Observed ground truth

`GET /api/kpi/agent-breaches` → `200 / {ok:true}`. Body shape:

```
data.generatedAt        = "2026-05-31T17:24:08Z"
data.unsupportedFamilies = [ 3 entries ]   // explicitly NOT rendered as breach rows
   open_over_sla_per_agent  — "Clean-sheet per-agent capture freezes SLA attainment %
                               (frt/resolution_compliance), not a per-agent count of
                               currently-open over-SLA tickets…"
   not_updated_per_agent    — "No clean-sheet per-agent stale-ticket metric is computed
                               or frozen — there is no honest per-agent value to render."
   oldest_ticket_per_agent  — "oldest_actionable_hrs is captured at space level only,
                               not per agent…"
data.spaces             = [ NT, NTPJ, STBY, YO ]   // isJiraSpace:true agent spaces only
  each space:
    metricDefs = breach-evaluable supported metrics with thresholds:
       frt_compliance (target 90, dir higher, amber 10)
       resolution_compliance (target 90, higher, amber 10)
       resolved_today (target 15, higher, amber 10)
       csat_score (target 4, higher, amber 10)
       [NT also: escalation_accuracy (target 90, higher, amber 10)]
    hasData    = false
    note       = "Breach-evaluable agent metrics are wired for this space but no per-agent
                  values have been captured yet (populated at EOD freeze where agents have
                  agent-level rows)."
    reportDate = null
    agents     = []
    summary    = { agentsBreaching:0, agentsAtRisk:0, agentsClear:0, breachesByMetric:{} }
```

---

## Key questions

### Q1 — Surface exists and loads from the clean-sheet KPI path only — **PASS**
`/api/kpi/agent-breaches` returns `200/ok:true` with the structured clean-sheet payload.
A 20-path discovery sweep confirms it is served at this single clean-sheet endpoint and
nowhere else: every alternative — `/api/kpi/agent-breaches-parity`, `/api/kpi/breaches`,
`/api/kpi/breach-parity`, `/api/kpi-engine/agent-breaches`, `/api/kpi-engine/breaches`,
and 14 others — returns `404`. No legacy or `kpi-engine` alias exposes it.

### Q2 — Supported breach families render from frozen agent-level clean-sheet data (not legacy/live-queue) — **PASS (structure/wiring) / populated values UNVERIFIED**
Each space exposes `metricDefs` for the supported frozen agent metrics interpreted in breach
terms — `frt_compliance`, `resolution_compliance`, `resolved_today`, `csat_score` (NT also
`escalation_accuracy`) — each carrying `target`, `direction`, and `amberBand`, i.e. the
threshold scaffolding for breach / at-risk / clear classification. The `note` states values
are "populated at EOD freeze where agents have agent-level rows" — i.e. the frozen agent-level
clean-sheet path, not a live queue. The breach-summary scaffolding (`agentsBreaching`,
`agentsAtRisk`, `agentsClear`, `breachesByMetric`) is present and correctly shaped.
**Unverified:** because `hasData:false` / `agents:[]` in this environment, no actual per-agent
value was rendered or classified, so the populated breach interpretation could not be observed.
It fails safe to honest empty.

### Q3 — Unsupported legacy breach families surfaced honestly, not fabricated — **PASS (strong)**
The three legacy per-agent breach families that cannot be derived from clean-sheet frozen
data are surfaced in a dedicated `unsupportedFamilies` array, each with a precise, honest
`reason` (over-SLA counts are frozen by tier/status/request-type not by agent; no per-agent
stale-ticket metric exists; oldest-ticket age is space-level only). Critically, **none of
them appears in any space's `metricDefs` or as a breach row** — they are segregated and
labelled unsupported rather than fabricated as clean-sheet breaches. This is exactly the
evidence-integrity behaviour the programme exists to guarantee.

### Q4 — Spaces with missing/absent agent-level frozen rows behave honestly — **PASS (strong)**
All four spaces report `hasData:false`, `agents:[]`, `reportDate:null`, and a summary of
`{agentsBreaching:0, agentsAtRisk:0, agentsClear:0, breachesByMetric:{}}`. The absent state is
**explicitly flagged** (`hasData:false` + an honest `note` naming the EOD-freeze dependency),
so a consumer can distinguish "no snapshot captured" from "snapshot captured, zero breaches".
No absent space implies a false breach — `agentsBreaching` is `0`, not fabricated. A bogus
space (`?space=__ZZZNOTASPACE__`) does not invent a fake card, and non-agent spaces (SLT, CS)
are simply absent rather than faked. (Note: this explicit `hasData:false` marker is a cleaner
disambiguation than the WP6 escalations empty state, which lacked an equivalent flag.)

### Q5 — Isolation from the legacy KPI system, no regression — **PASS**
Isolation: legacy/parity probes do not serve agent-breaches — `/api/kpi-data/agent-breaches`,
`/api/kpi-data/breaches`, `/api/kpi-data/agent-breaches-parity`, `/api/kpi/breached` all
`404`. The legacy KPI pool is unconfigured here (`/api/kpi-data/agents` → `500 "KPI SQL Server
not configured"`), yet the agent-breaches surface returned a full `200` payload — proving it
does **not** depend on the legacy `techservicesjsm` pool. The `500` is a pre-existing
environment condition, not introduced by WP8.
Regression: all clean-sheet siblings healthy — `/api/kpi/slt`, `/api/kpi/qa-parity`,
`/api/kpi/escalations-parity`, `/api/kpi/team/NT`, `/api/kpi/spaces` all `200/ok:true`.

---

## Material blocker
None. The surface is functional, correctly scoped, honest under absent data and unsupported
families, and isolated from the legacy system.

## Bounded non-blocking gaps
1. **Populated breach path unverified.** No per-agent frozen rows exist in this environment
   (`hasData:false`, `agents:[]` everywhere), so the central capability — real per-agent
   values classified breaching / at-risk / clear, `breachesByMetric` populated, and the
   `target`/`amberBand`/`direction` thresholds actually firing — could not be exercised. It
   degrades safely to honest empty, but correct-when-populated behaviour is undemonstrated.
2. **Query parameters have no observable effect.** `?space=` (NT, SLT, CS, NTPJ,
   `__ZZZNOTASPACE__`), `?period=2026-05`, and `?date=2026-05-29` all return the identical
   full four-space set. Honest (no fabrication, no fake space), but the surface is a fixed
   multi-space snapshot rather than a filtered query — worth confirming this matches the
   intended UI contract.

## Next best step: **checkpoint this slice, then one bounded populated-data verification pass**
The honesty, isolation, and absent-state behaviour are solid and observably correct, and the
explicit `hasData:false` marker closes the disambiguation weakness seen in the WP6 empty
state — so **this honest-structure / isolation slice is safe to checkpoint as-is**.

However, for an evidence-integrity programme "honest when empty" is necessary, not sufficient;
the point is correct breach flags when data exists. Before the Agent Breaches *parity* claim
is considered fully closed, recommend one short pass that seeds a minimal, disposable
agent-level frozen fixture (e.g. one agent clearly breaching `frt_compliance`, one at-risk
within the amber band, one clear) for at least the NT space, then re-runs this probe to
confirm:
1. `summary.agentsBreaching / agentsAtRisk / agentsClear` and `breachesByMetric` populate
   correctly from frozen agent rows;
2. the `target` / `amberBand` / `direction` thresholds classify breach vs at-risk vs clear
   correctly (no off-by-band errors);
3. no unsupported family ever leaks into a populated breach row.
Optionally, confirm whether the `space`/`period`/`date` params are intended to filter.

If those hold, the breach-parity slice can be checkpointed in full. Until then, checkpoint the
honest-structure/isolation slice and keep the populated breach path flagged as unverified.
