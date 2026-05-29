# Manager Decision — Last-90-Day Portal Regression Protection

**Date:** 2026-05-29  
**Domain:** Portal Phase3 routing specificity and output integrity  
**Decision:** REGRESSION PROTECTED

## Summary

The last-90-day NT / NTPJ portal replay supports promotion of Iteration 43 from `Converged Pending Protection` to `Regression Protected`.

Regression replay evidence:

- source queues: `NT`, `NTPJ`
- window: `2026-02-28T00:00:00Z` through `2026-05-30T00:00:00Z` end-exclusive
- total tickets: `1,323`
- replay candidates: `1,261`
- successful replays: `1,260`
- benign replay error: `1`
- excluded: `62`
- no real tickets submitted
- runtime freshness confirmed against current `portal-chat.ts`

## Protected Behaviours Confirmed

- no material email-marketing over-capture recurrence
- property count mismatch remains out of generic website framing
- property wrong-status cases remain out of generic website framing
- CRM / API / feed / integration requests remain out of email-marketing over-capture at blocker level
- URL-less named-page amendments do not fall to `other_general`
- public domains and URL paths remain preserved
- response text shows no garbled or duplicated assembly failures
- fresh sessions do not falsely claim prior contact
- summary-stage sessions preserve populated subject and description

## Non-Blocking Observations

- around two ambiguous website / email-footer cases remain possible because the source text mixes website changes with BYM/email-footer content
- a small number of atypical internal-forward emails or machine-like requests remain noisy replay inputs
- the replay validates broad first-turn routing and summary-card integrity, not deep multi-turn completion

These observations are accepted as non-blocking under the regression protection standard.

## Manager Position

- promote Iteration 43 to `Regression Protected`
- no further build work is required for this protected slice
- retain the raw replay artefacts as regression evidence
- future work on LeadPro / website-leads specificity should be scoped as a new tuning slice only if live usage or future replay shows material impact

