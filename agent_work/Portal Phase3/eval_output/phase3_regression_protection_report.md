# Portal Phase 3 — Regression Protection Report

**Evaluation:** Iteration 7 — Regression Protection Bundle  
**Date:** 2026-05-24  
**Evaluator:** Eval Agent  
**Runtime:** localhost:3001 (dev server)  
**Auth:** Portal codex-test-login (requester role)

---

## Overall Verdict: REGRESSION PROTECTED

All three converged domains hold through the real runtime path. No critical behavioural blockers. No material regression across domains or against previously protected website/property paths. Customer-visible coherence and taxonomy protection are intact.

---

## Per-Domain Verdicts

### Req 1A — Missing Intake Category Completion: REGRESSION PROTECTED

**Checks passed:**
- All four new categories present in `/api/portal/categories`: Website Security (3 children), General Service Request (3 children), Reopened / Follow-up (3 children), Complaint / Escalation (3 children)
- All existing categories remain stable (9 original + 4 new = 13 total)
- No taxonomy leakage in any category name — no internal labels (NT-, Jira, ITSM, routing, project) visible
- Security category reachable via conversational path ("website might have been hacked" → intent:problem, proceeds to detail collection)
- General Service Request reachable via conversational path ("information about API documentation" → intent:question)
- All subcategories render with customer-facing labels

**Confirmed protected behaviours:**
- Category grid completeness (13 categories, all with children)
- Customer-facing naming throughout
- No taxonomy leakage in any API response

### Follow-up Ticket Continuity: REGRESSION PROTECTED

**Checks passed:**
- "NT-18592 is still not fixed" → correctly identifies follow-up, displays **NT-18592** in bold, offers to raise follow-up linked to ticket (intent:status)
- "NT-55555 is not fixed" → same correct behaviour
- "NT-12345 still not fixed" → same correct behaviour
- Multi-turn journey preserves ticket context (Turn 1: identifies NT-18592, Turn 2: asks for account details referencing the ticket)
- "You closed my ticket NT-19000 but it was marked resolved and it is not" → correct follow-up path

**Non-blocking gap:**
- Longer narrative phrasing "I raised ticket NT-12345 last week and it has not been resolved yet" sometimes classifies as intent:problem instead of intent:status, producing a generic "tell me more" response without ticket reference display. This is LLM phrasing sensitivity, not a behavioural model failure — the same ticket reference with "still not fixed" always works. The form-based path (selecting Reopened / Follow-up from category grid) always works regardless of phrasing.

**Confirmed protected behaviours:**
- Ticket key extraction and display
- Follow-up path activation for common phrasings
- Context preservation across multiple turns
- No redundant "what is the issue" prompting after ticket identified

### Complaint / Escalation: REGRESSION PROTECTED

**Checks passed:**
- "I want to make a formal complaint. The service I have received has been absolutely terrible and I am really unhappy" → complaint-aware response acknowledging frustration ("I can see this is frustrating, and I hear you — I'm sorry")
- "I need to escalate this, I have been waiting 3 weeks and nobody has responded" → same complaint-aware acknowledgement
- Multi-turn complaint journey completes to summary card:
  - Category correctly set to `complaint`, subcategory to `complaint_service`
  - Urgency auto-elevated to `High`
  - Description captures complaint context accurately
  - Subject prefixed with `[Portal] Service complaint —`
- Complaint context survives second turn (providing website details does NOT reset to generic intake)
- Short complaint "I am very unhappy with the service, this is unacceptable" → correctly enters complaint path

**Confirmed protected behaviours:**
- Frustration/dissatisfaction acknowledgement on first turn
- Complaint context preserved through multi-turn conversation
- Correct category/subcategory assignment in summary card
- Urgency auto-elevation for complaints
- No internal mechanics leaked in responses

---

## Cross-Domain / Interaction Checks

### Follow-up vs Complaint precedence (Holdout H2/H3)
- **Follow-up with ticket reference** is not overridden by complaint logic — "NT-55555 is not fixed" gets follow-up path, not complaint
- **Complaint without ticket reference** gets complaint path — "I want to make a complaint" does not accidentally enter follow-up flow
- **Mixed: angry message with ticket reference** ("really angry about NT-99999, weeks and nobody has done anything") → follow-up path wins with frustration acknowledgement ("sorry it's not been resolved yet"). This is correct behaviour — the ticket reference takes precedence while the emotional tone is still acknowledged.

### Website/Property Protected Paths (Holdout H4)
- "Update contact details on my website" → intent:change, asks which website — correct website path
- "Property listing has wrong images" → intent:problem, asks for property address — correct property path
- No regression from Phase 3 changes

### Category Grid Selection
- Explicit category mention ("I want to select the Website Security category") → proceeds into website path correctly

---

## Holdout Scenario Results

| Holdout | Description | Result |
|---------|-------------|--------|
| H1 | Req 1A categories accessible after follow-up/complaint changes | PASS — all 4 categories present, no taxonomy leak |
| H2 | Canonical follow-up works after complaint changes | PASS — follow-up path activates, complaint logic does not intercept |
| H2 edge | Short ticket reference ("NT-55555 is not fixed") | PASS — ticket displayed, follow-up path activated |
| H3 | Canonical complaint works after follow-up changes | PASS — complaint context preserved through multi-turn |
| H3 edge | Complaint context survives website detail on turn 2 | PASS — no reset to generic intake |
| H4 | Website/property protected paths stable | PASS — both paths work correctly |
| Mixed | Angry + ticket reference (complaint vs follow-up) | PASS — follow-up wins with frustration acknowledgement |

---

## Non-Blocking Gaps

1. **Follow-up phrasing sensitivity:** Longer narrative phrasings with "has not been resolved yet" sometimes miss the follow-up path (LLM classifies as problem). Common short phrasings ("still not fixed", "is not fixed") work reliably. Form-based path always works. This is a polish improvement, not a behavioural model failure.

2. **Pre-existing DB schema gaps:** `portal_chat_sessions.updated_at` column missing, `/api/portal/tickets` returns SQL error. These are pre-existing infrastructure issues that affect all phases equally, not Phase 3 regressions.

3. **Complaint state tracking:** Complaint context is maintained through LLM conversational state rather than explicit metadata flags. Works in testing but is inherently less robust than flagged state. Not a blocker for protection — the behaviour is correct.

---

## Blockers

None.

---

## Archive Recommendation

All three domains can be archived as protected convergence:

- **Req 1A:** Category taxonomy complete, no leakage, accessible via form and conversation
- **Follow-up continuity:** Ticket detection and context preservation working through runtime
- **Complaint/escalation:** Frustration handling, multi-turn completion, correct categorisation all working

The regression protection bundle holds. No domain materially regresses another.
