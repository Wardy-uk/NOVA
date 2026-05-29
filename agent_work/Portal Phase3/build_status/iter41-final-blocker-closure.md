# Iteration 41 — Final Blocker Closure

**Date:** 2026-05-29
**Scope:** Close 3 remaining active defects from iter40 evaluation

## Changes Made

### 1. Domain truncation — FIXED

**Root cause:** `repairTruncatedDomains()` was only applied to `d.acknowledgment` and `d.nextQuestion` from the initial LLM call. The summary synthesis step (`synthesizeSummaryFields`) feeds user descriptions to the LLM for subject/description generation, and the LLM-generated `synthesizedSubject` and `synthesizedDescription` were never repaired. These flow directly into the summary card.

**Fix:**
- Applied `repairTruncatedDomains()` to `synthesizedSubject` and `synthesizedDescription` after LLM synthesis (portal-chat.ts ~line 3864-3867)
- Applied `repairTruncatedDomains()` to the final summary card response text as a safety net (portal-chat.ts ~line 3816)
- Widened function signature to accept `string | null` (matching the `url` field type)

### 2. Email-marketing over-capture on account/login/setup — FIXED

**Root cause:** The guard in `detectEmailMarketingFromKeywords()` (line 557) only caught explicit password/login/2FA patterns. Account setup, new-user, and access-request messages like "set up a new user on BYM" or "need access to BYM" passed through the guard. Bare `bym` in `hasStrongEmailSignal` then triggered, and the generic fallback at line 632 returned `email_campaign`. Additionally, line 613's BYM compound match included `login|access`, providing a secondary capture path.

**Fix:**
- Expanded the guard regex to include: `account setup|creation`, `new user`, `add user`, `remove user`, `set up (new)? (user|account|access)`, `need/grant/give access`, `user (access|account|setup|creation|permissions)` (portal-chat.ts ~line 557)
- Removed `login` and `access` from the BYM compound match at line 613 (these are account signals, not email-marketing signals)

### 3. Property follow-up too generic — FIXED

**Root cause:** The website-context guard in `detectPropertyFromKeywords()` (line 699) uses `hasPropertyVisibilityLanguage` to decide whether a property mention alongside "website" should stay on the property path. This regex only covered visibility/missing patterns (`missing|not showing|not appearing|disappeared|hidden|visibility`), not status/correctness patterns. So "property status wrong on the website" was blocked by the guard and routed to the generic website path, which asks "is something not displaying correctly, or do you need some content updated?" instead of property-specific follow-up.

**Fix:**
- Expanded `hasPropertyVisibilityLanguage` to include: `wrong`, `incorrect`, `outdated`, `status`, `mismatch`, `count`, `not (right|correct|updating)` (portal-chat.ts ~line 699)

## What was NOT changed

- No changes to the property follow-up templates themselves (they were already correct)
- No changes to email-marketing detection for genuine marketing requests (compound signals still route correctly)
- No changes to website content routing, blank-summary protection, or anti-garbling fixes
- No prompt edits — all fixes are structural/control-flow

## Risk assessment

- **Low risk for domain fix:** `repairTruncatedDomains` is a conservative function that only replaces structurally invalid domains (e.g. `www.co.uk`) when a known-good URL exists. Applying it more broadly should not corrupt valid domains.
- **Low risk for email guard:** The expanded guard only adds negative conditions (bail-out patterns). Genuine email-marketing requests don't contain "new user", "set up access", etc.
- **Low risk for property fix:** The expanded `hasPropertyVisibilityLanguage` regex adds patterns that are unambiguously property-related when combined with "property" + "website". These are patterns that should have been there from the start.

## Compilation

TypeScript compiles clean (`tsc --noEmit` passes with zero errors).

## Ready for evaluation

Yes — all three blocker fixes are implemented and compile-clean. No convergence claimed.
