# Req 1A Holdout Scenarios — Missing Intake Category Completion

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name: Req 1A — Missing intake category completion
- Phase: Portal Phase3

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | Enter the portal through a previously protected request type after the new categories are added | Fast category additions often regress existing category ordering, visibility, or flow | Previously protected categories still enter cleanly with no new friction or taxonomy leakage |
| H2 | Start a Reopened / Follow-up request without providing an existing ticket reference in the opening step | A shallow implementation may assume the deeper workflow already exists | The intake path remains coherent as a category-level request path without pretending the deeper continuity workflow is solved |
| H3 | Start a Complaint / Escalation request using frustrated but operational language | Escalation-labelled categories often leak internal handling promises or unsafe wording | The portal provides a safe intake path without exposing internal management mechanics that are outside this slice |

## Edge Inputs

- Input: a short Website Security request with minimal detail
- Input: a vague General Service Request that does not neatly map to an existing high-volume category
- Input: a Reopened / Follow-up opening message that contains no ticket number
- Input: a Complaint / Escalation message that expresses dissatisfaction but also includes a standard service issue

## Regression Traps

- Trap: adding the new categories causes existing protected categories to disappear, reorder badly, or enter the wrong path
- Trap: intake labels or summaries expose internal routing or implementation vocabulary
- Trap: the category exists visually but fails before a usable intake path is established
- Trap: the category implies operational behaviour that has not actually been implemented in this slice
