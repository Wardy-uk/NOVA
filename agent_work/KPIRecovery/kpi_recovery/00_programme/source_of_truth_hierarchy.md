# Source Of Truth Hierarchy

## Purpose

This document defines how source-of-truth decisions are made during KPI recovery.

It does not assume the current implementation is correct. It defines the governance order used to verify and recover KPI integrity.

---

## Hierarchy Principle

A KPI may rely on multiple systems, but each field and each derived outcome must still have an authoritative boundary.

No KPI may be called trusted if its source hierarchy is ambiguous.

---

## Default Hierarchy

### Level 1: Operational System Of Record

Authoritative when the value represents the business reality being measured.

Default candidate:

- Jira for issue state, status transitions, issue metadata, timestamps, and workflow-visible ticket attributes unless an exception is explicitly documented

Rule:
If Jira defines the operational fact, downstream systems may cache or transform it but do not replace its authority.

### Level 2: Controlled Persistence Layer

Authoritative only for:

- normalised historical copies
- replayable state capture
- performance-oriented query models
- governed transformation outputs where the transformation is defined and validated

Default candidate:

- SQL persistence used by NOVA

Rule:
SQL is not automatically source-of-truth merely because the dashboard reads from it.

### Level 3: Snapshot Layer

Authoritative only for point-in-time evidence if:

- the snapshot boundary is explicit
- snapshot completeness is proven
- replayability is preserved
- generation timing is known

Rule:
Snapshots are evidence containers, not source-of-truth substitutes.

### Level 4: Workflow / Automation State

Examples:

- n8n execution state
- intermediate transformation state
- automation cache values

Rule:
Workflow state is never authoritative for business truth unless an explicit exception is approved and documented.

### Level 5: Presentation / Reporting Layers

Examples:

- NOVA dashboard
- evidence packs
- Grafana panels

Rule:
Presentation layers are consumers of truth, not sources of truth.

---

## Field-Level Source Declaration Requirement

Every KPI definition must identify:

- the primary authoritative source for each contributing field
- any secondary supporting sources
- the precedence rule when sources conflict
- the reconciliation method
- known latency or freshness caveats

---

## Conflict Resolution Rules

If two systems disagree:

1. check whether the systems are intended to represent the same fact
2. identify the declared authority for that fact
3. determine whether the mismatch is caused by ingestion, persistence, calculation, or presentation
4. log the mismatch without silently choosing the more convenient number

---

## Exceptions

Any KPI or field that does not follow the default hierarchy must have:

- a written exception record
- business justification
- validation approach
- owner approval
- regression protection coverage

---

## Recovery Rule

Until a KPI's source hierarchy is written, reviewed, and evidenced, the KPI remains untrusted.
