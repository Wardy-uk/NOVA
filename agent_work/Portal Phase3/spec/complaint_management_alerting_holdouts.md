# Complaint Management Alerting Holdouts

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name: Complaint management alerting
- Phase: Portal Phase3

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | Canonical complaint case reaches submission | Systems often stop at complaint-aware wording without changing operational outcome | Resulting ticket/outcome includes a complaint-specific escalation signal |
| H2 | Emotional complaint with detailed issue | Complaint detail can be preserved for the user but dropped operationally | Operational artifact preserves complaint context and remains clearly escalated |
| H3 | Protected follow-up or website control case after alerting changes | Operational alerting changes can accidentally bleed into unrelated cases | Non-complaint cases remain unaffected |

## Edge Inputs

- Input: explicit formal complaint
- Input: escalation request with concrete service failure details
- Input: protected non-complaint control case

## Regression Traps

- Trap: complaint tickets still look operationally identical to ordinary tickets
- Trap: management alerting leaks internal process to the customer
- Trap: complaint alerting starts marking unrelated tickets
