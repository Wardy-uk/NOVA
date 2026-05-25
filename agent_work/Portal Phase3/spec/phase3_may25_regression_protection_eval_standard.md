# Phase3 May 25 Regression Protection Evaluation Standard

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name: Phase3 May 25 regression protection bundle
- Phase: Portal Phase3
- User-facing area: Portal domains converged on May 25

## Target Domains

- Deterministic routing hardening
- Edge-case routing sensitivity hardening
- Single shared config protection

## Core Outcomes

- Outcome 1: Newly converged domains continue to work through the real runtime path.
- Outcome 2: These domains do not materially regress each other or earlier protected portal behaviours.
- Outcome 3: Customer-visible coherence and taxonomy protection still hold.

## Behavioural Checks

- A user can complete targeted deterministic routing cases consistently.
- A user can complete the named edge-case routing scenarios correctly.
- A user can still use representative field-config-driven paths with no client/server mismatch symptoms.
- A user cannot see internal routing/configuration mechanics.
- The system should preserve protected complaint, follow-up, website, property, and Req 1A behaviours.

## Guardrails

- Must preserve: earlier protected domains plus deterministic routing, edge-case routing hardening, and single shared config protection.
- Must not regress: routing consistency, field visibility/alignment, summary usefulness, and customer-safe wording.
- Out of scope: complaint management alerting downstream verification and unrelated future work.

## Evidence To Collect

- UI evidence: representative routing and form/chat alignment behaviour
- API/runtime evidence: observable route/category/subcategory behaviour where relevant
- Structural evidence: only as needed to confirm the shared-config protection objective still holds
