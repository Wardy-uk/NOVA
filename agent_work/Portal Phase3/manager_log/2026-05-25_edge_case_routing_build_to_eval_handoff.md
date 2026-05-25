# Manager Log — 2026-05-25 Edge-Case Routing Build To Eval Handoff

## Lifecycle Transition

- Domain: Edge-case routing sensitivity hardening
- Prior state: Building
- New state: Evaluating

## Build Outcome Summary

Build status indicates the edge-case routing slice is ready for evaluation.

Reported outcome:

- `detectLettersFromKeywords()` now runs before the website LLM gate for mixed letters+website messages
- `ESCALATION_CHASE_PATTERNS` now covers `is not fixed` style follow-up phrasing without requiring `still`

Build status reference:

- `agent_work/Portal Phase3/build_status/iteration-9-edge-case-routing.md`

## Manager Interpretation

The build appears to address the exact two deferred misses without widening scope.

Evaluator focus should now be:

- does letters precedence win when website detail is incidental
- does `NT-XXXXX is not fixed` reliably enter follow-up
- do protected complaint/follow-up/website/property behaviours remain stable

## Next Step

- evaluator to test edge-case routing hardening through the running software only
