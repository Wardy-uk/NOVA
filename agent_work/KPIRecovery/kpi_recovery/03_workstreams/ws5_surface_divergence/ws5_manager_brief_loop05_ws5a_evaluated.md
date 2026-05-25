# WS5 Manager Brief — Loop 05: WS5-A Evaluated Promotion

**Date:** 2026-05-20  
**Loop type:** Post-evaluation governance  
**Prior loop:** WS5 Loop 04 (WS5-A source defined)  
**Status:** WS5-A PROMOTED TO EVALUATED

---

## 1. Evaluation Verdict Review

Independent evaluation report (`ws5a_eval_report_01.md`) assessed against programme promotion standard:

| Check | Evaluator Result | Evidence Quality | Blocking? |
|-------|-----------------|-----------------|-----------|
| EV-1: Development visibility | **PASS** | High — independent live query confirms before/after (e.g. Heidi Power 12→38) | N/A |
| EV-2: OldestTicketKey population | **PASS** | High — 14/14 populated, 2/2 correctly null, monotonic key-to-age consistency across full agent set | N/A |
| EV-3: WORST OLDEST convergence | **PASS** | High — 76d→198d, near-exact match with dashboard ~198d (adjusted for elapsed time) | N/A |
| EV-4: Residual risk (logging gap) | **NON-BLOCKING** | High — infrastructure gap, not behavioural defect. 14/16 match rate confirms population correctness | N/A |
| EV-5: Scope discipline | **CONFIRMED** | TICKETS OVER SLA parity remains WS5-B | N/A |
| WS1 regression spot-check | **NO REGRESSION** | Ghost suppression, FRT, Resolution SLA, Development count all stable | N/A |

**Evaluator overall verdict: PASS** (not QUALIFIED PASS).

The evaluator explicitly noted: "The RV-3 logging gap is an infrastructure issue affecting all NOVA logging, not a WS5-A behavioural defect. All three WS5-A behavioural objectives are demonstrably met with strong evidence. A qualification would imply a residual concern about WS5-A behaviour itself — there is none."

---

## 2. Promotion Decision

### D-066: Promote WS5-A from SOURCE DEFINED to EVALUATED

**Decision:** WS5-A (population-path recovery) is promoted to **EVALUATED**.

**Rationale:**

All three promotion criteria from the programme standard are satisfied:

| # | Criterion | Evidence | Met? |
|---|-----------|----------|------|
| 1 | Evaluator verdict is PASS or QUALIFIED PASS | **PASS** (clean, unqualified) | **YES** |
| 2 | Core population-path behaviour independently validated | EV-1, EV-2, EV-3 all PASS on independently-gathered live production data | **YES** |
| 3 | No blocking issue remains within WS5-A scope | RV-3 logging gap classified NON-BLOCKING (D-064, reconfirmed by evaluator EV-4) | **YES** |

**Evidence independence confirmed:** The evaluator queried `/api/public/wallboard/breached` and `/api/public/wallboard/team-kpis` independently — the live data was not copied from the Build Agent's verification report. This satisfies the programme's independent evaluation requirement.

### D-067: Logging residual remains NON-BLOCKING — no reclassification

The evaluator's EV-4 assessment independently confirms the D-064 classification:

1. The gap is infrastructure (NSSM stdout routing), not code correctness
2. Indirect evidence (14/16 agents with non-zero metrics) confirms AccountId matching works
3. The gap affects all NOVA logging equally — it is not WS5-A-specific
4. No silently-excluded agents are evident (2 agents with null keys have zero open tickets)

**No change to gap classification.** RV-3/NSSM log capture remains an independent operational item (NA-41).

---

## 3. Next Lifecycle Step for WS5-A

### D-068: WS5-A next step is REGRESSION PROTECTED

WS5-A advances along the trust lifecycle:

```
BUILD COMPLETE → SOURCE DEFINED → EVALUATED → REGRESSION PROTECTED → TRUSTED
                                  ^^^^^^^^^^
                                  (current state)
```

**Regression protection approach:**

The existing WS1 regression framework (`_eval_ws1_regression.mjs` v2, RC-001–RC-006) already covers WS1-scope metrics. WS5-A requires a bounded regression addendum:

| Check | What it verifies | Source |
|-------|-----------------|--------|
| RC-007 (new) | Development-tier agents present on breach board with non-zero OpenTickets_Total | `/api/public/wallboard/breached` |
| RC-008 (new) | OldestTicketKey populated for agents with open tickets | `/api/public/wallboard/breached` |
| RC-009 (new) | WORST OLDEST ≥ 150 days (bounded floor based on current Sebastian Broome = 198d) | `/api/public/wallboard/breached` |

**Baselines to freeze:**

| ID | Metric | Baseline Value | Source |
|----|--------|---------------|--------|
| BF-006 | Development-tier agents on breach board | ≥1 agent with TierCode containing Development tickets | Live eval 2026-05-20 |
| BF-007 | OldestTicketKey population rate | 14/14 active agents (100%) | Live eval 2026-05-20 |
| BF-008 | WORST OLDEST floor | 198 days (Sebastian Broome, NT-355) | Live eval 2026-05-20 |

**Promotion gate to REGRESSION PROTECTED (PG-6–PG-10):**

| # | Gate Condition |
|---|---------------|
| PG-6 | WS5-A baselines frozen (BF-006–BF-008) |
| PG-7 | Regression checks defined (RC-007–RC-009) |
| PG-8 | Regression check executable (script extension or new script) |
| PG-9 | ≥ 1 clean regression run including WS5-A checks |
| PG-10 | No new blocking gaps since evaluation |

**When to execute:** Regression protection can proceed in the next loop. The checks are straightforward endpoint queries against the same breach board endpoint already used in evaluation.

---

## 4. WS5-B Isolation

### WS5-B remains explicitly separate

WS5-B (SLA-definition alignment) is **unchanged** by this loop:
- Status: NEW SLICE, scoping deferred (D-062)
- Root cause: `customfield_10010` (completed cycles only) vs `customfield_14048` (completed+ongoing)
- Not blocked by WS5-A promotion
- Not unblocked by WS5-A promotion (independent root cause)
- Next action: NA-38 (scope WS5-B) — READY, independent of WS5-A regression protection

### WS5-A EVALUATED does NOT resolve G-009 or G-011 fully

G-009 and G-011 were split in D-059. WS5-A resolves the population-path component and this is now EVALUATED:
- G-009: breach board population fixed and evaluated, but TICKETS OVER SLA count divergence remains (WS5-B)
- G-011: WORST OLDEST convergence fixed and evaluated (76d→198d), but SLA-based oldest edge cases may differ (WS5-B)

---

## 5. Programme State Updates

| Item | Before | After |
|------|--------|-------|
| WS5-A state | SOURCE DEFINED (D-063) | **EVALUATED** (D-066) |
| G-009 WS5-A component | Source defined | **Evaluated — population-path independently verified** |
| G-011 WS5-A component | Source defined | **Evaluated — OldestTicketKey + WORST OLDEST independently verified** |
| RV-3 log gap | NON-BLOCKING (D-064) | Unchanged — reconfirmed by evaluator (D-067) |
| WS5-B | New slice, scoping deferred | Unchanged — NA-38 still READY |

---

## 6. Next Actions

| # | Action | Type | Owner | Status |
|---|--------|------|-------|--------|
| NA-38 | Scope WS5-B SLA-definition alignment slice | Programme | Manager Agent | **READY** |
| NA-39 | G-014 fix (independent of WS5-A/B) | Build | Build Agent | READY |
| NA-40 | ~~WS5-A independent evaluation~~ | ~~Evaluation~~ | ~~Evaluator Agent~~ | ✅ DONE — PASS (ws5a_eval_report_01.md) |
| NA-41 | Fix NSSM log capture (operational) | Infrastructure | Nick | OPTIONAL |
| NA-42 | WS5-A regression protection: freeze baselines BF-006–BF-008, define RC-007–RC-009, execute first regression run | Regression | Build Agent | **READY** — next lifecycle step (D-068) |

---

## 7. Completion Checklist

| Requirement | Status |
|-------------|--------|
| Promotion decision explicit | ✅ WS5-A promoted to EVALUATED (D-066) |
| Logging residual classification confirmed | ✅ NON-BLOCKING reconfirmed (D-067) |
| Next lifecycle step explicit | ✅ Regression protection (D-068, NA-42) |
| WS5-B explicitly separate | ✅ Unchanged, NA-38 still READY |
