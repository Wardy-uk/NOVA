# KPI Governance Model

## Purpose

This document defines how KPI ownership, change control, validation, and promotion decisions are governed during recovery.

---

## Governance Objectives

- stop uncontrolled KPI logic drift
- make source-of-truth ownership explicit
- separate business definition from implementation detail
- require evidence before promotion
- preserve independent evaluation

---

## Governance Layers

### 1. Business Definition Layer

Defines:

- what the KPI means
- why it exists
- who consumes it
- what decisions it supports

### 2. Source Governance Layer

Defines:

- authoritative source for each contributing field
- precedence rules
- latency / freshness expectations
- permitted transformations

### 3. Calculation Governance Layer

Defines:

- formula
- thresholds
- filters
- grouping rules
- time-window rules
- edge-case handling

### 4. Validation Governance Layer

Defines:

- how the KPI is checked
- what evidence is required
- what constitutes pass, fail, or ambiguity

### 5. Promotion Governance Layer

Defines:

- when a KPI may move from untrusted to trusted
- who approves promotion
- what regression protection must exist first

---

## Minimum Governance Record For Each KPI

- KPI name
- owner
- business purpose
- authoritative source hierarchy
- formula / query rule summary
- edge-case rules
- validation pack reference
- independent evaluation reference
- regression baseline reference
- trust state

---

## Decision Rights

### Human Sponsor / Programme Owner

- confirms business meaning
- accepts or rejects trust promotion
- approves material source-of-truth exceptions

### Manager Agent

- creates the recovery structure
- maintains governance artefacts
- routes work into phase-sized build briefs
- interprets evaluator findings into neutral next steps

### Build Agent

- implements only scoped corrective work
- does not self-certify trust

### Evaluator Agent

- validates behaviour independently
- does not inspect implementation structure to justify pass/fail

---

## Trust Promotion Rule

A KPI may only move to `TRUSTED` when:

- business definition is stable
- source hierarchy is explicit
- calculation is written
- evidence is reproducible
- independent evaluation passes
- regression protection is frozen
