# Portal Phase3 Slice Spec — Req 1A Missing Intake Category Completion

## Feature

- Name: Req 1A — Missing intake category completion
- Phase: Portal Phase3
- User-facing area: Portal new request intake

## Purpose

Complete the missing intake coverage portion of Req 1 from the 24 May 2026 portal gap analysis without collapsing deeper behavioural work into the same slice.

The portal currently lacks four request types as intake categories:

- Website Security
- General Service Request
- Reopened / Follow-up
- Complaint / Escalation

This slice exists to make those request types present and usable at the intake-category level.

## Behavioural Objective

A customer using the portal should be able to start a new request under any of the four missing request types without encountering missing-category gaps or obviously incomplete intake coverage.

## Scope

In scope:

- Add the four missing request types as portal intake categories
- Ensure each has basic customer-safe labels and question/template coverage
- Preserve an understandable intake journey for each category
- Preserve existing submission behaviour outside these new categories

Out of scope:

- Original-handler routing or linked follow-up continuity logic
- Complaint-management notification or queue-bypass logic
- Broad routing redesign across all categories
- Shared client/server config consolidation as a standalone refactor
- KB baseline, target, or dashboard work

## Why This Slice Is Intentionally Narrow

Two of the missing categories imply deeper behavioural models:

- Reopened / Follow-up is a continuity problem, not only a taxonomy problem
- Complaint / Escalation is an escalation-governance problem, not only a taxonomy problem

Those deeper behaviours are deferred so the intake coverage gap can be closed quickly and evaluated in one controlled pass.

## Guardrails

- Preserve already protected website and property conversational behaviour
- Do not reintroduce customer-visible internal taxonomy
- Do not make the new categories depend on hidden evaluator assumptions
- Do not frame this slice as completion of the deeper follow-up or complaint workflows

## Deferred Follow-On Slices

- Req 1B — Reopened / follow-up continuity behaviour
- Req 1C — Complaint / escalation operational behaviour
- Req 1D — Deterministic routing hardening where required
- Req 1E — Structural config protection if drift blocks reliable delivery
