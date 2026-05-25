# Portal Phase3 Plan — May 25 Regression Protection Bundle

## Phase

- Name: Phase3 May 25 regression protection bundle
- Goal: Determine whether the May 25 converged domains can now be promoted from `Converged Pending Protection` to `Regression Protected`.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single purpose: protect the domains already converged on May 25.
- Evaluation-only unless a critical blocker is found.
- Keeps runtime-blocked complaint management alerting separate instead of mixing environment issues into protection work.

## Inputs

- Regression standard: `agent_work/Portal Phase3/spec/regression/regression_protection_standard.md`
- Tracker contract: `agent_work/Portal Phase3/spec/orchestration/tracker_update_contract.md`
- Deterministic routing convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-25_deterministic_routing_convergence_decision.md`
- Edge-case routing convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-25_edge_case_routing_convergence_decision.md`
- Single shared config convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-25_single_shared_config_convergence_decision.md`
- Bundle spec: `agent_work/Portal Phase3/spec/phase3_may25_regression_protection_bundle.md`
- Bundle eval standard: `agent_work/Portal Phase3/spec/phase3_may25_regression_protection_eval_standard.md`
- Bundle holdouts: `agent_work/Portal Phase3/spec/phase3_may25_regression_protection_holdouts.md`

## Evaluation Brief

- Change target: none at start; this is an evaluation/protection pass
- Constraints: do not reopen scope unless a critical blocker is found
- Non-goals: new feature work, complaint-management runtime unblock work, and unrelated structural refactors

## Done Signal

- Eval Agent writes a regression protection report to `agent_work/Portal Phase3/eval_output/`
- Manager decides for each target domain: `Regression Protected` or `Not Yet Protected`
- Tracker and protected-domain state updated accordingly
