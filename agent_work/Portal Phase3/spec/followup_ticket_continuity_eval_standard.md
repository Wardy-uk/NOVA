# Follow-Up Ticket Continuity Evaluation Standard

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name: Reopened / follow-up ticket continuity
- Phase: Portal Phase3
- User-facing area: Portal conversational intake and follow-up handling

## Core Outcomes

- Outcome 1: A customer who references an existing ticket experiences a continuation path rather than a dead-end status lookup.
- Outcome 2: The portal preserves enough recognised context to reduce unnecessary repetition.
- Outcome 3: Existing protected portal behaviour remains stable.

## Behavioural Checks

- A user can reference an existing ticket and receive behaviour that acknowledges a follow-up context.
- A user can continue the journey without being dropped into a generic fresh-intake path that ignores the recognised reference.
- A user cannot see internal routing, project keys, confidence language, or implementation jargon.
- The system should preserve conversational clarity and forward progress after recognised ticket references.
- The system should remain coherent when the customer follow-up message is brief, vague, or mixes status with renewed action.

## Guardrails

- Must preserve: Req 1A category coverage, website/property protected behaviours, and taxonomy protection.
- Must not regress: recognised-ticket handling, customer-safe wording, conversational trust, and existing request flows outside this slice.
- Out of scope: complaint-specific operational handling, unrelated category-detection expansion, and structural refactor work not needed for this slice.

## Evidence To Collect

- UI evidence: portal conversation showing referenced-ticket follow-up handling through the runtime path
- API evidence: any observable lookup/submission behaviour tied to the referenced follow-up path
- CLI evidence: none required unless runtime logs are explicitly part of the evaluation path
