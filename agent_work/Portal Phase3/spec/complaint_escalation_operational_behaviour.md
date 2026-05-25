# Portal Phase3 Slice Spec — Complaint / Escalation Operational Behaviour

## Feature

- Name: Complaint / escalation operational behaviour
- Phase: Portal Phase3
- User-facing area: Portal conversational intake and complaint handling

## Purpose

Make complaint / escalation a real behavioural path in the portal rather than only a category label.

Req 1A added `Complaint / Escalation` as an intake category. The remaining gap from the 24 May 2026 analysis is operational: the portal should recognise clear complaint intent, respond safely and appropriately, and produce an outcome that is meaningfully escalatory rather than indistinguishable from ordinary intake.

## Behavioural Objective

A customer who is clearly making a complaint or asking for escalation should experience a complaint-aware portal path that:

- acknowledges dissatisfaction or escalation intent appropriately
- avoids forcing the customer into a generic unsupported experience
- preserves the customer’s raw complaint context
- produces a usable escalated operational outcome without exposing internal routing mechanics

## Scope

In scope:

- Clear complaint language in the opening request
- Clear escalation requests in the opening request
- Immediate portal behaviour after complaint/escalation recognition
- Complaint-aware summary and submission behaviour where observable

Out of scope:

- Full management dashboarding or reporting
- Broad queue architecture redesign beyond what this path needs
- General service-request routing redesign
- Shared config refactor as a standalone goal
- KB governance or deflection-threshold work

## Guardrails

- Preserve already protected website and property behaviours
- Preserve Req 1A intake-category coverage
- Preserve converged follow-up continuity behaviour
- Do not expose internal routing teams, project keys, implementation language, or operational taxonomy
- Do not discard or over-summarise customer complaint detail

## Deferred Follow-On Work

- Dashboard/reporting around complaint volumes and SLA trends
- Broader management tooling beyond the complaint intake outcome
- Conversational detection refinement for other non-complaint Req 1A categories
