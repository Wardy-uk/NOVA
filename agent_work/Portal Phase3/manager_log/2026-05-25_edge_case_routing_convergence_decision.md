# Manager Log — 2026-05-25 Edge-Case Routing Convergence Decision

## Decision

Edge-case routing sensitivity hardening is marked:

- CONVERGED

It is not yet marked:

- REGRESSION PROTECTED

## Basis For Decision

The evaluator report confirms:

- `NT-XXXXX is not fixed` now routes to follow-up consistently across multiple ticket numbers and verb variants
- website-primary requests with incidental letters mention remain website
- `property images on my website` now remains website instead of property
- protected complaint, follow-up, website, property, and letters controls remain stable
- no internal routing jargon leaks to the customer

This satisfies the behavioural objective of the slice.

## Deferred Non-Blocking Items

1. Letters-primary requests that contain the literal word `website` as incidental context can still route to website
2. Broader mixed-intent cleanup for letters vs website remains future polish, not part of this slice
3. Shared-config consolidation remains structural follow-on work

## Separate Infrastructure Observation

The evaluator also observed an unrelated issue:

- `/api/portal/widget/identify` is unreachable in OIDC auth mode due to Express route ordering and auth interception

This is not part of the routing-hardening slice and should be tracked separately if prioritised.

## Lifecycle Impact

- Edge-case routing sensitivity hardening moved from Evaluating to Converged Pending Protection
- No further build slice is required for this local routing objective
