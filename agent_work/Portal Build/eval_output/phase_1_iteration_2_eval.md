# Phase 1 Iteration 2 Evaluation

## Overall Result
Converged: No

The portal is now reachable and the core ticket surfaces are substantially improved. Ticket list, ticket detail, and status timeline views consistently use customer-facing status wording in the tested tickets. A fresh support request also now progresses visibly from first message to confirmation and ticket creation.

However, convergence is not yet confirmed because one customer-visible path still leaks non-customer status wording: the support conversation sidebar shows `handed_off` after a request is submitted. This creates a status-language inconsistency inside the same portal journey and means at least one common customer-facing path still exposes wording that does not match the curated customer model.

## Improvements Observed

- The portal is reachable at `http://127.0.0.1:5173/portal`.
- Ticket detail is reachable from both Home and My Tickets.
- Ticket history is now understandable and visible through a clear `Status Timeline` section.
- Tested tickets use customer-facing statuses in the list and detail views:
  - `Reviewed`
  - `Awaiting Your Response`
  - `Resolved`
  - `Submitted`
- The `Awaiting Your Response` path is especially clear. The ticket detail, explanatory text, and timeline all make it obvious that support needs customer action.
- A fresh request now visibly progresses after the customer sends an initial message:
  - initial free-text message
  - guided category selection
  - request summary for confirmation
  - submission confirmation with ticket ID
  - created ticket detail view with `Submitted` status and timeline
- A partial conversation can be ended without breaking the UI. The portal returns to a stable neutral state with a clear `Get help` prompt.

## Remaining Behavioural Gaps

- The support conversation sidebar exposes `handed_off` as a visible conversation state after request submission. This does not match the customer-facing status model and reads like internal workflow terminology.
- The conversation sidebar also mixes status styles (`Resolved`, `Active`, `handed_off`) within the same customer-visible area, which weakens consistency and may confuse customers about whether they are looking at ticket status, chat state, or internal routing state.
- Because this raw-style wording is visible on a common customer-facing path, the portal still fails the original convergence bar even though the main ticket list/detail/history views are much improved.

## Scenario Results

- Scenario: Existing ticket with reviewed status (`COD-101`)
  Observed behaviour: My Tickets showed `Reviewed`. Ticket detail was reachable. The progress strip and status timeline used customer-facing wording only. The explanatory text read `We've assessed this and know what's needed`.
  Expected behaviour: Ticket detail/history is reachable and understandable, using customer-safe status wording.
  Severity: Pass
  Evidence captured: `phase_1_iteration_2_tickets_list.png`; `phase_1_iteration_2_ticket_cod101.png`; `phase_1_iteration_2_ticket_cod101_lower.png`
  Would support need to restart intake manually? No

- Scenario: Waiting on customer (`COD-102`)
  Observed behaviour: My Tickets showed `Awaiting Your Response`. Ticket detail repeated the same status, with explanatory text `We need information or action from you`. The timeline preserved the transition from `Reviewed` to `In Progress` to `Awaiting Your Response`.
  Expected behaviour: The portal should make it clear that support needs something from the customer.
  Severity: Pass
  Evidence captured: `phase_1_iteration_2_tickets_list.png`; `phase_1_iteration_2_ticket_cod102.png`
  Would support need to restart intake manually? No

- Scenario: Resolved ticket (`COD-103`)
  Observed behaviour: My Tickets showed `Resolved` in customer-facing language.
  Expected behaviour: Resolved tickets should use curated customer-safe wording in standard list views.
  Severity: Pass
  Evidence captured: `phase_1_iteration_2_tickets_list.png`; `phase_1_iteration_2_tickets_after_cod104.png`
  Would support need to restart intake manually? No

- Scenario: Fresh exploratory customer journey from `Get help`
  Observed behaviour: The user could start a conversation, send an initial message, receive a guided category question, choose `My Account`, provide more detail, review a structured request summary, and submit the request. The portal then showed `Request Submitted` and created ticket `COD-104`.
  Expected behaviour: The support journey should visibly progress after the customer sends an initial message and provide a stable confirmation state.
  Severity: Pass
  Evidence captured: `phase_1_iteration_2_get_help.png`; `phase_1_iteration_2_after_initial_message.png`; `phase_1_iteration_2_after_category_selection.png`; `phase_1_iteration_2_after_followup_details.png`; `phase_1_iteration_2_after_submit_request.png`
  Would support need to restart intake manually? No

- Scenario: Newly created ticket after fresh request (`COD-104`)
  Observed behaviour: `View Ticket` opened a new ticket with customer-facing status `Submitted`, a visible progress strip, a status timeline entry, and a support confirmation comment: `Your request has been received in the Codex test workspace.`
  Expected behaviour: After submission, the customer should see an understandable initial ticket state rather than a dead end.
  Severity: Pass
  Evidence captured: `phase_1_iteration_2_after_submit_request.png`; `phase_1_iteration_2_ticket_cod104.png`; `phase_1_iteration_2_tickets_after_cod104.png`
  Would support need to restart intake manually? No

- Scenario: Partial or stalled flow
  Observed behaviour: A new conversation could be started and then ended without breaking the UI. The user was returned to a stable neutral `How can we help?` screen with a `Get help` call to action. No visible broken state or empty error shell appeared.
  Expected behaviour: Partial flows should fail gracefully.
  Severity: Pass with caveat
  Evidence captured: `phase_1_iteration_2_partial_flow_end.png`
  Would support need to restart intake manually? No

- Scenario: Customer-facing wording consistency across the broader support journey
  Observed behaviour: Ticket list, detail, and timeline were consistent, but the conversation sidebar exposed `handed_off` after submission. The same sidebar also mixed `Resolved`, `Active`, and `handed_off`.
  Expected behaviour: Customer-visible progress wording should remain consistent anywhere the customer sees ticket or support journey state.
  Severity: High
  Evidence captured: `phase_1_iteration_2_partial_flow_end.png`
  Would support need to restart intake manually? No

## Cross-Cutting Issues

- The main ticket surfaces now behave like a customer-facing system rather than a raw internal workflow view.
- The strongest remaining issue is not in the ticket table or timeline, but in the adjacent support-conversation journey.
- Because the customer can move from `Get help` into a sidebar that exposes `handed_off`, the portal still has a common path where status wording is not fully customer-safe.
- No tested surface leaked raw Jira labels such as `Triaged`, `Categorised`, `Escalated`, `Waiting for Customer`, or `With Third Party`.
- The seeded data did not expose an observable unknown-status or third-party-dependent ticket, so those holdouts could not be directly re-verified in this pass.

## Recommended Behavioural Feedback

- Keep the current ticket list/detail/history behaviour; it is much clearer and now broadly understandable.
- Ensure the support conversation journey uses the same customer-facing progress language as the ticket surfaces.
- Remove or replace `handed_off` from customer-visible conversation state.
- Keep the explicit submission confirmation and ticket creation pattern; it gives customers a clear sense that progress has occurred.

## Conversational Transcript

- Portal login screen offered `Use Codex Test User`.
- After entering the portal, Home showed recent tickets with visible statuses `Reviewed` and `Awaiting Your Response`.
- `COD-101` detail showed:
  - status `Reviewed`
  - explanation `We've assessed this and know what's needed`
  - status timeline entries `Submitted` then `Reviewed`
- `COD-102` detail showed:
  - status `Awaiting Your Response`
  - explanation `We need information or action from you`
  - status timeline entries `Submitted` -> `Reviewed` -> `In Progress` -> `Awaiting Your Response`
- Fresh request transcript:
  - Customer: `The branch mailbox is not receiving password reset emails. Please help restore access before tomorrow morning.`
  - Portal: `Which area does this relate to?`
  - Options shown: `My Website`, `My Account`, `Billing & Contracts`, `Something Else`
  - Customer selected: `My Account`
  - Portal: `Got it — My Account. Please describe what should be happening and what is happening instead. If relevant, include the page URL or any error message you can see.`
  - Customer: `The user clicks Forgot password on the login page, but the reset email never arrives in branch.mailbox@example.com. No error is shown after submit.`
  - Portal presented a `Request Summary` with editable fields and `Submit request`
  - After submit: `Request Submitted` and `Your ticket COD-104 has been created. Our team will review it shortly.`

## Observable Dead Ends

- No dead end remained in the fresh request flow after the first message; the portal kept advancing the customer.
- The partial flow did not crash or strand the customer.
- The remaining dead end is interpretive rather than navigational: `handed_off` is visible in the conversation sidebar and is not self-explanatory for a normal customer.

## Confirmation States

- Ticket detail confirmation states observed:
  - `We've assessed this and know what's needed`
  - `We need information or action from you`
  - `We've received your request`
- Fresh request confirmation states observed:
  - structured `Request Summary`
  - `Request Submitted`
  - ticket creation confirmation for `COD-104`

## Operationally Useful Ticket Artifacts

- Existing tickets observed:
  - `COD-101` — `Reviewed`
  - `COD-102` — `Awaiting Your Response`
  - `COD-103` — `Resolved`
- New ticket created during evaluation:
  - `COD-104`
  - subject: `[Portal] account request: The user clicks Forgot password on the login page, but the reset email never arrives in branch`
  - status on ticket detail: `Submitted`
  - confirmation comment: `Your request has been received in the Codex test workspace.`
