# Complaint Management Alerting Evaluation Standard

> DO NOT LEAK TO BUILD AGENT if this file includes evaluator-only acceptance details or scoring notes.

## Feature

- Name: Complaint management alerting
- Phase: Portal Phase3
- User-facing area: Complaint submission outcome and downstream operational handling

## Core Outcomes

- Outcome 1: Recognised complaint cases produce a distinguishable operational escalation/alerting outcome.
- Outcome 2: The customer-facing complaint path remains stable and customer-safe.
- Outcome 3: Protected portal behaviours remain stable.

## Behavioural Checks

- A user can complete a complaint path and produce a complaint-specific operational outcome beyond ordinary ticket creation.
- A user cannot see internal queue names, management mechanics, or routing jargon.
- The system should preserve complaint context into the resulting operational artifact.
- The system should not regress follow-up, website, property, or Req 1A behaviours.

## Guardrails

- Must preserve: complaint-aware customer path, protected/converged domains, taxonomy protection.
- Must not regress: complaint context preservation, urgency behaviour, or customer-safe wording.
- Out of scope: dashboarding/reporting and broad management tooling.

## Evidence To Collect

- UI/runtime evidence: complaint journey and resulting summary/submission outcome
- API/operational evidence: observable complaint-specific signal in the resulting ticket or downstream artifact
- CLI evidence: only if needed to inspect the observable runtime result
