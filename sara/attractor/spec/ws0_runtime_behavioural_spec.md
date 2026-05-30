# WS0 Behavioural Specification — Infrastructure & Runtime

## Objective

Establish a dependable Pi 5 runtime that can host SARA as a continuously available system surface.

## Required User-Visible Behaviour

1. After device boot, the SARA runtime comes up without manual intervention.
2. The frontend becomes reachable in its intended always-on display mode.
3. The backend starts successfully and remains available to serve the frontend.
4. The frontend can obtain backend-provided runtime data through a defined integration path.
5. Failures are surfaced honestly enough that an operator can tell whether launch or connectivity succeeded.

## Required Architectural Outcome

- The repository contains a clear runtime shape under `sara/` for frontend, backend, state-engine, integrations, config, and docs.
- WS0 may use placeholder or stub data, but must not imply multiple independent SARAs or node-owned state.
- The runtime contract created here must be reusable by WS1 and WS2 without a forced rewrite of the basic launch path.

## Constraints

- No Home Assistant integration in WS0.
- No voice behaviour in WS0.
- No distributed-node synchronisation in WS0.
- No AI inference requirements in WS0.
- Avoid speculative architecture beyond what is needed to boot, launch, and communicate.

## Evidence Expectations

The Build Agent should be able to point to:

- boot and launch mechanism used for the Pi 5 runtime
- frontend entrypoint and backend entrypoint
- communication path between them
- any required local configuration or startup instructions
