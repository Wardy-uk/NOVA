# Success Criteria Template

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name:
- Phase:
- User-facing area:

## Core Outcomes

- Outcome 1:
- Outcome 2:
- Outcome 3:

## Behavioural Checks

- A user can:
- A user cannot:
- The system should:

## Guardrails

- Must preserve:
- Must not regress:
- Out of scope:

## Evidence To Collect

- UI evidence:
- API evidence:
- CLI evidence:

## SaaS Example

- Name: Support dashboard ticket filtering
- Outcome 1: A support manager can filter tickets by team and status without losing pagination state.
- Outcome 2: Empty results show a clear empty state instead of a broken table.
- Must not regress: Existing ticket detail links and saved filters.
