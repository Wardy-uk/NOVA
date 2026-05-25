# Phase 2 Iteration 16 — Behavioural Evaluation
## Focus: Field-Boundary Handling at Summary Time

**Date:** 2026-05-23  
**Evaluator:** Eval Agent (API-driven, no source inspection)  
**Method:** 10 conversational scenarios via portal chat API (codex test user)  
**Sessions tested:** 503–512

---

## Journeys Tested

| # | Scenario | Turns | Reached Summary? |
|---|----------|-------|-------------------|
| T1 | Inline account extraction — trailing text | 3 | Yes |
| T2 | Account extraction — trailing clause | 3 | No |
| T3 | Account + URL bundled in one message | 2 | No |
| T4 | Edit with filler wording ("should just be high") | 5 | Yes |
| T5 | Edit with "change X to Y" filler | 4 | No |
| T6 | Three-field simultaneous edit | 5 | No |
| T7 | Conversational activation — natural entry | 1 | N/A (opening) |
| T8 | Vague request clarification | 3 | No (progressive) |
| T9 | Non-website routing | 1 | N/A (opening) |
| T10 | Natural summary confirmation | 4 | Yes |

**Only 3 of 10 scenarios reached a summary card.** The remaining conversations looped on URL clarification and never progressed.

---

## Evaluation Findings

### 1. Inline Account Extraction

**Verdict: Partially improved, with new issues**

- **T1** — Account extracted cleanly as `"Acme Properties"` with no trailing text from "please, it's currently showing an old number." This is a positive signal for inline extraction.
- **T2** — Account name `"Thompson & Sons Estate Agents"` was **not extracted** from "The website for Thompson & Sons Estate Agents has an error." The bot asked "Which account or website is this for?" despite the account being clearly stated in the message.
- **T3** — `"Acme Properties Ltd"` was extracted but the bot then asked about "which property is affected" — misrouting a website content change as a property issue.
- **T10** — Account was set to `"oakwoodestates.co.uk"` (the URL) instead of `"Oakwood Estates"` (the company name stated in the same message). The URL was not stored in the URL field — it went to account instead.

**New issue:** In T1, the phone number `01234 567 890` was partially misinterpreted — `"01234"` was extracted as a **Listing ref** (`listingId`). Phone numbers should not contaminate the listing ID field.

### 2. Filler Wording in Edit-Derived Values

**Verdict: Not converged**

- **T4** — The user said "actually the priority should just be high" after providing details. The summary showed:
  - **Priority** remained `"Normal"` — the edit was not applied at all
  - **Description** contained the raw concatenation of all messages including the literal text `"actually the priority should just be high"` as part of the description body
  - The filler phrase was neither stripped nor acted upon — it was dumped into the description field verbatim
- **T5** — Never reached summary, so filler stripping could not be tested for the "change the summary to X" pattern.

### 3. Three-Field Simultaneous Edit

**Verdict: Not testable — never reached summary**

- **T6** — After 5 turns including explicit details (account name, URL, specific change requested), the bot was still asking "Could you please provide the exact URL of the contact page." The 3-field edit message ("change the account to Belmont Properties, the priority to urgent, and the summary to Fix broken contact form") was treated as another conversational turn, not as an edit instruction. No summary was produced.

### 4. Earlier Conversational Continuity

**Verdict: Mostly preserved**

| Gain | Status |
|------|--------|
| Conversational activation (natural entry) | ✅ Intact — casual entries like "hey, our website has the wrong email" are recognized |
| Hidden routing | ✅ Intact — intent classified without exposing routing to user |
| Vague request clarification | ✅ Intact — progressive narrowing from "Something needs changing" → website → specific issue |
| Natural summary confirmation | ⚠️ Partial — "yes that looks right" in T10 triggered a NEW summary rather than confirming an existing one (the bot had asked for a URL, not for confirmation) |
| Property-question narrowing | ⚠️ Regressed in T3 — website content change misrouted as property issue |

### 5. Structural Concerns (Outside Phase Scope But Notable)

- **URL field capture is unreliable:** In T4, the user explicitly provided `www.smithlettings.co.uk` but the summary shows `url: null`. In T10, `oakwoodestates.co.uk` went to account instead of URL.
- **URL clarification loop:** Multiple scenarios (T2, T5, T6) got stuck repeatedly asking for a URL even after one was provided, preventing the conversation from reaching summary.
- **Phone number → listing ID contamination:** T1 shows `listingId: "01234"` extracted from the phone number `01234 567 890`.
- **Description synthesis:** T4's description is raw message concatenation, not a synthesized summary.

---

## Convergence Assessment

| Criterion | Status |
|-----------|--------|
| Inline account extraction stops at account name | **Partially converged** — works in simple cases (T1), fails when account has trailing clause (T2) or is bundled with URL (T3, T10) |
| Edited values free of filler wording | **Not converged** — filler dumped into description verbatim, edit not applied to target field (T4) |
| 3-field simultaneous edits apply correctly | **Not testable** — conversations can't reach summary reliably enough to test edits |
| Earlier Phase 2 conversational gains intact | **Mostly intact** — activation, routing, and clarification work; summary confirmation and property narrowing show minor regressions |

### Overall: **Not yet converged**

The primary blocker is that conversations frequently cannot reach the summary stage due to URL clarification loops. This makes it impossible to properly evaluate field-boundary handling at edit time. The scenarios that did reach summary reveal:
1. Account extraction is cleaner in the simple case but inconsistent across patterns
2. Priority edits with filler wording are neither parsed nor applied
3. Phone numbers can contaminate listing ID fields

**Recommended next focus:**
1. Fix URL recognition/capture so conversations can reliably reach summary
2. Then address priority/field edit parsing to strip filler and apply changes
3. Then re-test 3-field simultaneous edits once single-field edits work
