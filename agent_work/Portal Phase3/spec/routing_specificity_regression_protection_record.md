# Regression Protection Record — Routing Specificity Closure

## Status

Regression Protected

## Protected Slice

Portal Phase3 routing specificity closure, covering the Iteration 43 protected behaviours:

- property count mismatch routing
- property wrong-status routing
- CRM / API / leads / database integration protection from email-marketing over-capture
- URL-less named-page website amendment routing
- domain preservation
- summary-card subject / description integrity
- response assembly integrity
- fresh-session prior-contact integrity

## Protection Evidence

Primary report:

`agent_work/eval_output/last90_nt_ntpj_portal_regression_replay_2026-05-29.md`

Supporting raw data:

`agent_work/eval_output/last90_nt_ntpj_portal_regression_replay_2026-05-29_raw.json`

Population:

`agent_work/eval_output/last90_population_2026-05-29.json`

Flags:

`agent_work/eval_output/last90_flags.json`

## Result

- `1,323` tickets in population
- `1,261` replay candidates
- `1,260` successful replays
- `0` material blocker recurrences
- `475/475` summary-stage sessions populated subject and description
- `238` distinct hostnames captured without public-domain truncation
- verdict: `REGRESSION PROTECTED`

## Accepted Caveats

- First-turn and summary-card coverage only; deep multi-turn submission behaviour was not the purpose of this replay.
- Some internal-forward, machine-like, or mixed email-footer tickets remain noisy inputs.
- Approximately two ambiguous website / email-footer cases are accepted as non-blocking because they do not materially reproduce the protected failure model.

## Decision

The protected slice may be promoted from `Converged Pending Protection` to `Regression Protected`.
