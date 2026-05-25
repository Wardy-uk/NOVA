# Deterministic Routing Hardening Holdouts

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name: Deterministic routing hardening
- Phase: Portal Phase3

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | A canonical targeted routing case is re-run with slightly different wording | Deterministic paths often only work for one phrasing | Routing remains consistent and predictable |
| H2 | A targeted routing case includes incidental detail from another domain | Extra detail can wrongly drag the case into generic or unrelated routing | The intended deterministic path still wins |
| H3 | A protected follow-up or complaint case is run after deterministic changes | Routing hardening can unintentionally steal previously protected flows | Protected domains still behave as before |

## Edge Inputs

- Input: canonical targeted routing case
- Input: targeted routing case with mixed detail
- Input: repeated variant wording for the same target case
- Input: protected follow-up or complaint control case

## Regression Traps

- Trap: deterministic routes only work for one exact phrase
- Trap: targeted routing logic leaks internal routing semantics to customers
- Trap: routing hardening regresses protected complaint/follow-up paths
- Trap: routing appears fixed in one runtime surface but not another
