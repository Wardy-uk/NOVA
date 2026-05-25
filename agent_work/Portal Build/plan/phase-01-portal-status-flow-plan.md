# Phase Plan

## Phase

- Name: Phase 01 portal customer-facing status flow
- Goal: Replace raw Jira status exposure in the customer portal with a curated 7-status customer-facing model.
- Owner: Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: customers see understandable ticket statuses and progress.
- Touches existing behaviour without broad rewrite: status translation and rendering only.
- Can be evaluated independently: ticket lists, ticket detail, and status history can be checked through the running portal.

## Inputs

- Build brief: `agent_work/spec/phase-01-portal-status-flow-build-brief.md`
- Eval pack: `agent_work/manager_log/phase-01-portal-status-flow-eval-pack.md`
- Source gap: `portal-status-flow-spec.md`
- Prior build status: none yet
- Prior eval output: none yet

## Build Brief

- Change target: customer-facing status presentation in the portal.
- Constraints: preserve Jira workflows and internal status storage, keep the change local.
- Non-goals: intake redesign, workflow redesign, broad portal rewrite.

## Done Signal

- Build Agent marks ready in `agent_work/build_status/`.
- Eval Agent can test through running software only.

## Manager Notes

- This phase targets the first concrete customer-portal gap already identified in the analysis: raw internal statuses are leaking directly into the portal.
- The slice is intentionally narrow so the first attractor-model loop validates the manager/build/eval pattern with a clear, customer-visible improvement.
