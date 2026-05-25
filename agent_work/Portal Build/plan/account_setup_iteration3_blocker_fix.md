# Account Setup / Office Changes — Iteration 3 Blocker Fix

## Status

- **Domain:** Account Setup / Office Changes
- **Iteration:** 3 (blocker fix)
- **Predecessor:** Iteration 2 hardening (build complete 2026-05-19) → Iteration 2 retest (44/55, 80%, NOT CONVERGED)
- **Created:** 2026-05-19
- **Programme authority:** spec/orchestration/attractor_programme_methodology.md

---

## 1. Behavioural Interpretation of Retest Findings

The Iteration 2 retest confirms the hardening strategy was correct. The pass rate improved from 55% to 80% (30/55 → 44/55). All six original blockers saw significant improvement. The architecture, routing, bounded disambiguation, and hidden taxonomy are confirmed stable.

The remaining 11 failures are **not structural**. They are late-stage behavioural polish failures — narrow gaps in how the system acknowledges, translates, and handles specific conversational patterns. The evaluator explicitly confirms that once four to five remaining blockers are repaired, the domain is expected to reach approximately 93% and become a convergence candidate.

This is the expected trajectory for a third iteration: the system works, the edges need filing.

### Evaluator Pressure Map — Iteration 3

| Evaluator Finding | Behavioural Interpretation | Severity |
|---|---|---|
| Security-sensitive acknowledgement missing affected person names | H1 fast-track fires correctly but the acknowledgement does not interpolate the affected person's name from the customer's message. The routing is right; the response doesn't mirror the detail. | **BLOCKER** |
| WR1 Website Design regression — phone-number contextual acknowledgement loss | H6 prompt tightening did not fully resolve WR1. The acknowledgement still drops phone numbers in Website Design scenarios. This is a **protected-domain regression** and gates Iteration 3 sign-off. | **BLOCKER** |
| RBAC terminology echo in customer-facing responses | H4 vocabulary firewall does not fully suppress RBAC-family terms. The LLM is finding synonyms or near-misses that bypass the forbidden list. Terminology translation is incomplete. | **BLOCKER** |
| TS3 category-picker fallback ("API endpoint access") | A technically-worded message ("API endpoint access") triggers the category picker instead of conversational clarification or direct routing. The domain keyword detectors (H2) don't recognise this phrasing as account/access-related. | **BLOCKER** |
| HO8 category-picker fallback ("I raised this two weeks ago") | An escalation/chase message with no explicit domain signal falls to the category picker. The system treats re-raised requests as unclassifiable when they should be handled as escalation/chase scenarios under PB10. | **BLOCKER** |

### Critical Insight

The five remaining blockers split into three distinct behavioural gaps:

1. **Acknowledgement interpolation** (2 blockers): The system routes correctly but doesn't reflect specific details back — person names in security scenarios, phone numbers in website scenarios. The routing layer solved; the acknowledgement layer under-interpolates.

2. **Terminology translation** (1 blocker): The vocabulary firewall catches the primary terms but misses synonyms, abbreviations, or reformulations. The LLM works around the forbidden list rather than translating to customer vocabulary.

3. **Semantic handling for edge signals** (2 blockers): Two message types fall to the picker because they don't match existing keyword patterns — technically-worded access requests and escalation/chase messages referencing prior tickets. These are signal-recognition gaps, not architectural failures.

---

## 2. Confirmed Protected Behaviours

### Website Design / Content Changes — REGRESSION PROTECTED

**Status:** WR1 REGRESSION ACTIVE. Phone-number contextual acknowledgement loss persists from Iteration 2. This must be resolved in Iteration 3.

Protected behaviours under regression watch:
- Hidden taxonomy — CLEAN
- Conversational continuity — CLEAN
- Opening-message preservation — CLEAN
- Operational detail preservation — **WR1 VIOLATION** (phone number loss)
- Attachment awareness — CLEAN
- Human escalation acknowledgement — CLEAN

### Property / Listing Issues — REGRESSION PROTECTED

**Status:** CLEAN. All holdouts pass. No action required.

Protected behaviours under regression watch:
- Hidden taxonomy — CLEAN
- Conversational continuity — CLEAN
- Opening-message preservation — CLEAN
- Operational detail preservation — CLEAN
- Attachment awareness — CLEAN
- Human escalation acknowledgement — CLEAN
- Portal/feed complexity hidden — CLEAN

### Account Setup Protected Behaviours — Current State

| PB | Name | Iteration 1 | Iteration 2 Retest | Trend |
|---|---|---|---|---|
| PB1 | Invisible Classification | VIOLATED | PARTIALLY RESOLVED | ↑ |
| PB2 | Platform Opacity | NOT TESTED | ASSUMED CLEAN | — |
| PB3 | Permission Model Opacity | VIOLATED | PARTIALLY RESOLVED | ↑ |
| PB4 | Security-Sensitive Fast Track | VIOLATED | ROUTING FIXED, ACK GAP | ↑ |
| PB5 | Bounded Disambiguation | PASSING | CLEAN | ✓ |
| PB6 | Context Survival Through Disambiguation | VIOLATED | IMPROVED | ↑ |
| PB7 | Opening Message Preservation | VIOLATED | IMPROVED | ↑ |
| PB8 | Operational Detail Preservation | VIOLATED | IMPROVED | ↑ |
| PB9 | No Category Picker Regression | VIOLATED | PARTIALLY RESOLVED | ↑ |
| PB10 | Frustration and Escalation Handling | AT RISK | ESCALATION/CHASE GAP | → |

### Structural Elements — Confirmed Stable

| Element | Status |
|---|---|
| Bounded disambiguation model | **CONFIRMED CLEAN** — evaluator verified |
| Hidden taxonomy | **CONFIRMED CLEAN** — evaluator verified |
| Cross-domain routing | **CONFIRMED STABLE** — no misroutes |
| Conversational intake architecture | **CONFIRMED STABLE** — three-phase model intact |
| No unrestricted interrogation | **CONFIRMED CLEAN** — one-question limit respected |

---

## 3. Remaining Critical Blockers

### BLOCKER-1: Security-Sensitive Acknowledgement Must Interpolate Affected Person Names

**Evaluator finding:** Security-sensitive fast-track fires correctly (H1 routing works), but the acknowledgement does not include the name of the affected person when the customer provides it.

**Example failure pattern:** Customer says "Remove Sarah Jenkins immediately, she was fired today." System responds "Understood — I'll get this raised urgently. Could you confirm their email address?" — but never references "Sarah Jenkins."

**Root cause hypothesis:** The H1 pre-emption regex triggers a fast-track route, but the fast-track response template is static. It doesn't extract and interpolate the affected person's name from the matched message before generating the acknowledgement.

**Hardening direction:** When the security-sensitive fast-track fires, extract any person names from the triggering message and interpolate them into the acknowledgement. "Understood — I'll get Sarah Jenkins's access removed urgently." This is acknowledgement template enrichment, not routing change.

**Protected behaviours at stake:** PB4, PB6, PB7

**Success criterion:** Security-sensitive scenarios that include a person name produce acknowledgements that reference that name by name.

---

### BLOCKER-2: Website Design WR1 Regression — Phone Number Detail Preservation

**Evaluator finding:** WR1 persists from Iteration 2. A Website Design scenario containing a phone number loses that phone number in the contextual acknowledgement.

**Root cause hypothesis:** The H6 prompt tightening reduced Account Setup verbosity but did not sufficiently strengthen the phone-number preservation signal in the Website Design acknowledgement path. The field extraction instruction mentions "verbatim" but the LLM may still drop phone numbers when they appear alongside other details.

**Hardening direction:** Strengthen the detail interpolation specifically for phone numbers and addresses in the acknowledgement generation instruction. This may require an explicit "MUST include" rule for phone numbers, addresses, and reference numbers in acknowledgements — not just a general "preserve specifics" instruction.

**Protected behaviours at stake:** Website Design regression protection (operational detail preservation)

**Success criterion:** WR1 scenario passes. All Website Design frozen holdouts pass. Phone numbers, addresses, and reference numbers are present in all acknowledgements where the customer provided them.

**Governance note:** This is a protected-domain regression. It gates Iteration 3 sign-off regardless of Account Setup pass rate.

---

### BLOCKER-3: RBAC Terminology Echo Bypass

**Evaluator finding:** The H4 vocabulary firewall catches primary terms (RBAC, provisioning, deprovisioning, authentication, authorisation) but the LLM produces near-miss reformulations or synonyms that convey the same internal concepts.

**Root cause hypothesis:** The forbidden term list is pattern-exact. The LLM rephrases around it — using "role-based access" instead of "RBAC", or "access permissions" in a way that exposes the internal permission model rather than reflecting the customer's language.

**Hardening direction:** Shift from a forbidden-term list to a positive-frame instruction: "Always use the customer's own words to describe their problem. If they said 'she can't see anything', say 'she can't see anything' — do not translate into access/permission/role terminology." The firewall remains as a safety net, but the primary control becomes vocabulary mirroring rather than vocabulary blocking.

**Protected behaviours at stake:** PB1, PB3

**Success criterion:** Zero instances of internal permission/access/role terminology in customer-facing responses where the customer did not introduce those terms themselves. PB3 exception preserved: if the customer uses technical terms, the system may mirror them without expansion.

---

### BLOCKER-4: Category-Picker Fallback for Technically-Worded Access Requests (TS3)

**Evaluator finding:** "API endpoint access" triggers the category picker. The domain keyword detectors (H2) don't recognise "API" + "access" as an account-domain signal.

**Root cause hypothesis:** The `detectAccountFromKeywords()` function covers natural-language account vocabulary (account, login, user, password, office, branch, access, permission) but does not cover technically-worded variants where "access" co-occurs with technical terms like "API", "endpoint", or "integration."

**Hardening direction:** Extend the account keyword detector to recognise "access" as a strong account-domain signal regardless of what it co-occurs with. The word "access" in any context signals an account/permission issue. If the technical nature creates ambiguity, it should route to conversational clarification — never to the picker.

**Protected behaviours at stake:** PB9

**Success criterion:** Messages containing "access" in any context (technical, natural, mixed) route to conversational clarification or direct classification — never to the category picker.

---

### BLOCKER-5: Category-Picker Fallback for Escalation/Chase Messages (HO8)

**Evaluator finding:** "I raised this two weeks ago" — an escalation/chase message with no explicit domain signal — falls to the category picker.

**Root cause hypothesis:** The system treats escalation/chase signals ("raised this", "already reported", "following up", "chasing", "nobody has helped", "been waiting") as metadata rather than domain signals. When no domain vocabulary is present, the system sees no signal and falls to the picker. But escalation/chase messages ARE a domain signal — they indicate an existing ticket/request that needs attention.

**Hardening direction:** Add escalation/chase semantic detection to the pre-picker fallback path. Signals like "raised this", "following up", "chasing", "already reported", "been waiting", "two weeks ago", "still not resolved" should trigger conversational clarification ("Could you tell me a bit more about the issue you originally raised?") rather than falling to the picker.

This is a new signal class — not a new domain. Escalation/chase messages are domain-agnostic but should be handled conversationally, not structurally. The clarification question should surface the underlying domain, which then routes normally.

**Protected behaviours at stake:** PB9, PB10

**Success criterion:** Messages expressing escalation, chase, or re-raised intent trigger conversational follow-up asking about the original issue. Category picker never appears for escalation/chase messages.

---

## 4. Non-Blocking Improvements

These are quality improvements that do not gate convergence:

| Item | Description | Why Non-Blocking |
|---|---|---|
| Acknowledgement tone variation | Some acknowledgements feel formulaic | Does not break routing, detail preservation, or operational usability. Polish gap. |
| Follow-up question naturalness | Some follow-up questions slightly mechanical | Functionally correct and symptom-focused. Quality gradient, not binary pass/fail. |
| Optional field extraction | Department, start date not always captured | Core operational fields captured. Optional fields are quality improvement. |
| Multi-entity relationship modelling | User + office + branch as linked entities | Current flat-field model sufficient for convergence. Future enhancement. |

---

## 5. Narrow Blocker-Fix Goals

Iteration 3 has five goals, one per blocker. All are prompt conditioning, keyword detection, or template enrichment. No architectural changes.

| Goal | Target | Type | Dependency |
|---|---|---|---|
| F1 | Security-sensitive acknowledgement interpolates affected person names | Acknowledgement template enrichment | Independent |
| F2 | Website Design WR1 phone-number preservation | Acknowledgement interpolation strengthening | Independent |
| F3 | Vocabulary mirroring replaces vocabulary blocking as primary terminology control | Prompt conditioning shift | Independent |
| F4 | "Access" recognised as account-domain signal in all contexts | Keyword detector extension | Independent |
| F5 | Escalation/chase semantic detection before picker fallback | New signal class in pre-picker path | Independent |

**Implementation constraint:** All fixes are in `src/server/services/portal-chat.ts`. Prompt conditioning, keyword detection, and response template changes only. No changes to:
- Classification → disambiguation → summarisation pipeline structure
- Confidence thresholds (unless evaluator evidence demands it)
- Database schema
- Route handlers
- Frontend components

**Expected interaction:** F1 and F2 share the acknowledgement interpolation concern — both require the LLM to include specific details in its response. The fix for one may partially address the other. F3 (vocabulary mirroring) may be the most impactful single change, as positive-frame instructions tend to generalise better than negative lists.

---

## 6. Explicitly Out-of-Scope Items

| Item | Reason for Exclusion |
|---|---|
| Full multi-entity modelling | Architectural expansion. Flat-field model sufficient for convergence. |
| Unrestricted interrogation flows | Violates PB5. One-question limit non-negotiable. |
| Direct holdout wording optimisation | Violates evaluator governance. Build agent targets behavioural patterns, not test phrases. |
| New conversational models | Evaluator confirms current model is correct. No redesign warranted. |
| Disambiguation redesign | Bounded disambiguation confirmed CLEAN. No modification. |
| Two-stage classification architecture | Architectural change. Only permitted as last resort per regression considerations. |
| New domain signal detection (Template/Email, Integration, Data/Reporting) | Future domains. Not part of current convergence cycle. |
| Category picker redesign | The picker exists as last resort for genuinely unclassifiable input. The fix is to reduce what reaches it, not to redesign it. |
| Confidence threshold restructuring | Thresholds are functioning. The gaps are in signal recognition and response quality, not classification confidence. |

---

## 7. Regression Risks

### Active Regression (must resolve)

| Risk | Status | Mitigation |
|---|---|---|
| WR1: Website Design phone number detail loss | **STILL ACTIVE** from Iteration 2 | Blocker F2. Explicit phone-number interpolation instruction. Gates Iteration 3 sign-off. |

### Monitored Risks (must verify clean after build)

| Risk ID | Description | Detection Method |
|---|---|---|
| RR1 | Website Design misroute (office/account vocabulary pulling website requests) | Run Website Design frozen holdout suite |
| RR2 | Property / Listing Issues misroute | Run Property frozen holdout suite |
| RR3 | Shared behaviour degradation | Run shared-behaviour regression suite |
| RR4 | Disambiguation leakage into protected domains | Verify no new disambiguation questions in Website Design or Property scenarios |
| RR5 | Prompt expansion side effects | Compare holdout accuracy before/after |

### New Risks Introduced by Iteration 3 Fixes

| Risk | Source | Mitigation |
|---|---|---|
| Over-broad "access" signal (F4) | Treating "access" as always account-domain may pull non-account messages | "Access" triggers conversational clarification, not direct routing. Clarification resolves any ambiguity. Website Design and Property paths are not affected because they have their own stronger signals. |
| Over-broad escalation detection (F5) | Chase/escalation patterns may match messages that aren't actually escalations | Escalation detection triggers conversational follow-up ("tell me more about the original issue"), not direct routing. If the follow-up reveals a different domain, routing adjusts. Low risk. |
| Vocabulary mirroring over-correction (F3) | Shifting from blocklist to positive mirroring may cause the LLM to parrot the customer's exact phrasing unnaturally | The instruction requires mirroring the customer's vocabulary, not parroting their sentence structure. "Use the customer's own words" ≠ "repeat the customer's message." |
| Acknowledgement over-interpolation (F1, F2) | Stronger interpolation requirements may make acknowledgements feel like they're repeating everything the customer said | The one-to-two sentence constraint on acknowledgements still applies. Interpolation is selective (names, phone numbers, key details), not exhaustive. |

---

## 8. Iteration Success Criteria

Iteration 3 is considered successful when ALL of the following are true:

### Blocker Resolution

- [ ] F1: Security-sensitive acknowledgements include affected person names when provided
- [ ] F2: Website Design WR1 resolved — phone numbers preserved in acknowledgements
- [ ] F3: Zero RBAC/permission terminology echo in customer-facing responses
- [ ] F4: "API endpoint access" and similar technically-worded access requests do not trigger picker
- [ ] F5: Escalation/chase messages ("I raised this two weeks ago") do not trigger picker

### Regression Protection

- [ ] Website Design frozen holdout suite: 100% pass (including WR1)
- [ ] Property / Listing Issues frozen holdout suite: 100% pass
- [ ] Bounded disambiguation: CLEAN (no regression from Iteration 2 retest)
- [ ] Hidden taxonomy: CLEAN
- [ ] No unrestricted interrogation introduced
- [ ] No new disambiguation questions in protected domains

### Evaluation Threshold

- [ ] Account Setup holdout suite: ≥90% pass rate (improvement from 80%)
- [ ] Evaluator-projected: ~93% achievable with all five blockers resolved
- [ ] No critical behavioural blockers remaining

---

## 9. Convergence-Candidate Criteria

If Iteration 3 achieves the success criteria above, the domain becomes a convergence candidate. Convergence candidacy requires:

| Criterion | Threshold | Current Status |
|---|---|---|
| Pass rate | ≥90% | 80% (need ≥90%) |
| Critical blockers | 0 | 5 remaining |
| Website Design regression | CLEAN | WR1 ACTIVE |
| Property regression | CLEAN | CLEAN ✓ |
| Bounded disambiguation | CLEAN | CLEAN ✓ |
| Hidden taxonomy | CLEAN | CLEAN ✓ |
| No unrestricted interrogation | CLEAN | CLEAN ✓ |
| Architecture stable | CONFIRMED | CONFIRMED ✓ |

**Convergence evaluation** (if candidate criteria met) would then require:
- Full regression suite (all protected domains)
- Disambiguation criteria D1-D6 verified
- All frozen holdouts for all protected domains
- Cross-domain collision suite
- Human + Manager convergence review

**Governance:** Convergence candidacy is declared by the evaluator after retest, not by the build agent or this plan. This plan defines what "ready for convergence evaluation" looks like — it does not claim convergence.

---

## 10. Regression-Protection Readiness Assessment

### Can Account Setup Become Regression Protected After Iteration 3?

**Assessment: Conditional yes.**

The domain has the structural prerequisites for regression protection:
- Architecture stable and confirmed across two evaluation cycles
- Bounded disambiguation model confirmed clean and reusable
- Hidden taxonomy confirmed clean
- No unrestricted interrogation
- Cross-domain routing stable
- 10 protected behaviours defined with clear violation criteria

The remaining gap is behavioural polish. If the five blockers are resolved and the pass rate reaches ≥90% with zero critical blockers, the domain's behavioural surface is sufficiently hardened to protect.

### Regression Protection Would Cover:

All 10 Account Setup protected behaviours (PB1–PB10), plus:
- Bounded disambiguation as a reusable programme pattern
- Escalation/chase handling as a cross-domain concern
- Vocabulary mirroring as a response-quality standard

### Regression Protection Would NOT Cover:

- Multi-entity modelling (not implemented)
- Full edge-case field extraction (non-blocking quality gap)
- Acknowledgement tone variation (polish gap)
- Future domain signals (Template/Email, Integration, Data/Reporting)

### What Happens After Protection:

Account Setup becomes the third regression-protected domain. The disambiguation pattern (bounded, one-question, symptom-focused) becomes the confirmed programme template for future domains. Future domain expansions must validate against:
- Website Design frozen holdouts
- Property / Listing Issues frozen holdouts
- Account Setup frozen holdouts (newly protected)
- Cross-domain collision suite (all three domains)

---

## Appendix: Iteration Trajectory

| Iteration | Pass Rate | Blockers | Status |
|---|---|---|---|
| 1 (initial build) | 55% (30/55) | 6 | Structural foundation, behavioural gaps |
| 2 (hardening) | 80% (44/55) | 5 | Routing fixed, acknowledgement gaps remain |
| 3 (blocker fix) | Target ≥90% (~93% projected) | 0 target | Behavioural polish, convergence candidate |

## Appendix: Blocker-to-Protected-Behaviour Traceability

| Blocker | PB1 | PB3 | PB4 | PB5 | PB6 | PB7 | PB8 | PB9 | PB10 | WD Regression |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 Security-sensitive ack interpolation | | | X | | X | X | | | | |
| F2 WR1 phone number preservation | | | | | | | | | | X |
| F3 RBAC terminology translation | X | X | | | | | | | | |
| F4 "Access" signal recognition | | | | | | | | X | | |
| F5 Escalation/chase semantic handling | | | | | | | | X | X | |

## Appendix: Evaluator Score Context

| Metric | Iteration 1 | Iteration 2 Retest | Iteration 3 Target |
|---|---|---|---|
| Total checks | 55 | 55 | 55 |
| Passed | 30 | 44 | ≥50 (~93%) |
| Failed | 25 | 11 | ≤5 |
| Pass rate | 55% | 80% | ≥90% |
| Property regression | CLEAN | CLEAN | CLEAN |
| Website Design regression | WR1 VIOLATION | WR1 STILL ACTIVE | CLEAN |
| Bounded disambiguation | CLEAN | CLEAN | CLEAN |
| Hidden taxonomy | CLEAN | CLEAN | CLEAN |
| Architecture | SOUND | STABLE | STABLE |
| Blocker count | 6 | 5 | 0 |

---

## Governance

- Programme tracker (`programme_tracker.md`) has NOT been updated.
- Tracker mutation awaits: Iteration 3 build → evaluator retest → human + manager convergence review.
- This document is a blocker-fix plan, not a claim of convergence or progress.
