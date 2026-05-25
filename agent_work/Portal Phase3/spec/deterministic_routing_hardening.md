# Portal Phase3 Slice Spec — Deterministic Routing Hardening

## Feature

- Name: Deterministic routing hardening
- Phase: Portal Phase3
- User-facing area: Portal intake routing and resulting submission behaviour

## Purpose

Close the remaining deterministic-routing gaps identified in the 24 May 2026 gap analysis.

The analysis recorded that deterministic routing was still only partial and highlighted a small set of routing cases that should behave predictably rather than depending on generic ambiguity handling.

This slice exists to converge the customer-visible and operational consequences of those routing gaps without broadening into a general portal-routing redesign.

## Behavioural Objective

Requests in the targeted deterministic cases should behave predictably and consistently, with routing outcomes that do not depend on avoidable ambiguity or hidden misclassification.

## Scope

In scope:

- The specific targeted routing cases implicated by the deterministic-routing gap analysis
- Immediate routing behaviour and resulting request/submission outcome where observable
- Deterministic handling where the path is intentionally meant to bypass generic ambiguity

Out of scope:

- Broad redesign of all portal routing logic
- Shared client/server config consolidation as a standalone goal
- General conversational detection cleanup for unrelated categories
- New dashboarding/reporting work

## Guardrails

- Preserve all currently protected domains
- Do not expose internal project keys, routing teams, or implementation language to customers
- Do not reopen complaint or follow-up convergence unless a direct regression is found
- Keep deterministic routing targeted and explicit rather than using this slice to smuggle in broad taxonomy or routing cleanup

## Deferred Follow-On Work

- Shared-config protection/consolidation if still needed
- Wider routing-table cleanup beyond the targeted deterministic paths
- Other unresolved structural items outside the targeted routing cases
