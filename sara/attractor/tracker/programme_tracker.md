# Programme Tracker — SARA

## Programme Status

- Start date: 2026-05-30
- Current stage: build claim received; verification blocked by missing artefacts
- Current in-scope workstreams: WS0, WS1, WS2
- Current active workstream: WS0 — Infrastructure & Runtime
- Current phase recommendation: establish a stable Pi 5 runtime baseline before state or dashboard polish

---

## Vision Guardrails

- SARA is a persistent operating layer, not a chatbot-first product.
- There is one shared SARA brain and shared state across embodiments.
- Context and state understanding come before conversational behaviour.
- The State Engine is the protected architectural centre.
- Home Assistant is the telemetry bus, not the decision engine.
- Pi nodes are embodiments and interfaces, not autonomous brains.

---

## Core Artefacts

- Charter: `../spec/programme_charter.md`
- Workstreams: `../spec/workstream_definitions.md`
- WS0 behavioural spec: `../spec/ws0_runtime_behavioural_spec.md`
- WS0 build brief: `../spec/ws0_build_brief.md`
- WS0 convergence definition: `../spec/ws0_convergence_definition.md`
- WS0 implementation plan: `../plan/ws0_implementation_plan.md`
- Workstream tracker: `workstream_tracker.md`
- Build handoff log: `../manager_log/ws0_build_handoff_2026-05-30.md`
- Eval handoff log: `../manager_log/ws0_eval_handoff_2026-05-30.md`

---

## Workstream Status

| Workstream | Status | Notes |
|-----------|--------|-------|
| WS0 Infrastructure & Runtime | Build claim unverified | Claimed complete outside the visible workspace, but required runtime files and build-status artefact are not present here |
| WS1 State Engine | Planned | Hardcoded v1 allowed after WS0 baseline exists |
| WS2 Dashboard | Planned | Depends on WS0 runtime and WS1 state contract |
| WS3 Home Assistant Integration | Not started | Explicitly out of scope for current programme slice |
| WS4 Voice Interface | Not started | Explicitly out of scope |
| WS5 Context Inference | Not started | Explicitly out of scope |
| WS6 Distributed Nodes | Not started | Explicitly out of scope |

---

## Current Programme Judgments

- WS0 must produce a stable host runtime, not a premature intelligence layer.
- WS1 and WS2 are in scope for planning continuity, but must not be silently absorbed into WS0.
- Shared-state architecture is protected even if WS0 uses temporary hardcoded values or stub services.
- Behavioural evaluation is mandatory before any workstream is considered converged.

---

## Next Manager Actions

1. Obtain the actual WS0 runtime artefacts in this workspace.
2. Obtain the required WS0 build-status report in `sara/attractor/build_status/`.
3. Route WS0 evaluation standard to an Evaluator Agent only after the build handoff is materially present and reviewable.
4. Decide convergence or bounded iteration based on behavioural evidence alone.
