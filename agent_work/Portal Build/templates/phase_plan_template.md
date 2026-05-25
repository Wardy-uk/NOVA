# Phase Plan Template

## Phase

- Name:
- Goal:
- Owner:

## Why This Phase Is Small Enough

- Single user-visible slice:
- Touches existing behaviour without broad rewrite:
- Can be evaluated independently:

## Inputs

- Spec file:
- Prior build status:
- Prior eval output:

## Build Brief

- Change target:
- Constraints:
- Non-goals:

## Done Signal

- Build Agent marks ready in `agent_work/build_status/`
- Eval Agent can test through running software only

## SaaS Example

- Goal: Improve support ticket list filtering without changing ticket detail behaviour.
- Single user-visible slice: Filter entry, results update, empty state.
- Non-goals: New reporting, permission changes, schema changes.
