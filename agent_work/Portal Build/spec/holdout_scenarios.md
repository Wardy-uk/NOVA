# Holdout Scenarios

DO NOT SHARE THIS FILE WITH THE BUILD AGENT.

## Phase

- Name: Phase 1 portal customer-facing status flow

## Hidden Scenarios

### Scenario 1: Customer sees an unfamiliar internal state

- Customer input: The customer opens an existing ticket whose underlying Jira status is something internal-sounding such as `Triaged`, `Categorised`, or `Escalated`.
- Expected behaviour: No explanation should be required from the customer; the portal should already present a clear customer-facing status.
- Expected captured information: The visible portal status should communicate the broad support state clearly.
- Expected final outcome: The customer sees `Reviewed` or `In Progress` rather than an internal Jira term.

### Scenario 2: Waiting on customer

- Customer input: The customer opens a ticket whose underlying Jira status is `Waiting for Customer` or `Pending Customer`.
- Expected behaviour: The portal should make it clear that support needs something from the customer.
- Expected captured information: The displayed status should communicate that customer action or information is needed.
- Expected final outcome: The customer sees `Awaiting Your Response`.

### Scenario 3: Third-party dependency

- Customer input: The customer opens a ticket whose underlying Jira status is `With Third Party`.
- Expected behaviour: The portal should communicate that progress depends on an external provider, not imply the ticket is idle or forgotten.
- Expected captured information: The displayed status should reflect the external dependency clearly.
- Expected final outcome: The customer sees `Awaiting Third Party`.

### Scenario 4: Unknown status

- Customer input: The customer opens a ticket with an unexpected or newly introduced internal Jira status not explicitly mapped.
- Expected behaviour: The portal should still render a safe, understandable status and remain stable.
- Expected captured information: A reasonable fallback state should be shown.
- Expected final outcome: The customer sees a safe fallback such as `In Progress`, not the raw unknown status.

### Scenario 5: Frustrated interpretation test

- Customer input: The customer says, "Why does my ticket say categorised? What does that even mean?"
- Expected behaviour: In the converged experience, that confusion should be prevented by the visible status wording itself.
- Expected captured information: The displayed status should already be understandable without internal jargon.
- Expected final outcome: A normal customer should no longer encounter raw internal wording that triggers this confusion.

## Pass Expectations

- Each holdout produces a customer-facing status that is understandable without internal support knowledge.
- No holdout leaks raw Jira terminology in standard customer-visible portal surfaces.
- Unknown statuses fail safely.

## Fail Expectations

- Any holdout shows raw internal Jira wording directly to the customer.
- Any holdout results in blank, broken, or contradictory status presentation.
- Any holdout still requires support to manually reinterpret the visible status for the customer.
