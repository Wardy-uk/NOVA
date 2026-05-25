# Evaluator Brief — WS1-A + WS1-B: Tier Governance + Resolution SLA

## Metadata

- **Slice:** WS1-A (Tier Governance / Ghost Suppression / CC Visibility) + WS1-B (Resolution SLA Source Verification)
- **Workstream:** WS1 — Source of Truth Validation
- **Brief Type:** Core evaluator brief
- **Version / ID:** v1
- **Date:** 2026-05-20
- **Author:** Manager Agent
- **Status:** ACTIVE — evaluation may proceed when preconditions are met

---

## 1. Evaluation Purpose

This evaluation is intended to independently verify two claims:

**Claim A (Ghost Suppression):** NOVA's KPI pipeline now emits per-tier KPIs only for the 7 governed tiers, with no ghost KPIs for ungoverned tiers (particularly "Customer Care" and "Unclassified"). All legitimate Customer Care tickets are visible under one of the three CC sub-tiers.

**Claim B (Resolution SLA):** Resolution SLA metrics derived from `customfield_14048` are structurally sound — the source field matches live Jira, the parser handles the field correctly, the absence pattern is explained by project-level SLA configuration, and the denominator methodology is defensible.

---

## 2. Slice Scope

### In Scope

**WS1-A — Tier Governance:**
- Per-tier KPI emission correctness — only governed tiers appear in output
- CC sub-tier routing — all CC-tier tickets route to one of: CC (Incidents), CC (Service Requests), CC (TPJ)
- Null/unmapped request type handling — tickets without `request_type` route to CC (Incidents)
- Ghost suppression — "Customer Care" and "Unclassified" tiers do not appear in `jira_kpi_daily`
- Volume conservation — sum of all CC sub-tier volumes equals total open CC-tier tickets

**WS1-B — Resolution SLA:**
- Source identity — Resolution SLA is derived from `customfield_14048` in `fields_json`
- Source-to-cache fidelity — cached SLA breach status matches live Jira for sampled tickets
- Absence pattern — tickets without `customfield_14048` are from projects without SLA configuration (NTPJ, YO)
- Denominator methodology — tickets without the SLA field are excluded from compliance calculations (not counted as "not breached")
- Compliance value plausibility — Resolution Compliance % (Open Queue) is within a plausible range and consistent with underlying data

### Out of Scope

- FRT metrics (all) — `customfield_14046` not yet in cache; Build Loop 03 pending
- Development backlog count — business definition not yet provided
- CSAT % — deferred to P1
- Escalation / rejection counts — deferred to P1
- Agent-level KPIs — not yet built
- Derived KPIs (FCR %, 1st Line %, Bug Esc-to-Ack) — not yet built
- n8n parity comparison — n8n query not inspected
- Regression protection — not yet established for any KPI

---

## 3. Preconditions

The following must be true before this evaluation is valid:

1. **Ghost suppression code deployed:** The `ccBucket()` null default and tightened emission guard must be deployed to the running NOVA instance
2. **At least one post-deploy snapshot run:** `collectJiraSnapshot()` must have run at least once after deploy, so `jira_kpi_daily` reflects the new logic
3. **Jira sync is current:** `jira_issue_cache` must have completed at least one incremental sync after deploy so ticket data is reasonably fresh

If these preconditions are not satisfied, return: `EVALUATION BLOCKED — preconditions not met`

---

## 4. Evidence Inputs Allowed

### The evaluator MAY use:

- `jira_kpi_daily` table output for the evaluation date (post-deploy)
- `jira_issue_cache` table (read-only queries against cached data)
- Direct Jira REST API queries for sampled tickets (to cross-check SLA status)
- The `ALL_TIERS` constant definition (to confirm governed tier list)
- The KPI inventory document (`01_discovery/kpi_inventory.md`)
- The data lineage map (`01_discovery/data_lineage_map.md`)
- The Build Loop 02 reports (for context on what was changed and verified)

### The evaluator MUST NOT use:

- Source code diffs or implementation details beyond what is documented in build reports
- Build agent confidence assertions as evidence of correctness
- Pre-deploy `jira_kpi_daily` data (which contains ghost KPIs and is not representative of the fixed state)

---

## 5. Evaluation Questions

### WS1-A — Tier Governance

**EQ-A1:** Do post-deploy `jira_kpi_daily` rows contain KPIs only for the 7 governed tiers?
- Governed tiers: CC (Incidents), CC (Service Requests), CC (TPJ), Production, Tier 2, Tier 3, Development

**EQ-A2:** Are there zero KPI rows for "Customer Care" or "Unclassified" tiers in post-deploy output?

**EQ-A3:** Does the sum of CC (Incidents) + CC (Service Requests) + CC (TPJ) volume KPIs approximately equal the total open CC-tier tickets in `jira_issue_cache`?

**EQ-A4:** Are all 7 governed tiers represented in the output, including those with zero volume?

### WS1-B — Resolution SLA

**EQ-B1:** For a sample of 5+ open tickets with known Resolution SLA breaches in Jira, does the cached `customfield_14048` breach status match?

**EQ-B2:** For a sample of 3+ open tickets without Resolution SLA breaches, does the cached status match?

**EQ-B3:** Are tickets from projects without SLA configuration (NTPJ, YO) correctly absent from the Resolution SLA field, and are they excluded from the compliance denominator?

**EQ-B4:** Is the Resolution Compliance % (Open Queue) value plausible (not 0%, not 100%) and consistent with the ratio of breached to checked tickets?

---

## 6. Required Checks

### WS1-A Checks

| # | Check | Method |
|---|-------|--------|
| CA-1 | No ghost tier KPIs | Query `jira_kpi_daily` for current date; check all `kpi` values containing tier names — none should reference "Customer Care" or "Unclassified" |
| CA-2 | All governed tiers present | Query `jira_kpi_daily` for current date; confirm KPI rows exist for all 7 `ALL_TIERS` entries |
| CA-3 | CC volume conservation | Compare sum of "Number of Tickets in CC (Incidents)" + "... CC (Service Requests)" + "... CC (TPJ)" against `SELECT COUNT(*) FROM jira_issue_cache WHERE current_tier = 'Customer Care' AND status_category != 'Done'` (allowing for sync timing drift of ±5) |
| CA-4 | Null RT tickets absorbed | Confirm CC (Incidents) volume has increased significantly compared to pre-fix values (if available) or is substantially larger than CC (Service Requests) + CC (TPJ) |

### WS1-B Checks

| # | Check | Method |
|---|-------|--------|
| CB-1 | Breached ticket cross-check | Pick 5 tickets from `jira_issue_cache` where `customfield_14048` shows breach; verify against Jira REST API `GET /rest/api/3/issue/{key}?fields=customfield_14048` |
| CB-2 | Not-breached ticket cross-check | Pick 3 tickets where `customfield_14048` shows not-breached; verify against Jira |
| CB-3 | Absence by project | Confirm that NTPJ and YO tickets overwhelmingly lack `customfield_14048`; NT tickets overwhelmingly have it |
| CB-4 | Denominator correctness | Confirm that Resolution Compliance % = (tickets-with-field − breached) / tickets-with-field × 100, not (all-tickets − breached) / all-tickets × 100 |
| CB-5 | Compliance plausibility | Confirm Resolution Compliance % (Open Queue) is between 50% and 95% (approximate plausible range given ~17.6% breach rate observed in diagnostics) |

---

## 7. Protected Behaviours

These must not regress:

1. **All 7 governed tiers emit KPIs** — even if volume is 0 for a tier
2. **No non-governed tier emits KPIs** — the emission guard must be unconditional
3. **Tickets with null `request_type` in CC tier are visible** — they must route to CC (Incidents), not be dropped
4. **Tickets from projects without SLA configuration are excluded from SLA compliance denominators** — they must not inflate compliance

---

## 8. Pass / Fail / Ambiguous Rules

### Pass

All of the following:
- CA-1 through CA-4 pass
- CB-1 through CB-5 pass
- No protected behaviour regressions observed

### Fail

Any of the following:
- Ghost tier KPIs appear in post-deploy output (CA-1 fail)
- A governed tier is missing from output (CA-2 fail)
- More than 10% of CC-tier tickets are unaccounted for in the CC sub-tier sum (CA-3 fail with margin)
- A sampled ticket's SLA status does not match between cache and live Jira (CB-1 or CB-2 fail)
- Tickets without SLA fields are included in the compliance denominator (CB-4 fail)

### Ambiguous

- CC volume conservation check is within ±5 but not exact (sync timing drift) — note the discrepancy but do not fail
- Resolution Compliance % is outside the 50-95% range but all sampled tickets match — investigate whether the range assumption is wrong rather than failing
- A single ticket mismatch out of 8+ sampled may indicate sync lag rather than systematic error — flag and investigate

---

## 9. Open Questions / Known Blockers

| # | Question | Impact on Evaluation |
|---|----------|---------------------|
| OQ-1 | FRT metrics are not evaluable — data not yet in cache | Do not evaluate any FRT metric. If FRT rows appear in output, note whether they show 100% compliance / 0 counts (pre-fix behaviour) and flag as out-of-scope. |
| OQ-2 | Development count definition is pending | Do not evaluate "Number of Tickets in Development" for correctness. It may be observed but should not be judged. |
| OQ-3 | Sync timing drift | If the evaluator runs checks hours after the last sync, some tickets may have changed status in Jira. Allow ±5 ticket drift in volume comparisons. |

---

## 10. Required Output Format

The evaluator should return:

- **Overall verdict:** PASS / FAIL / AMBIGUOUS (with reasons)
- **WS1-A verdict:** PASS / FAIL / AMBIGUOUS
- **WS1-B verdict:** PASS / FAIL / AMBIGUOUS
- **Checks passed:** list with evidence references
- **Checks failed:** list with evidence references and observed vs expected
- **Protected behaviours:** confirmed / regressed
- **Blockers encountered:** any preconditions not met
- **Non-blocking gaps:** observations that don't fail the evaluation but should be noted
- **Evidence references used:** queries run, tickets sampled, dates/times
- **Recommended next action:** what should happen after this evaluation

---

## 11. Revision Note

Not applicable — this is the initial core evaluator brief (v1).

Future addenda expected:
- **WS1-C addendum:** FRT metrics evaluation after Build Loop 03 completes
- **WS1-D addendum:** Development backlog evaluation after business definition provided
