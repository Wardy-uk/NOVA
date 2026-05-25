# Account Setup / Office Changes — Convergence Package

STATUS: ACTIVE — CONVERGENCE CYCLE INITIATED

## Domain

Account Setup / Office Changes — the third domain in the NOVA Attractor Programme, and the first expansion domain beyond the two originally protected domains.

## Objective

Converge conversational intake behaviour for customer requests relating to login/access, user management, permissions, and office/branch structure changes. This is the first domain to require bounded conversational disambiguation behaviour.

---

## Convergence Artefacts

| Artefact | Location | Status |
|----------|----------|--------|
| Behavioural Specification | `spec/account_setup_behavioural_spec.md` | Complete |
| Evaluation Standard | `spec/account_setup_evaluation_standard.md` | Complete |
| Holdout Scenarios | `spec/holdouts/account_setup_holdouts.md` | Complete (14 scenarios) |
| Protected Behaviour Definitions | `spec/account_setup_protected_behaviours.md` | Complete (10 behaviours) |
| Ambiguity & Collision Scenarios | `spec/account_setup_ambiguity_collisions.md` | Complete (13 scenarios, 5 collision classes) |
| Clarification Strategy Rules | `spec/account_setup_clarification_strategy.md` | Complete |
| Regression Considerations | `spec/account_setup_regression_considerations.md` | Complete (5 risk categories) |

---

## Key Architectural Constraint

**No category-picker UX patterns.** Clarification behaviour must:
- remain conversational
- ask at most one clarification question
- preserve conversational flow
- avoid exposing hidden taxonomy
- avoid forcing the customer to classify their issue

---

## What's New in This Domain

### Bounded Conversational Disambiguation

This is the first domain to formally introduce disambiguation as a behavioural primitive. Previous domains (Website Design, Property / Listing Issues) resolved ambiguity through detection ordering, not customer-facing questions.

Account Setup introduces scenarios where the system must ask the customer a clarifying question to determine the correct domain — but this question must remain invisible as a routing mechanism.

The rules governing this behaviour are defined in `account_setup_clarification_strategy.md` and evaluated via criteria D1-D6 in `account_setup_evaluation_standard.md`.

### Security-Sensitive Fast Track

This is the first domain with a category of requests that must bypass normal intake flow. User removal and access revocation carry implicit security weight and must be fast-tracked with minimal follow-up. This pattern doesn't exist in Website Design or Property / Listing Issues.

---

## Scope Boundaries

### In Scope
- Login/password issues
- New user creation and user removal
- Permission and access problems
- Office/branch additions, closures, merges
- Account-level configuration changes
- Cross-domain disambiguation for ambiguous access complaints

### Out of Scope
- Website content displaying wrong office info (→ Website Design)
- Lead routing to wrong office (→ Integration, future domain)
- Office data wrong in reports (→ Data/Reporting, future domain)
- Property listings for closed offices (→ Property / Listing Issues)

---

## Protected Domains Under Regression Watch

| Domain | Holdout Suite | Risk Level |
|--------|--------------|------------|
| Website Design / Content Changes | Frozen (2026-05-19) | LOW — minimal vocabulary overlap, primary risk is "office on website" misroute |
| Property / Listing Issues | Frozen (2026-05-19) | VERY LOW — almost no vocabulary overlap, primary risk is three-way collision with office context |

---

## Disambiguation Summary

### When It Applies
Only when the customer's opening message has genuinely ambiguous cross-domain signals and no strong single-domain signal is present.

### Maximum Depth
One question. Hard limit.

### Fallback
Route to operationally safe default, note ambiguity in request summary for support agent.

### What Must NOT Happen
- Second disambiguation question
- Category picker (explicit or disguised)
- System/platform picker
- Routing logic exposure
- Classification terminology in customer-facing text

---

## Convergence Success Criteria

1. Account-related requests are handled conversationally with no category picker
2. Disambiguation stays bounded (one question max) and invisible to customers
3. Security-sensitive requests (user removal, access revocation) are fast-tracked
4. All 14 holdout scenarios pass evaluation
5. All 6 disambiguation criteria (D1-D6) pass
6. Website Design frozen holdout suite passes (no regression)
7. Property / Listing Issues frozen holdout suite passes (no regression)
8. Disambiguation does not leak into previously clean routing scenarios
9. Shared behaviours (opening message preservation, conversational continuity, hidden taxonomy, frustration handling) remain stable across all three domains
10. Operational summaries are useful enough that support agents don't need to restart discovery

---

## Convergence Process

This domain follows the standard loop defined in `spec/orchestration/convergence_loop_operating_process.md`:

1. ~~Define behavioural specification~~ ✓
2. ~~Define evaluation standard~~ ✓
3. ~~Create holdout scenarios~~ ✓
4. ~~Create convergence package~~ ✓ (this document)
5. Update programme tracker
6. Build iteration
7. Evaluate observable behaviour
8. Convert evaluator gaps into behavioural routing
9. Run hardening/blocker iterations
10. Run regression protection evaluation
11. Archive protected convergence
12. Move to next domain (Template / Email Editor)

---

## Next Step

Update the programme tracker (`spec/orchestration/programme_tracker.md`) to register this domain as active in convergence, then initiate the first build iteration.
