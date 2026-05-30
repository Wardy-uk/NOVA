# WS0 Implementation Plan — Infrastructure & Runtime

## Intent

Deliver the smallest stable runtime slice that proves SARA can live continuously on the Pi 5 as one system with a frontend, backend, and future-compatible structure.

## Delivery Order

1. Create the `sara/` runtime scaffold and ownership boundaries.
2. Establish backend entrypoint and startup method.
3. Establish frontend entrypoint and startup method.
4. Wire a minimal communication path between frontend and backend.
5. Configure automatic runtime launch for the Pi 5 target.
6. Document assumptions, startup steps, and known limitations.
7. Route to independent evaluation before activating WS1.

## Suggested Build Shape

### Slice A — Runtime structure

- confirm repo paths for `sara/frontend`, `sara/backend`, `sara/state-engine`, `sara/integrations`, `sara/config`, and `sara/docs`
- ensure the structure communicates one shared-system model

### Slice B — Service startup

- choose the concrete local startup mechanism for frontend and backend
- ensure both services can be brought up predictably on the Pi 5 target

### Slice C — Connectivity proof

- expose one minimal backend-served runtime payload
- verify the frontend can retrieve and present it

### Slice D — Auto-launch and operator clarity

- implement or document the boot-time launch path
- leave enough observable evidence for behavioural evaluation

## Risks To Manage

- WS0 scope drift into dashboard design or State Engine logic
- hidden coupling to hardware or environment assumptions
- startup mechanisms that work only in a dev shell, not as a device runtime
- creating multiple local state owners that contradict the one-SARA principle

## Exit Condition

WS0 exits build only when the Build Agent can declare the runtime ready for independent behavioural evaluation.
