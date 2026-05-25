# Account Setup / Office Changes — Iteration 3 Build Complete

## Status

- **Domain:** Account Setup / Office Changes
- **Iteration:** 3 (blocker fix)
- **Build date:** 2026-05-19
- **Build agent:** Build Agent
- **Authoritative plan:** `agent_work/plan/account_setup_iteration3_blocker_fix.md`

---

## 1. Behavioural Changes Implemented

### F1: Security-Sensitive Acknowledgement Interpolation

**Files changed:** `src/server/services/portal-chat.ts`

**What changed:** All four security-sensitive acknowledgement paths now interpolate the affected person's name when extracted from the customer's message:

- H1 pre-emption fast-track (line ~755): `"Understood — I'll get Sarah Jenkins's access removed urgently."` instead of generic `"Understood — I'll get this raised urgently."`
- LLM-routed security path (line ~1015): Builds name-interpolated acknowledgement, falls back to LLM acknowledgement only if no name extracted
- Non-LLM `handleAccountFallback` security path (line ~1247): Same interpolation pattern
- Vague account signal security path (line ~1097): Same interpolation pattern

**Behaviour:** When the customer provides a person name (e.g. "Remove Sarah Jenkins immediately"), the acknowledgement now references that name. When both name and email are present, routes directly to summary. When only name is present, asks specifically for email (not generic "name or email"). When neither is present, asks for both.

**Protected behaviours preserved:** PB4 (security-sensitive fast track), PB6 (context survival), PB7 (opening message preservation). Routing logic unchanged — only acknowledgement text enriched.

### F2: Website Design WR1 Phone Number Detail Preservation

**Files changed:** `src/server/services/portal-chat.ts`

**What changed:** The LLM acknowledgement instruction (the main intake prompt) was restructured:

- **Primary control shifted** from vocabulary firewall to positive-frame vocabulary mirroring: "Always use the customer's own words to describe their problem."
- **MANDATORY DETAIL INCLUSION** section added with explicit MUST-include rules for: phone numbers (exact digits), addresses (exact text), person names (exact name), reference numbers, and error messages
- **Phone numbers specifically called out**: "include the EXACT phone number(s) mentioned (e.g. '0161 555 1234'). Never drop or omit phone numbers."
- **Violation example strengthened**: "'I can help with that update' is a VIOLATION" — made explicit that generic paraphrasing is a failure mode

**Behaviour:** The LLM is now instructed that phone numbers, addresses, and person names are mandatory inclusions in acknowledgements when provided by the customer. The "contact page phone number" scenario from WR1 should now preserve both the old and new phone numbers verbatim.

**Protected behaviours preserved:** Website Design operational detail preservation (WR1 target). No routing changes — only prompt conditioning.

### F3: RBAC Terminology Echo Bypass — Vocabulary Mirroring

**Files changed:** `src/server/services/portal-chat.ts`

**What changed:** Three-layer vocabulary control implemented:

1. **Primary control (new):** Positive-frame vocabulary mirroring instruction at the top of the acknowledgement section: "Always use the customer's own words to describe their problem."
2. **Expanded forbidden list (strengthened):** Added near-miss terms the LLM was using to bypass the original list: `authorization`, `access permissions`, `user permissions`, `role permissions`, `access rights`, `permission model`, `permission levels`, `user access`
3. **Follow-up prompts hardened:** All three LLM follow-up generation prompts (account, website, property) now include:
   - Expanded forbidden term lists matching the main prompt
   - Positive-frame mirroring instruction: "ALWAYS use the customer's own words to describe their problem"

**Behaviour:** The LLM's primary instruction is now to mirror the customer's vocabulary, not to avoid a list. The forbidden list remains as a safety net for terms that must never appear. This shift from negative-frame (don't use X) to positive-frame (use the customer's words) should generalise better against synonym bypass.

**Protected behaviours preserved:** PB1 (invisible classification), PB3 (permission model opacity).

### F4: "Access" Recognised as Account-Domain Signal in All Contexts

**Files changed:** `src/server/services/portal-chat.ts`

**What changed:** Added broad "access" signal detection to `detectAccountFromKeywords()` as a final fallback check:

- Pattern: `/\b(access)\b/` with negative lookahead for website/property domain terms
- Routes to `account_permissions` subcategory with conversational clarification
- Placed after all specific account signal checks (login, new user, permissions, office, details) so it doesn't override more specific routing
- Excludes messages containing website/property vocabulary to avoid pulling those domains

**Behaviour:** Messages like "API endpoint access" or "integration access" that contain the word "access" but no website/property vocabulary now route to conversational clarification instead of the category picker. The clarification question surfaces the underlying need, which then routes normally.

**Risk mitigation:** The "access" signal triggers conversational clarification, not direct routing. Website and Property domains have their own stronger signals that are checked first. The negative lookahead prevents cross-domain pull.

**Protected behaviours preserved:** PB9 (no category picker regression). PB5 (bounded disambiguation) unaffected — this adds a pre-picker signal, not a new disambiguation question.

### F5: Escalation/Chase Semantic Detection Before Picker Fallback

**Files changed:** `src/server/services/portal-chat.ts`, `src/shared/portal-types.ts`

**What changed:**

1. **New constant `ESCALATION_CHASE_PATTERNS`** added alongside existing pattern constants. Matches: "raised this", "already reported/logged/submitted", "following up", "chasing", "nobody has helped/replied", "been waiting", "still not fixed/resolved", "weeks ago/days ago", "re-raise", "follow-up", "hasn't been fixed/addressed/dealt with"

2. **LLM path detection** inserted in `handleIntentWithLlm` after vague property signal check and before the category picker fallback. When escalation/chase language detected:
   - Sets `meta.conversational = true` and `meta.escalationDetected = true`
   - Routes to detail stage with: "Could you tell me a bit more about the issue you originally raised so I can get this picked up?"
   - Uses LLM acknowledgement if available, or falls back to empathetic template

3. **Non-LLM path detection** inserted in `handleIntentWithoutLlm` before the category picker fallback. Same routing logic.

4. **Type extension:** Added `escalationDetected?: boolean` to `IntakeSessionMetadata` in `src/shared/portal-types.ts`

**Behaviour:** Messages like "I raised this two weeks ago" or "nobody has helped with my issue" now trigger conversational follow-up asking about the original issue. The category picker never appears for escalation/chase messages. Once the customer describes the original issue, it routes normally through the existing classification pipeline.

**Protected behaviours preserved:** PB9 (no category picker regression — escalation messages are no longer misclassified as "unclassifiable"), PB10 (frustration and escalation handling).

---

## 2. Protected Behaviours Preserved

### Website Design / Content Changes — REGRESSION PROTECTED

| Protected Behaviour | Status | Verification |
|---|---|---|
| Hidden taxonomy | PRESERVED | No classification terms added to any customer-facing text |
| Conversational continuity | PRESERVED | No changes to conversation flow structure |
| Opening-message preservation | PRESERVED | `openingMessage` capture and `description` handling unchanged |
| Operational detail preservation | STRENGTHENED (F2) | Explicit MUST-include rules for phone numbers, addresses, names |
| Attachment awareness | PRESERVED | Attachment detection and messaging unchanged |
| Human escalation acknowledgement | PRESERVED | Frustration/handoff paths unchanged |

**WR1 status:** Addressed by F2. Phone number preservation now explicitly mandated in LLM prompt. Requires evaluator retest to confirm resolution.

### Property / Listing Issues — REGRESSION PROTECTED

| Protected Behaviour | Status | Verification |
|---|---|---|
| Hidden taxonomy | PRESERVED | No changes to property routing or response paths |
| Conversational continuity | PRESERVED | Property conversation flow unchanged |
| Opening-message preservation | PRESERVED | No changes to property intake |
| Operational detail preservation | PRESERVED | Property field extraction unchanged |
| Attachment awareness | PRESERVED | Unchanged |
| Human escalation acknowledgement | PRESERVED | Unchanged |
| Portal/feed complexity hidden | PRESERVED | Vocabulary firewall extended, not reduced |

### Account Setup Protected Behaviours

| PB | Name | Iteration 3 Action | Status |
|---|---|---|---|
| PB1 | Invisible Classification | F3 vocabulary mirroring | STRENGTHENED |
| PB2 | Platform Opacity | No change needed | PRESERVED |
| PB3 | Permission Model Opacity | F3 extended forbidden list | STRENGTHENED |
| PB4 | Security-Sensitive Fast Track | F1 name interpolation | STRENGTHENED |
| PB5 | Bounded Disambiguation | No changes to disambiguation | PRESERVED |
| PB6 | Context Survival Through Disambiguation | F1 name carried through | STRENGTHENED |
| PB7 | Opening Message Preservation | F1 details reflected in ack | STRENGTHENED |
| PB8 | Operational Detail Preservation | F2 mandatory detail rules | STRENGTHENED |
| PB9 | No Category Picker Regression | F4 + F5 reduce picker triggers | STRENGTHENED |
| PB10 | Frustration and Escalation Handling | F5 escalation/chase detection | STRENGTHENED |

### Structural Elements

| Element | Status |
|---|---|
| Bounded disambiguation model | UNCHANGED — no modifications |
| Hidden taxonomy | UNCHANGED — no classification terms in responses |
| Cross-domain routing | UNCHANGED — no routing architecture changes |
| Conversational intake architecture | UNCHANGED — three-phase model intact |
| No unrestricted interrogation | UNCHANGED — one-question limit respected |

---

## 3. Regressions Repaired

| Regression | Fix | Status |
|---|---|---|
| WR1: Website Design phone number detail loss | F2: Mandatory phone number inclusion in LLM acknowledgement instruction | ADDRESSED — requires evaluator retest |

---

## 4. Remaining Known Gaps

### Non-Blocking Quality Gaps (per plan §4)

| Gap | Description | Why Non-Blocking |
|---|---|---|
| Acknowledgement tone variation | Some acknowledgements may still feel formulaic | Does not break routing or detail preservation |
| Follow-up question naturalness | Some follow-up questions slightly mechanical | Functionally correct |
| Optional field extraction | Department, start date not always captured | Core operational fields captured |
| Multi-entity relationship modelling | User + office + branch as linked entities | Flat-field model sufficient |

### Escalation/Chase Domain Resolution

F5 detects escalation/chase messages and asks about the original issue, but after the customer responds, the message re-enters the intent classification pipeline. If the customer's response is also vague ("it's about my account"), it may require a second exchange before precise routing. This is by design — the alternative (guessing the domain) would violate PB5 bounded disambiguation.

### LLM Compliance Uncertainty

F2 and F3 rely on LLM prompt conditioning. The LLM may still occasionally bypass the vocabulary mirroring instruction or drop a phone number. The forbidden list extension and positive-frame shift should significantly reduce this, but LLM compliance is probabilistic. Evaluator retest will confirm actual behaviour.

---

## 5. Runtime/Build Validation Results

| Check | Result |
|---|---|
| TypeScript typecheck (`tsc --noEmit`) | PASS — no errors |
| Production build (`npm run build`) | PASS — all bundles generated |
| Files modified | `src/server/services/portal-chat.ts`, `src/shared/portal-types.ts` |
| Database schema changes | NONE |
| Route handler changes | NONE |
| Frontend component changes | NONE |
| New dependencies | NONE |

---

## 6. Implementation Traceability

| Blocker | Fix ID | Implementation Location | Type |
|---|---|---|---|
| Security-sensitive ack interpolation | F1 | portal-chat.ts: 4 security-sensitive paths | Acknowledgement template enrichment |
| WR1 phone number preservation | F2 | portal-chat.ts: LLM intake prompt | Prompt conditioning |
| RBAC terminology echo | F3 | portal-chat.ts: intake prompt + 3 follow-up prompts | Prompt conditioning shift |
| "Access" signal recognition | F4 | portal-chat.ts: `detectAccountFromKeywords()` | Keyword detector extension |
| Escalation/chase detection | F5 | portal-chat.ts: LLM + non-LLM intent paths; portal-types.ts | New signal class in pre-picker path |

---

## Governance

- **Programme tracker NOT updated.** Tracker mutation awaits: evaluator retest → human + manager convergence review.
- This document reports build completion and implementation details. It does not claim convergence or progress.
- All changes are within the scope defined by `agent_work/plan/account_setup_iteration3_blocker_fix.md`.
- No architectural changes, no confidence threshold changes, no disambiguation redesign, no new conversational models.
