# Evaluator Brief Template

Use this template for KPI Recovery slices after the slice is ready for genuine independent evaluation.

Follow the lifecycle in:

`04_eval/evaluation_standards/evaluation_lifecycle_standard.md`

---

## Metadata

- Slice:
- Workstream:
- Brief Type:
  - Core evaluator brief
  - Addendum
  - Independent retest
  - Convergence evaluation
- Version / ID:
- Date:
- Author:
- Status:

---

## 1. Evaluation Purpose

State what this evaluation is intended to prove.

---

## 2. Slice Scope

List the KPI behaviours, evidence paths, or governed outputs in scope.

List what is explicitly out of scope.

---

## 3. Preconditions

List the conditions that must be true before this evaluation is valid.

Examples:

- source-of-truth defined
- diagnostics complete
- required build iteration deployed
- relevant data snapshot available

If these are not satisfied, the evaluator should return:

`EVALUATION BLOCKED`

---

## 4. Evidence Inputs Allowed

List what the evaluator may use.

Examples:

- specified report outputs
- controlled source extracts
- replay datasets
- dashboard or API outputs
- approved validation artefacts

List what the evaluator must not use.

Examples:

- source code
- implementation diffs
- build-status notes containing implementation detail

---

## 5. Evaluation Questions

List the exact questions the evaluator should answer.

Examples:

- does the KPI output match the declared source boundary?
- does the reported value match the governed calculation?
- is parity maintained across the required surfaces?
- are edge cases handled according to the declared rule?

---

## 6. Required Checks

List the checks the evaluator must run.

Keep them observable and evidence-oriented.

---

## 7. Protected Behaviours Or Protected Evidence States

List what must not regress.

---

## 8. Pass / Fail / Ambiguous Rules

### Pass

Describe what counts as pass.

### Fail

Describe what counts as fail.

### Ambiguous

Describe when the evaluator must return ambiguous instead of guessing.

---

## 9. Open Questions / Known Blockers

List unresolved questions that still affect interpretation.

---

## 10. Required Output Format

The evaluator should return:

- overall verdict
- checks passed / failed
- blockers
- non-blocking gaps
- evidence references used
- recommended next action

---

## 11. Revision Note

Complete this section only if this file is a revision or addendum.

- What changed:
- Why it changed:
- What remained stable:
