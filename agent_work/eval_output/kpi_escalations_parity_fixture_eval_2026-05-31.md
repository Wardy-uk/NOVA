# Evaluation — KPI Escalations Parity Populated-Path Proof Fixture

**WP:** KPX-WP6A
**Date:** 2026-05-31
**Evaluator:** Eval Agent (behavioural; clean-sheet KPI path only)
**Method:** Live API observation against the running server (`http://localhost:3001`).
Short-lived admin token minted via the established KPX eval-family auth path (jwt_secret
read from NOVA runtime DB settings, with `.env` fallback — runtime config, **not** application
source). No source code, diffs, or build-status notes were inspected.
Raw captures retained:
`agent_work/eval_output/_wp6a_results.json` (full ordered run),
`_wp6a_metrics.json` (precise per-metric space values at each stage),
`_wp6a_baseline.json` (pre-seed honest-empty payload).

---

## Verdict: **PASS**

The disposable Escalations fixture path proves the populated clean-sheet Escalations parity
behaviour end to end and leaves the environment clean after teardown. Every populated-path
capability flagged "unverified" in the prior WP6 screen eval is now observably demonstrated
through the clean-sheet surface, and — critically for this evidence-integrity programme —
the awaiting-to-populated transition is honest: no fabricated 100% / 0% appears at any stage.

---

## Control surface (discovered behaviourally)

A single clean-sheet endpoint drives the fixture, action-dispatched by request body:

| Call | Effect |
| --- | --- |
| `GET  /api/kpi/fixtures/escalations` | status (present, counts, row tallies) |
| `POST /api/kpi/fixtures/escalations {"action":"seed"}` | create disposable fixture space + seed escalation source |
| `POST /api/kpi/fixtures/escalations {"action":"add-rejection"}` | add a captured rejection / bounce-back |
| `POST /api/kpi/fixtures/escalations {"action":"teardown"}` | remove the fixture, restore clean state |

Fixture space is namespaced and self-labelling: `spaceKey = "__ESCFX"`,
`jiraProject = "ZZESCFX"`, `displayName = "Escalations Parity Fixture (disposable)"`,
`ownerName = "KPX-WP6A"`. Starting state was `present:false` (clean) before any action.

---

## Observed behaviour (the verified ground truth)

### Seeded, no rejection yet — `escalation_rate` populated; accuracy/rejection honestly awaiting
Fixture status after seed: `tickets:5, escalations:2, rejections:0, rejectionPresent:false,
dailyRows:7, agentDailyRows:14, historyDays:7`. On `GET /api/kpi/escalations-parity`, the
`__ESCFX` card (`hasData:true`):

| metric | value | target | rag | history |
| --- | --- | --- | --- | --- |
| `escalation_rate` | **40** (= 2/5) | null | null | **7 days** [40×7] |
| `escalation_accuracy` | **null** (awaiting) | 90 | null | [] |
| `rejection_rate` | **null** (awaiting) | null | null | [] |

Per-agent: 2 fixture agents, `agentReportDate:2026-05-31`, each carrying **only**
`escalation_rate` (A 33.3, B 50) — no fabricated accuracy/rejection.

### After `add-rejection` — accuracy/rejection transition to real values
Fixture status: `rejections:1, rejectionPresent:true, dailyRows:21, agentDailyRows:42`.
`__ESCFX` card:

| metric | value | target | rag | history |
| --- | --- | --- | --- | --- |
| `escalation_rate` | 40 | null | null | 7 days [40×7] |
| `escalation_accuracy` | **50** | 90 | **red** | 7 days [50×7] |
| `rejection_rate` | **20** (= 1/5) | null | null | 7 days [20×7] |

Per-agent now carries the full triad: A `{rate 33.3, accuracy 0, rejection 33.3}`,
B `{rate 50, accuracy 100, rejection 0}`. Values differ per agent and the space-level
accuracy lands on a **red** RAG against its 90 target — i.e. genuinely computed, imperfect
values, not hardcoded constants.

### Teardown — clean restoration
`teardown` returned `removed:true` with all-zero status; `GET status` confirmed
`present:false`. `GET /api/kpi/escalations-parity` returned to a single `NT` card in the
honest-empty state (`escalation_rate/accuracy/rejection_rate` all `null`, awaiting note
restored). `GET /api/kpi/spaces` and `/api/kpi/slt` returned to real-spaces-only — `__ESCFX`
fully absent. No residue.

---

## Key questions

1. **Seed via the provided control surface — PASS.** `POST {"action":"seed"}` creates the
   disposable space and seeds the source through the clean-sheet path.
2. **`escalation_rate` real populated value, not null/awaiting — PASS.** Surfaces **40**
   (2/5), with a 7-day history, rather than null.
3. **`escalation_accuracy` / `rejection_rate` honestly awaiting before rejection capture — PASS.**
   Both sit at `null` with empty histories after seed — **no fabricated 100% accurate / 0%
   rejected**. Per-agent rows likewise omit them until a rejection exists.
4. **Transition to real values after rejection capture — PASS.** Accuracy flips null → **50
   (red vs 90 target)**, rejection_rate flips null → **20**, both gaining 7-day histories,
   without ever passing through a fabricated 100%/0%.
5. **7-day history and per-agent populate from the clean-sheet path — PASS.** All three
   metrics carry 7-day series once populated; per-agent breakdown populates with 2 fixture
   agents and a report date, served on the clean-sheet `/api/kpi/escalations-parity` surface.
6. **Teardown removes the fixture cleanly and restores honest empty — PASS.** `removed:true`,
   all tallies zero, parity surface and spaces lists return to real-only / honest-null.
7. **Isolation from real spaces and the legacy KPI system — PASS (with a bounded note).**
   Real spaces' data is untouched throughout (NT stays `hasData:false` at every stage); the
   fixture is a separate, `__`-prefixed, clearly-disposable space that vanishes on teardown.
   Legacy namespace does **not** serve it: `GET /api/kpi-data/escalations-parity` → `404`.
   Bounded note below.

---

## Material blocker
**None.** The populated path is fully exercisable and honest; teardown is clean.

## Bounded non-blocking gaps
- **Fixture visible on shared clean-sheet boards while seeded.** During the seeded window the
  `__ESCFX` space appears in `/api/kpi/spaces` and the `/api/kpi/slt` board alongside real
  spaces (clearly labelled "disposable", owner "KPX-WP6A"). This is by design — it must
  surface on the clean-sheet path to prove parity — and is fully removed on teardown, so it
  is not a data-integrity risk. Worth noting only because, until teardown, a shared board
  shows the proof space. Not a blocker.
- **History series is flat/synthetic.** The 7-day histories are constant (40/50/20 across all
  7 days). This proves *population* of the history and per-agent surfaces from the clean-sheet
  path; it does not exercise day-to-day variation or RAG transitions over time. Acceptable for
  a populated-path proof; out of scope for this slice.

## Readiness for checkpointing
**Ready.** The Escalations parity slice now has its populated path independently verified:
real `escalation_rate`, honest awaiting→real transition for accuracy/rejection (no fabricated
100%/0%), 7-day history, per-agent breakdown, clean teardown, and isolation from real-space
data and the legacy KPI system. The prior WP6 "honest-when-empty" behaviour is preserved when
the fixture is absent. The Escalations parity slice can be checkpointed. The environment was
left clean (fixture torn down, `present:false`) at the end of this evaluation.
