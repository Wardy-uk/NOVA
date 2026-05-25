# Regression Protection Strategy

## Purpose

This document defines how recovered KPI trust is protected before expansion.

---

## Core Rule

A KPI is not protected because it passed once.

Regression protection requires a repeatable mechanism that can detect silent drift.

---

## Protection Components

### 1. Frozen Baselines

For each promoted KPI family, freeze:

- source extract reference
- expected output
- time boundary
- formula version or definition reference

### 2. Replay Packs

Maintain replayable cases for:

- normal cases
- edge cases
- missing/partial data
- duplicate scenarios
- boundary timestamp scenarios

### 3. Cross-Surface Parity Checks

Protect against divergence between:

- source system
- persistence
- snapshot
- NOVA
- Grafana
- evidence exports

### 4. Change Gate

No KPI logic change should be treated as complete until relevant replay and parity checks pass.

---

## Regression Blockers

Any of the following prevent promotion or continued protected status:

- source boundary changed without governance update
- formula changed without validation rerun
- replay baseline no longer matches and root cause is unknown
- parity drift appears between reporting surfaces
- missing or partial data is handled differently without approval

---

## Minimum Regression Artefacts

- frozen baseline reference
- replay script or replay method
- expected outcome record
- regression report
- promotion log entry
