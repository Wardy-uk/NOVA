# WS1 Regression Report Contract

**Date:** 2026-05-20
**Purpose:** Define the required structure and content of each WS1 regression report

---

## Report Naming

`ws1_regression_report_run{NN}.md` — sequential numbering starting at 01.

---

## Required Sections

### 1. Header

| Field | Value |
|-------|-------|
| Run Number | Sequential (01, 02, ...) |
| Date | Date of regression check execution |
| Data Source | Which database(s) queried |
| Script | Script filename and version |
| Executor | Agent or human who ran the check |

### 2. Check Results Table

| Check ID | Description | Result | Evidence |
|----------|-------------|--------|----------|
| RC-001 | No ghost tier emission | PASS/FAIL | Distinct tiers found |
| RC-002 | Governed tier conservation | PASS/FAIL | Tier count and list |
| RC-003 | CC null handling stable | PASS/FAIL | CC (Incidents) volume |
| RC-004 | Resolution SLA plausible | PASS/FAIL | Compliance % and counts |
| RC-005 | FRT non-trivial | PASS/FAIL | FRT Compliance % |
| RC-006 | Per-tier FRT breaches | PASS/FAIL | Tiers with breaches |

### 3. Overall Verdict

PASS (all 6 checks pass) or FAIL (any check fails).

### 4. Comparison to Baseline

For each check, note whether the value is consistent with or diverging from the frozen baseline (BF-001 through BF-004).

### 5. Anomalies (if any)

Any unexpected observations that don't trigger a FAIL but warrant attention.

---

## Promotion Tracking

| Gate | Condition | Status |
|------|-----------|--------|
| PG-4 | ≥ 1 clean regression run | Update after each run |

When PG-4 is satisfied, the regression report should note that the promotion gate for REGRESSION PROTECTED is met.
