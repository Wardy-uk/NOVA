# Programme Tracker — Portal Conversational Intake

Authoritative orchestration state. Updated per tracker_update_contract.md.

STATUS: AUTHORITATIVE ORCHESTRATION STATE

Purpose:
This file is the canonical live orchestration tracker for the NOVA Attractor Programme.

It records:
- active convergence cycles
- lifecycle state
- protected domains
- blockers/non-blockers
- convergence history
- evaluator outcomes
- active programme focus

This tracker must be updated incrementally according to:

spec/orchestration/tracker_update_contract.md

This file is operational state, not passive documentation.

## Protected Domains

| Domain | Protected Since | Archive Ref |
|--------|----------------|-------------|
| Website Design / Content Changes | 2026-05-19 | workstream1_phase1_hardening_complete.md |
| Property / Listing Issues | 2026-05-19 | property_listing_issues_iteration3_complete.md |

---

## Active Convergence Cycles

| Domain | Current State | Status | Notes |
|--------|---------------|--------|-------|
| *(none active)* | | | |

---

## Domain: Website Design / Content Changes

### Lifecycle

- [x] Iteration 1 — initial conversational intake build
- [x] Iteration 2 — follow-up quality, taxonomy hiding
- [x] Iteration 3 — confidence threshold, fallback chain
- [x] Phase 1 hardening — wording, attachment awareness, uncertainty removal
- [x] Regression evaluation — CONVERGED
- [x] Regression protection granted

### Notes

Category picker fully removed for website requests. Conversational intake with LLM classification (≥0.7 confidence). Fallback to category picker on low confidence or LLM failure. Hidden taxonomy, no jargon, no uncertainty hedging. Attachment awareness defers upload to summary stage.

---

## Domain: Property / Listing Issues

### Lifecycle

- [x] Iteration 1 — property intent detection (LLM + keyword), conversational follow-up, field extraction, taxonomy protection
- [x] Iteration 1 evaluation — 2026-05-19
- [x] Iteration 2 — frustration regex expansion, template-path acknowledgements, property-vs-website detection ordering fix
- [x] Iteration 2 build complete — 2026-05-19
- [x] Iteration 2 regression evaluation — 2026-05-19, NOT CONVERGED
- [x] Property-vs-website detection gap — CLOSED (8/8 scenarios pass)
- [x] Regression revalidation — CLEAN (7/7 revalidation scenarios pass, zero regressions)
- [x] Iteration 3 blocker fix — COMPLETE (2026-05-19, 22/22 eval, 100%)
- [x] Independent evaluation — 51/52 (98.1%), all critical objectives verified
- [x] Convergence evaluation — CONVERGED
- [x] Regression protection granted — 2026-05-19

### Iteration 2 Evaluation Results (2026-05-19)

| Section | Result |
|---------|--------|
| GAP-1 Frustration robustness | 4/7 |
| GAP-2 Acknowledgement quality | 4/6 |
| GAP-3 Property vs website detection | 8/8 |
| Revalidation | 7/7 |
| **Overall** | **92.7% checks, 82.1% scenarios** |

Verdict: NOT CONVERGED — no critical architectural blockers.

### Confirmed Convergence Blockers (Iteration 3)

1. **Frustration regex too narrow** — adverb-separated patterns ("absolutely furious") and sarcastic frustration miss detection. Regex gap at portal-chat.ts:61.
2. **Empathy response discards operational detail** — when frustration fires, property ref/address/portal from the same message not carried into collectedFields.

### Independent Evaluation Results (2026-05-19)

| Metric | Result |
|--------|--------|
| Checks passing | 51/52 (98.1%) |
| Critical behavioural objectives | All verified |
| Structural blockers | None |
| Website Design regression | Clean |
| Hidden taxonomy protection | Verified |
| Conversational routing protection | Verified |
| Category-picker regression | None |
| Conversational reset regression | None |

**Verdict: CONVERGED + REGRESSION PROTECTED**

### Frozen Regression Baseline

Holdout suite frozen as of 2026-05-19. Baseline files:
- `agent_work/eval_output/property_iter3_eval.mjs`
- `agent_work/eval_output/property_iter3_eval_report.md`
- `agent_work/build_status/property_listing_issues_iteration3_complete.md`
- `agent_work/spec/holdouts/property_listing_holdouts.md`

### Confirmed Non-Blocking Improvements

- Multi-property reports collapse to single property (structural — future enhancement)
- Account name from follow-up turns not always extracted (low-risk optional fix in Iteration 3)

### Future Enhancement Backlog

- **Lexical frustration variant**: "This listing has been wrong for weeks now" — classified as NON-BLOCKING POLISH GAP. Does not break routing, empathy, detail preservation, or taxonomy protection. Lexical variant only.

### Protected Behaviours (verified 2026-05-19)

- No category picker for property requests
- Hidden taxonomy — no internal category names leak
- No technical jargon leakage
- Property-vs-website detection ordering correct
- Website Design regression protection clean
- Conversational continuity across multi-turn
- Operational detail preservation (single-property)
- Attachment awareness with upload guidance

---

## Changelog

| Date | Update | Sections Modified |
|------|--------|-------------------|
| 2026-05-19 | Initial tracker creation with full history | All |
| 2026-05-19 | Iteration 2 eval complete, Iteration 3 blocker fix started | Property lifecycle, Active Cycles, Eval Results, Blockers |
| 2026-05-19 | Iteration 3 blocker fix complete — frustration regex broadened, empathy detail preservation fixed. 22/22 eval (100%) | Property lifecycle, Active Cycles |
| 2026-05-19 | Property / Listing Issues promoted to CONVERGED + REGRESSION PROTECTED. Independent eval 51/52 (98.1%). Holdout suite frozen. Remaining lexical variant recorded as polish backlog. | Protected Domains, Active Cycles, Property lifecycle, Eval Results |
