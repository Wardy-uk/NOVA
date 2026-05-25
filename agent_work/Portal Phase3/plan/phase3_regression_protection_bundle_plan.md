# Portal Phase3 Plan — Regression Protection Bundle

## Phase

- Name: Portal Phase3 regression protection bundle
- Goal: Determine whether the newly converged Phase 3 domains can be promoted from `Converged Pending Protection` to `Regression Protected`.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible purpose: confirm that the newly converged behaviours hold together through the real runtime without reopening build scope.
- Evaluation-only unless a critical blocker is found.
- Reuses existing convergence evidence rather than starting a new behavioural domain.

## Inputs

- Regression standard: `agent_work/Portal Phase3/spec/regression/regression_protection_standard.md`
- Tracker contract: `agent_work/Portal Phase3/spec/orchestration/tracker_update_contract.md`
- Req 1A convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-24_req1a_convergence_decision.md`
- Follow-up convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-24_followup_convergence_decision.md`
- Complaint convergence decision: `agent_work/Portal Phase3/manager_log/2026-05-24_complaint_convergence_decision.md`
- Bundle spec: `agent_work/Portal Phase3/spec/phase3_regression_protection_bundle.md`
- Bundle eval standard: `agent_work/Portal Phase3/spec/phase3_regression_protection_eval_standard.md`
- Bundle holdouts: `agent_work/Portal Phase3/spec/phase3_regression_protection_holdouts.md`

## Evaluation Brief

- Change target: none at start; this is an evaluation/protection pass
- Constraints: do not reopen scope unless evaluation finds a critical blocker that breaks protected behaviour
- Non-goals: new feature work, broad cleanup, and unrelated structural refactors

## Done Signal

- Eval Agent writes a regression protection report to `agent_work/Portal Phase3/eval_output/`
- Manager decides for each target domain: `Regression Protected` or `Not Yet Protected`
- Tracker and protected-domain state updated accordingly
