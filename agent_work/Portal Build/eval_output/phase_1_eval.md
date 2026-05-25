# Phase 1 Evaluation Gap Analysis

## Overall Result
Converged: No

## Summary

I re-ran the evaluation against `http://127.0.0.1:5173/` and the portal is now substantially closer to the target behaviour.

Observed improvements:

- The Codex test-user path entered the portal successfully.
- The customer-visible ticket list rendered seeded ticket data.
- Customer-facing statuses were visible on the list surface, including `Reviewed` and `Awaiting Your Response`.
- No raw internal Jira status terms were visible in the reachable customer-facing list view.

Observed remaining gaps:

- I could not reach a functioning ticket detail or status-history view. Clicking the visible ticket card did not transition the UI into a detail surface.
- Because detail/history did not open, cross-surface consistency for the same ticket could not be verified.
- The help flow now opens a `Support Assistant` screen, but after entering a message and triggering `Send message`, the UI did not progress into follow-up questioning, review, confirmation, or any visible acknowledgement.
- Observable portal event requests returned `501 Not Implemented`, and the assistant remained visually static after message send.

This means the Phase 1 outcome is improved but still not converged. The ticket-list surface now shows safe customer-facing statuses, but the required detail/history validation and usable help flow are still incomplete.

Evidence captured:
- Landing / ticket-list screenshot: [phase1_landing.png](/C:/Users/NickW/Claude/windows%20automation/daypilot/agent_work/eval_output/phase1_landing.png)
- Post-entry screenshot: [phase1_after_sign_in.png](/C:/Users/NickW/Claude/windows%20automation/daypilot/agent_work/eval_output/phase1_after_sign_in.png)
- Ticket-detail attempt screenshot: [phase1_ticket_detail.png](/C:/Users/NickW/Claude/windows%20automation/daypilot/agent_work/eval_output/phase1_ticket_detail.png)
- Help-flow screenshots: [phase1_after_first_input.png](/C:/Users/NickW/Claude/windows%20automation/daypilot/agent_work/eval_output/phase1_after_first_input.png), [phase1_after_second_input.png](/C:/Users/NickW/Claude/windows%20automation/daypilot/agent_work/eval_output/phase1_after_second_input.png)
- Browser evidence bundle: [phase1_browser_report.json](/C:/Users/NickW/Claude/windows%20automation/daypilot/agent_work/eval_output/phase1_browser_report.json)

## Scenario Results

### Scenario
Portal landing state

- Observed behaviour: The portal opened directly into a signed-in session for `codex.portal.test@nurtur.tech` in `Codex Test Organisation`. The shell showed `Home`, `My Tickets`, `Knowledge Base`, a `Get help` call to action, and a seeded `Recent Tickets` section.
- Expected behaviour: The evaluator should be able to reach the normal customer-visible portal shell.
- Severity: Low
- Evidence captured: Landing screenshot and browser evidence bundle.
- Would support need to restart intake manually? No

### Scenario
Ticket list status translation

- Observed behaviour: The ticket list showed two seeded tickets:
  - `COD-101` with `Reviewed`
  - `COD-102` with `Awaiting Your Response`
  No raw internal terms such as `Triaged`, `Categorised`, `Escalated`, `Waiting for Customer`, `Pending Customer`, or `With Third Party` were visible.
- Expected behaviour: Customer-facing list surfaces should use the curated status language rather than raw internal Jira wording.
- Severity: Low
- Evidence captured: Landing screenshot and browser evidence bundle.
- Would support need to restart intake manually? No

### Scenario
Ticket detail and status history

- Observed behaviour: Clicking the visible seeded ticket card did not transition the UI into a ticket detail or history surface. The page remained on the home/list view.
- Expected behaviour: Ticket detail and history should be reachable so the same ticket’s customer-facing status wording can be validated beyond the list surface.
- Severity: Critical
- Evidence captured: Ticket-detail attempt screenshot plus unchanged URL/text in the browser evidence bundle.
- Would support need to restart intake manually? Yes

### Scenario
Holdout status scenarios: unfamiliar internal state, waiting on customer, third-party dependency, unknown status

- Observed behaviour: Only partial validation was possible. The visible list already demonstrated a safe customer-facing status for a waiting-on-customer-style branch state via `Awaiting Your Response`. However, because detail/history did not open, the evaluator could not verify additional holdout cases or confirm consistent translation beyond the list surface.
- Expected behaviour: Holdout scenarios should be testable across the reachable customer-visible surfaces, especially detail/history where status context is often repeated.
- Severity: High
- Evidence captured: Ticket list showed customer-safe labels, but no detail/history surface became available.
- Would support need to restart intake manually? Yes

### Scenario
First Get Help interaction

- Observed behaviour: The `Get help` control was visible and opened a `Support Assistant` screen.
- Expected behaviour: The customer should be able to start the intake journey from the portal shell.
- Severity: Low
- Evidence captured: Transition from the portal shell to the `Support Assistant` screen.
- Would support need to restart intake manually? No

### Scenario
Follow-up questioning

- Observed behaviour: The assistant screen showed a prompt: `How can we help you today? Describe your issue, question, or request.` A textarea was available, and a send action with aria-label `Send message` could be triggered. After sending a message, no visible follow-up question or acknowledgement appeared.
- Expected behaviour: After the first customer message, the system should progress into follow-up questioning or otherwise visibly advance the intake flow.
- Severity: High
- Evidence captured: Help-flow screenshots and browser evidence bundle showing the send action without visible progression.
- Would support need to restart intake manually? Yes

### Scenario
Review/summary or confirmation state

- Observed behaviour: No review, summary, confirmation, or created-request state appeared during the observed assistant flow.
- Expected behaviour: The customer should eventually reach a visible review or confirmation state, or at minimum receive a stable acknowledgement that the flow has advanced.
- Severity: High
- Evidence captured: Assistant screen remained visually static after message send.
- Would support need to restart intake manually? Yes

### Scenario
Failed or partial-failure states

- Observed behaviour: The portal shell remained stable and usable despite partial backend limitations. However, observable event-stream requests to `/api/portal/events?token=codex-test-token` returned `501 Not Implemented`, and the assistant UI did not explain the apparent stall after message send.
- Expected behaviour: If real-time or downstream assistant behaviour is unavailable, the customer should receive a clear degraded-state explanation rather than a silent stall.
- Severity: Medium
- Evidence captured: Browser evidence bundle showed repeated `501` responses for the portal events endpoint.
- Would support need to restart intake manually? Yes

### Scenario
Whether support would need to restart intake manually

- Observed behaviour: Support would still likely need to intervene because the help flow does not visibly progress after message send and the ticket detail/history surface is not reachable.
- Expected behaviour: A customer should be able to continue independently through ticket review and/or request intake.
- Severity: High
- Evidence captured: Static assistant screen after send and non-opening ticket detail interaction.
- Would support need to restart intake manually? Yes

## Cross-Cutting Gaps

- Customer-facing status wording is now visible and safe on the ticket-list surface.
- Detail/history behaviour remains the main blocker for Phase 1 convergence, because consistency across surfaces could not be verified.
- The assistant entry point exists, but the observable intake journey still stalls before follow-up or confirmation.
- Partial backend limitations are now better tolerated on entry than before, but the UI still needs clearer customer-visible behaviour when downstream functionality is unavailable.

## Recommended Feedback To Build Agent

- Preserve the current ticket-list behaviour that shows curated customer-facing statuses instead of internal wording.
- Ensure clicking a visible ticket opens a usable detail/history surface so the same status can be validated across views.
- Ensure the assistant visibly advances after the first sent message into follow-up, acknowledgement, review, or confirmation states.
- If assistant or event-stream behaviour is unavailable, show a clear customer-facing degraded-state message instead of leaving the conversation visually static.
- Keep the list, detail, and history wording aligned once the detail surface is reachable.
