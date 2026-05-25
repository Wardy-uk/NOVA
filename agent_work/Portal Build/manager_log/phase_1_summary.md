# Phase 1 Summary

## Why This Is The First Selected Gap

This is the first selected gap because it is already identified concretely in `portal-status-flow-spec.md`, it is clearly customer-visible, and it can be improved without changing internal Jira workflow. It is small enough for the first true context-isolated attractor-model cycle while still producing a meaningful improvement to the portal experience.

## Files Created

- `agent_work/spec/evaluation_criteria.md`
- `agent_work/spec/holdout_scenarios.md`
- `agent_work/spec/convergence_definition.md`
- `agent_work/plan/phase_1_build_slice.md`
- `agent_work/manager_log/phase_1_summary.md`

## What The Manager Agent Should Do Next

- Hand only `agent_work/plan/phase_1_build_slice.md` to the Build Agent.
- Do not expose `agent_work/spec/*` to the Build Agent.
- Wait for the Build Agent to complete the slice and write readiness notes in `agent_work/build_status/`.
- After build completion, provide the Eval Agent access to the eval-only spec files.
- Review evaluator findings and decide whether the slice has converged or needs another tightly scoped loop.

## Safe For Build Agent

- NOVA codebase
- `agent_work/plan/phase_1_build_slice.md`

## Not Safe For Build Agent

- `agent_work/spec/evaluation_criteria.md`
- `agent_work/spec/holdout_scenarios.md`
- `agent_work/spec/convergence_definition.md`
- `agent_work/eval_output/*`

## Safe For Eval Agent

- `agent_work/spec/evaluation_criteria.md`
- `agent_work/spec/holdout_scenarios.md`
- `agent_work/spec/convergence_definition.md`

## Not Safe For Eval Agent

- NOVA source code
- build implementation notes
- `agent_work/plan/phase_1_build_slice.md` unless explicitly approved by Manager

## Existing Phase Files

The earlier phase-specific draft files remain as working history for the Manager Agent, but the canonical context-isolated handoff files for this cycle are the five files listed above.
