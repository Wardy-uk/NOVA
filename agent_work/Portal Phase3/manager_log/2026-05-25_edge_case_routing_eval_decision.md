# Manager Log — 2026-05-25 Edge-Case Routing Eval Decision

## Decision

Edge-case routing sensitivity hardening is:

- NOT CONVERGED

One more small build slice is required.

## Why This Remains Small

The evaluator findings are tightly bounded to three local routing defects:

1. `NT-XXXXX is not fixed` follow-up handling is inconsistent across ticket numbers
2. letters precedence overcorrects and steals website-primary requests
3. a protected website control case still misroutes to property when `property` appears in website context

This is still precedence/pattern hardening, not a new routing domain.

## Required Fixes

1. **Make `is not fixed` follow-up deterministic**

- the follow-up path must not depend on ticket number quirks
- representative ticket refs should all behave consistently

2. **Add a letters precedence guard**

- letters should win only when correspondence is clearly the primary request
- website-primary requests with incidental letters mention must remain website

3. **Repair website-vs-property wording disambiguation**

- `property images on my website` should remain website when the issue is clearly about the site experience rather than a portal listing

## Non-Blocking Observation

- the complaint holdout still misses category metadata in one multi-incident case, but the behavioural response remains complaint-appropriate, so this does not belong in this routing slice

## Next Step

Create and activate a final hardening build brief limited to:

- stable `is not fixed` follow-up routing
- letters-precedence guardrails
- website-over-property protection for the named wording pattern
