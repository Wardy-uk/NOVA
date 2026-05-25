# Iteration 12 — Complaint Management Alerting

## What Changed

Three operational signals added when a portal complaint ticket is created:

1. **Jira label `complaint`** — applied to the ticket at creation time via `portal-jira.ts` labels support. Makes complaint tickets filterable in Jira dashboards and JQL (`labels = complaint`).

2. **Escalation log entry** — complaint tickets are logged to `escalation_log` with type `complaint_portal`, reason code `customer_complaint`, and complaint context (category, subcategory, account). Integrates with existing escalation reporting in `EscalationReportView.tsx`.

3. **SSE event `ticket:complaint_alert`** — broadcast to connected portal SSE clients on submission. Carries category, subcategory, account, priority, and submitter name. Enables real-time awareness for any listening management tooling.

## Files Modified

- `src/server/services/portal-intake.ts` — added escalation log + SSE broadcast for complaint submissions, added labels array for complaint tickets
- `src/server/services/portal-jira.ts` — added `labels` parameter to `createTicket`
- `src/server/services/escalation-log-service.ts` — added `complaint_portal` to escalation type union

## Customer Path

Unchanged. No customer-facing text, flow, or UI modified. All signals are internal/operational.

## Blocked / Uncertain

Nothing blocked. The Jira label feature depends on the target project not having a label restriction scheme (standard Jira allows freeform labels by default).

## Ready for Evaluation

Yes. Complaint tickets created via portal will now carry all three distinguishing signals. Evaluable by submitting a complaint through the portal and verifying the Jira label, escalation log entry, and SSE event.
