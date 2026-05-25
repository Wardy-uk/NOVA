# May 25 Regression Bundle Decision

## Outcome

Verdict: `REGRESSION PROTECTED`

The May 25 regression protection bundle has passed cleanly through the live runtime path. No blockers were found. All three targeted domains are now promoted from converged state to protected state.

Protected in this bundle:

- Deterministic routing hardening
- Edge-case routing sensitivity hardening
- Single shared config protection

## Decision Rationale

- The evaluator confirmed 50/50 checks passing with zero failures.
- All holdout scenarios passed.
- No customer-facing taxonomy leakage was observed.
- Previously protected complaint, follow-up, website, property, and letters paths remained stable.
- The remaining notes are explicitly pre-existing and non-blocking.

## Carried Forward Notes

- Letters precedence when `website` appears only as incidental context remains a broader mixed-intent limitation, not a regression from this bundle.
- `property_*` subcategory naming remains structurally inconsistent with the default taxonomy, but runtime behaviour is unaffected.
- New chat session `status` observability remains incomplete for some fresh sessions.

## Programme Effect

Portal Phase3 now has two protected bundles archived:

- the earlier bundle covering Req 1A, follow-up continuity, and complaint operational behaviour
- this May 25 bundle covering deterministic routing, edge-case routing hardening, and shared config protection

The only open active cycle remains `Complaint management alerting`, which is blocked on Jira-connected runtime validation rather than implementation gaps.
