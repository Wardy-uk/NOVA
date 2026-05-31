# Evaluation — KPI Escalations Parity Screen

**WP:** KPX-WP6
**Date:** 2026-05-31
**Evaluator:** Eval Agent (behavioural, clean-sheet KPI path)
**Method:** Live API observation against the running server (`http://localhost:3001`),
read-only admin token minted from the established eval secret. No source code inspected.
Raw captures retained: `agent_work/eval_output/_wp6_esc.json` (full parity payload),
`_wp6_endpoints.json` (status matrix), `_wp6_isolation.json` (legacy-namespace probe),
`_wp6_results.txt`.

> Reliability note: this environment's stdout/file-read channel produced intermittently
> garbled output mid-run. Every claim below was re-confirmed from **three** consistent
> sources (probe stdout, a structural JSON-parse script, and the persisted
> `_wp6_esc.json`). Findings rest only on the reproducible, cross-checked state.

---

## Verdict: **QUALIFIED PASS**

The Escalations parity surface exists, loads cleanly from the clean-sheet KPI path with the
correct three-metric scope, is isolated from the legacy KPI system, regresses nothing on
the clean-sheet side, and — most importantly for this programme — handles the
**absent-data case with complete honesty**: every escalation-family metric reports `null`
with an explicit awaiting note, never a fabricated 100% / 0%.

The qualification is a **coverage gap, not a defect**: in this environment **no escalation
source rows are captured**, so the *populated* paths — real `escalation_rate` when
`escalation_log` has rows, the 7-day history, the per-agent breakdown, and accuracy /
rejection flipping from awaiting to real — **could not be observed**. They fail safe to
honest nulls, but their correct-when-populated behaviour is unverified.

---

## Observed payload (the verified ground truth)

`GET /api/kpi/escalations-parity` → `200`, `{ ok: true }`. Body:

```
data.generatedAt        = "2026-05-31T13:34:23Z"
data.escalationMetricKeys = ["escalation_rate","escalation_accuracy","rejection_rate"]   // exactly 3
data.spaces             = [ NT ]   // one card
  NT.isJiraSpace = true   NT.hasData = false
  NT.note = "Escalation metrics are wired for this space but no escalation-family values
             have been captured yet (awaiting escalation_log rows; rejection-dependent
             accuracy/rejection-rate await a captured bounce-back)."
  NT.metrics = [
     escalation_rate     value=null target=null rag=null unwired=false history=[]
     escalation_accuracy value=null target=90   rag=null unwired=false history=[]
     rejection_rate      value=null target=null rag=null unwired=false history=[]
  ]
  NT.agentReportDate = null   NT.agents = []
```

---

## Key questions

### Q1 — Surface exists and loads from the clean-sheet path only — **PASS**
Returns `200 / ok:true` with the proper clean-sheet structure, in the `/api/kpi/*`
namespace alongside the working `/api/kpi/slt` (200, 8 cards), `/api/kpi/team/NT` (200),
and `/api/kpi/qa-parity` (200). Scope is exactly the three escalation-family keys — no
duplication, no extraneous metrics.

### Q2 — Real values where escalation source rows exist — **UNVERIFIED (no source rows in this environment)**
The three metrics are flagged `unwired: false` (i.e. genuinely wired, not stub), but every
value is `null` and every `history` is empty because no escalation rows have been captured
here (`hasData: false`). The "real value when rows exist" behaviour therefore **cannot be
exercised** in this environment. This is not a failure — it fails safe to honest nulls —
but it is the central capability that remains undemonstrated.

### Q3 — Honest null/awaiting when rejection capture rows are absent — **PASS**
All three metrics report `value: null`, `rag: null` — **no fabricated 100% accurate / 0%
rejected**. `escalation_accuracy` and `rejection_rate` specifically sit at null rather than
asserting a perfect score from absent data. The card carries `hasData: false` and an honest
`note` that names both dependencies (escalation_log rows; a captured bounce-back).
Histories are `[]` rather than padded with zeros. This is the honesty-critical behaviour
the programme exists to guarantee, and it is observably correct and clean.

### Q4 — Per-agent breakdown from clean-sheet daily agent data — **UNVERIFIED (honest empty state observed)**
The card exposes `agents` and `agentReportDate`, both honestly empty/null with no captured
agent rows. The breakdown structure is present and degrades honestly, but with zero agent
data there is nothing to confirm it reads from clean-sheet `kpi_agent_daily` versus any
other path. Positive-path behaviour is unverified.

### Q5 — Isolation from the legacy KPI system — **PASS**
The surface is reachable only at the clean-sheet `/api/kpi/escalations-parity`.
- `/api/kpi-data/escalations-parity` → `404` (`Cannot GET`) — the legacy namespace does
  **not** serve it.
- `/api/kpi/escalations` → `404` — no stray alias.
No cross-namespace leakage.

### Q6 — No regression to clean-sheet or legacy behaviour — **PASS (with an environment note)**
- Clean-sheet siblings all healthy: `/api/kpi/slt` (8 cards), `/api/kpi/team/NT`,
  `/api/kpi/qa-parity` — all `200 / ok:true`.
- Legacy KPI pipeline endpoints return `500 "KPI SQL Server not configured"`
  (`/api/kpi-data/agents`, `/api/kpi-data/daily-history`) and `404`
  (`/api/kpi-data/leaderboard`). These reflect the legacy `techservicesjsm` pool being
  **unconfigured in this environment** — a pre-existing condition independent of KPX-WP6,
  not a regression introduced by this slice. Nothing observed indicates WP6 altered legacy
  behaviour.

---

## Material blocker
None. The surface is functional, correctly scoped, honest under absent data, and isolated.

## Bounded non-blocking gap
The **populated-data behaviour is unverified** in this environment because no
`escalation_log` rows (and no bounce-back/rejection rows) exist. Specifically undemonstrated:
real `escalation_rate` value + RAG, the 7-day history series, the per-agent breakdown
sourcing, and accuracy/rejection transitioning from `awaiting` to real numbers.

## Next best step: **a bounded verification pass before checkpointing the parity claim**
The honest-empty-state slice is solid and could be checkpointed *as that* — but for an
evidence-integrity programme, "honest when empty" is necessary, not sufficient; the point
is correct numbers when data exists. Recommend one short pass that seeds a minimal,
disposable fixture into the escalation source (at least one `escalation_log` row for the NT
space, plus one rejection/bounce-back row), then re-runs this same probe to confirm:
1. `escalation_rate` surfaces a real value with target/RAG and a populated 7-day history;
2. the per-agent breakdown populates from clean-sheet agent-daily data;
3. `escalation_accuracy` / `rejection_rate` flip from `awaiting_capture` to real values
   without ever passing through a fabricated 100%/0%.

If those hold, checkpoint the parity slice. Until then, checkpoint only the honest-empty
behaviour and keep the populated path flagged as unverified.
