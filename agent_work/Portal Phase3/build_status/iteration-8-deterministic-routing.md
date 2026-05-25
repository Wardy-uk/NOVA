# Iteration 8 — Deterministic Routing Hardening

**Date:** 25 May 2026
**Status:** Ready for evaluation

## What Changed

### 1. Subcategory-aware routing (portal-intake.ts)

`getProjectForCategory()` now accepts an optional `subcategory` parameter and checks it first against both settings overrides and the routing table. Previously, only the parent category was checked — subcategory-specific routing was silently ignored.

`submitTicket()` now passes `input.subcategory` to the routing method.

### 2. email_template → NTPJ (portal-intake.ts)

The `email_template` subcategory now routes to NTPJ (production) instead of falling through to the parent `email_marketing` → NT default. Template work is production work (HTML/design), not general support.

### 3. Letters & Correspondence category (portal-intake.ts, portal-chat.ts, PortalNewRequest.tsx)

New top-level category `letters` with three subcategories:
- `letters_market_appraisal` — market appraisal letters
- `letters_mailshot` — property mailshots / marketing letters
- `letters_general` — other printed correspondence

All route to NTPJ. Field config, category names, and subcategory names added to both server (portal-chat.ts) and client (PortalNewRequest.tsx).

### 4. Deterministic keyword detection (portal-chat.ts)

Two new detection functions:
- `detectEmailTemplateFromKeywords()` — matches unambiguous template request language
- `detectLettersFromKeywords()` — matches correspondence/mailshot/appraisal language with subcategory inference

Both are wired into the conversational intake chain (LLM and no-LLM paths) before the complaint/disambiguation/vague-signal handlers. This means template and letters requests bypass LLM ambiguity and route directly.

### 5. Explicit subcategory entries in routing table (portal-intake.ts)

All previously implicit subcategories (account_*, email_*, leadpro_*, feeds_*, listings_*, onboarding_*, billing_*, other_*) are now explicitly listed in `CATEGORY_TO_PROJECT`. No subcategory depends on default fallthrough — every known case has a deterministic entry.

## Files Changed

- `src/server/services/portal-intake.ts` — routing table, category definitions, subcategory-aware routing
- `src/server/services/portal-chat.ts` — keyword detectors, field config, name entries, intent routing
- `src/client/components/portal/PortalNewRequest.tsx` — letters field config

## What's Not Changed

- Complaint/follow-up behaviour preserved (no changes to those paths)
- Website/property/account/security routing unchanged
- Vocabulary firewall untouched
- No shared-config consolidation (deferred — both files now have matching letters entries)

## Blocked / Uncertain

- The "shared config" gap (CATEGORY_FIELD_CONFIG duplicated in portal-chat.ts and PortalNewRequest.tsx) is still open. Letters entries were added to both files manually. This is a maintenance concern but not a routing issue.
- Build compiles clean (`tsc --noEmit` passes).
