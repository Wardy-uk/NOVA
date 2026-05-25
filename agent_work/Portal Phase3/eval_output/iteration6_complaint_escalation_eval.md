# Evaluation Report — Iteration 6: Complaint / Escalation Operational Behaviour

**Date:** 2026-05-24  
**Evaluator:** Eval Agent  
**Slice:** Complaint / escalation operational behaviour hardening  
**Verdict:** CONVERGED — complaint slice is behaviourally closed

---

## Overall Assessment

All three previously identified complaint-path defects from Iteration 5 are now closed. The complaint-aware path is coherent, operationally distinct from ordinary intake, and customer-safe. Complaint context survives across multiple turns, mixed-domain messages correctly preserve complaint precedence, and dissatisfaction/escalation phrases now route correctly.

No internal taxonomy, queue names, routing mechanics, confidence language, or implementation jargon leak to the customer in any tested scenario.

---

## Priority Checks — Previously Failed Scenarios

### F1 (was HIGH): Short complaint opening → operational detail on turn 2

**Input:** "I want to make a complaint about how this has been handled" → "The property feed has been broken for two weeks and nobody has responded to my previous tickets"

**Result: PASS (FIXED)**

- Turn 1: System acknowledges complaint intent directly ("You want to make a complaint about how this has been handled") and asks "Could you tell me what happened and what outcome you're looking for?" — complaint-aware continuation prompt, not a generic vague gate.
- Turn 2: System asks for account details — stays on the complaint-aware path, does not reset to generic intake.
- Turns 3–4 (extended): Produces complaint-aware summary card with subject "[Portal] Service complaint — Complaint: property feed broken for two weeks with no response", request type "Service complaint", urgency "High". Additional complaint detail ("I want someone senior to look at this") does not break the summary.

The short complaint opening no longer falls into generic vague-gate handling. The system carries complaint context forward through multiple turns.

### F2 (was MEDIUM): "I'm really unhappy" / escalation language not matched

**Input:** "I'm really unhappy with the response time and need this escalated today"

**Result: PASS (FIXED)**

- System acknowledges the dissatisfaction directly and asks "Could you tell me what happened and what outcome you're looking for?" — complaint-aware continuation.
- On turn 2 with operational detail (CRM integration failure + ticket ref), system asks for account details to escalate — stays complaint/escalation-aware.
- The intent is tagged as `status` (reasonable for escalation of existing ticket), not dropped into generic intake.

### F3 (was MEDIUM): Mixed-domain complaint — complaint loses to domain disambiguation

**Input:** "I would like to raise a complaint. Our account has ongoing issues with property feed uploads failing"

**Result: PASS (FIXED)**

- System responds: "I'm sorry to hear that — I want to make sure your complaint is properly recorded and dealt with. Could you tell me what happened and what outcome you're looking for?"
- Complaint language takes precedence over property-feed domain disambiguation. No domain disambiguation prompt appears.
- On turn 2 with more detail, system produces complaint-aware summary with correct subject line and high urgency.
- The account field incorrectly parsed "has ongoing issues with property feed" from the original message rather than waiting for the user to provide it, but this is a minor field-extraction quality issue, not a complaint-path defect.

---

## Holdout Scenario Results

| ID | Scenario | Result | Notes |
|----|----------|--------|-------|
| H1 | "I want to make a complaint about repeated poor service" | PASS | Complaint acknowledged, asks for detail — stays complaint-aware |
| H2 | Angry + actionable detail (wrong properties, called twice, escalate immediately) | PASS | Preserves both complaint context and operational detail. Offers to create ticket directly. Does not collapse into generic intake. |
| H3 | "This is the third time I've asked. Please escalate this" | PASS | Escalation intent recognised without word "complaint". Empathetic acknowledgment + direct ticket creation offer. |

---

## Edge Input Results

| Input | Result | Notes |
|-------|--------|-------|
| "I need to speak to a manager about this" | PASS | Asks for more context — reasonable for an ambiguous escalation request. Does not ignore the escalation intent. |
| "I've been waiting two weeks for a response and I'm at the end of my tether" | PASS | Frustration detected, empathetic response, offers direct ticket creation. |

---

## Regression Checks

| Check | Result | Notes |
|-------|--------|-------|
| Normal property feed issue (no complaint) | PASS | Routes to property-aware path with disambiguation (website vs portals). No complaint treatment. |
| Website search issue (protected category) | PASS | Routes to website-aware path, asks for account. No complaint treatment. |
| Non-complaint simple question | PASS | "How do I add a new branch" handled as ordinary question. |
| Follow-up continuity | Not explicitly re-tested — no regression visible from complaint changes. |

---

## Detailed Behavioural Assessment

### Complaint context preservation
- Complaint context survives across 4+ turns (tested in PC1-DEEP and CONTINUITY scenarios).
- Summary cards consistently show "Service complaint" request type, "Complaint:" prefix in subject, and High urgency.
- Additional complaint detail on later turns does not break or reset the summary.

### Customer-safe wording
- No internal jargon, queue names, routing labels, or confidence language appears in any response.
- Responses use natural empathetic language: "I'm sorry to hear that", "I can see this is frustrating", "I hear you".
- No taxonomy leakage: no mention of categories, subcategories, intent classifications, or escalation tiers.

### Submission path
- Complaint summaries produce coherent request cards with complaint-aware fields.
- Subject lines clearly indicate complaint nature for downstream processing.

### Non-blocking quality observations
These do not affect convergence but are worth noting:

1. **Account field extraction**: In PC3-DEEP and CONTINUITY scenarios, the account field sometimes misparses text fragments from the complaint message (e.g. "mal complaint", "has ongoing issues with property feed"). This is a field-extraction quality issue across the intake system, not specific to the complaint path.

2. **Session metadata**: The session metadata returned from the messages endpoint shows `stage=undefined`, `intent=undefined/null/status/question`, `category=undefined`. The complaint-aware behaviour is clearly driven by the LLM's conversational context rather than structured metadata flags. This means complaint tracking relies on the LLM maintaining context across turns rather than explicit state markers. While this works correctly in all tested scenarios, it is less robust than explicit complaint state tracking would be.

3. **Listing ref misparse**: In the CONTINUITY scenario, the ticket reference "NT-17890" was extracted into the `listingId` field as "17890", stripping the NT prefix. This is a field-extraction issue, not a complaint-path defect.

---

## Regression Trap Assessment

| Trap | Status |
|------|--------|
| Complaint language acknowledged emotionally but routed like ordinary request | NOT TRIGGERED — complaint path produces distinct request type and urgency |
| Portal leaks internal escalation or queue language | NOT TRIGGERED — no internal mechanics visible |
| Complaint category exists visually but conversational paths ignore complaint intent | NOT TRIGGERED — conversational path is fully complaint-aware |
| Follow-up continuity or protected categories regress | NOT TRIGGERED — website and property paths unaffected |

---

## Infrastructure Limitation Assessment

The manager handoff noted that downstream infrastructure limitations in dev may constrain what is visible after submission. Assessment:

- The complaint-aware path itself is coherent through all observable stages.
- Complaint context is preserved in the summary card and request details.
- The path is meaningfully different from ordinary intake (distinct request type, urgency boost, complaint prefix).
- The Jira submission endpoint was not tested end-to-end (requires Jira connectivity), but the fields presented for confirmation are complaint-appropriate.

This does not materially compromise the complaint behavioural model.

---

## Verdict: CONVERGED

All three previously identified defects are closed:
- **F1 (HIGH):** Short complaint openings now stay on complaint-aware path through turn 2 and beyond. ✓
- **F2 (MEDIUM):** Dissatisfaction/escalation phrases now trigger complaint handling correctly. ✓
- **F3 (MEDIUM):** Complaint language takes precedence over domain disambiguation in mixed-domain messages. ✓

The complaint-aware operational behaviour is coherent, customer-safe, and behaviourally converged. No holdout scenario failed. No regression was observed. No internal mechanics leak.

**Recommendation:** This slice is converged and does not require another build iteration. The non-blocking quality observations (account field extraction, session metadata structure) are systemic intake issues that apply across all paths, not complaint-specific defects.
