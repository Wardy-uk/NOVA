# Edge-Case Routing Sensitivity Hardening Evaluation Standard

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name: Edge-case routing sensitivity hardening
- Phase: Portal Phase3
- User-facing area: Portal conversational routing

## Core Outcomes

- Outcome 1: Mixed letters+website phrasing routes to letters when the primary request is clearly correspondence.
- Outcome 2: `NT-XXXXX is not fixed` style follow-up phrasing routes to the follow-up path reliably without requiring `still`.
- Outcome 3: Protected behaviours remain stable.

## Behavioural Checks

- A user can express a letters/correspondence need with incidental website detail and still land on the intended letters path.
- A user can say a ticket `is not fixed` and still reach the follow-up path.
- A user cannot see internal routing labels, project keys, queue names, or implementation jargon.
- The system should preserve already protected complaint, follow-up, website, and property behaviour.

## Guardrails

- Must preserve: protected Req 1A, follow-up, complaint, website, property, and taxonomy protection.
- Must not regress: deterministic letters routing, canonical `still not fixed` routing, and ordinary website/property handling.
- Out of scope: broader phrase coverage or mixed-intent redesign beyond the named misses.

## Evidence To Collect

- UI evidence: customer-visible routing journey and summary behaviour for the two target cases
- API evidence: observable category/subcategory/runtime behaviour where available
- CLI evidence: none required unless runtime logs are explicitly part of accepted evaluation
