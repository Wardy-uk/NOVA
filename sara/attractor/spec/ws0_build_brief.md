# WS0 Build Brief — Infrastructure & Runtime

## Work Package

`WS0-WP1` — Pi 5 runtime foundation

## Objective

Create the first stable SARA runtime on the Pi 5 so the system can boot, launch automatically, and present a working frontend/backend loop.

## Required Behavioural Outcome

Deliver a runtime where:

1. the Pi 5 can start SARA without manual app launch steps after boot
2. the frontend and backend both start successfully
3. the frontend can communicate with the backend through a defined runtime path
4. the repository has the expected `sara/` architecture scaffold in place

## Scope

In scope:

- runtime scaffold under `sara/`
- frontend/backend startup path
- local runtime configuration needed for Pi 5 bring-up
- simple backend-to-frontend connectivity proof
- honest operator-facing startup documentation

Out of scope:

- Home Assistant integration
- voice
- advanced state inference
- distributed node behaviour
- dashboard feature completeness beyond what WS0 needs to prove runtime health

## Implementation Constraints

- Respect the protected principle that there is one SARA and one shared state model.
- If placeholder data is needed, keep it obviously temporary and compatible with a future central State Engine.
- Do not consume evaluator criteria or holdout scenarios.
- Keep the slice small; avoid broad architectural refactors outside the runtime foundation.

## Deliverables

1. Runtime scaffold in the required `sara/` structure.
2. Working startup path for frontend and backend on the Pi 5 target.
3. One factual build-status report in `sara/attractor/build_status/` when ready for evaluation.

## Build Status Report Must Include

- what was added or changed
- how the runtime is started
- what assumptions or local dependencies remain
- any known limitations still inside WS0 scope
- explicit statement that the work package is ready for evaluation
