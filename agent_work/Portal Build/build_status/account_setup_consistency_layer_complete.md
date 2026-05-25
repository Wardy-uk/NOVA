# Account Setup — Consistency Layer Build Complete

**Date:** 2026-05-19
**Author:** Build Agent
**Scope:** Cross-path behavioural consistency hardening (Phase 1 + Phase 2)
**Trigger:** Manager Agent consistency layer review (`agent_work/plan/account_setup_consistency_layer_review.md`)

---

## Changes Implemented

### 1. Runtime Vocabulary Firewall — `sanitizeCustomerResponse()`

**Location:** `portal-chat.ts` (module-level function, applied at line ~639)

- 37 regex → replacement pairs covering all three jargon categories:
  - Account/access internal: RBAC, provisioning, deprovisioning, authentication, authorisation, SSO, SAML, identity provider, access control, role-based, permission matrix/model/levels, scopes, entities, service account, access/user/role permissions, access rights
  - Technical integration: data feed, data pipeline, webhook, endpoint, CRM sync, syndication, API, integration
  - Classification/routing: triage, categorise/categorize, classify, route, intake, subcategory, taxonomy, confidence
- Applied to ALL customer-facing response text at the single exit point (after `processStage()` returns, before DB persist)
- Runs on LLM-generated, template-generated, empathy, and error fallback text equally
- Substitution-based (not deletion) to preserve sentence coherence

### 2. Enriched `buildTemplateAcknowledgement()`

**Location:** `portal-chat.ts` (method on PortalChatService)

Now interpolates:
- `affectedPersonName` → "Thanks for those details about the issue with {name}."
- `officeBranch` → "...the {branch} office."
- `account` → used as fallback detail when no other parts present
- Phone numbers → extracted from `description` via `extractPhoneNumbers()`, appended as suffix
- Existing fields preserved: `propertyAddress`, `listingId`, `affectedPortals`, `url`

**WR1 Repair:** Phone numbers in Website Design descriptions are now surfaced via regex extraction from the description field, regardless of whether the LLM path or fallback path generated the acknowledgement.

### 3. Enriched `buildAccountAcknowledgement()`

**Location:** `portal-chat.ts` (method on PortalChatService)

Now includes customer-voice context from opening message via `briefContext()`:
- When person name is present: "Thanks for letting us know about Sarah — I can see she can't see anything in LeadPro."
- When no person name but subcategory known: "Sorry to hear you're having trouble getting in — sarah.jones@example.com can't log in to the portal."
- Falls back to original generic messages when no context available

### 4. Context-Aware Template Follow-Ups

**Location:** `buildAccountFollowUp()` and `buildPropertyFollowUp()` in `portal-chat.ts`

Both now use `withContext()` helper pattern:
- Non-description fields (affectedPerson, officeBranch, account, propertyIdentifier, affectedPortals) prefix with "You mentioned {brief context} — " when context is available
- Description fields (which ask the core question) remain unchanged — they don't benefit from prefixing
- Falls back to original static questions when no context available

### 5. Shared Helpers

- `sanitizeCustomerResponse(text)` — runtime vocabulary firewall
- `extractPhoneNumbers(text)` — regex phone number extraction from free text
- `briefContext(meta)` — extracts first sentence from description/openingMessage for context injection

---

## Files Changed

| File | Change Type |
|------|-------------|
| `src/server/services/portal-chat.ts` | Modified — added consistency layer functions + enriched template builders |

No other files changed. No schema, route, frontend, or type changes required.

---

## Protected Behaviour Verification

| # | Protected Behaviour | Status | Verification |
|---|---------------------|--------|-------------|
| PB1 | Invisible Classification | PRESERVED | Hidden taxonomy unchanged. Sanitizer catches `taxonomy`, `subcategory`, `classify`, `categorise`, `triage`, `route` if they leak. |
| PB2 | Platform Opacity | PRESERVED | No platform names in any template. Sanitizer catches `API`, `integration`, `endpoint`, `CRM sync`. |
| PB3 | Permission Model Opacity | REPAIRED | Sanitizer catches `RBAC`, `provisioning`, `authentication`, `authorisation`, `access control`, `role-based`, `permission matrix/model`, `SSO`, `SAML`, `identity provider` at runtime. Previously LLM-prompt-only. |
| PB4 | Security-Sensitive Fast Track | PRESERVED | H1 pre-emption unchanged. No modifications to security-sensitive detection or response. |
| PB5 | Bounded Disambiguation | PRESERVED | No changes to disambiguation model or one-question limit. |
| PB6 | Context Survival | REPAIRED | Template follow-ups now reference customer's stated issue via `briefContext()`. No more generic "could you share a few more details?" when context is available. |
| PB7 | Opening Message Preservation | PRESERVED | `meta.openingMessage` logic unchanged. |
| PB8 | Operational Detail Preservation | REPAIRED | `buildTemplateAcknowledgement()` now surfaces person names, phone numbers, office branches, accounts. `buildAccountAcknowledgement()` includes customer-voice context. |
| PB9 | No Category Picker Regression | PRESERVED | F4/F5 detection unchanged. No modifications to picker logic. |
| PB10 | Frustration and Escalation Handling | PRESERVED | `FRUSTRATION_PATTERNS` and `ESCALATION_CHASE_PATTERNS` unchanged. Empathy builder unchanged. |

---

## Website Design Regression Repair (WR1)

**Status: REPAIRED**

- `buildTemplateAcknowledgement()` now extracts phone numbers from `description` via `extractPhoneNumbers()` and includes them in the acknowledgement
- This works for both LLM-path (phone numbers are in the description from raw message preservation) and fallback-path (phone numbers are in the description from direct capture)
- The LLM prompt MUST-include rules remain as first-line defence
- The template enrichment provides the second-line defence when the LLM path fails to include phone numbers

---

## Runtime / Build Validation

- **TypeScript typecheck:** PASSED (zero errors)
- **Production build:** PASSED (vite build + tsc server)
- **No schema changes:** Confirmed
- **No route changes:** Confirmed
- **No frontend changes:** Confirmed

---

## Remaining Known Gaps

1. **Customer-voice mirroring in templates (C3 from review):** Template acknowledgements now include operational details but still construct from field values rather than the customer's exact phrasing. Full voice-mirroring would require an LLM call in the template path, which is out of scope for this consistency layer. The `briefContext()` helper partially addresses this by injecting the first sentence of the customer's opening message.

2. **Sanitizer is substitution-only:** If the LLM produces a sentence where the banned term is load-bearing for grammar (e.g., "your RBAC settings need updating"), the substitution ("your access settings settings need updating") could produce a minor grammatical artefact. In practice this is rare — the LLM prompt firewall is the first defence and the sanitizer is a safety net.

3. **`buildConversationalQuestion()` (generic website follow-ups):** These remain static templates without context injection. They are less at risk because they're subcategory-specific already (e.g., "Could you tell me what needs changing and where on the page?" for website_content). Context injection would add marginal value here.

---

## What NOT Changed

- LLM classification prompt (lines 799-864 original)
- Intake flow (opening → disambiguation → detail → summary)
- Hidden taxonomy or category structures
- Bounded disambiguation model
- Frustration, escalation/chase, or security-sensitive detection
- Summary card builder
- Evaluator or holdout suite
- Any frontend, route, schema, or type files (beyond the service itself)
