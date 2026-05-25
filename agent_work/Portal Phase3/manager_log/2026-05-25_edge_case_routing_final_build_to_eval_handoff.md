# Manager Log — 2026-05-25 Edge-Case Routing Final Build To Eval Handoff

## Lifecycle Transition

- Domain: Edge-case routing sensitivity hardening
- Prior state: Hardening
- New state: Evaluating

## Build Outcome Summary

Build status indicates the final edge-case routing hardening slice is ready for evaluation.

Reported outcome:

- deterministic follow-up routing now runs before LLM domain routing for ticket-reference plus chase-language messages
- letters precedence now has an explicit website-word guard
- property detection now exits early for bare `property` inside explicit website-content context

Build status reference:

- `agent_work/Portal Phase3/build_status/iteration-10-edge-case-routing-hardening.md`

## Manager Interpretation

The build appears to address the exact three local defects identified by evaluation without widening scope.

Evaluator focus should now be:

- do representative `NT-XXXXX is not fixed` cases all route to follow-up
- do website-primary requests stop being stolen by letters
- does `property images on my website` remain website
- do protected complaint, follow-up, letters, website, and property controls remain stable

## Next Step

- evaluator to test final edge-case routing hardening through the running software only
