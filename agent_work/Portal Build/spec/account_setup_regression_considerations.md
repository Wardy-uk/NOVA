# Account Setup / Office Changes — Regression Considerations

## Purpose

This document defines how convergence of the Account Setup / Office Changes domain must be validated against the two existing protected domains, and what specific regression risks exist.

---

## Protected Domains Under Regression Watch

| Domain | Protected Since | Holdout Suite |
|--------|----------------|---------------|
| Website Design / Content Changes | 2026-05-19 | `agent_work/plan/workstream1_phase1_convergence.md` |
| Property / Listing Issues | 2026-05-19 | `agent_work/spec/holdouts/property_listing_holdouts.md` |

Both frozen holdout suites must pass on every evaluation iteration during Account Setup convergence.

---

## Regression Risk 1: Website Design Misroute

### Risk
Account Setup introduces "office" and "branch" vocabulary. Customers describing office-related website issues ("the website shows the wrong office address") may be incorrectly captured by Account Setup instead of Website Design.

### Specific Scenarios to Monitor
- "Our website still shows the old office" → must route to Website Design
- "The office page on our site needs updating" → must route to Website Design
- "The address on the website is wrong since we moved" → must route to Website Design

### Detection Rule
If the customer's complaint is about what is **displayed** on their website, it is Website Design regardless of whether the underlying cause is an office change. The display complaint is the actionable request. The office change is context, not the routing signal.

### Regression Test
Re-run Website Design holdout suite. Additionally, introduce 2-3 boundary probes:
1. "Our website shows the old Manchester office" (→ Website)
2. "We moved offices — can you update the website?" (→ Website, with office move context noted)
3. "The office details on the site are outdated" (→ Website)

All must route to Website Design. If any route to Account Setup, this is a regression.

---

## Regression Risk 2: Property / Listing Issues Misroute

### Risk
Very low. Account Setup and Property / Listing Issues have minimal vocabulary overlap. The primary risk is a three-way collision where an office change affects property listings ("properties for the old office are still showing").

### Specific Scenarios to Monitor
- "Properties for the closed office are still live" → Property / Listing Issues (listing visibility is the complaint)
- "The branch that was closed still has listings on Rightmove" → Property / Listing Issues
- "New office properties aren't appearing" → could be Account Setup (office not configured) or Property (listing issue); disambiguation may be needed

### Detection Rule
If the complaint is about specific property listings or portal visibility, it is Property / Listing Issues. If the complaint is about the office/branch not being set up in the system, it is Account Setup. The presence of property-specific vocabulary (listings, Rightmove, Zoopla, photos, floorplans) is a strong Property signal regardless of office context.

### Regression Test
Re-run Property / Listing Issues holdout suite in full. All 10 frozen holdouts must pass unchanged.

---

## Regression Risk 3: Shared Behaviour Degradation

### Risk
Adding Account Setup signals to the classification prompt may cause subtle degradation in shared behaviours that work across all domains.

### Behaviours to Monitor

#### Opening Message Preservation
The addition of Account Setup classification must not cause the LLM to over-focus on classification at the expense of preserving the raw customer message. Test by checking that long, detailed opening messages survive intact in the request summary for ALL domains.

#### Conversational Continuity
The addition of disambiguation behaviour (new for this domain) must not leak into domains that don't need it. Website Design and Property / Listing Issues should not start generating unnecessary clarifying questions where they didn't before.

#### Hidden Taxonomy
The introduction of new internal categories (authentication, authorisation, provisioning, etc.) must not leak into ANY customer-facing response, including responses for non-Account-Setup requests.

#### Frustration Handling
The frustration detection and empathy response pattern must continue working for Website Design and Property / Listing Issues at the same quality level.

### Regression Test
Run the full shared-behaviour regression suite:
- 1 opening message preservation test per domain (3 total)
- 1 conversational continuity test per domain (3 total)
- 1 taxonomy leak test per domain (3 total)
- 1 frustration handling test per domain (3 total)

All 12 must pass.

---

## Regression Risk 4: Disambiguation Leakage into Protected Domains

### Risk
This is the highest-priority regression risk unique to this convergence cycle.

The Account Setup domain introduces bounded disambiguation as a new behavioural primitive. The risk is that the LLM starts applying disambiguation behaviour to Website Design or Property / Listing Issues scenarios that previously routed cleanly without it.

### Specific Scenarios to Monitor
- "Our property isn't showing properly" (Property holdout 1) — must NOT trigger a disambiguation question asking whether this is a property issue or an account issue
- "The content on our page needs updating" (Website) — must NOT trigger a disambiguation question asking whether this is a website issue or an account issue
- "The Rightmove API is broken" (Property holdout 2) — must NOT trigger disambiguation

### Detection Rule
If a scenario that previously resolved without disambiguation now generates a clarifying question, this is a disambiguation leakage regression. The new disambiguation behaviour must be scoped to genuine cross-domain ambiguity for the Account Setup domain, not applied retroactively to scenarios that already route cleanly.

### Regression Test
Run the 3 scenarios above plus Property holdouts 1, 2, 5, and 8 (the most ambiguous ones). None should generate disambiguation questions that weren't present before Account Setup convergence.

---

## Regression Risk 5: Prompt Expansion Side Effects

### Risk
Adding Account Setup domain signals to the LLM classification prompt increases prompt length. Longer prompts may degrade classification accuracy for existing domains, especially for ambiguous scenarios.

### Detection
Compare classification accuracy on the frozen holdout suites before and after Account Setup prompt additions. Any decrease in accuracy on existing domain holdouts signals a prompt expansion side effect.

### Mitigation
If accuracy degrades:
1. First: tighten the Account Setup signal descriptions in the prompt (more concise, stronger discriminators)
2. Second: adjust signal priority ordering (existing protected domains first)
3. Last resort: restructure prompt into a two-stage approach (coarse domain detection → fine sub-classification) — but this is an architectural change that requires explicit approval

---

## Regression Evaluation Cadence

### Every Build Iteration
- Account Setup holdout suite (14 scenarios)
- Website Design frozen holdout suite
- Property / Listing Issues frozen holdout suite (10 scenarios)
- Disambiguation leakage check (3 scenarios minimum)

### At Convergence Milestone (pre-regression-protection)
- Full shared-behaviour regression suite (12 tests)
- Full cross-domain collision suite (scenarios from ambiguity_collisions.md)
- Prompt expansion accuracy comparison
- All frozen holdout suites
- Disambiguation criteria D1-D6 from evaluation standard

### Regression Escalation Rule
Any regression in Website Design or Property / Listing Issues **blocks** Account Setup convergence. The new domain cannot be marked converged if it breaks an old one. This rule is inherited from `workstream1_remaining_intake_expansion.md` and is non-negotiable.

---

## Expected Outcome

Account Setup / Office Changes should be the cleanest expansion domain because:
- lowest collision risk with existing protected domains
- distinct vocabulary (login, password, user, office, branch, access)
- clear entry signals that rarely overlap with property or website language
- the disambiguation behaviour is exercised in low-risk collision scenarios before being needed for higher-risk domains

If regression issues emerge here, they signal a systemic problem with the expansion approach that must be resolved before proceeding to Template/Email, Integration, or Data/Reporting.
