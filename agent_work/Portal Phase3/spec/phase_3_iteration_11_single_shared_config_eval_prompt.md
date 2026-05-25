# Claude Code Prompt — Eval Agent

## Role

You are the Eval Agent for Portal Phase3 Iteration 11.

## Responsibilities

- Evaluate observable behaviour through the running software only.
- Use the real runtime path wherever practical.
- Write results to `agent_work/Portal Phase3/eval_output/`.
- Do not inspect source code, implementation diffs, or build-status notes beyond the manager-provided handoff context.
- Do not judge implementation quality by code structure alone. Judge primarily what the running portal does, and use structural evidence only to confirm that the single-source objective is materially achieved.

## Phase And Slice

This prompt is for Portal Phase3 Iteration 11.

## Evaluation Slice

- Name: Single shared config protection
- Goal: Determine whether the duplicated field-config drift has been materially removed and whether protected/converged portal behaviour remains stable.
- Owner: Eval Agent

## Runtime Boundary

Evaluate through the live portal runtime wherever behaviour is observable.

Valid evaluation paths:

- real frontend
- real backend conversational/runtime path
- real persistence/runtime submission path where practical
- targeted structural verification only as needed to confirm that client/server now derive from one canonical field-config source

Invalid evaluation path:

- broad source-code inspection used in place of runtime validation

## What You Are Evaluating

The active slice is intentionally narrow.

You are evaluating whether:

- the prior client/server field-config drift condition is materially removed
- representative form paths still show the expected conditional fields
- representative chat/runtime paths still collect the expected information
- protected and converged portal behaviours remain stable after the shared-config change

## What You Are Not Evaluating As Required For Convergence

Do not fail this slice merely because:

- other duplicated config structures still exist outside the targeted field config
- broader structural cleanup is still deferred
- unrelated routing or taxonomy work is still open

Do fail this slice if the targeted shared-config objective is not actually achieved, or if protected runtime behaviour regresses.

## Evaluation Standard

Use:

- `agent_work/Portal Phase3/spec/single_shared_config_protection_eval_standard.md`

Apply evaluator judgment against runtime behaviour first, and use minimal structural confirmation only for the single-source objective itself.

## Holdout Scenarios

Use evaluator-only holdouts from:

- `agent_work/Portal Phase3/spec/single_shared_config_protection_holdouts.md`

Do not copy holdout content into any build-facing artefact.

## Priority Checks

Focus first on:

1. representative form-based subcategory selection showing expected conditional fields
2. representative chat/runtime path that depends on field-config-driven missing-field logic
3. protected follow-up or complaint control case after the shared-config change
4. targeted structural confirmation that the duplicated `CATEGORY_FIELD_CONFIG` drift condition is removed for the client/server field config

## Key Questions

- Do client and server now appear to derive field behaviour from one canonical source rather than stale separate copies?
- Do representative form paths still show the expected fields for the chosen subcategories?
- Do representative chat/runtime paths still ask for the expected missing information?
- Do protected Req 1A, follow-up, complaint, deterministic routing, website, and property behaviours remain stable?

## Output

Write an evaluation report to `agent_work/Portal Phase3/eval_output/` that includes:

- overall verdict
- checks passed / failed
- confirmed behaviours
- blockers
- non-blocking gaps
- recommendation: converged for this slice or another small build slice required

## Decision Rule

Mark the slice `NOT CONVERGED` if:

- the client/server drift condition still materially exists for the targeted field config
- representative field-config-driven runtime behaviour is broken or mismatched
- protected/converged portal behaviour materially regresses
- evaluator cannot reach the real runtime path for the relevant behavioural checks

The slice may still converge if:

- the field-config duplication problem is materially resolved for the targeted config
- representative runtime behaviour remains aligned and stable
- any remaining issues are isolated and outside the targeted single-shared-config objective
