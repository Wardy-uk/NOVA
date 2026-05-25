# Single Shared Config Protection Evaluation Standard

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name: Single shared config protection
- Phase: Portal Phase3
- User-facing area: Portal new-request form and conversational field collection

## Core Outcomes

- Outcome 1: Client and server field behaviour derive from one canonical source.
- Outcome 2: No previously protected or converged portal behaviour regresses.
- Outcome 3: The drift condition identified in the gap analysis is materially removed.

## Behavioural Checks

- A user still sees the expected conditional fields for representative category/subcategory choices.
- A user can still progress protected/converged paths without field mismatches.
- The system should not show evidence of client/server disagreement for the targeted field-config-driven behaviour.

## Guardrails

- Must preserve: Req 1A category coverage, follow-up continuity, complaint-aware behaviour, deterministic routing behaviour, website/property protected paths, and taxonomy protection.
- Must not regress: form field visibility, summary usefulness, or conversational field collection for representative protected paths.
- Out of scope: unrelated shared-config deduplication and routing redesign.

## Evidence To Collect

- UI evidence: representative subcategory selections still show expected fields
- API/runtime evidence: representative chat/form paths still collect the expected information
- Structural evidence: one canonical source is now used for the field config
