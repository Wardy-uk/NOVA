# Evaluation Lifecycle Standard

## Status

LOCKED PROGRAMME STANDARD

This document is the default evaluation lifecycle for the NOVA KPI Engine Recovery & Trust Restoration programme.

Use this standard unless a later decision log entry explicitly supersedes it.

---

## Purpose

This standard defines how evaluator briefs should evolve across a recovery slice.

It exists to avoid two failure modes:

- rewriting the evaluation standard from scratch every build iteration
- freezing the evaluation brief too early and then forcing later work through an outdated brief

---

## Core Rule

Each recovery slice should have:

1. one **core evaluator brief**
2. zero or more **controlled revisions or addenda**
3. one or more **independent retest packs**
4. one **final convergence / regression decision pack**

The evaluation objective should remain stable across the slice.

The evaluation pack may evolve as verified knowledge improves.

---

## Lifecycle Model

### Stage 0 — Evaluation Blocked

Use when:

- source-of-truth is unresolved
- calculation methodology is unresolved
- required diagnostics are incomplete
- a meaningful independent verdict would be premature

Required output:

- a short evaluation-blocked note
- explicit blockers
- the evidence needed before evaluation can begin

Rule:
Do not force the evaluator to judge correctness when the target is still undefined.

### Stage 1 — Core Evaluator Brief

Create one core evaluator brief for the slice once:

- the scope is stable enough to test
- the intended behaviour or evidence target is defined
- the source/calc boundary is sufficiently explicit for independent checking

The core brief should define:

- slice name and scope
- purpose of the evaluation
- what is being judged
- evidence sources allowed to the evaluator
- pass / fail / ambiguous logic
- non-scope items
- required outputs

Rule:
The core brief is the baseline evaluation contract for the slice.

### Stage 2 — Controlled Revision Or Addendum

Revise the evaluator brief only when one of the following happens:

- a blocker is resolved and new testable scope becomes available
- a source-of-truth ambiguity is resolved
- a calculation definition materially changes
- a newly discovered edge case must be included
- the prior brief is now misleading because verified knowledge has changed

Allowed changes:

- clarify source authority
- clarify pass/fail rules
- add newly verified edge cases
- tighten wording to remove ambiguity

Not allowed:

- rewriting the objective just to accommodate a weak build
- silently dropping previously required checks
- moving goalposts without a logged reason

Rule:
Every revision must carry a revision note explaining what changed and why.

### Stage 3 — Independent Retest

After each meaningful build iteration against the slice:

- reuse the current core evaluator brief
- apply any approved addenda
- retest prior failures
- retest protected behaviours
- test newly unblocked scope

Rule:
Independent retest is not a brand-new evaluation framework. It is a rerun against the current governed evaluation contract.

### Stage 4 — Convergence / Regression Decision

When the slice appears ready:

- run an independent retest
- include previously failed cases
- include regression-sensitive checks
- issue a convergence verdict
- issue a regression-protection verdict if appropriate

Rule:
No slice is promoted on Build Agent confidence alone.

---

## Brief Strategy

### What Stays Stable

- recovery slice identity
- evaluation objective
- core success criteria
- independence requirement

### What May Evolve

- source authority notes
- evidence references
- newly confirmed edge cases
- revised blockers
- retest focus based on previous failures

---

## Naming Convention

For each slice, use:

- `*_evaluation_brief_v1.md` for the initial core brief
- `*_evaluation_brief_v2.md` only when the core brief itself needs revision
- `*_evaluation_addendum_01.md` for narrow supplements
- `*_independent_retest_01.md` for retest instructions
- `*_convergence_eval.md` for convergence decision packs

Prefer addenda over full version bumps when the core brief still stands.

---

## Decision Rule For Revisions

Use this rule:

```text
If the evaluation objective is unchanged and only scope clarity improved,
issue an addendum.

If verified knowledge materially changes what the evaluator must judge,
issue a revised brief.

If the build only changes implementation while the governed target is unchanged,
reuse the existing brief and run retest.
```

---

## WS1 Example Application

For WS1 source-of-truth recovery:

- before the SLA field diagnostic returns: evaluation is blocked
- after diagnostics and business-definition clarification: create the first core evaluator brief
- after each build fix: run independent retest against that core brief plus any addendum
- before promotion: run convergence / regression decision pack

---

## Governance Rule

This is the programme-default lifecycle for evaluator briefs.

Do not replace it with ad hoc per-iteration evaluation styles unless a decision log entry explicitly approves an exception.
