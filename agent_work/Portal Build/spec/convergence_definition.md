# Convergence Definition

DO NOT SHARE THIS FILE WITH THE BUILD AGENT.

## Phase

- Name: Phase 1 portal customer-facing status flow

## Minimum Acceptable Behaviour

- Portal ticket list and ticket detail surfaces show customer-facing statuses instead of raw internal Jira statuses.
- The curated status names are used consistently.
- Known mapped Jira statuses resolve to the intended customer-facing labels.
- Unknown statuses fail safely to a customer-friendly default.
- In normal tested cases, customers can understand the broad state of their ticket without support jargon.

## Unacceptable Behaviour

- Raw Jira statuses remain visible in customer-facing portal views.
- Different portal surfaces show conflicting status translations for the same ticket.
- Unknown statuses appear as blank, broken, or raw internal values.
- The translated statuses materially mislead customers about whether work is active, blocked, resolved, or complete.

## Known Tolerances

- The first slice does not need perfect graphical polish as long as the customer-facing meaning is clear.
- The exact visual treatment can remain modest if the behavioural status translation is correct.
- Internal Jira data structures may remain unchanged as long as the portal presentation is correct.

## Still Fails Evaluation If

- Even one common customer-facing path still leaks raw internal Jira status text.
- History or detail views contradict the list view.
- Branch states such as waiting on customer or waiting on third party are flattened so much that the customer loses important context.
- Support would still need to explain portal status wording manually because it remains confusing.

## Pass / Fail Decision Shape

- Pass: The portal status journey is understandable to a normal customer without internal support knowledge, while preserving internal Jira workflow.
- Fail: The portal still exposes support-team jargon, breaks consistency across surfaces, or leaves customers unable to understand the broad state of their ticket.
