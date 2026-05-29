# Iteration 40 — Regression Correction Slice

## What regressed in Iteration 39

1. **Email-marketing over-capture**: BYM password resets and contact form issues were routed to email marketing because `detectEmailMarketingFromKeywords` lacked login/password/access and contact-form guards.

2. **Property specificity collapsed**: LLM frequently classifies property issues as `isWebsiteRelated=true` because property messages mention "showing" / "website". Since the website path is checked before the property path, all property scenarios fell into the generic website-content question ("is something not displaying correctly?").

3. **URL/domain truncation**: LLM-generated acknowledgment text could contain truncated domains (e.g. `www.co.uk` instead of `www.exampleestates.co.uk`). The regex-extracted URL was correct, but the response text was not repaired.

4. **Blank summary fields**: If description was stripped to empty by greeting removal, subject auto-generation produced empty subjects. No safety net existed.

5. **Duplicated response fragments**: LLM sometimes embedded a question in the acknowledgment AND returned a separate nextQuestion. Code appended both, producing duplicated questions.

## What was changed

### 1. Email marketing guards (detectEmailMarketingFromKeywords)
- Added login/password/access guard: messages with password reset, login, locked out, can't access, 2FA etc. bail out immediately, even when BYM is named.
- Added contact form guard: "contact form", "enquiry form", "web form" bail out (these are website issues).

### 2. Property precedence gate (handleIntentWithLlm)
- Before entering the website path (for both high and moderate confidence), `detectPropertyFromKeywords` is called. If it returns likely=true, the LLM flags are swapped: isWebsiteRelated→false, isPropertyRelated→true, with the deterministic subcategory applied.
- This ensures property scenarios always reach property-specific follow-up questions.

### 3. URL/domain repair (repairTruncatedDomains)
- New function detects structurally invalid truncated domains (www.TLD with no SLD) in response text.
- Applied to LLM acknowledgment and nextQuestion immediately after LLM returns.
- Uses the regex-extracted full URL as the authoritative source.

### 4. Summary card safety nets (buildSummaryCard)
- After subject auto-generation, a guard checks if the subject is blank/empty after stripping the [Portal] prefix.
- Falls back to opening message or category name — never produces blank.
- Also ensures description is populated from opening message if somehow empty.

### 5. Response deduplication (stripTrailingQuestion)
- New function strips trailing question sentences from multi-sentence text.
- Applied to LLM acknowledgment when the LLM also returned a separate nextQuestion.
- Prevents the "two questions" pattern.

### 6. Website detection broadened
- Added "contact form", "enquiry form", "web form" to website signal patterns so these route correctly to website.

## What remains uncertain or risky

- **LLM variability**: The property precedence gate relies on `detectPropertyFromKeywords` being correct. If a genuinely website-only message mentions "property" incidentally (e.g. "property page on our website needs updating"), the gate will reroute to property. The existing website-context guard in `detectPropertyFromKeywords` should prevent this, but edge cases are possible.

- **URL repair scope**: The repair only catches `www.TLD` patterns. If the LLM truncates a domain differently (e.g. drops the subdomain from `portal.example.co.uk`), the repair won't catch it. This is a narrow fix for the observed defect.

- **Email marketing bare `campaign` keyword**: The `hasStrongEmailSignal` regex still includes bare `campaign` as a match. This is broad but hasn't been the source of the observed regressions (those were BYM/contact-form). Tightening it risks breaking genuine email marketing detection.

- **Response composition in multi-turn flows**: The deduplication only handles the initial intent stage. If the detail stage's LLM follow-up questions produce similar duplication, those aren't covered. Observed defects were in the opening exchange only.

## Ready for evaluation?

Yes — this slice is ready for independent evaluation. The five regression corrections target the specific behavioural failures observed in the Iteration 39 evaluation. No new routing paths or classification logic was added. Changes are defensive guards and safety nets.
