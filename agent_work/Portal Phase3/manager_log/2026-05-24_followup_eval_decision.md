# Manager Log — 2026-05-24 Follow-Up Eval Decision

## Decision

Reopened / follow-up ticket continuity is:

- NOT CONVERGED

One more small build slice is required.

## Why This Is Still A Small Slice

The evaluator findings are tightly bounded and operationally coherent:

1. the most common real-world follow-up phrasings do not trigger the intended path
2. referenced-ticket Jira context is not actually hydrated at runtime
3. the ticket reference is stored in the wrong metadata field, which breaks the customer-facing summary and weakens continuity

These should be treated as one hardening slice because they all affect the same behavioural promise: recognised follow-up continuity with reduced repetition.

## Confirmed Blockers

1. **Primary phrasing gap**

- `"still not fixed"` plus ticket reference falls into frustration handling instead of follow-up continuity
- `"marked resolved but it is not"` plus ticket reference falls to `other_general`

2. **No actual Jira context hydration**

- the runtime does not show Jira-provided ticket summary or status
- `followUpTicketKey` and `followUpTicketSummary` are not populated in observed behaviour

## Coupled Hardening Fix

The ticket reference being stored as `listingId` instead of follow-up metadata should be fixed in the same slice.

Reason:

- it directly compromises the customer-visible summary
- it undermines the intended continuity model
- it is closely coupled to the Jira-context preservation gap

## Non-Blocking Items Deferred

- category-priority conflict when strong new operational detail is mixed into the follow-up message
- Jira link-type selection refinement
- pure status-check handling without chase language

## Next Step

Create and activate a hardening build brief limited to:

- trigger coverage for the two primary follow-up phrasings
- actual Jira context hydration for recognised ticket references
- correct follow-up metadata storage and summary display
