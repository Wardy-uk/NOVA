# Portal Phase3 Slice Spec — Single Shared Config Protection

## Feature

- Name: Single shared config protection
- Phase: Portal Phase3
- User-facing area: Portal new-request form and conversational field collection

## Purpose

Remove the duplicated `CATEGORY_FIELD_CONFIG` drift between client and server by introducing one canonical shared source.

The 24 May 2026 gap analysis identified this as a structural maintenance trap:

- `src/server/services/portal-chat.ts`
- `src/client/components/portal/PortalNewRequest.tsx`

had separate copies of the field config and had already drifted apart.

## Behavioural Objective

The portal should continue to behave the same for customers, but the field rules driving both the client form and the server chat/runtime should now come from one shared authoritative source.

## Scope

In scope:

- category/subcategory field config duplication between client and server
- shared source establishment for that config
- runtime verification that form/chat behaviour remains aligned

Out of scope:

- broader deduplication of category names, subcategory names, or routing tables
- new routing behaviour
- new categories or taxonomy changes
- unrelated refactors outside the field-config drift problem

## Guardrails

- Preserve all protected domains and converged behaviours
- Do not change customer-facing labels or behaviour except where required to keep parity with the shared config
- Do not use this slice to smuggle in unrelated architectural cleanup

## Deferred Follow-On Work

- Deduplication of other duplicated portal config structures if later prioritised
- Broader shared-config strategy beyond this one field-config source
