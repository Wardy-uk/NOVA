# Edge-Case Routing Sensitivity Hardening Holdouts

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name: Edge-case routing sensitivity hardening
- Phase: Portal Phase3

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | Letters request mentions website only as incidental context | Edge-case precedence fixes often overcorrect and steal true website requests | Clear letters intent still wins, but pure website requests remain unchanged |
| H2 | Follow-up request uses `is not fixed` without `still` across multiple ticket numbers | Phrase fixes often only work for one lexical or numeric pattern | Follow-up path remains consistent across representative ticket refs |
| H3 | Canonical complaint or website control case is run after the hardening change | Local routing tweaks can regress adjacent protected flows | Protected complaint/website behaviour remains unchanged |

## Edge Inputs

- Input: letters request with website mention
- Input: website request with incidental mention of letters/correspondence
- Input: `NT-55555 is not fixed`
- Input: `NT-20001 is not fixed`

## Regression Traps

- Trap: letters precedence fix starts stealing genuine website requests
- Trap: `is not fixed` follow-up fix regresses canonical complaint or property handling
- Trap: the fix only works for one tested ticket number or one exact wording
