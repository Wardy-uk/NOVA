# Phase 2 — Iteration 7 Evaluation

**Date:** 2026-05-22
**Evaluator:** Eval Agent (behavioural, API-driven)
**Sessions tested:** 406–414 (9 sessions)

---

## Verdict: NOT YET CONVERGED

Two of the three blockers identified at the start of this iteration remain fully present. The third (conversational continuity) is partially intact but degraded by the property-question loop extending beyond Website/Listings into all issue types.

---

## Journeys Tested

| # | Scenario | Outcome |
|---|----------|---------|
| 1 | Property-specific website issue (wrong photos, 42 Elm St) | Reached summary in 2 turns ✓ — Jira submission failed ✗ |
| 2 | Site-wide website issue (maintenance message, acmeprops.co.uk) | Asked repeated questions about URL/exact wording, eventually hit Jira failure ✗ |
| 3 | Non-website issue (email campaign delivery) | Asked for property despite being an email issue ✗ — then Jira failure ✗ |
| 4 | Site-wide listings issue (all Rightmove listings missing) | Stuck in property-question loop despite "all listings" stated 3 times ✗ |
| 5 | Conversational continuity (greeting → vague → clarify → account) | Jumped to summary too early (after 2nd message), summary had poor field extraction ⚠ |
| 6 | Site-wide website issue with full detail upfront | Ignored all detail, asked "which property" despite explicit "NOT a specific property" ✗ |
| 7 | Property-specific (wrong bedroom count, 15 Oak Lane) | Reached summary in 2 turns ✓ — Summary edit request ignored ⚠ |
| 8 | Non-property CRM issue (add new user) | Insisted on property address 3 times for a user-admin request ✗ |

---

## Findings by Evaluation Question

### 1. Can the system successfully create a Jira ticket once summary is reached?

**No.** Jira ticket creation fails on every tested path — including direct calls to the `/confirm` endpoint with well-formed fields.

**Root cause observed:** The Jira onboarding client (`jira_ob_enabled`) is set to `false` in the running configuration. The `buildOnboardingJiraClient()` function returns `null`, so `PortalJiraService.createTicket()` throws immediately with "Jira client not configured". The user-facing error is: *"We couldn't create your ticket right now. Please try again, or contact us directly at support@nurtur.tech."*

The system then enters a dead-end loop: it offers to create a ticket, the user accepts, it fails again, and re-offers. There is no circuit-breaker or alternative path after repeated failures.

**Severity:** Blocking. No portal submission path works.

### 2. Do site-wide Website/Listings journeys escape the property-question loop?

**No.** The property-question loop remains fully present for site-wide issues:

- **Test 4:** "None of our listings are appearing on Rightmove" → asked "which property" 3 times
- **Test 6:** Explicitly stated "NOT a specific property — it affects every single page" → still asked for property
- **Test 2:** Site-wide maintenance message → asked for exact URL, exact wording, confirmation of wording before eventually hitting Jira failure

The system does NOT recognise phrases like "all listings", "site-wide", "every page", or "NOT a specific property" as signals to skip the property-address question.

**Severity:** Blocking. Site-wide issues cannot progress to summary.

### 3. Do site-wide journeys reach summary more reliably?

**No.** None of the site-wide Website/Listings test journeys reached a summary card. They all stalled in the property-question loop or hit Jira failure after enough turns triggered the fallback ticket-offer.

### 4. Were earlier Phase 2 conversational gains preserved?

**Partially.**

**Preserved:**
- Greetings and natural opening messages are handled — the system responds conversationally and asks for more detail (Test 5, step 1)
- Property-specific issues with a named address reach summary efficiently in 2 turns (Tests 1, 7)
- Summary cards render with structured fields (subject, request type, account, property, affected, description, urgency, contact preference)
- The system correctly identifies issue types ("Incorrect property details") for property-specific issues
- Hidden routing works — no category picker shown, routing inferred from conversation

**Degraded or regressed:**
- Summary field extraction is poor: account field captured "on our website, for Acme Properties" verbatim instead of extracting "Acme Properties" (Test 7)
- Summary edits are not applied: requesting a correction at summary stage re-displayed the same unchanged summary (Test 7)
- Conversational continuity is disrupted for vague issues: the system jumped to summary after only 2 messages with inadequate detail (Test 5 — subject was "Hello, I need some help please", account was "Something's wrong with our account")
- The property-question loop extends beyond Website/Listings into ALL issue types including CRM/user management (Test 8)

---

## Issues Outside Scope (Noted for Reference)

1. **Portal auth mode mismatch:** `portal_auth_mode` is set to `oidc` in the running DB but the system lacks a configured OIDC provider. The `portal-default-secret` JWT signing key works but is insecure. Widget routes (`/api/portal/widget/*`) are caught by the `app.use('/api/portal', portalAuth, ...)` middleware and blocked — the widget identify endpoint returns 401.

2. **No stage field returned:** All API responses return an empty `stage` field, making it impossible for a client to programmatically distinguish detail-gathering from summary from confirmed states.

---

## Summary of Convergence Status

| Blocker | Status | Detail |
|---------|--------|--------|
| Jira ticket creation fails | **Not fixed** | `jira_ob_enabled=false` — client returns null, all submissions fail |
| Site-wide Website/Listings property-question loop | **Not fixed** | System insists on property address for all issue types, ignoring "site-wide" / "not property-specific" signals |
| Detail-stage ticket-offer acceptances blocked | **Not fixed** | Ticket-offer acceptance triggers same Jira failure, creating an infinite loop |
| Conversational continuity (from earlier Phase 2) | **Partially preserved** | Property-specific paths work well; site-wide and non-property paths degraded by property-question loop; summary edits ignored |

**Overall:** Not yet converged. The Jira configuration issue is environmental (fixable by enabling `jira_ob_enabled`), but the property-question loop is a behavioural defect that affects all non-property-specific issue types and prevents those journeys from reaching summary regardless of Jira availability.
