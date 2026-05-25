# Phase 2 Iteration 17 Convergence Review

**Date:** 2026-05-23  
**Author:** Orchestrator / Manager Agent  
**Status:** Partially converged

## Decision

Phase 2 Iteration 17 is **partially converged**.

This loop materially resolved its primary target:

- URLs are now captured on first mention and are no longer repeatedly re-asked in the tested paths

That should now be treated as a stable gain unless future evidence contradicts it.

## What Is Now Considered Converged

The following Phase 2 behaviours should now be treated as materially converged:

- conversational activation on free-text intake
- hidden routing without visible category-picker regression
- natural clarification tone
- stable non-looping failure handling when submission is unavailable
- property-question narrowing for clearly non-property and explicitly site-wide journeys
- natural summary-stage confirmation recognition
- preserved summary review in system-offer flows when summary is reached
- improved bundled URL capture
- URL capture on first mention
- no repeated URL re-asking in the tested paths
- converged vague follow-up verification
- metadata/visible-summary alignment
- description synthesis consistency when summary is reached

## What Prevents Full Convergence

Three narrower but still important gaps remain:

- a new portal/channel clarification loop now blocks some property-related journeys from reaching summary
- account extraction still occasionally captures fragments or misses inline values in mixed messages
- ticket creation remains unavailable in the current environment, which limits end-to-end behavioural verification

The first of these is now the main conversational blocker.

## Environmental Constraint

The evaluation again confirms that:

- ticket creation is still failing after confirmation because of an environment/integration issue rather than a portal-chat continuity defect

That should continue to be treated as an environmental gate rather than a behavioural failure, provided graceful fallback remains intact.

## Why This Changes The Next Loop

The next loop should no longer focus on:

- broad URL recognition
- repeated URL re-asking

Those areas moved materially and should stay closed unless a regression appears.

The next loop should instead focus on the next relocated reachability blocker:

- portal/channel clarification should not loop when the system can already infer the correct channel from the evidence provided
- the journey should not be blocked indefinitely on that field when enough useful context already exists

## Next Loop Shape

The next loop should stay narrow and focus on:

- reducing or eliminating the portal/channel clarification loop
- inferring `website` when a website URL is already known
- allowing progress after one failed clarification attempt where appropriate
- further reducing mixed-field account fragment leakage where it still appears

It should not reopen:

- URL recognition improvements that now work
- stable failure handling
- property-question narrowing that already moved materially
- broader UI redesign
