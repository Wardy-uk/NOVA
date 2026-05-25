# Evaluator Agent Prompt 01 — WS1 Runtime Execution

Use this prompt to run the first real independent evaluation for the NOVA KPI Engine Recovery & Trust Restoration programme.

---

## Prompt

You are the Evaluator Agent for the NOVA KPI Engine Recovery & Trust Restoration programme.

You must evaluate observable post-deploy behaviour and evidence outputs independently.

Do not inspect source code or implementation diffs to decide whether the slice is correct.

Your judgement must be based on runtime outputs, cached evidence, and direct source cross-checks only.

## Current Evaluation Scope

This is the first real evaluator execution for WS1.

Evaluate:

- **WS1-A:** Ghost suppression / governed tier emission / CC visibility
- **WS1-B:** Resolution SLA source verification and denominator correctness
- **WS1-C:** FRT recovery runtime verification

Do **not** evaluate:

- WS1-D Development backlog count correctness
- CSAT
- escalation / rejection counts
- agent-level KPIs
- derived KPIs
- dashboard / trends / wallboard parity as a convergence target in this run

You may observe those issues, but do not include them in the pass/fail judgement for this slice.

## Artefacts You Must Read First

### Governing Briefs

- `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards/ws1_ab_evaluator_brief_v1.md`
- `agent_work/KPIRecovery/kpi_recovery/04_eval/evaluation_standards/evaluation_lifecycle_standard.md`

### Runtime Evidence

- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_runtime_verification_post_deploy.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop02.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop02_resolution_sla.md`
- `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1_build_report_loop03_frt.md`

### Programme Context

- `agent_work/KPIRecovery/kpi_recovery/00_programme/programme_tracker.md`
- `agent_work/KPIRecovery/kpi_recovery/01_discovery/kpi_comprehensive_audit_2026-05-20.md`

## Important Runtime Context

Treat the following as relevant observed runtime facts, not automatic passes:

- ghost tier rows from today's pre-deploy snapshot may still physically exist as stale MERGE artifacts
- new runtime output confirms the emission guard is active
- governed tier sum plus genuine unclassified tickets exactly matches open tickets
- Resolution SLA remained stable after deploy
- FRT Compliance moved from trivial `100%` to real runtime values (`68%` open queue, `59%` resolved today)
- all 7 governed tiers now show non-zero or real FRT breach data

Your task is to independently confirm whether those claims hold.

## Evidence Inputs Allowed

You MAY use:

- `jira_kpi_daily` for current-date post-deploy output
- `jira_issue_cache` for cached ticket-level evidence
- direct Jira REST API checks for sampled tickets
- runtime reports listed above
- governed tier list and KPI inventory documents

You MUST NOT use:

- source code diffs as proof of correctness
- build-agent assertions as proof
- pre-deploy output as if it represented the fixed state

## Evaluation Questions

### WS1-A — Ghost Suppression / Tier Governance

1. Are new post-deploy KPI outputs limited to governed tiers only?
2. Are `Customer Care` and `Unclassified` ghost rows no longer being actively emitted?
3. Are legitimate CC tickets now visible under `CC (Incidents)`, `CC (Service Requests)`, or `CC (TPJ)`?
4. Is ticket-volume conservation maintained across governed CC sub-tiers plus genuine unclassified tickets?

### WS1-B — Resolution SLA

5. Does cached `customfield_14048` continue to match live Jira for sampled tickets?
6. Is the absence pattern by project still explained and correct?
7. Is the denominator methodology still defensible after deployment?
8. Is Resolution Compliance % plausible and consistent with underlying checked/breached tickets?

### WS1-C — FRT Runtime Recovery

9. Is `customfield_14046` now effectively present in runtime/cached evidence for NT tickets?
10. Has FRT output stopped defaulting to trivial values?
11. Are per-tier FRT breach counts now materially non-zero where expected?
12. Is the observed FRT pattern plausible given the 30-minute FRT goal and tier/project distribution?

## Required Checks

You should perform at least:

### Tier Governance Checks

- confirm no fresh KPI rows are being created for `Customer Care` or `Unclassified`
- distinguish stale rows from actively emitted rows if necessary
- confirm governed CC sub-tier totals plus genuine unclassified tickets reconcile to open-ticket totals within small timing drift

### Resolution SLA Checks

- re-sample at least 5 breached tickets and 3 non-breached tickets against live Jira
- confirm NTPJ / YO absence pattern remains valid
- verify denominator logic from actual checked vs missing-field counts

### FRT Checks

- sample NT tickets and confirm FRT field-backed evidence is now present in runtime/cache-derived outputs
- verify FRT Compliance % is no longer `100%`
- verify at least one governed tier shows non-zero FRT breaches
- confirm Development having the highest FRT breaches is plausible, not obviously contradictory

## Verdict Rules

### PASS

Use PASS if:

- WS1-A protected behaviours hold
- WS1-B sampled source checks hold
- WS1-C runtime outputs are clearly non-trivial and consistent with field acquisition recovery
- no major contradiction appears between cache evidence and live Jira for the evaluated scope

### FAIL

Use FAIL if any of the following occur:

- ghost KPIs are still being actively emitted after deploy
- governed tier coverage is materially broken
- Resolution SLA cache-to-Jira matching fails materially
- FRT still behaves like a trivial default (`100%`, all-zero per-tier counts) after the runtime change

### AMBIGUOUS

Use AMBIGUOUS if:

- stale pre-deploy rows cannot be cleanly separated from active output
- sync timing drift makes the totals genuinely unclear
- live Jira and cache timing differ enough that you cannot make a fair pass/fail judgement

If ambiguous, state exactly what evidence is missing.

## Required Output

Write the evaluation result to:

`agent_work/KPIRecovery/kpi_recovery/04_eval/eval_reports/ws1_eval_report_01.md`

Include:

1. Overall verdict
2. WS1-A verdict
3. WS1-B verdict
4. WS1-C verdict
5. Checks passed
6. Checks failed
7. Ambiguities / blockers
8. Evidence references used
9. Non-blocking observations
10. Recommended next manager action

## Final Rule

Judge what the running system does now.

Do not give credit for code intent if the runtime evidence does not support it.
