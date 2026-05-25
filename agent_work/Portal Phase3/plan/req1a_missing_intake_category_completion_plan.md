# Portal Phase3 Plan — Req 1A Missing Intake Category Completion

## Phase

- Name: Req 1A — Missing intake category completion
- Goal: Complete the missing portal intake category coverage identified in the 24 May 2026 gap analysis using the smallest fast-slice that can be built and evaluated safely.
- Owner: Orchestrator / Manager Agent

## Why This Phase Is Small Enough

- Single user-visible slice: the portal exposes the four missing request types as valid intake categories with basic question/template coverage.
- Touches existing behaviour without broad rewrite: extends intake coverage without requiring full follow-up workflow or complaint-management redesign.
- Can be evaluated independently: evaluator can verify presence, entry behaviour, and safe submission flow through the running portal.

## Inputs

- Spec file: `agent_work/Portal Phase3/spec/portal-gap-analysis-progress-2026-05-24.md`
- Anchor note: `agent_work/Portal Phase3/spec/portal_phase3_anchor.md`
- Manager slice framing: `agent_work/Portal Phase3/spec/req1a_missing_intake_category_completion.md`
- Evaluation standard: `agent_work/Portal Phase3/spec/req1a_eval_standard.md`
- Holdouts: `agent_work/Portal Phase3/spec/req1a_holdout_scenarios.md`

## Build Brief

- Change target: add the four missing request types to portal intake with safe customer-facing labels and basic template/question coverage.
- Constraints: preserve existing converged portal behaviour, avoid deep special-path logic, and do not expose internal routing/taxonomy.
- Non-goals: original-handler follow-up routing, complaint-management alerts, KB governance, and standalone config refactor work.

## Done Signal

- Build Agent marks ready in `agent_work/Portal Phase3/build_status/`
- Eval Agent can test category presence and basic intake flow through running software only
- The portal no longer lacks the four request types called out by Req 1 at the intake-category level
