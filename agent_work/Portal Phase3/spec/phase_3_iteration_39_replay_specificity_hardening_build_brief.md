# Portal Phase3 Iteration 39 — Build Brief

## Role

You are the Build Agent for Portal Phase3 Iteration 39.

## Slice

Replay specificity hardening

## Goal

Improve first-turn operational usefulness for replay-heavy property, feed, website-account, and integration cases that now route safely but still frame too generically.

## Required Outcome

Improve the first-turn portal response across the following concerns:

### 1. Property visibility specificity

Property-missing / not-showing / wrong-status / listing-count mismatch cases should ask property-specific next questions rather than broad website display/content questions where the domain is already clear.

### 2. Feed and integration specificity

Feed / CRM / API / integration cases should ask the most relevant next operational question for the integration context, rather than drifting into generic property or website framing unless the message truly supports that.

### 3. Website/account clarification quality

When the request already names a website, account, URL, portal, or CRM, the first-turn response should not ask a redundant account/website clarification unless a materially missing routing field remains.

### 4. Context-rich response usefulness

Where the first message already contains enough structured problem detail, the next prompt should ask for the most operationally useful missing field, not just a safe generic clarification.

## Constraints

- preserve the converged fallback-routing protection
- preserve the now-working separation between email marketing and non-email requests
- do not widen into prompt-only broad rewrites
- do not redesign the session or summary-card flow
- do not reopen KB retrieval or auth/login work

## Build Guidance

Optimise for:

- sharper first-turn domain framing
- better next-question relevance
- less redundant clarification
- preserving current routing safety

Do not optimise for:

- broad conversational tone rewrites
- speculative taxonomy redesign
- cross-surface UI changes

## Output

Make the required implementation changes in the codebase.

Write a concise readiness note to:

`agent_work/Portal Phase3/build_status/`

Include:

- what changed
- anything still blocked or uncertain
- whether the slice is ready for evaluation

