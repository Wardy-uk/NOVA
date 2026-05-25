# First Attractor Build Cycle

## 1. Problem Statement

The customer portal currently passes raw internal Jira statuses to customers. This exposes internal process language, makes ticket progress harder to understand, and creates a poor customer-facing support journey.

The first controlled loop is to replace those raw statuses with a curated 7-status customer-facing model that expresses support progress clearly while leaving internal Jira workflow unchanged.

## 2. User Outcome

From the customer perspective, ticket status should be easy to understand at a glance. Customers should be able to tell whether their request has been received, reviewed, actively worked on, waiting on them, waiting on a third party, resolved, or closed, without needing to interpret internal Jira terminology.

## 3. Operational Outcome

From the support and service-desk perspective, internal workflows stay exactly as they are, while the portal presents a more understandable customer-facing layer. Support should not need to change how they work in Jira for customers to get a clearer status journey.

## 4. Evaluation Criteria

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

## 5. Holdout Scenarios

> DO NOT LEAK TO BUILD AGENT.

### Scenario 1: Customer sees an unfamiliar internal state

- Customer input: The customer opens an existing ticket whose underlying Jira status is something internal-sounding such as `Triaged`, `Categorised`, or `Escalated`.
- Expected follow-up behaviour: No explanation should be required from the customer; the portal should already present a clear customer-facing status.
- Expected captured information: The visible portal status should communicate the broad support state clearly.
- Expected final outcome: The customer sees `Reviewed` or `In Progress` rather than an internal Jira term.

### Scenario 2: Waiting on customer

- Customer input: The customer opens a ticket whose underlying Jira status is `Waiting for Customer` or `Pending Customer`.
- Expected follow-up behaviour: The portal should make it clear that support needs something from the customer.
- Expected captured information: The displayed status should communicate that customer action or information is needed.
- Expected final outcome: The customer sees `Awaiting Your Response`.

### Scenario 3: Third-party dependency

- Customer input: The customer opens a ticket whose underlying Jira status is `With Third Party`.
- Expected follow-up behaviour: The portal should communicate that progress depends on an external provider, not imply the ticket is idle or forgotten.
- Expected captured information: The displayed status should reflect the external dependency clearly.
- Expected final outcome: The customer sees `Awaiting Third Party`.

### Scenario 4: Unknown status

- Customer input: The customer opens a ticket with an unexpected or newly introduced internal Jira status not explicitly mapped.
- Expected follow-up behaviour: The portal should still render a safe, understandable status and remain stable.
- Expected captured information: A reasonable fallback state should be shown.
- Expected final outcome: The customer sees a safe fallback such as `In Progress`, not the raw unknown status.

### Scenario 5: Frustrated interpretation test

- Customer input: The customer says, "Why does my ticket say categorised? What does that even mean?"
- Expected follow-up behaviour: In the converged experience, that confusion should be prevented by the visible status wording itself.
- Expected captured information: The displayed status should already be understandable without internal jargon.
- Expected final outcome: A normal customer should no longer encounter raw internal wording that triggers this confusion.

## 6. Convergence Definition

### Minimum Acceptable Behaviour

- Portal ticket list and ticket detail surfaces show customer-facing statuses instead of raw internal Jira statuses.
- The curated status names are used consistently.
- Known mapped Jira statuses resolve to the intended customer-facing labels.
- Unknown statuses fail safely to a customer-friendly default.
- In normal tested cases, customers can understand the broad state of their ticket without support jargon.

### Unacceptable Behaviour

- Raw Jira statuses remain visible in customer-facing portal views.
- Different portal surfaces show conflicting status translations for the same ticket.
- Unknown statuses appear as blank, broken, or raw internal values.
- The translated statuses materially mislead customers about whether work is active, blocked, resolved, or complete.

### Known Tolerances

- The first slice does not need perfect graphical polish as long as the customer-facing meaning is clear.
- The exact visual treatment can remain modest if the behavioural status translation is correct.
- Internal Jira data structures may remain unchanged as long as the portal presentation is correct.

### What Would Still Fail Evaluation

- If even one common customer-facing path still leaks raw internal Jira status text.
- If history or detail views contradict the list view.
- If branch states such as waiting on customer or waiting on third party are flattened so much that the customer loses important context.
- If support would still need to explain portal status wording manually because it remains confusing.

## 7. First Build Slice

The first slice is:

Implement the curated 7-status customer-facing translation layer for portal ticket status, including current status display and customer-visible status history.

This slice should:

- map raw Jira statuses to the 7 customer-facing portal statuses
- apply the mapping anywhere customers see ticket status
- use a safe fallback for unmapped statuses
- provide a clearer sense of ticket progress in the portal

This slice should not:

- change Jira workflows
- redesign ticket intake
- rebuild the whole ticket-detail experience
- expand into unrelated support portal improvements

## 8. Build Agent Instructions

Build only the first customer-facing portal status slice.

You can inspect and change code, but do not broaden scope beyond status translation and customer-visible status presentation. Reuse the existing portal ticket data flow and rendering patterns where possible. Preserve existing Jira workflow, storage, and post-submit behaviour.

Desired behavioural capability:

- Customers should see understandable support statuses instead of internal Jira labels.
- The same ticket should present status consistently across the main customer-visible portal surfaces.
- The portal should handle known and unknown Jira statuses safely.
- The display should communicate progress without exposing support-team jargon.

Optimise for:

- customer clarity
- stable mapping behaviour
- preserving existing internal support operations
- graceful fallback handling

Do not optimise for:

- changing Jira workflows
- speculative platform redesign
- broad portal refactors
- unrelated feature work

## 9. Eval Agent Instructions

Evaluate only through the running portal and any exposed API, CLI, or logs available from the running system. Do not inspect source code, implementation notes, or diffs.

Act like a real customer using the portal:

- start from the ticket list and ticket detail views
- inspect how current status and status history are shown
- probe tickets in different states where possible
- look specifically for customer confusion, internal jargon leakage, inconsistent labels, and unsafe fallback behaviour

Assess whether the resulting portal status journey is understandable to a normal customer without internal support knowledge.

Produce one of:

- convergence confirmed
- structured gap analysis

If producing gap analysis, include:

- scenario
- observed behaviour
- expected behaviour
- severity
- evidence captured
- whether support would need to manually explain or reinterpret the status for the customer

Judge only what the system actually does. Do not infer correctness from implementation shape.

## 10. Recommended Evidence Collection

- Screenshots of portal ticket-list status display before and after navigating into detail.
- Screenshots of ticket-detail current status and any progress or stepper UI.
- Screenshots of customer-visible status history entries.
- Request/response captures for ticket-list and ticket-detail data if accessible through the running system.
- Logs relevant to status mapping, unknown-status fallback, or rendering failures.
- Evidence for tickets in at least these broad cases:
  - newly submitted
  - reviewed/triaged
  - active work in progress
  - waiting on customer
  - waiting on third party
  - resolved
  - closed
- Evidence of how the portal behaves for any unmapped or unexpected status encountered during testing.
- Timing observations showing whether status translation introduces visible rendering delay or flicker.
