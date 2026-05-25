# Portal Phase3 Anchor

## Source Anchor

This phase is anchored to:

- `spec/portal-gap-analysis-progress-2026-05-24.md`

Original source:

- `docs/portal-gap-analysis-progress-2026-05-24.md`

## Why A New Phase Exists

The 24 May 2026 gap analysis shows that the portal has progressed materially, but several behavioural and operational gaps remain unresolved:

- missing intake categories for some real request types
- duplicated category field configuration across client and server
- incomplete deterministic routing coverage
- incomplete reopened / follow-up ticket handling
- no portal-native management alerting path for complaints
- incomplete deflection-governance tooling around KB targets

These gaps are not one build. They are a queue of separate convergence domains or sub-domains.

## Phase Framing

Portal Phase3 should not be treated as a broad "finish the portal" effort.

It should follow the Attractor Programme discipline:

- pick one user-visible behavioural outcome
- keep the slice small enough for one evaluator pass
- preserve already-converged portal behaviour
- avoid leaking evaluation logic into build briefs

## Recommended First Slice

Recommended first slice:

- reopened / follow-up ticket continuity

Reasoning:

- it is already partially implemented
- it is clearly user-visible
- it has operational importance
- it can be behaviourally evaluated through the runtime path
- it is small enough to avoid collapsing multiple portal gaps into one phase

## Explicit Non-Goals For The First Slice

- expanding all remaining intake categories in one build
- full client/server config consolidation as a standalone refactor
- full complaint-management workflow redesign
- full KB governance and dashboarding programme

Those may become later slices, but they should not be bundled into the first convergence loop.
