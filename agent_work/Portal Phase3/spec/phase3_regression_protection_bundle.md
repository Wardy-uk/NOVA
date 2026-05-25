# Portal Phase3 Spec — Regression Protection Bundle

## Feature

- Name: Portal Phase3 regression protection bundle
- Phase: Portal Phase3
- User-facing area: Portal intake behaviours converged during this phase

## Purpose

Run a deliberate regression-protection pass across the newly converged Phase 3 domains before opening another behavioural front.

Target domains:

- Req 1A — Missing intake category completion
- Reopened / follow-up ticket continuity
- Complaint / escalation operational behaviour

## Behavioural Objective

Confirm that these three domains now hold together as protected customer-visible behaviour through the real portal runtime.

## Scope

In scope:

- real runtime validation of the three converged domains
- regression interaction checks between these domains and previously protected website/property flows
- customer-visible coherence, context preservation, and taxonomy protection

Out of scope:

- new feature work
- dashboarding/reporting
- broad routing redesign
- structural refactor work unless required later by a discovered blocker

## Protection Decision Rule

Each target domain should be assessed independently:

- `Regression Protected` if the behavioural model holds and no critical blocker appears
- `Not Yet Protected` if a critical blocker compromises the protected model

The bundle may produce mixed outcomes if one domain is protected and another is not.

## Guardrails

- Do not reopen converged domains for polish-only issues
- Do not treat dev-environment downstream limitations as automatic blockers unless they invalidate the runtime behaviour under test
- Preserve separation between behavioural evaluation and code inspection
