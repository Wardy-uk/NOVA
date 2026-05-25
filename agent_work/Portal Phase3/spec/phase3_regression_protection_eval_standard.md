# Portal Phase3 Regression Protection Evaluation Standard

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name: Portal Phase3 regression protection bundle
- Phase: Portal Phase3
- User-facing area: Portal intake behaviours converged during this phase

## Target Domains

- Req 1A — Missing intake category completion
- Reopened / follow-up ticket continuity
- Complaint / escalation operational behaviour

## Core Outcomes

- Outcome 1: Newly converged domains continue to work through the real runtime path.
- Outcome 2: The domains do not materially regress each other or previously protected portal behaviours.
- Outcome 3: Customer-visible behaviour remains coherent, operationally useful, and free of taxonomy leakage.

## Behavioural Checks

- A user can access the four Req 1A categories through the portal intake surface.
- A user can complete canonical follow-up continuity journeys without losing referenced-ticket context or being pushed into generic intake.
- A user can complete canonical complaint/escalation journeys without losing complaint context or being softened into ordinary intake.
- A user cannot see internal routing labels, project keys, queue names, confidence language, or implementation jargon.
- The system should preserve raw customer context and avoid unnecessary repetition across all three domains.

## Guardrails

- Must preserve: website/property protected behaviours, Req 1A category coverage, follow-up continuity, complaint-aware behaviour, and taxonomy protection.
- Must not regress: category availability, context preservation, summary usefulness, and customer-safe wording.
- Out of scope: unrelated product areas and future-domain work not included in Phase 3 protection.

## Evidence To Collect

- UI evidence: category availability, follow-up summary behaviour, complaint summary behaviour, and non-regression of protected paths
- API evidence: category/runtime responses where observable
- CLI evidence: none required unless runtime logs are explicitly part of accepted evaluation
