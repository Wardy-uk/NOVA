# Assumptions Register

## Purpose

This register captures working assumptions that the recovery programme is currently relying on.

Every assumption must eventually be:

- verified
- revised
- or retired

---

## Initial Assumptions

| ID | Assumption | Risk If False | Status |
|----|------------|---------------|--------|
| A-001 | Jira is the primary operational source for core issue truth | KPI source hierarchy may need redesign | OPEN |
| A-002 | SQL persistence is intended as a governed query model rather than a new business source | Reporting may currently rely on drifted truth | OPEN |
| A-003 | Snapshot generation is meant to represent a coherent point in time | Historical evidence may be invalid | OPEN |
| A-004 | Grafana and NOVA are expected to represent materially the same KPI definitions | Surface parity may be structurally impossible today | OPEN |
| A-005 | n8n workflows materially influence KPI data or timing | Workflow integrity is a core recovery dependency | OPEN |

---

## Governance Rule

Build work should not silently convert an unresolved assumption into accepted fact.
