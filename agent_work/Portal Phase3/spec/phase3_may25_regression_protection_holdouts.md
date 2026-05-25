# Phase3 May 25 Regression Protection Holdouts

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name: Phase3 May 25 regression protection bundle
- Phase: Portal Phase3

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | Re-run a canonical deterministic routing case with variant wording | Deterministic routes can regress quietly after adjacent changes | Routing remains consistent |
| H2 | Re-run the named edge-case routing fixes | Local hardening can regress after unrelated structural changes | Edge cases still behave correctly |
| H3 | Re-run representative shared-config-driven form/chat paths | Structural protection can decay silently while behaviour looks superficially fine | Client/server alignment symptoms remain clean |
| H4 | Re-run protected follow-up, complaint, website, and property controls | Newly protected structural/routing work can still destabilise earlier domains | Earlier protected behaviours remain stable |

## Edge Inputs

- Input: representative template request
- Input: representative letters+website edge-case wording
- Input: representative `NT-XXXXX is not fixed` phrasing
- Input: representative field-config-driven form path

## Regression Traps

- Trap: deterministic routes regress under variant wording
- Trap: edge-case fixes decay after nearby changes
- Trap: shared config protection leaves stale local behaviour behind
- Trap: protected complaint/follow-up/website/property paths regress
