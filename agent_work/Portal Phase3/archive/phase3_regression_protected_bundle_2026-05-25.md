# Portal Phase3 Archive — Regression Protected Bundle (2026-05-25)

## Protected Domains

This archive records the domains promoted to `Regression Protected` at the end of the Portal Phase3 regression bundle:

1. Req 1A — Missing intake category completion
2. Reopened / follow-up ticket continuity
3. Complaint / escalation operational behaviour

## Protection Basis

Protection decision was based on:

- `agent_work/Portal Phase3/eval_output/phase3_regression_protection_report.md`
- `agent_work/Portal Phase3/spec/regression/regression_protection_standard.md`

The regression bundle confirmed:

- real runtime behaviour holds for the newly converged domains
- the domains do not materially regress each other
- website/property protected paths remain stable
- customer-visible coherence and taxonomy protection hold
- no critical behavioural blockers remain

## Notable Protected Behaviours

### Req 1A — Missing intake category completion

- all 13 categories present, including the four Phase 3 additions
- customer-safe labels and subcategories
- no taxonomy leakage

### Reopened / follow-up ticket continuity

- canonical ticket-reference follow-up phrasing activates the follow-up path
- ticket key is preserved and shown via `Related ticket`
- context is preserved across turns without redundant ticket-ref prompting

### Complaint / escalation operational behaviour

- clear complaint/escalation wording activates a complaint-aware path
- complaint context survives across turns
- summary behaviour remains complaint-aware with high urgency

## Non-Blocking Follow-On Items

1. Follow-up phrasing sensitivity for longer narrative wording such as `has not been resolved yet`
2. General field-extraction quality improvements where structured fields can be polluted by narrative text
3. Optional future strengthening of explicit complaint state tracking in metadata
4. Separate future domains such as deterministic routing hardening or shared-config protection

## Resume Guidance

Future work should start from the next unresolved domain rather than reopening these protected behaviours unless a new regression is observed.
