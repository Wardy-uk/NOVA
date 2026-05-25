# Tracker Update Contract

## Purpose
The programme tracker is authoritative orchestration state.

Agents must update it incrementally after:
- build iterations
- evaluation iterations
- convergence decisions
- regression protection decisions

---

## Update Rules

### Build Iterations
Update:
- lifecycle checkboxes
- active convergence cycles
- current state
- known blockers/non-blockers

### Evaluation Iterations
Update:
- evaluation completion state
- convergence status
- blocker classification
- protected behaviour status

### Regression Protection
When regression protection is achieved:
- update protected domains
- update active cycle state
- create archive reference

---

## Blocker Classification

### Critical Blockers
Issues preventing convergence.

### Non-Blocking Improvements
Isolated quality improvements that do not invalidate convergence.

---

## Active Cycle Rules

Only one active lifecycle state per domain.

Examples:
- Building
- Evaluating
- Hardening
- Regression Protected

---

## Preservation Rules

Agents must:
- preserve history
- avoid rewriting unrelated sections
- append artefacts rather than replace
- treat tracker as orchestration state, not documentation

---

## Required Tracker Outputs

Every iteration must include:
- lifecycle transition
- updated active state
- tracker sections modified
- blocker/non-blocker status