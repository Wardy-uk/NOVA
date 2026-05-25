# WS4 Manager Brief — Loop 01

## Workstream

WS4 — n8n Workflow Integrity

## Objective

Start WS4 with the smallest useful workflow-integrity slice:

- establish how `KpiSnapshot` and related n8n-owned evidence surfaces are supposed to be populated
- classify whether current staleness is an inactive-workflow problem, ownership/hosting problem, or missing-access problem

## Why This Slice First

- Several remaining evidence surfaces still depend on n8n-owned outputs.
- We already know `KpiSnapshot` is stale and non-authoritative, but not whether that is accidental, intentional, or permanently obsolete.
- This can be classified without reopening trusted WS1 / WS5 outputs.

## Slice Definition

### WS4-A — n8n Evidence Path Validation

Goal:

Produce an evidence-based map of the current n8n workflow dependency path for KPI snapshots and identify what is actually runnable, inspectable, stale, or abandoned.

Expected outputs:

- all locally available n8n artefacts or setup scripts
- known tables and outputs historically owned by n8n (`KpiSnapshot`, `dbo.Agent`, agent KPI outputs if discoverable)
- what is known vs unknown about the live workflow host, schedule, and trigger path
- whether WS4 next should be:
  - runtime access / inspection
  - decommission / non-authoritative closure
  - or bounded parity / retry-path recovery

## Explicit Scope

In scope:

- local repo artefacts referencing n8n
- current documentation and discovery notes
- workflow-owned tables and their known usage in NOVA
- evidence gaps that require human/runtime access later

Out of scope:

- rebuilding n8n features in NOVA
- agent KPI implementation
- any direct production workflow change
- WS5 trusted wallboard slices

## Decision For This Loop

This is a discovery / classification loop, not an implementation loop.

The next step is a bounded Build Agent investigation that determines whether WS4 is a real recovery stream or mostly a documentation / decommission stream.
