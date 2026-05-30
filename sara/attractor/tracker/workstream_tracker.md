# Workstream Tracker — SARA

## WS0 — Infrastructure & Runtime

- Status: Build claim unverified
- Goal: Create a stable SARA runtime on the Pi 5
- Scope now:
  - reliable boot behaviour
  - automatic SARA launch
  - frontend/backend communication
  - initial runtime architecture scaffold
- Explicitly out of scope:
  - Home Assistant integration
  - voice
  - multi-node sync
  - advanced context inference

## WS1 — State Engine

- Status: Planned
- Goal: Create State Engine v1
- Entry condition: WS0 runtime baseline exists and can host a stable state contract
- Key outcome: consistent exposure of state, location, and confidence

## WS2 — Dashboard

- Status: Planned
- Goal: Create always-on SARA dashboard
- Entry condition: WS0 runtime is stable and WS1 state contract is available
- Key outcome: display current state, location, confidence, time, and quick actions without AI dependency

## WS3 — Home Assistant Integration

- Status: Not started
- Notes: protected future workstream; do not absorb into WS0-WS2

## WS4 — Voice Interface

- Status: Not started
- Notes: protected future workstream; no voice work in current slice

## WS5 — Context Inference

- Status: Not started
- Notes: protected future workstream; no autonomous inference expectations in current slice

## WS6 — Distributed Nodes

- Status: Not started
- Notes: protected future workstream; Pi nodes remain embodiment targets only
