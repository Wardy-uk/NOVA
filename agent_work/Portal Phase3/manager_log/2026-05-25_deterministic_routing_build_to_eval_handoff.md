# Manager Log — 2026-05-25 Deterministic Routing Build To Eval Handoff

## Lifecycle Transition

- Domain: Deterministic routing hardening
- Prior state: Building
- New state: Evaluating

## Build Outcome Summary

Build status indicates the deterministic-routing slice is ready for evaluation.

Reported outcome:

- subcategory-aware project routing now checks subcategory before parent category
- `email_template` now routes to the intended project instead of falling through to parent defaults
- a new `letters` category with three subcategories has been added end-to-end
- deterministic keyword detection for template and letters requests is wired into both LLM and no-LLM conversational paths
- all known subcategories now have explicit routing-table entries

Build status reference:

- `agent_work/Portal Phase3/build_status/iteration-8-deterministic-routing.md`

## Manager Interpretation

The build appears to address the intended routing gaps without widening into structural config consolidation.

Evaluator focus should now be:

- does `email_template` route deterministically as intended
- do letters/correspondence requests enter the new deterministic category path
- do repeated phrasing variants stay consistent
- do protected complaint/follow-up/website/property behaviours remain stable

## Next Step

- evaluator to test deterministic routing through the running software only
