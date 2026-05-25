# Property / Listing Issues — Iteration 3 Independent Eval Report

**Domain:** Property / Listing Issues (Workstream 1 — Top 6 Conversational Intake)
**Evaluator:** Eval Agent
**Date:** 2026-05-19
**Iteration:** 3 (Blocker Fix)

---

## Overall Verdict: CONVERGED

**51/52 checks passed (98.1%)**

The single failure is a new eval-only holdout not present in the Build Agent's test suite — not a regression. All Build Agent claims independently verified.

---

## Section Results

| Section | Pass/Total | Status |
|---------|-----------|--------|
| Frustration Detection Coverage | 15/16 | PASS (1 non-blocking gap) |
| Operational Detail Preservation | 8/8 | PASS |
| Property vs Website Routing | 10/10 | PASS |
| Hidden Taxonomy Protection | 3/3 | PASS |
| No Category Picker on Property | 4/4 | PASS |
| No Conversational Resets | 4/4 | PASS |
| Website Design / Content Regression | 4/4 | PASS |
| Edge Cases & Adversarial | 3/3 | PASS |

---

## Blocker Status: NONE

All Iteration 3 blockers resolved:

1. **Frustration regex too narrow** — FIXED. Adverb-separated intensifiers ("absolutely/completely/totally/utterly/so furious"), sarcasm ("wow, great service"), and passive frustration ("does anyone even check") all detected. 15/16 holdouts pass including 6 new eval-only cases not in the Build Agent's script.

2. **Empathy discards operational detail** — FIXED. `extractPropertyFieldsFromText()` and `detectPropertyFromKeywords()` now execute inside the frustration override block before empathy return. Verified: address, portals, description, and category all preserved when frustration fires on property messages.

---

## Non-Blocking Improvements

### NB-1: Frustration pattern gap — "been [wrong/incorrect/broken variant] for [time]"

The regex `been (broken|waiting|like this|an issue|a problem) for (days|weeks|...)` doesn't cover "been wrong for weeks" or "been incorrect for days". Adding `wrong|incorrect|missing` to the first alternation group would close this gap.

**Impact:** Low. The phrase still hits other patterns if the user escalates in tone. Only affects mild-frustration temporal expressions.

### NB-2: Category picker includes "property" entry

`CATEGORY_NAMES` has both `listings: 'Property Listings'` and `property: 'Property Listings'` (line 111). Both appear in `buildCategoryQuestion()` output. However, this is non-blocking because:
- Property paths are detected and routed conversationally — they never reach the category picker
- The picker only fires for unrecognised non-property, non-website requests
- No test showed a property request falling through to the picker

### NB-3: Anti-bot trust concern

Per governance, treated as possible non-blocking conversational optimisation. No evidence of intake failure from anti-bot phrasing in this evaluation.

---

## Regression Status: CLEAN

| Protected Behaviour | Status |
|---------------------|--------|
| Website content updates route to website | PASS |
| Website design changes route to website | PASS |
| Website broken pages route to website | PASS |
| New page requests route to website | PASS |
| Property requests never trigger category picker | PASS |
| Property requests never leak internal taxonomy | PASS |
| Multi-turn property flow maintains category | PASS |
| Frustration with attachment sets attachment flag | PASS |
| Property-vs-website ordering (property checked first) | PASS |

---

## Implementation Quality Notes

- Frustration override block (line 486–512) cleanly extracts operational detail before returning empathy response. Good separation of concerns.
- `buildEmpathyAcknowledgement()` (line 1619–1633) produces contextual responses referencing address/portals when available, generic empathy when not.
- LLM path (line 756–803) and non-LLM fallback (line 821–869) both correctly route property requests without category picker.
- Property detection ordering (property before website in non-LLM path, line 827) prevents "our website" in property messages from misrouting.

---

## Recommendation

**PROMOTE to Converged + Regression Protected.**

All critical behaviours pass. The one failure is a new holdout on a minor frustration pattern variant — it's a future optimisation, not a convergence blocker. Website regression protection is clean across all 4 subcategories.

Multi-property modelling remains out of scope per governance and should not block convergence.
