# Portal Gap Analysis — Progress Check

**Date:** 24 May 2026
**Reference:** [portal-deep-dive-analysis.md](portal-deep-dive-analysis.md) (18 May 2026)
**Method:** Compared 7 recommendations against 50 commits and current codebase state post-analysis.

---

## Status Summary

| # | Recommendation | Status |
|---|---|---|
| 1 | Expand to 21 templates | PARTIAL |
| 2 | Optimise top 6 categories | DONE |
| 3 | Single shared config | NOT DONE |
| 4 | Deterministic routing (3 cats) | PARTIAL |
| 5 | Reopened ticket handling | PARTIAL |
| 6 | Management alerting for complaints | NOT DONE |
| 7 | KB deflection 20-30% | PARTIAL |

---

## Detail

### 1. Expand to 21 template question sets — PARTIAL

9 top-level categories with ~27 subcategories exist in `DEFAULT_CATEGORIES` (portal-intake.ts). LeadPro is partially covered as "LeadPro & CRM".

**Still missing as portal intake categories:**
- Website Security
- General Service Request
- Reopened / Follow-up
- Complaint / Escalation

### 2. Optimise top 6 categories — DONE

All six high-volume categories have subcategories and field configs wired up:
- Website Design/Content — 4 subcategories
- Property/Listing — 6 subcategories + 3 listings subcategories
- Integration/Feed — 3 subcategories
- Template/Email Editor — 3 subcategories
- Account Setup — 6 subcategories
- Data/Reporting — covered under feeds_reporting

### 3. Single shared config — NOT DONE

`CATEGORY_FIELD_CONFIG` is duplicated independently in two places:
- `src/server/services/portal-chat.ts` — 35 entries
- `src/client/components/portal/PortalNewRequest.tsx` — 27 entries

They've drifted. Server has entries (account_office_change, account_remove_user, property_* subcategories) that the client lacks. This is a maintenance trap.

### 4. Deterministic routing for 3 categories — PARTIAL

- Website Design/Content routes deterministically to project NTPJ via `CATEGORY_TO_PROJECT`
- Template routes to NT, not Production
- Letters has no category at all
- No AI-bypass flag on these routes

### 5. Special handling for reopened tickets — PARTIAL

Portal chat (portal-chat.ts) detects ticket references like `NT-123` or `NTPJ-456` in user messages and looks up existing tickets. However, it only shows the ticket's current status — does not route to the original handler or create a linked follow-up.

### 6. Management alerting for complaints — NOT DONE

NOVA's agent pipeline detects complaint language via `triage.txt` and `escalation-policy.ts`, but the portal itself has no complaint category, no management notification mechanism, and no queue bypass.

### 7. KB deflection 20-30% target — PARTIAL

**Infrastructure built:**
- Deflection tracking via `portal_analytics` events
- `getDeflectionRate()` function in portal-analytics.ts
- KB article helpfulness feedback loop (helpful_yes/helpful_no)
- Form-level KB suggestions with deflection tracking in PortalNewRequest.tsx
- `deflection_count` and `failed_deflection_count` on KB articles

**Still missing:**
- KB health baseline measurement tool
- Target threshold configuration
- Dashboard showing progress toward the 20-30% target
