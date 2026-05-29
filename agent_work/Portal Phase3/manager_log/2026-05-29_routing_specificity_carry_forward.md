# 2026-05-29 — Routing Specificity Carry-Forward

The following observations are carried forward after Iteration 43 convergence.

## Future Tuning Candidates

1. Brand-only `LeadPro` data-flow phrasing can still fall to `other_general`.
2. `leads syncing from the website` phrasing can still route as `website_content`.

## Governance Position

These are not blockers for Iteration 43 convergence because:

- both cases stayed out of email marketing
- no regression guard failed
- all stated blocker families passed

Treat these as candidates for a future specificity slice only if they recur in broader replay or live usage.
