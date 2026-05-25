# Portal Phase3 Slice Spec — Reopened / Follow-up Ticket Continuity

## Feature

- Name: Reopened / follow-up ticket continuity
- Phase: Portal Phase3
- User-facing area: Portal conversational intake and follow-up handling

## Purpose

Improve the behavioural path when a customer starts a new portal request by referencing an existing ticket that needs renewed action.

The portal already detects ticket references such as `NT-123` and `NTPJ-456` and can look up existing status. The remaining gap is continuity: the experience currently risks feeling like a status check rather than an intentional follow-up support journey.

## Behavioural Objective

A customer who clearly references an existing ticket should experience a coherent continuation-oriented path that preserves context and helps them move forward without unnecessary repetition.

## Scope

In scope:

- Clear existing-ticket references in the opening request
- Immediate portal behaviour after the reference is recognised
- Continuation-oriented handling instead of passive status-only behaviour
- Preservation of useful existing-ticket context where it improves customer continuity

Out of scope:

- Complaint/escalation workflow design
- Broad conversational detection coverage for all new Req 1A categories
- Deterministic routing redesign across unrelated categories
- Shared client/server config refactor as a standalone goal
- KB governance or dashboard work

## Guardrails

- Preserve already protected website and property behaviours
- Preserve Req 1A intake-category coverage
- Do not expose routing teams, implementation mechanics, or internal taxonomy
- Do not make customers repeat information that the portal has already recognised from the referenced ticket context where continuity can be preserved safely

## Deferred Follow-On Work

- Complaint / escalation operational handling
- Conversational detection refinement for `security`, `general_request`, `followup`, and `complaint`
- Any infrastructure/schema work required for broader protection claims
