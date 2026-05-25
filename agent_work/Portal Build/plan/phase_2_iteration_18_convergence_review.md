# Phase 2 Iteration 18 Convergence Review

**Date:** 2026-05-23  
**Author:** Orchestrator / Manager Agent  
**Status:** Converged for this slice

## Decision

Phase 2 Iteration 18 is **converged for its intended slice**.

The primary objective of this loop was to eliminate the portal/channel clarification loop and restore summary reachability for the journeys that were getting trapped there. The evaluation evidence supports that this objective has been met.

## What Is Now Considered Converged

The following behaviours should now be treated as materially converged within Phase 2 unless future evidence contradicts them:

- conversational activation on free-text intake
- hidden routing without visible category-picker regression
- natural clarification tone
- stable non-looping failure handling when submission is unavailable
- property-question narrowing for clearly non-property and explicitly site-wide journeys
- natural summary-stage confirmation recognition
- preserved summary review in system-offer flows
- bundled URL capture
- URL capture on first mention and no repeated URL re-asking
- vague follow-up verification
- portal/channel clarification no longer looping
- website-context inference from known website URLs
- summary reachability for the portal/channel-clarification slice
- description synthesis consistency when summary is reached in most tested paths

## What Remains Outside This Converged Slice

The evaluation also surfaced residual issues that do not overturn convergence of the portal/channel slice itself:

- phone-number fragments can still leak into listing/reference fields
- account names can still be dropped or inconsistently captured in some summaries
- one scenario still produced a raw concatenated description instead of a synthesized one
- ticket creation remains unavailable in the current dev environment due to downstream integration/configuration
- one scenario showed summary being presented before all useful information had been absorbed

These are real issues, but they are now separate from the portal/channel clarification loop that defined Iteration 18.

## Why This Changes The Next Loop

The next loop should not reopen:

- portal/channel clarification behaviour
- website inference from URLs
- URL re-asking

Those areas moved materially and should stay closed unless a new regression appears.

The next loop should now narrow to extraction accuracy and summary quality:

- preventing phone numbers from contaminating listing/reference fields
- improving consistent account capture in summaries
- tightening summary-readiness so late details are not missed
- ensuring description synthesis fires reliably in all comparable paths

## Next Loop Shape

The next loop should stay narrow and focus on:

- listing/reference versus phone-number separation
- account capture reliability
- summary-readiness / late-detail absorption before confirmation
- remaining synthesis inconsistency in the paths still producing raw concatenation
