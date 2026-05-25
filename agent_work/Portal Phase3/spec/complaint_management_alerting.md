# Portal Phase3 Slice Spec — Complaint Management Alerting

## Feature

- Name: Complaint management alerting
- Phase: Portal Phase3
- User-facing area: Complaint submission outcome and downstream operational handling

## Purpose

Close the remaining complaint-management gap from the 24 May 2026 analysis.

Complaint intake is now behaviourally converged for customers. The remaining issue is operational: complaint cases still need a real management-aware signal or alerting outcome beyond ordinary ticket creation.

## Behavioural Objective

A clear complaint should not only feel complaint-aware to the customer; it should also generate a meaningfully escalated operational outcome for the business side.

## Scope

In scope:

- complaint cases that have already been recognised by the converged complaint path
- management-aware signalling, flagging, or alerting behaviour tied to those complaint cases
- observable submission/runtime outcome for complaint tickets

Out of scope:

- complaint-recognition redesign
- full dashboarding/reporting
- broad queue architecture redesign
- general SLA tooling

## Guardrails

- Preserve the converged complaint customer path
- Preserve protected follow-up, website, property, and Req 1A behaviours
- Do not expose internal management or routing mechanics to customers
- Do not broaden this into generic workflow redesign

## Deferred Follow-On Work

- complaint dashboards and trend reporting
- richer SLA/governance tooling
- broader management workflow redesign beyond the minimal alerting outcome
