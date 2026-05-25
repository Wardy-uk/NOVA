# Failure And Risk Assessment

## Purpose

This document captures the failure modes and programme risks associated with the NOVA KPI recovery effort.

It should be treated as a live operational risk register, not a one-time summary.

---

## Executive Risk Position

Current KPI reporting is a critical operational risk because it influences visibility and decision-making while its evidence chain is not yet sufficiently trusted.

The highest risk is not a single wrong number. It is decision-making on the basis of evidence whose provenance, transformation, and reproducibility are unclear.

---

## Primary Failure Classes

### 1. Calculation Defects

Definition:
The KPI formula, aggregation rule, time-window rule, or breach logic is wrong or inconsistently applied.

Examples:

- incorrect SLA breach determination
- wrong backlog inclusion/exclusion rules
- inconsistent RAG thresholds across surfaces
- time-window rounding or cutoff defects

Risk:
Operational reporting appears precise while being mathematically wrong.

### 2. Data Defects

Definition:
The underlying data entering NOVA is incomplete, stale, malformed, duplicated, or missing key context.

Examples:

- Jira sync gaps
- partial snapshots
- duplicate records
- stale persistence state

Risk:
Correct calculations still yield incorrect results because the input set is invalid.

### 3. Workflow Defects

Definition:
Automation or orchestration paths alter, omit, double-process, or mis-sequence records.

Examples:

- n8n branch mismatch
- retry duplication
- failed partial upserts
- snapshot generation triggered against incomplete persistence

Risk:
Trust degrades because numbers change based on process timing rather than business reality.

### 4. Source-Of-Truth Ambiguity

Definition:
The programme cannot state which system or state should be treated as authoritative for a KPI or a KPI component.

Examples:

- Jira is source for issue state, but SQL is treated as source in practice
- Grafana and NOVA use different interpretations of "open backlog"
- manual overrides exist but are undocumented

Risk:
Teams can justify conflicting numbers without resolving the underlying evidence boundary.

### 5. Presentation / Reporting Defects

Definition:
The correct underlying number is displayed, labelled, filtered, summarised, or contextualised incorrectly.

Examples:

- dashboard title mismatches query logic
- RAG state presented without its rule basis
- evidence packs use a different cutoff timestamp from the screen

Risk:
Trust is lost even when the backend calculation is correct.

---

## Programme-Level Risk Areas

| Risk Area | Why It Matters | Initial Severity |
|-----------|----------------|------------------|
| False trust from superficially plausible numbers | Leadership may act on incorrect evidence | Critical |
| Undocumented source-of-truth drift | Competing versions of "truth" prevent convergence | Critical |
| Incomplete lineage between Jira, SQL, snapshots, and reports | Root cause cannot be isolated quickly | High |
| Hidden time-window defects | Daily/weekly reporting may silently vary | High |
| Workflow retry / dedupe behaviour | Counts can inflate or collapse non-deterministically | High |
| Snapshot non-atomicity | Report may represent no real point in time | High |
| Reporting parity gaps across NOVA and Grafana | Users lose confidence even when one surface is correct | High |
| Historical replay not possible | Cannot prove whether a fix really restores correctness | High |
| Premature architecture redesign | Programme loses clarity before truth is established | Medium |
| Overfitting to visible examples | Hidden defects survive and reappear later | High |

---

## Known Architectural Risk Areas

- Jira extraction and field interpretation
- SQL persistence rules and update semantics
- snapshot generation timing and completeness
- SLA clock construction and pause/resume semantics
- tier mapping and classification dependencies
- request type classification logic
- deduplication criteria and identity rules
- backlog inclusion rules
- RAG derivation and threshold ownership
- report assembly and evidence export formatting
- Grafana query parity
- n8n branching, retries, and partial failure handling
- historical replay capability and fixture fidelity

---

## Risk Prioritisation Heuristic

Prioritise defects for investigation using this order:

1. can this mislead operational decisions?
2. can this create conflicting truths between systems?
3. can this not be explained or reproduced?
4. can this contaminate other downstream KPIs?
5. can this recur silently without regression detection?

---

## Initial Risk Response Strategy

- do not accept any KPI as trusted on visual inspection alone
- establish source boundaries before formula debates
- separate data errors from calculation errors
- freeze critical KPI definitions before broad build changes
- require independent retest before promoting any KPI set
- add replay and regression protection before scope expansion
