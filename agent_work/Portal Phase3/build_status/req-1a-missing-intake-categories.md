# Build Status — Req 1A: Missing Intake Category Completion

**Slice:** Req 1A — Missing intake category completion
**Status:** Ready for evaluation
**Date:** 2026-05-24

## What Changed

Added four missing portal intake request types as fully supported categories:

1. **Website Security** (`security`) — SSL certificates, suspicious activity, vulnerability concerns. Subcategories: suspicious activity/vulnerability, SSL/certificate issue, unauthorised access concern. Routes to NTPJ project.

2. **General Service Request** (`general_request`) — Changes, information requests, or anything that doesn't fit other categories. Subcategories: request a change, request information, other service request. Routes to NT project.

3. **Reopened / Follow-up** (`followup`) — Chase or reopen a previous request. Subcategories: reopen a resolved request, chase an open request, issue not fully resolved. Routes to NT project.

4. **Complaint / Escalation** (`complaint`) — Raise a complaint or escalate an issue. Subcategories: service complaint, response time concern, escalate an existing issue. Routes to NT project.

## Files Modified

- `src/server/services/portal-intake.ts` — Added categories to `CATEGORY_TO_PROJECT` mapping and `DEFAULT_CATEGORIES` array
- `src/server/services/portal-chat.ts` — Added entries to `CATEGORY_FIELD_CONFIG`, `CATEGORY_NAMES`, `SUBCATEGORY_NAMES`
- `src/client/components/portal/PortalChat.tsx` — Added entries to `CATEGORY_LABELS`
- `src/client/components/portal/PortalNewRequest.tsx` — Added entries to client-side `CATEGORY_FIELD_CONFIG`

## Design Decisions

- All four categories placed before "Something Else" (catch-all stays last)
- Website Security routes to NTPJ (website project); the other three route to NT (general support)
- Labels are customer-safe — no internal taxonomy, routing teams, or implementation language exposed
- Each subcategory has a contextual description hint to guide the customer's input
- Complaint/Escalation and Reopened/Follow-up are basic intake paths only — not full workflow implementations (as scoped)

## Blocked / Uncertain

- Nothing blocked. All four categories follow the established pattern.
- The conversational intake LLM prompt (`ConversationalIntakeSchema`) does not yet have dedicated boolean flags for these four new categories (like `isWebsiteRelated`/`isPropertyRelated`). The LLM can still classify into them via the `CategoryPickSchema` path, and form-based intake works fully. A future slice could add dedicated conversational detection if needed.

## Regression Risk

Low. Changes are additive — new entries appended to existing config objects and arrays. No existing keys, logic branches, or UI flows were modified.
