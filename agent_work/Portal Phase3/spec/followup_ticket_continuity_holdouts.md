# Follow-Up Ticket Continuity Holdout Scenarios

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name: Reopened / follow-up ticket continuity
- Phase: Portal Phase3

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | Customer references a valid ticket and says the issue is still not fixed | The most likely mature-product follow-up path should feel intentional, not passive | The portal treats the message as renewed action context and helps the customer continue |
| H2 | Customer references a valid ticket but asks a short chasing question with little detail | Brief follow-ups often get dropped into generic flows | The portal still acknowledges the referenced ticket and moves the journey forward coherently |
| H3 | Customer references a ticket and adds new detail that changes the situation | Continuity paths often lose either the old context or the new update | The portal preserves the follow-up context while allowing new information to accumulate |

## Edge Inputs

- Input: ticket reference plus "still waiting"
- Input: ticket reference plus "this was marked resolved but it is not"
- Input: ticket reference plus fresh operational detail such as dates, affected page, or user impact

## Regression Traps

- Trap: referenced-ticket handling still stops at passive status display
- Trap: the customer is forced into a generic new-request flow with no continuity acknowledgement
- Trap: the portal leaks internal routing or implementation language while trying to explain the follow-up path
- Trap: previously protected category behaviour regresses while follow-up logic is changed
