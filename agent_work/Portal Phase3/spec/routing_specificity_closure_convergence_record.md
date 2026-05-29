# Convergence Record — Routing Specificity Closure

## Status

Regression Protected

## Intent

Close the remaining Portal Phase3 routing specificity blockers from the Iteration 42 root-cause correction path.

## Current Decision

Behaviourally converged and regression protected. All four blocker families are closed, regression guards remained stable, and a broad 90-day NT / NTPJ replay found no material recurrence of the protected failure families.

## Evidence

Independent evaluation: `agent_work/eval_output/iteration43_routing_specificity_eval.md`

Regression protection evaluation: `agent_work/eval_output/last90_nt_ntpj_portal_regression_replay_2026-05-29.md`

Evaluation result:

- `54` fresh isolated sessions
- routing-sensitive cases repeated `2-3x`
- `23` pass
- `2` borderline
- `0` fail
- runtime freshness confirmed against the latest `portal-chat.ts` write timestamp

Regression protection result:

- `1,323` NT / NTPJ tickets in the last-90-day window
- `1,261` replay candidates
- `1,260` successful portal replays
- no material recurrence of any protected blocker
- `475/475` summary-stage sessions had populated subject and description
- `238` distinct hostnames captured without public-domain truncation
- verdict: `REGRESSION PROTECTED`

## Closed Blockers

- property count mismatch now routes to `property / property_visibility`
- property wrong-status phrasing now routes to `property / property_status`
- CRM / API / leads / database integration requests remain out of email marketing
- URL-less named-page website amendments now route to `website / website_content`

## Regression Protection Observed

- genuine email marketing still routes correctly
- website content amendments with URLs still route correctly
- feed sync remains stable
- BYM password reset and account setup remain out of email marketing
- full domains and full URL paths remain preserved
- blank input is rejected cleanly
- response assembly shows no garbled or duplicated fragments
- fresh sessions do not falsely claim prior contact

## Non-Blocking Carry-Forward

These are future specificity tuning candidates, not convergence blockers:

- `LeadPro isn't sending leads into our database` can still route to `other_general`
- `New leads aren't syncing into the database from the website` can still route to `website_content`

They remain non-blocking because both stay out of email marketing and do not violate the Iteration 43 success criteria.

The 90-day replay adds further non-blocking observations:

- approximately two ambiguous website / email-footer edge cases can still route toward email marketing
- some atypical internal-forward or system-notification tickets remain noisy replay inputs

These do not block protection because they do not materially reproduce the protected failure model.

