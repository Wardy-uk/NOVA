# Req 1A Evaluation Standard — Missing Intake Category Completion

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name: Req 1A — Missing intake category completion
- Phase: Portal Phase3
- User-facing area: Portal new request intake

## Core Outcomes

- Outcome 1: A portal user can access all four missing request types through the portal intake surface.
- Outcome 2: Each new request type provides a coherent basic intake path rather than an obviously missing or broken path.
- Outcome 3: Existing converged portal intake behaviour remains stable while the new coverage is added.

## Behavioural Checks

- A user can start a request using Website Security, General Service Request, Reopened / Follow-up, and Complaint / Escalation.
- A user can proceed far enough in each path to observe that the category exists as a supported intake route rather than a dead-end stub.
- A user cannot see internal routing labels, project identifiers, implementation jargon, or taxonomy leakage.
- The system should maintain a coherent portal-new-request experience instead of behaving as if these request types are unsupported.
- The system should preserve already converged portal entry behaviour for previously protected domains.

## Guardrails

- Must preserve: existing website and property protected behaviours, taxonomy protection, and coherent new-request flow.
- Must not regress: existing category availability, known submission flow, conversational trust, and customer-safe wording.
- Out of scope: deeper follow-up continuity, complaint-management routing/alerting, and any later structural hardening not required for this slice.

## Evidence To Collect

- UI evidence: portal intake view showing the four request types and their usable entry paths
- API evidence: request submission or category-loading behaviour where observable through the runtime path
- CLI evidence: none required unless runtime logs are explicitly part of the accepted evaluation path
