# Complaint / Escalation Evaluation Standard

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name: Complaint / escalation operational behaviour
- Phase: Portal Phase3
- User-facing area: Portal conversational intake and complaint handling

## Core Outcomes

- Outcome 1: A customer making a clear complaint or asking for escalation experiences a complaint-aware path rather than generic intake handling.
- Outcome 2: The portal acknowledges dissatisfaction safely without leaking internal operational mechanics.
- Outcome 3: The resulting request remains operationally useful and appropriately escalatory.

## Behavioural Checks

- A user can express complaint or escalation intent and receive behaviour that recognises that intent.
- A user can continue without being dropped into a generic new-request path that ignores the complaint context.
- A user cannot see internal routing labels, project keys, queue names, confidence language, or implementation jargon.
- The system should preserve raw complaint detail and avoid asking the user to restate core dissatisfaction unnecessarily.
- The system should remain coherent when the complaint is emotional, brief, mixed with operational detail, or asks for escalation explicitly.

## Guardrails

- Must preserve: Req 1A category coverage, follow-up continuity, website/property protected behaviours, and taxonomy protection.
- Must not regress: normal intake paths, customer-safe wording, and complaint detail preservation.
- Out of scope: dashboarding/reporting, broad routing redesign, and unrelated configuration cleanup.

## Evidence To Collect

- UI evidence: complaint/escalation conversation path and summary behaviour
- API evidence: any observable submission/routing outcome tied to the complaint path
- CLI evidence: none required unless runtime logs are explicitly part of the evaluation path
