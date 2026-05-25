# Programme Charter — NOVA KPI Engine Recovery & Trust Restoration

## Programme Intent

Restore trust in NOVA KPI reporting by establishing a governed, testable, independently verifiable KPI architecture whose outputs can be treated as operational evidence.

This programme is not a bug-fix sweep. It is a convergence programme across:

- behavioural/system correctness
- source-of-truth governance
- evidence integrity
- reproducibility of calculations
- confidence restoration for operational decision-making

---

## Problem Statement

Current KPI outputs inside NOVA are not yet trustworthy enough to support leadership visibility or operational decisions without caveat. Known concerns include:

- calculations that may be incorrect, inconsistent, or context-sensitive
- unclear data lineage between Jira, persistence, snapshots, automation, and reporting
- drift in source-of-truth boundaries
- KPI values that may not match Jira reality
- degraded confidence in the reporting layer and the evidence it presents

All existing KPI logic is to be treated as untrusted until verified.

---

## Programme Objective

Create a KPI recovery framework that can:

1. define every KPI in governed terms
2. identify its authoritative source boundary
3. make its calculation reproducible and explainable
4. validate its output independently against runtime evidence
5. protect verified behaviour from regression before scope expansion

---

## In Scope

- Jira source-of-truth validation
- SQL persistence validation
- snapshot integrity
- SLA breach logic
- tier mapping consistency
- request type classification
- time-window correctness
- deduplication logic
- backlog calculation correctness
- RAG calculation correctness
- evidence/report consistency
- Grafana parity
- n8n workflow correctness
- historical replay validation
- exception handling
- missing and partial data handling

---

## Out of Scope For Initial Recovery Loops

- premature architectural redesign
- performance optimisation before correctness is evidenced
- dashboard polish before KPI trust is restored
- expanding KPI coverage before core KPIs are regression protected
- assuming historical outputs are valid because they were previously published

---

## Operating Principles

- independent evaluation is mandatory
- build-agent validation alone is insufficient
- source-of-truth boundaries must be explicit
- KPI calculations must be reproducible and explainable
- "looks right" is not acceptable evidence
- evidence neutrality must be preserved
- existing logic remains untrusted until verified
- observability and validation come before optimisation
- regression protection is required before programme expansion

---

## Required Definition For Every KPI

Every KPI promoted through this programme must have:

- authoritative source definition
- explicit calculation methodology
- validation strategy
- edge-case handling definition
- regression protection coverage

---

## Defect Classification Model

All gaps found during recovery must be classified into one primary type:

- calculation defect
- data defect
- workflow defect
- source-of-truth ambiguity
- presentation/reporting defect

Secondary impacts may be logged, but the primary classification must remain explicit.

---

## Recommended Convergence Order

The recovery order should minimise false confidence and stop trust leakage at the source:

1. source-of-truth definition and KPI inventory
2. lineage and observability mapping
3. highest-risk KPI calculation validation
4. SQL persistence and snapshot integrity
5. workflow correctness across ingestion and transformation
6. reporting parity across NOVA, evidence packs, and Grafana
7. frozen regression baselines and replay validation
8. controlled expansion to lower-risk KPI domains

---

## Critical KPI Prioritisation

Priority should be based on operational decision impact, likelihood of drift, and auditability risk.

### P0

- backlog volume
- SLA breach count and breach rate
- RAG status outputs used in leadership reporting
- open request counts by tier
- aged work / ageing buckets

### P1

- request type distribution
- throughput / closures
- reopen and deduplication-sensitive counts
- snapshot-to-report parity metrics

### P2

- derived trend summaries
- presentation-layer aggregates
- convenience rollups not used directly for operational intervention

---

## Initial Workstreams

- WS1: Source of truth governance
- WS2: Calculation validation
- WS3: SQL and snapshot integrity
- WS4: n8n workflow integrity
- WS5: Grafana and reporting parity
- WS6: Evidence-pack and reporting consistency

---

## Convergence Exit Objective

The initial programme objective is met when critical KPIs are:

- source-defined
- reproducible
- independently validated
- regression protected
- explainable to operational stakeholders without hidden logic or interpretive ambiguity

---

## Immediate Next Steps

1. complete the discovery artefacts for inventory, lineage, and failure logging
2. identify P0 KPIs and assign authoritative source candidates
3. define first validation packs for source-of-truth and calculation recovery
4. freeze no KPI as trusted until independent evaluation passes
