# Manager Log — 2026-05-24 Follow-Up Iteration 3 Eval Decision

## Decision

Reopened / follow-up ticket continuity remains:

- NOT CONVERGED

One final narrow build slice is required.

## Why This Stays Narrow

The evaluator isolated one true remaining blocker:

- `still not fixed` plus ticket reference is still intercepted by frustration handling before follow-up routing can fire

Two additional continuity issues remain tightly coupled to the same customer outcome:

- the extracted ticket key is not flowing into `followUpTicketKey`
- the portal redundantly asks for a ticket reference the customer already supplied

These should be fixed in one pass because they all directly affect whether the portal behaves like a confident continuation path with reduced repetition.

## Confirmed Blocker

1. **Frustration preempts follow-up routing**

- the phrase `still not fixed` is a canonical real-world follow-up signal
- it is already represented in chase-pattern logic, but frustration handling still intercepts first
- this is now the only convergence blocker

## Coupled Continuity Fixes

1. **Direct follow-up key propagation**

- even when Jira hydration is absent or the cache misses, the extracted ticket key should populate `followUpTicketKey`
- this allows the summary card to show `Related ticket` instead of `Listing ref`

2. **Suppress redundant ticket-ref prompt**

- if the customer already supplied a valid ticket reference, the portal should not ask for it again

## Deferred Non-Blocking Items

- full Jira summary/status hydration where cache data is absent
- mixed-intent priority conflicts when strong domain detail overwhelms follow-up intent
- pure status-check behaviour without chase language
- Jira link-type refinement
- minor account parsing artefact

## Next Step

Create and activate a final hardening build brief limited to:

- moving follow-up/chase handling ahead of frustration interception for relevant messages
- populating `followUpTicketKey` directly from the extracted reference
- suppressing redundant ticket-reference prompts when the key is already known
