# Manager Log — 2026-05-25 Deterministic Routing Convergence Decision

## Decision

Deterministic routing hardening is marked:

- CONVERGED

It is not yet marked:

- REGRESSION PROTECTED

## Basis For Decision

The evaluator report confirms:

- email template requests route deterministically to the intended path across repeated and varied phrasings
- letters/correspondence requests route to the new `letters` category with correct subcategory inference
- targeted deterministic cases remain coherent through multi-turn runtime behaviour
- protected complaint, follow-up, website, and property paths remain stable
- no internal routing terms or mechanics leak to the customer

This satisfies the behavioural objective of the slice.

## Non-Blocking Follow-On Items

1. Mixed letters + website detail can still let website disambiguation win over letters in edge cases
2. `NT-XXXXX is not fixed` without `still` remains LLM-sensitive in follow-up detection
3. Shared-config duplication remains a maintenance concern

These do not compromise convergence of the deterministic-routing model and should not reopen this slice.

## Lifecycle Impact

- Deterministic routing hardening moved from Evaluating to Converged Pending Protection
- No further build slice is required for this domain’s current convergence objective
