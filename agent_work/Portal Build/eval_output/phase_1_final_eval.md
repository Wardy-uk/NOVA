# Phase 1 Final Evaluation

## Overall Result
Converged: No

## Summary

The customer-facing status wording is materially improved on the tested ticket surfaces. In this pass, Home, My Tickets, and the reachable ticket detail view all used customer-safe wording such as `Reviewed`, `Awaiting Your Response`, and `Resolved`. No raw internal operational terms were visible on those tested surfaces, and the previously noted `handed_off` wording was not reproduced anywhere I could reach in this pass.

However, the full support journey is still not behaviourally coherent enough to accept convergence. The conversational intake did advance from the first customer message into category selection, but the next step was inconsistent: selecting `My Account` did not visibly progress the conversation, and the next assistant reply later framed the issue as `Got it — My Website`. In the same pass, I did not reach the request summary, submission confirmation, or created-ticket confirmation state. Because the intake path can misroute or stall before confirmation, I cannot confirm an end-to-end coherent customer journey from intake through tracking.

## Improvements Confirmed

- Home screen recent tickets showed customer-facing statuses only:
  - `COD-101` -> `Reviewed`
  - `COD-102` -> `Awaiting Your Response`
- My Tickets list used the same customer-facing wording consistently and also showed `COD-103` as `Resolved`.
- The reachable ticket detail view for `COD-101` remained customer-safe and understandable, with:
  - current status `Reviewed`
  - progress strip using `Submitted`, `Reviewed`, `In Progress`, `Resolved`, `Closed`
  - a readable `Status Timeline`
  - plain-language explanatory copy: `We've assessed this and know what's needed`
- No tested customer-facing screen exposed raw internal wording such as `Triaged`, `Categorised`, `Escalated`, `Waiting for Customer`, `Pending Customer`, `With Third Party`, or `handed_off`.
- The support assistant opening screen is clean and customer-safe:
  - `How can we help you today? Describe your issue, question, or request.`

## Remaining Behavioural Gaps

- The guided intake path did not remain coherent after category selection. In this pass:
  - the first message advanced correctly to `Which area does this relate to?`
  - selecting `My Account` did not visibly move the flow forward
  - after the next customer message, the assistant responded with `Got it — My Website`, which did not match the attempted category choice
- I did not reach a request summary, submission confirmation, or created-ticket confirmation state in the current pass, so the customer journey from intake through tracking is not yet fully trustworthy.
- Third-party-dependent and unknown-status holdouts were not directly observable in the currently visible seeded tickets, so those two holdouts could not be re-confirmed through the live UI in this pass.

## Scenario Results

- Scenario: Existing ticket with customer-safe reviewed status (`COD-101`)
  - Observed behaviour: Home and ticket detail showed `Reviewed`. The detail view remained readable and consistent, including a clear progress strip and status timeline.
  - Expected behaviour: Existing tickets should use curated customer-facing wording consistently across list and detail surfaces.
  - Severity: Pass
  - Would support need to restart intake manually? No

- Scenario: Waiting on customer (`COD-102`)
  - Observed behaviour: Home and My Tickets showed `Awaiting Your Response`. No raw internal waiting-state wording was visible.
  - Expected behaviour: The portal should make it clear that support needs something from the customer.
  - Severity: Pass
  - Would support need to restart intake manually? No

- Scenario: Resolved ticket (`COD-103`)
  - Observed behaviour: My Tickets showed `Resolved` in customer-facing language.
  - Expected behaviour: Resolved items should use curated customer-safe wording in standard ticket views.
  - Severity: Pass
  - Would support need to restart intake manually? No

- Scenario: Holdout re-test for unfamiliar internal state wording
  - Observed behaviour: No raw internal terms were visible on the tested customer-facing screens. The portal presented customer-safe wording instead.
  - Expected behaviour: Customers should not see unfamiliar internal operational language.
  - Severity: Pass on observed surfaces
  - Would support need to restart intake manually? No

- Scenario: Holdout re-test for third-party dependency
  - Observed behaviour: No directly observable third-party-dependent ticket was reachable in the visible seeded data during this pass.
  - Expected behaviour: A third-party-dependent ticket should read as `Awaiting Third Party`.
  - Severity: Not fully re-verified
  - Would support need to restart intake manually? Unknown

- Scenario: Holdout re-test for unknown status fallback
  - Observed behaviour: No directly observable unknown-status ticket was reachable in the visible seeded data during this pass.
  - Expected behaviour: Unknown statuses should fail safely to a customer-safe fallback rather than leaking raw internal wording.
  - Severity: Not fully re-verified
  - Would support need to restart intake manually? Unknown

- Scenario: Conversational intake progression
  - Observed behaviour: The first customer message progressed correctly to category selection. After that, the journey became inconsistent: selecting `My Account` did not visibly advance, and the later assistant response said `Got it — My Website`. I did not reach request summary, submission confirmation, or new-ticket confirmation in this pass.
  - Expected behaviour: The support assistant should keep progressing coherently from first message to category choice, structured follow-up, confirmation, and trackable ticket state.
  - Severity: High
  - Would support need to restart intake manually? Yes

- Scenario: Customer-facing status wording across the full journey
  - Observed behaviour: Ticket status wording was consistent and customer-safe across Home, My Tickets, and the tested ticket detail. The support-assistant journey, however, did not yet feel coherent enough to trust end to end because the category handling became inconsistent before confirmation.
  - Expected behaviour: The support journey should feel coherent from intake through tracking, without status-language confusion or misleading state changes.
  - Severity: High
  - Would support need to restart intake manually? Yes

## Convergence Assessment

This slice should not yet be considered behaviourally converged within the agreed tolerances.

The strongest improvement is real: the tested ticket surfaces no longer behave like raw internal workflow views. A normal customer can understand the currently visible ticket states without support jargon, and I did not observe the earlier `handed_off` leak in this pass.

Even so, the convergence bar for this slice is not just better labels on tickets. The requested support journey still needs to feel coherent from intake through tracking. In the current behaviour, the intake flow can reach category selection but does not reliably continue in a way that preserves customer trust. The category mismatch (`My Account` attempt followed by `Got it — My Website`) means the support assistant still gives an inconsistent journey before confirmation is reached. Because I could not complete the current intake path to a stable confirmation state in this pass, the slice remains short of behavioural convergence.

## Recommended Next Action
Another narrow iteration required

## Evidence Captured

- Screenshots:
  - `phase1_landing.png`
  - `phase1_ticket_detail.png`
  - `phase_1_final_home.png`
  - `phase_1_final_tickets.png`
  - `phase_1_final_get_help_start.png`
  - `phase_1_intake_probe_after_1.png`
  - `phase_1_intake_probe_after_category.png`
  - `phase_1_intake_probe_after_2.png`
- Conversational transcript observed in this pass:
  - Customer: `The branch mailbox is not receiving password reset emails. Please help restore access before tomorrow morning.`
  - Assistant: `Which area does this relate to?`
  - Options shown: `My Website`, `My Account`, `Billing & Contracts`, `Something Else`
  - Attempted selection: `My Account`
  - Customer: `The user clicks Forgot password on the login page, but the reset email never arrives in branch.mailbox@example.com. No error is shown after submit.`
  - Assistant: `Got it — My Website. Please describe what should be happening and what is happening instead. If relevant, include the page URL or any error message you can see.`
- Confirmation states observed in this pass:
  - Ticket detail explanation for `COD-101`: `We've assessed this and know what's needed`
  - No fresh request summary or submission confirmation was reached in the current intake pass
