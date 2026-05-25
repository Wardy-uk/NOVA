# Single Shared Config Protection Holdouts

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name: Single shared config protection
- Phase: Portal Phase3

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | Representative subcategory in the form shows the expected conditional fields after the shared-config change | Structural deduplication can silently drop client-only behaviour | Form field visibility remains correct |
| H2 | Representative chat/runtime path still asks for the expected missing fields | Server-side field rules can accidentally diverge during refactor | Chat/runtime remains aligned with the shared config |
| H3 | A protected follow-up or complaint path is run after the shared-config change | Structural work can accidentally regress converged paths even without intent to change them | Protected behaviour remains stable |

## Edge Inputs

- Input: representative website-broken form path
- Input: representative complaint or follow-up path
- Input: representative letters or template path

## Regression Traps

- Trap: the shared source exists but client or server still uses a stale local copy
- Trap: a protected path loses a required field because of the refactor
- Trap: structural cleanup unintentionally changes customer-facing wording or conditional behaviour
