# Portal Phase3 Slice Spec — Edge-Case Routing Sensitivity Hardening

## Feature

- Name: Edge-case routing sensitivity hardening
- Phase: Portal Phase3
- User-facing area: Portal conversational routing

## Purpose

Address two customer-visible routing misses that were explicitly logged as non-blocking after earlier convergence:

1. Mixed `letters` + `website` wording can let website precedence win over the intended letters path
2. Follow-up phrasing `NT-XXXXX is not fixed` without `still` remains sensitivity-prone

These do not justify reopening the larger deterministic routing or follow-up domains, but they are worth a focused polish pass.

## Behavioural Objective

The portal should handle these two obvious edge-case phrasings in the intuitively correct way, without regressing already protected behaviour.

## Scope

In scope:

- Mixed letters/correspondence requests that mention website detail incidentally
- Follow-up requests using `ticket is not fixed` phrasing without `still`
- Local precedence/pattern changes needed to make those routes reliable

Out of scope:

- Broad redesign of letters or website routing
- Broad follow-up phrasing expansion beyond the named miss
- Shared-config consolidation
- General conversational cleanup across unrelated domains

## Guardrails

- Preserve protected Req 1A category coverage
- Preserve protected follow-up continuity, complaint handling, website, and property paths
- Do not expose internal routing mechanics or implementation terms
- Keep the fix local and explicit rather than turning it into a general rework of the intent cascade

## Deferred Follow-On Work

- Shared-config protection/consolidation
- Broader follow-up lexical coverage beyond the named phrase
- Wider mixed-intent routing cleanup if later evidence justifies it
