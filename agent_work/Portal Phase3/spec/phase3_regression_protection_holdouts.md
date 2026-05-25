# Portal Phase3 Regression Protection Holdouts

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name: Portal Phase3 regression protection bundle
- Phase: Portal Phase3

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | Access each new Req 1A category from the intake surface after follow-up and complaint changes have landed | New domain work can silently break category visibility/order/rendering | All four categories remain present and usable as intake routes |
| H2 | Run a canonical follow-up message after complaint changes | Complaint/emotion logic can steal follow-up messages | Referenced-ticket follow-up still wins and stays continuity-aware |
| H3 | Run a canonical complaint message after follow-up changes | Follow-up/continuity logic can dilute complaint escalation handling | Complaint messages still produce complaint-aware behaviour with preserved dissatisfaction context |
| H4 | Re-run a website and property protected-path smoke test after all Phase 3 changes | New slices often regress earlier protected domains | Website/property paths remain stable with no taxonomy leakage or new friction |

## Edge Inputs

- Input: short follow-up with ticket reference
- Input: short complaint followed by operational detail on turn 2
- Input: mixed-domain complaint wording
- Input: direct selection of the Req 1A category grid items

## Regression Traps

- Trap: newly added categories disappear or behave like stubs
- Trap: complaint logic absorbs follow-up journeys or vice versa
- Trap: internal mechanics leak in summaries or acknowledgements
- Trap: previously protected website/property flows lose coherence
