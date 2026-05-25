# Manager Log — 2026-05-24 Complaint Eval Decision

## Decision

Complaint / escalation operational behaviour is:

- NOT CONVERGED

One more small build slice is required.

## Why This Stays Small

The evaluator findings are tightly bounded to three local defects in the complaint path:

1. short complaint sessions fall back into the generic vague gate on the second turn
2. mixed-domain complaint messages can hit disambiguation before complaint routing
3. some common complaint phrasings are missing from the regex coverage

This is hardening, not redesign.

## Confirmed Blockers

1. **Complaint path overridden by vague gate**

- complaint recognition works on the first turn
- the second turn can still receive a generic `what specifically isn't working?` prompt
- this directly matches a complaint holdout regression trap and is the highest-priority fix

## Additional Required Fixes

1. **Move complaint detection ahead of domain disambiguation**

- explicit complaint wording should win over generic domain ambiguity

2. **Expand complaint phrase coverage**

- include `really/very unhappy`
- include `need this escalated`

## Non-Blocking Items Deferred

- structured account extraction consistency
- generic LLM acknowledgement wording polish
- broader management tooling beyond the complaint path

## Next Step

Create and activate a hardening build brief limited to:

- suppressing/adapting the vague gate for complaint sessions
- moving complaint regex handling above domain disambiguation
- extending complaint phrase coverage for the named gaps
