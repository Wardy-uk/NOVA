# Account Setup — Behavioural Consistency Review

**Date:** 2026-05-19
**Author:** Manager Agent
**Trigger:** Iteration 3 retest returned NOT CONVERGED with protected Website Design regression
**Scope:** Account Setup / Office Changes + protected regression repair

---

## Review Decision

**Cross-path consistency hardening.**

This is no longer a narrow blocker-fix problem. The Iteration 3 retest failures — across all five blocker areas — share a common structural cause: behavioural contracts that exist in the LLM path are absent from the fallback/template path. Repeated narrow fixes to the LLM prompt have widened the gap between what the LLM path produces and what the fallback path produces, creating a divergence that the evaluator now detects as regression.

This is NOT an architecture redesign. The two-path model (LLM + fallback), the three-phase intake flow (opening → disambiguation → detail → summary), the bounded disambiguation model, and the hidden taxonomy are all structurally sound. What is needed is a thin shared consistency layer that enforces behavioural contracts regardless of which path generates the response.

---

## Evidence From Evaluator Retest

### Iteration trajectory
| Iteration | Pass Rate | Blockers | Protected Regression |
|-----------|-----------|----------|----------------------|
| 1         | ~55%      | Multiple | N/A (first pass)     |
| 2         | 44/55 (80%) | 5 critical | None identified    |
| 3         | NOT CONVERGED | 5 partially unresolved | WR1 Website Design |

### Pattern across the five blocker areas

| Blocker | LLM Path Behaviour | Fallback Path Behaviour | Divergence? |
|---------|-------------------|------------------------|-------------|
| B1: Security-sensitive ack interpolation | Person names interpolated into ack (F1 fix, line 768-782) | Person names interpolated (line 1298-1312) | **Partial** — LLM H1 fast-track and fallback both interpolate, but the fallback path uses hardcoded strings while LLM path mirrors customer voice |
| B2: WR1 Website Design phone preservation | MUST-include rules in LLM prompt (F2 fix, lines 843-851) | `buildTemplateAcknowledgement()` has NO phone/address/name interpolation (lines 2247-2259) | **Yes — critical** |
| B3: RBAC terminology echo | Vocabulary firewall in LLM prompt (lines 852-856) + positive-frame mirroring (F3 fix) | No vocabulary shielding policy; safe by accident, not by design | **Yes — structural** |
| B4: Escalation/chase semantics | `ESCALATION_CHASE_PATTERNS` pre-empts both paths equally (lines 1157-1163 LLM, 1236-1241 fallback) | Same detection, same response | **No — consistent** |
| B5: Multi-turn detail preservation | Raw message preserved + LLM enrichment appended (lines 883-894) | Raw content assigned directly (line 1592) | **Partial** — both preserve raw, but LLM path enriches while fallback doesn't |

### Summary of divergence

3 of 5 blockers show LLM-path vs fallback-path divergence. 1 is partially divergent. Only 1 (escalation/chase) is genuinely consistent across paths.

The Website Design regression (WR1) is the proof case: F2 added phone-number MUST-include rules to the LLM prompt, but `buildTemplateAcknowledgement()` (the fallback acknowledgement builder used when the LLM path fails or when fallback classification fires) only interpolates `propertyAddress`, `listingId`, `affectedPortals`, and `url` — it has no mechanism to include phone numbers, person names, or addresses. When the LLM path doesn't reliably produce the detail, and the fallback path structurally can't, the evaluator detects regression.

---

## Local Defects

These failures are isolated to specific code locations and can be fixed without architectural change:

1. **`buildTemplateAcknowledgement()` is too sparse (lines 2247-2259).** It only uses 4 field types: `propertyAddress`, `listingId`, `affectedPortals`, `url`. It should also interpolate `affectedPersonName`, `officeBranch`, phone numbers (from description regex), and `account` when available.

2. **`buildAccountAcknowledgement()` doesn't mirror customer voice (lines 2021-2034).** It produces "Thanks for letting us know about Sarah." when the customer said "Sarah can't see anything in LeadPro." The LLM path would say "I can see Sarah can't see anything in LeadPro — I'll look into that." The template path loses the operational context.

3. **`buildAccountFollowUp()` and `buildPropertyFollowUp()` are context-free templates.** When the LLM follow-up generation fails and these fire, they produce generic questions ("Could you let me know their full name and email address?") that ignore what the customer already said. This creates the "conversational reset" sensation that the evaluator flags.

4. **Access signal detection in `detectAccountFromKeywords()` (F4 fix) routes correctly** but the subsequent acknowledgement comes from `buildAccountAcknowledgement()` which doesn't reference the customer's specific access complaint.

---

## Cross-Path Consistency Failures

These failures are not localised to one function — they indicate missing shared behavioural contracts:

### C1: Vocabulary shielding is LLM-prompt-only

The vocabulary firewall (30+ banned terms including RBAC, provisioning, authentication, feed, syndication, etc.) exists only as an instruction within the LLM classification prompt (lines 852-856) and the LLM follow-up prompts (lines 2064, 2129, 2170). There is no runtime enforcement. If the LLM ignores the instruction, or if the fallback path generates text, no filter catches vocabulary violations before the response reaches the customer.

**Impact:** Jargon leakage is structurally possible on every non-LLM response path. The evaluator's `noJargon()` check (line 78) will catch it, but the system doesn't prevent it.

### C2: Detail preservation rules are LLM-prompt-only

The MUST-include rules for phone numbers, addresses, person names, and reference numbers (lines 843-851) are instructions to the LLM. They have no equivalent in the template acknowledgement builders. When the LLM path produces a generic acknowledgement (which it sometimes does despite the rules) or when the fallback path fires, operational details present in `collectedFields` are not reflected in the customer-facing acknowledgement.

**Impact:** The evaluator's `ackReferencesDetail()` and `phoneNumberPreserved()` checks fail intermittently — not because the system didn't capture the detail, but because the acknowledgement builder didn't surface it.

### C3: Customer-voice mirroring is LLM-path-only

The LLM prompt instructs: "Always use the customer's own words to describe their problem." Template acknowledgements cannot do this — they construct from field values, not from the customer's phrasing. This creates a visible quality gap: LLM-path responses sound like a human who listened; fallback-path responses sound like a form fill.

**Impact:** Not a functional failure but a behavioural inconsistency that the evaluator detects as "generic template acknowledgement overrides richer contextual acknowledgement."

### C4: Follow-up question context is path-dependent

LLM follow-up generators (`buildConversationalFollowUp`, `buildPropertyConversationalFollowUp`, `buildAccountConversationalFollowUp`) receive the last 4 messages of conversation history and produce contextual questions. Template follow-ups receive nothing and produce static questions. When the LLM follow-up fails and falls back to template, the conversation loses continuity.

**Impact:** The evaluator detects "conversational reset" when a contextual exchange suddenly produces a generic question.

---

## Protected Behaviours At Risk

| # | Protected Behaviour | Status | Risk Source |
|---|---------------------|--------|-------------|
| PB1 | Invisible Classification | STABLE | Hidden taxonomy intact in both paths. No risk from consistency gap. |
| PB2 | Platform Opacity | STABLE | Neither path reveals internal platform names. |
| PB3 | Permission Model Opacity | AT RISK | Vocabulary shielding is LLM-prompt-only (C1). If LLM fails to comply, no runtime filter catches RBAC/provisioning terms. |
| PB4 | Security-Sensitive Fast Track | STABLE | Pre-empts both paths equally (H1 + fallback security detection). |
| PB5 | Bounded Disambiguation | STABLE | One-question limit enforced structurally in both paths. |
| PB6 | Context Survival Through Disambiguation | AT RISK | Follow-up context gap (C4) means disambiguation responses can lose accumulated context. |
| PB7 | Opening Message Preservation | STABLE | `meta.openingMessage` set once, never overwritten. Both paths preserve it. |
| PB8 | Operational Detail Preservation | AT RISK | Detail interpolation gap (C2) means captured details don't always surface in acknowledgement. Details are still preserved in `collectedFields` and summary card — the risk is acknowledgement quality, not data loss. |
| PB9 | No Category Picker Regression | STABLE | F4/F5 fixes (access signal + escalation/chase) apply before picker in both paths. |
| PB10 | Frustration and Escalation Handling | STABLE | `FRUSTRATION_PATTERNS` and `ESCALATION_CHASE_PATTERNS` fire before path divergence. |
| WR1 | Website Design Regression (phone preservation) | REGRESSED | F2 fix is LLM-prompt-only. `buildTemplateAcknowledgement()` cannot surface phone numbers. |

**Summary:** 3 protected behaviours at risk (PB3, PB6, PB8), 1 regressed (WR1). 7 stable.

---

## Proposed Behavioural Contracts

These contracts should apply to ALL customer-facing text, regardless of whether the LLM path or fallback path generated it.

### BC1: Vocabulary Firewall (runtime enforcement)

Every customer-facing response string MUST pass through a shared `sanitizeResponse()` function before being returned. This function:
- Scans for vocabulary firewall terms (the same 30+ patterns from the LLM prompt)
- If a match is found: strips the term and replaces with a safe equivalent, OR flags the response for fallback regeneration
- Runs on LLM-generated text, template text, and empathy text equally

**Rationale:** The LLM prompt instruction is a first-line defence. The runtime filter is the safety net. Protected behaviours PB3 (Permission Model Opacity) and PB1 (Invisible Classification) depend on this.

### BC2: Acknowledgement Must Reference Customer Detail

Every acknowledgement (LLM-generated or template) MUST include at least one customer-provided detail when `collectedFields` contains any of: `affectedPersonName`, `propertyAddress`, `officeBranch`, phone number (extractable from description), `url`, `account`. The template builders must be enriched to interpolate these fields.

**Rationale:** "Thanks for letting us know" when the customer provided a name, address, and phone number is an evaluator-detectable failure. PB8 (Operational Detail Preservation) depends on the acknowledgement surfacing details, not just storing them.

### BC3: No Conversational Reset After Classification

If `meta.stage !== 'opening'`, no response should produce a category picker, a "how can I help" opener, or a question that ignores previously collected information. Template follow-ups should at minimum reference the customer's subcategory context (e.g., "about that office change" rather than "could you share a few more details?").

**Rationale:** PB6 (Context Survival) and PB9 (No Category Picker Regression) depend on conversational continuity through the fallback path.

### BC4: Escalation/Chase Parity (already achieved)

Both paths already handle escalation/chase signals identically via `ESCALATION_CHASE_PATTERNS`. This contract is already satisfied — document it so it doesn't regress.

### BC5: Security-Sensitive Parity (already achieved)

Both paths handle security-sensitive fast-track with person-name interpolation. Minor gap: fallback uses hardcoded response strings while LLM path uses the same strings in H1. Both produce acceptable output. This contract is satisfied.

---

## Minimum Safe Hardening Strategy

### Phase 1: Shared behavioural enforcement (addresses C1, C2, WR1)

1. **Create `sanitizeCustomerResponse(text: string): string`** — runtime vocabulary firewall.
   - Apply the same regex patterns from the evaluator's `JARGON` and `TAXONOMY_LEAK` constants.
   - Call it on every response string before returning from `handleMessage()`.
   - If a match is found, replace the term with a safe substitute (e.g., "authentication" → "login", "provisioning" → "setup", "access permissions" → "access"). Substitution map, not deletion — deleting mid-sentence produces incoherent text.
   - This is a safety net, not a redesign. The LLM prompt rules remain the first-line defence.

2. **Enrich `buildTemplateAcknowledgement(meta)`** to interpolate:
   - `affectedPersonName` → "Thanks for letting us know about the issue with {name}."
   - `officeBranch` → "...at the {branch} office."
   - Phone numbers (regex-extract from `description`) → include verbatim.
   - `account` → "...for {account}."
   - This directly repairs WR1 and strengthens PB8.

3. **Enrich `buildAccountAcknowledgement(meta)`** to include more context from `description` when available — at minimum the first clause of the customer's opening message, to provide voice-mirroring parity with the LLM path.

### Phase 2: Follow-up context injection (addresses C4)

4. **Modify template follow-up builders** to accept the most recent customer message and reference it:
   - Instead of "Could you let me know their full name and email address?" →
   - "You mentioned {brief context} — could you also confirm their full name and email address?"
   - This doesn't require an LLM call — string interpolation from `meta.collectedFields.description` or `meta.openingMessage` is sufficient.
   - This repairs PB6 (Context Survival) in fallback scenarios.

### Phase 3: Regression verification (gates sign-off)

5. **Run existing evaluator retest suite** (`_eval-ws1-iter3-retest.mjs`) after Phase 1+2 changes.
6. **Run cross-domain regression suite** (`_eval-ws1-regression.mjs`) to verify Website Design and Property protected behaviours remain clean.
7. **Specifically verify WR1 repair** with phone-number preservation scenarios through both paths.

### Estimated scope

- **Files modified:** `portal-chat.ts` only (possibly extract `sanitizeCustomerResponse` to a small utility if it exceeds ~30 lines).
- **Lines added:** ~60-80 (sanitize function, template enrichments, follow-up context injection).
- **Lines removed:** 0 (no existing behaviour removed).
- **Risk:** Low. All changes are additive. Template enrichments add detail to existing templates. Sanitize function is a post-processing filter that can't break flow logic.

---

## Explicitly Out Of Scope

1. **Architecture redesign.** The two-path model (LLM + fallback) is correct. The intake flow is correct. The disambiguation model is correct. No structural change needed.

2. **LLM prompt rewriting.** The LLM prompt is already comprehensive. The issue is not that the LLM path is wrong — it's that the fallback path doesn't uphold the same contracts.

3. **Multi-property modelling.** Confirmed out of scope per Property convergence decision. Not related to this consistency gap.

4. **Calyx/portal auth changes.** No auth or session flow changes needed.

5. **Category picker removal.** The picker remains as the last-resort fallback for genuinely unrecognisable input. The issue is not the picker's existence but that signals that should prevent it (access, escalation/chase) must be consistently detected — which F4/F5 already address.

6. **Follow-up LLM call reliability.** The LLM follow-up generators already fall back to templates. Making the LLM calls more reliable is a separate concern (model config, retry policy) and not part of this consistency hardening.

7. **New domain convergence.** This review covers Account Setup + protected regression repair only. No new domains are in scope.

8. **Hidden taxonomy changes.** The hidden taxonomy is structurally intact and must not be modified.

9. **Bounded disambiguation changes.** The one-question limit is structurally intact and must not be modified.

10. **Evaluator or holdout modification.** The evaluator suite is the governance instrument. It is not a target for change.

---

## Recommended Next Agent

**Build Agent** — with consistency-layer hardening scope.

Not a narrow blocker fix (insufficient — same pattern would recur). Not an architecture redesign (unnecessary — the structure is sound). The Build Agent should implement the shared behavioural consistency layer as defined in the Minimum Safe Hardening Strategy (Phases 1-2), then signal readiness for evaluator retest.

---

## Build Prompt Guidance

The next Build Agent prompt should:

### Frame as consistency hardening, not blocker fix

> "Implement a shared behavioural consistency layer across LLM and fallback response paths in portal-chat.ts."

### Specify the four deliverables

1. `sanitizeCustomerResponse()` — runtime vocabulary firewall applied to all customer-facing text
2. Enriched `buildTemplateAcknowledgement()` — interpolate person names, phone numbers, addresses, account names, office branches
3. Enriched `buildAccountAcknowledgement()` — include customer-voice context from opening message
4. Context-aware template follow-ups — reference customer's stated issue in fallback questions

### Define what NOT to change

- Do not modify the LLM classification prompt (lines 799-864)
- Do not modify the intake flow (opening → disambiguation → detail → summary)
- Do not modify the hidden taxonomy or category structures
- Do not modify the bounded disambiguation model
- Do not remove or weaken any existing detection (frustration, escalation/chase, security-sensitive, access signal)
- Do not modify the summary card builder
- Do not modify the evaluator or holdout suite

### Define the regression gates

- Website Design protected behaviours must remain clean (all 4 subcategories)
- Property / Listing protected behaviours must remain clean (all frozen baseline checks)
- Hidden taxonomy must not leak
- Bounded disambiguation must not exceed one clarifying question
- No category picker for property, website (when signals present), or account (when signals present) requests
- Existing escalation/chase and security-sensitive handling must remain functional

### Protected behaviour checklist

The Build Agent must verify, before signalling completion:
- [ ] `sanitizeCustomerResponse()` catches all JARGON patterns from evaluator
- [ ] `sanitizeCustomerResponse()` catches all TAXONOMY_LEAK patterns from evaluator
- [ ] `buildTemplateAcknowledgement()` interpolates `affectedPersonName` when present
- [ ] `buildTemplateAcknowledgement()` interpolates phone numbers when present in description
- [ ] `buildTemplateAcknowledgement()` interpolates `officeBranch` when present
- [ ] `buildTemplateAcknowledgement()` interpolates `account` when present
- [ ] `buildAccountAcknowledgement()` references customer's opening context
- [ ] Template follow-ups reference accumulated context (not generic "share more details")
- [ ] TypeScript typecheck passes
- [ ] Production build passes
- [ ] No schema, route, or frontend changes

### Prompt should NOT include

- Evaluator holdout wording (Build Agent must not optimise against specific test strings)
- Evaluator check implementations (Build Agent implements behaviour, not evaluation)
- The word "convergence" (Build Agent focuses on implementation, not governance)
- Permission to modify architecture, disambiguation, or taxonomy
