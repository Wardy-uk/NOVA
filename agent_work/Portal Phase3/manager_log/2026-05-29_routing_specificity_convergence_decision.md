# Manager Decision — Routing Specificity Closure

**Date:** 2026-05-29  
**Domain:** Portal routing specificity  
**Decision:** CONVERGED

## Summary

Iteration 43 is behaviourally converged.

Independent evaluation returned:

- `54` fresh sessions
- `23` pass
- `2` borderline
- `0` fail
- all four blocker families closed
- regression guards passed
- runtime freshness confirmed

## What Closed

- property count mismatch no longer falls into generic website-content framing
- property wrong-status phrasing is stable across natural variants
- CRM / API / leads / database integration requests no longer over-capture into email marketing
- URL-less named-page amendments no longer fall to `other_general`
- domain preservation, response assembly, blank-input protection, and fresh-session state all remained stable

## Non-Blocking Carry-Forward

Two specificity observations remain logged for future tuning:

1. `LeadPro` brand-only data-flow language can still fall to `other_general`
2. `leads syncing from the website` can still route as `website_content`

These are not blockers for this slice because the explicit blocker criterion was to stay out of email marketing, and both cases satisfy that.

## Manager Position

- record Iteration 43 as `Converged Pending Protection`
- do not reopen this iteration
- carry the two specificity observations forward as future tuning candidates
- continue regression protection around email-marketing over-capture, property follow-up, domain preservation, and fresh-session state

