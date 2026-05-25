# Portal Phase3 Spec — May 25 Regression Protection Bundle

## Feature

- Name: Phase3 May 25 regression protection bundle
- Phase: Portal Phase3
- User-facing area: Portal behaviours and structural protections converged on May 25

## Purpose

Run a deliberate regression-protection pass across the domains that converged on May 25 before opening more build work.

Target domains:

- Deterministic routing hardening
- Edge-case routing sensitivity hardening
- Single shared config protection

## Behavioural Objective

Confirm that these three domains now hold together as protected behaviour/structure through the real portal runtime.

## Scope

In scope:

- runtime validation of deterministic routing behaviour
- runtime validation of edge-case routing fixes
- runtime plus minimal structural validation of shared field-config protection
- regression interaction checks against previously protected and converged domains

Out of scope:

- complaint management alerting runtime unblock
- new feature work
- dashboarding/reporting
- broad structural refactors

## Protection Decision Rule

Each target domain should be assessed independently:

- `Regression Protected` if the protected model holds and no critical blocker appears
- `Not Yet Protected` if a critical blocker compromises that model

## Guardrails

- Do not reopen converged domains for polish-only issues
- Keep the runtime-blocked complaint management alerting slice separate
- Preserve separation between behavioural evaluation and code inspection
