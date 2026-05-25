# Deterministic Routing Hardening Evaluation Standard

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name: Deterministic routing hardening
- Phase: Portal Phase3
- User-facing area: Portal intake routing and resulting submission behaviour

## Core Outcomes

- Outcome 1: The targeted routing cases route predictably through the live portal.
- Outcome 2: The customer-visible path remains coherent and free of internal routing leakage.
- Outcome 3: Protected Phase 3 behaviours remain stable while deterministic routing is hardened.

## Behavioural Checks

- A user can progress targeted deterministic cases without ambiguity-driven misrouting.
- A user cannot see internal routing labels, project keys, queue names, or implementation jargon.
- The system should behave consistently for repeated deterministic test cases.
- The system should not regress protected follow-up, complaint, website, or property behaviours.

## Guardrails

- Must preserve: Req 1A category coverage, follow-up continuity, complaint-aware behaviour, website/property protected paths, and taxonomy protection.
- Must not regress: customer-safe wording, summary usefulness, and operational coherence.
- Out of scope: unrelated routing cleanup and structural refactor work.

## Evidence To Collect

- UI evidence: customer-visible routing journey and summary behaviour for targeted cases
- API evidence: observable submission/routing results where available
- CLI evidence: none required unless runtime logs are explicitly part of accepted evaluation
