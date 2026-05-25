# Evaluation Criteria

DO NOT SHARE THIS FILE WITH THE BUILD AGENT.

## Phase

- Name: Phase 1 portal customer-facing status flow
- User-facing area: Customer portal ticket list, ticket detail, and customer-visible status history

## Problem Statement

The customer portal currently passes raw internal Jira statuses to customers. This exposes internal process language, makes ticket progress harder to understand, and creates a poor customer-facing support journey.

## Expected Behaviour

### Functional Behaviour

- The portal does not show raw internal Jira status names to customers in normal ticket-list and ticket-detail views.
- The portal uses the curated customer-facing status model:
  - Submitted
  - Reviewed
  - In Progress
  - Awaiting Your Response
  - Awaiting Third Party
  - Resolved
  - Closed
- Jira statuses are translated consistently anywhere the customer sees ticket progress.
- Ticket history shown to customers uses customer-facing status language rather than raw internal Jira wording.
- Unmapped or unknown Jira statuses fall back to a safe customer-facing status rather than leaking raw internal terminology.

### UX Expectations

- Customers can understand the meaning of a status without prior support knowledge.
- Status wording is plain and customer-safe.
- Progress cues feel coherent across ticket list and ticket detail views.
- If a branch state is active, the customer can still understand that the ticket remains part of the broader support journey.

### Failure Handling

- Unknown or newly introduced Jira statuses must not create broken UI or empty status labels.
- A missing mapping must not surface raw internal status names by accident in standard portal views.
- If status history cannot be rendered fully, the customer should still see a stable current status rather than a broken state.

### Response Quality

- Each customer-facing status should accurately reflect the broad support state implied by the mapped internal Jira status.
- The portal should avoid overstating certainty. For example, it should not imply final completion when the underlying state is still effectively active.
- The customer-facing wording should reduce confusion rather than simply renaming statuses cosmetically.

### Timing / Performance

- Status translation should not materially slow portal ticket list or detail rendering.
- Status display should appear as part of the normal page load, without visible flicker between raw and translated states.

## Pass Expectations

- Portal ticket list and ticket detail surfaces show customer-facing statuses instead of raw internal Jira statuses.
- The curated status names are used consistently.
- Known mapped Jira statuses resolve to the intended customer-facing labels.
- Unknown statuses fail safely to a customer-friendly default.
- In normal tested cases, customers can understand the broad state of their ticket without support jargon.

## Fail Expectations

- Raw Jira statuses remain visible in customer-facing portal views.
- Different portal surfaces show conflicting status translations for the same ticket.
- Unknown statuses appear as blank, broken, or raw internal values.
- The translated statuses materially mislead customers about whether work is active, blocked, resolved, or complete.
- One common customer-facing path still leaks raw internal Jira status text.
- History or detail views contradict the list view.
- Branch states such as waiting on customer or waiting on third party are flattened so much that the customer loses important context.
- Support would still need to explain portal status wording manually because it remains confusing.
