# Evaluation Report — Iteration 5: Complaint / Escalation Operational Behaviour

**Date:** 2026-05-24  
**Evaluator:** Eval Agent  
**Slice:** Complaint / escalation operational behaviour  
**Verdict:** NOT CONVERGED — small focused build slice required

---

## Overall Assessment

Complaint and escalation recognition is materially present and functionally different from ordinary intake. The system detects complaint intent, sets urgency to High, produces "Service complaint" / "Response time concern" request types, prefixes summaries with "Complaint:", and preserves dissatisfaction context through the submission path. No internal jargon, taxonomy, queue names, or routing mechanics leak to the customer.

However, three issues break the complaint-aware experience in specific but reproducible scenarios, and one of these directly matches a holdout regression trap.

---

## Checks Passed

| # | Check | Result |
|---|-------|--------|
| 1 | Explicit "I want to make a complaint" recognised as complaint intent | PASS |
| 2 | "Please escalate this" recognised (via frustration → complaint detection) | PASS |
| 3 | "This is completely unacceptable. I need this escalated" recognised | PASS |
| 4 | Detailed complaint with account goes straight to summary card | PASS |
| 5 | Summary shows "Complaint:" prefix and complaint-aware request type | PASS |
| 6 | Urgency boosted to High for complaint/escalation messages | PASS |
| 7 | Complaint context preserved in synthesised description | PASS |
| 8 | Angry + operational detail both preserved (H2) | PASS |
| 9 | Escalation without word "complaint" detected (H3) | PASS |
| 10 | No internal jargon, taxonomy, or routing mechanics leaked | PASS |
| 11 | Normal website request NOT misclassified as complaint | PASS (regression) |
| 12 | Follow-up ticket reference still triggers follow-up path | PASS (regression) |
| 13 | Property listing issue still triggers property path | PASS (regression) |

## Checks Failed

| # | Check | Result | Severity |
|---|-------|--------|----------|
| F1 | Short complaint → vague gate overrides complaint flow | FAIL | **High** |
| F2 | "I'm really unhappy" / "need this escalated" not matched by patterns | FAIL | Medium |
| F3 | Domain disambiguation overrides complaint path for mixed-domain messages | FAIL | Medium |

---

## Detailed Findings

### F1: Vague gate overrides complaint flow (HIGH)

**Scenario:** "I want to make a complaint about how this has been handled" (short, no operational detail).

**What happens:**
1. Intent stage: complaint recognised correctly. Response: "Could you tell me what happened and what outcome you're looking for?" ✓
2. User provides detail: "We've been waiting three weeks for our website migration..."
3. Detail stage: `descriptionLacksActionableDetail()` fires on the *original* short description, triggering the vague gate
4. Response: "Could you describe the issue in a bit more detail — what specifically isn't working?" ← generic, not complaint-aware

**Why this matters:** This matches holdout regression trap: "complaint language is acknowledged emotionally but routed like an ordinary request with no escalation-aware outcome." The complaint-aware flow breaks at the second message for any short initial complaint.

**Fix scope:** The vague gate in `handleDetailStage` should either skip entirely when `meta.complaintDetected` is true, or the description should be updated before the vague gate check runs.

### F2: Pattern coverage gaps (MEDIUM)

**Scenario:** "I'm really unhappy with the response time and need this escalated today"

**What happens:** Falls through to LLM classification → generic intake path. Neither COMPLAINT_INTENT_PATTERNS nor FRUSTRATION_PATTERNS match.

**Missing patterns:**
- "I'm really/very unhappy" — only `I('m| am) not (happy|satisfied)` is matched
- "need this escalated" — only `needs to be escalated`, `want this escalated`, `this needs escalating` are matched

### F3: Domain disambiguation overrides complaint path (MEDIUM)

**Scenario:** "I would like to raise a complaint. Our account has ongoing issues with property feed uploads failing..."

**What happens:** LLM classifies with cross-domain ambiguity → disambiguation question fires BEFORE the complaint intent regex runs. Customer explicitly says "raise a complaint" but gets asked "is this affecting your website, property portals, or both?"

**Root cause:** In `handleIntentWithLlm`, the disambiguation check (line ~1460) runs before `COMPLAINT_INTENT_PATTERNS.test()` (line ~1469). Moving complaint detection above disambiguation would fix this.

---

## Confirmed Behaviours

- Complaint intent detection via regex works for explicit complaint language
- Complaint category + subcategory classification (complaint_service, complaint_escalate, complaint_response) correctly set
- Frustration handler correctly delegates to complaint path when COMPLAINT_INTENT_PATTERNS also match
- Summary synthesis produces complaint-aware subjects ("Complaint: ...") and request types ("Service complaint")
- Internal note correctly includes "⚠️ COMPLAINT / ESCALATION" marker
- `complaintDetected` metadata flag correctly persists through session
- Customer-safe wording throughout — no operational mechanics exposed

## Non-Blocking Gaps

- Account field sometimes not populated as structured field even when present in text (shows in description only)
- LLM acknowledgement sometimes overrides the default complaint-specific empathy text with a generic paraphrase

---

## Recommendation

**NOT CONVERGED — one small focused build slice required.**

The complaint recognition model is fundamentally sound. The three failures are isolated, focused, and independently fixable:

1. **(Must fix)** Skip or adapt the vague gate for `meta.complaintDetected` sessions — this is the highest-impact fix and directly addresses a holdout regression trap
2. **(Should fix)** Move complaint intent regex check above domain disambiguation in `handleIntentWithLlm`
3. **(Should fix)** Extend COMPLAINT_INTENT_PATTERNS to cover "really/very unhappy" and "need this escalated"

All three are small, surgical changes in `portal-chat.ts`. No architectural work needed. Estimated scope: one iteration.
