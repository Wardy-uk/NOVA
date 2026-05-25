# Account Setup / Office Changes — Iteration 2 Hardening Plan

## Status

- **Domain:** Account Setup / Office Changes
- **Iteration:** 2 (hardening)
- **Predecessor:** Iteration 1 evaluation (30/55, 55%, NOT CONVERGED)
- **Created:** 2026-05-19
- **Programme authority:** spec/orchestration/attractor_programme_methodology.md

---

## 1. Behavioural Interpretation of Evaluator Findings

The Iteration 1 evaluation reveals a structurally sound system with behavioural hardening failures. The architecture is not the problem. The conversational intake model, the bounded disambiguation primitive, and the cross-domain routing all function. What fails is the depth of behavioural conditioning in specific pressure scenarios.

The 55% pass rate is misleading in isolation. The failures cluster in a small number of behavioural gaps that repeat across multiple scenarios, not in broadly distributed architectural problems. This is the expected pattern for a first-iteration build — the scaffolding works, the edges don't.

### Evaluator Pressure Map

| Evaluator Finding | Behavioural Interpretation | Severity |
|---|---|---|
| Security-sensitive requests fall to category picker | PB4 (Security Fast Track) and PB9 (No Category Picker) both violated. The system lacks a fast-path detection layer for urgency/removal signals. It treats these as ambiguous when they are unambiguous. | **BLOCKER** |
| Vague account messages collapse to category picker | PB9 violated. The system's confidence threshold is too aggressive — it drops to the picker when domain signal is present but not strong. The conversational clarification path is underused. | **BLOCKER** |
| Contextual detail loss in acknowledgements | PB6 (Context Survival), PB7 (Opening Message Preservation), PB8 (Operational Detail Preservation) violated. The LLM generates acknowledgements that summarise rather than preserve. Details from the customer's opening message are paraphrased away or dropped. | **BLOCKER** |
| Terminology echoing (RBAC, provisioning, etc.) | PB1 (Invisible Classification), PB3 (Permission Model Opacity) violated. The LLM reflects internal classification vocabulary back to the customer instead of maintaining the customer's own language. | **BLOCKER** |
| Weak multi-issue handling | PB8 (Operational Detail Preservation) violated. When a customer describes multiple issues in one message, the system captures one and drops the rest. The accumulation pattern is not working for compound opening messages. | **BLOCKER** |
| Website Design regression WR1 — phone number contextual acknowledgement loss | Regression protection violation. A previously passing Website Design scenario now loses contextual detail (phone number) in its acknowledgement. This is a cross-domain side effect of the Account Setup prompt expansion. | **BLOCKER** |

### Critical Insight

Five of six blockers share a common root: the system defaults to structural fallback (category picker, generic summary, paraphrased acknowledgement) when it should default to conversational engagement (clarification, detail preservation, vocabulary mirroring). The architecture supports the right behaviour — the LLM conditioning does not consistently produce it.

---

## 2. Structural Strengths Confirmed by Evaluator

The evaluator confirms the following structural elements are sound and must not be modified:

| Structural Element | Evaluator Signal | Status |
|---|---|---|
| Bounded disambiguation model | Disambiguation logic itself rated GOOD. One-question limit respected. Symptom-focused framing working. | **CONFIRMED SOUND** |
| Login-vs-website routing | Strong cross-domain routing. "I can't log in to update the website" correctly routes to Account Setup with website context preserved. | **CONFIRMED SOUND** |
| Office-vs-website routing | Strong cross-domain routing. "Website shows old office address" correctly routes to Website Design. | **CONFIRMED SOUND** |
| Hidden taxonomy in routing | No taxonomy leakage in the routing decision itself. Leakage occurs in acknowledgement generation, not routing. | **CONFIRMED SOUND** |
| Property regression protection | CLEAN. No Property / Listing Issues holdout degraded. | **CONFIRMED SOUND** |
| Conversational intake architecture | The three-phase model (classify → disambiguate/clarify → summarise) is structurally correct. | **CONFIRMED SOUND** |

**Governance decision:** These confirmed-sound elements are load-bearing. Iteration 2 must not modify them. Hardening targets the behavioural layer that sits on top of this architecture.

---

## 3. Confirmed Protected Behaviours

### Website Design / Content Changes — REGRESSION PROTECTED (2026-05-19)

All protected behaviours from Website Design must remain stable. The WR1 regression (phone number contextual acknowledgement loss) means this protection is currently violated. Resolving WR1 is a prerequisite for Iteration 2 sign-off.

Protected behaviours under regression watch:
- Hidden taxonomy
- Conversational continuity
- Opening-message preservation
- Operational detail preservation
- Attachment awareness
- Human escalation acknowledgement

### Property / Listing Issues — REGRESSION PROTECTED (2026-05-19)

All protected behaviours confirmed CLEAN by evaluator. No action required.

Protected behaviours under regression watch:
- Hidden taxonomy
- Conversational continuity
- Opening-message preservation
- Operational detail preservation
- Attachment awareness
- Human escalation acknowledgement
- Portal/feed complexity hidden

### Account Setup Protected Behaviours (target state)

All 10 protected behaviours from `account_setup_protected_behaviours.md` are the target. The following are currently violated and must be hardened:

| PB | Name | Current State |
|---|---|---|
| PB1 | Invisible Classification | VIOLATED — terminology echoing |
| PB3 | Permission Model Opacity | VIOLATED — RBAC/provisioning terms surfaced |
| PB4 | Security-Sensitive Fast Track | VIOLATED — falls to picker |
| PB5 | Bounded Disambiguation | PASSING — confirmed by evaluator |
| PB6 | Context Survival Through Disambiguation | VIOLATED — detail loss |
| PB7 | Opening Message Preservation | VIOLATED — detail loss |
| PB8 | Operational Detail Preservation | VIOLATED — multi-issue collapse |
| PB9 | No Category Picker Regression | VIOLATED — vague messages fall to picker |
| PB10 | Frustration and Escalation Handling | NOT FULLY TESTED — assumed at risk given PB4 violations |

---

## 4. Critical Blockers

These must be resolved before Iteration 2 can be evaluated. Each traces to specific protected behaviour violations and specific evaluator failures.

### BLOCKER-1: Security-sensitive requests must not reach the category picker

**Evaluator finding:** Urgent removal/revocation requests are treated as ambiguous and fall to the picker.

**Root cause hypothesis:** The confidence threshold and/or classification prompt does not give sufficient weight to urgency/security signals ("remove", "fired", "terminated", "revoke", "immediately", "urgent"). These signals are unambiguous per the clarification strategy — they should bypass both disambiguation AND the picker.

**Hardening direction:** Introduce security-sensitive signal detection that pre-empts the normal classification path. When detected, route directly to Account Setup with urgency flag, minimal follow-up (identity confirmation only), no disambiguation, no picker.

**Protected behaviours at stake:** PB4, PB9

**Success criterion:** 100% of security-sensitive scenarios bypass the picker and generate urgency-aware acknowledgements with minimal follow-up.

---

### BLOCKER-2: Vague-but-domain-signalled messages must reach conversational clarification, not the picker

**Evaluator finding:** Messages like "something's wrong with our account" or "we need some changes to users" collapse to the category picker instead of triggering conversational clarification.

**Root cause hypothesis:** The confidence threshold treats "present but weak" domain signals the same as "absent" signals. The system has two modes — high-confidence route and no-confidence picker — but lacks the middle path: medium-confidence conversational clarification.

**Convergence principle candidate:** Conversational clarification must beat category-picker fallback for vague-but-domain-signalled requests. When any account/access/user/office signal is present, the system must attempt conversational clarification before falling to the picker. The picker is the fallback for genuinely unclassifiable messages, not for vague-but-signalled ones.

**Hardening direction:** Lower the threshold at which conversational clarification activates, or introduce a "domain signal detected but ambiguous" tier that routes to clarification rather than the picker. This is a threshold adjustment, not an architectural change.

**Protected behaviours at stake:** PB5, PB9

**Success criterion:** Vague messages containing any account-domain vocabulary trigger conversational follow-up. Category picker appears only when no domain signal is detectable.

---

### BLOCKER-3: Acknowledgements must preserve contextual detail from the customer's message

**Evaluator finding:** The system generates acknowledgements that summarise or paraphrase the customer's message, dropping specific details (names, locations, error descriptions, quantities, timelines).

**Root cause hypothesis:** The LLM's acknowledgement generation prompt optimises for brevity/coherence over completeness. The instruction to "acknowledge what the customer said" is being interpreted as "summarise the gist" rather than "reflect the specifics."

**Hardening direction:** Tighten the acknowledgement generation instruction to require reflection of specific operational details from the customer's message. The acknowledgement should mirror key nouns and specifics, not just the general intent. This is prompt conditioning, not architectural change.

**Protected behaviours at stake:** PB6, PB7, PB8

**Success criterion:** Acknowledgements for detailed messages contain all operationally significant specifics from the customer's input (names, locations, error messages, system references, quantities, timelines).

---

### BLOCKER-4: Internal classification terminology must not appear in customer-facing responses

**Evaluator finding:** The system echoes terms like "RBAC", "provisioning", "authentication", "authorisation" in its responses to customers.

**Root cause hypothesis:** The classification prompt introduces these terms for internal routing purposes, and the LLM carries them forward into the customer-facing acknowledgement because it lacks a strong boundary instruction between classification vocabulary and response vocabulary.

**Hardening direction:** Add explicit negative instruction in the response generation layer: never surface classification terms. Provide a vocabulary translation map (internal term → customer-friendly equivalent or omission). This is prompt conditioning, not architectural change.

**Protected behaviours at stake:** PB1, PB3

**Success criterion:** Zero instances of internal classification vocabulary in any customer-facing response across the full evaluation suite.

---

### BLOCKER-5: Multi-issue messages must preserve all issues in the summary

**Evaluator finding:** When a customer describes multiple issues ("I'm locked out AND the new users aren't set up"), only one issue is captured.

**Root cause hypothesis:** The classification/summarisation prompt extracts the primary intent and discards secondary intents. The accumulation pattern described in PB8 is not implemented or not effective.

**Hardening direction:** Ensure the summarisation instruction explicitly requires enumeration of all distinct issues mentioned. For multi-issue messages, the summary should list each issue as a separate item, not collapse them into a single category.

**Protected behaviours at stake:** PB8

**Success criterion:** Multi-issue messages produce summaries that contain every distinct issue the customer raised, with operational detail preserved for each.

---

### BLOCKER-6: Website Design regression WR1 must be resolved

**Evaluator finding:** A Website Design scenario that previously passed now loses a phone number in its contextual acknowledgement.

**Root cause hypothesis:** The Account Setup prompt expansion has diluted the LLM's attention to detail preservation in Website Design scenarios. This is the Regression Risk 5 (Prompt Expansion Side Effects) predicted in `account_setup_regression_considerations.md`.

**Hardening direction:** Per the mitigation strategy in the regression considerations spec: first, tighten Account Setup signal descriptions (more concise). Second, verify Website Design detail preservation instructions are not being displaced. This is prompt tuning, not architectural change.

**Protected behaviours at stake:** Website Design regression protection (detail preservation)

**Success criterion:** WR1 scenario passes. Full Website Design frozen holdout suite passes. Phone number and all other contextual details preserved in acknowledgements.

---

## 5. Non-Blocking Improvements

These are quality improvements identified by the evaluator that do not compromise the protected behavioural model. They may be addressed in Iteration 2 if achievable without risk, but their absence does not block convergence.

| Item | Description | Why Non-Blocking |
|---|---|---|
| Acknowledgement tone variation | Some acknowledgements feel formulaic. More natural variation would improve customer experience. | Does not break routing, detail preservation, or operational usability. Polish gap. |
| Follow-up question naturalness | Some follow-up questions are slightly mechanical in phrasing. | The questions are functionally correct and symptom-focused. Naturalness is a quality gradient, not a binary pass/fail. |
| Edge-case field extraction | Optional fields (e.g., department, start date for new user) are sometimes not extracted when the customer provides them. | Core operational fields are captured. Optional field extraction is a quality improvement, not a behavioural gap. |

---

## 6. Hardening Goals

Iteration 2 has six hardening goals, one per blocker. The goals are ordered by dependency — some fixes may partially address multiple blockers.

| Goal | Target | Dependency |
|---|---|---|
| H1 | Security-sensitive signal detection and fast-track path | Independent |
| H2 | Conversational clarification activation for vague-but-signalled messages | Independent |
| H3 | Detail-preserving acknowledgement conditioning | Independent |
| H4 | Classification vocabulary firewall in response generation | Independent |
| H5 | Multi-issue preservation in summarisation | Partially overlaps H3 |
| H6 | Website Design regression WR1 resolution | May be resolved by prompt tightening in H4 |

**Expected interaction:** H3 and H5 share the detail preservation concern and may be addressed together. H4 and H6 share the prompt expansion concern — tightening the Account Setup prompt may resolve both the terminology leak and the Website Design regression.

**Implementation constraint:** All hardening is prompt conditioning and threshold adjustment. No architectural changes. No new runtime components. No changes to the classification → disambiguation → summarisation pipeline structure.

---

## 7. Explicitly Out-of-Scope Items

The following are explicitly excluded from Iteration 2 hardening. They are either future-domain work, architectural changes, or optimisations that would violate programme governance.

| Item | Reason for Exclusion |
|---|---|
| Full multi-entity modelling (user + office + branch as distinct entities with relationships) | Architectural expansion beyond current scope. The current flat-field model is sufficient for Account Setup convergence. |
| Unrestricted interrogation flows (unlimited follow-up questions) | Violates bounded disambiguation principle. One-question limit is non-negotiable per PB5 and clarification strategy. |
| Direct holdout wording optimisation | Violates evaluator governance. Build agent must not see holdout scenarios. Hardening is directed at behavioural patterns, not specific test phrases. |
| Template/Email domain signals | Future domain. Not part of current convergence cycle. |
| Integration domain signals | Future domain. Not part of current convergence cycle. |
| Data/Reporting domain signals | Future domain. Not part of current convergence cycle. |
| Two-stage classification architecture | Architectural change. Only permitted as last resort per regression considerations spec, and only if prompt tightening fails to resolve Regression Risk 5. |
| Disambiguation for Property / Listing Issues | Property is regression protected with no disambiguation. Introducing it would be a regression. |
| Disambiguation for Website Design | Website Design is regression protected with no disambiguation. Introducing it would be a regression. |

---

## 8. Regression Risks

### Active Regression (must resolve)

| Risk | Status | Mitigation |
|---|---|---|
| WR1: Website Design phone number detail loss | **ACTIVE REGRESSION** | Blocker H6. Prompt tightening. Must pass before Iteration 2 evaluation. |

### Monitored Risks (must verify clean)

| Risk ID | Description | Detection Method |
|---|---|---|
| RR1 | Website Design misroute (office vocabulary pulling website requests to Account Setup) | Run Website Design frozen holdout suite |
| RR2 | Property / Listing Issues misroute | Run Property frozen holdout suite |
| RR3 | Shared behaviour degradation (opening message, continuity, taxonomy, frustration) | Run shared-behaviour regression suite (12 tests) |
| RR4 | Disambiguation leakage into protected domains | Verify Property and Website Design scenarios do not generate new disambiguation questions |
| RR5 | Prompt expansion side effects on existing domain accuracy | Compare holdout accuracy before/after hardening |

### New Risk Introduced by Hardening

| Risk | Source | Mitigation |
|---|---|---|
| Over-broad security fast-track | H1 may trigger on non-urgent messages containing removal/access vocabulary | Test with non-urgent removal scenarios ("when you get a chance, could you remove the old test user?") to verify urgency detection is not just keyword matching |
| Over-sensitive conversational clarification | H2 may cause the system to ask clarifying questions for messages that should route directly | Test with clear-intent scenarios (password reset, explicit login failure) to verify direct routing still works |
| Over-verbose acknowledgements | H3 may cause acknowledgements to become unnaturally long or parrot-like | Test naturalness alongside completeness |

---

## 9. Iteration Success Criteria

Iteration 2 is considered successful when ALL of the following are true:

### Blocker Resolution

- [ ] BLOCKER-1: Security-sensitive requests bypass picker (100% of security scenarios)
- [ ] BLOCKER-2: Vague-but-signalled messages reach conversational clarification (0% picker fallback for domain-signalled messages)
- [ ] BLOCKER-3: Acknowledgements preserve contextual detail (all operationally significant specifics reflected)
- [ ] BLOCKER-4: Zero internal terminology in customer-facing responses
- [ ] BLOCKER-5: Multi-issue messages preserve all issues in summary
- [ ] BLOCKER-6: Website Design WR1 regression resolved

### Regression Protection

- [ ] Website Design frozen holdout suite: 100% pass
- [ ] Property / Listing Issues frozen holdout suite: 100% pass
- [ ] Shared-behaviour regression suite: 100% pass (12 tests)
- [ ] Disambiguation leakage check: 0 new disambiguation questions in protected domains
- [ ] No new regressions introduced by hardening

### Evaluation Threshold

- [ ] Account Setup holdout suite: ≥80% pass rate (improvement from 55%)
- [ ] Disambiguation criteria D1-D6: all passing
- [ ] No critical behavioural blockers remaining

### Convergence Readiness

Iteration 2 does NOT need to achieve convergence. It needs to:
1. Resolve all six blockers
2. Maintain regression protection for both protected domains
3. Reach ≥80% on the evaluation suite
4. Leave no critical blockers

If ≥80% is reached with no critical blockers, the domain may be a candidate for convergence evaluation. If not, Iteration 3 targets the remaining gaps.

---

## 10. Convergence Direction Assessment

### Where We Are

The Account Setup domain completed its first build iteration with a structurally sound architecture and a 55% evaluation pass rate. The failures are behavioural, not architectural. This is the expected trajectory — first iteration establishes structure, subsequent iterations harden behaviour.

### What the Evaluator Is Telling Us

The evaluator is applying pressure on the **conversational quality layer**, not the **routing layer**. Routing is strong. Disambiguation is sound. What fails is:
- how the system responds to what it classified (terminology leak, detail loss)
- when it gives up on classification too early (picker fallback for signalled messages)
- how it handles high-urgency signals (no fast-track path)

This is a well-defined hardening surface. The fixes are prompt conditioning and threshold adjustment, not restructuring.

### Convergence Principle Candidate

**Conversational clarification must beat category-picker fallback for vague-but-domain-signalled requests.**

This principle, if confirmed through Iteration 2 hardening, should be elevated to a programme-level convergence principle in `convergence_loop_operating_process.md`. It applies beyond Account Setup — every future domain will face the same pressure point between "picker safety" and "conversational engagement."

The principle encodes: the picker is a last resort for genuinely unclassifiable input, not a safe default for anything below high confidence. Domain signal presence — even weak signal — should trigger conversational engagement before structural fallback.

### Projected Trajectory

| Iteration | Expected Outcome |
|---|---|
| Iteration 2 (this plan) | Resolve all 6 blockers. Reach ≥80%. Establish detail preservation and vocabulary firewall patterns. |
| Iteration 3 (if needed) | Polish remaining edge cases. Achieve ≥90%. Candidate for convergence evaluation. |
| Convergence evaluation | Full regression suite + disambiguation D1-D6 + all frozen holdouts. Target: CONVERGED + REGRESSION PROTECTED. |

### Risk to Programme Timeline

Low. The failures are concentrated and well-characterised. The architecture does not need modification. The hardening work is prompt-level, not code-level (beyond threshold adjustments). Iteration 2 should be achievable in a single build cycle.

### Governance Note

The programme tracker must NOT be updated until:
1. Iteration 2 hardening is implemented
2. Evaluator retest confirms blocker resolution
3. Human convergence review approves the results

This plan is a directive for the build agent, not a claim of progress.

---

## Appendix: Blocker-to-Protected-Behaviour Traceability

| Blocker | PB1 | PB2 | PB3 | PB4 | PB5 | PB6 | PB7 | PB8 | PB9 | PB10 |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 Security fast-track | | | | X | | | | | X | X |
| B2 Picker fallback | | | | | X | | | | X | |
| B3 Detail preservation | | | | | | X | X | X | | |
| B4 Terminology firewall | X | | X | | | | | | | |
| B5 Multi-issue | | | | | | | | X | | |
| B6 WR1 regression | | | | | | | | | | |

---

## Appendix: Evaluator Score Context

| Metric | Value |
|---|---|
| Total checks | 55 |
| Passed | 30 |
| Failed | 25 |
| Pass rate | 55% |
| Property regression | CLEAN |
| Website Design regression | WR1 VIOLATION |
| Disambiguation (D1-D6) | GOOD |
| Architecture | SOUND |
| Blocker count | 6 |
| Non-blocking count | 3 |
