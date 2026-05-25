# Phase 2 Iteration 17 Ready For Eval

**Date:** 2026-05-23  
**Author:** Orchestrator / Manager Agent  
**Status:** Build accepted for behavioural evaluation

## Decision

Phase 2 Iteration 17 is ready for evaluation.

The build completion note is present at:

- `agent_work/Portal Build/build_status/phase2-iter17-url-mixed-field-recovery.md`

## Scope Check

The reported changes remain tightly inside the intended Iteration 17 slice:

- broader URL recognition for bare domains and `www.` forms
- protection against phone-number contamination in listing/reference extraction
- stronger separation of URL and account boundaries in mixed messages
- cleanup of leaked URL fragments in account values

The build also reports preservation of:

- Phase 1 converged behaviour
- earlier Phase 2 conversational activation, hidden routing, natural clarification, stable failure handling, property-question narrowing, natural summary confirmation recognition, summary review in system-offer flows, bundled URL capture gains, vague verification, metadata/visible-summary alignment, and description synthesis consistency

## Evaluation Focus

The evaluation pass should stay tightly focused on whether summary reachability improves through better URL and mixed-field handling.

Primary questions:

- are URLs now captured reliably when provided as bare domains or `www.` forms?
- does repeated URL clarification reduce when the URL has already been provided?
- are account, URL, and listing/reference fields cleaner and less cross-contaminated?
- are phone numbers no longer misread as listing/reference IDs?
- do more journeys now reach summary?
- were any earlier conversational continuity gains lost?

## Eval Handoff

Use:

- `agent_work/Portal Build/manager_log/phase_2_iteration_17_eval_prompt.md`

The evaluator should assess behaviour through the running software only and should not rely on source-code knowledge, build-status notes, or previous build discussions.
