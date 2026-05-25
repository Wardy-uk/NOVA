# Phase 2 Iteration 21 Convergence Review

**Date:** 2026-05-24  
**Author:** Orchestrator / Manager Agent  
**Status:** Partially converged

## Decision

Phase 2 Iteration 21 is **partially converged**.

This loop materially closed most of the remaining structured-field fidelity gap:

- account-field reliability is now stable in the tested journeys
- correction propagation into structured fields is now working
- phone-number contamination of listing/reference fields is now materially resolved

Those gains should now be treated as stable unless future evidence contradicts them.

## What Is Now Considered Converged

The following Phase 2 behaviours should now be treated as materially converged:

- conversational activation on free-text intake
- hidden routing without visible category-picker regression
- natural clarification tone
- stable non-looping failure handling when submission is unavailable
- property-question narrowing for clearly non-property and explicitly site-wide journeys
- natural summary-stage confirmation recognition
- preserved summary review in system-offer flows
- bundled URL capture and URL-first recognition
- converged portal/channel clarification recovery
- materially improved user-facing synthesized summary quality
- account-field reliability in the tested structured-field paths
- correction propagation into structured fields for corrected details
- phone-number protection in listing/reference structured fields
- earlier conversational continuity gains remaining materially intact

## What Prevents Full Convergence

One structured-field fidelity issue still remains:

- multi-segment alphanumeric listing/reference IDs are still truncated in the structured `listingId` field even when the full reference is present in the description

Examples observed in evaluation:

- `RM-45821-A` becomes `RM-45821`
- `ABC-12345-XZ` becomes `ABC-12345`

This is now the main remaining blocker inside the current slice because the downstream structured field still loses part of the customer’s actual reference.

## Why This Changes The Next Loop

The next loop should not reopen:

- account extraction recovery
- correction propagation that is already working
- phone-number contamination fixes that are now holding
- broader conversational continuity or summary-quality work

The next loop should instead focus on:

- preserving full multi-segment alphanumeric references in the structured `listingId` field
- ensuring the structured reference matches the already-correct full reference preserved in the description
- keeping the recently-converged structured-field gains intact

## Next Loop Shape

The next loop should stay extremely narrow and focus on:

- multi-segment listing/reference preservation
- structured-field and description alignment for references
- no regression in account reliability, correction propagation, or phone-number separation
