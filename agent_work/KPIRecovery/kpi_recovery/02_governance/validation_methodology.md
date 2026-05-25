# Validation Methodology

## Purpose

This document defines how KPI recovery validation should be performed.

---

## Validation Objectives

- prove the KPI matches its authoritative source and rules
- distinguish defect class before build routing
- preserve independent evaluation
- make outcomes reproducible

---

## Validation Stages

### 1. Definition Validation

Confirm:

- KPI meaning is clear
- source-of-truth is declared
- formula is documented

### 2. Lineage Validation

Confirm:

- origin fields are known
- transformations are identified
- persistence and snapshot boundaries are understood

### 3. Calculation Validation

Confirm:

- formula implementation matches written rule
- time-window boundaries are correct
- inclusion/exclusion rules are stable

### 4. Parity Validation

Compare:

- Jira vs SQL
- SQL vs snapshot
- snapshot vs NOVA
- NOVA vs Grafana
- dashboard vs evidence exports

### 5. Independent Evaluation

A separate evaluator validates observable outputs and evidence behaviour without relying on build self-certification.

### 6. Regression Validation

Frozen baselines or replay packs confirm the KPI remains stable after fixes.

---

## Validation Methods

- record-level reconciliations
- query-output comparisons
- sampled manual reconstruction from source
- historical replay
- edge-case scenario packs
- cross-surface parity checks

---

## Independent Evaluation Strategy

Independent evaluation is mandatory for any KPI moving toward trusted status.

The evaluator should:

- use the declared source and validation artefacts
- assess reported behaviour and reproducibility
- verify parity claims
- avoid reading implementation diffs or build-status notes that bias judgement

The evaluator should not:

- accept build assertions as proof
- infer correctness from a single dashboard state
- approve trust without evidence continuity

---

## Validation Exit States

- `FAILED`
- `AMBIGUOUS`
- `PASSED WITH NON-BLOCKING GAPS`
- `PASSED`

Only `PASSED` or `PASSED WITH NON-BLOCKING GAPS` can feed promotion review, and only if regression protection exists.
