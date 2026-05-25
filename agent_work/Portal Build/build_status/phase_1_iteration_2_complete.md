# Phase 1 Iteration 2 Build Status

## Behaviours Improved

- Portal chat now progresses more reliably after visible category and subcategory selections.
  - Added deterministic matching for the category/subcategory button labels shown to customers, so the chat can advance even when LLM classification is unavailable or uncertain.
- Portal chat now gives a clearer next state when a customer agrees to handoff.
  - If the flow has already offered ticket creation and the customer replies with a clear "yes", the session now creates a ticket immediately instead of looping in chat.
- Portal chat now avoids silent stalls on message failure.
  - If the message post fails or the API returns an error, the customer sees an assistant message explaining that chat could not continue and suggesting the portal form as a fallback.
- Ticket detail retrieval is more resilient for tickets created through the portal.
  - Ticket detail, comments, attachments, and status history can now fall back to live Jira retrieval when the cache has not caught up yet, as long as the ticket is associated with the same portal organisation through a form submission or chat handoff.
- Commenting and attachment actions are less likely to dead-end immediately after portal-created tickets.
  - Portal association can now authorise comment uploads and attachment access before cache-based ownership data has fully appeared.
- Chat confirmation no longer attempts the spurious extra "NOOP" ticket creation path.
  - This removes an unnecessary operational side path during confirmation.

## Known Remaining Limitations

- Ticket list visibility is still primarily cache-driven and domain-driven.
  - This iteration improves detail access for portal-associated tickets, but it does not redesign the list-query source or broader organisation-matching strategy.
- Live Jira fallback currently focuses on detail retrieval, comments, attachments, and history.
  - It does not add new list hydration or broader cross-org reconciliation behaviour.
- Chat still depends on the existing stage model and thresholds.
  - This iteration improves progression and dead-end handling, but it does not replace the underlying conversational orchestration.
- Full bundled build verification is still blocked by an existing workspace build/config issue outside this change slice.
  - `npm run build` failed in the existing environment with Vite/esbuild config resolution and access errors before a full app build could complete.

## Assumptions Made

- A ticket explicitly created by the same portal organisation should remain accessible in the portal even if Jira cache sync lags behind.
- A direct affirmative reply after the portal offers ticket creation should be treated as permission to create the ticket immediately.
- Matching customer-visible category/subcategory button labels exactly is preferable to re-asking the same question when chat classification is unavailable or ambiguous.
- Showing a plain fallback assistant message on chat transport failure is better than leaving the customer with no visible response.

## Areas Still Likely Needing Evaluator Review

- Customer flow from ticket list into detail/history for both:
  - older cache-backed tickets
  - newly created portal tickets before and after cache sync
- Chat flow after the very first message, especially:
  - category button selection
  - subcategory button selection
  - explicit "yes" replies after ticket-creation offers
  - frustration/escalation language that should trigger handoff
- Behaviour when live Jira data is reachable but cache data is partial or stale.
- Portal comment and attachment behaviour on newly created tickets in the short window before cache refresh.
- Customer clarity when chat transport fails and the portal shows the new fallback assistant message.

## Verification Performed

- `npx tsc -p tsconfig.server.json --noEmit`
- `npx tsc -p tsconfig.json --noEmit`

## Verification Not Fully Completed

- `npm run build`
  - blocked by existing environment/build issues in the workspace before full bundle verification completed
